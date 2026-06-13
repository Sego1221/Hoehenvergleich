"use client";
/**
 * Projekt-Uebersichtskarte (PIX4D-artig) — weltweites Luftbild (Esri World
 * Imagery, Web-Mercator), nicht auf die Schweiz begrenzt. Ein Marker je Projekt
 * am Schwerpunkt seines Bauperimeters; Klick -> Projekt oeffnen. Projekte ohne
 * Perimeter erscheinen nur in der Liste. Koordinaten LV95 -> WGS84 via proj4.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import "leaflet/dist/leaflet.css";

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

export default function ProjectsMap({ projects }: { projects: ProjectPin[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const proj4 = (await import("proj4")).default;
      if (cancelled || !ref.current || mapRef.current) return;
      proj4.defs("EPSG:2056", LV95);
      const enToLatLng = (e: number, n: number) => {
        const [lng, lat] = proj4("EPSG:2056", "WGS84", [e, n]);
        return L.latLng(lat, lng);
      };

      const map = L.map(ref.current, { minZoom: 2, maxZoom: 21, worldCopyJump: true });
      mapRef.current = map;
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles © Esri", maxNativeZoom: 19, maxZoom: 21 } as any,
      ).addTo(map);

      const pinned = projects.filter((p) => p.point);
      const latlngs: any[] = [];
      for (const p of pinned) {
        const [e, n] = p.point as [number, number];
        const ll = enToLatLng(e, n);
        latlngs.push(ll);
        if (p.perimeter?.length) {
          for (const poly of p.perimeter) {
            L.polygon(poly.map(([E, N]) => enToLatLng(E, N)) as any, { color: "#ff8c1a", weight: 1.5, fillOpacity: 0.08 }).addTo(map);
          }
        }
        const marker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#20683D", fillOpacity: 1 }).addTo(map);
        marker.bindTooltip(`${p.name}${p.ort ? " · " + p.ort : ""}`, { direction: "top", offset: [0, -6] });
        marker.on("click", () => routerRef.current.push(`/projects/${p.id}`));
      }

      if (latlngs.length === 1) map.setView(latlngs[0], 17);
      else if (latlngs.length > 1) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 17 });
      else map.setView([46.8, 8.2], 7);
      setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 80);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <div ref={ref} style={{ width: "100%", height: 420, cursor: "grab" }} />
    </div>
  );
}
