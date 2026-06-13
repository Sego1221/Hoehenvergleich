/**
 * Baufortschritt-Lauf bearbeiten: manuelle Status-Korrekturen speichern.
 * PATCH { overrides: { [guid]: status } } -> effektiver Status = override ?? auto.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["gebaut", "nicht_gebaut", "verdeckt", "nicht_erfasst"]);

export async function PATCH(req: NextRequest, { params }: { params: { runId: string } }) {
  const body = await req.json().catch(() => ({}));
  const ov = body?.overrides;
  if (ov === null) {
    const [row] = await db.update(schema.bfRuns).set({ overrides: null })
      .where(eq(schema.bfRuns.id, params.runId)).returning();
    return NextResponse.json(row ?? {});
  }
  if (typeof ov !== "object") {
    return NextResponse.json({ error: "overrides muss ein Objekt {guid:status} sein." }, { status: 400 });
  }
  // Nur erlaubte Status-Werte uebernehmen.
  const clean: Record<string, string> = {};
  for (const [g, s] of Object.entries(ov as Record<string, unknown>)) {
    if (typeof s === "string" && ALLOWED.has(s)) clean[g] = s;
  }
  const [row] = await db.update(schema.bfRuns)
    .set({ overrides: clean as unknown as Record<string, unknown> })
    .where(eq(schema.bfRuns.id, params.runId)).returning();
  if (!row) return NextResponse.json({ error: "Lauf nicht gefunden." }, { status: 404 });
  return NextResponse.json(row);
}
