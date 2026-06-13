# -*- coding: utf-8 -*-
"""DXF -> geschlossene Polylinien (für Bauperimeter / Bereiche).

Liest LWPOLYLINE und (alte) POLYLINE aus dem Modelspace und liefert je Polylinie
die XY-Stützpunkte. Annahme: Koordinaten in Metern und LV95 (Tiefbau-Planung vom
Vermesser). Per Bounding-Box wird geprüft, ob das plausibel im Schweizer
LV95-Bereich liegt (sonst Warn-Flag looks_lv95=False).
"""
from __future__ import annotations


# Schweizer LV95-Wertebereich (grob), wie in georef.py.
_E_MIN, _E_MAX = 2_480_000.0, 2_840_000.0
_N_MIN, _N_MAX = 1_070_000.0, 1_300_000.0


def _shoelace_area(pts: list[tuple[float, float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) * 0.5


def _looks_lv95(pts: list[tuple[float, float]]) -> bool:
    if not pts:
        return False
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    cx = sum(xs) / len(xs); cy = sum(ys) / len(ys)
    return _E_MIN <= cx <= _E_MAX and _N_MIN <= cy <= _N_MAX


def extract_polylines(path: str) -> list[dict]:
    """Alle Polylinien aus dem DXF-Modelspace als Liste von dicts.

    [{ layer, closed, n, points: [[E,N],...], area_m2, looks_lv95 }]
    Sortiert nach Fläche absteigend (grösste Grenze zuerst).
    """
    import ezdxf
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    out: list[dict] = []

    for e in msp.query("LWPOLYLINE"):
        pts = [(float(x), float(y)) for x, y in e.get_points("xy")]
        if len(pts) < 2:
            continue
        out.append(_pack(e.dxf.layer, bool(e.closed), pts))

    for e in msp.query("POLYLINE"):
        pts = []
        for v in e.vertices:
            loc = v.dxf.location
            pts.append((float(loc[0]), float(loc[1])))
        if len(pts) < 2:
            continue
        out.append(_pack(e.dxf.layer, bool(e.is_closed), pts))

    out.sort(key=lambda d: d["area_m2"], reverse=True)
    return out


def _pack(layer: str, closed: bool, pts: list[tuple[float, float]]) -> dict:
    return {
        "layer": str(layer),
        "closed": closed,
        "n": len(pts),
        "points": [[round(x, 3), round(y, 3)] for x, y in pts],
        "area_m2": round(_shoelace_area(pts), 2),
        "looks_lv95": _looks_lv95(pts),
    }
