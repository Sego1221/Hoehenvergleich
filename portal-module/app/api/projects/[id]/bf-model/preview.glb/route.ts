/**
 * Proxy: GLB des ganzen Modell-Katalogs (Kontroll-Ansicht, IFC-Farben).
 * GET /api/projects/[id]/bf-model/preview.glb
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { modelPreviewGlbUrl } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [m] = await db.select({ cid: schema.bfModel.computeModelId })
    .from(schema.bfModel).where(eq(schema.bfModel.projectId, params.id))
    .orderBy(desc(schema.bfModel.updatedAt)).limit(1);
  if (!m?.cid) return NextResponse.json({ error: "Kein Modell." }, { status: 404 });
  const r = await fetch(modelPreviewGlbUrl(m.cid));
  if (!r.ok) return NextResponse.json({ error: `Compute ${r.status}` }, { status: 502 });
  return new NextResponse(r.body, {
    status: 200,
    headers: { "content-type": "model/gltf-binary", "cache-control": "private, max-age=60" },
  });
}
