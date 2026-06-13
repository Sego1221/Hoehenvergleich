/**
 * Baufortschritt-Status-Protokoll (PDF) fuer einen Tages-Scan.
 * GET -> application/pdf (Projektkopf, Fortschritt, Bauteiltabelle mit „gebaut seit").
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { makeBauteilPdf, type BauteilPdfRow } from "@/lib/bauPdf";
import type { BauteilRow } from "@/lib/computeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dkey = (r: { surveyDate: Date | null; createdAt: Date }) =>
  (r.surveyDate ?? r.createdAt).toISOString();

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const [run] = await db.select().from(schema.bfRuns).where(eq(schema.bfRuns.id, params.runId));
  if (!run) return NextResponse.json({ error: "Lauf nicht gefunden." }, { status: 404 });
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, run.projectId));
  const [model] = await db.select().from(schema.bfModel)
    .where(eq(schema.bfModel.projectId, run.projectId)).orderBy(desc(schema.bfModel.updatedAt)).limit(1);
  const allRuns = await db.select().from(schema.bfRuns).where(eq(schema.bfRuns.projectId, run.projectId));

  // „gebaut seit": je GUID erster Scan (nach Datum) mit effektivem Status gebaut.
  const seit: Record<string, string> = {};
  for (const r of [...allRuns].sort((a, b) => dkey(a).localeCompare(dkey(b)))) {
    const ov = (r.overrides as Record<string, string> | null) ?? {};
    for (const e of (r.elements as BauteilRow[] | null) ?? []) {
      if (e.guid && !seit[e.guid] && (ov[e.guid] ?? e.status) === "gebaut") seit[e.guid] = dkey(r);
    }
  }
  const ov = (run.overrides as Record<string, string> | null) ?? {};
  const els = (run.elements as BauteilRow[] | null) ?? [];
  const rows: BauteilPdfRow[] = els.map((e) => ({
    bauteil: [e.material ?? e.bauteil ?? "—", e.betonage].filter(Boolean).join(" · "),
    betonage: e.betonage ?? "",
    koteOk: e.kote_ok ?? "",
    status: (e.guid && ov[e.guid]) ? ov[e.guid] : e.status,
    gebautSeit: e.guid && seit[e.guid] ? new Date(seit[e.guid]).toLocaleDateString("de-CH") : "—",
  }));
  const d = dkey(run);
  const total = model?.nElements ?? els.length;
  const kumGebaut = Object.values(seit).filter((dd) => dd <= d).length;

  let pdf: Uint8Array;
  try {
    pdf = await makeBauteilPdf({
      projektNummer: project?.projektNummer ?? null, projektName: project?.name ?? null,
      adresse: project?.adresse ?? null, ort: project?.ort ?? null,
      scanName: run.scanName, scanDate: run.surveyDate ? run.surveyDate.toISOString() : run.createdAt.toISOString(),
      summary: run.summary as { gebaut?: number; nicht_gebaut?: number; verdeckt?: number; nicht_erfasst?: number } | null,
      kumGebaut, total, rows, generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: "PDF-Erzeugung fehlgeschlagen.", detail: String((e as Error)?.message || e) }, { status: 500 });
  }
  const safe = (s: string) => (s ?? "").replace(/[^\wäöüÄÖÜ-]+/g, "_");
  const fname = `Baufortschritt_${safe(project?.projektNummer ?? "Projekt")}_${safe(run.name)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${fname}"` },
  });
}
