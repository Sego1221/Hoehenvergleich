/**
 * Bereiche (Polygone) eines Vergleichs: listen (GET), Volumen berechnen +
 * speichern (POST), loeschen (DELETE ?regionId=...).
 *
 * POST { polygon, tol?, name?, save? }: ruft computeClient.volume und liefert
 * Cut/Fill der Auswahl; bei save=true wird der Bereich inkl. volumes persistiert.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { volume } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rows = await db
    .select()
    .from(schema.regions)
    .where(eq(schema.regions.comparisonId, params.id));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const polygon = b?.polygon as [number, number][] | undefined;
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return NextResponse.json({ error: "Polygon mit mind. 3 Punkten erforderlich." }, { status: 400 });
  }
  const tol = typeof b?.tol === "number" ? b.tol : 0.05;

  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return NextResponse.json({ error: "Kein Compute-Job vorhanden." }, { status: 404 });
  }

  let volumes;
  try {
    volumes = await volume(c.jobId, polygon, tol);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  let saved = null;
  if (b?.save) {
    [saved] = await db
      .insert(schema.regions)
      .values({
        comparisonId: params.id,
        name: String(b?.name ?? "Bereich"),
        polygon: polygon as unknown as Record<string, unknown>,
        volumes: volumes as unknown as Record<string, unknown>,
      })
      .returning();
  }

  return NextResponse.json({ volumes, region: saved });
}

export async function DELETE(req: NextRequest) {
  const regionId = req.nextUrl.searchParams.get("regionId");
  if (!regionId) return NextResponse.json({ error: "regionId fehlt." }, { status: 400 });
  await db.delete(schema.regions).where(eq(schema.regions.id, regionId));
  return NextResponse.json({ ok: true });
}
