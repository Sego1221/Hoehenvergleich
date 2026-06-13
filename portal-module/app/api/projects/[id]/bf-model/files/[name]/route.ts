/**
 * Eine einzelne Etappen-IFC entfernen + Katalog neu aufbauen.
 * DELETE /api/projects/[id]/bf-model/files/<name>
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { bauteilModelDeleteFile } from "@/lib/computeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; name: string } }) {
  const [m] = await db.select().from(schema.bfModel)
    .where(eq(schema.bfModel.projectId, params.id))
    .orderBy(desc(schema.bfModel.updatedAt)).limit(1);
  if (!m) return NextResponse.json({ error: "Kein Modell vorhanden." }, { status: 404 });
  let res;
  try { res = await bauteilModelDeleteFile(m.computeModelId, params.name); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }

  const ifcNames = (res.files ?? []).map((f) => f.name);
  const ifcColors: Record<string, [number, number, number]> = {};
  for (const e of res.elements ?? []) if (e.guid && e.color) ifcColors[e.guid] = e.color;
  const [row] = await db.update(schema.bfModel).set({
    nElements: res.n_elements,
    betonagen: res.betonagen as unknown as Record<string, unknown>,
    elements: res.elements as unknown as Record<string, unknown>,
    ifcNames: ifcNames as unknown as Record<string, unknown>,
    files: (res.files ?? []) as unknown as Record<string, unknown>,
    ifcColors: ifcColors as unknown as Record<string, unknown>,
    offset: (res.offset ?? null) as unknown as Record<string, unknown>,
    updatedAt: new Date(),
  }).where(eq(schema.bfModel.id, m.id)).returning();
  return NextResponse.json(row);
}
