/**
 * Drizzle-Client (postgres-js) fuer das Hoehenvergleich-Portal-Modul.
 * Eine einzige Connection-Pool-Instanz pro Prozess (HMR-sicher).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as {
  __hv_sql?: ReturnType<typeof postgres>;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Kein harter Crash beim Build (kein DB-Zugriff zur Build-Zeit noetig),
  // aber klarer Hinweis zur Laufzeit.
  console.warn("[hoehenvergleich] DATABASE_URL ist nicht gesetzt.");
}

export const sql =
  globalForDb.__hv_sql ??
  postgres(connectionString ?? "", {
    max: 10,
    // Railway-Postgres SSL standardmaessig aktiv; lokal PGlite/lokal egal.
    ...(process.env.DATABASE_SSL === "disable" ? { ssl: false } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForDb.__hv_sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
