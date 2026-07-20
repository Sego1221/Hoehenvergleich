/**
 * Vergleichs-Historie eines Projekts: listen (GET) und neuen Vergleich
 * starten (POST, multipart/form-data: Soll + Ist + Parameter).
 *
 * POST: Der multipart-Body wird UNGEPARST an den Compute-Service
 * durchgestreamt (compareStream) — GB-grosse Wolken werden so nicht im
 * Next-Prozess gepuffert. Die Metadaten (mode/name/surveyDate/Parameter/
 * Dateinamen) kommen als Query-Parameter mit; die Formfelder im Body sind
 * bereits in der Compute-Konvention (soll+cloud bzw. cloud1+cloud2).
 * Anschliessend wird die comparison-Zeile inkl. stats persistiert (= Historie).
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { compareStream, build3d, type Transform } from "@/lib/computeClient";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
// Grosse Uploads (LAZ/DSM): kein Body-Limit erzwingen, Body wird gestreamt.
export const maxDuration = 300;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rows = await db
    .select()
    .from(schema.comparisons)
    .where(eq(schema.comparisons.projectId, params.id))
    .orderBy(desc(schema.comparisons.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const q = req.nextUrl.searchParams;
  const mode = (q.get("mode") ?? "aushub").trim();
  const clouds = mode === "clouds";

  const sollName = (q.get("sollName") ?? "").trim();
  const istName = (q.get("istName") ?? "").trim();
  if (!sollName || !istName) {
    return NextResponse.json(
      { error: clouds ? "Zwei Punktwolken (A und B) erforderlich." : "Soll- und Ist-Datei erforderlich." },
      { status: 400 },
    );
  }

  const name = (q.get("name") ?? "").trim() || `Vergleich ${new Date().toLocaleDateString("de-CH")}`;
  const surveyDateRaw = (q.get("surveyDate") ?? "").trim();
  const numOrUndef = (k: string) => {
    const v = q.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const boolOrUndef = (k: string) => {
    const v = q.get(k);
    if (v === null || v === "") return undefined;
    return v === "true" || v === "1";
  };

  let transform: Transform | undefined;
  const tRaw = q.get("transform");
  if (tRaw && tRaw.trim()) {
    try {
      const t = JSON.parse(tRaw);
      transform = { tE: t.tE, tN: t.tN, tH: t.tH, angle_deg: t.angleDeg ?? t.angle_deg ?? 0 };
    } catch {
      return NextResponse.json({ error: "Transform-JSON ungueltig." }, { status: 400 });
    }
  }

  // Nur fuer die DB-Historie (params-Spalte); der Compute liest die Parameter
  // selbst aus den Formfeldern des durchgestreamten Bodys.
  const opts = {
    res: numOrUndef("res"),
    tol: numOrUndef("tol"),
    ground_pct: numOrUndef("ground_pct"),
    exg_thr: numOrUndef("exg_thr"),
    use_veg: boolOrUndef("use_veg"),
    cap: numOrUndef("cap"),
    transform,
  };

  let result;
  try {
    result = await compareStream(clouds, req.body, req.headers.get("content-type") ?? "");
  } catch (e) {
    return NextResponse.json(
      { error: `Compute-Service-Fehler: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // 3D-Datengrundlage (Octree + GLB + scene.json) erzeugen, SOLANGE die job_id
  // noch im RAM-Cache des Compute liegt. 3D ist optional -> Fehler nicht fatal.
  try {
    const scene = await build3d(result.job_id);
    console.log(`[hoehenvergleich] build3d job=${result.job_id} octree_ready=${scene.octree_ready} points=${scene.points}`);
  } catch (e) {
    console.warn(`[hoehenvergleich] build3d fehlgeschlagen (3D optional) job=${result.job_id}: ${(e as Error).message}`);
  }

  const sollKind = clouds ? "cloud"
    : /\.ifc$/i.test(sollName) ? "ifc"
    : /\.(tif|tiff|gtiff)$/i.test(sollName) ? "dsm"
    : "mesh";
  const istKind = clouds ? "cloud" : (/\.(tif|tiff|asc)$/i.test(istName) ? "dsm" : "cloud");

  const [row] = await db
    .insert(schema.comparisons)
    .values({
      projectId: params.id,
      name,
      surveyDate: surveyDateRaw ? new Date(surveyDateRaw) : null,
      sollName,
      istName,
      sollKind,
      istKind,
      params: { ...opts, mode } as Record<string, unknown>,
      stats: result.stats as unknown as Record<string, unknown>,
      computeJobId: result.job_id,
      createdBy: (await getCurrentUser()).name,
    })
    .returning();

  return NextResponse.json({ comparison: row, result }, { status: 201 });
}
