# Höhenvergleich — Einbindung ins Apps-Portal (Beta, nur sandro.egloff)

Stand 2026-06-12. Architektur: **zwei Railway-Services** + Gateway-Route + Portal-Modul (Beta) + Freischaltung.

```
Browser ── apps.birchmeier-gruppe.ch ── Gateway ──/hoehenvergleich──► [Next-Modul]  (Portal-Auth, UI)
                                                                          │ HOEHENVERGLEICH_COMPUTE_URL
                                                                          ▼
                                                              [Python-Compute] (FastAPI, intern)
```

## Was im CODE bereits erledigt ist (in diesem Repo)
- **Gateway** `apps-gateway/server.mjs`: Route `{ prefix: "/hoehenvergleich", module: "hoehenvergleich", upstream: UPSTREAM_HOEHENVERGLEICH }` + Status-Service „Höhenvergleich (Beta)" (Gruppe App-Beta).
- **Next-Modul** `portal-module/`: echte Portal-JWT-Verifikation (`lib/auth.ts`, Cookie `portal_session`, Issuer `birchmeier-portal`), `middleware.ts` erzwingt Modul-Gate `hoehenvergleich` (Redirect ins Portal sonst), `next.config.mjs` basePath via `NEXT_PUBLIC_BASE_PATH`, `app/api/health`, Dockerfile mit Build-Arg `NEXT_PUBLIC_BASE_PATH=/hoehenvergleich`. `jose` als Dependency.
- **Compute** `compute/`: FastAPI-Service (Engine verifiziert), Dockerfile, railway.json.

## Manuell (Railway-Dashboard + Portal-Admin) — nicht von hier ausführbar (Shell instabil)

### A) Service „hoehenvergleich-compute" (Python, intern)
Kann der bereits angelegte Service mit Volume sein (gut für grosse Temp-Uploads).
- Build: Repo-Root `compute/` (Dockerfile dort).
- Region: **EU**.
- ENV:
  ```
  PORT=8000
  ```
- Kein Gateway-Routing nötig (rein intern). Interner Host = ursprünglicher Service-Name, z.B. `hoehenvergleich-compute.railway.internal:8000`.

### B) Service „hoehenvergleich-web" (Next-Modul, Gateway-facing)
- Build: Repo-Root `portal-module/` (Dockerfile dort), Build-Arg `NEXT_PUBLIC_BASE_PATH=/hoehenvergleich`.
- Region: **EU**.
- ENV:
  ```
  NODE_ENV=production
  PORT=3000
  NEXT_PUBLIC_BASE_PATH=/hoehenvergleich
  PORTAL_JWT_SECRET=<identisch mit Portal-Service>
  PORTAL_HOME_URL=https://apps.birchmeier-gruppe.ch/
  DATABASE_URL=postgresql://...?sslmode=require            # Schema separat, s.u.
  HOEHENVERGLEICH_COMPUTE_URL=http://hoehenvergleich-compute.railway.internal:8000
  ```
- DB-Schema anlegen (eigene Tabellen, nicht ins portal-Schema mischen):
  ```sql
  CREATE SCHEMA IF NOT EXISTS hoehenvergleich;
  ```
  Drizzle-Migration aus `portal-module/` generieren/ausführen (`npm run db:generate && npm run db:migrate`).

### C) Gateway-Service
- ENV ergänzen:
  ```
  UPSTREAM_HOEHENVERGLEICH=http://hoehenvergleich-web.railway.internal:3000
  ```
- Gateway **neu deployen** (ROUTES/Status wurden im Code geändert).

### D) Portal-Modul registrieren (Beta) + nur sandro.egloff freischalten
Bevorzugt über **Portal-Admin-UI** (`apps.birchmeier-gruppe.ch` → Admin → Module):

| Feld | Wert |
|---|---|
| Typ | App (über Gateway) |
| ID | `hoehenvergleich` |
| Name | Höhenvergleich |
| Basis-Pfad | `/hoehenvergleich` |
| Upstream-URL | `http://hoehenvergleich-web.railway.internal:3000` |
| Icon | `Ruler` (lucide) |
| Sortierung | 10 |
| Kanal | **Beta** |
| Aktiv | ja |

Dann Admin → Benutzer → `sandro.egloff` → „Module bearbeiten" → unter **Beta** das Modul `Höhenvergleich` auf **grant**.

Alternativ direkt per SQL (Portal-DB, Schema `portal`):
```sql
INSERT INTO portal.modules
  (id, name, description, base_path, upstream_url, icon, "order", is_active, channel)
VALUES
  ('hoehenvergleich', 'Höhenvergleich', 'Soll-Ist-Aushubkontrolle (LV95)',
   '/hoehenvergleich', 'http://hoehenvergleich-web.railway.internal:3000',
   'Ruler', 10, true, 'beta')
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name, base_path=EXCLUDED.base_path,
  upstream_url=EXCLUDED.upstream_url, channel='beta', is_active=true;

INSERT INTO portal.user_modules (user_id, module_id, mode)
SELECT id, 'hoehenvergleich', 'grant' FROM portal.users
WHERE email = 'sandro.egloff@birchmeier-gruppe.ch'
ON CONFLICT (user_id, module_id) DO UPDATE SET mode='grant';
```

## Verifizieren
1. Beide App-Services `RUNNING`; `…/hoehenvergleich-compute/health` (intern) und `/hoehenvergleich/api/health` (über Gateway) liefern ok.
2. Als **sandro.egloff** einloggen → Sidebar zeigt unter „Beta" das Modul Höhenvergleich → öffnet `/hoehenvergleich`.
3. Anderer Benutzer → Modul NICHT sichtbar, direkter Aufruf `/hoehenvergleich` → Redirect ins Portal.
4. Vergleich durchführen (IFC/TIN + LAZ/DSM) → Karte, Toleranz-Slider, Schnitte, Volumen, PDF.

## Hinweis Deploy-Weg
GitHub-Auto-Deploy bevorzugt (kein `railway up` aus dem OneDrive-Ordner). Repo `Sego1221/Hoehenvergleich` mit beiden Unterordnern; je Service das passende Root-Verzeichnis (`compute/` bzw. `portal-module/`) setzen.
```
