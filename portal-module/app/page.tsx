/**
 * Startseite: Projektliste + Projekt anlegen.
 */
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import ProjectsMap, { type ProjectPin } from "@/components/ProjectsMap";

export const dynamic = "force-dynamic";

// Schwerpunkt des (ersten) Perimeter-Polygons als Marker-Position (LV95).
function centroid(perimeter: [number, number][][] | null): [number, number] | null {
  const poly = perimeter?.[0];
  if (!poly || poly.length < 3) return null;
  let sx = 0, sy = 0;
  for (const [e, n] of poly) { sx += e; sy += n; }
  return [sx / poly.length, sy / poly.length];
}

export default async function HomePage() {
  let projects: {
    id: string; name: string; notes: string | null; ort: string | null;
    perimeter: unknown; createdAt: Date;
  }[] = [];
  let dbError: string | null = null;
  try {
    projects = await db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt));
  } catch (e) {
    dbError = (e as Error).message;
  }

  const pins: ProjectPin[] = projects.map((p) => {
    const perimeter = (p.perimeter as [number, number][][] | null) ?? null;
    return { id: p.id, name: p.name, ort: p.ort ?? null, point: centroid(perimeter), perimeter };
  });

  if (dbError) {
    return (
      <div className="panel" style={{ borderColor: "var(--cut)" }}>
        <strong>Datenbank nicht erreichbar.</strong>
        <div className="small muted">{dbError}</div>
      </div>
    );
  }

  // Karte fuellt den Bereich (waechst, wenn die Sidebar eingeklappt wird).
  // Projektauswahl ueber das Suchfeld/Dropdown in der Karte (ersetzt die Liste).
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "calc(100vh - 76px)" }}>
      <h2 style={{ margin: 0 }}>Projekte</h2>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ProjectsMap projects={pins} height="100%" />
      </div>
    </div>
  );
}
