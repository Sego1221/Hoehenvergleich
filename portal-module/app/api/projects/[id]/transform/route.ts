/**
 * Georef-Transformation pro Projekt: aktuelle lesen (GET) / speichern (PUT).
 * Konvention: LV95 = Rz(-angle) * (lokal - T), T = (tE, tN, tH), Massstab 1.
 * Es wird je Projekt der zuletzt gespeicherte Datensatz als "aktuell" gefuehrt.
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [row] = await db
    .select()
    .from(schema.projectTransforms)
    .where(eq(schema.projectTransforms.projectId, params.id))
    .orderBy(desc(schema.projectTransforms.createdAt))
    .limit(1);
  return NextResponse.json(row ?? null);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const tE = num(b?.tE), tN = num(b?.tN), tH = num(b?.tH);
  const angleDeg = num(b?.angleDeg ?? 0);
  const unit = b?.unit === "mm" ? "mm" : "m";
  const label = typeof b?.label === "string" && b.label.trim() ? b.label.trim() : "Standard";

  for (const [k, v] of Object.entries({ tE, tN, tH, angleDeg })) {
    if (!Number.isFinite(v)) {
      return NextResponse.json({ error: `Ungueltiger Wert: ${k}` }, { status: 400 });
    }
  }

  const [row] = await db
    .insert(schema.projectTransforms)
    .values({ projectId: params.id, label, tE, tN, tH, angleDeg, unit })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
