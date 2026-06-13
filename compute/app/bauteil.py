# -*- coding: utf-8 -*-
"""Baufortschritt: elementweise Soll-Ist-Erkennung (gebaut / nicht gebaut /
verdeckt) eines Struktur-IFC gegen eine As-Built-Punktwolke.

Pro IFC-Bauteil wird die Oberseite auf ein Raster abgetastet und je Zelle gegen
die Ist-Oberflaeche (Top-Z der Wolke in der Zelle) klassifiziert:
  gebaut   : Wolkenpunkt nahe der Soll-Oberkante (|dz| <= tol)
  verdeckt : Ist-Oberflaeche deutlich UEBER der Soll-Oberkante (ueberbaut/Aufbau)
  nicht    : keine Punkte auf Soll-Niveau bzw. Ist-Oberflaeche tiefer (offen)

Koordinaten: IFC lokal (ifcopenshell use-world-coords, Meter; world-Z = Kote).
Transform lokal->LV95: LV95 = Rz(-alpha) * (lokal - T)  (wie georef-Konvention).
Die Wolke ist bereits LV95.
"""
from __future__ import annotations
import os
import numpy as np


# Hilfsobjekte (z.B. Modelleinfuege-/Pour-Platzhalter) haben entartete Geometrie.
_MIN_VERTS = 8


def _ifc_value(prod, pname):
    """Wert einer IfcPropertySingleValue ueber alle Psets eines Produkts."""
    for rel in getattr(prod, "IsDefinedBy", []) or []:
        if rel.is_a("IfcRelDefinesByProperties"):
            ps = rel.RelatingPropertyDefinition
            if ps.is_a("IfcPropertySet"):
                for p in ps.HasProperties or []:
                    if p.is_a("IfcPropertySingleValue") and p.Name == pname and p.NominalValue is not None:
                        return p.NominalValue.wrappedValue
    return None


def load_structural_elements(ifc_path: str) -> list[dict]:
    """Struktur-IFC -> Liste von Bauteilen mit Geometrie (lokal, Meter) + Attributen.

    Filtert entartete Hilfsobjekte (< _MIN_VERTS Vertices) heraus.
    """
    import ifcopenshell, ifcopenshell.geom as geom
    f = ifcopenshell.open(ifc_path)
    s = geom.settings(); s.set("use-world-coords", True)
    it = geom.iterator(s, f)
    out: list[dict] = []
    if it.initialize():
        while True:
            sh = it.get()
            v = np.asarray(sh.geometry.verts, dtype=np.float64).reshape(-1, 3)
            fa = np.asarray(sh.geometry.faces, dtype=np.int64).reshape(-1, 3)
            if len(v) >= _MIN_VERTS:
                prod = f.by_id(sh.id)
                out.append({
                    "guid": getattr(prod, "GlobalId", None),
                    "name": getattr(prod, "Name", None),
                    "bauteil": _ifc_value(prod, "Bauteil"),
                    "betonage": _ifc_value(prod, "Betonagenummer"),
                    "material": _ifc_value(prod, "Material"),
                    "kote_ok": _ifc_value(prod, "Kote OK"),
                    "kote_uk": _ifc_value(prod, "Kote UK"),
                    "V": v, "F": fa,
                })
            if not it.next():
                break
    if not out:
        raise ValueError("Keine verwertbaren Struktur-Bauteile im IFC gefunden.")
    return out


def to_lv95(P: np.ndarray, transform: dict) -> np.ndarray:
    """Lokal (Meter) -> LV95. transform: {tE,tN,tH,angle_deg}. LV95 = Rz(-a)*(P - T)."""
    T = np.array([transform["tE"], transform["tN"], transform["tH"]], dtype=np.float64)
    a = np.radians(float(transform.get("angle_deg", 0.0)))
    d = P - T
    c, s = np.cos(-a), np.sin(-a)
    return np.column_stack([c * d[:, 0] - s * d[:, 1], s * d[:, 0] + c * d[:, 1], d[:, 2]])


def _rasterize_top(V: np.ndarray, F: np.ndarray, x0, y0, res, nx, ny) -> np.ndarray:
    """Oberseiten-Z (Z-Buffer max) eines Mesh auf ein Raster. NaN wo keine Flaeche."""
    z = np.full(ny * nx, -np.inf)
    fx = (V[:, 0] - x0) / res; fy = (V[:, 1] - y0) / res; vz = V[:, 2]
    for a, b, c in F:
        ax, ay, bx, by, cx, cy = fx[a], fy[a], fx[b], fy[b], fx[c], fy[c]
        mnx = max(int(np.floor(min(ax, bx, cx))), 0); mxx = min(int(np.ceil(max(ax, bx, cx))), nx - 1)
        mny = max(int(np.floor(min(ay, by, cy))), 0); mxy = min(int(np.ceil(max(ay, by, cy))), ny - 1)
        if mxx < mnx or mxy < mny:
            continue
        gx, gy = np.meshgrid(np.arange(mnx, mxx + 1) + 0.5, np.arange(mny, mxy + 1) + 0.5)
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-9:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / det
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / det
        l3 = 1 - l1 - l2
        ins = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not ins.any():
            continue
        zz = l1 * vz[a] + l2 * vz[b] + l3 * vz[c]
        np.maximum.at(z, ((gy[ins] - 0.5).astype(int) * nx + (gx[ins] - 0.5).astype(int)), zz[ins])
    z[~np.isfinite(z)] = np.nan
    return z.reshape(ny, nx)


def element_status(elem: dict, transform: dict, xyz: np.ndarray, res=0.10, tol=0.05) -> dict:
    """Status eines Bauteils: Flaechenanteile gebaut/nicht/verdeckt + ΔZ.

    xyz: Wolke (N,3) in LV95. elem aus load_structural_elements().
    """
    V = to_lv95(elem["V"], transform); F = elem["F"]
    x0, y0 = V[:, 0].min(), V[:, 1].min()
    x1, y1 = V[:, 0].max(), V[:, 1].max()
    nx = max(int(np.ceil((x1 - x0) / res)), 1); ny = max(int(np.ceil((y1 - y0) / res)), 1)
    soll = _rasterize_top(V, F, x0, y0, res, nx, ny)
    valid = np.isfinite(soll)
    tot = int(valid.sum())
    base = {
        "guid": elem["guid"], "name": elem["name"], "bauteil": elem["bauteil"],
        "betonage": elem["betonage"], "material": elem["material"],
        "kote_ok": elem["kote_ok"], "kote_uk": elem["kote_uk"],
        "area_m2": round(tot * res * res, 2),
    }
    if tot == 0:
        return {**base, "status": "nicht_gebaut", "frac_gebaut": 0.0,
                "frac_nicht": 1.0, "frac_verdeckt": 0.0, "dz_mean": None, "n_points": 0}

    m = (xyz[:, 0] >= x0 - 0.5) & (xyz[:, 0] <= x1 + 0.5) & (xyz[:, 1] >= y0 - 0.5) & (xyz[:, 1] <= y1 + 0.5)
    cx, cy, cz = xyz[m, 0], xyz[m, 1], xyz[m, 2]
    top = np.full(ny * nx, -np.inf); cnt = np.zeros(ny * nx, dtype=np.int64)
    if cx.size:
        ix = np.floor((cx - x0) / res).astype(np.int64); iy = np.floor((cy - y0) / res).astype(np.int64)
        ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
        idx = iy[ok] * nx + ix[ok]
        np.maximum.at(top, idx, cz[ok]); np.add.at(cnt, idx, 1)
    top = top.reshape(ny, nx); cnt = cnt.reshape(ny, nx); top[cnt == 0] = np.nan
    dz = top - soll; has = cnt > 0
    geb = valid & has & (np.abs(dz) <= tol)
    ver = valid & has & (dz > tol)
    nic = valid & ((~has) | ((dz < -tol) & has))
    fg, fn, fv = geb.sum() / tot, nic.sum() / tot, ver.sum() / tot
    status = ["gebaut", "nicht_gebaut", "verdeckt"][int(np.argmax([fg, fn, fv]))]
    return {**base, "status": status,
            "frac_gebaut": round(float(fg), 3), "frac_nicht": round(float(fn), 3),
            "frac_verdeckt": round(float(fv), 3),
            "dz_mean": (round(float(np.nanmean(dz[geb])), 3) if geb.any() else None),
            "n_points": int(cnt.sum())}


STATUS_COLOR = {
    "gebaut": (40, 180, 80), "nicht_gebaut": (150, 150, 150), "verdeckt": (240, 150, 40),
}


def choose_transform(elements: list[dict], transform: dict, xyz: np.ndarray):
    """Richtige Transform-Richtung waehlen: liegt eine Bauteil-Mitte in der Wolken-
    BBox? Sonst Vorzeichen von T drehen (lokal->LV95 vs. LV95->lokal). Gibt
    (transform_used, flipped|None) zurueck; None = keine Richtung trifft (Warnung)."""
    cmin = xyz[:, :2].min(0); cmax = xyz[:, :2].max(0)
    def hits(t):
        for e in elements:
            c = to_lv95(e["V"], t).mean(0)
            if cmin[0] - 50 <= c[0] <= cmax[0] + 50 and cmin[1] - 50 <= c[1] <= cmax[1] + 50:
                return True
        return False
    if hits(transform):
        return transform, False
    flip = {**transform, "tE": -transform["tE"], "tN": -transform["tN"], "tH": -transform["tH"]}
    if hits(flip):
        return flip, True
    return transform, None


def export_status_glb(elements: list[dict], rows: list[dict], transform: dict, out_glb: str) -> dict:
    """Struktur-Bauteile als GLB, je Bauteil nach Status eingefaerbt, um gemeinsamen
    Offset verschoben (float32-tauglich). Rueckgabe: offset/bbox fuer scene.json."""
    import trimesh
    by_guid = {r["guid"]: r for r in rows}
    Vs = [to_lv95(e["V"], transform) for e in elements]
    allV = np.vstack(Vs)
    offset = np.floor(allV.min(axis=0))
    scene = trimesh.Scene()
    for e, V in zip(elements, Vs):
        col = STATUS_COLOR.get(by_guid.get(e["guid"], {}).get("status", "nicht_gebaut"), (150, 150, 150))
        m = trimesh.Trimesh(vertices=(V - offset).astype(np.float32), faces=e["F"], process=False)
        m.visual.vertex_colors = np.tile(np.array([*col, 255], np.uint8), (len(m.vertices), 1))
        scene.add_geometry(m)
    scene.export(out_glb, file_type="glb")
    return {"offset": offset.tolist(),
            "bbox_min": allV.min(axis=0).tolist(), "bbox_max": allV.max(axis=0).tolist(),
            "bytes": int(os.path.getsize(out_glb))}


def evaluate(ifc_path: str, cloud_path: str, transform: dict, res=0.10, tol=0.05,
             out_glb: str | None = None) -> dict:
    """Kompletter Baufortschritt-Lauf: alle Bauteile vs. Wolke -> Status je Element + Summary.

    Waehlt automatisch die Transform-Richtung (Overlap-Check) und exportiert
    optional ein nach Status eingefaerbtes GLB (out_glb) fuer den Viewer.
    """
    from . import engine
    elements = load_structural_elements(ifc_path)
    xyz, _ = engine.load_cloud(cloud_path)
    tf, flipped = choose_transform(elements, transform, xyz)
    rows = [element_status(e, tf, xyz, res=res, tol=tol) for e in elements]
    summ = {"n_elements": len(rows),
            "gebaut": sum(r["status"] == "gebaut" for r in rows),
            "nicht_gebaut": sum(r["status"] == "nicht_gebaut" for r in rows),
            "verdeckt": sum(r["status"] == "verdeckt" for r in rows)}
    scene = None
    if out_glb:
        scene = export_status_glb(elements, rows, tf, out_glb)
    return {"summary": summ, "elements": rows,
            "transform_flipped": flipped,
            "transform_warning": (flipped is None),
            "scene": scene}
