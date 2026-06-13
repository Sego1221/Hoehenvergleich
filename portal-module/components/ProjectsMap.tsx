"use client";
/**
 * Projekt-Uebersichtskarte (PIX4D-artig): Swisstopo (LV95) mit einem Marker je
 * Projekt am Schwerpunkt seines Bauperimeters. Klick -> Projekt oeffnen.
 * Projekte ohne Perimeter erscheinen nicht auf der Karte (nur in der Liste).
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import "leaflet/dist/leaflet.css";

export type ProjectPin = {
  id: string;
  name: string;
  ort: string | null;
  point: [number, number] | null;          // LV95 [E,N] (Perimeter-Schwerpunkt)
  perimeter: [number, number][][] | null;   // optionale Umrisse
};

const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250,
  1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];

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
      const map = L.map(ref.current, { crs, minZoom: 8, maxZoom: 28 });
      mapRef.current = map;

      L.tileLayer(
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/2056/{z}/{x}/{y}.jpeg",
        { attribution: "© swisstopo", maxNativeZoom: 26, minNativeZoom: 8, maxZoom: 28 } as any,
      ).addTo(map);

      const enToLatLng = (e: number, n: number) => crs.unproject(L.point(e, n));
      const pinned = projects.filter((p) => p.point);
      const latlngs: any[] = [];

      for (const p of pinned) {
        const [e, n] = p.point as [number, number];
        const ll = enToLatLng(e, n);
        latlngs.push(ll);
        // Perimeter-Umriss (dezent).
        if (p.perimeter?.length) {
          for (const poly of p.perimeter) {
            L.polygon(poly.map(([E, N]) => enToLatLng(E, N)) as any, {
              color: "#ff8c1a", weight: 1.5, fillOpacity: 0.08,
            }).addTo(map);
          }
        }
        const marker = L.circleMarker(ll, {
          radius: 8, color: "#fff", weight: 2, fillColor: "#20683D", fillOpacity: 1,
        }).addTo(map);
        marker.bindTooltip(`${p.name}${p.ort ? " · " + p.ort : ""}`, { direction: "top", offset: [0, -6] });
        marker.on("click", () => routerRef.current.push(`/projects/${p.id}`));
      }

      if (latlngs.length === 1) {
        map.setView(latlngs[0], 18);
      } else if (latlngs.length > 1) {
        map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 18 });
      } else {
        map.setView([46.8, 8.2] as any, 8); // ganze Schweiz
      }
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
