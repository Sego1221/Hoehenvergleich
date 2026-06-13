/**
 * Parzellen-Abfrage aus der amtlichen Vermessung (schweizweit) — On-Demand,
 * serverseitig gegen geo.admin.ch (kein CORS, keine Registrierung, kein Bulk).
 *
 * GET /api/cadastral/parcel?e=<E>&n=<N>   (LV95-Koordinaten)
 *  -> { egrid, number, ak, polygon: [[E,N], ...] }   (aeusserer Ring, LV95)
 *
 * Wir speichern NICHTS schweizweit; der Aufrufer (Viewer) uebernimmt das
 * gewaehlte Polygon als Projekt-Perimeter (Snapshot). Parzellen mutieren —
 * der EGRID erlaubt spaetere Nachfuehrung.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDENTIFY = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
const LAYER = "ch.kantone.cadastralwebmap-farbe";

type GeoJsonPolygon = { type: "Polygon"; coordinates: number[][][] };
type GeoJsonMulti = { type: "MultiPolygon"; coordinates: number[][][][] };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const e = Number(sp.get("e"));
  const n = Number(sp.get("n"));
  if (!Number.isFinite(e) || !Number.isFinite(n)) {
    return NextResponse.json({ error: "e und n (LV95) erforderlich." }, { status: 400 });
  }

  // Identify benoetigt mapExtent + imageDisplay; kleines Fenster um den Punkt reicht.
  const q = new URLSearchParams({
    geometry: `${e},${n}`,
    geometryType: "esriGeometryPoint",
    geometryFormat: "geojson",
    sr: "2056",
    layers: `all:${LAYER}`,
    tolerance: "2",
    mapExtent: `${e - 50},${n - 50},${e + 50},${n + 50}`,
    imageDisplay: "200,200,96",
    returnGeometry: "true",
  });

  let json: { results?: Array<{ geometry?: GeoJsonPolygon | GeoJsonMulti; properties?: Record<string, unknown> }> };
  try {
    const r = await fetch(`${IDENTIFY}?${q.toString()}`, { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json({ error: `Vermessungsdienst antwortete ${r.status}.` }, { status: 502 });
    }
    json = await r.json();
  } catch (err) {
    return NextResponse.json(
      { error: "Vermessungsdienst nicht erreichbar.", detail: String((err as Error)?.message || err) },
      { status: 502 },
    );
  }

  const hit = json.results?.[0];
  if (!hit?.geometry) {
    return NextResponse.json({ error: "Keine Parzelle an dieser Stelle gefunden." }, { status: 404 });
  }

  // Aeusseren Ring extrahieren (Polygon: erster Ring; MultiPolygon: groesster Ring).
  let ring: number[][] | null = null;
  if (hit.geometry.type === "Polygon") {
    ring = hit.geometry.coordinates[0] ?? null;
  } else if (hit.geometry.type === "MultiPolygon") {
    let best: number[][] | null = null;
    for (const poly of hit.geometry.coordinates) {
      const r0 = poly[0];
      if (r0 && (!best || r0.length > best.length)) best = r0;
    }
    ring = best;
  }
  if (!ring || ring.length < 3) {
    return NextResponse.json({ error: "Parzellengeometrie unvollstaendig." }, { status: 502 });
  }

  const polygon: [number, number][] = ring.map((p) => [p[0], p[1]]);
  const props = hit.properties ?? {};
  return NextResponse.json({
    egrid: (props.egris_egrid as string) ?? null,
    number: (props.number as string) ?? null,
    ak: (props.ak as string) ?? null,
    polygon,
  });
}
