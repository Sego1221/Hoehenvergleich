/**
 * Kennzahlen fuer eine neue Toleranz (Slider, ohne Neuberechnung).
 * GET ?tol=0.05 -> proxyt computeClient.statsForTol auf die job_id des Vergleichs.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { statsForTol } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tol = Number(req.nextUrl.searchParams.get("tol") ?? "0.05");
  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return NextResponse.json({ error: "Kein Compute-Job vorhanden." }, { status: 404 });
  }
  try {
    const stats = await statsForTol(c.jobId, tol);
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
