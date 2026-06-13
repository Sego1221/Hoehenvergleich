/**
 * Projekt-Layout: gemeinsamer Kopf (Zurueck, Name, Nummer/Ort) fuer die
 * Projekt-Unterseiten. Die Umschaltung Vergleiche/Baufortschritt erfolgt ueber
 * die Sidebar (Routen /projects/[id] und /projects/[id]/baufortschritt).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children, params,
}: {
  children: React.ReactNode; params: { id: string };
}) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, params.id));
  if (!project) notFound();
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div>
        <Link href="/" className="small muted">← Projekte</Link>
        <h2 style={{ margin: "4px 0 0" }}>{project.name}</h2>
        <div className="small muted">
          {project.projektNummer}{project.ort ? ` · ${project.ort}` : ""}
        </div>
      </div>
      {children}
    </div>
  );
}
