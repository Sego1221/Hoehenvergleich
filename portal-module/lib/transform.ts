/**
 * Eine Projekt-Georef, von beiden Modulen (Aushub + Baufortschritt) genutzt.
 * Kanonische Konvention der Engine: LV95 = Rz(-angle) * (lokal - T).
 *
 * Die Werte koennen im Panel in beide Richtungen eingegeben werden:
 *  - direction = "local_to_lv95": Werte gelten direkt (Default).
 *  - direction = "lv95_to_local": umgekehrt eingegeben -> Vorzeichen von T und
 *    Winkel werden gedreht, damit wieder die kanonische lokal->LV95-Form gilt.
 *
 * Hinweis: Die Engine erkennt automatisch, ob ein Modell bereits in LV95 liegt
 * (Aushub) und transformiert dann NICHT; nur lokale Modelle (Tekla) werden
 * transformiert. Daher ist EINE Transformation pro Projekt fuer beide korrekt.
 */
export type TransformRow = {
  tE: number; tN: number; tH: number; angleDeg: number; direction?: string | null;
};

/** Kanonische lokal->LV95-Parameter (mit angle_deg-Key fuer den Compute-Service). */
export function forwardTransform(row: TransformRow): {
  tE: number; tN: number; tH: number; angle_deg: number;
} {
  const k = row.direction === "lv95_to_local" ? -1 : 1;
  return { tE: k * row.tE, tN: k * row.tN, tH: k * row.tH, angle_deg: k * row.angleDeg };
}
