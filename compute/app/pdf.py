# -*- coding: utf-8 -*-
"""PDF-Protokoll für den Höhenvergleich — Karte, Kennzahlen, Volumen, Schnitte.

Analog zur Logik des PIX4D-Messprotokolls: Kopf, Übersichtskarte, Kennzahl-Tabelle,
optional Bereichs-Volumen und Schnitt-Profile. Branding/Logo wird später ergänzt.
"""
from __future__ import annotations
import io
import numpy as np

from . import engine


def _fig_to_png(fig) -> io.BytesIO:
    import matplotlib.pyplot as plt
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def _map_png(result: engine.Result, tol: float, clip: float = 0.30):
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    g = result.grid
    fig, ax = plt.subplots(figsize=(7.5, 6))
    im = ax.imshow(np.where(result.valid, result.dz, np.nan), origin="lower", extent=g.extent,
                   cmap="RdYlBu_r", vmin=-clip, vmax=clip, aspect="equal")
    ax.set_xlabel("E (LV95)"); ax.set_ylabel("N (LV95)")
    plt.colorbar(im, ax=ax, shrink=0.8, label="ΔZ [m]  (+ über Soll)")
    return _fig_to_png(fig)


def _profile_png(prof: dict, name: str):
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    d = np.array(prof["dist"], float)
    soll = np.array([np.nan if v is None else v for v in prof["soll"]], float)
    ist = np.array([np.nan if v is None else v for v in prof["ist"]], float)
    fig, ax = plt.subplots(figsize=(9, 3.2))
    ax.plot(d, soll, color="#2c7bb6", lw=1.4, label="Soll")
    ax.plot(d, ist, color="#d7191c", lw=1.4, label="Ist")
    ax.fill_between(d, soll, ist, where=np.isfinite(soll) & np.isfinite(ist),
                    color="#fdae61", alpha=0.4, label="ΔZ")
    ax.set_title(f"Schnitt {name}  (Länge {prof['length_m']:.1f} m)")
    ax.set_xlabel("Distanz [m]"); ax.set_ylabel("Höhe [m ü.M.]")
    ax.legend(loc="best", fontsize=8); ax.grid(alpha=0.3)
    return _fig_to_png(fig)


def make_protocol(result: engine.Result, ctx: dict) -> io.BytesIO:
    """Erzeugt das PDF-Protokoll.

    ctx: {title, project, soll_name, ist_name, date, tol,
          sections:[{name, line}], regions:[{name, polygon}]}
    """
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader

    tol = float(ctx.get("tol", 0.05))
    s = engine.stats(result, tol)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    W, H = landscape(A4)

    # --- Kopf ---
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, H - 18 * mm, ctx.get("title", "Höhenvergleich Soll-Ist"))
    c.setFont("Helvetica", 9)
    y = H - 24 * mm
    for line in [
        f"Projekt: {ctx.get('project', '-')}",
        f"Soll: {ctx.get('soll_name', '-')}    Ist: {ctx.get('ist_name', '-')}",
        f"Datum: {ctx.get('date', '-')}    Toleranz: ±{tol*100:.0f} cm    Raster: {result.grid.res} m",
    ]:
        c.drawString(20 * mm, y, line); y -= 5 * mm

    # --- Karte ---
    c.drawImage(ImageReader(_map_png(result, tol)), 20 * mm, 18 * mm,
                width=150 * mm, preserveAspectRatio=True, anchor="sw")

    # --- Kennzahlen-Tabelle (rechts) ---
    rows = [
        ("Fläche", f"{s.get('area_m2', 0):.0f} m²"),
        ("Restaushub (Cut)", f"{s.get('cut_m3', 0):.0f} m³"),
        ("Auffüllung (Fill)", f"{s.get('fill_m3', 0):.0f} m³"),
        ("Netto (Cut − Fill)", f"{s.get('net_m3', 0):+.0f} m³"),
        ("Median / Mittel ΔZ", f"{s.get('median_m', 0):+.3f} / {s.get('mean_m', 0):+.3f} m"),
        (f"Auf Soll (±{tol*100:.0f} cm)", f"{s.get('on_target_pct', 0):.1f} %"),
    ]
    tx, ty = 180 * mm, H - 40 * mm
    c.setFont("Helvetica-Bold", 11); c.drawString(tx, ty + 6 * mm, "Kennzahlen")
    c.setFont("Helvetica", 10)
    for k, v in rows:
        c.drawString(tx, ty, k); c.drawRightString(W - 20 * mm, ty, v); ty -= 7 * mm

    # --- Bereichs-Volumen ---
    regions = ctx.get("regions") or []
    if regions:
        ty -= 4 * mm
        c.setFont("Helvetica-Bold", 11); c.drawString(tx, ty, "Bereiche"); ty -= 6 * mm
        c.setFont("Helvetica", 9)
        for r in regions:
            v = engine.volumes_in_polygon(result, r["polygon"], tol)
            c.drawString(tx, ty, f"{r.get('name','Bereich')}: Cut {v['cut_m3']:.0f} / Fill {v['fill_m3']:.0f} m³")
            ty -= 5 * mm

    # --- Schnitte: je eine Seite ---
    for sec in (ctx.get("sections") or []):
        prof = engine.sample_profile(result, sec["line"])
        c.showPage()
        c.setFont("Helvetica-Bold", 13)
        c.drawString(20 * mm, H - 18 * mm, f"Schnitt {sec.get('name', '')}")
        c.drawImage(ImageReader(_profile_png(prof, sec.get("name", ""))),
                    20 * mm, 40 * mm, width=W - 40 * mm, preserveAspectRatio=True, anchor="sw")

    c.showPage(); c.save()
    buf.seek(0)
    return buf
