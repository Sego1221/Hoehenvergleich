# -*- coding: utf-8 -*-
"""Lokale Verifikation der Python-Teile der 3D-Datengrundlage (ohne PotreeConverter).

Schreibt Ergebnisse nach compute/verify3d.json.
"""
import json, os, sys, traceback
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from app import engine, build3d  # noqa: E402

DL = r"C:\Users\sandro.egloff\Downloads"
IFC = os.path.join(DL, "12901_BIH_XX_XXXX_AUH_BGR_Aushubmodell ET 1 (ohne SB).ifc")
LAZ = os.path.join(DL, "densePcl.laz")

out = {"ok": False}
try:
    # 1) Vergleich rechnen (setzt soll_path/cloud_path im Meta).
    result = engine.compare(IFC, LAZ, res=0.25)
    out["compare"] = {
        "grid": [result.grid.ny, result.grid.nx],
        "valid_cells": int(result.valid.sum()),
        "stats": engine.stats(result, 0.05),
    }

    # 2) Per-Punkt-ΔZ.
    xyz, rgb = engine.load_cloud(LAZ)
    from app import georef
    xyz, _ = georef.georeference(xyz, None)
    dev = engine.point_deviations(result, xyz)
    finite = dev[np.isfinite(dev)]
    out["point_deviations"] = {
        "n_points": int(xyz.shape[0]),
        "n_finite": int(finite.size),
        "n_nan_outside": int((~np.isfinite(dev)).sum()),
        "min": float(finite.min()), "max": float(finite.max()),
        "median": float(np.median(finite)), "mean": float(finite.mean()),
        "p05": float(np.percentile(finite, 5)), "p95": float(np.percentile(finite, 95)),
        "rgb_present": rgb is not None,
    }

    # 3) LAS-Export mit deviation -> wieder einlesen + prüfen.
    import laspy
    las_path = os.path.join(HERE, "_verify_cloud.las")
    info = build3d.export_las_with_deviation(result, las_path, bake_rgb=True)
    las = laspy.read(las_path)
    dim_names = list(las.point_format.dimension_names)
    dread = np.asarray(las.deviation)
    fr = dread[np.isfinite(dread)]
    out["las_export"] = {
        "file_bytes": os.path.getsize(las_path),
        "point_count": int(las.header.point_count),
        "has_deviation_dim": "deviation" in dim_names,
        "offset": list(las.header.offsets),
        "deviation_min": float(fr.min()), "deviation_max": float(fr.max()),
        "deviation_median": float(np.median(fr)),
        "has_rgb": "red" in dim_names,
        "export_info": info,
    }

    # 4) GLB-Export des Soll -> wieder mit trimesh laden.
    import trimesh
    offset = np.asarray(info["offset"], dtype=np.float64)
    glb_path = os.path.join(HERE, "_verify_soll.glb")
    ginfo = build3d.export_soll_glb(result, glb_path, offset)
    m = trimesh.load(glb_path, force="mesh", process=False)
    out["glb_export"] = {
        "file_bytes": os.path.getsize(glb_path),
        "vertices_reported": ginfo["vertices"],
        "vertices_reloaded": int(len(m.vertices)),
        "faces_reloaded": int(len(m.faces)),
        "reloaded_ok": len(m.vertices) > 0 and len(m.faces) > 0,
    }

    # PotreeConverter-Binary-Verfügbarkeit (lokal i.d.R. nicht vorhanden).
    try:
        out["potree_binary"] = build3d.potree_binary()
    except Exception as e:
        out["potree_binary"] = f"nicht vorhanden (erwartet lokal): {e}"

    # Aufräumen der Verifikations-Artefakte.
    for p in (las_path, glb_path):
        try: os.remove(p)
        except OSError: pass

    out["ok"] = True
except Exception as e:
    out["error"] = f"{type(e).__name__}: {e}"
    out["trace"] = traceback.format_exc()

with open(os.path.join(HERE, "verify3d.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=2)
print("done", out.get("ok"))
