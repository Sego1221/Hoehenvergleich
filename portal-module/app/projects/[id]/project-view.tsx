"use client";
/**
 * Projekt-Ansicht (Nutzer): Tabs „Vergleiche" (Aushub Soll-Ist) und
 * „Baufortschritt" (elementweise Bauteilerkennung). Default = Vergleiche.
 */
import { useState } from "react";
import { HistoryAndCompare } from "./compare-client";
import { BaufortschrittPanel } from "./baufortschritt-client";
import type { BauteilRow } from "@/lib/computeClient";

type Comp = { id: string; name: string; surveyDate: string | null; stats: Record<string, number> | null };
type Run = {
  id: string; name: string; betonage: string | null; scanName: string | null;
  surveyDate: string | null; createdAt: string;
  summary: { n_elements: number; gebaut: number; nicht_gebaut: number; verdeckt: number } | null;
  elements: BauteilRow[] | null;
};

export function ProjectView({
  projectId, initialComparisons, hasTransform, hasStructTransform, initialRuns,
}: {
  projectId: string; initialComparisons: Comp[]; hasTransform: boolean;
  hasStructTransform: boolean; initialRuns: Run[];
}) {
  const [tab, setTab] = useState<"vergleiche" | "baufortschritt">("vergleiche");
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 6 }}>
        <button className={tab === "vergleiche" ? "primary" : ""} onClick={() => setTab("vergleiche")}>Vergleiche (Aushub)</button>
        <button className={tab === "baufortschritt" ? "primary" : ""} onClick={() => setTab("baufortschritt")}>Baufortschritt</button>
      </div>
      {tab === "vergleiche" ? (
        <HistoryAndCompare projectId={projectId} initialComparisons={initialComparisons} hasTransform={hasTransform} />
      ) : (
        <BaufortschrittPanel projectId={projectId} hasStructTransform={hasStructTransform} initialRuns={initialRuns} />
      )}
    </div>
  );
}
