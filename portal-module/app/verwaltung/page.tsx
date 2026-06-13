/**
 * Verwaltung (nur Admins): Projekte anlegen und bearbeiten — inkl. der
 * einmaligen Projekt-Grundlagen Georef-Transformation und Bauperimeter.
 * Die normale Projektliste/Projektseite ist die Nutzer-Sicht (nur Vergleiche).
 */
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dateCH } from "@/lib/format";
import { NewProject } from "../projects-client";
import { ProjectSettings } from "../projects/[id]/settings-client";

export const dynamic = "force-dynamic";

export default async function VerwaltungPage() {
  const user = await getCurrentUser();
  if (!user.roles.includes("admin")) notFound();

  const projects = await db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt));
  const transforms = await db
    .select()
    .from(schema.projectTransforms)
    .orderBy(desc(schema.projectTransforms.createdAt));
  const latest = new Map<string, (typeof transforms)[number]>();
  for (const t of transforms) if (!latest.has(t.projectId)) latest.set(t.projectId, t);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>Verwaltung</h2>
          <div className="small muted">Projekte anlegen/bearbeiten — Georef &amp; Bauperimeter (Grundlagen).</div>
        </div>
        <NewProject />
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Nummer</th>
              <th>Name</th>
              <th>Ort</th>
              <th style={{ width: 120 }}>Georef</th>
              <th style={{ width: 120 }}>Perimeter</th>
              <th style={{ width: 130 }}>Erstellt</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr><td colSpan={7} className="muted">Noch keine Projekte.</td></tr>
            )}
            {projects.map((p) => {
              const t = latest.get(p.id) ?? null;
              const perim = (p.perimeter as [number, number][][] | null) ?? null;
              return (
                <tr key={p.id}>
                  <td className="muted">{p.projektNummer}</td>
                  <td>{p.name}</td>
                  <td className="muted">{p.ort ?? "—"}</td>
                  <td className="muted">{t ? "gesetzt" : "—"}</td>
                  <td className="muted">{perim?.length ? `${perim.length} Fläche(n)` : "—"}</td>
                  <td className="muted">{dateCH(p.createdAt)}</td>
                  <td>
                    <ProjectSettings
                      projectId={p.id}
                      projektNummer={p.projektNummer}
                      name={p.name}
                      adresse={p.adresse ?? null}
                      ort={p.ort ?? null}
                      notes={p.notes ?? null}
                      transform={t ? { tE: t.tE, tN: t.tN, tH: t.tH, angleDeg: t.angleDeg, unit: t.unit, direction: t.direction, verifiedAt: t.verifiedAt } : null}
                      initialPerimeter={perim}
                      initialParcels={(p.perimeterParcels as { egrid: string | null; number: string | null; ak: string | null }[] | null) ?? null}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
