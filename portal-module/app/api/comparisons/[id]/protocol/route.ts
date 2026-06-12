/**
 * PDF-Protokoll anfordern: sammelt Kontext (Projekt, Vergleich, Schnitte,
 * Bereiche, Toleranz) und streamt das vom Compute-Service erzeugte PDF als
 * Download zum Browser.
 *
 * POST { tol?, title? } -> computeClient.protocolPdf -> application/pdf.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { protocolPdf } from "@/lib/computeClient";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const tol = typeof body?.tol === "number" ? body.tol : 0.05;

  const [comparison] = await db
    .select()
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!comparison?.computeJobId) {
    return NextResponse.json({ error: "Kein Compute-Job vorhanden." }, { status: 404 });
  }
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, comparison.projectId));
  const sections = await db
    .select()
    .from(schema.sections)
    .where(eq(schema.sections.comparisonId, params.id));
  const regions = await db
    .select()
    .from(schema.regions)
    .where(eq(schema.regions.comparisonId, params.id));

  const ctx = {
    title: body?.title ?? "Höhenvergleich-Protokoll",
    project: project?.name ?? "",
    comparison: comparison.name,
    survey_date: comparison.surveyDate,
    soll_name: comparison.sollName,
    ist_name: comparison.istName,
    tol,
    sections: sections.map((s) => ({ name: s.name, kind: s.kind, line: s.line })),
    regions: regions.map((r) => ({ name: r.name, polygon: r.polygon, volumes: r.volumes })),
    generated_at: new Date().toISOString(),
  };

  let pdf: ArrayBuffer;
  try {
    pdf = await protocolPdf(comparison.computeJobId, ctx);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const fname = `Protokoll_${(project?.name ?? "Projekt").replace(/[^\w-]+/g, "_")}_${comparison.name.replace(/[^\w-]+/g, "_")}.pdf`;
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fname}"`,
    },
  });
}
