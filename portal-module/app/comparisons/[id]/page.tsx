/**
 * Vergleichs-Ansicht (Server-Wrapper): laedt Vergleich + Schnitte + Bereiche
 * und uebergibt sie an die Client-Ansicht (Karte, Slider, Profile, Bereiche, PDF).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CompareView } from "./view-client";

export const dynamic = "force-dynamic";

export default async function ComparisonPage({ params }: { params: { id: string } }) {
  const [comparison] = await db.select().from(schema.comparisons).where(eq(schema.comparisons.id, params.id));
  if (!comparison) notFound();
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, comparison.projectId));
  const sections = await db.select().from(schema.sections).where(eq(schema.sections.comparisonId, params.id));
  const regions = await db.select().from(schema.regions).where(eq(schema.regions.comparisonId, params.id));

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="spread">
        <div>
          <Link href={`/projects/${comparison.projectId}`} className="small muted">← {project?.name ?? "Projekt"}</Link>
          <h2 style={{ margin: "4px 0 0" }}>{comparison.name}</h2>
        </div>
      </div>
      <CompareView
        comparisonId={params.id}
        projectName={project?.name ?? ""}
        comparisonName={comparison.name}
        stats={comparison.stats as Record<string, number> | null}
        params={comparison.params as Record<string, number> | null}
        initialSections={sections.map((s) => ({ id: s.id, name: s.name, kind: s.kind, line: s.line as [number, number][] }))}
        initialRegions={regions.map((r) => ({ id: r.id, name: r.name, polygon: r.polygon as [number, number][], volumes: r.volumes as Record<string, number> | null }))}
      />
    </div>
  );
}
