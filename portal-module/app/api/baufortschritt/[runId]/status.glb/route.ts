/**
 * Proxy fuer das Status-GLB eines Baufortschritt-Laufs (Bauteile nach Status
 * eingefaerbt). Browser laedt ueber diese Route, nicht direkt vom Compute.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { statusGlbUrl } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const [run] = await db
    .select({ jobId: schema.bfRuns.computeJobId })
    .from(schema.bfRuns)
    .where(eq(schema.bfRuns.id, params.runId));
  if (!run?.jobId) return NextResponse.json({ error: "Lauf nicht gefunden." }, { status: 404 });
  const r = await fetch(statusGlbUrl(run.jobId));
  if (!r.ok) return NextResponse.json({ error: `Compute ${r.status}` }, { status: 502 });
  return new NextResponse(r.body, {
    status: 200,
    headers: { "content-type": "model/gltf-binary", "cache-control": "private, max-age=300" },
  });
}
