# -*- coding: utf-8 -*-
import json, traceback
res = {}
IFC = r"C:\Users\sandro.egloff\Downloads\12901_BIH_XX_XXXX_AUH_BGR_Aushubmodell ET 1 (ohne SB).ifc"
LAZ = r"C:\Users\sandro.egloff\Downloads\densePcl.laz"
try:
    import app.main as m
    res["fastapi"] = {"routes": sorted({r.path for r in m.app.routes if hasattr(r, "path")})}
    from app import engine, pdf
    r = engine.compare(IFC, LAZ, res=0.25)
    s = engine.stats(r, 0.05)
    res["stats"] = {k: round(v, 2) for k, v in s.items() if isinstance(v, (int, float))}
    g = r.grid
    # Profil quer
    p = engine.sample_profile(r, [[g.x0 + 10, (g.y0 + g.y1) / 2], [g.x1 - 10, (g.y0 + g.y1) / 2]])
    ok = [v for v in p["dz"] if v is not None]
    res["profile"] = {"len_m": round(p["length_m"], 1), "pts": len(p["dist"]), "with_dz": len(ok)}
    # Volumen in Polygon (mittleres Drittel)
    ex0, ex1 = g.x0 + (g.x1 - g.x0) / 3, g.x0 + 2 * (g.x1 - g.x0) / 3
    ny0, ny1 = g.y0 + (g.y1 - g.y0) / 3, g.y0 + 2 * (g.y1 - g.y0) / 3
    poly = [[ex0, ny0], [ex1, ny0], [ex1, ny1], [ex0, ny1]]
    v = engine.volumes_in_polygon(r, poly, 0.05)
    res["polygon_volume"] = {k: round(val, 1) for k, val in v.items() if isinstance(val, (int, float))}
    # PDF mit Schnitt + Bereich
    ctx = {"title": "Höhenvergleich Soll-Ist", "project": "Müligasse Döttingen",
           "soll_name": "Aushubmodell ET1", "ist_name": "densePcl.laz", "date": "2026-06-12", "tol": 0.05,
           "sections": [{"name": "Q1", "line": [[g.x0 + 10, (g.y0 + g.y1) / 2], [g.x1 - 10, (g.y0 + g.y1) / 2]]}],
           "regions": [{"name": "Mitte", "polygon": poly}]}
    out = pdf.make_protocol(r, ctx)
    data = out.getvalue()
    open("protokoll_test.pdf", "wb").write(data)
    res["pdf"] = {"bytes": len(data), "file": "protokoll_test.pdf"}
    res["OK"] = True
except Exception as e:
    res["OK"] = False
    res["error"] = repr(e)
    res["tb"] = traceback.format_exc()
open("verify_full.json", "w", encoding="utf-8").write(json.dumps(res, indent=2, ensure_ascii=False))
print("DONE")
