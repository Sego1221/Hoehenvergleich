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


def _ifc_color(prod) -> tuple[int, int, int] | None:
    """RGB (0..255) aus IfcSurfaceStyleRendering des Produkts, sonst None."""
    try:
        for rep in (prod.Representation.Representations if getattr(prod, "Representation", None) else []) or []:
            for it in rep.Items or []:
                for si in getattr(it, "StyledByItem", []) or []:
                    for sty in si.Styles or []:
                        candidates = []
                        if sty.is_a("IfcPresentationStyleAssignment"):
                            candidates = sty.Styles or []
                        else:
                            candidates = [sty]
                        for s in candidates:
                            if s.is_a("IfcSurfaceStyle"):
                                for r in s.Styles or []:
                                    if r.is_a("IfcSurfaceStyleRendering") or r.is_a("IfcSurfaceStyleShading"):
                                        c = r.SurfaceColour
                                        return (int(c.Red * 255), int(c.Green * 255), int(c.Blue * 255))
    except Exception:
        return None
    return None


def load_structural_elements(ifc_path: str) -> list[dict]:
    """Struktur-IFC -> Liste von Bauteilen mit Geometrie (lokal, Meter) + Attributen
    + IFC-Standardfarbe. Hilfsobjekte (< _MIN_VERTS Vertices) werden gefiltert."""
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
                col = _ifc_color(prod)
                out.append({
                    "guid": getattr(prod, "GlobalId", None),
                    "name": getattr(prod, "Name", None),
                    "bauteil": _ifc_value(prod, "Bauteil"),
                    "betonage": _ifc_value(prod, "Betonagenummer"),
                    "material": _ifc_value(prod, "Material"),
                    "kote_ok": _ifc_value(prod, "Kote OK"),
                    "kote_uk": _ifc_value(prod, "Kote UK"),
                    "color": list(col) if col else None,
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
    "gebaut": (40, 180, 80), "nicht_gebaut": (150, 150, 150),
    "verdeckt": (240, 150, 40), "nicht_erfasst": (90, 90, 110),
}


# ===================== Baufortschritt v2: Modell-Katalog + Tages-Scans =====================
def model_dir(model_id: str) -> str:
    from . import build3d
    import os as _os
    d = _os.path.join(build3d.data_root(), "bfmodels", model_id)
    _os.makedirs(d, exist_ok=True)
    return d


def build_catalog(ifc_paths: list[str]) -> list[dict]:
    """Mehrere Struktur-IFCs zu EINEM Bauteil-Katalog (lokal, Meter) zusammenfuehren.

    Dedupliziert nach IFC-GUID; Hilfsobjekte (<8 Verts) werden ausgefiltert.
    Geometrie bleibt LOKAL; die LV95-Transformation erfolgt erst beim Scan
    (mit Richtungs-Check gegen die jeweilige Wolke).
    """
    cat: list[dict] = []
    seen: set = set()
    for p in ifc_paths:
        for e in load_structural_elements(p):
            g = e["guid"]
            if g in seen:
                continue
            seen.add(g)
            cat.append(e)
    if not cat:
        raise ValueError("Keine verwertbaren Bauteile in den IFCs.")
    return cat


def save_model(mdir: str, catalog: list[dict], transform: dict) -> dict:
    """Katalog (Geometrie lokal + Attribute) + Transform persistieren. Gibt Summary."""
    import os as _os, json as _json, pickle as _pickle
    with open(_os.path.join(mdir, "catalog.pkl"), "wb") as fh:
        _pickle.dump({"catalog": catalog, "transform": transform}, fh)
    attrs = [{k: e[k] for k in ("guid", "name", "bauteil", "betonage", "material", "kote_ok", "kote_uk")} for e in catalog]
    with open(_os.path.join(mdir, "catalog.json"), "w", encoding="utf-8") as fh:
        _json.dump({"elements": attrs}, fh, ensure_ascii=False, default=str)
    betonagen = sorted({str(e.get("betonage")) for e in catalog if e.get("betonage")})
    # LV95-Offset (wie im Vorschau-GLB) fuer Perimeter-Overlay im Viewer.
    allV = np.vstack([to_lv95(e["V"], transform) for e in catalog])
    offset = np.floor(allV.min(axis=0)).tolist()
    return {"n_elements": len(catalog), "betonagen": betonagen, "elements": attrs, "offset": offset}


def load_model(mdir: str):
    import os as _os, pickle as _pickle
    p = _os.path.join(mdir, "catalog.pkl")
    if not _os.path.exists(p):
        raise ValueError("Modell-Katalog nicht gefunden.")
    with open(p, "rb") as fh:
        d = _pickle.load(fh)
    return d["catalog"], d["transform"]


_VERT_Z = 0.6   # Z-Ausdehnung >= 0.6 m -> vertikales Bauteil (Wand/Stuetze) -> Flaechendeckung


def _status_surface(V: np.ndarray, F: np.ndarray, xyz: np.ndarray, res: float, tol: float) -> dict:
    """Status eines VERTIKALEN Bauteils (Wand/Stuetze) ueber 3D-Flaechendeckung:
    Oberflaeche abtasten, Anteil mit nahem Wolkenpunkt (<= ~tol) = Deckung."""
    lo = V.min(axis=0); hi = V.max(axis=0)
    m = ((xyz[:, 0] >= lo[0] - 0.3) & (xyz[:, 0] <= hi[0] + 0.3) &
         (xyz[:, 1] >= lo[1] - 0.3) & (xyz[:, 1] <= hi[1] + 0.3) &
         (xyz[:, 2] >= lo[2] - 0.3) & (xyz[:, 2] <= hi[2] + 0.3))
    pts = xyz[m]
    base = {"frac_gebaut": 0.0, "frac_nicht": 0.0, "frac_verdeckt": 0.0, "frac_unerfasst": 0.0,
            "dz_mean": None, "n_points": int(pts.shape[0]),
            "area_m2": round(float(np.sum([0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F])), 2)}
    if pts.shape[0] == 0:
        return {**base, "status": "nicht_erfasst", "frac_unerfasst": 1.0}
    # Wolke -> Voxelmenge (Kantenlaenge tol), um 6 Nachbarn dilatiert (Toleranz).
    cv = np.unique(np.floor(pts / tol).astype(np.int64), axis=0)
    occ = set(map(tuple, cv))
    for ax in range(3):
        for d in (-1, 1):
            occ.update(map(tuple, cv + np.eye(3, dtype=np.int64)[ax] * d))
    # Oberflaeche abtasten (deterministisch).
    rng = np.random.default_rng(0); samples = []
    for a, b, c in F:
        A, B, C = V[a], V[b], V[c]
        area = 0.5 * float(np.linalg.norm(np.cross(B - A, C - A)))
        n = max(1, int(area / (res * res)))
        u = rng.random(n); v = rng.random(n); ov = u + v > 1; u[ov] = 1 - u[ov]; v[ov] = 1 - v[ov]
        samples.append(A + np.outer(u, B - A) + np.outer(v, C - A))
    S = np.vstack(samples)
    sv = np.floor(S / tol).astype(np.int64)
    covered = sum(1 for r in sv if (int(r[0]), int(r[1]), int(r[2])) in occ)
    cov = covered / len(sv) if len(sv) else 0.0
    status = "gebaut" if cov >= 0.4 else "nicht_gebaut"
    return {**base, "status": status, "frac_gebaut": round(float(cov), 3),
            "frac_nicht": round(float(1 - cov), 3)}


def catalog_preview_glb(mdir: str) -> str:
    """GLB des GANZEN Katalogs (alle Etappen, IFC-Farben) zur Kontrolle/Georef-
    Pruefung. Geometrie LV95 (stored transform). Pfad model_dir/preview.glb."""
    import os as _os
    catalog, tf = load_model(mdir)
    out = _os.path.join(mdir, "preview.glb")
    Vs = [to_lv95(e["V"], tf) for e in catalog]
    _status_glb_with_colors(Vs, [e["F"] for e in catalog], [e["guid"] for e in catalog],
                            [e.get("color") for e in catalog], out)
    return out


def _status_lv95(V: np.ndarray, F: np.ndarray, xyz: np.ndarray, res: float, tol: float) -> dict:
    """Status eines Bauteils (Geometrie bereits LV95). 4 Zustaende inkl. nicht_erfasst.

    Orientierung: flach (Z-Ausdehnung < _VERT_Z) -> Top-Raster + ΔZ (Slab);
    vertikal -> 3D-Flaechendeckung (Wand/Stuetze)."""
    if float(np.ptp(V[:, 2])) >= _VERT_Z:
        return _status_surface(V, F, xyz, res, tol)
    x0, y0 = V[:, 0].min(), V[:, 1].min()
    x1, y1 = V[:, 0].max(), V[:, 1].max()
    nx = max(int(np.ceil((x1 - x0) / res)), 1); ny = max(int(np.ceil((y1 - y0) / res)), 1)
    soll = _rasterize_top(V, F, x0, y0, res, nx, ny)
    valid = np.isfinite(soll); tot = int(valid.sum())
    if tot == 0:
        return {"status": "nicht_erfasst", "frac_gebaut": 0.0, "frac_nicht": 0.0,
                "frac_verdeckt": 0.0, "frac_unerfasst": 1.0, "dz_mean": None, "n_points": 0, "area_m2": 0.0}
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
    nic = valid & has & (dz < -tol)
    une = valid & (~has)                     # im Footprint, aber keine Punkte -> nicht erfasst
    fg, fn, fv, fu = geb.sum() / tot, nic.sum() / tot, ver.sum() / tot, une.sum() / tot
    status = ["gebaut", "nicht_gebaut", "verdeckt", "nicht_erfasst"][int(np.argmax([fg, fn, fv, fu]))]
    return {"status": status, "frac_gebaut": round(float(fg), 3), "frac_nicht": round(float(fn), 3),
            "frac_verdeckt": round(float(fv), 3), "frac_unerfasst": round(float(fu), 3),
            "dz_mean": (round(float(np.nanmean(dz[geb])), 3) if geb.any() else None),
            "n_points": int(cnt.sum()), "area_m2": round(tot * res * res, 2)}


def evaluate_scan(catalog: list[dict], transform: dict, cloud_path: str,
                  out_glb: str | None = None, res=0.10, tol=0.05) -> dict:
    """Tages-Scan gegen den ganzen Katalog. Richtung automatisch (choose_transform)."""
    from . import engine
    xyz, _ = engine.load_cloud(cloud_path)
    tf, flipped = choose_transform(catalog, transform, xyz)
    Vs = [to_lv95(e["V"], tf) for e in catalog]
    rows = []
    for e, V in zip(catalog, Vs):
        s = _status_lv95(V, e["F"], xyz, res, tol)
        rows.append({"guid": e["guid"], "name": e["name"], "bauteil": e["bauteil"],
                     "betonage": e["betonage"], "material": e["material"],
                     "kote_ok": e["kote_ok"], "kote_uk": e["kote_uk"], **s})
    summ = {"n_elements": len(rows)}
    for st in ("gebaut", "nicht_gebaut", "verdeckt", "nicht_erfasst"):
        summ[st] = sum(r["status"] == st for r in rows)
    scene = None
    if out_glb:
        scene = _status_glb_with_colors(Vs, [e["F"] for e in catalog],
                                        [e["guid"] for e in catalog],
                                        [e.get("color") for e in catalog], out_glb)
    return {"summary": summ, "elements": rows, "transform_flipped": flipped,
            "transform_warning": (flipped is None), "scene": scene,
            "ifc_colors": {e["guid"]: e.get("color") for e in catalog if e["guid"]}}


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


def _status_glb_with_colors(Vs: list, Fs: list, guids: list, colors: list, out_glb: str) -> dict:
    """Wie _status_glb, aber faerbt jedes Bauteil per Vertex-Color mit seiner
    IFC-Standardfarbe (Fallback hellgrau). Viewer kann zur Laufzeit auf Status
    umschalten, ohne das GLB neu zu laden."""
    import trimesh
    allV = np.vstack(Vs); offset = np.floor(allV.min(axis=0))
    scene = trimesh.Scene()
    for i, (V, F, g, c) in enumerate(zip(Vs, Fs, guids, colors)):
        m = trimesh.Trimesh(vertices=(V - offset).astype(np.float32), faces=F, process=False)
        col = c if (c and len(c) == 3) else (200, 200, 205)
        m.visual.vertex_colors = np.tile(np.array([*col, 255], np.uint8), (len(m.vertices), 1))
        gid = str(g or f"i{i}")
        name = "bf_" + gid.encode("utf-8").hex()
        scene.add_geometry(m, geom_name=name, node_name=name)
    scene.export(out_glb, file_type="glb")
    return {"offset": offset.tolist(),
            "bbox_min": allV.min(axis=0).tolist(), "bbox_max": allV.max(axis=0).tolist(),
            "bytes": int(os.path.getsize(out_glb))}


def _status_glb(Vs: list, Fs: list, guids: list, out_glb: str) -> dict:
    """GLB mit dem GANZEN Modell, EIN Mesh PRO BAUTEIL (Knotenname = 'bf_' +
    hex(GUID), damit Sonderzeichen $/% nicht verlorengehen), damit der Viewer
    einzelne Bauteile umfaerben (Korrektur) und nach Status ein-/ausblenden kann.
    Geometrie LV95, um gemeinsamen Offset verschoben (float32). Faerbung im
    Viewer anhand der Status-Karte (guid->Status)."""
    import trimesh
    allV = np.vstack(Vs); offset = np.floor(allV.min(axis=0))
    scene = trimesh.Scene()
    for i, (V, F, g) in enumerate(zip(Vs, Fs, guids)):
        m = trimesh.Trimesh(vertices=(V - offset).astype(np.float32), faces=F, process=False)
        m.visual.vertex_colors = np.tile(np.array([200, 200, 205, 255], np.uint8), (len(m.vertices), 1))
        gid = str(g or f"i{i}")
        name = "bf_" + gid.encode("utf-8").hex()
        scene.add_geometry(m, geom_name=name, node_name=name)
    scene.export(out_glb, file_type="glb")
    return {"offset": offset.tolist(),
            "bbox_min": allV.min(axis=0).tolist(), "bbox_max": allV.max(axis=0).tolist(),
            "bytes": int(os.path.getsize(out_glb))}


def export_status_glb(elements: list[dict], rows: list[dict], transform: dict, out_glb: str) -> dict:
    """Bauteile als per-Bauteil-GLB (GUID-benannt; Faerbung im Viewer)."""
    Vs = [to_lv95(e["V"], transform) for e in elements]
    return _status_glb(Vs, [e["F"] for e in elements], [e["guid"] for e in elements], out_glb)


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
