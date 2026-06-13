/**
 * Baufortschritt-Modell-Katalog eines Projekts: lesen (GET) + anlegen/ergaenzen
 * (POST multipart { ifcs[] }). Nutzt die gemeinsame Projekt-Georef (forward).
 * Die Geometrie liegt auf dem Compute-Volume (computeModelId); hier nur Katalog.
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { bauteilModel } from "@/lib/computeClient";
import { forwardTransform } from "@/lib/transform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [m] = await db.select().from(schema.bfModel)
    .where(eq(schema.bfModel.projectId, params.id))
    .orderBy(desc(schema.bfModel.updatedAt)).limit(1);
  return NextResponse.json(m ?? null);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const [trow] = await db.select().from(schema.projectTransforms)
    .where(eq(schema.projectTransforms.projectId, params.id))
    .orderBy(desc(schema.projectTransforms.createdAt)).limit(1);
  if (!trow) {
    return NextResponse.json({ error: "Keine Georef-Transformation hinterlegt (Verwaltung)." }, { status: 400 });
  }
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("ifcs") ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Mindestens ein IFC erforderlich." }, { status: 400 });
  }

  const [existing] = await db.select().from(schema.bfModel)
    .where(eq(schema.bfModel.projectId, params.id))
    .orderBy(desc(schema.bfModel.updatedAt)).limit(1);

  let result;
  try {
    result = await bauteilModel(
      files.map((f) => ({ blob: f, name: f.name })),
      forwardTransform(trow),
      existing?.computeModelId,
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const ifcNames = [...new Set([...(existing?.ifcNames as string[] | null ?? []), ...files.map((f) => f.name)])];
  const values = {
    projectId: params.id,
    computeModelId: result.model_id,
    nElements: result.n_elements,
    betonagen: result.betonagen as unknown as Record<string, unknown>,
    elements: result.elements as unknown as Record<string, unknown>,
    ifcNames: ifcNames as unknown as Record<string, unknown>,
    updatedAt: new Date(),
  };
  let row;
  if (existing) {
    [row] = await db.update(schema.bfModel).set(values).where(eq(schema.bfModel.id, existing.id)).returning();
  } else {
    [row] = await db.insert(schema.bfModel).values(values).returning();
  }
  return NextResponse.json(row, { status: 201 });
}
