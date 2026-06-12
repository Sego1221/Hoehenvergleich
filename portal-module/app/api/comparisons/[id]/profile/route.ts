/**
 * Schnitt-Profil entlang Polylinie [[E,N],...] (LV95).
 * POST { line, step? } -> computeClient.profile auf job_id des Vergleichs.
 * Optional { save: true, name, kind } speichert die Schnittlinie zusaetzlich.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { profile } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const line = body?.line as [number, number][] | undefined;
  if (!Array.isArray(line) || line.length < 2) {
    return NextResponse.json({ error: "Linie mit mind. 2 Punkten erforderlich." }, { status: 400 });
  }
  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return NextResponse.json({ error: "Kein Compute-Job vorhanden." }, { status: 404 });
  }

  let result;
  try {
    result = await profile(c.jobId, line, body?.step);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  let saved = null;
  if (body?.save) {
    [saved] = await db
      .insert(schema.sections)
      .values({
        comparisonId: params.id,
        name: String(body?.name ?? "Schnitt"),
        kind: body?.kind ?? "frei",
        line: line as unknown as Record<string, unknown>,
      })
      .returning();
  }

  return NextResponse.json({ profile: result, section: saved });
}
