# -*- coding: utf-8 -*-
import json, requests
B = "http://127.0.0.1:8011"
IFC = r"C:\Users\sandro.egloff\Downloads\12901_BIH_XX_XXXX_AUH_BGR_Aushubmodell ET 1 (ohne SB).ifc"
LAZ = r"C:\Users\sandro.egloff\Downloads\densePcl.laz"
out = {}
try:
    out["health"] = requests.get(B + "/health", timeout=5).json()
    with open(IFC, "rb") as fs, open(LAZ, "rb") as fc:
        files = {"soll": ("soll.ifc", fs), "cloud": ("densePcl.laz", fc)}
        r = requests.post(B + "/compare", files=files, data={"res": "0.25"}, timeout=180)
    r.raise_for_status()
    cmp = r.json()
    jid = cmp["job_id"]
    g = cmp["grid"]; ext = cmp["extent"]
    out["compare"] = {"job_id": jid, "grid": g,
                      "stats": {k: round(v, 1) for k, v in cmp["stats"].items() if isinstance(v, (int, float))}}
    # stats mit tol=0.10
    s10 = requests.get(B + f"/jobs/{jid}/stats", params={"tol": 0.10}, timeout=30).json()
    out["stats_tol010"] = {"on_target_pct": round(s10["on_target_pct"], 1), "tol_m": s10["tol_m"]}
    out["on_target_diff"] = round(s10["on_target_pct"] - cmp["stats"]["on_target_pct"], 1)
    # Profil quer durchs Extent
    x0, x1, y0, y1 = ext
    ym = (y0 + y1) / 2
    pr = requests.post(B + f"/jobs/{jid}/profile",
                       json={"line": [[x0 + 10, ym], [x1 - 10, ym]]}, timeout=30).json()
    withdz = [v for v in pr["dz"] if v is not None]
    out["profile"] = {"length_m": round(pr["length_m"], 1), "pts": len(pr["dist"]), "with_dz": len(withdz)}
    # Volumen Polygon (mittleres Drittel)
    ax = x0 + (x1 - x0) / 3; bx = x0 + 2 * (x1 - x0) / 3
    ay = y0 + (y1 - y0) / 3; by = y0 + 2 * (y1 - y0) / 3
    vol = requests.post(B + f"/jobs/{jid}/volume",
                        json={"polygon": [[ax, ay], [bx, ay], [bx, by], [ax, by]], "tol": 0.05}, timeout=30).json()
    out["volume"] = {k: round(v, 1) for k, v in vol.items() if isinstance(v, (int, float))}
    # PNG
    png = requests.get(B + f"/jobs/{jid}/dz.png", params={"tol": 0.05}, timeout=30)
    out["dz_png"] = {"status": png.status_code, "bytes": len(png.content), "ct": png.headers.get("content-type")}
    # PDF
    pdf = requests.post(B + f"/jobs/{jid}/protocol.pdf",
                        json={"title": "Hoehenvergleich", "soll_name": "Aushubmodell ET1", "ist_name": "densePcl.laz", "tol": 0.05},
                        timeout=120)
    out["pdf"] = {"status": pdf.status_code, "bytes": len(pdf.content), "ct": pdf.headers.get("content-type")}
    out["OK"] = (out["pdf"]["bytes"] > 10000 and out["dz_png"]["bytes"] > 1000)
except Exception as e:
    import traceback
    out["OK"] = False
    out["error"] = repr(e)
    out["tb"] = traceback.format_exc()
open("verify_api.json", "w", encoding="utf-8").write(json.dumps(out, indent=2, ensure_ascii=False))
print("DONE")
