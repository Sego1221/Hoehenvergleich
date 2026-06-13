/**
 * Punktwolke als Binärblock: {COMPUTE}/jobs/{jobId}/cloud.bin.
 *
 * Format (little-endian): uint32 count M; dann M*3 float32 Positionen
 * (RELATIV zum scene.offset, float32-tauglich); dann M*3 uint8 RGB
 * (bereits nach ΔZ eingefärbt, RdYlBu_r, clip ±0.30).
 *
 * Diese Route reicht den Body als Stream durch (kein Range nötig — die Datei
 * wird im Viewer komplett geladen und einmal geparst).
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cloudBinUrl } from "@/lib/computeClient";

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
    r = await fetch(cloudBinUrl(c.jobId), { cache: "no-store" });
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

  // Body als Stream durchreichen (cloud.bin kann gross sein).
  return new NextResponse(r.body, { status: 200, headers });
}
