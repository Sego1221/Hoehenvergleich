/**
 * Soll-Mesh als GLB: {COMPUTE}/jobs/{jobId}/soll.glb.
 * Bereits um scene.offset verschoben (float32-tauglich) -> im Viewer direkt
 * einsetzbar, NICHT nochmal verschieben.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { glbUrl } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return new NextResponse("Kein Compute-Job vorhanden.", { status: 404 });
  }

  // GLB kann gross sein -> Range durchreichen (GLTFLoader nutzt meist keine,
  // aber schadet nicht).
  const range = req.headers.get("range");
  const fwd: HeadersInit = {};
  if (range) fwd["range"] = range;

  let r: Response;
  try {
    r = await fetch(glbUrl(c.jobId), { headers: fwd, cache: "no-store" });
  } catch (e) {
    return new NextResponse(`Compute nicht erreichbar: ${(e as Error).message}`, { status: 502 });
  }
  if (!r.ok && r.status !== 206) {
    return new NextResponse(await r.text().catch(() => ""), { status: r.status });
  }

  const headers = new Headers();
  headers.set("content-type", "model/gltf-binary");
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");

  return new NextResponse(r.body, { status: r.status, headers });
}
