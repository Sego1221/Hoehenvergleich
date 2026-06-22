/**
 * Projekt → Vergleiche (Aushub Soll-Ist). Kopf kommt aus dem Projekt-Layout;
 * Umschaltung auf Baufortschritt via Sidebar.
 */
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HistoryAndCompare } from "./compare-client";

export const dynamic = "force-dynamic";

export default async function VergleichePage({ params }: { params: { id: string } }) {
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
    <HistoryAndCompare
      projectId={params.id}
      hasTransform={!!transform}
      initialComparisons={comparisons.map((c) => ({
        id: c.id,
        name: c.name,
        surveyDate: c.surveyDate ? c.surveyDate.toISOString() : null,
        stats: c.stats as Record<string, number> | null,
        mode: ((c.params as Record<string, unknown> | null)?.mode as string) ?? "aushub",
      }))}
    />
  );
}
