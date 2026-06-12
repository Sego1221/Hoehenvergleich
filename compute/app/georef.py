# -*- coding: utf-8 -*-
"""Georeferenzierung: LV95-Erkennung + Transformation lokal <-> LV95.

Pro Projekt wird eine Transformation hinterlegt (Translation E/N/H + Drehung-Z,
Massstab = 1). Pro Modell wird automatisch erkannt, ob es bereits in LV95 liegt;
nur lokale Modelle werden transformiert.
"""
from __future__ import annotations
import numpy as np

# Schweizer LV95-Bereich (grosszuegig). E ~2.48-2.84 Mio, N ~1.07-1.30 Mio.
LV95_E = (2_480_000.0, 2_840_000.0)
LV95_N = (1_070_000.0, 1_300_000.0)


def is_lv95(bbox_min, bbox_max) -> bool:
    """True, wenn die Bounding-Box im Schweizer LV95-Bereich liegt (=> bereits georeferenziert)."""
    cx = (bbox_min[0] + bbox_max[0]) / 2.0
    cy = (bbox_min[1] + bbox_max[1]) / 2.0
    return LV95_E[0] <= cx <= LV95_E[1] and LV95_N[0] <= cy <= LV95_N[1]


def apply_transform(pts: np.ndarray, t, angle_deg: float) -> np.ndarray:
    """Lokal -> LV95.  Konvention: LV95 = Rz(-alpha) . (lokal - T).

    pts   : (N,3) lokale Koordinaten in Metern
    t     : (tE, tN, tH) gespeicherte (negative) Offsets, z.B. (-2591403.354, -1406501.39, -322)
    angle : Drehung in Grad (z.B. 3.0)
    """
    pts = np.asarray(pts, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    a = np.radians(-angle_deg)
    c, s = np.cos(a), np.sin(a)
    p = pts - t
    out = np.empty_like(p)
    out[:, 0] = p[:, 0] * c - p[:, 1] * s
    out[:, 1] = p[:, 0] * s + p[:, 1] * c
    out[:, 2] = p[:, 2]
    return out


def georeference(pts: np.ndarray, transform: dict | None):
    """Bringt lokale Punkte nach LV95, falls noetig.

    transform = {"tE","tN","tH","angle_deg"} oder None.
    Rueckgabe: (pts_lv95, info-dict).
    """
    mn = pts.min(axis=0)
    mx = pts.max(axis=0)
    if is_lv95(mn, mx):
        return pts, {"already_lv95": True, "transformed": False}
    if transform is None:
        raise ValueError(
            "Modell liegt lokal (nicht LV95) und es ist keine Projekt-Transformation hinterlegt. "
            "Basispunkt/Drehung eingeben oder Passpunkt-Align durchfuehren."
        )
    t = (transform["tE"], transform["tN"], transform["tH"])
    out = apply_transform(pts, t, transform["angle_deg"])
    return out, {"already_lv95": False, "transformed": True,
                 "transform": transform}
