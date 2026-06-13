/**
 * scene.json eines Vergleichs (3D-Datengrundlage).
 * Proxyt {COMPUTE}/jobs/{jobId}/scene.json und schreibt cloudUrl/meshUrl auf die
 * EIGENEN Proxy-Pfade um, damit der Browser über Gateway/basePath lädt.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { scene as fetchScene } from "@/lib/computeClient";
import { BP } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [c] = await db
    .select({ jobId: schema.comparisons.computeJobId })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!c?.jobId) {
    return NextResponse.json({ error: "Kein Compute-Job vorhanden." }, { status: 404 });
  }

  let scene;
  try {
    scene = await fetchScene(c.jobId);
  } catch (e) {
    const msg = (e as Error).message;
    // Compute 404 = noch keine 3D-Datengrundlage (z.B. Vergleich vor Einführung des
    // 3D-Viewers erstellt). Sauber als 404 melden, damit der Viewer einen Hinweis zeigt.
    if (msg.includes("Compute 404")) {
      return NextResponse.json(
        { error: "Für diesen Vergleich gibt es noch keine 3D-Daten. Vergleiche, die vor dem 3D-Viewer erstellt wurden, müssen neu gestartet werden." },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // binUrl/meshUrl (und legacy cloudUrl) auf die App-eigenen Proxy-Routen
  // umschreiben (inkl. basePath). Der Browser kennt die Compute-interne URL
  // nicht; er lädt alles über uns.
  scene.binUrl = `${BP}/api/comparisons/${params.id}/cloud.bin`;
  scene.meshUrl = `${BP}/api/comparisons/${params.id}/soll.glb`;
  if (scene.cloudUrl) scene.cloudUrl = `${BP}/api/comparisons/${params.id}/cloud/metadata.json`;

  return NextResponse.json(scene);
}
