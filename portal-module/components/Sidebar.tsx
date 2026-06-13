"use client";

/**
 * Kanonische Birchmeier-App-Sidebar (HELLES Theme), an die anderen Portal-Apps
 * angeglichen (Referenz: messprotokoll/components/Sidebar.tsx).
 *
 * Aufbau:
 *  - Kopf: Birchmeier-Logo-Box + Wortmarke.
 *  - OBEN: App-eigene Navigationspunkte (für Höhenvergleich: "Projekte").
 *  - SPACER drückt die untere Gruppe ans Ende.
 *  - UNTEN: Gruppe "Apps" — dynamische, einheitliche App-Liste aus dem Portal
 *    (/api/portal/modules-meta, gefiltert per Portal-JWT), mit echten lucide-
 *    Icons; lokale Registry als Fallback. Ein-/ausklappbar.
 *  - Footer: "Zurück zum Portal", Nutzer-Avatar/Name, "Abmelden".
 *
 * Interne Links via next/link (basePath wird automatisch vorangestellt). Die
 * app-übergreifenden Gateway-Links (Apps-Liste, Portal, Logout) sind bewusst
 * rohe <a> OHNE basePath-Prefix, da alle Apps gleich-origin laufen.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LogOut,
  LayoutGrid,
  FileCheck,
  Wrench,
  Layers,
  CalendarRange,
  Calculator,
  Ruler,
  Mountain,
  FolderKanban,
  ChevronDown,
} from "lucide-react";
import * as Lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  appsFromMeta,
  fallbackApps,
  CURRENT_APP_ID,
  type AppEntry,
  type PortalModuleMeta,
  type ResolvedApp,
} from "@/lib/apps";

// App-eigene Navigationspunkte (oben). Interne Links via next/link.
// `icon` ist ein lucide-react-Komponentenname (PascalCase), KEIN Component —
// damit der Eintrag serverseitig (im Layout) als reines Daten-Objekt an diese
// Client-Komponente übergeben werden kann (Functions sind als Props verboten).
export interface SidebarNavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
}

interface SidebarProps {
  name: string;
  email?: string;
  modules: string[];
  roles: string[];
  // Portal-Logout-Pfad (app-übergreifend, absolut, ohne basePath).
  logoutHref: string;
  // App-eigene Navigationspunkte (oben).
  navItems: ReadonlyArray<SidebarNavItem>;
  // Server-seitig vorgeladene Portal-Apps (Initialwert; vermeidet Flackern,
  // bis der Client-Abruf da ist). Optional/null.
  portalApps?: ReadonlyArray<AppEntry> | null;
}

// Fallback-Icons pro Modul-ID, falls modules-meta nicht erreichbar ist oder das
// icon-Feld null liefert.
const FALLBACK_ICONS: Record<string, LucideIcon> = {
  "ifc-ids": FileCheck,
  maschinenmeldung: Wrench,
  spezialtiefbau: Layers,
  lastplaner: CalendarRange,
  kalkulation: Calculator,
  "mess-protokoll": Ruler,
  hoehenvergleich: Mountain,
};

// Generisches Fallback, wenn weder modules-meta-Icon noch ID-Fallback greift.
const GENERIC_ICON: LucideIcon = LayoutGrid;

// Wählt die zu rendernde lucide-Komponente für eine App.
function iconFor(app: ResolvedApp): LucideIcon {
  if (app.icon) {
    const named = (Lucide as Record<string, unknown>)[app.icon];
    if (typeof named === "function" || typeof named === "object") {
      return named as LucideIcon;
    }
  }
  return FALLBACK_ICONS[app.id] ?? GENERIC_ICON;
}

// Löst einen lucide-Namen (PascalCase) zu seiner Komponente auf; Fallback
// FolderKanban für die App-eigenen Navigationspunkte.
function navIcon(name: string): LucideIcon {
  const named = (Lucide as Record<string, unknown>)[name];
  if (typeof named === "function" || typeof named === "object") {
    return named as LucideIcon;
  }
  return FolderKanban;
}

function initialsFrom(name: string, email: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  const local = (email.split("@")[0] ?? "") || name;
  return (local.slice(0, 2) || "??").toUpperCase();
}

export function Sidebar({
  name,
  email = "",
  modules,
  roles,
  logoutHref,
  navItems,
  portalApps = null,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname();

  // Volle Modul-Metadaten aus dem Portal-Admin (Single Source of Truth aller
  // aktiven Module). Beim Mounten geladen. Schlägt der Abruf fehl, greift die
  // lokale Registry (Fallback) via fallbackApps().
  const [meta, setMeta] = useState<ReadonlyArray<PortalModuleMeta> | null>(
    portalApps && portalApps.length > 0
      ? portalApps.map((a) => ({
          id: a.id,
          name: a.label,
          path: a.path,
          icon: a.icon,
        }))
      : null,
  );

  useEffect(() => {
    let aborted = false;
    // ABSOLUTER Pfad, KEIN basePath-Prefix: alle Apps laufen gleich-origin unter
    // der Gateway-Domain, der portal_session-Cookie wird mitgeschickt.
    fetch("/api/portal/modules-meta", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { modules?: PortalModuleMeta[] }) => {
        if (aborted || !data?.modules) return;
        setMeta(data.modules);
      })
      .catch(() => {
        // Stillschweigend auf lokale Registry zurückfallen.
      });
    return () => {
      aborted = true;
    };
  }, []);

  // App-Liste aus der zentralen Portal-Meta (alle aktiven Module, nach JWT
  // gefiltert); fehlt die Meta, lokale Registry als Fallback.
  const apps = appsFromMeta(meta, roles, modules) ?? fallbackApps(roles, modules);
  const initials = initialsFrom(name, email);

  // Ein-/ausklappbare "Apps"-Gruppe; Zustand in localStorage gemerkt.
  const [appsOpen, setAppsOpen] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem("bm-apps-open");
      if (v !== null) setAppsOpen(v === "1");
    } catch {}
  }, []);
  function toggleApps() {
    setAppsOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("bm-apps-open", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  // Ganze Sidebar ein-/ausklappen (schmale Icon-Schiene). Zustand in localStorage,
  // Default ausgeklappt. Klick aufs Logo schaltet um.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("bm-side-collapsed") === "1");
    } catch {}
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("bm-side-collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  // Aktiver App-eigener Nav-Punkt: exakter Pfad-Match (Startseite "/") bzw.
  // Prefix-Match für Unterseiten.
  function navActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className={collapsed ? "bm-side is-collapsed" : "bm-side"}>
      {/* Kopf: Logo + Wortmarke. Klick klappt die Sidebar ein/aus. */}
      <button
        type="button"
        className="bm-side-head"
        onClick={toggleCollapsed}
        aria-label="Sidebar ein- oder ausklappen"
        aria-expanded={!collapsed}
        title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
      >
        <span className="bm-side-logo">B</span>
        <span className="bm-side-wm">BIRCHMEIER</span>
      </button>

      {/* OBEN: App-eigene Navigationspunkte. */}
      <nav className="bm-side-nav">
        <p className="bm-side-group">Höhenvergleich</p>
        <div className="bm-side-list">
          {navItems.map((item) => {
            const Icon = navIcon(item.icon);
            const active = navActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "bm-side-row is-active" : "bm-side-row"}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
              >
                <span className="bm-side-ico" aria-hidden="true">
                  <Icon size={16} strokeWidth={2} />
                </span>
                <span className="bm-side-label">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Projekt-Unternavigation (nur wenn ein Projekt offen ist). */}
      {(() => {
        const pm = pathname.match(/^\/projects\/([^/]+)/);
        const projId = pm?.[1];
        if (!projId) return null;
        const base = `/projects/${projId}`;
        const isBf = pathname === `${base}/baufortschritt`;
        const sub = [
          { label: "Vergleiche", href: base, icon: "Layers", active: !isBf },
          { label: "Baufortschritt", href: `${base}/baufortschritt`, icon: "Building2", active: isBf },
        ];
        return (
          <nav className="bm-side-nav">
            <p className="bm-side-group">Projekt</p>
            <div className="bm-side-list">
              {sub.map((item) => {
                const Icon = navIcon(item.icon);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={item.active ? "bm-side-row is-active" : "bm-side-row"}
                    aria-current={item.active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="bm-side-ico" aria-hidden="true"><Icon size={16} strokeWidth={2} /></span>
                    <span className="bm-side-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        );
      })()}

      {/* Spacer: drückt die "Apps"-Gruppe und den Footer nach unten. */}
      <div className="bm-side-spacer" />

      {/* UNTEN: einheitliche App-Liste (alle Birchmeier-Apps), per JWT gefiltert. */}
      <nav className="bm-side-apps">
        <button
          type="button"
          onClick={toggleApps}
          aria-expanded={appsOpen}
          className="bm-side-group bm-side-group-btn"
        >
          <span>Apps</span>
          <ChevronDown
            size={14}
            className={appsOpen ? "bm-side-chev" : "bm-side-chev is-closed"}
          />
        </button>
        <div className={appsOpen ? "bm-side-collapse is-open" : "bm-side-collapse"}>
          <div className="bm-side-collapse-inner">
            <div className="bm-side-list">
              {apps.map((app) => {
                const active = app.id === CURRENT_APP_ID;
                const Icon = iconFor(app);
                // App-übergreifende Gateway-Links: rohes <a> OHNE basePath-Prefix.
                return (
                  <a
                    key={app.id}
                    href={app.path}
                    className={active ? "bm-side-row is-active" : "bm-side-row"}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? app.label : undefined}
                  >
                    <span className="bm-side-ico" aria-hidden="true">
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span className="bm-side-label">{app.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      {/* Footer: Zurück zum Portal, Nutzer, Abmelden. */}
      <div className="bm-side-foot">
        <a href="/" className="bm-side-back">
          ← Zurück zum Portal
        </a>
        <div className="bm-side-user">
          <span className="bm-side-avatar">{initials}</span>
          <span className="bm-side-label">{name || email}</span>
        </div>
        <a href={logoutHref} className="bm-side-logout" title={collapsed ? "Abmelden" : undefined}>
          <LogOut size={16} />
          <span>Abmelden</span>
        </a>
      </div>
    </div>
  );
}
