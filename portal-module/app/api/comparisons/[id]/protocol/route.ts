/**
 * PDF-Protokoll Höhenvergleich (Soll-Ist-Aushubkontrolle).
 *
 * Sammelt Kontext (Projekt, Vergleich, Schnitte, Bereiche, Toleranz) aus der DB,
 * holt die ΔZ-Übersichtskarte (dz.png) und die Schnitt-Profile vom Compute-
 * Service und erzeugt das PDF lokal mit pdf-lib (lib/pdf.ts) — im Layout/Branding
 * des PIX4D-Messprotokolls. Liefert application/pdf als Download.
 *
 * POST { tol? } -> application/pdf.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchDz, profile, statsForTol, type Stats } from "@/lib/computeClient";
import { perimeterForComparison } from "@/lib/perimeter";
import { exclusionsForComparison } from "@/lib/exclusions";
import { makeProtocolPdf, type ProfilDaten, type BereichDaten, type ProtokollStats } from "@/lib/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Compute liefert snake_case-Stats; in das ProtokollStats-Modell mappen.
function mapStats(s: Partial<Stats> | null | undefined): ProtokollStats {
  return {
    areaM2: s?.area_m2 ?? null,
    cutM3: s?.cut_m3 ?? null,
    fillM3: s?.fill_m3 ?? null,
    netM3: s?.net_m3 ?? null,
    onTargetPct: s?.on_target_pct ?? null,
    medianM: s?.median_m ?? null,
    meanM: s?.mean_m ?? null,
    stdM: s?.std_m ?? null,
    minM: s?.min_m ?? null,
    maxM: s?.max_m ?? null,
  };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const tol = typeof body?.tol === "number" ? body.tol : 0.05;

  // ---- Vergleich + Projekt + Schnitte + Bereiche laden ----
  const [comparison] = await db
    .select()
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, params.id));
  if (!comparison) {
    return NextResponse.json({ error: "Vergleich nicht gefunden." }, { status: 404 });
  }
  if (!comparison.computeJobId) {
    return NextResponse.json({ error: "Kein Compute-Job vorhanden." }, { status: 404 });
  }
  const jobId = comparison.computeJobId;

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

  // ---- Bauperimeter (falls gesetzt) -> Kennzahlen + Karte darauf beschränken ----
  const perimeter = await perimeterForComparison(params.id);
  const exclusions = await exclusionsForComparison(params.id);

  // ---- Kennzahlen für die gewählte Toleranz (frisch vom Compute, Fallback DB) ----
  // tol fliesst in "auf Soll %" ein -> nach Möglichkeit neu berechnen.
  let stats: ProtokollStats;
  try {
    const s = await statsForTol(jobId, tol, perimeter, exclusions);
    stats = mapStats(s);
  } catch {
    stats = mapStats((comparison.stats as Partial<Stats> | null) ?? null);
  }

  // ---- ΔZ-Übersichtskarte (dz.png) vom Compute holen (Perimeter + Ausschluss) ----
  let dzPng: Uint8Array | null = null;
  try {
    const r = await fetchDz(jobId, "png", tol, perimeter, undefined, exclusions);
    if (r.ok) dzPng = new Uint8Array(await r.arrayBuffer());
  } catch {
    dzPng = null;
  }

  // ---- Schnitt-Profile vom Compute holen (je gespeicherter Schnittlinie) ----
  const profileData: ProfilDaten[] = [];
  for (const sec of sections) {
    const line = sec.line as [number, number][] | null;
    if (!Array.isArray(line) || line.length < 2) continue;
    try {
      const p = await profile(jobId, line);
      profileData.push({
        name: sec.name,
        kind: sec.kind,
        dist: p.dist ?? [],
        soll: p.soll ?? [],
        ist: p.ist ?? [],
        dz: p.dz ?? [],
        lengthM: p.length_m ?? null,
      });
    } catch {
      // Einzelnes Profil überspringen, Rest weiter rendern.
    }
  }

  // ---- Bereichs-Volumen (aus gespeicherten regions.volumes) ----
  const bereiche: BereichDaten[] = regions.map((r) => {
    const v = (r.volumes ?? {}) as {
      area_m2?: number; cut_m3?: number; fill_m3?: number; net_m3?: number;
    };
    return {
      name: r.name,
      areaM2: v.area_m2 ?? null,
      cutM3: v.cut_m3 ?? null,
      fillM3: v.fill_m3 ?? null,
      netM3: v.net_m3 ?? null,
    };
  });

  // ---- PDF erzeugen ----
  let pdf: Uint8Array;
  try {
    pdf = await makeProtocolPdf({
      projektNummer: project?.projektNummer ?? null,
      projektName: project?.name ?? null,
      adresse: project?.adresse ?? null,
      ort: project?.ort ?? null,
      vergleichName: comparison.name,
      surveyDate: comparison.surveyDate ? comparison.surveyDate.toISOString() : null,
      sollName: comparison.sollName,
      istName: comparison.istName,
      koordinatensystem: "LV95 (EPSG:2056) / LN02",
      tol,
      mode: ((comparison.params as Record<string, unknown> | null)?.mode === "clouds") ? "clouds" : "aushub",
      stats,
      dzPng,
      profile: profileData,
      bereiche,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "PDF-Erzeugung fehlgeschlagen.", detail: String((e as Error)?.message || e) },
      { status: 500 },
    );
  }

  const safe = (s: string) => s.replace(/[^\wäöüÄÖÜ-]+/g, "_");
  const fname = `Protokoll_${safe(project?.projektNummer ?? "Projekt")}_${safe(comparison.name)}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fname}"`,
    },
  });
}
