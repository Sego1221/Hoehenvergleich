/**
 * Zentrale Registry aller Birchmeier-Apps hinter dem Gateway (Fallback-Quelle).
 *
 * id   = Modul-ID (wie im Portal-JWT unter `modules` bzw. die Portal-Admin-Sicht).
 * path = absoluter Gateway-Pfad (OHNE basePath-Prefix, da app-übergreifend).
 *
 * Wird von der Sidebar genutzt, um — gespeist aus den Portal-JWT-Daten — die
 * einheitliche App-Liste (wie im Portal) zu rendern. Primärquelle sind die
 * Portal-Metadaten (/api/portal/modules-meta); diese Registry greift nur, wenn
 * der Endpoint nicht erreichbar ist.
 */

export interface AppEntry {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  // lucide-react-Komponentenname in PascalCase (z.B. "FileCheck") oder null.
  // Bei der lokalen Fallback-Registry ist das Feld nicht gesetzt; die Sidebar
  // nutzt dann ihr ID-Fallback- bzw. generisches Icon.
  readonly icon?: string | null;
}

export const APP_REGISTRY: ReadonlyArray<AppEntry> = [
  { id: "ifc-ids", label: "IFC IDS", path: "/ifc" },
  { id: "maschinenmeldung", label: "Maschinenmeldung", path: "/maschinen" },
  { id: "spezialtiefbau", label: "Spezialtiefbau", path: "/tiefbau" },
  { id: "lastplaner", label: "Lastplaner", path: "/lastplaner" },
  { id: "kalkulation", label: "Kalkulation", path: "/kalkulation" },
  { id: "mess-protokoll", label: "PIX4D Messprotokoll", path: "/mess-protokoll" },
  { id: "hoehenvergleich", label: "Höhenvergleich", path: "/hoehenvergleich" },
];

// Modul-ID der aktuell laufenden App (für die aktive Markierung in der Sidebar).
export const CURRENT_APP_ID = "hoehenvergleich";

// Antwort-Form eines Eintrags von /api/portal/modules-meta (Single Source of
// Truth für ALLE aktiven Portal-Module — inkl. neuer/externer Module).
export interface PortalModuleMeta {
  readonly id: string;
  readonly name?: string | null;
  readonly path?: string | null;
  readonly icon?: string | null; // lucide-react Name (PascalCase) oder null
  readonly isLink?: boolean | null;
}

// Eine zur Anzeige aufgelöste App (Quelle Portal-Meta oder lokaler Fallback).
export interface ResolvedApp {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string | null;
  readonly isLink?: boolean;
}

// Bildet die App-Liste aus der zentralen Portal-Meta-Liste. Liefert null, wenn
// keine Meta vorhanden ist (dann nutzt die Sidebar fallbackApps()).
// admin-Rolle => alle Module; sonst nur die aktuelle App + freigeschaltete.
export function appsFromMeta(
  meta: ReadonlyArray<PortalModuleMeta> | null | undefined,
  roles: ReadonlyArray<string>,
  modules: ReadonlyArray<string>,
): ReadonlyArray<ResolvedApp> | null {
  if (!meta || meta.length === 0) return null;
  const isAdmin = roles.includes("admin");
  const allowed = new Set(modules);
  return meta
    .filter((m) => m && m.id)
    .filter((m) => isAdmin || m.id === CURRENT_APP_ID || allowed.has(m.id))
    .map((m) => ({
      id: m.id,
      label: m.name ?? m.id,
      path: m.path ?? "#",
      icon: m.icon,
      isLink: m.isLink ?? false,
    }));
}

// Liefert die Apps, die der Nutzer sehen darf:
// admin-Rolle => alle, sonst nur die in `modules` enthaltenen.
// Die aktuelle App ist immer dabei (sie ist ja gerade geöffnet).
function visibleApps(
  modules: ReadonlyArray<string>,
  roles: ReadonlyArray<string>,
  source: ReadonlyArray<AppEntry> = APP_REGISTRY,
): ReadonlyArray<AppEntry> {
  if (roles.includes("admin")) return source;
  return source.filter(
    (app) => app.id === CURRENT_APP_ID || modules.includes(app.id),
  );
}

// Fallback auf die lokale Registry, wenn die Portal-Meta nicht erreichbar ist.
export function fallbackApps(
  roles: ReadonlyArray<string>,
  modules: ReadonlyArray<string>,
): ReadonlyArray<ResolvedApp> {
  return visibleApps(modules, roles).map((a) => ({
    id: a.id,
    label: a.label,
    path: a.path,
    icon: a.icon,
    isLink: false,
  }));
}
