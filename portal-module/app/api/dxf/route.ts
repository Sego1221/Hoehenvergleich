/**
 * DXF-Upload -> geschlossene Polylinien (fuer Bauperimeter/Bereiche).
 * Proxyt die Datei serverseitig an den (internen) Compute-Service.
 *
 * POST multipart { file: <dxf> } -> { polylines: [...] }
 */
import { NextRequest, NextResponse } from "next/server";
import { dxfPolylines } from "@/lib/computeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Feld 'file' (DXF) erforderlich." }, { status: 400 });
  }
  const name = (file as File).name ?? "upload.dxf";
  try {
    const data = await dxfPolylines(file, name);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
