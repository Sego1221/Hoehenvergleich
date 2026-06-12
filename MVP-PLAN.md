# MVP-Plan — Eigenständige App „Soll-Ist-Kontrolle" (Höhen-/Lagevergleich)

Stand: 2026-06-12. Basis: validierter PoC + lauffähiges CLI-Tool (`hoehenvergleich.py`).
Eigenes Portal-Modul, **nicht** Teil der PIX4D-Ausmass-Protokoll-App.

## 1. Zweck
Vergleicht ein **Soll-Modell** gegen die **As-Built-Punktwolke** und prüft Höhen-/Lagerichtigkeit:
- **Soll-Quelle A: IFC** (aus Trimble Connect) — Aushub-/Terrain-/Bauteilmodell.
- **Soll-Quelle B: DWG** (2D/3D gemischt) — „sind die Elemente richtig" gegen die Realität.
- **Ist: Punktwolke** (aus PIX4D), optional DSM-GeoTIFF.

Ausgaben: ΔZ-Abweichungskarte, Cut/Fill-Kubatur, **element­weise Korrektheits-Prüfung**, Statistik, PDF-Protokoll, georeferenziertes GeoTIFF.

## 2. Bestätigte Entscheide (2026-06-12)
- Eigenständige App (Portal-Modul), nicht im Ausmass-Protokoll.
- DWG-Variante = **DWG-Geometrie gegen Punktwolke** (As-Built-Lagekontrolle), DWG-Inhalt **2D und 3D gemischt**.
- Daten-Anbindung **direkt per API**: IFC aus Trimble Connect, Wolke aus PIX4D.
- IFC = Soll, Wolke = Ist; ΔZ = Ist − Soll (+ = Material über Soll).

## 3. PoC-/Tool-Stand (Beleg)
- LV95 + LN02 beidseitig → deckungsgleich ohne Align (Median-Offset +9 cm).
- Pipeline: ifcopenshell (world-coords) → Soll-DSM (Z-Buffer max); Wolke RGB-ExG-Vegetationsfilter (~32 %) + Boden-Perzentil P20; Differenz 25 cm.
- Ergebnis Referenzdatensatz: Cut 6'535 m³, Fill 934 m³, 27.8 % auf Soll, ~9 s.
- CLI-Tool exportiert GeoTIFF (EPSG:2056), PNG, JSON, PDF. **Hinweis:** `--max-thick` nicht nutzen (verwirft Böschungs-Slabs).

## 4. Architektur / Datenfluss
```
Trimble Connect (IFC) ─┐                      ┌─ ΔZ-GeoTIFF (LV95)
PIX4D (Punktwolke) ────┼─ Connector/API ──► Worker (Python) ─┼─ Cut/Fill + Elementliste (JSON)
DWG-Upload/Quelle ─────┘   + Validierung      │  Soll→DSM/Mesh │  PNG-Overlay
                                              │  Ist→Bodenraster│  PDF-Protokoll
                                              └─────────────────┴─► Portal-UI (Leaflet, Klick-Wert)
```

## 5. Soll-Quellen
### 5a. IFC (Trimble Connect)
- OAuth2 (Trimble Identity), Projekt/Datei wählen, IFC laden → bestehende ifcopenshell-Pipeline.
- Layer-/Modell-Auswahl als Soll-Fläche (Referenzfall: Layer „Aushub Ebenen").

### 5a-G. Georeferenzierung (lokal ↔ LV95) — Kernfunktion
**Trennung Projekt-Konfiguration vs. Modell-Import:**

**Pro Projekt hinterlegt** (einmal, wiederverwendbar für alle Modelle des Projekts):
- Transformation **lokal ↔ LV95**: Translation E/N/H + Drehung-Z, Massstab = 1.
  - Beispiel Müligasse Döttingen: T = (−2'591'403.354, −1'406'501.39, −322) m, Drehung 3°.
  - Konvention: `LV95 = Rz(−α)·(lokal − T)` (T = gespeicherte negative Offsets). Vor Speichern an Referenz verifizieren (Restklaffen anzeigen).
- Einheit des lokalen Modells (mm/m) — Tekla exportiert in **mm**.

**Pro Modell-Import (automatisch):**
1. **Erkennen ob LV95**: Bounding-Box gegen Schweizer LV95-Bereich (E ≈ 2.48–2.84 Mio, N ≈ 1.07–1.30 Mio). Innerhalb → bereits LV95 (z.B. Allplan-Aushubmodell). Ausserhalb/kleine Zahlen nahe 0 → lokal. Eindeutig, da Grössenordnungen sich nicht überschneiden.
2. **Nötigenfalls transformieren**: bei „lokal" die hinterlegte Projekt-Transformation anwenden → LV95.
3. **Kein Projekt-Transform vorhanden + nicht LV95** → Fallback: Basispunkt eingeben **oder** Passpunkt-Align (3+ Punkte IFC↔Wolke/Ortho, starre Transformation, kein Massstab).

- Hinweise: IFC2X3 (Tekla) kennt keine IfcMapConversion → nur über Projekt-Transform/Align lösbar. IFC4 kann IfcMapConversion tragen → dann Auto-Detect daraus. Tekla-Placement dreht Vertikale auf Y; ifcopenshell `use-world-coords` löst das korrekt nach Z auf.

### 5b. DWG (2D + 3D gemischt) — eigener Reader nötig
- **DWG ist proprietär**; kein robuster reiner Python-Reader. Weg: **ODA File Converter (gratis) DWG→DXF**, dann `ezdxf` lesen. 3D-ACIS-Solids sind der harte Teil (Tessellierung); ggf. ODA-SDK oder DWG→IFC/OBJ-Konverter für 3D.
- **2D vs 3D = unterschiedliche Prüflogik** (App erkennt automatisch):
  - **3D-Elemente** → vertikaler ΔZ-Vergleich wie IFC.
  - **2D-Elemente** (Linien/Polylinien/Blöcke, kein Z) → **Lage-/Footprint-Prüfung in XY**: liegt das Element dort, wo die Punktwolke ein entsprechendes Objekt zeigt? Höhe nicht prüfbar.

## 6. Elementweise Korrektheits-Prüfung („sind die Elemente richtig")
Pro Soll-Element (IFC-Bauteil bzw. DWG-Entity):
- **Vorhanden?** Hat die Wolke im Element-Footprint überhaupt Punkte?
- **Lage XY** korrekt (Versatz < Toleranz)?
- **Höhe Z** korrekt (mittleres ΔZ < Toleranz)?  → Ampel grün/gelb/rot je Element.
- Ergebnis als sortierbare Elementliste + Einfärbung in Karte/3D.
> Das ist granularer als das Raster und der eigentliche „Elemente richtig"-Mehrwert.

### 6a. Bau-Status-Erkennung (gebaut / nicht gebaut)
Pro IFC-Element aus der Punktwolken-Abdeckung ableiten, ob es bereits **gebaut** ist (Scan-vs-BIM-Fortschritt):
- Hohe Abdeckung nahe der Soll-Oberfläche → **gebaut**; Wolke nur auf Umgebungs-/Bodenniveau → **nicht gebaut**.
- **Drei Status** (nicht zwei): `gebaut` / `nicht gebaut` / **`verdeckt-unklar`**.
- **Limitierung (wichtig):** Photogrammetrie sieht nur sichtbare Oberflächen → verdeckte/eingebaute/hinterfüllte Bauteile (Fundamente, Leitungen, alles unter Terrain) sind nicht beurteilbar → Status `verdeckt-unklar`, NICHT fälschlich „nicht gebaut".
- Fortschritts-% übers Modell; optional Wolke-gegen-Wolke (zwei Flüge) zeigt Neubau zwischen zwei Zeitpunkten ohne Soll-Bezug.
- Testet sinnvoll nur mit **strukturellem IFC** (Wände/Stützen/Decken), nicht mit dem Aushub-Flächenmodell.

## 7. UI (kompakt, Portal-Style, Custom-Controls)
- Quelle wählen (Trimble-Projekt / PIX4D-Output / DWG-Upload).
- Parameter: Rasterweite, Vegetationsfilter, Boden-Perzentil.
- **Toleranz als interaktiver Custom-Slider** (NIE fix im Code): ±0–20 cm, Default ±5 cm, app-eigenes Styling (kein Browser-Default). ΔZ-Raster wird **einmal** gerechnet; Slider schwellt nur die fertigen ΔZ-Werte clientseitig um → **Live-Update** von Karte/Kategorien/„% auf Soll" beim Schieben, keine Neuberechnung. Optional zweites Band (Warnung, z.B. ±15 cm). Zuletzt gewählter Wert = Projekt-Default, jederzeit überschiebbar. Später XY-Toleranz (Elementlage) analog als Slider.
- Ergebnis: Leaflet-ΔZ-Overlay über Ortho, Klick=Wert; Kennzahl-Kacheln (Cut/Fill/% auf Soll, live); **Elementliste mit Ampel**; Histogramm; PDF-Export.
- **Schnitte/Profile**: im Grundriss beliebig viele Schnittlinien legen (Längs + Quer) → Profil-Diagramm Distanz vs. Höhe mit **Soll-Linie, Ist-Linie und ΔZ-Band**. Linie zeichnen → entlang sampeln (Soll-DSM/Ist-DSM/ΔZ), kein Neuberechnen. Schnitte benennbar/speicherbar, in PDF exportierbar.
  - *Fundament-Implikation:* Service hält **Soll-DSM + Ist-DSM + ΔZ** (nicht nur ΔZ); Profil-Sampling als günstige Interpolation entlang der Linie (Backend-Endpoint `/profile` oder clientseitig aus den Rastern).

## 8. Tech-Stack
- **Worker**: Python (ifcopenshell, laspy+lazrs, numpy, rasterio, reportlab; `ezdxf` + ODA File Converter für DWG).
- **Connectoren**: Trimble Connect REST API (OAuth2/TID); PIX4D — siehe Risiko unten.
- **Portal**: Modul `sollist` im Apps-Portal (Auth/Sidebar/Freischaltung wie übrige Apps), Frontend Leaflet + Custom-UI.
- **Deploy**: Railway EU (DSG), GitHub-Auto-Deploy, Dockerfile (Azure-ready).

## 9. Offene Risiken / Entscheide (mit Empfehlung)
1. **PIX4D-API = Kostenrisiko.** Frühere Erkenntnis (Ausmass-Protokoll): PIX4D-API zu teuer → damals Upload. *Empfehlung:* Trimble Connect jetzt per API; PIX4D nur per API, wenn Kosten/Endpunkt (PIX4D Cloud) geklärt — sonst **überwachter Ordner / Upload der PIX4D-Outputs** als pragmatischer Ersatz. Vor dem Bau Kosten + verfügbare Endpunkte prüfen.
2. **DWG-3D-Tessellierung** ist der technische Hauptaufwand (ACIS-Solids). *Empfehlung:* MVP startet mit ODA→DXF + ezdxf für 2D + einfache 3D-Faces; komplexe 3D-Solids in Ausbaustufe, an realem DWG evaluieren, bevor zugesagt.
3. **2D-DWG hat kein Z** → nur XY-/Footprint-Prüfung möglich. *Empfehlung:* App trennt 2D-Lage- von 3D-Höhenprüfung sichtbar, kein Vortäuschen von Z-Werten.
4. **Toleranz** = interaktiver Slider, nicht fix (entschieden 2026-06-12). Default ±5 cm, Bereich ±0–20 cm; Live-Umschwellen ohne Neuberechnung. XY-Toleranz später analog.
5. **Höhenbezug** LN02 vs. LHN95 standardisieren (Offset-Warnung in Validierung).

## 10. Phasen
- **P0** ✓ CLI-Tool IFC↔Wolke (GeoTIFF/PNG/JSON/PDF).
- **P1** Worker + Job-Queue + Validierung (CRS/Überlappung/Einheiten/Höhenbezug) + **Georeferenzierung lokaler Modelle (Auto-MapConversion → Basispunkt → Passpunkt-Align)**.
- **P2** Trimble-Connect-Connector (OAuth, IFC laden) + PIX4D-Anbindung gemäss Risiko 1.
- **P3** Portal-Modul-Skeleton (Auth, Sidebar, Quelle wählen, Status) + Ergebnis-UI (Leaflet, Kennzahlen).
- **P4** Elementweise Prüfung + Elementliste/Ampel **inkl. Bau-Status (gebaut/nicht gebaut/verdeckt-unklar)**.
- **P5** DWG-Import (2D-Lage zuerst, dann 3D) gemäss Risiko 2/3.
- **P6** PDF-Protokoll, Parameter-Persistenz, Härtung.

## 11. Klären vor Bau
- Liegt die Wolke in **PIX4D Cloud** (API) oder als lokaler Desktop-Output (PIX4Dmapper/matic → Datei)? Bestimmt PIX4D-Anbindung.
- Welche Trimble-Connect-Projekte/Region; App-Registrierung (TID-Client) vorhanden?
- DWG: gibt es ein reales Beispiel-DWG zum Testen des Readers?
- Verbindliche Toleranzen Z und XY; Höhenbezug-Standard.
