/**
 * Startup-Hook (Next.js): wendet additive Schema-Ergaenzungen idempotent an.
 *
 * Hintergrund: Es gibt keinen Migrate-Runner auf dem Deploy, und das
 * standalone-Image enthaelt die .sql-Dateien nicht. Damit neue Spalten beim
 * Deploy sicher existieren (sonst 500 beim SELECT), fuehren wir die rein
 * additiven Statements (IF NOT EXISTS) hier beim Serverstart aus.
 *
 * WICHTIG: nur additiv (ADD COLUMN/INDEX IF NOT EXISTS). Niemals DROP/ALTER,
 * das bestehende Daten gefaehrdet.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[hoehenvergleich] instrumentation: DATABASE_URL fehlt — DDL uebersprungen.");
    return;
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    max: 1,
    connection: { search_path: "hoehenvergleich,public" },
    ...(process.env.DATABASE_SSL === "disable" ? { ssl: false } : {}),
  });
  try {
    // 0001: Bauperimeter pro Projekt.
    await sql.unsafe(`ALTER TABLE "hoehenvergleich"."projects"
      ADD COLUMN IF NOT EXISTS "perimeter" jsonb`);
    await sql.unsafe(`ALTER TABLE "hoehenvergleich"."projects"
      ADD COLUMN IF NOT EXISTS "perimeter_parcels" jsonb`);
    console.log("[hoehenvergleich] instrumentation: additive DDL ok.");
  } catch (e) {
    console.error("[hoehenvergleich] instrumentation: DDL fehlgeschlagen:", e);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
