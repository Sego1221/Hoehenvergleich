-- Bauperimeter pro Projekt (Parzellengrenzen aus amtlicher Vermessung oder
-- manuell gezeichnet). Additiv/idempotent — nur neue Spalten, kein CREATE TABLE.
ALTER TABLE "hoehenvergleich"."projects"
  ADD COLUMN IF NOT EXISTS "perimeter" jsonb;          -- [[ [E,N], ... ], ...] (Liste von Polygonen, LV95)
ALTER TABLE "hoehenvergleich"."projects"
  ADD COLUMN IF NOT EXISTS "perimeter_parcels" jsonb;  -- [{ egrid, number, ak }] parallel zu perimeter
