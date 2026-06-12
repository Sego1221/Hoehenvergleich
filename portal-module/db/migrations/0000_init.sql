-- Initiale Migration Höhenvergleich. Eigenes Schema (Muster wie lastplaner/portal),
-- additiv/idempotent (IF NOT EXISTS).
CREATE SCHEMA IF NOT EXISTS "hoehenvergleich";

CREATE TABLE IF NOT EXISTS "hoehenvergleich"."projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "projekt_nummer" text NOT NULL,
  "name" text NOT NULL,
  "adresse" text,
  "ort" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "projects_nummer_idx" ON "hoehenvergleich"."projects" ("projekt_nummer");

CREATE TABLE IF NOT EXISTS "hoehenvergleich"."project_transforms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "label" text DEFAULT 'Standard' NOT NULL,
  "t_e" double precision NOT NULL,
  "t_n" double precision NOT NULL,
  "t_h" double precision NOT NULL,
  "angle_deg" double precision DEFAULT 0 NOT NULL,
  "unit" text DEFAULT 'm' NOT NULL,
  "verified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_transforms_project_id_fk" FOREIGN KEY ("project_id")
    REFERENCES "hoehenvergleich"."projects"("id") ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS "hoehenvergleich"."comparisons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "survey_date" timestamptz,
  "soll_name" text,
  "ist_name" text,
  "soll_kind" text,
  "ist_kind" text,
  "params" jsonb NOT NULL,
  "stats" jsonb,
  "result_ref" text,
  "compute_job_id" text,
  "created_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "comparisons_project_id_fk" FOREIGN KEY ("project_id")
    REFERENCES "hoehenvergleich"."projects"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "comparisons_project_idx" ON "hoehenvergleich"."comparisons" ("project_id");

CREATE TABLE IF NOT EXISTS "hoehenvergleich"."sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comparison_id" uuid NOT NULL,
  "name" text NOT NULL,
  "kind" text,
  "line" jsonb NOT NULL,
  CONSTRAINT "sections_comparison_id_fk" FOREIGN KEY ("comparison_id")
    REFERENCES "hoehenvergleich"."comparisons"("id") ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS "hoehenvergleich"."regions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comparison_id" uuid NOT NULL,
  "name" text NOT NULL,
  "polygon" jsonb NOT NULL,
  "volumes" jsonb,
  CONSTRAINT "regions_comparison_id_fk" FOREIGN KEY ("comparison_id")
    REFERENCES "hoehenvergleich"."comparisons"("id") ON DELETE cascade
);
