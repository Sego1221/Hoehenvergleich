/**
 * Portal-Auth: verifiziert das Birchmeier-Portal-JWT (SSO).
 *
 * Vertrag mit dem Apps-Portal/Gateway:
 *  - Cookie: "portal_session" (httpOnly, Domain .birchmeier-gruppe.ch)
 *  - JWT HS256, Secret = PORTAL_JWT_SECRET (identisch zum Portal), Issuer "birchmeier-portal"
 *  - Claims: sub, email, name, modules[], roles[]
 *  - Zugriff auf dieses Modul = roles enthält "admin" ODER modules enthält "hoehenvergleich".
 *
 * Dev-Fallback: ohne gesetztes PORTAL_JWT_SECRET und ausserhalb der Produktion
 * wird ein Entwickler-Benutzer geliefert, damit lokal ohne Portal entwickelt werden kann.
 */
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

export const PORTAL_COOKIE = "portal_session";
export const PORTAL_ISSUER = "birchmeier-portal";
export const MODULE_ID = "hoehenvergleich";

export type PortalUser = {
  sub: string;
  name: string;
  email?: string;
  modules: string[];
  roles: string[];
};

const DEV_USER: PortalUser = {
  sub: "dev",
  name: "Entwickler",
  email: "dev@birchmeier-gruppe.ch",
  modules: [MODULE_ID],
  roles: ["admin"],
};

function isDev(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.PORTAL_JWT_SECRET;
}

function secret(): Uint8Array {
  const s = process.env.PORTAL_JWT_SECRET;
  if (!s || s.length < 16) throw new Error("PORTAL_JWT_SECRET nicht gesetzt oder zu kurz.");
  return new TextEncoder().encode(s);
}

/** Verifizierte Portal-Session oder null (nicht eingeloggt / ungültig). */
export async function getSession(): Promise<PortalUser | null> {
  if (isDev()) return DEV_USER;
  try {
    const store = await cookies();
    const token = store.get(PORTAL_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret(), { issuer: PORTAL_ISSUER });
    return {
      sub: String(payload.sub ?? ""),
      name: String((payload as Record<string, unknown>).name ?? payload.email ?? "Benutzer"),
      email: typeof payload.email === "string" ? payload.email : undefined,
      modules: Array.isArray((payload as Record<string, unknown>).modules)
        ? ((payload as Record<string, unknown>).modules as string[]) : [],
      roles: Array.isArray((payload as Record<string, unknown>).roles)
        ? ((payload as Record<string, unknown>).roles as string[]) : [],
    };
  } catch {
    return null;
  }
}

/** Aktuellen Benutzer ermitteln; bei fehlender Session ein anonymer Platzhalter (für Audit-Felder). */
export async function getCurrentUser(): Promise<PortalUser> {
  return (await getSession()) ?? { sub: "anon", name: "Unbekannt", modules: [], roles: [] };
}

/** Prüft Modul-Freischaltung für dieses Modul. */
export function hasModuleAccess(user: PortalUser | null, mod = MODULE_ID): boolean {
  if (!user) return false;
  return user.roles.includes("admin") || user.modules.includes(mod);
}
