/**
 * Einzelner Vergleich: lesen (GET, inkl. Schnitte + Bereiche), loeschen (DELETE).
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [comparison] = await db
    .select()
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!comparison) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  const sections = await db
    .select()
    .from(schema.sections)
    .where(eq(schema.sections.comparisonId, params.id));
  const regions = await db
    .select()
    .from(schema.regions)
    .where(eq(schema.regions.comparisonId, params.id));
  return NextResponse.json({ comparison, sections, regions });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await db.delete(schema.comparisons).where(eq(schema.comparisons.id, params.id));
  return NextResponse.json({ ok: true });
}
