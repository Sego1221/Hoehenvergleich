/**
 * Base-Path-bewusste Client-Fetches.
 * Hinter dem Gateway läuft das Modul unter /hoehenvergleich. Next prependet den
 * basePath NUR bei <Link>/Router/Assets, NICHT bei rohem fetch() — darum hier manuell.
 */
export const BP = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Hängt den Base-Path vor einen App-internen Pfad (z.B. "/api/projects"). */
export function api(path: string): string {
  return path.startsWith("/") ? BP + path : path;
}
