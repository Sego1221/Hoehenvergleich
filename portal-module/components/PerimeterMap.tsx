"use client";
/**
 * Leaflet-Karte (EPSG:2056 / LV95) zum Festlegen des PROJEKT-Bauperimeters —
 * unabhaengig von einem Vergleich. Swisstopo SWISSIMAGE als Basiskarte.
 *
 * WICHTIG zur Projektion: Bei L.Proj.CRS sind die Karten-LatLng WGS84-GRAD.
 * LV95-Koordinaten (E,N) werden via crs.project()/unproject() umgerechnet:
 *   [E,N] = crs.project(latlng) -> {x:E, y:N};  latlng = crs.unproject(point(E,N)).
 *
 * Modi:
 *  - "parcel": Klick -> onPick(E,N) (Aufrufer holt die Grenze aus der amtl. Verm.),
 *  - "draw":  Punkte klicken, Doppelklick schliesst -> onDrawn([[E,N],...]),
 *  - "view":  nur ansehen.
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type PMapMode = "view" | "parcel" | "draw";

type Props = {
  perimeter: [number, number][][];
  mode: PMapMode;
  onPick: (e: number, n: number) => void;
  onDrawn: (pts: [number, number][]) => void;
  /** Karte auf diese LV95-Koordinate zentrieren (Adresssuche). Bei jeder neuen
   *  Referenz wird hingeflogen (auch identische Werte erneut moeglich). */
  focus?: { e: number; n: number } | null;
};

const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250,
  1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];

export default function PerimeterMap(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const Lref = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const draftRef = useRef<[number, number][]>([]); // LV95 [E,N]
  const modeRef = useRef<PMapMode>(props.mode);
  const onPickRef = useRef(props.onPick);
  const onDrawnRef = useRef(props.onDrawn);
  const perimRef = useRef(props.perimeter);
  const [ready, setReady] = useState(false);

  onPickRef.current = props.onPick;
  onDrawnRef.current = props.onDrawn;
  perimRef.current = props.perimeter;

  // LV95 <-> Karten-LatLng.
  function enToLatLng(e: number, n: number): any {
    return mapRef.current.options.crs.unproject(Lref.current.point(e, n));
  }
  function latlngToEn(latlng: any): [number, number] {
    const p = mapRef.current.options.crs.project(latlng);
    return [p.x, p.y];
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const proj4 = (await import("proj4")).default;
      await import("proj4leaflet");
      if (cancelled || !ref.current || mapRef.current) return;
      Lref.current = L;

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

      // maxNativeZoom < maxZoom: Swissimage hat in vielen Gebieten keine Kacheln
      // auf den hoechsten Stufen (z27/28) -> Overzoom (Skalieren der letzten
      // vorhandenen Stufe) statt leerer Karte beim Reinzoomen.
      L.tileLayer(
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/2056/{z}/{x}/{y}.jpeg",
        { attribution: "© swisstopo", maxNativeZoom: 26, minNativeZoom: 14, maxZoom: 28 } as any,
      ).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);

      // Auf vorhandenen Perimeter zoomen, sonst Birchmeier-Region (Döttingen, WGS84).
      const p = perimRef.current;
      if (p.length) {
        fitPerimeter();
      } else {
        map.setView([47.567, 8.253] as any, 19);
      }

      map.on("click", (e: any) => {
        const [E, N] = latlngToEn(e.latlng);
        if (modeRef.current === "parcel") {
          onPickRef.current(E, N);
        } else if (modeRef.current === "draw") {
          draftRef.current = [...draftRef.current, [E, N]];
          redraw();
        }
      });
      map.on("dblclick", (e: any) => {
        L.DomEvent.stop(e);
        if (modeRef.current === "draw" && draftRef.current.length >= 3) {
          onDrawnRef.current(draftRef.current);
          draftRef.current = [];
          redraw();
        }
      });

      // Container hatte beim Init evtl. noch keine Endgrösse -> Tiles nachladen.
      setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 80);
      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { modeRef.current = props.mode; draftRef.current = []; redraw(); }, [props.mode]); // eslint-disable-line
  // Bei Perimeter-Aenderung nur neu zeichnen — NICHT die Ansicht verschieben
  // (sonst zoomt es nach jedem Parzellen-Klick wieder hinaus). Initiales
  // Einpassen passiert einmalig beim Karten-Aufbau (s.o.).
  useEffect(() => { if (ready) redraw(); }, [props.perimeter, ready]); // eslint-disable-line
  // Adresssuche -> hinfliegen.
  useEffect(() => {
    if (!ready || !props.focus || !mapRef.current) return;
    try { mapRef.current.flyTo(enToLatLng(props.focus.e, props.focus.n), 24, { duration: 0.6 }); } catch { /* ignore */ }
  }, [props.focus, ready]); // eslint-disable-line

  function fitPerimeter() {
    const map = mapRef.current;
    if (!map || perimRef.current.length === 0) return;
    const ll = perimRef.current.flat().map(([e, n]) => enToLatLng(e, n));
    try { map.fitBounds(Lref.current.latLngBounds(ll), { padding: [20, 20], maxZoom: 21 }); } catch { /* ignore */ }
  }

  function redraw() {
    const L = Lref.current;
    const layer = layerRef.current;
    if (!L || !layer || !mapRef.current) return;
    layer.clearLayers();
    for (const poly of perimRef.current) {
      const ll = poly.map(([e, n]) => enToLatLng(e, n));
      L.polygon(ll as any, { color: "#ff8c1a", weight: 2, fillOpacity: 0.12 }).addTo(layer);
    }
    const d = draftRef.current;
    if (d.length) {
      const ll = d.map(([e, n]) => enToLatLng(e, n));
      L.polygon(ll as any, { color: "#ff8c1a", weight: 2, dashArray: "4 4", fillOpacity: 0.05 }).addTo(layer);
      ll.forEach((p: any) => L.circleMarker(p, { radius: 3, color: "#fff" }).addTo(layer));
    }
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", position: "relative" }}>
      <div ref={ref} style={{ width: "100%", height: 460, cursor: props.mode === "view" ? "grab" : "crosshair" }} />
    </div>
  );
}
