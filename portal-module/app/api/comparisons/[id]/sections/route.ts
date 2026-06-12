/**
 * Gespeicherte Schnittlinien eines Vergleichs: listen (GET), speichern (POST),
 * loeschen (DELETE ?sectionId=...).
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rows = await db
    .select()
    .from(schema.sections)
    .where(eq(schema.sections.comparisonId, params.id));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const line = b?.line as [number, number][] | undefined;
  if (!Array.isArray(line) || line.length < 2) {
    return NextResponse.json({ error: "Linie mit mind. 2 Punkten erforderlich." }, { status: 400 });
  }
  const [row] = await db
    .insert(schema.sections)
    .values({
      comparisonId: params.id,
      name: String(b?.name ?? "Schnitt"),
      kind: b?.kind ?? "frei",
      line: line as unknown as Record<string, unknown>,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const sectionId = req.nextUrl.searchParams.get("sectionId");
  if (!sectionId) return NextResponse.json({ error: "sectionId fehlt." }, { status: 400 });
  await db.delete(schema.sections).where(eq(schema.sections.id, sectionId));
  return NextResponse.json({ ok: true });
}
