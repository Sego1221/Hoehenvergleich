/**
 * Geometrie-Helfer: Bauperimeter aus mehreren (evtl. angrenzenden) Parzellen zu
 * einem Umriss verschmelzen — gemeinsame Kanten zwischen sich beruehrenden
 * Parzellen entfallen (Polygon-Union via polygon-clipping).
 */
import polygonClipping from "polygon-clipping";

// Rueckgabe: Liste von Polygonen, jedes Polygon = Liste von Ringen
// ([aussen, loch1, ...]). Koordinaten unveraendert (z.B. LV95 [E,N]).
export function dissolvePerimeter(perimeter: [number, number][][]): [number, number][][][] {
  const polys = perimeter.filter((p) => p.length >= 3).map((p) => [p] as [number, number][][]);
  if (polys.length === 0) return [];
  if (polys.length === 1) return [polys[0]];
  try {
    const mp = polygonClipping.union(polys[0], ...polys.slice(1));
    return mp as [number, number][][][];
  } catch {
    // Fallback: Parzellen einzeln (mit Innenkanten) zeichnen.
    return polys;
  }
}
