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
import { bauteilScan } from "@/lib/computeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rows = await db
    .select()
    .from(schema.bfRuns)
    .where(eq(schema.bfRuns.projectId, params.id))
    .orderBy(desc(schema.bfRuns.surveyDate), desc(schema.bfRuns.createdAt));
  return NextResponse.json(rows);
}

// Tages-Scan gegen den Modell-Katalog des Projekts auswerten.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const [model] = await db.select().from(schema.bfModel)
    .where(eq(schema.bfModel.projectId, params.id))
    .orderBy(desc(schema.bfModel.updatedAt)).limit(1);
  if (!model) {
    return NextResponse.json(
      { error: "Kein Modell-Katalog vorhanden — zuerst Etappen-IFCs hochladen." },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  const scan = form?.get("scan");
  if (!(scan instanceof Blob)) {
    return NextResponse.json({ error: "Feld 'scan' (LAZ/LAS) erforderlich." }, { status: 400 });
  }
  const scanName = (scan as File).name ?? "scan.laz";
  const surveyDate = String(form?.get("surveyDate") ?? "").trim();
  const name = String(form?.get("name") ?? "").trim() || (surveyDate || scanName);

  let result;
  try {
    result = await bauteilScan(model.computeModelId, scan, scanName);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  if (result.transform_warning) {
    return NextResponse.json(
      { error: "Modell liegt nicht in der Wolke (Georef prüfen — Vorzeichen/Werte)." },
      { status: 422 },
    );
  }

  const [row] = await db
    .insert(schema.bfRuns)
    .values({
      projectId: params.id,
      name,
      scanName,
      surveyDate: surveyDate ? new Date(surveyDate) : null,
      computeJobId: result.job_id,
      summary: result.summary as unknown as Record<string, unknown>,
      elements: result.elements as unknown as Record<string, unknown>,
      offset: (result.offset ?? null) as unknown as Record<string, unknown>,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
