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

// Cleanup-Ausschluss (Sperrbereiche + Höhenband) speichern.
// PATCH { exclusions: { polygons?, zMin?, zMax? } | null }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!("exclusions" in body)) {
    return NextResponse.json({ error: "Feld 'exclusions' erforderlich." }, { status: 400 });
  }
  const ex = body.exclusions;
  // Leeres/triviales Objekt -> null (kein Ausschluss).
  const clean = ex && (
    (Array.isArray(ex.polygons) && ex.polygons.length) ||
    typeof ex.zMin === "number" || typeof ex.zMax === "number"
  ) ? {
    polygons: Array.isArray(ex.polygons) ? ex.polygons : [],
    zMin: typeof ex.zMin === "number" ? ex.zMin : null,
    zMax: typeof ex.zMax === "number" ? ex.zMax : null,
  } : null;
  const [row] = await db.update(schema.comparisons)
    .set({ exclusions: clean as unknown as Record<string, unknown> })
    .where(eq(schema.comparisons.id, params.id))
    .returning();
  return NextResponse.json({ comparison: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await db.delete(schema.comparisons).where(eq(schema.comparisons.id, params.id));
  return NextResponse.json({ ok: true });
}
