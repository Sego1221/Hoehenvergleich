# -*- coding: utf-8 -*-
"""Vergleichs-Engine: Soll-Modell (IFC) vs. Ist-Punktwolke -> Höhenraster, Statistik, Profile.

Alles in LV95. Lokale Modelle werden via georef.georeference() transformiert.
Kernidee: ΔZ-Raster + Soll-DSM + Ist-DSM werden EINMAL gerechnet; Toleranz und
Schnitte/Profile sind danach nur günstiges Nachschwellen bzw. Nachsampeln.
"""
from __future__ import annotations
import os
import numpy as np
from dataclasses import dataclass, field

from . import georef


# ----------------------------- Datenhaltung -----------------------------
@dataclass
class Grid:
    x0: float; y0: float; res: float; nx: int; ny: int
    @property
    def x1(self): return self.x0 + self.nx * self.res
    @property
    def y1(self): return self.y0 + self.ny * self.res
    @property
    def extent(self): return [self.x0, self.x1, self.y0, self.y1]


@dataclass
class Result:
    grid: Grid
    soll_z: np.ndarray          # (ny,nx) Soll-Oberfläche (LV95-Höhe), NaN wo keine Fläche
    ist_z: np.ndarray           # (ny,nx) Ist-Bodenhöhe, NaN wo keine Punkte
    dz: np.ndarray              # ist_z - soll_z, NaN wo nicht vergleichbar
    valid: np.ndarray           # bool-Maske gültiger Vergleichszellen
    meta: dict = field(default_factory=dict)


# ----------------------------- IFC / Soll -----------------------------
def load_ifc_mesh(path: str, exclude_names=("Modelleinfügepunkt",)):
    """IFC -> (V, F) in Welt-Metern (use-world-coords). Hilfsobjekte per Name ausgeschlossen."""
    import ifcopenshell, ifcopenshell.geom as geom
    f = ifcopenshell.open(path)
    s = geom.settings(); s.set("use-world-coords", True)
    it = geom.iterator(s, f)
    Vs, Fs, off = [], [], 0
    if it.initialize():
        while True:
            sh = it.get()
            prod = f.by_id(sh.id)
            name = (prod.Name if prod is not None else None) or ""
            v = np.asarray(sh.geometry.verts).reshape(-1, 3)
            fa = np.asarray(sh.geometry.faces).reshape(-1, 3)
            if name not in exclude_names and len(v):
                Vs.append(v); Fs.append(fa + off); off += len(v)
            if not it.next():
                break
    if not Vs:
        raise ValueError("Keine verwertbare IFC-Geometrie gefunden.")
    return np.vstack(Vs), np.vstack(Fs)


def load_mesh(path: str):
    """Dreiecksvermaschung / TIN -> (V, F) in Metern. OBJ/PLY/STL/GLTF/GLB/OFF via trimesh."""
    import trimesh
    m = trimesh.load(path, force="mesh", process=False)
    if m is None or not hasattr(m, "vertices") or len(m.faces) == 0:
        raise ValueError("Mesh konnte nicht gelesen werden oder enthält keine Dreiecke.")
    return np.asarray(m.vertices, dtype=np.float64), np.asarray(m.faces, dtype=np.int64)


# Soll-Quelle nach Dateiendung. IFC -> ifcopenshell, sonst Mesh/TIN via trimesh.
_MESH_EXT = {".obj", ".ply", ".stl", ".gltf", ".glb", ".off", ".3mf", ".dae"}


def load_soll(path: str):
    """Soll-Modell als Dreiecksnetz laden — IFC oder direkte Vermaschung (TIN)."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".ifc", ".ifczip"):
        return load_ifc_mesh(path)
    if ext in _MESH_EXT:
        return load_mesh(path)
    raise ValueError(f"Nicht unterstütztes Soll-Format: {ext}. Erlaubt: IFC oder {sorted(_MESH_EXT)}.")


def rasterize_top_dsm(V, F, grid: Grid):
    """Mesh -> Oberseiten-DSM (Z-Buffer max) per Dreiecks-Rasterung."""
    g = grid
    z = np.full((g.ny, g.nx), -np.inf)
    fx = (V[:, 0] - g.x0) / g.res; fy = (V[:, 1] - g.y0) / g.res; vz = V[:, 2]
    for a, b, c in F:
        axx, ayy, bxx, byy, cxx, cyy = fx[a], fy[a], fx[b], fy[b], fx[c], fy[c]
        minx = max(int(np.floor(min(axx, bxx, cxx))), 0); maxx = min(int(np.ceil(max(axx, bxx, cxx))), g.nx - 1)
        miny = max(int(np.floor(min(ayy, byy, cyy))), 0); maxy = min(int(np.ceil(max(ayy, byy, cyy))), g.ny - 1)
        if maxx < minx or maxy < miny:
            continue
        gx, gy = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
        d = (byy - cyy) * (axx - cxx) + (cxx - bxx) * (ayy - cyy)
        if abs(d) < 1e-12:
            continue
        l1 = ((byy - cyy) * (gx - cxx) + (cxx - bxx) * (gy - cyy)) / d
        l2 = ((cyy - ayy) * (gx - cxx) + (axx - cxx) * (gy - cyy)) / d
        l3 = 1 - l1 - l2
        ins = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not ins.any():
            continue
        zz = l1 * vz[a] + l2 * vz[b] + l3 * vz[c]
        np.maximum.at(z, ((gy[ins] - 0.5).astype(int), (gx[ins] - 0.5).astype(int)), zz[ins])
    z[~np.isfinite(z)] = np.nan
    return z


# ----------------------------- Punktwolke / Ist -----------------------------
def load_cloud(path: str):
    """LAZ/LAS -> (xyz, rgb|None). xyz in Datei-CRS (PIX4D: LV95)."""
    import laspy
    las = laspy.read(path)
    xyz = np.vstack((np.asarray(las.x), np.asarray(las.y), np.asarray(las.z))).T
    rgb = None
    if "red" in las.point_format.dimension_names:
        rgb = np.vstack([np.asarray(las[c]).astype(np.float32) for c in ("red", "green", "blue")]).T
    return xyz, rgb


def ground_dsm(xyz, rgb, grid: Grid, ground_pct=0.20, exg_thr=0.10, use_veg=True):
    """Punktwolke -> Boden-DSM (Perzentil je Zelle) mit optionalem RGB-Vegetationsfilter."""
    g = grid
    x, y, zc = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    removed = 0
    if use_veg and rgb is not None:
        r, gr, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
        ssum = r + gr + b + 1e-6
        exg = 2 * gr / ssum - r / ssum - b / ssum
        keep = exg <= exg_thr
        removed = int((~keep).sum())
        x, y, zc = x[keep], y[keep], zc[keep]
    ix = np.floor((x - g.x0) / g.res).astype(np.int64)
    iy = np.floor((y - g.y0) / g.res).astype(np.int64)
    m = (ix >= 0) & (ix < g.nx) & (iy >= 0) & (iy < g.ny)
    ix, iy, zc = ix[m], iy[m], zc[m]
    cell = iy * g.nx + ix
    order = np.lexsort((zc, cell))
    cs, zs = cell[order], zc[order]
    uniq, start, cnt = np.unique(cs, return_index=True, return_counts=True)
    gidx = start + np.floor(ground_pct * (cnt - 1)).astype(np.int64)
    z = np.full(g.ny * g.nx, np.nan)
    z[uniq] = zs[gidx]
    return z.reshape(g.ny, g.nx), {"removed_veg": removed, "points_in": int(m.sum())}


def ist_from_dsm(dsm_path: str, grid: Grid):
    """Fertiges DSM-Höhenraster (GeoTIFF, LV95) auf das Vergleichsraster sampeln (Nearest).

    Schnellweg für grosse Areale: keine Punktverarbeitung nötig.
    """
    import rasterio
    g = grid
    with rasterio.open(dsm_path) as ds:
        band = ds.read(1).astype(np.float64)
        nodata = ds.nodata
        if nodata is not None:
            band[band == nodata] = np.nan
        inv = ~ds.transform
        # Zellzentren des Vergleichsrasters (LV95)
        ex = g.x0 + (np.arange(g.nx) + 0.5) * g.res
        ny_ = g.y0 + (np.arange(g.ny) + 0.5) * g.res
        EX, NY = np.meshgrid(ex, ny_)
        col = (inv.a * EX + inv.b * NY + inv.c).astype(int)
        row = (inv.d * EX + inv.e * NY + inv.f).astype(int)
        z = np.full((g.ny, g.nx), np.nan)
        m = (row >= 0) & (row < band.shape[0]) & (col >= 0) & (col < band.shape[1])
        z[m] = band[row[m], col[m]]
    return z, {"ist_source": "dsm_geotiff"}


_DSM_EXT = {".tif", ".tiff", ".gtiff"}


# ----------------------------- Orchestrator -----------------------------
def compare(ifc_path: str, cloud_path: str, *, res=0.25, ground_pct=0.20,
            exg_thr=0.10, use_veg=True, cap=5.0, transform: dict | None = None) -> Result:
    V, F = load_soll(ifc_path)   # IFC oder Dreiecksvermaschung/TIN
    Vg, ginfo = georef.georeference(V, transform)            # Soll nach LV95
    cinfo = ginfo                                            # Default, falls Ist ein DSM ist
    x0, y0 = Vg[:, 0].min(), Vg[:, 1].min()
    x1, y1 = Vg[:, 0].max(), Vg[:, 1].max()
    nx = int(np.ceil((x1 - x0) / res)); ny = int(np.ceil((y1 - y0) / res))
    grid = Grid(x0, y0, res, nx, ny)

    soll = rasterize_top_dsm(Vg, F, grid)

    # Ist: Punktwolke ODER fertiges DSM-GeoTIFF
    if os.path.splitext(cloud_path)[1].lower() in _DSM_EXT:
        ist, dinfo = ist_from_dsm(cloud_path, grid)
    else:
        xyz, rgb = load_cloud(cloud_path)
        xyz_g, cinfo = georef.georeference(xyz, transform)   # i.d.R. schon LV95
        ist, dinfo = ground_dsm(xyz_g, rgb, grid, ground_pct, exg_thr, use_veg)

    dz = ist - soll
    valid = np.isfinite(dz) & (np.abs(dz) <= cap)
    meta = {"res": res, "ground_pct": ground_pct, "exg_thr": exg_thr, "use_veg": use_veg,
            "cap": cap, "soll_georef": ginfo, "cloud_georef": cinfo,
            # Quell-Pfade für die spätere 3D-Datengrundlage (Octree/GLB) merken.
            "soll_path": ifc_path, "cloud_path": cloud_path,
            "cloud_transform": transform, **dinfo}
    return Result(grid, soll, ist, dz, valid, meta)


def compare_clouds(cloud1_path: str, cloud2_path: str, *, res=0.25, ground_pct=0.20,
                   exg_thr=0.10, use_veg=True, cap=5.0, transform: dict | None = None) -> Result:
    """Zwei Punktwolken vergleichen: Referenz A (cloud1) vs. Vergleich B (cloud2).

    Beide werden als Boden-DSM (Perzentil je Zelle) auf ein GEMEINSAMES Raster
    (Vereinigung beider Ausdehnungen) gerastert. ΔZ = B − A (positiv = Auftrag,
    negativ = Abtrag). Statistik/Profile/Volumen/3D laufen danach generisch wie
    beim Aushub-Vergleich. Die 3D-Referenzfläche kommt aus dem DSM von A
    (soll_kind = "dsm"), da es kein Soll-Mesh gibt.
    """
    xyz1, rgb1 = load_cloud(cloud1_path)
    xyz1, g1 = georef.georeference(xyz1, transform)
    xyz2, rgb2 = load_cloud(cloud2_path)
    xyz2, g2 = georef.georeference(xyz2, transform)
    x0 = min(float(xyz1[:, 0].min()), float(xyz2[:, 0].min()))
    y0 = min(float(xyz1[:, 1].min()), float(xyz2[:, 1].min()))
    x1 = max(float(xyz1[:, 0].max()), float(xyz2[:, 0].max()))
    y1 = max(float(xyz1[:, 1].max()), float(xyz2[:, 1].max()))
    nx = int(np.ceil((x1 - x0) / res)); ny = int(np.ceil((y1 - y0) / res))
    grid = Grid(x0, y0, res, nx, ny)

    soll, i1 = ground_dsm(xyz1, rgb1, grid, ground_pct, exg_thr, use_veg)   # Referenz A
    ist, i2 = ground_dsm(xyz2, rgb2, grid, ground_pct, exg_thr, use_veg)    # Vergleich B

    dz = ist - soll
    valid = np.isfinite(dz) & (np.abs(dz) <= cap)
    meta = {"res": res, "ground_pct": ground_pct, "exg_thr": exg_thr, "use_veg": use_veg,
            "cap": cap, "mode": "clouds", "soll_kind": "dsm",
            "soll_georef": g1, "cloud_georef": g2,
            # Soll = DSM aus A (kein Mesh-Pfad); cloud_path = B (fuer cloud.bin/3D).
            "soll_path": None, "cloud1_path": cloud1_path, "cloud_path": cloud2_path,
            "cloud_transform": transform,
            "removed_veg_a": i1.get("removed_veg"), "removed_veg_b": i2.get("removed_veg")}
    return Result(grid, soll, ist, dz, valid, meta)


def dsm_to_mesh(grid: Grid, z: np.ndarray):
    """Höhenraster (ny,nx; NaN = Lücke) zu einem LV95-Dreiecksnetz (V,F) triangulieren.

    Liefert die 3D-Referenzfläche bei Wolke-gegen-Wolke (es gibt kein Soll-Mesh).
    Vertices an den Zellzentren mit endlicher Höhe; ein Quad wird nur vermascht,
    wenn alle 4 Eck-Zellen endlich sind. Lücken bleiben Löcher.
    """
    g = grid
    ex = g.x0 + (np.arange(g.nx) + 0.5) * g.res
    ny_ = g.y0 + (np.arange(g.ny) + 0.5) * g.res
    finite = np.isfinite(z)
    idx = np.full(z.shape, -1, dtype=np.int64)
    idx[finite] = np.arange(int(finite.sum()))
    EX, NY = np.meshgrid(ex, ny_)
    V = np.column_stack([EX[finite], NY[finite], z[finite]]).astype(np.float64)
    quad = finite[:-1, :-1] & finite[:-1, 1:] & finite[1:, :-1] & finite[1:, 1:]
    iy, ix = np.nonzero(quad)
    c00 = idx[iy, ix]; c01 = idx[iy, ix + 1]; c10 = idx[iy + 1, ix]; c11 = idx[iy + 1, ix + 1]
    if V.shape[0] == 0 or iy.size == 0:
        raise ValueError("Referenz-Wolke hat keine zusammenhängende Fläche (leeres DSM).")
    F = np.vstack([np.column_stack([c00, c01, c11]), np.column_stack([c00, c11, c10])])
    return V, F


def mask_from_polygons(grid: Grid, polygons) -> np.ndarray:
    """Bool-Maske (ny,nx): True, wo das Zellzentrum in IRGENDEINEM Polygon liegt.

    polygons = Liste von Polygonen [[E,N],...] (LV95). Für den Bauperimeter (eine
    Parzelle = ein Polygon; mehrere Parzellen additiv). Leere/zu kleine Polygone
    werden übersprungen.
    """
    from matplotlib.path import Path
    g = grid
    ex = g.x0 + (np.arange(g.nx) + 0.5) * g.res
    ny_ = g.y0 + (np.arange(g.ny) + 0.5) * g.res
    EX, NY = np.meshgrid(ex, ny_)
    pts = np.column_stack([EX.ravel(), NY.ravel()])
    inside = np.zeros(g.ny * g.nx, dtype=bool)
    for poly in (polygons or []):
        arr = np.asarray(poly, dtype=float)
        if arr.ndim != 2 or arr.shape[0] < 3:
            continue
        inside |= Path(arr).contains_points(pts)
    return inside.reshape(g.ny, g.nx)


def valid_mask(result: Result, polygons=None) -> np.ndarray:
    """Gültige Vergleichszellen, optional auf den Bauperimeter (Polygon-Liste) beschränkt."""
    if polygons:
        return result.valid & mask_from_polygons(result.grid, polygons)
    return result.valid


def stats(result: Result, tol=0.05, polygons=None) -> dict:
    """Kennzahlen für gegebene Toleranz (günstig, da nur Schwellen).

    polygons (optional): Bauperimeter [[ [E,N],... ],...] — schränkt alle
    Kennzahlen (Fläche, Cut/Fill, % auf Soll) auf den Perimeter ein.
    """
    valid = valid_mask(result, polygons)
    d = result.dz[valid]
    A = result.grid.res ** 2
    if d.size == 0:
        return {"cells": 0}
    return {
        "cells": int(valid.sum()),
        "area_m2": float(valid.sum() * A),
        "cut_m3": float(np.clip(d, 0, None).sum() * A),
        "fill_m3": float(np.clip(-d, 0, None).sum() * A),
        "net_m3": float(d.sum() * A),
        "mean_m": float(d.mean()), "median_m": float(np.median(d)), "std_m": float(d.std()),
        "min_m": float(d.min()), "max_m": float(d.max()),
        "on_target_pct": float(100 * np.mean(np.abs(d) <= tol)),
        "tol_m": tol,
    }


def volumes_in_polygon(result: Result, polygon, tol=0.05) -> dict:
    """Cut/Fill-Differenzvolumen innerhalb einer Polygon-Auswahl (LV95 [[E,N],...]).

    cut  = noch auszuheben (Ist über Soll), fill = aufzufüllen (Ist unter Soll).
    Ohne Polygon-Filter: ganzes Modell (siehe stats()).
    """
    from matplotlib.path import Path
    g = result.grid
    ex = g.x0 + (np.arange(g.nx) + 0.5) * g.res
    ny_ = g.y0 + (np.arange(g.ny) + 0.5) * g.res
    EX, NY = np.meshgrid(ex, ny_)
    inside = Path(np.asarray(polygon, dtype=float)).contains_points(
        np.column_stack([EX.ravel(), NY.ravel()])).reshape(g.ny, g.nx)
    mask = inside & result.valid
    d = result.dz[mask]
    A = g.res ** 2
    if d.size == 0:
        return {"cells": 0, "area_m2": 0.0, "cut_m3": 0.0, "fill_m3": 0.0, "net_m3": 0.0}
    return {
        "cells": int(mask.sum()),
        "area_m2": float(mask.sum() * A),
        "cut_m3": float(np.clip(d, 0, None).sum() * A),     # noch auszuheben
        "fill_m3": float(np.clip(-d, 0, None).sum() * A),   # aufzufüllen
        "net_m3": float(d.sum() * A),
        "mean_m": float(d.mean()), "median_m": float(np.median(d)),
        "on_target_pct": float(100 * np.mean(np.abs(d) <= tol)),
    }


# ----------------------------- Schnitte / Profile -----------------------------
def _bilinear(grid: Grid, arr: np.ndarray, xs: np.ndarray, ys: np.ndarray):
    """Bilineare Interpolation von arr an Welt-Koordinaten (xs,ys); NaN ausserhalb/an Lücken."""
    g = grid
    fx = (xs - g.x0) / g.res - 0.5
    fy = (ys - g.y0) / g.res - 0.5
    x0 = np.floor(fx).astype(int); y0 = np.floor(fy).astype(int)
    tx = fx - x0; ty = fy - y0
    out = np.full(xs.shape, np.nan)
    for i in range(xs.size):
        ix, iy = x0[i], y0[i]
        if ix < 0 or iy < 0 or ix + 1 >= g.nx or iy + 1 >= g.ny:
            continue
        q = arr[iy:iy + 2, ix:ix + 2]
        if not np.isfinite(q).all():
            # Fallback: nächster gültiger Wert im 2x2-Fenster
            vals = q[np.isfinite(q)]
            out[i] = vals.mean() if vals.size else np.nan
            continue
        a = q[0, 0] * (1 - tx[i]) + q[0, 1] * tx[i]
        b = q[1, 0] * (1 - tx[i]) + q[1, 1] * tx[i]
        out[i] = a * (1 - ty[i]) + b * ty[i]
    return out


def sample_profile(result: Result, line, step=None):
    """Schnitt entlang einer Polylinie (LV95-Koordinaten [[E,N],...]).

    Rückgabe: dict mit dist[], soll[], ist[], dz[] (Meter). step default = Rasterweite/2.
    """
    pts = np.asarray(line, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[0] < 2:
        raise ValueError("Schnittlinie braucht mindestens 2 Punkte [[E,N],...].")
    step = step or result.grid.res / 2.0
    xs, ys, dist = [], [], []
    acc = 0.0
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        seg = q - p
        L = float(np.hypot(*seg))
        n = max(int(np.ceil(L / step)), 1)
        for k in range(n + (1 if i == len(pts) - 2 else 0)):
            tt = k / n
            xs.append(p[0] + seg[0] * tt); ys.append(p[1] + seg[1] * tt)
            dist.append(acc + L * tt)
        acc += L
    xs = np.asarray(xs); ys = np.asarray(ys); dist = np.asarray(dist)
    soll = _bilinear(result.grid, result.soll_z, xs, ys)
    ist = _bilinear(result.grid, result.ist_z, xs, ys)
    return {"dist": dist.tolist(), "soll": _nan2none(soll), "ist": _nan2none(ist),
            "dz": _nan2none(ist - soll), "length_m": float(acc)}


def _nan2none(a):
    return [None if not np.isfinite(v) else round(float(v), 4) for v in a]


# ----------------------------- 3D-Datengrundlage (Potree-Viewer) -----------------------------
def point_deviations(result: Result, xyz: np.ndarray) -> np.ndarray:
    """Per-Punkt-ΔZ = Punkt.z − Soll-Oberfläche(x,y), bilinear gegen das Soll-DSM.

    VEKTORISIERT (für Millionen Punkte). Punkte ohne Soll-Fläche (ausserhalb/Lücke
    oder NaN-Zelle) -> NaN. xyz in LV95. Rückgabe: (N,) float64 ΔZ in Metern.
    """
    xyz = np.asarray(xyz, dtype=np.float64)
    g = result.grid
    arr = result.soll_z
    fx = (xyz[:, 0] - g.x0) / g.res - 0.5
    fy = (xyz[:, 1] - g.y0) / g.res - 0.5
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    tx = fx - x0
    ty = fy - y0
    soll = np.full(xyz.shape[0], np.nan)
    ok = (x0 >= 0) & (y0 >= 0) & (x0 + 1 < g.nx) & (y0 + 1 < g.ny)
    xi = x0[ok]; yi = y0[ok]; txi = tx[ok]; tyi = ty[ok]
    q00 = arr[yi, xi]; q01 = arr[yi, xi + 1]
    q10 = arr[yi + 1, xi]; q11 = arr[yi + 1, xi + 1]
    a = q00 * (1 - txi) + q01 * txi
    b = q10 * (1 - txi) + q11 * txi
    soll[ok] = a * (1 - tyi) + b * tyi   # NaN in einer Ecke -> NaN (keine Soll-Fläche)
    return xyz[:, 2] - soll


def soll_mesh_lv95(result: Result):
    """Soll-Mesh (V,F) in LV95 rekonstruieren — aus den im Result-Meta hinterlegten Pfaden.

    Wird vom GLB-Export gebraucht. Liefert georeferenzierte Vertices. Bei
    Wolke-gegen-Wolke (soll_kind = "dsm") wird die Referenzfläche aus dem
    gerasterten DSM von A trianguliert statt aus einem Mesh geladen.
    """
    if result.meta.get("soll_kind") == "dsm":
        return dsm_to_mesh(result.grid, result.soll_z)
    src = result.meta.get("soll_path")
    if not src:
        raise ValueError("Kein 'soll_path' im Result-Meta — Mesh kann nicht rekonstruiert werden.")
    V, F = load_soll(src)
    tf = result.meta.get("soll_georef", {}).get("transform")
    Vg, _ = georef.georeference(V, tf)
    return Vg, F
