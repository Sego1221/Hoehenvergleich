"use client";
/**
 * Leaflet-Karte (EPSG:2056 / LV95) zum Festlegen des PROJEKT-Bauperimeters —
 * unabhaengig von einem Vergleich. Swisstopo SWISSIMAGE als Basiskarte.
 *
 * Modi:
 *  - "parcel": Klick auf eine Parzelle -> onPick(E,N) (Aufrufer holt die Grenze
 *    aus der amtlichen Vermessung),
 *  - "draw":  Punkte klicken, Doppelklick schliesst -> onDrawn([[E,N],...]),
 *  - "view":  nur ansehen.
 * Bereits gesetzte Perimeter-Polygone werden orange gezeichnet.
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type PMapMode = "view" | "parcel" | "draw";

type Props = {
  perimeter: [number, number][][];
  mode: PMapMode;
  onPick: (e: number, n: number) => void;
  onDrawn: (pts: [number, number][]) => void;
};

const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250,
  1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];

export default function PerimeterMap(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const draftRef = useRef<[number, number][]>([]);
  const modeRef = useRef<PMapMode>(props.mode);
  const onPickRef = useRef(props.onPick);
  const onDrawnRef = useRef(props.onDrawn);
  const perimRef = useRef(props.perimeter);
  const [ready, setReady] = useState(false);

  onPickRef.current = props.onPick;
  onDrawnRef.current = props.onDrawn;
  perimRef.current = props.perimeter;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const proj4 = (await import("proj4")).default;
      await import("proj4leaflet");
      if (cancelled || !ref.current || mapRef.current) return;

      proj4.defs(
        "EPSG:2056",
        "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 " +
        "+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel " +
        "+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs",
      );
      const crs = new (L as any).Proj.CRS("EPSG:2056", proj4.defs("EPSG:2056"), {
        resolutions: RESOLUTIONS,
        origin: [2420000, 1350000],
        bounds: (L as any).bounds([2420000, 1030000], [2900000, 1350000]),
      });

      const map = L.map(ref.current, { crs, minZoom: 14, maxZoom: 28, doubleClickZoom: false });
      mapRef.current = map;

      L.tileLayer(
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/2056/{z}/{x}/{y}.jpeg",
        { attribution: "© swisstopo", maxNativeZoom: 28, minNativeZoom: 14 } as any,
      ).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);

      // Auf vorhandenen Perimeter zoomen, sonst Aarau-Region (Birchmeier).
      const p = perimRef.current;
      if (p.length) {
        const all = p.flat();
        const es = all.map((c) => c[0]); const ns = all.map((c) => c[1]);
        map.fitBounds([[Math.min(...ns), Math.min(...es)], [Math.max(...ns), Math.max(...es)]] as any, { padding: [20, 20] });
      } else {
        map.setView([1247000, 2660000] as any, 16);
      }

      map.on("click", (e: any) => {
        const E = e.latlng.lng, N = e.latlng.lat; // lng=E, lat=N
        if (modeRef.current === "parcel") {
          onPickRef.current(E, N);
        } else if (modeRef.current === "draw") {
          draftRef.current = [...draftRef.current, [E, N]];
          redraw(L);
        }
      });
      map.on("dblclick", (e: any) => {
        L.DomEvent.stop(e);
        if (modeRef.current === "draw" && draftRef.current.length >= 3) {
          onDrawnRef.current(draftRef.current);
          draftRef.current = [];
          redraw(L);
        }
      });

      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { modeRef.current = props.mode; draftRef.current = []; void redrawAsync(); }, [props.mode]); // eslint-disable-line
  useEffect(() => { void redrawAsync(); }, [props.perimeter, ready]); // eslint-disable-line

  async function redrawAsync() {
    const L = (await import("leaflet")).default;
    redraw(L);
  }

  function redraw(L: any) {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    // Gespeicherte/aktuelle Perimeter-Polygone (orange).
    for (const poly of perimRef.current) {
      L.polygon(poly.map(([e, n]) => [n, e]) as any, {
        color: "#ff8c1a", weight: 2, fillOpacity: 0.12,
      }).addTo(layer);
    }
    // Aktueller Zeichen-Entwurf.
    const d = draftRef.current;
    if (d.length) {
      const pts = d.map(([e, n]) => [n, e]);
      L.polygon(pts as any, { color: "#ff8c1a", weight: 2, dashArray: "4 4", fillOpacity: 0.05 }).addTo(layer);
      pts.forEach((p) => L.circleMarker(p as any, { radius: 3, color: "#fff" }).addTo(layer));
    }
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", position: "relative" }}>
      <div ref={ref} style={{ width: "100%", height: 460, cursor: props.mode === "view" ? "grab" : "crosshair" }} />
    </div>
  );
}
