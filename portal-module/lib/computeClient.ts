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

/** Bauperimeter = Liste von Polygonen [[ [E,N],... ],...] (LV95). */
export type Perimeter = [number, number][][];

/** Kennzahlen für neue Toleranz (Slider, ohne Neuberechnung).
 *  Mit perimeter: nur innerhalb des Bauperimeters (Cut/Fill/% auf Soll). */
export function statsForTol(jobId: string, tol: number, perimeter?: Perimeter | null): Promise<Stats> {
  if (perimeter && perimeter.length) {
    return req<Stats>(`/jobs/${jobId}/stats`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tol, perimeter }),
    });
  }
  return req<Stats>(`/jobs/${jobId}/stats?tol=${tol}`);
}

/** ΔZ-Karte (tif/png) vom Compute holen — optional auf den Bauperimeter geclippt.
 *  Liefert die rohe Response, damit die Proxy-Route den Body streamen kann. */
export function fetchDz(
  jobId: string, fmt: "tif" | "png", tol: number, perimeter?: Perimeter | null,
): Promise<Response> {
  const hasP = !!(perimeter && perimeter.length);
  const path = fmt === "png" ? "dz.png" : "dz.tif";
  if (hasP) {
    return fetch(`${BASE}/jobs/${jobId}/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(fmt === "png" ? { tol, perimeter } : { perimeter }),
    });
  }
  return fetch(fmt === "png" ? previewPngUrl(jobId, tol) : geotiffUrl(jobId));
}

// ---------------------------------------------------------------------------
// Baufortschritt: elementweise Bauteilerkennung (Struktur-IFC vs Scan)
// ---------------------------------------------------------------------------
export type BauteilRow = {
  guid: string | null; name: string | null; bauteil: string | null;
  betonage: string | null; material: string | null;
  kote_ok: string | null; kote_uk: string | null; area_m2: number;
  status: "gebaut" | "nicht_gebaut" | "verdeckt";
  frac_gebaut: number; frac_nicht: number; frac_verdeckt: number;
  dz_mean: number | null; n_points: number;
};
export type BauteilResult = {
  summary: { n_elements: number; gebaut: number; nicht_gebaut: number; verdeckt: number };
  elements: BauteilRow[];
  job_id: string;
  transform_flipped: boolean | null;
  transform_warning: boolean;
  meshUrl?: string;
};

/** Struktur-IFC + Scan -> Status je Bauteil. transform: Strukturmodell-Georef. */
export async function bauteilEvaluate(
  soll: Blob, sollName: string, ist: Blob, istName: string,
  transform: { tE: number; tN: number; tH: number; angleDeg: number },
  opts: { res?: number; tol?: number } = {},
): Promise<BauteilResult> {
  const fd = new FormData();
  fd.append("soll", soll, sollName);
  fd.append("cloud", ist, istName);
  fd.append("transform", JSON.stringify({
    tE: transform.tE, tN: transform.tN, tH: transform.tH, angle_deg: transform.angleDeg,
  }));
  if (opts.res !== undefined) fd.append("res", String(opts.res));
  if (opts.tol !== undefined) fd.append("tol", String(opts.tol));
  return req<BauteilResult>("/bauteil/evaluate", { method: "POST", body: fd });
}

/** Status-GLB eines Baufortschritt-Laufs (vom Compute-Volume). */
export const statusGlbUrl = (jobId: string) => `${BASE}/jobs/${jobId}/status.glb`;

export type BfModelFile = { name: string; size: number; mtime?: number };
export type BfModelResult = {
  model_id: string; n_elements: number; betonagen: string[];
  elements: { guid: string | null; name: string | null; bauteil: string | null;
    betonage: string | null; material: string | null; kote_ok: string | null; kote_uk: string | null;
    color?: [number, number, number] | null }[];
  files?: BfModelFile[];
};

/** Liste der Etappen-Dateien eines Modells. */
export async function bauteilModelFiles(modelId: string): Promise<{ files: BfModelFile[] }> {
  return req<{ files: BfModelFile[] }>(`/bauteil/model/${modelId}/files`);
}

/** Ganzen Modell-Katalog loeschen. */
export async function bauteilModelDelete(modelId: string): Promise<void> {
  const r = await fetch(`${BASE}/bauteil/model/${modelId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Compute ${r.status}: ${await r.text()}`);
}

/** Etappen-IFC loeschen + Katalog neu aufbauen. */
export async function bauteilModelDeleteFile(modelId: string, name: string): Promise<BfModelResult> {
  const r = await fetch(`${BASE}/bauteil/model/${modelId}/files/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Compute ${r.status}: ${await r.text()}`);
  return r.json() as Promise<BfModelResult>;
}

/** Modell-Katalog anlegen/ergaenzen: mehrere IFCs + Projekt-Georef (forward). */
export async function bauteilModel(
  files: { blob: Blob; name: string }[],
  transform: { tE: number; tN: number; tH: number; angle_deg: number },
  modelId?: string,
): Promise<BfModelResult> {
  const fd = new FormData();
  for (const f of files) fd.append("ifcs", f.blob, f.name);
  fd.append("transform", JSON.stringify(transform));
  if (modelId) fd.append("model_id", modelId);
  return req<BfModelResult>("/bauteil/model", { method: "POST", body: fd });
}

/** Tages-Scan gegen einen Modell-Katalog auswerten. */
export async function bauteilScan(modelId: string, cloud: Blob, cloudName: string): Promise<BauteilResult> {
  const fd = new FormData();
  fd.append("cloud", cloud, cloudName);
  return req<BauteilResult>(`/bauteil/model/${modelId}/scan`, { method: "POST", body: fd });
}

/** Eine aus DXF gelesene Polylinie (Bauperimeter/Bereich). */
export type DxfPolyline = {
  layer: string; closed: boolean; n: number;
  points: [number, number][]; area_m2: number; looks_lv95: boolean;
};

/** DXF (serverseitig) parsen -> geschlossene Polylinien (LV95-Annahme). */
export async function dxfPolylines(file: Blob, filename: string): Promise<{ polylines: DxfPolyline[] }> {
  const fd = new FormData();
  fd.append("file", file, filename);
  return req<{ polylines: DxfPolyline[] }>(`/dxf/polylines`, { method: "POST", body: fd });
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
  cloudFormat?: string;              // "v2" = xyz_f32 + dev_f32 + rgb_u8
  hasRgb?: boolean;                  // Echtfarbe vorhanden
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
