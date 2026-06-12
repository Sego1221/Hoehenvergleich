/**
 * Vergleichs-Historie eines Projekts: listen (GET) und neuen Vergleich
 * starten (POST, multipart/form-data: Soll + Ist + Parameter).
 *
 * POST: laedt Soll (IFC/TIN) + Ist (LAZ/LAS/DSM-GeoTIFF) hoch, ruft den
 * Compute-Service (computeClient.compare) und persistiert die comparison-Zeile
 * inkl. stats (= Historie).
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { compare, type Transform } from "@/lib/computeClient";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
// Grosse Uploads (LAZ/DSM): kein Body-Limit erzwingen, Streaming via FormData.
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
  const form = await req.formData();
  const soll = form.get("soll");
  const ist = form.get("ist") ?? form.get("cloud");
  if (!(soll instanceof File) || !(ist instanceof File)) {
    return NextResponse.json(
      { error: "Soll- und Ist-Datei erforderlich." },
      { status: 400 },
    );
  }

  const name = String(form.get("name") ?? "").trim() || `Vergleich ${new Date().toLocaleDateString("de-CH")}`;
  const surveyDateRaw = String(form.get("surveyDate") ?? "").trim();
  const numOrUndef = (k: string) => {
    const v = form.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const boolOrUndef = (k: string) => {
    const v = form.get(k);
    if (v === null || v === "") return undefined;
    return v === "true" || v === "1";
  };

  let transform: Transform | undefined;
  const tRaw = form.get("transform");
  if (typeof tRaw === "string" && tRaw.trim()) {
    try {
      const t = JSON.parse(tRaw);
      transform = { tE: t.tE, tN: t.tN, tH: t.tH, angle_deg: t.angleDeg ?? t.angle_deg ?? 0 };
    } catch {
      return NextResponse.json({ error: "Transform-JSON ungueltig." }, { status: 400 });
    }
  }

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
    result = await compare(soll, soll.name, ist, ist.name, opts);
  } catch (e) {
    return NextResponse.json(
      { error: `Compute-Service-Fehler: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const sollKind = /\.ifc$/i.test(soll.name) ? "ifc" : "mesh";
  const istKind = /\.(tif|tiff|asc)$/i.test(ist.name) ? "dsm" : "cloud";

  const [row] = await db
    .insert(schema.comparisons)
    .values({
      projectId: params.id,
      name,
      surveyDate: surveyDateRaw ? new Date(surveyDateRaw) : null,
      sollName: soll.name,
      istName: ist.name,
      sollKind,
      istKind,
      params: opts as Record<string, unknown>,
      stats: result.stats as unknown as Record<string, unknown>,
      computeJobId: result.job_id,
      createdBy: (await getCurrentUser()).name,
    })
    .returning();

  return NextResponse.json({ comparison: row, result }, { status: 201 });
}
