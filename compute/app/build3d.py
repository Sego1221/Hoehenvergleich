# -*- coding: utf-8 -*-
"""3D-Datengrundlage für den Potree-Viewer.

Pro Vergleich (job_id) wird erzeugt:
  - eine LAS/LAZ-Punktwolke mit ExtraBytes-Skalarfeld "deviation" (ΔZ in m),
    optional RGB nach ΔZ-Rampe vorgebacken,
  - daraus ein Potree-2.0-Octree (metadata.json/hierarchy.bin/octree.bin) via PotreeConverter,
  - das Soll-IFC als GLB (trimesh), um denselben Offset verschoben wie die Wolke,
  - eine scene.json { offset, cloudUrl, meshUrl, bbox } für den Viewer.

Alle Artefakte liegen unter <DATA>/octrees/<job_id>/ auf dem Railway-Volume
(Fallback: System-Tempdir, falls kein Volume gemountet ist). Der Schritt ist
idempotent: existiert scene.json bereits, wird sie nur gelesen.

Präzision: LV95-Koordinaten (~2.6 Mio) sprengen float32. Cloud UND Mesh werden
um denselben Offset (Floor der gemeinsamen Min-Ecke) verschoben; der Viewer
addiert den Offset wieder hinzu. So bleiben Wolke und Mesh deckungsgleich.
"""
from __future__ import annotations
import json
import os
import shutil
import struct
import subprocess
import tempfile

import numpy as np

from . import engine


# ----------------------------- Pfade / Volume -----------------------------
def data_root() -> str:
    """Wurzel für persistente Artefakte. Railway-Volume bevorzugt, sonst Tempdir.

    WICHTIG: NICHT /srv oder /app (überdeckt Code). Default /data.
    """
    root = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") or "/data"
    try:
        os.makedirs(root, exist_ok=True)
        # Schreibtest: kein Volume gemountet -> Fallback auf Tempdir.
        probe = os.path.join(root, ".writetest")
        with open(probe, "w") as fh:
            fh.write("ok")
        os.remove(probe)
    except OSError:
        root = os.path.join(tempfile.gettempdir(), "hv_data")
        os.makedirs(root, exist_ok=True)
    return root


def job_dir(job_id: str) -> str:
    d = os.path.join(data_root(), "octrees", job_id)
    os.makedirs(d, exist_ok=True)
    return d


# ----------------------------- Ergebnis-Persistenz (überlebt Restarts) -----------
def _result_path(job_id: str) -> str:
    d = os.path.join(data_root(), "results")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, job_id + ".npz")


def save_result(job_id: str, result: "engine.Result") -> None:
    """Vergleichs-Raster + Meta auf dem Volume sichern, damit Stats/Profile/Volumen/
    dz.png/PDF nach einem Compute-Restart (RAM-Cache leer) weiter funktionieren."""
    g = result.grid
    p = _result_path(job_id)
    np.savez_compressed(p, soll_z=result.soll_z, ist_z=result.ist_z, dz=result.dz,
                        valid=result.valid,
                        grid=np.array([g.x0, g.y0, g.res, g.nx, g.ny], dtype=np.float64))
    try:
        with open(p + ".meta.json", "w", encoding="utf-8") as fh:
            json.dump(result.meta, fh, ensure_ascii=False, default=str)
    except OSError:
        pass


def load_result(job_id: str):
    """Persistiertes Ergebnis vom Volume laden (oder None)."""
    p = _result_path(job_id)
    if not os.path.exists(p):
        return None
    d = np.load(p)
    gg = d["grid"]
    grid = engine.Grid(float(gg[0]), float(gg[1]), float(gg[2]), int(gg[3]), int(gg[4]))
    meta = {}
    try:
        with open(p + ".meta.json", "r", encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, ValueError):
        pass
    return engine.Result(grid=grid, soll_z=d["soll_z"], ist_z=d["ist_z"],
                         dz=d["dz"], valid=d["valid"], meta=meta)


# ----------------------------- ΔZ-Farbrampe -----------------------------
def _deviation_rgb(dev: np.ndarray, clip: float = 0.30) -> np.ndarray:
    """ΔZ -> RGB (uint16, 0..65535) per RdYlBu_r-ähnlicher Rampe. NaN -> grau."""
    import matplotlib as mpl
    import matplotlib.colors as mcolors
    norm = mcolors.Normalize(vmin=-clip, vmax=clip, clip=True)
    rgba = mpl.colormaps["RdYlBu_r"](norm(np.nan_to_num(dev, nan=0.0)))
    rgb = (rgba[:, :3] * 65535.0).astype(np.uint16)
    rgb[~np.isfinite(dev)] = 32768  # aussen/keine Soll-Fläche -> neutralgrau
    return rgb


def _deviation_rgb_u8(dev: np.ndarray, clip: float = 0.30) -> np.ndarray:
    """ΔZ -> RGB (uint8, 0..255) per RdYlBu_r-Rampe. NaN -> grau."""
    import matplotlib as mpl
    import matplotlib.colors as mcolors
    norm = mcolors.Normalize(vmin=-clip, vmax=clip, clip=True)
    rgba = mpl.colormaps["RdYlBu_r"](norm(np.nan_to_num(dev, nan=0.0)))
    rgb = (rgba[:, :3] * 255.0).astype(np.uint8)
    rgb[~np.isfinite(dev)] = 150  # aussen/keine Soll-Fläche -> neutralgrau
    return rgb


# ----------------------------- Kompakte Binär-Wolke (Three.js-Viewer) -----------------------------
def export_cloud_bin(result: engine.Result, out_path: str,
                     max_points: int = 1_500_000, clip: float = 0.30) -> dict:
    """Ausgedünnte Wolke als kompaktes Binärformat (v2) für den Three.js-Viewer.

    Layout (little-endian, Floats 4-aligned, damit Float32Array-Views direkt gehen):
      uint32 count M
      M*3 float32  Positionen (relativ zum Offset, float32-tauglich)
      M   float32  deviation (ΔZ pro Punkt in m; NaN = ausserhalb Soll)
      M*3 uint8    Echtfarbe RGB (Original-Foto-RGB der Wolke; grau falls keine)
    Der Viewer färbt clientseitig: nach ΔZ (verstellbare Skala) ODER Echtfarbe.
    Offset = Floor der Wolken-Min-Ecke (auch für das Soll-GLB verwenden).
    """
    cloud_path = result.meta.get("cloud_path")
    if not cloud_path or not os.path.exists(cloud_path):
        raise ValueError("Quell-Punktwolke nicht verfügbar (cloud_path fehlt).")
    from . import georef
    xyz, rgb = engine.load_cloud(cloud_path)
    xyz, _ = georef.georeference(xyz, result.meta.get("cloud_transform"))
    dev = engine.point_deviations(result, xyz).astype(np.float32)
    offset = np.floor(xyz.min(axis=0))
    bbox_min = xyz.min(axis=0).tolist(); bbox_max = xyz.max(axis=0).tolist()

    n = xyz.shape[0]
    step = int(np.ceil(n / max_points)) if n > max_points else 1
    xyz = xyz[::step]; dev = dev[::step]
    if rgb is not None:
        rgb = rgb[::step]
    pos = (xyz - offset).astype(np.float32)

    # Echtfarbe auf uint8 0..255 bringen (Original kann 8- oder 16-bit sein).
    if rgb is None:
        col = np.full((pos.shape[0], 3), 180, dtype=np.uint8)
    else:
        r = rgb.astype(np.float64)
        if r.max() > 255:
            r = r / 257.0          # 16-bit -> 8-bit
        col = np.clip(r, 0, 255).astype(np.uint8)

    m = pos.shape[0]
    with open(out_path, "wb") as fh:
        fh.write(struct.pack("<I", m))
        fh.write(np.ascontiguousarray(pos).tobytes())                 # f32 *3M
        fh.write(np.ascontiguousarray(dev.astype(np.float32)).tobytes())  # f32 *M
        fh.write(np.ascontiguousarray(col).tobytes())                 # u8 *3M
    fin = dev[np.isfinite(dev)]
    return {"count": m, "total": int(n), "bytes": int(os.path.getsize(out_path)),
            "offset": offset.tolist(), "bbox_min": bbox_min, "bbox_max": bbox_max,
            "has_rgb": rgb is not None,
            "deviation_min": float(fin.min()) if fin.size else None,
            "deviation_max": float(fin.max()) if fin.size else None,
            "deviation_median": float(np.median(fin)) if fin.size else None}


# ----------------------------- LAS-Export mit deviation -----------------------------
def export_las_with_deviation(result: engine.Result, out_las: str,
                              bake_rgb: bool = True, clip: float = 0.30) -> dict:
    """Ist-Wolke (+ deviation-ExtraBytes) als LAS schreiben. Rückgabe: Statistik.

    Liest die Original-Punkte (+RGB) frisch aus der Quell-LAZ und georeferenziert
    sie wie im Vergleich. ΔZ pro Punkt via engine.point_deviations.
    """
    import laspy
    cloud_path = result.meta.get("cloud_path")
    if not cloud_path or not os.path.exists(cloud_path):
        raise ValueError("Quell-Punktwolke nicht verfügbar (cloud_path fehlt).")

    xyz, rgb = engine.load_cloud(cloud_path)
    from . import georef
    xyz, _ = georef.georeference(xyz, result.meta.get("cloud_transform"))

    dev = engine.point_deviations(result, xyz).astype(np.float32)

    header = laspy.LasHeader(point_format=3, version="1.4")
    header.offsets = np.floor(xyz.min(axis=0))
    header.scales = np.array([0.001, 0.001, 0.001])
    header.add_extra_dim(laspy.ExtraBytesParams(
        name="deviation", type=np.float32,
        description="dZ Punkt minus Soll [m]"))

    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    las.deviation = dev
    if bake_rgb:
        col = _deviation_rgb(dev, clip)
        las.red, las.green, las.blue = col[:, 0], col[:, 1], col[:, 2]
    elif rgb is not None:
        # Original-RGB kann 8- oder 16-bit sein -> auf 16-bit skalieren.
        r = rgb.astype(np.float64)
        if r.max() <= 255:
            r = r / 255.0 * 65535.0
        las.red, las.green, las.blue = (r[:, 0].astype(np.uint16),
                                        r[:, 1].astype(np.uint16),
                                        r[:, 2].astype(np.uint16))
    las.write(out_las)

    finite = dev[np.isfinite(dev)]
    return {
        "points": int(xyz.shape[0]),
        "offset": header.offsets.tolist(),
        "deviation_min": float(finite.min()) if finite.size else None,
        "deviation_max": float(finite.max()) if finite.size else None,
        "deviation_median": float(np.median(finite)) if finite.size else None,
        "nan_points": int((~np.isfinite(dev)).sum()),
        "bbox_min": xyz.min(axis=0).tolist(),
        "bbox_max": xyz.max(axis=0).tolist(),
    }


# ----------------------------- GLB-Export Soll -----------------------------
def export_soll_glb(result: engine.Result, out_glb: str, offset: np.ndarray) -> dict:
    """Soll-Mesh als GLB exportieren, um denselben Offset verschoben wie die Wolke."""
    import trimesh
    V, F = engine.soll_mesh_lv95(result)
    Vc = np.asarray(V, dtype=np.float64) - np.asarray(offset, dtype=np.float64)
    mesh = trimesh.Trimesh(vertices=Vc.astype(np.float32), faces=F, process=False)
    mesh.export(out_glb, file_type="glb")
    return {
        "vertices": int(V.shape[0]),
        "faces": int(F.shape[0]),
        "bytes": int(os.path.getsize(out_glb)),
        "bbox_min": V.min(axis=0).tolist(),
        "bbox_max": V.max(axis=0).tolist(),
    }


# ----------------------------- PotreeConverter -----------------------------
def potree_binary() -> str:
    """Pfad zum PotreeConverter-Binary (Env HV_POTREE_BIN, sonst PATH-Lookup)."""
    cand = os.environ.get("HV_POTREE_BIN")
    if cand and os.path.exists(cand):
        return cand
    found = shutil.which("PotreeConverter")
    if found:
        return found
    for p in ("/opt/potree/PotreeConverter", "/usr/local/bin/PotreeConverter"):
        if os.path.exists(p):
            return p
    raise FileNotFoundError("PotreeConverter-Binary nicht gefunden (HV_POTREE_BIN setzen).")


def run_potree(in_las: str, out_dir: str) -> dict:
    """LAS -> Potree-2.0-Octree in out_dir/cloud. Rückgabe: metadata-Auszug."""
    cloud_dir = os.path.join(out_dir, "cloud")
    if os.path.isdir(cloud_dir):
        shutil.rmtree(cloud_dir)
    cmd = [potree_binary(), in_las, "-o", cloud_dir, "--overwrite"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"PotreeConverter fehlgeschlagen (code {proc.returncode}): "
            f"{proc.stderr[-500:] or proc.stdout[-500:]}")
    meta_path = os.path.join(cloud_dir, "metadata.json")
    with open(meta_path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)
    return {"metadata": meta, "cloud_dir": cloud_dir}


# ----------------------------- Orchestrator -----------------------------
def build(result: engine.Result, job_id: str, *, bake_rgb: bool = True,
          clip: float = 0.30, force: bool = False, potree: bool = False) -> dict:
    """3D-Datengrundlage erzeugen (idempotent, cached auf Volume).

    SCHNELL (v1): nur cloud.bin (Three.js-Viewer) + Soll-GLB. potree=True erzeugt
    zusätzlich LAS + Potree-Octree (langsam; für sehr grosse Wolken / später).
    """
    jd = job_dir(job_id)
    scene_path = os.path.join(jd, "scene.json")
    if os.path.exists(scene_path) and not force:
        with open(scene_path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    # 1) Kompakte Binär-Wolke (primäre Viewer-Quelle). Liefert den gemeinsamen Offset.
    bin_path = os.path.join(jd, "cloud.bin")
    bin_info = export_cloud_bin(result, bin_path, clip=clip)
    offset = np.asarray(bin_info["offset"], dtype=np.float64)

    # 2) Soll-GLB um denselben Offset verschoben.
    glb_path = os.path.join(jd, "soll.glb")
    glb_info = export_soll_glb(result, glb_path, offset)

    # 3) Optional: LAS + Potree-Octree (langsam) — nur wenn potree=True.
    potree_info, potree_err = None, None
    if potree:
        try:
            las_path = os.path.join(jd, "cloud.las")
            export_las_with_deviation(result, las_path, bake_rgb=bake_rgb, clip=clip)
            potree_info = run_potree(las_path, jd)
        except (FileNotFoundError, RuntimeError, ValueError) as e:
            potree_err = str(e)

    bmin = np.minimum(bin_info["bbox_min"], glb_info["bbox_min"]).tolist()
    bmax = np.maximum(bin_info["bbox_max"], glb_info["bbox_max"]).tolist()

    scene = {
        "job_id": job_id,
        "offset": offset.tolist(),          # vom Viewer wieder zu addieren
        "crs": "EPSG:2056",                 # LV95
        "binUrl": f"/jobs/{job_id}/cloud.bin",   # Three.js-Viewer (primär)
        "binCount": bin_info["count"],
        "cloudFormat": "v2",                     # xyz_f32 + dev_f32 + rgb_u8
        "hasRgb": bool(bin_info["has_rgb"]),
        "meshUrl": f"/jobs/{job_id}/soll.glb",
        "cloudUrl": f"/jobs/{job_id}/cloud/metadata.json",  # Potree-Octree (falls vorhanden)
        "bbox": {"min": bmin, "max": bmax},
        "deviation": {
            "min": bin_info["deviation_min"],
            "max": bin_info["deviation_max"],
            "median": bin_info["deviation_median"],
            "field": "deviation",
            "rgb_baked": bool(bake_rgb),
            "clip": clip,
        },
        "points": bin_info["total"],
        "mesh": {"vertices": glb_info["vertices"], "faces": glb_info["faces"],
                 "bytes": glb_info["bytes"]},
        "octree_ready": potree_info is not None,
    }
    if potree_err:
        scene["octree_error"] = potree_err

    with open(scene_path, "w", encoding="utf-8") as fh:
        json.dump(scene, fh, ensure_ascii=False, indent=2)
    return scene


def cloud_file(job_id: str, rel_path: str) -> str:
    """Absoluter Pfad einer Octree-Datei unter <job>/cloud/, mit Traversal-Schutz."""
    base = os.path.join(job_dir(job_id), "cloud")
    full = os.path.normpath(os.path.join(base, rel_path))
    if not full.startswith(os.path.normpath(base) + os.sep) and full != os.path.normpath(base):
        raise ValueError("Ungültiger Pfad.")
    return full
