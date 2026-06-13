"use client";
/**
 * Weltweite Luftbild-Karte (Esri World Imagery, Web-Mercator) zum Festlegen des
 * PROJEKT-Bauperimeters. Nicht auf die Schweiz begrenzt — beliebig zoom-/
 * verschiebbar. Eingaben/Anzeige laufen in LV95; Umrechnung via proj4:
 *   [E,N] (LV95) <-> [lng,lat] (WGS84).
 *
 * Modi: "parcel" (Klick -> onPick(E,N)), "draw" (Punkte, Doppelklick schliesst
 * -> onDrawn), "view".
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { dissolvePerimeter } from "@/lib/geom";
import { BASEMAPS, type BaseId } from "@/lib/basemaps";

export type PMapMode = "view" | "parcel" | "draw";

type Props = {
  perimeter: [number, number][][];
  mode: PMapMode;
  onPick: (e: number, n: number) => void;
  onDrawn: (pts: [number, number][]) => void;
  focus?: { e: number; n: number } | null;
  mapHeight?: number;
};

const LV95 =
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 " +
  "+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel " +
  "+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs";

export default function PerimeterMap(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const Lref = useRef<any>(null);
  const proj4Ref = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const draftRef = useRef<[number, number][]>([]); // LV95 [E,N]
  const modeRef = useRef<PMapMode>(props.mode);
  const onPickRef = useRef(props.onPick);
  const onDrawnRef = useRef(props.onDrawn);
  const perimRef = useRef(props.perimeter);
  const baseLayersRef = useRef<Record<BaseId, any> | null>(null);
  const baseRef = useRef<BaseId>("ortho");
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<BaseId>("ortho");

  onPickRef.current = props.onPick;
  onDrawnRef.current = props.onDrawn;
  perimRef.current = props.perimeter;

  // LV95 <-> WGS84-LatLng.
  function enToLatLng(e: number, n: number): any {
    const [lng, lat] = proj4Ref.current("EPSG:2056", "WGS84", [e, n]);
    return Lref.current.latLng(lat, lng);
  }
  function latlngToEn(latlng: any): [number, number] {
    const [e, n] = proj4Ref.current("WGS84", "EPSG:2056", [latlng.lng, latlng.lat]);
    return [e, n];
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const proj4 = (await import("proj4")).default;
      if (cancelled || !ref.current || mapRef.current) return;
      Lref.current = L;
      proj4.defs("EPSG:2056", LV95);
      proj4Ref.current = proj4;

      // Standard-Web-Mercator-CRS (weltweit).
      const map = L.map(ref.current, { minZoom: 2, maxZoom: 21, doubleClickZoom: false, worldCopyJump: true });
      mapRef.current = map;

      // Basiskarten: Ortho (Esri) + Karte (MapTiler/OSM), umschaltbar.
      const mk = (id: BaseId) => L.tileLayer(BASEMAPS[id].url,
        { attribution: BASEMAPS[id].attribution, maxNativeZoom: BASEMAPS[id].maxNativeZoom, maxZoom: 21 } as any);
      baseLayersRef.current = { ortho: mk("ortho"), karte: mk("karte") };
      baseLayersRef.current[baseRef.current].addTo(map);

      layerRef.current = L.layerGroup().addTo(map);

      if (perimRef.current.length) fitPerimeter();
      else map.setView([47.567, 8.253], 16); // Döttingen (Default)

      map.on("click", (e: any) => {
        const [E, N] = latlngToEn(e.latlng);
        if (modeRef.current === "parcel") onPickRef.current(E, N);
        else if (modeRef.current === "draw") { draftRef.current = [...draftRef.current, [E, N]]; redraw(); }
      });
      map.on("dblclick", (e: any) => {
        L.DomEvent.stop(e);
        if (modeRef.current === "draw" && draftRef.current.length >= 3) {
          onDrawnRef.current(draftRef.current);
          draftRef.current = [];
          redraw();
        }
      });

      setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 80);
      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basiskarte umschalten (Ortho <-> Karte).
  useEffect(() => {
    baseRef.current = base;
    const m = mapRef.current, ls = baseLayersRef.current;
    if (!m || !ls) return;
    (["ortho", "karte"] as BaseId[]).forEach((id) => {
      if (id === base) { if (!m.hasLayer(ls[id])) ls[id].addTo(m); }
      else if (m.hasLayer(ls[id])) m.removeLayer(ls[id]);
    });
  }, [base]);

  useEffect(() => { modeRef.current = props.mode; draftRef.current = []; redraw(); }, [props.mode]); // eslint-disable-line
  useEffect(() => { if (ready) redraw(); }, [props.perimeter, ready]); // eslint-disable-line
  useEffect(() => {
    if (!ready || !props.focus || !mapRef.current) return;
    try { mapRef.current.flyTo(enToLatLng(props.focus.e, props.focus.n), 19, { duration: 0.6 }); } catch { /* ignore */ }
  }, [props.focus, ready]); // eslint-disable-line

  function fitPerimeter() {
    const map = mapRef.current;
    if (!map || perimRef.current.length === 0) return;
    const ll = perimRef.current.flat().map(([e, n]) => enToLatLng(e, n));
    try { map.fitBounds(Lref.current.latLngBounds(ll), { padding: [20, 20], maxZoom: 20 }); } catch { /* ignore */ }
  }

  function redraw() {
    const L = Lref.current;
    const layer = layerRef.current;
    if (!L || !layer || !mapRef.current) return;
    layer.clearLayers();
    // Angrenzende Parzellen verschmelzen -> keine Innenkanten.
    for (const poly of dissolvePerimeter(perimRef.current)) {
      const rings = poly.map((ring) => ring.map(([e, n]) => enToLatLng(e, n)));
      L.polygon(rings as any, { color: "#ff00ff", weight: 2, fillOpacity: 0.12 }).addTo(layer);
    }
    const d = draftRef.current;
    if (d.length) {
      const ll = d.map(([e, n]) => enToLatLng(e, n));
      L.polygon(ll as any, { color: "#ff00ff", weight: 2, dashArray: "4 4", fillOpacity: 0.05 }).addTo(layer);
      ll.forEach((p: any) => L.circleMarker(p, { radius: 3, color: "#fff" }).addTo(layer));
    }
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", position: "relative" }}>
      <div ref={ref} style={{ width: "100%", height: props.mapHeight ?? 460, cursor: props.mode === "view" ? "grab" : "crosshair" }} />
      {/* Basiskarten-Umschalter (unten links) */}
      <div style={{
        position: "absolute", left: 10, bottom: 10, zIndex: 1100, display: "flex", gap: 3,
        background: "rgba(255,255,255,0.92)", border: "1px solid var(--border)", borderRadius: 8,
        padding: 3, boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
      }}>
        {(["ortho", "karte"] as BaseId[]).map((id) => (
          <button key={id} type="button" onClick={() => setBase(id)} className={base === id ? "primary" : ""} style={{ padding: "3px 10px" }}>
            {id === "ortho" ? "Ortho" : "Karte"}
          </button>
        ))}
      </div>
    </div>
  );
}
