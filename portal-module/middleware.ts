/**
 * Erzwingt Portal-Zugriff für dieses Modul.
 * Ohne gültiges portal_session-JWT oder ohne Freischaltung des Moduls
 * "hoehenvergleich" (bzw. Rolle admin) -> Redirect ins Portal.
 *
 * Dev-Bypass: ohne PORTAL_JWT_SECRET ausserhalb der Produktion wird durchgelassen.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { ladeFrischeClaims } from "@/lib/frische-claims";

const COOKIE = "portal_session";
const ISSUER = "birchmeier-portal";
const MODULE_ID = "hoehenvergleich";
const PORTAL_HOME = process.env.PORTAL_HOME_URL ?? "https://apps.birchmeier-gruppe.ch/";

function devBypass() {
  return process.env.NODE_ENV !== "production" && !process.env.PORTAL_JWT_SECRET;
}

export async function middleware(req: NextRequest) {
  if (devBypass()) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  const deny = () => NextResponse.redirect(PORTAL_HOME);
  if (!token) return deny();

  try {
    const secret = new TextEncoder().encode(process.env.PORTAL_JWT_SECRET ?? "");
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    let modules = Array.isArray((payload as Record<string, unknown>).modules)
      ? ((payload as Record<string, unknown>).modules as string[]) : [];
    let roles = Array.isArray((payload as Record<string, unknown>).roles)
      ? ((payload as Record<string, unknown>).roles as string[]) : [];
    // Rollen/Module frisch vom Portal (im Token = Stand des letzten Logins).
    // Portal nicht erreichbar -> Token gilt (Verfügbarkeit vor Frische);
    // Benutzer deaktiviert/gelöscht -> Zugriff verweigern.
    const frisch = await ladeFrischeClaims(String(payload.sub ?? ""));
    if (frisch.status === "invalid") return deny();
    if (frisch.status === "ok") {
      roles = frisch.roles;
      modules = frisch.modules;
    }
    const allowed = roles.includes("admin") || modules.includes(MODULE_ID);
    return allowed ? NextResponse.next() : deny();
  } catch {
    return deny();
  }
}

// Statische Assets, Health und API-Health ausnehmen.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
