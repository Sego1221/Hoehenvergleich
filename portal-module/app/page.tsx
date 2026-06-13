/**
 * Startseite: Projektliste + Projekt anlegen.
 */
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { dateCH } from "@/lib/format";
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
  const pinned = pins.filter((p) => p.point).length;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>Projekte</h2>
      </div>

      {!dbError && pinned > 0 && <ProjectsMap projects={pins} />}

      {dbError && (
        <div className="panel" style={{ borderColor: "var(--cut)" }}>
          <strong>Datenbank nicht erreichbar.</strong>
          <div className="small muted">{dbError}</div>
        </div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Notiz</th>
              <th style={{ width: 140 }}>Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && !dbError && (
              <tr><td colSpan={3} className="muted">Noch keine Projekte.</td></tr>
            )}
            {projects.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/projects/${p.id}`}>{p.name}</Link></td>
                <td className="muted">{p.notes ?? "—"}</td>
                <td className="muted">{dateCH(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
