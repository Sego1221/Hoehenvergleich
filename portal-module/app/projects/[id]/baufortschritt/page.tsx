/**
 * Projekt → Baufortschritt (elementweise Bauteilerkennung). Kopf aus Layout;
 * Umschaltung via Sidebar.
 */
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BaufortschrittPanel } from "../baufortschritt-client";
import type { BauteilRow } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export default async function BaufortschrittPage({ params }: { params: { id: string } }) {
  const [transform] = await db
    .select()
    .from(schema.projectTransforms)
    .where(eq(schema.projectTransforms.projectId, params.id))
    .orderBy(desc(schema.projectTransforms.createdAt))
    .limit(1);

  const [bfModelRow] = await db
    .select()
    .from(schema.bfModel)
    .where(eq(schema.bfModel.projectId, params.id))
    .orderBy(desc(schema.bfModel.updatedAt))
    .limit(1);

  const runs = await db
    .select()
    .from(schema.bfRuns)
    .where(eq(schema.bfRuns.projectId, params.id))
    .orderBy(desc(schema.bfRuns.surveyDate), desc(schema.bfRuns.createdAt));

  return (
    <BaufortschrittPanel
      projectId={params.id}
      hasTransform={!!transform}
      initialModel={bfModelRow ? {
        id: bfModelRow.id,
        computeModelId: bfModelRow.computeModelId,
        nElements: bfModelRow.nElements,
        betonagen: bfModelRow.betonagen as string[] | null,
        ifcNames: bfModelRow.ifcNames as string[] | null,
        files: bfModelRow.files as { name: string; size: number; mtime?: number }[] | null,
        elements: bfModelRow.elements as { guid: string | null; name: string | null; betonage: string | null }[] | null,
      } : null}
      initialRuns={runs.map((r) => ({
        id: r.id,
        name: r.name,
        scanName: r.scanName,
        surveyDate: r.surveyDate ? r.surveyDate.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        summary: r.summary as { n_elements: number; gebaut: number; nicht_gebaut: number; verdeckt: number; nicht_erfasst?: number } | null,
        elements: r.elements as BauteilRow[] | null,
        overrides: r.overrides as Record<string, string> | null,
      }))}
    />
  );
}
