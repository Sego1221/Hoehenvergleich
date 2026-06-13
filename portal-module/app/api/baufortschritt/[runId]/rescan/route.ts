/**
 * Bestehende Auswertung wiederholen: gespeicherte Scan-Wolke gegen den aktuellen
 * Katalog + aktuelle Projekt-Georef neu auswerten und den Lauf aktualisieren.
 * POST /api/baufortschritt/[runId]/rescan
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { bauteilRescan } from "@/lib/computeClient";
import { forwardTransform } from "@/lib/transform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const [run] = await db.select().from(schema.bfRuns).where(eq(schema.bfRuns.id, params.runId));
  if (!run?.computeJobId) return NextResponse.json({ error: "Lauf nicht gefunden." }, { status: 404 });
  const [model] = await db.select().from(schema.bfModel)
    .where(eq(schema.bfModel.projectId, run.projectId)).orderBy(desc(schema.bfModel.updatedAt)).limit(1);
  if (!model) return NextResponse.json({ error: "Kein Modell-Katalog vorhanden." }, { status: 400 });
  const [trow] = await db.select().from(schema.projectTransforms)
    .where(eq(schema.projectTransforms.projectId, run.projectId))
    .orderBy(desc(schema.projectTransforms.createdAt)).limit(1);
  if (!trow) return NextResponse.json({ error: "Keine Georef-Transformation hinterlegt." }, { status: 400 });

  let result;
  try {
    result = await bauteilRescan(model.computeModelId, run.computeJobId, forwardTransform(trow));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  if (result.transform_warning) {
    return NextResponse.json({ error: "Modell liegt nicht in der Wolke (Georef prüfen)." }, { status: 422 });
  }
  const [row] = await db.update(schema.bfRuns).set({
    summary: result.summary as unknown as Record<string, unknown>,
    elements: result.elements as unknown as Record<string, unknown>,
    offset: (result.offset ?? null) as unknown as Record<string, unknown>,
  }).where(eq(schema.bfRuns.id, params.runId)).returning();
  return NextResponse.json(row);
}
