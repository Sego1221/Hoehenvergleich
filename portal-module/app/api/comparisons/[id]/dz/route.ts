/**
 * Proxy fuer das DZ-Overlay des Compute-Service, damit der Browser nicht direkt
 * auf den (intern erreichbaren) Compute-Service zugreifen muss.
 *
 * GET ?fmt=tif        -> GeoTIFF (fuer georaster-layer-for-leaflet)
 * GET ?fmt=png&tol=.. -> Vorschau-PNG (Fallback)
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchDz } from "@/lib/computeClient";
import { perimeterForComparison } from "@/lib/perimeter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const fmt = (req.nextUrl.searchParams.get("fmt") ?? "tif") === "png" ? "png" : "tif";
  const tol = Number(req.nextUrl.searchParams.get("tol") ?? "0.05");
  const clip = Number(req.nextUrl.searchParams.get("clip") ?? "0") || undefined;
  const full = req.nextUrl.searchParams.get("full") === "1";

  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return NextResponse.json({ error: "Kein Compute-Job vorhanden." }, { status: 404 });
  }

  const perimeter = full ? null : await perimeterForComparison(params.id);
  const r = await fetchDz(c.jobId, fmt, tol, perimeter, clip);
  if (!r.ok) {
    return NextResponse.json({ error: `Compute ${r.status}` }, { status: 502 });
  }
  const ct = r.headers.get("content-type") ?? (fmt === "png" ? "image/png" : "image/tiff");
  return new NextResponse(r.body, {
    status: 200,
    headers: { "content-type": ct, "cache-control": "private, max-age=60" },
  });
}
