# -*- coding: utf-8 -*-
"""FastAPI Compute-Service: Soll-Ist-Höhenvergleich.

Stateless gegenüber dem Portal (Projekte/Transformationen verwaltet das Next-Modul);
hält Ergebnisse nur kurz im Speicher, damit Toleranz-Slider und Schnitte ohne
Neuberechnung antworten.
"""
from __future__ import annotations
import io, json, os, tempfile, uuid

import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from . import engine, pdf, build3d, dxf as dxfmod

app = FastAPI(title="Höhenvergleich Compute", version="0.1.0")

# CORS: i.d.R. gleich-origin über das Gateway. Erlaubte Origins per Env
# HV_CORS_ORIGINS (kommagetrennt) überschreibbar; Default = same-origin (leer).
# Range-Header (Potree) müssen exponiert sein.
from fastapi.middleware.cors import CORSMiddleware
_cors = [o.strip() for o in os.environ.get("HV_CORS_ORIGINS", "").split(",") if o.strip()]
if _cors:
    app.add_middleware(
        CORSMiddleware, allow_origins=_cors, allow_methods=["GET", "POST"],
        allow_headers=["*"], expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
    )

# Statische Demo-Oberfläche (app/static/index.html) unter "/" ausliefern.
_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
_INDEX_HTML = os.path.join(_STATIC_DIR, "index.html")


@app.get("/")
def index():
    """Schlanke Demo-Oberfläche zum schnellen Testen des Vergleichs."""
    return FileResponse(_INDEX_HTML, media_type="text/html")

# MVP: In-Memory-Cache job_id -> engine.Result (später Objektspeicher/Redis).
_RESULTS: dict[str, engine.Result] = {}
_MAX_JOBS = 32

# Upload-Quellen müssen über den Vergleich hinaus leben, damit die 3D-Datengrundlage
# (Octree/GLB) Wolke + Soll erneut lesen kann. Persistent unter <DATA>/uploads/.
_UPLOAD_DIR = os.path.join(build3d.data_root(), "uploads")
os.makedirs(_UPLOAD_DIR, exist_ok=True)


def _rm(*paths: str):
    for p in paths:
        try: os.remove(p)
        except OSError: pass


def _evict(jid: str, result: engine.Result):
    """Verdrängten Job aufräumen: persistierte Upload-Quellen entfernen."""
    for key in ("soll_path", "cloud_path"):
        p = result.meta.get(key)
        if p and os.path.commonpath([os.path.abspath(p), _UPLOAD_DIR]) == _UPLOAD_DIR:
            try: os.remove(p)
            except OSError: pass


def _store(result: engine.Result) -> str:
    if len(_RESULTS) >= _MAX_JOBS:
        old_id = next(iter(_RESULTS))
        _evict(old_id, _RESULTS.pop(old_id))
    jid = uuid.uuid4().hex[:12]
    _RESULTS[jid] = result
    return jid


def _get(job_id: str) -> engine.Result:
    r = _RESULTS.get(job_id)
    if r is None:
        # Vom Volume nachladen (überlebt Compute-Restart / RAM-Cache-Verlust).
        r = build3d.load_result(job_id)
        if r is not None:
            _RESULTS[job_id] = r
    if r is None:
        raise HTTPException(404, "Job nicht gefunden (evtl. abgelaufen). Vergleich erneut starten.")
    return r


async def _save_upload(up: UploadFile, suffix: str) -> str:
    # Persistent unter _UPLOAD_DIR (nicht Tempdir), damit build3d die Quelle
    # später erneut lesen kann. Aufräumen bei Job-Verdrängung (_evict).
    fd, path = tempfile.mkstemp(suffix=suffix, dir=_UPLOAD_DIR)
    with os.fdopen(fd, "wb") as fh:
        while chunk := await up.read(1 << 20):
            fh.write(chunk)
    return path


@app.get("/health")
def health():
    return {"status": "ok", "jobs": len(_RESULTS)}


@app.post("/dxf/polylines")
async def dxf_polylines(file: UploadFile = File(..., description="DXF (DWG vorher zu DXF exportieren)")):
    """DXF -> geschlossene Polylinien (für Bauperimeter/Bereiche).

    Liefert { polylines: [{layer, closed, n, points:[[E,N],...], area_m2, looks_lv95}] }.
    Koordinaten werden unverändert (Meter/LV95-Annahme) zurückgegeben.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".dxf"}:
        raise HTTPException(415, "Nur DXF. DWG bitte im CAD nach DXF exportieren.")
    path = await _save_upload(file, ext)
    try:
        polylines = dxfmod.extract_polylines(path)
    except Exception as e:
        raise HTTPException(400, f"DXF konnte nicht gelesen werden: {type(e).__name__}: {str(e)[:200]}")
    finally:
        _rm(path)
    return {"polylines": polylines}


_SOLL_EXT = {".ifc", ".ifczip", ".obj", ".ply", ".stl", ".gltf", ".glb", ".off", ".3mf", ".dae"}


@app.post("/compare")
async def compare(
    soll: UploadFile = File(..., description="Soll-Modell: IFC oder Dreiecksvermaschung/TIN"),
    cloud: UploadFile = File(..., description="Ist: Punktwolke LAZ/LAS"),
    res: float = Form(0.25),
    tol: float = Form(0.05),
    ground_pct: float = Form(0.20),
    exg_thr: float = Form(0.10),
    use_veg: bool = Form(True),
    cap: float = Form(5.0),
    transform: str = Form(""),
):
    """Soll-Modell (IFC oder TIN) + Punktwolke (Ist) hochladen -> Vergleich. Gibt job_id + Statistik + Extent."""
    tf = json.loads(transform) if transform.strip() else None
    # Datei-Typ-Prüfung temporär abschaltbar (Env HV_SKIP_TYPE_CHECK=1) — nur zum
    # Testen; zur Laufzeit gelesen, damit Ein/Aus per Env-Toggle ohne Code reicht.
    skip_type = os.environ.get("HV_SKIP_TYPE_CHECK") == "1"
    soll_ext = os.path.splitext(soll.filename or "")[1].lower()
    if not skip_type and soll_ext not in _SOLL_EXT:
        raise HTTPException(415, f"Soll-Format {soll_ext!r} nicht unterstützt. Erlaubt: {sorted(_SOLL_EXT)}")
    ifc_path = await _save_upload(soll, soll_ext)
    ist_ext = os.path.splitext(cloud.filename or "")[1].lower()
    if not skip_type and ist_ext not in {".laz", ".las", ".tif", ".tiff", ".gtiff"}:
        raise HTTPException(415, f"Ist-Format {ist_ext!r} nicht unterstützt. Erlaubt: LAZ/LAS oder DSM-GeoTIFF.")
    cloud_path = await _save_upload(cloud, ist_ext)
    try:
        result = engine.compare(ifc_path, cloud_path, res=res, ground_pct=ground_pct,
                                exg_thr=exg_thr, use_veg=use_veg, cap=cap, transform=tf)
    except ValueError as e:
        _rm(ifc_path, cloud_path)
        raise HTTPException(422, str(e))
    except Exception as e:
        # Parse-/Lese-Fehler (defektes/unvollständiges File, falsches Format) sauber
        # melden statt 500. Häufig: iCloud-Datei nur online (leerer Upload).
        _rm(ifc_path, cloud_path)
        raise HTTPException(
            400,
            "Datei konnte nicht verarbeitet werden. Ist die Soll-Datei ein gültiges "
            "IFC/TIN und die Ist-Datei eine vollständige LAZ/LAS/DSM-Datei? "
            f"(Detail: {type(e).__name__}: {str(e)[:200]})",
        )
    # Upload-Quellen bleiben erhalten (build3d liest sie erneut); Cleanup via _evict.
    jid = _store(result)
    try:
        build3d.save_result(jid, result)   # Volume-Persistenz (Restart-fest)
    except Exception:
        pass
    g = result.grid
    return {"job_id": jid, "stats": engine.stats(result, tol),
            "extent": g.extent, "grid": {"nx": g.nx, "ny": g.ny, "res": g.res},
            "georef": result.meta.get("soll_georef")}


@app.get("/jobs/{job_id}/stats")
def job_stats(job_id: str, tol: float = 0.05):
    """Kennzahlen für neue Toleranz neu schwellen (kein Neuberechnen) -> Slider-tauglich."""
    return engine.stats(_get(job_id), tol)


@app.post("/jobs/{job_id}/stats")
def job_stats_perim(job_id: str, payload: dict | None = None):
    """Wie GET /stats, aber optional auf den Bauperimeter beschränkt.

    payload: {tol?: float, perimeter?: [[ [E,N],... ],...]}.
    """
    p = payload or {}
    return engine.stats(_get(job_id), float(p.get("tol", 0.05)), polygons=p.get("perimeter"))


@app.post("/jobs/{job_id}/profile")
def job_profile(job_id: str, payload: dict):
    """Schnitt entlang Polylinie [[E,N],...] in LV95 -> Soll/Ist/dZ-Profil."""
    line = payload.get("line")
    if not line:
        raise HTTPException(400, "Feld 'line' [[E,N],...] erforderlich.")
    return engine.sample_profile(_get(job_id), line, step=payload.get("step"))


@app.post("/jobs/{job_id}/volume")
def job_volume(job_id: str, payload: dict):
    """Differenzvolumen (Cut/Fill) innerhalb einer Polygon-Auswahl [[E,N],...] in LV95.

    cut_m3 = noch auszuheben, fill_m3 = aufzufüllen. Ohne Polygon -> ganzes Modell via /jobs/{id}/stats.
    """
    poly = payload.get("polygon")
    if not poly or len(poly) < 3:
        raise HTTPException(400, "Feld 'polygon' [[E,N],...] mit mind. 3 Punkten erforderlich.")
    return engine.volumes_in_polygon(_get(job_id), poly, tol=payload.get("tol", 0.05))


@app.post("/jobs/{job_id}/protocol.pdf")
def job_protocol(job_id: str, ctx: dict | None = None):
    """PDF-Protokoll: Karte + Kennzahlen + Volumen, optional Bereiche und Schnitte.

    ctx: {title, project, soll_name, ist_name, date, tol,
          sections:[{name,line}], regions:[{name,polygon}]}
    """
    out = pdf.make_protocol(_get(job_id), ctx or {})
    return StreamingResponse(out, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="protokoll_{job_id}.pdf"'})


def _dz_display(r: engine.Result, polygons=None) -> np.ndarray:
    """ΔZ-Anzeigeraster: ungültige Zellen UND (optional) ausserhalb des Perimeters -> NaN."""
    valid = engine.valid_mask(r, polygons)
    return np.where(valid, r.dz, np.nan)


def _render_dz_tif(r: engine.Result, polygons=None) -> io.BytesIO:
    import rasterio
    from rasterio.transform import from_origin
    g = r.grid
    arr = np.flipud(_dz_display(r, polygons)).astype(np.float32)
    buf = io.BytesIO()
    with rasterio.open(buf, "w", driver="GTiff", height=g.ny, width=g.nx, count=1,
                       dtype="float32", crs="EPSG:2056",
                       transform=from_origin(g.x0, g.y1, g.res, g.res), nodata=np.nan) as dst:
        dst.write(arr, 1)
    buf.seek(0)
    return buf


def _render_dz_png(r: engine.Result, clip=0.30, polygons=None) -> io.BytesIO:
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    g = r.grid
    fig, ax = plt.subplots(figsize=(7, 7))
    im = ax.imshow(_dz_display(r, polygons), origin="lower", extent=g.extent,
                   cmap="RdYlBu_r", vmin=-clip, vmax=clip, aspect="equal")
    ax.set_xlabel("E (LV95)"); ax.set_ylabel("N (LV95)")
    plt.colorbar(im, ax=ax, shrink=0.8, label="ΔZ [m]")
    buf = io.BytesIO(); plt.tight_layout(); plt.savefig(buf, format="png", dpi=110); plt.close()
    buf.seek(0)
    return buf


@app.get("/jobs/{job_id}/dz.tif")
def job_geotiff(job_id: str):
    """ΔZ als georeferenziertes GeoTIFF (EPSG:2056)."""
    buf = _render_dz_tif(_get(job_id))
    return StreamingResponse(buf, media_type="image/tiff",
                             headers={"Content-Disposition": f'attachment; filename="dz_{job_id}.tif"'})


@app.post("/jobs/{job_id}/dz.tif")
def job_geotiff_perim(job_id: str, payload: dict | None = None):
    """Wie GET /dz.tif, aber optional auf den Bauperimeter beschränkt (payload.perimeter)."""
    buf = _render_dz_tif(_get(job_id), (payload or {}).get("perimeter"))
    return StreamingResponse(buf, media_type="image/tiff",
                             headers={"Content-Disposition": f'attachment; filename="dz_{job_id}.tif"'})


@app.get("/jobs/{job_id}/dz.png")
def job_png(job_id: str, tol: float = 0.05, clip: float = 0.30):
    """ΔZ-Heatmap als PNG (für schnelle Vorschau)."""
    return StreamingResponse(_render_dz_png(_get(job_id), clip), media_type="image/png")


@app.post("/jobs/{job_id}/dz.png")
def job_png_perim(job_id: str, payload: dict | None = None):
    """Wie GET /dz.png, aber optional auf den Bauperimeter beschränkt (payload.perimeter)."""
    p = payload or {}
    buf = _render_dz_png(_get(job_id), float(p.get("clip", 0.30)), p.get("perimeter"))
    return StreamingResponse(buf, media_type="image/png")


# ----------------------------- 3D-Datengrundlage (Potree-Viewer) -----------------------------
@app.post("/jobs/{job_id}/build3d")
def job_build3d(job_id: str, payload: dict | None = None):
    """Octree (Potree 2.0) + Soll-GLB + scene.json erzeugen. Idempotent, cached auf Volume.

    payload: {bake_rgb?: bool, clip?: float, force?: bool}. Gibt scene.json-Inhalt zurück.
    """
    p = payload or {}
    try:
        scene = build3d.build(_get(job_id), job_id,
                              bake_rgb=bool(p.get("bake_rgb", True)),
                              clip=float(p.get("clip", 0.30)),
                              force=bool(p.get("force", False)))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"3D-Aufbau fehlgeschlagen: {type(e).__name__}: {str(e)[:300]}")
    return scene


@app.get("/jobs/{job_id}/scene.json")
def job_scene(job_id: str):
    """scene.json für den Viewer (offset/cloudUrl/meshUrl/bbox). 404 wenn noch nicht gebaut."""
    path = os.path.join(build3d.job_dir(job_id), "scene.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Noch keine 3D-Datengrundlage. Zuerst POST /jobs/{id}/build3d.")
    return FileResponse(path, media_type="application/json")


@app.get("/jobs/{job_id}/soll.glb")
def job_soll_glb(job_id: str):
    """Soll-Mesh als GLB (um scene.offset verschoben, float32-tauglich)."""
    path = os.path.join(build3d.job_dir(job_id), "soll.glb")
    if not os.path.exists(path):
        raise HTTPException(404, "Soll-GLB nicht vorhanden. Zuerst POST /jobs/{id}/build3d.")
    return FileResponse(path, media_type="model/gltf-binary")


@app.get("/jobs/{job_id}/cloud.bin")
def job_cloud_bin(job_id: str):
    """Kompakte Binär-Wolke (uint32 count + float32 xyz + uint8 rgb) für den Three.js-Viewer."""
    path = os.path.join(build3d.job_dir(job_id), "cloud.bin")
    if not os.path.exists(path):
        raise HTTPException(404, "cloud.bin nicht vorhanden. Zuerst POST /jobs/{id}/build3d.")
    return FileResponse(path, media_type="application/octet-stream")


# Content-Types der Potree-2.0-Octree-Dateien.
_CLOUD_CT = {".json": "application/json", ".bin": "application/octet-stream"}


@app.get("/jobs/{job_id}/cloud/{path:path}")
def job_cloud(job_id: str, path: str):
    """Potree-Octree-Dateien (metadata.json/hierarchy.bin/octree.bin) statisch ausliefern.

    FileResponse unterstützt HTTP-Range — Potree lädt octree.bin per Range.
    """
    try:
        full = build3d.cloud_file(job_id, path)
    except ValueError:
        raise HTTPException(400, "Ungültiger Pfad.")
    if not os.path.isfile(full):
        raise HTTPException(404, "Octree-Datei nicht gefunden.")
    ct = _CLOUD_CT.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
    return FileResponse(full, media_type=ct)


# Weitere statische Assets (falls später CSS/JS ausgelagert wird) unter /static.
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
