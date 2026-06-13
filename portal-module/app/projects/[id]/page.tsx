/**
 * Projekt-Detail: Georef-Transformation, Vergleichs-Historie, neuer Vergleich.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HistoryAndCompare } from "./compare-client";

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

      <HistoryAndCompare
        projectId={params.id}
        initialComparisons={comparisons.map((c) => ({
          id: c.id,
          name: c.name,
          surveyDate: c.surveyDate ? c.surveyDate.toISOString() : null,
          stats: c.stats as Record<string, number> | null,
        }))}
        hasTransform={!!transform}
      />
    </div>
  );
}
