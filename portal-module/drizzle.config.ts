import type { Config } from "drizzle-kit";

// Drizzle-Kit-Konfiguration. Migrationen werden additiv erzeugt und vor
// Deploy auf Additivitaet geprueft (kein CREATE TABLE fuer bestehende Tabellen).
export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
} satisfies Config;
