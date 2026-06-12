/**
 * Root-Layout mit der kanonischen Birchmeier-App-Sidebar (HELLES Theme).
 *
 * App-Optionen oben ("Projekte"), Gruppe "Apps" unten mit der dynamischen
 * App-Liste aus /api/portal/modules-meta (gefiltert per Portal-JWT, lokaler
 * Registry-Fallback). Die Modul-Metadaten werden serverseitig vorgeladen, damit
 * die Sidebar sofort echte Icons/Labels zeigt; der Client zieht beim Mounten
 * nach.
 */
import type { Metadata } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { fetchPortalModules } from "@/lib/portal-modules";
import { Sidebar, type SidebarNavItem } from "@/components/Sidebar";
import { ToastHost } from "@/components/ui";

export const metadata: Metadata = {
  title: "Höhenvergleich — Birchmeier Gruppe",
  description: "Soll-Ist-Aushubkontrolle (LV95)",
};

// App-eigene Navigationspunkte (oben in der Sidebar). Interne Links via
// next/link (basePath wird automatisch vorangestellt).
const NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { label: "Projekte", href: "/", icon: "FolderKanban" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Modul-Metadaten (Name, Pfad, Icon) server-seitig vom Portal vorladen, damit
  // die Sidebar sofort echte Icons/Labels zeigt (Initialwert). Bei Fehler/
  // Timeout null => lokaler Registry-Fallback in der Sidebar.
  const portalApps = await fetchPortalModules();

  return (
    <html lang="de-CH">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Sidebar
              name={user.name}
              email={user.email}
              modules={user.modules}
              roles={user.roles}
              navItems={NAV_ITEMS}
              portalApps={portalApps}
              // Portal-Logout: app-übergreifender Gateway-Pfad, ohne basePath.
              logoutHref="/logout"
            />
          </aside>
          <main className="content">
            <ToastHost>{children}</ToastHost>
          </main>
        </div>
      </body>
    </html>
  );
}
