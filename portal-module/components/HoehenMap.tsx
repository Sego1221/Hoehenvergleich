"use client";
/**
 * Leaflet-Karte in LV95 (EPSG:2056) via proj4leaflet.
 * - Swisstopo SWISSIMAGE als WMTS-Basiskarte (oeffentlich, wmts.geo.admin.ch).
 * - ΔZ-Overlay als GeoTIFF (georaster-layer-for-leaflet) mit PNG-Fallback.
 * - Zeichnen von Schnittlinien (Polyline) und Bereichs-Polygonen.
 *
 * Hinweis LV95: Karte arbeitet komplett in E/N-Koordinaten (EPSG:2056).
 * Klicks liefern [E, N]; intern wird ein einfacher CRS mit 1:1-Projektion und
 * passenden Aufloesungen genutzt, damit Swisstopo-WMTS-Kacheln matchen.
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { BP } from "@/lib/api";

export type Mode = "view" | "line" | "polygon";

type Props = {
  comparisonId: string;
  tol: number;
  extent?: [number, number, number, number] | null; // [minE,minN,maxE,maxN]
  mode: Mode;
  sections: { id: string; name: string; line: [number, number][] }[];
  regions: { id: string; name: string; polygon: [number, number][] }[];
  /** Liefert die fertig gezeichnete Geometrie (in LV95 E/N) zurueck. */
  onDrawn: (pts: [number, number][]) => void;
  orthoUrl?: string | null; // optionales eigenes Ortho (PNG/Tiles), TODO
};

// Resolutions fuer das Swisstopo-LV95-WMTS-Schema (m/px je Zoom-Level 0..27).
const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250,
  1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];

export default function HoehenMap(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const drawLayerRef = useRef<any>(null);
  const draftRef = useRef<[number, number][]>([]);
  const modeRef = useRef<Mode>(props.mode);
  const onDrawnRef = useRef(props.onDrawn);
  const sectionsRef = useRef(props.sections);
  const regionsRef = useRef(props.regions);
  const [ready, setReady] = useState(false);
  const [tiffFailed, setTiffFailed] = useState(false);

  onDrawnRef.current = props.onDrawn;
  sectionsRef.current = props.sections;
  regionsRef.current = props.regions;

  // Karte einmalig aufbauen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const proj4 = (await import("proj4")).default;
      await import("proj4leaflet");
      if (cancelled || !ref.current || mapRef.current) return;

      // EPSG:2056 definieren.
      proj4.defs(
        "EPSG:2056",
        "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 " +
        "+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel " +
        "+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs",
      );

      // CRS mit Swisstopo-Origin (oben-links) und LV95-Resolutions.
      const crs = new (L as any).Proj.CRS(
        "EPSG:2056",
        proj4.defs("EPSG:2056"),
        {
          resolutions: RESOLUTIONS,
          origin: [2420000, 1350000],
          bounds: (L as any).bounds([2420000, 1030000], [2900000, 1350000]),
        },
      );

      const map = L.map(ref.current, {
        crs,
        minZoom: 14,
        maxZoom: 28,
        attributionControl: true,
      });
      mapRef.current = map;

      // Swisstopo SWISSIMAGE (WMTS, REST). Layer ch.swisstopo.swissimage.
      L.tileLayer(
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/2056/{z}/{x}/{y}.jpeg",
        {
          attribution: "© swisstopo",
          maxNativeZoom: 28,
          minNativeZoom: 14,
        } as any,
      ).addTo(map);

      drawLayerRef.current = L.layerGroup().addTo(map);

      // Default-Ansicht: ueber dem extent oder Mittelland.
      const ext = props.extent;
      if (ext) {
        map.fitBounds([[ext[1], ext[0]], [ext[3], ext[2]]] as any);
      } else {
        map.setView([1247000, 2660000] as any, 16); // Aarau-Region (Birchmeier)
      }

      // Klick-Handler fuers Zeichnen.
      map.on("click", (e: any) => {
        if (modeRef.current === "view") return;
        const en: [number, number] = [e.latlng.lng, e.latlng.lat]; // lng=E, lat=N
        draftRef.current = [...draftRef.current, en];
        renderDraft(L);
      });
      // Doppelklick beendet das Zeichnen.
      map.on("dblclick", (e: any) => {
        L.DomEvent.stop(e);
        finishDraft();
      });

      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mode in ref spiegeln (Closure im Klick-Handler).
  useEffect(() => { modeRef.current = props.mode; draftRef.current = []; redrawAll(); }, [props.mode]); // eslint-disable-line

  function renderDraft(L: any) {
    redrawAll();
    const pts = draftRef.current.map(([e, n]) => [n, e]);
    if (modeRef.current === "line" && pts.length >= 1) {
      L.polyline(pts as any, { color: "#3b82f6", weight: 3, dashArray: "4 4" }).addTo(drawLayerRef.current);
    } else if (modeRef.current === "polygon" && pts.length >= 1) {
      L.polygon(pts as any, { color: "#d9a441", weight: 2, fillOpacity: 0.1, dashArray: "4 4" }).addTo(drawLayerRef.current);
    }
    pts.forEach((p) => L.circleMarker(p as any, { radius: 3, color: "#fff" }).addTo(drawLayerRef.current));
  }

  function finishDraft() {
    const min = modeRef.current === "polygon" ? 3 : 2;
    if (draftRef.current.length >= min) onDrawnRef.current(draftRef.current);
    draftRef.current = [];
    redrawAll();
  }

  // Gespeicherte Schnitte/Bereiche zeichnen.
  async function redrawAll() {
    if (!mapRef.current || !drawLayerRef.current) return;
    const L = (await import("leaflet")).default;
    drawLayerRef.current.clearLayers();
    for (const s of sectionsRef.current) {
      L.polyline(s.line.map(([e, n]) => [n, e]) as any, { color: "#3b82f6", weight: 2 })
        .bindTooltip(s.name).addTo(drawLayerRef.current);
    }
    for (const r of regionsRef.current) {
      L.polygon(r.polygon.map(([e, n]) => [n, e]) as any, { color: "#d9a441", weight: 2, fillOpacity: 0.12 })
        .bindTooltip(r.name).addTo(drawLayerRef.current);
    }
  }
  useEffect(() => { redrawAll(); }, [props.sections, props.regions]); // eslint-disable-line

  // ΔZ-Overlay laden (GeoTIFF, sonst PNG-Fallback).
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (overlayRef.current) { mapRef.current.removeLayer(overlayRef.current); overlayRef.current = null; }

      if (!tiffFailed) {
        try {
          const parseGeoraster = (await import("georaster")).default as any;
          const GeoRasterLayer = (await import("georaster-layer-for-leaflet")).default as any;
          const res = await fetch(`${BP}/api/comparisons/${props.comparisonId}/dz?fmt=tif`);
          if (!res.ok) throw new Error("kein GeoTIFF");
          const buf = await res.arrayBuffer();
          const georaster = await parseGeoraster(buf);
          if (cancelled) return;
          const layer = new GeoRasterLayer({
            georaster,
            opacity: 0.7,
            resolution: 256,
            pixelValuesToColorFn: (vals: number[]) => colorForDz(vals[0], props.tol),
          });
          layer.addTo(mapRef.current);
          overlayRef.current = layer;
          if (props.extent === undefined || props.extent === null) {
            try { mapRef.current.fitBounds(layer.getBounds()); } catch { /* ignore */ }
          }
          return;
        } catch {
          if (!cancelled) setTiffFailed(true);
        }
      }

      // PNG-Fallback (bereits eingefaerbt vom Compute-Service, an extent gelegt).
      if (props.extent) {
        const url = `/api/comparisons/${props.comparisonId}/dz?fmt=png&tol=${props.tol}`;
        const bounds = [[props.extent[1], props.extent[0]], [props.extent[3], props.extent[2]]];
        const layer = L.imageOverlay(url, bounds as any, { opacity: 0.7 });
        layer.addTo(mapRef.current);
        overlayRef.current = layer;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.tol, tiffFailed]);

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <div ref={ref} style={{ width: "100%", height: 520 }} />
      {tiffFailed && (
        <div className="small muted" style={{ padding: "4px 10px" }}>
          GeoTIFF-Overlay nicht verfügbar — PNG-Vorschau aktiv.
        </div>
      )}
    </div>
  );
}

/** Farbskala fuer ΔZ relativ zur Toleranz: innerhalb = neutral, sonst rot/gruen. */
function colorForDz(dz: number, tol: number): string | null {
  if (dz === null || Number.isNaN(dz)) return null;
  if (Math.abs(dz) <= tol) return "rgba(120,120,120,0.25)"; // innerhalb Toleranz
  const k = Math.min(1, Math.abs(dz) / 0.5);
  if (dz < 0) return `rgba(224,83,61,${0.4 + 0.5 * k})`;   // Ist tiefer als Soll = Abtrag noetig (Cut)
  return `rgba(47,158,111,${0.4 + 0.5 * k})`;              // Ist hoeher = Auftrag (Fill)
}
