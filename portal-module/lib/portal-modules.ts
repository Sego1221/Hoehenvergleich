import "server-only";
import { cookies } from "next/headers";
import { PORTAL_COOKIE } from "@/lib/auth";
import type { AppEntry } from "@/lib/apps";

/**
 * Holt die zentralen Modul-Metadaten (Name, Pfad, Icon) vom Portal-Endpoint
 * `GET /api/portal/modules-meta`. Damit rendert die Sidebar Icons/Labels/Pfade
 * genauso wie das Portal, statt sie hartzucodieren. Bei Fehler/Timeout fällt
 * der Aufrufer defensiv auf die lokale Registry (lib/apps.ts) zurück.
 *
 * Muster 1:1 aus messprotokoll/lib/portal-modules.ts übernommen: serverseitig,
 * Weitergabe des portal_session-Cookies, 3s-Timeout, PORTAL_URL als Basis
 * (intern http://portal.railway.internal:8080).
 */

// Rohformat eines Moduls, wie es das Portal liefert.
interface PortalModuleMeta {
  id: string;
  name: string;
  path: string;
  icon: string | null;
  isLink?: boolean;
  order?: number;
  channel?: string;
}

interface ModulesMetaResponse {
  modules: PortalModuleMeta[];
}

// Wandelt ein Portal-Modul in einen AppEntry (Sidebar-Format) um.
function toAppEntry(m: PortalModuleMeta): AppEntry {
  return {
    id: m.id,
    label: m.name,
    path: m.path,
    icon: m.icon ?? null,
  };
}

function isValidModule(m: unknown): m is PortalModuleMeta {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.path === "string" &&
    (o.icon === null || typeof o.icon === "string")
  );
}

// Liefert die Apps aus den Portal-Metadaten — oder null, wenn der Endpoint
// nicht erreichbar/ungültig ist (dann greift der lokale Registry-Fallback).
export async function fetchPortalModules(): Promise<ReadonlyArray<AppEntry> | null> {
  const base = (process.env.PORTAL_URL ?? "").replace(/\/$/, "");
  if (!base) return null;

  // Eingehenden portal_session-Cookie weiterreichen — der Endpoint akzeptiert
  // Cookie- ODER Service-Token-Auth.
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  const cookieHeader = token ? `${PORTAL_COOKIE}=${token}` : "";

  // Timeout, damit eine träge Antwort die Seite nicht blockiert.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`${base}/api/portal/modules-meta`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as ModulesMetaResponse;
    if (!data || !Array.isArray(data.modules)) return null;

    const modules = data.modules.filter(isValidModule);
    if (modules.length === 0) return null;

    // Reihenfolge gemäss `order` (falls vorhanden), stabil ansonsten.
    const sorted = [...modules].sort(
      (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
    );
    return sorted.map(toAppEntry);
  } catch {
    // Netzwerkfehler, Abbruch (Timeout) oder JSON-Parse-Fehler: Fallback.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
