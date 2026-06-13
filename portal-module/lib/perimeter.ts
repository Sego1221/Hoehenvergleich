/**
 * Bauperimeter eines Vergleichs laden (ueber das zugehoerige Projekt).
 * Liefert die Polygon-Liste [[ [E,N],... ],...] (LV95) oder null.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Perimeter } from "@/lib/computeClient";

export async function perimeterForComparison(comparisonId: string): Promise<Perimeter | null> {
  const [row] = await db
    .select({ perimeter: schema.projects.perimeter })
    .from(schema.comparisons)
    .innerJoin(schema.projects, eq(schema.comparisons.projectId, schema.projects.id))
    .where(eq(schema.comparisons.id, comparisonId));
  const p = row?.perimeter as Perimeter | null | undefined;
  return Array.isArray(p) && p.length ? p : null;
}
