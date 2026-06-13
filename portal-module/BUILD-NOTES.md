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
- **Sidebar** (`components/Sidebar.tsx`, eingebunden in `app/layout.tsx`):
  kanonische Birchmeier-App-Sidebar (HELLES Theme). App-Optionen oben
  („Projekte"), Gruppe „Apps" unten mit der einheitlichen App-Liste. Die Liste
  kommt aus `/api/portal/modules-meta` (echte lucide-Icons/Labels/Pfade, per
  Portal-JWT gefiltert; admin sieht alle, sonst nur freigeschaltete Module);
  fehlt der Endpoint, greift die lokale Registry (`lib/apps.ts`).
  - **WICHTIG — Railway-ENV `PORTAL_URL`**: Damit der serverseitige Vorabruf
    (`lib/portal-modules.ts`) die echten Modul-Metadaten holt, muss `PORTAL_URL`
    gesetzt sein, intern `http://portal.railway.internal:8080`. Ohne `PORTAL_URL`
    rendert die Sidebar nur die lokale Fallback-Registry. Der Client-Nachzug
    (`fetch("/api/portal/modules-meta")`) läuft gleich-origin über das Gateway
    und braucht keine ENV.
  - Aktiver App-eigener Nav-Punkt via `usePathname()`; aktive App (diese hier =
    `hoehenvergleich`) in der „Apps"-Liste hervorgehoben.
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

## 3D-Viewer (Potree)

Zusätzlich zur 2D-Karte gibt es eine 3D-Ansicht (Default-Tab) in
`app/comparisons/[id]/view-client.tsx` (Tabs „3D-Viewer" / „2D-Karte").

- **Datengrundlage**: Der Compute erzeugt pro Vergleich (job_id) per
  `POST /jobs/{id}/build3d` einen Potree-2.0-Octree + Soll-GLB + `scene.json`
  (idempotent, persistiert auf dem Compute-**Volume**). `build3d` läuft in
  `app/api/projects/[id]/comparisons/route.ts` direkt NACH `compare()`, solange
  die job_id noch im RAM-Cache des Compute liegt (try/catch — 3D ist optional,
  Fehler nicht fatal; `octree_ready`/`points` werden geloggt).
- **Proxy-Routen** (Browser lädt NICHT direkt vom internen Compute):
  - `GET /api/comparisons/[id]/scene` → proxyt `scene.json` und schreibt
    `cloudUrl`/`meshUrl` auf die App-eigenen Pfade um (inkl. basePath).
  - `GET /api/comparisons/[id]/cloud/[...path]` → proxyt die Octree-Dateien.
    **Range-Durchreichung**: der `range`-Request-Header wird an den Compute
    weitergegeben, die 206-Antwort inkl. `Content-Range`/`Accept-Ranges`/
    `Content-Length` 1:1 zurückgegeben, Body als Stream. Potree lädt
    `octree.bin`/`hierarchy.bin` per Range — ohne das lädt nichts.
  - `GET /api/comparisons/[id]/soll.glb` → proxyt das GLB (`model/gltf-binary`).
- **Potree-Assets** (statisch, `public/potree/`): Potree ist eine globale
  Script-Lib (`window.Potree`), kein npm-Modul → via `next/script`
  (afterInteractive) geladen, NICHT importiert. Pfade absolut `/potree/...`
  (next/script versieht sie mit dem basePath). `libs/` + `resources/` liegen
  vollständig im Repo (auf die nötigen Libs getrimmt: three.js, GLTFLoader,
  jquery, tween, proj4, BinaryHeap, plasio).
  - **WICHTIG**: `build/potree/potree.js` + `potree.css` sind Build-Artefakte und
    liegen NICHT im Potree-Git (`build/` dort `.gitignore`). Aktuell liegt nur ein
    **Platzhalter** im Repo — der echte 1.8-Build muss einmal eingespielt werden
    (siehe `public/potree/README.md`). Solange der Platzhalter aktiv ist, zeigt der
    Viewer einen Hinweis statt zu crashen; der Next-Build bleibt grün.
  - In `.gitignore` ist `build/` global ignoriert, `public/potree/build/**` aber
    explizit re-included (`!`), damit die Assets mitkommen.
  - Der Dockerfile-Runner kopiert `/app/public` → Assets sind im Container.
- **Viewer-Funktionen** (`components/Viewer3D.tsx`, nur clientseitig,
  `dynamic ssr:false`):
  - Octree via Proxy-`cloudUrl` (`Potree.loadPointCloud(.../cloud/metadata.json)`),
  - Einfärbung nach Skalarfeld `deviation` (Gradient); RGB-Umschalter falls
    `rgb_baked`,
  - Soll-GLB halbtransparent in `viewer.scene.scene` (GLTFLoader; Offset bereits
    serverseitig drin → NICHT nochmal verschieben),
  - Toleranz-Slider setzt das Farbfenster live auf ±tol,
  - Schnitt/Profil über Potrees `profileTool`,
  - Grundriss-Umschalter (`setCameraMode(ORTHOGRAPHIC)` + Top-Ansicht),
  - `pointBudget` 1.5 Mio + EDL für Performance.
- **Volume nötig**: Die 3D-Artefakte liegen persistent auf dem Compute-Volume.
  Ohne Volume gehen sie nach RAM-Cache-Ablauf verloren → 3D-Tab zeigt dann
  „keine 3D-Datengrundlage" (404 auf scene).

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
