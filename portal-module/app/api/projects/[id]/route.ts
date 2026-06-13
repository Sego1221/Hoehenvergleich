/**
 * Einzelnes Projekt: lesen (GET), aktualisieren (PATCH), loeschen (DELETE).
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [row] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, params.id));
  if (!row) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string") patch.name = body.name.trim();
  if (typeof body?.notes === "string") patch.notes = body.notes;
  // Bauperimeter setzen/loeschen. perimeter = Liste von Polygonen [[ [E,N],... ],...].
  if ("perimeter" in body) {
    const p = body.perimeter;
    if (p === null) { patch.perimeter = null; patch.perimeterParcels = null; }
    else if (Array.isArray(p)) {
      patch.perimeter = p;
      if (Array.isArray(body.perimeterParcels)) patch.perimeterParcels = body.perimeterParcels;
    } else {
      return NextResponse.json({ error: "perimeter muss eine Polygon-Liste oder null sein." }, { status: 400 });
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nichts zu aendern." }, { status: 400 });
  }
  const [row] = await db
    .update(schema.projects)
    .set(patch)
    .where(eq(schema.projects.id, params.id))
    .returning();
  if (!row) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await db.delete(schema.projects).where(eq(schema.projects.id, params.id));
  return NextResponse.json({ ok: true });
}
