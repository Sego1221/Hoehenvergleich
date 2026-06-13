/**
 * Basiskarten fuer die Leaflet-Karten (Web-Mercator). Umschaltbar zwischen
 * Orthophoto (Esri World Imagery, weltweit) und Karte (MapTiler Streets, falls
 * NEXT_PUBLIC_MAPTILER_KEY gesetzt — sonst OpenStreetMap als keyloser Fallback).
 *
 * Hinweis: NEXT_PUBLIC_*-Variablen werden zur BUILD-Zeit eingebacken — der Key
 * muss als Build-Arg/Variable im Web-Service gesetzt sein, sonst greift OSM.
 */
export type BaseId = "ortho" | "karte";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";

export const BASEMAPS: Record<BaseId, {
  label: string; url: string; attribution: string; maxNativeZoom: number;
}> = {
  ortho: {
    label: "Ortho",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
    maxNativeZoom: 19,
  },
  karte: MAPTILER_KEY
    ? {
        label: "Karte",
        url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
        attribution: "© MapTiler © OpenStreetMap",
        maxNativeZoom: 20,
      }
    : {
        label: "Karte",
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "© OpenStreetMap-Mitwirkende",
        maxNativeZoom: 19,
      },
};
