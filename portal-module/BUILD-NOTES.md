# BUILD-NOTES — Höhenvergleich-Portal-Modul

## Lokal starten

1. `cp .env.example .env`, `DATABASE_URL` (Railway-PG oder lokal) und
   `HOEHENVERGLEICH_COMPUTE_URL` setzen.
2. `npm install`
3. `npm run db:migrate` (Schema anlegen). Migration liegt unter `db/migrations/`.
4. `npm run dev` → http://localhost:3000
5. `npm run typecheck` / `npm run build` für Typecheck bzw. Production-Build.

Ohne DB: Startseite zeigt Fehlerpanel statt Crash. Ohne Compute-Service schlagen
nur die Vergleichs-/Profil-/Volumen-/PDF-Aufrufe fehl (mit Toast-Meldung).

## Portal-Integration: gesetzte Stubs (TODO)

- **Auth/JWT** (`lib/auth.ts`): `getCurrentUser()` dekodiert das Cookie
  `portal_jwt` OHNE Signaturprüfung und fällt sonst auf einen Dev-Benutzer
  zurück. `hasModuleAccess()` gibt im Dev immer `true`.
  TODO: Portal-JWT mit `PORTAL_JWT_SECRET`/JWKS verifizieren, Modul-Freischaltung
  (`hoehenvergleich`) prüfen, bei fehlender Berechtigung auf Portal-Login leiten
  (z.B. via `middleware.ts`).
- **Sidebar** (`app/layout.tsx`): minimaler Stub. TODO: kanonische Birchmeier-
  Sidebar einsetzen — App-Optionen oben, Gruppe „Apps" unten mit Icons aus
  `/api/portal/modules-meta`, App-Liste aus dem JWT. Aktuell nur Modul-Links +
  Benutzername.
- **Single Domain / Gateway**: Annahme, dass das Modul hinter dem Portal-Gateway
  unter einem Pfad-Prefix läuft. `basePath`/`assetPrefix` in `next.config.mjs` bei
  Bedarf ergänzen (derzeit Root-Deploy angenommen).
- **CreatedBy/Audit**: `comparison.createdBy` wird mit `getCurrentUser().name`
  befüllt (Stub-Wert im Dev).

## Annahmen über den Compute-Service

- Entspricht exakt `lib/computeClient.ts`: `/compare` nimmt Felder `soll` + `cloud`
  (UI sendet `ist`, der Route-Handler mappt auf `cloud`), liefert `job_id` + `stats`
  + ggf. `extent`/`grid`.
- ΔZ-Overlay unter `/jobs/{id}/dz.tif` (GeoTIFF, georeferenziert in LV95) bzw.
  `/jobs/{id}/dz.png` (eingefärbte Vorschau). Der `dz`-Proxy reicht beides durch,
  damit der Browser nicht direkt auf den (intern erreichbaren) Service zugreift.
- `extent` (für Karten-Fit und PNG-Overlay-Bounds) wird, falls vorhanden, aus den
  gespeicherten `stats` gelesen. Liefert der Service `extent` separat (nicht in
  `stats`), in `comparisons.route.ts` zusätzlich in `stats` mergen.
- `statsForTol`, `profile`, `volume`, `protocol.pdf` wie im Client typisiert.

## Karten-/Geo-Annahmen

- CRS EPSG:2056 via `proj4leaflet` (`L.Proj.CRS`) mit Swisstopo-LV95-Resolutions
  und Origin `[2420000, 1350000]`; Basiskarte `ch.swisstopo.swissimage` (WMTS REST,
  öffentlich). Koordinaten intern als `[E, N]` (lng=E, lat=N).
- ΔZ-Einfärbung clientseitig relativ zur Live-Toleranz (`pixelValuesToColorFn`):
  innerhalb Toleranz neutral-grau, darunter rot (Cut), darüber grün (Fill).
- Eigenes hochgeladenes Ortho: Prop `orthoUrl` in `HoehenMap` vorgesehen, aber noch
  nicht verdrahtet (TODO: Upload-Endpoint + Tile/ImageOverlay).

## Bewusst weggelassen / offen

- Kein nativer `alert/confirm/prompt`/`select` — eigener Dialog/Select/Slider/Toast
  in `components/ui.tsx`.
- Browser-Autofill in Formularen via `autoComplete="off"` unterdrückt.
- Datenmigration aus einer evtl. Vorgänger-App: nicht Teil dieses Moduls.
- Echte Profil-/Bereichs-Benennung per Inline-Dialog statt fixem Default-Namen
  könnte noch ergänzt werden (aktuell automatischer Name beim Speichern).
