# Höhenvergleich — Soll-Ist-Kontrolle

Eigenständige Birchmeier-Portal-App: vergleicht ein **Soll-Modell** (IFC oder Dreiecksvermaschung/TIN)
gegen die **As-Built-Punktwolke** (PIX4D) und liefert Abweichungskarte, Cut/Fill-Kubatur,
Schnitte/Profile und PDF-Protokoll. Alles in LV95.

## Architektur
- **compute/** — Python/FastAPI Compute-Service (stateless). Eigene Engine, keine Fremd-Cloud.
- **portal-module/** — Next-Modul im Apps-Portal (UI, Auth/SSO, Projekt-/Historie-Verwaltung). *(folgt)*

Deploy: Railway EU, GitHub-Auto-Deploy, Dockerfile (Azure-ready). Kein `railway up`.

## Compute-Service lokal starten
```bash
cd compute
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Endpunkte
| Methode | Pfad | Zweck |
|---|---|---|
| GET  | `/health` | Status |
| POST | `/compare` | Soll (IFC/TIN) + Ist (LAZ/LAS/DSM-GeoTIFF) hochladen → `job_id` + Statistik + Extent |
| GET  | `/jobs/{id}/stats?tol=` | Kennzahlen für neue Toleranz (Slider, ohne Neuberechnung) |
| POST | `/jobs/{id}/profile` | Schnitt entlang Polylinie `{"line":[[E,N],...]}` → Soll/Ist/ΔZ-Profil |
| GET  | `/jobs/{id}/dz.tif` | ΔZ als GeoTIFF (EPSG:2056) |
| GET  | `/jobs/{id}/dz.png?tol=` | ΔZ-Heatmap PNG (Vorschau) |

## Engine (selbst gebaut)
`compute/app/engine.py` — Mesh→Soll-DSM (Z-Buffer), Wolke→Boden-DSM (Perzentil + RGB-Vegetationsfilter)
oder DSM-GeoTIFF direkt, ΔZ/Cut-Fill/Statistik, Schnitt-Sampling.
`compute/app/georef.py` — LV95-Erkennung + Transformation lokal↔LV95 (pro Projekt hinterlegt).

Bibliotheken nur fürs Format-Lesen/Export: ifcopenshell, laspy+lazrs, trimesh, rasterio, matplotlib, reportlab.

## Validierung (Referenz Müligasse Döttingen)
Aushubmodell vs. Punktwolke: Cut 6'535 m³ / Fill 934 m³, ~9 s für 8 Mio Punkte. Georeferenzierung
eines lokalen Tekla-Modells via Projekt-Transformation (T=(−2'591'403.354, −1'406'501.39, −322) m, 3°)
gegen das LV95-Aushubmodell verifiziert.

Plan & Details: [hoehenvergleich-app/MVP-PLAN.md](MVP-PLAN.md).
