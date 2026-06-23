/**
 * Referenz-Wolke A als Binärblock (nur bei Wolke-gegen-Wolke):
 * {COMPUTE}/jobs/{jobId}/cloudA.bin. Gleiches v2-Format wie cloud.bin, um
 * denselben scene.offset verschoben (Ausrichtung mit Wolke B). Stream-Proxy.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cloudBinAUrl } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return new NextResponse("Kein Compute-Job vorhanden.", { status: 404 });
  }

  let r: Response;
  try {
    r = await fetch(cloudBinAUrl(c.jobId), { cache: "no-store" });
  } catch (e) {
    return new NextResponse(`Compute nicht erreichbar: ${(e as Error).message}`, { status: 502 });
  }
  if (!r.ok) {
    return new NextResponse(await r.text().catch(() => ""), { status: r.status });
  }

  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  const len = r.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("cache-control", "private, max-age=3600");
  return new NextResponse(r.body, { status: 200, headers });
}
