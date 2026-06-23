/**
 * Cleanup-Ausschluss eines Vergleichs (Sperrbereich-Polygone + Höhenband).
 * Wird aus comparisons.exclusions (jsonb) geladen und an den Compute-Service
 * durchgereicht, der die betroffenen Rasterzellen live maskiert (keine
 * Neuberechnung).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Exclusions, Perimeter } from "@/lib/computeClient";

/** Rohwert aus der DB in das Exclusions-Modell parsen (oder null). */
export function parseExclusions(raw: unknown): Exclusions {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { polygons?: unknown; zMin?: unknown; zMax?: unknown };
  const polygons = (Array.isArray(o.polygons) ? o.polygons : undefined) as Perimeter | undefined;
  const zMin = typeof o.zMin === "number" ? o.zMin : null;
  const zMax = typeof o.zMax === "number" ? o.zMax : null;
  if ((!polygons || !polygons.length) && zMin == null && zMax == null) return null;
  return { polygons, zMin, zMax };
}

export async function exclusionsForComparison(comparisonId: string): Promise<Exclusions> {
  const [row] = await db
    .select({ exclusions: schema.comparisons.exclusions })
    .from(schema.comparisons)
    .where(eq(schema.comparisons.id, comparisonId));
  return parseExclusions(row?.exclusions);
}
