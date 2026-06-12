# Höhenvergleich — Portal-Modul

Soll-Ist-Aushubkontrolle in Schweizer Landeskoordinaten (LV95, EPSG:2056).
Next.js-App-Router-Modul für das Birchmeier-Apps-Portal.

## Was das Modul macht

- **Projekt-/Transform-Verwaltung**: Baustellen anlegen, Georef-Transformation
  lokal↔LV95 je Projekt speichern (`LV95 = Rz(−α)·(lokal − T)`).
- **Vergleich anstossen**: Soll (IFC/TIN) + Ist (LAZ/LAS/DSM-GeoTIFF) hochladen,
  an den Python-Compute-Service schicken (`lib/computeClient.compare`), Ergebnis +
  Kennzahlen als `comparison`-Zeile persistieren (= Historie).
- **Ergebnis-Visualisierung**: Leaflet-Karte in LV95 mit Swisstopo SWISSIMAGE
  (WMTS) als Basiskarte, ΔZ-Overlay (GeoTIFF via `georaster-layer-for-leaflet`,
  PNG-Fallback), Live-Toleranz-Slider (0–20 cm) der Kennzahlen/Einfärbung ohne
  Neuberechnung aktualisiert, Kennzahl-Kacheln (Cut/Fill/Netto/% auf Soll).
- **Schnitte & Bereiche**: Schnittlinien zeichnen → Profil-Diagramm
  (Soll/Ist/ΔZ); Bereichs-Polygone zeichnen → Cut/Fill der Auswahl; beides
  speicherbar.
- **PDF-Protokoll**: Titel/Projekt/Datum/Schnitte/Bereiche an den Compute-Service,
  Download im Browser.

Der schwere Geometrie-Compute läuft im separaten Python-Service
(`HOEHENVERGLEICH_COMPUTE_URL`). Dieses Modul ist die Verwaltungs-/Visualisierungs-Schicht.

## Stack

Next.js 14 (App Router) · Drizzle ORM · Railway-Postgres · Leaflet + proj4leaflet ·
georaster-layer-for-leaflet. Eigene Cookie-Auth via Portal-JWT (SSO, Stub).

## Lokal starten

```bash
cp .env.example .env        # DATABASE_URL + HOEHENVERGLEICH_COMPUTE_URL setzen
npm install
npm run db:migrate          # Schema in die DB (Railway-PG oder lokal)
npm run dev                 # http://localhost:3000
```

Ohne erreichbare DB lädt die Startseite mit Fehlerhinweis statt Crash. Für echte
Vergleiche muss der Compute-Service laufen (Default `http://localhost:8000`).

## API (Route Handler)

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET/POST | `/api/projects` | Projekte listen / anlegen |
| GET/PATCH/DELETE | `/api/projects/[id]` | Projekt lesen/ändern/löschen |
| GET/PUT | `/api/projects/[id]/transform` | Transform lesen/speichern |
| GET/POST | `/api/projects/[id]/comparisons` | Historie / neuen Vergleich starten |
| GET/DELETE | `/api/comparisons/[id]` | Vergleich (inkl. Schnitte/Bereiche) |
| GET | `/api/comparisons/[id]/stats?tol=` | Live-Kennzahlen für Toleranz |
| POST | `/api/comparisons/[id]/profile` | Schnitt-Profil (optional speichern) |
| GET/POST/DELETE | `/api/comparisons/[id]/sections` | Schnitte verwalten |
| GET/POST/DELETE | `/api/comparisons/[id]/regions` | Bereiche + Volumen |
| GET | `/api/comparisons/[id]/dz?fmt=tif\|png` | ΔZ-Overlay-Proxy |
| POST | `/api/comparisons/[id]/protocol` | PDF-Protokoll (Download) |

## Deploy (Railway EU + GitHub)

- GitHub-Repo → Railway-Service (Region **EU**, Frankfurt/Amsterdam, wegen DSG/DSGVO).
- `git push` triggert Auto-Deploy. **Kein** `railway up` (OneDrive-Stale-Falle).
- Postgres als eigener Railway-Service in derselben EU-Region; `DATABASE_URL` als
  Service-Variable. `HOEHENVERGLEICH_COMPUTE_URL` auf den Compute-Service zeigen.
- Migration vor Cutover prüfen (additiv, kein `CREATE TABLE` für bestehende Tabellen).
- Dockerfile vorhanden (Azure-ready). Railway-Builder bei Bedarf auf NIXPACKS pinnen,
  damit kein überraschender Docker-Switch erfolgt.
