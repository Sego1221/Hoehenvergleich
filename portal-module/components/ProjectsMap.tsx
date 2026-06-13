"use client";
/**
 * Projekt-Uebersichtskarte (PIX4D-artig) — weltweites Luftbild (Esri World
 * Imagery, Web-Mercator). Fuellt den verfuegbaren Bereich (waechst, wenn die
 * Sidebar eingeklappt wird; ResizeObserver -> invalidateSize). Statt einer Liste
 * gibt es ein Suchfeld mit Dropdown OBEN LINKS in der Karte: tippen -> Treffer
 * -> Projekt oeffnen. Marker je Projekt mit Perimeter; Klick oeffnet ebenfalls.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "leaflet/dist/leaflet.css";

// Baustellen-Marker (Schutzhelm) als HTML/SVG fuer L.divIcon.
const SITE_ICON_HTML =
  '<div style="width:30px;height:30px;border-radius:50%;background:#20683D;' +
  'border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4);display:flex;' +
  'align-items:center;justify-content:center">' +
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff">' +
  '<path d="M3 18h18v2H3z"/><path d="M6.5 17v-3.2a5.5 5.5 0 0 1 11 0V17z"/>' +
  '<path d="M11 5.2h2V8h-2z"/></svg></div>';

export type ProjectPin = {
  id: string;
  name: string;
  ort: string | null;
  point: [number, number] | null;          // LV95 [E,N]
  perimeter: [number, number][][] | null;
};

const LV95 =
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 " +
  "+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel " +
  "+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs";

export default function ProjectsMap({
  projects, height = 420,
}: {
  projects: ProjectPin[];
  height?: number | string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return projects.slice(0, 8);
    return projects
      .filter((p) => p.name.toLowerCase().includes(t) || (p.ort ?? "").toLowerCase().includes(t))
      .slice(0, 12);
  }, [q, projects]);

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      const proj4 = (await import("proj4")).default;
      if (cancelled || !ref.current || mapRef.current) return;
      proj4.defs("EPSG:2056", LV95);
      const enToLatLng = (e: number, n: number) => {
        const [lng, lat] = proj4("EPSG:2056", "WGS84", [e, n]);
        return L.latLng(lat, lng);
      };

      // Zoom-Control nach rechts (Platz fuer das Suchfeld oben links).
      const map = L.map(ref.current, { minZoom: 2, maxZoom: 21, worldCopyJump: true, zoomControl: false });
      L.control.zoom({ position: "topright" }).addTo(map);
      mapRef.current = map;
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles © Esri", maxNativeZoom: 19, maxZoom: 21 } as any,
      ).addTo(map);

      const siteIcon = L.divIcon({ html: SITE_ICON_HTML, className: "bm-site-pin", iconSize: [30, 30], iconAnchor: [15, 15] });
      const pinned = projects.filter((p) => p.point);
      const latlngs: any[] = [];
      for (const p of pinned) {
        const [e, n] = p.point as [number, number];
        const ll = enToLatLng(e, n);
        latlngs.push(ll);
        // Nur ein Baustellen-Icon (keine Umrandungslinie) in der Uebersicht.
        const marker = L.marker(ll, { icon: siteIcon }).addTo(map);
        marker.bindTooltip(`${p.name}${p.ort ? " · " + p.ort : ""}`, { direction: "top", offset: [0, -10] });
        marker.on("click", () => router.push(`/projects/${p.id}`));
      }

      if (latlngs.length === 1) map.setView(latlngs[0], 17);
      else if (latlngs.length > 1) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 17 });
      else map.setView([46.8, 8.2], 7);

      // Adaptiv: bei Container-Groessenaenderung (z.B. Sidebar einklappen) neu messen.
      ro = new ResizeObserver(() => { try { map.invalidateSize(); } catch { /* ignore */ } });
      ro.observe(ref.current);
      setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 80);
    })();
    return () => { cancelled = true; ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", position: "relative", height }}>
      <div ref={ref} style={{ width: "100%", height: "100%", cursor: "grab" }} />

      {/* Suchfeld + Dropdown (oben links, ueber der Karte) */}
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1100, width: 320, maxWidth: "calc(100% - 20px)" }}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Projekt suchen …"
          autoComplete="off"
          style={{
            width: "100%", background: "rgba(255,255,255,0.96)",
            border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          }}
        />
        {open && filtered.length > 0 && (
          <div
            className="panel"
            style={{ marginTop: 4, padding: 4, maxHeight: 280, overflowY: "auto", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }}
          >
            {filtered.map((p) => (
              <button
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => router.push(`/projects/${p.id}`)}
                style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}
              >
                <span>{p.name}</span>
                <span className="muted small">{p.ort ?? ""}</span>
              </button>
            ))}
          </div>
        )}
        {open && q.trim() && filtered.length === 0 && (
          <div className="panel small muted" style={{ marginTop: 4, padding: "6px 8px" }}>Keine Treffer.</div>
        )}
      </div>
    </div>
  );
}
