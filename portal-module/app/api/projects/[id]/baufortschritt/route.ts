/**
 * Baufortschritt-Laeufe eines Projekts: listen (GET) + neuen Lauf starten (POST).
 *
 * POST multipart { ifc, scan, name?, betonage?, surveyDate? }:
 *  - zieht die Strukturmodell-Georef des Projekts,
 *  - ruft den Compute-Service (Status je Bauteil + Status-GLB),
 *  - speichert den Lauf (bf_runs) und liefert ihn zurueck.
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { bauteilEvaluate } from "@/lib/computeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rows = await db
    .select()
    .from(schema.bfRuns)
    .where(eq(schema.bfRuns.projectId, params.id))
    .orderBy(desc(schema.bfRuns.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, params.id));
  if (!project) return NextResponse.json({ error: "Projekt nicht gefunden." }, { status: 404 });
  const tf = project.structureTransform as { tE: number; tN: number; tH: number; angleDeg: number } | null;
  if (!tf) {
    return NextResponse.json(
      { error: "Keine Strukturmodell-Georef hinterlegt (Verwaltung → Projekt bearbeiten)." },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  const ifc = form?.get("ifc");
  const scan = form?.get("scan");
  if (!(ifc instanceof Blob) || !(scan instanceof Blob)) {
    return NextResponse.json({ error: "Felder 'ifc' und 'scan' erforderlich." }, { status: 400 });
  }
  const ifcName = (ifc as File).name ?? "modell.ifc";
  const scanName = (scan as File).name ?? "scan.laz";
  const name = String(form?.get("name") ?? "").trim() || ifcName.replace(/\.[^.]+$/, "");
  const betonage = String(form?.get("betonage") ?? "").trim() || null;
  const surveyDate = String(form?.get("surveyDate") ?? "").trim();

  let result;
  try {
    result = await bauteilEvaluate(ifc, ifcName, scan, scanName, tf);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  if (result.transform_warning) {
    return NextResponse.json(
      { error: "Strukturmodell liegt nicht in der Wolke (Georef prüfen — Vorzeichen/Werte)." },
      { status: 422 },
    );
  }

  const [row] = await db
    .insert(schema.bfRuns)
    .values({
      projectId: params.id,
      name,
      betonage,
      ifcName,
      scanName,
      surveyDate: surveyDate ? new Date(surveyDate) : null,
      computeJobId: result.job_id,
      summary: result.summary as unknown as Record<string, unknown>,
      elements: result.elements as unknown as Record<string, unknown>,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
