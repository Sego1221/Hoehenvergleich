/**
 * Potree-2.0-Octree-Proxy: {COMPUTE}/jobs/{jobId}/cloud/{path}
 * (metadata.json / hierarchy.bin / octree.bin).
 *
 * WICHTIG: Potree lädt octree.bin/hierarchy.bin per HTTP-Range. Der Range-Header
 * MUSS an den Compute durchgereicht und die 206-Antwort inkl.
 * Content-Range/Accept-Ranges/Content-Length unverändert zurückgegeben werden —
 * sonst lädt im Viewer nichts.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cloudUrl } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; path: string[] } },
) {
  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return new NextResponse("Kein Compute-Job vorhanden.", { status: 404 });
  }

  // Pfad-Traversal absichern, dann Compute-URL bauen.
  const rel = (params.path ?? []).join("/").replace(/\.\.(\/|\\|$)/g, "");
  const upstream = cloudUrl(c.jobId, rel);

  // Range-Header durchreichen (Potree fragt Byte-Ranges an).
  const range = req.headers.get("range");
  const fwd: HeadersInit = {};
  if (range) fwd["range"] = range;

  let r: Response;
  try {
    r = await fetch(upstream, { headers: fwd, cache: "no-store" });
  } catch (e) {
    return new NextResponse(`Compute nicht erreichbar: ${(e as Error).message}`, { status: 502 });
  }

  if (!r.ok && r.status !== 206) {
    return new NextResponse(await r.text().catch(() => ""), { status: r.status });
  }

  // Range-relevante Header 1:1 spiegeln.
  const headers = new Headers();
  const pass = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ];
  for (const h of pass) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", rel.endsWith(".json") ? "application/json" : "application/octet-stream");
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  // Octree-Artefakte sind unveränderlich pro Job -> aggressiv cachebar.
  headers.set("cache-control", "private, max-age=3600");

  // Body als Stream durchreichen (octree.bin kann gross sein).
  return new NextResponse(r.body, { status: r.status, headers });
}
