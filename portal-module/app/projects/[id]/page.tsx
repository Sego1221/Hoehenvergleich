/**
 * Projekt-Detail: Georef-Transformation, Vergleichs-Historie, neuer Vergleich.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ProjectView } from "./project-view";
import type { BauteilRow } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, params.id));
  if (!project) notFound();

  const [transform] = await db
    .select()
    .from(schema.projectTransforms)
    .where(eq(schema.projectTransforms.projectId, params.id))
    .orderBy(desc(schema.projectTransforms.createdAt))
    .limit(1);

  const comparisons = await db
    .select()
    .from(schema.comparisons)
    .where(eq(schema.comparisons.projectId, params.id))
    .orderBy(desc(schema.comparisons.createdAt));

  const bfRuns = await db
    .select()
    .from(schema.bfRuns)
    .where(eq(schema.bfRuns.projectId, params.id))
    .orderBy(desc(schema.bfRuns.createdAt));

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="spread">
        <div>
          <Link href="/" className="small muted">← Projekte</Link>
          <h2 style={{ margin: "4px 0 0" }}>{project.name}</h2>
          <div className="small muted">
            {project.projektNummer}{project.ort ? ` · ${project.ort}` : ""}
          </div>
        </div>
      </div>

      <ProjectView
        projectId={params.id}
        hasTransform={!!transform}
        hasStructTransform={!!transform}
        initialComparisons={comparisons.map((c) => ({
          id: c.id,
          name: c.name,
          surveyDate: c.surveyDate ? c.surveyDate.toISOString() : null,
          stats: c.stats as Record<string, number> | null,
        }))}
        initialRuns={bfRuns.map((r) => ({
          id: r.id,
          name: r.name,
          betonage: r.betonage,
          scanName: r.scanName,
          surveyDate: r.surveyDate ? r.surveyDate.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
          summary: r.summary as { n_elements: number; gebaut: number; nicht_gebaut: number; verdeckt: number } | null,
          elements: r.elements as BauteilRow[] | null,
        }))}
      />
    </div>
  );
}
