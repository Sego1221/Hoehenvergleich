/**
 * Client für den Höhenvergleich-Compute-Service (FastAPI).
 * Wird vom Next-Portal-Modul serverseitig aufgerufen. Basis-URL via ENV.
 */
const BASE = process.env.HOEHENVERGLEICH_COMPUTE_URL ?? "http://localhost:8000";

export type Transform = { tE: number; tN: number; tH: number; angle_deg: number };

export type Stats = {
  cells: number; area_m2: number; cut_m3: number; fill_m3: number; net_m3: number;
  mean_m: number; median_m: number; std_m: number; min_m: number; max_m: number;
  on_target_pct: number; tol_m: number;
};

export type CompareResult = {
  job_id: string; stats: Stats; extent: [number, number, number, number];
  grid: { nx: number; ny: number; res: number };
  georef: { already_lv95: boolean; transformed: boolean };
};

export type Profile = {
  dist: number[]; soll: (number | null)[]; ist: (number | null)[];
  dz: (number | null)[]; length_m: number;
};

export type Volumes = {
  cells: number; area_m2: number; cut_m3: number; fill_m3: number; net_m3: number;
  mean_m?: number; median_m?: number; on_target_pct?: number;
};

/** Vergleich starten: Soll (IFC/TIN) + Ist (LAZ/LAS/DSM-GeoTIFF) hochladen. */
export async function compare(
  soll: Blob, sollName: string, ist: Blob, istName: string,
  opts: { res?: number; tol?: number; ground_pct?: number; exg_thr?: number;
          use_veg?: boolean; cap?: number; transform?: Transform } = {},
): Promise<CompareResult> {
  const fd = new FormData();
  fd.append("soll", soll, sollName);
  fd.append("cloud", ist, istName);
  for (const k of ["res", "tol", "ground_pct", "exg_thr", "use_veg", "cap"] as const) {
    if (opts[k] !== undefined) fd.append(k, String(opts[k]));
  }
  if (opts.transform) fd.append("transform", JSON.stringify(opts.transform));
  return req<CompareResult>("/compare", { method: "POST", body: fd });
}

/** Kennzahlen für neue Toleranz (Slider, ohne Neuberechnung). */
export function statsForTol(jobId: string, tol: number): Promise<Stats> {
  return req<Stats>(`/jobs/${jobId}/stats?tol=${tol}`);
}

/** Schnitt-Profil entlang Polylinie [[E,N],...] (LV95). */
export function profile(jobId: string, line: [number, number][], step?: number): Promise<Profile> {
  return req<Profile>(`/jobs/${jobId}/profile`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ line, step }),
  });
}

/** Cut/Fill-Volumen in Polygon-Auswahl [[E,N],...] (LV95). */
export function volume(jobId: string, polygon: [number, number][], tol = 0.05): Promise<Volumes> {
  return req<Volumes>(`/jobs/${jobId}/volume`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ polygon, tol }),
  });
}

/** PDF-Protokoll erzeugen (Karte, Kennzahlen, Bereiche, Schnitte). Liefert Bytes. */
export async function protocolPdf(jobId: string, ctx: Record<string, unknown>): Promise<ArrayBuffer> {
  const r = await fetch(`${BASE}/jobs/${jobId}/protocol.pdf`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ctx),
  });
  if (!r.ok) throw new Error(`Compute ${r.status}: ${await r.text()}`);
  return r.arrayBuffer();
}

export const geotiffUrl = (jobId: string) => `${BASE}/jobs/${jobId}/dz.tif`;
export const previewPngUrl = (jobId: string, tol = 0.05) => `${BASE}/jobs/${jobId}/dz.png?tol=${tol}`;

// ---------------------------------------------------------------------------
// 3D-Datengrundlage (Three-Punktwolke cloud.bin + Soll-GLB + scene.json)
// ---------------------------------------------------------------------------

export type Scene = {
  offset: [number, number, number];
  crs: string;                       // "EPSG:2056"
  binUrl: string;                    // "/jobs/{jobId}/cloud.bin" (Three-Punktwolke)
  binCount: number;                  // Anzahl Punkte in cloud.bin
  meshUrl: string;                   // "/jobs/{jobId}/soll.glb"
  cloudUrl?: string;                 // (legacy/optional) Octree-Metadata
  bbox: { min: [number, number, number]; max: [number, number, number] };
  deviation: {
    min: number; max: number; median: number;
    clip: number | null;
    field?: string; rgb_baked?: boolean;
  };
  points: number;
  mesh?: { vertices: number; faces: number };
  octree_ready?: boolean;
};

export type Build3dOpts = { bake_rgb?: boolean; clip?: number; force?: boolean };

/**
 * Octree + GLB + scene.json erzeugen (idempotent, persistiert auf Compute-Volume).
 * MUSS direkt nach compare() laufen, solange die job_id noch im RAM-Cache ist.
 */
export function build3d(jobId: string, opts: Build3dOpts = {}): Promise<Scene> {
  return req<Scene>(`/jobs/${jobId}/build3d`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
}

/** scene.json eines bereits gebauten Jobs (vom Volume). */
export function scene(jobId: string): Promise<Scene> {
  return req<Scene>(`/jobs/${jobId}/scene.json`);
}

// Serverseitige Compute-URLs (NICHT für den Browser; der lädt über die Proxy-Routen).
export const sceneUrl = (jobId: string) => `${BASE}/jobs/${jobId}/scene.json`;
export const cloudBaseUrl = (jobId: string) => `${BASE}/jobs/${jobId}/cloud`;
export const cloudUrl = (jobId: string, path: string) =>
  `${BASE}/jobs/${jobId}/cloud/${path.replace(/^\/+/, "")}`;
export const glbUrl = (jobId: string) => `${BASE}/jobs/${jobId}/soll.glb`;
export const cloudBinUrl = (jobId: string) => `${BASE}/jobs/${jobId}/cloud.bin`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init);
  if (!r.ok) throw new Error(`Compute ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}
