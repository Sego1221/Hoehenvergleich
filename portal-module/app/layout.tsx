/**
 * Root-Layout mit einheitlicher Birchmeier-App-Sidebar (Stub).
 *
 * TODO Portal-Integration: Sidebar durch die kanonische Portal-Sidebar ersetzen
 * (App-Optionen oben, Gruppe "Apps" unten mit Icons aus /api/portal/modules-meta,
 * App-Liste aus dem Portal-JWT). Aktuell minimaler Stub mit Modul-Navigation.
 */
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { ToastHost } from "@/components/ui";

export const metadata: Metadata = {
  title: "Höhenvergleich",
  description: "Soll-Ist-Aushubkontrolle (LV95)",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="de">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <h1>Höhenvergleich</h1>
            <Link href="/">Projekte</Link>
            <Link href="/">Neuer Vergleich</Link>
            <div className="group">Apps</div>
            {/* TODO: dynamisch aus Portal-JWT / modules-meta */}
            <a href="#" className="muted">Portal (Stub)</a>
            <div style={{ position: "absolute", bottom: 14, left: 10, right: 10 }} className="small muted">
              {user.name}
            </div>
          </aside>
          <main className="content"><ToastHost>{children}</ToastHost></main>
        </div>
      </body>
    </html>
  );
}
