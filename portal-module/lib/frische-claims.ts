/**
 * FRISCHE CLAIMS vom Portal (Rollen + Module).
 *
 * Warum: Dieses Modul verifiziert das Portal-JWT selbst — Rollen und Module
 * stehen IM Token und sind damit auf dem Stand des LETZTEN LOGINS. Eine
 * entzogene Modul-Freischaltung oder Admin-Rolle wirkte sonst erst nach
 * Token-Ablauf. Diese Datei holt beides live vom Portal.
 *
 * Grundsatz wie im Portal: VERFÜGBARKEIT VOR FRISCHE. Ist das Portal nicht
 * erreichbar oder fehlt die Konfiguration (PORTAL_INTERNAL_URL +
 * PORTAL_SERVICE_TOKEN), gelten weiter die Token-Claims — niemand wird
 * ausgesperrt, nur die Frische geht dann verloren. Nur ein explizites
 * aktiv=false (Benutzer deaktiviert/gelöscht) verweigert den Zugriff.
 *
 * Läuft auch in der Middleware (Edge-Runtime): kein node:*-Import, Cache als
 * Modul-Map mit ~60 s TTL pro Benutzer (dedupt zugleich parallele Requests
 * derselben Instanz).
 */

export type FrischeClaims =
  | { status: "ok"; roles: string[]; modules: string[] }
  | { status: "invalid" } // Benutzer unbekannt, deaktiviert oder gelöscht
  | { status: "unavailable" }; // Portal/Config nicht verfügbar -> Token gilt

const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; claims: FrischeClaims }>();

export async function ladeFrischeClaims(userId: string): Promise<FrischeClaims> {
  const base = (process.env.PORTAL_INTERNAL_URL ?? process.env.PORTAL_URL ?? "").replace(/\/$/, "");
  const token = process.env.PORTAL_SERVICE_TOKEN;
  // Ohne Basis-URL oder Service-Token bleibt alles beim Alten (z.B. lokale
  // Entwicklung ohne Portal).
  if (!base || !token || !userId) return { status: "unavailable" };

  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.claims;

  let claims: FrischeClaims;
  try {
    const res = await fetch(`${base}/api/portal/claims/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: "unavailable" }; // nicht cachen — evtl. transient
    const data = (await res.json()) as { aktiv?: unknown; roles?: unknown; modules?: unknown };
    claims = data?.aktiv === true
      ? {
          status: "ok",
          roles: Array.isArray(data.roles) ? (data.roles as string[]) : [],
          modules: Array.isArray(data.modules) ? (data.modules as string[]) : [],
        }
      : { status: "invalid" };
  } catch {
    return { status: "unavailable" };
  }

  cache.set(userId, { at: Date.now(), claims });
  // Cache klein halten (eine Handvoll Benutzer; Schutz gegen Aufblähen).
  if (cache.size > 500) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }
  return claims;
}
