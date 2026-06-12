/**
 * Datenmodell Höhenvergleich (Drizzle / Postgres) — im Portal-Modul.
 * Verwaltet Projekte, Georef-Transformationen, Vergleichs-Historie sowie
 * gespeicherte Schnitte und Bereiche. Der Compute-Service bleibt stateless.
 */
import {
  pgSchema, uuid, text, timestamp, doublePrecision, integer, boolean, jsonb, index,
} from "drizzle-orm/pg-core";

// Eigenes Schema im geteilten Postgres (Muster wie lastplaner/portal).
export const hv = pgSchema("hoehenvergleich");

/**
 * Projekt = eine Baustelle (oberste Ebene der Projekt-Hierarchie).
 * Birchmeier-Standard: jedes Projekt trägt Projektnummer, Projektname, Adresse, Ort.
 * Hält zudem die Georef-Transformation lokal↔LV95.
 */
export const projects = hv.table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  projektNummer: text("projekt_nummer").notNull(),   // Projektnummer (eindeutig je Mandant)
  name: text("name").notNull(),                       // Projektname
  adresse: text("adresse"),                           // Projektadresse (Strasse/Nr.)
  ort: text("ort"),                                   // Ort
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byNummer: index("projects_nummer_idx").on(t.projektNummer) }));

/**
 * Georef-Transformation pro Projekt (wiederverwendbar für alle Modelle).
 * Konvention: LV95 = Rz(-angle) · (lokal − T), T = (tE, tN, tH). Massstab = 1.
 */
export const projectTransforms = hv.table("project_transforms", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Standard"),
  tE: doublePrecision("t_e").notNull(),
  tN: doublePrecision("t_n").notNull(),
  tH: doublePrecision("t_h").notNull(),
  angleDeg: doublePrecision("angle_deg").notNull().default(0),
  unit: text("unit").notNull().default("m"), // "m" | "mm" (Modell-Einheit, z.B. Tekla = mm)
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Ein Vergleichslauf (Befliegung gegen Soll). Bildet die Historie. */
export const comparisons = hv.table("comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  surveyDate: timestamp("survey_date", { withTimezone: true }), // Datum der Befliegung
  sollName: text("soll_name"),           // IFC/TIN Dateiname
  istName: text("ist_name"),             // LAZ/DSM Dateiname
  sollKind: text("soll_kind"),           // "ifc" | "mesh"
  istKind: text("ist_kind"),             // "cloud" | "dsm"
  params: jsonb("params").notNull(),     // { res, tol, ground_pct, exg_thr, use_veg, cap }
  stats: jsonb("stats"),                 // { area_m2, cut_m3, fill_m3, net_m3, on_target_pct, median_m, ... }
  resultRef: text("result_ref"),         // Pfad/Key zum gespeicherten ΔZ-GeoTIFF (Objektspeicher)
  computeJobId: text("compute_job_id"),  // letzte job_id im Compute-Service (Cache)
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byProject: index("comparisons_project_idx").on(t.projectId) }));

/** Gespeicherte Schnittlinie (Längs/Quer) zu einem Vergleich. */
export const sections = hv.table("sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  comparisonId: uuid("comparison_id").notNull().references(() => comparisons.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind"),                    // "laengs" | "quer" | frei
  line: jsonb("line").notNull(),         // [[E,N],...] in LV95
});

/** Gespeicherter Bereich (Polygon) für Teil-Volumen Cut/Fill. */
export const regions = hv.table("regions", {
  id: uuid("id").primaryKey().defaultRandom(),
  comparisonId: uuid("comparison_id").notNull().references(() => comparisons.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  polygon: jsonb("polygon").notNull(),   // [[E,N],...] in LV95
  volumes: jsonb("volumes"),             // { cut_m3, fill_m3, net_m3, area_m2 } (zuletzt berechnet)
});
