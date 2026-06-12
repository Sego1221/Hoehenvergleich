# -*- coding: utf-8 -*-
"""
Höhenvergleich (Soll-Ist Aushub) - CLI / Phase P0.

Vergleicht eine PIX4D-Punktwolke (Ist) gegen ein IFC-Aushubmodell (Soll, LV95)
und erzeugt: GeoTIFF (ΔZ), PNG-Karte, JSON-Statistik, PDF-Protokoll.

ΔZ = Z(Wolke) - Z(IFC-Soll):  + = Material über Soll (Restaushub), - = unter Soll (zu tief).

Beispiel:
  python hoehenvergleich.py --ifc modell.ifc --cloud wolke.laz --res 0.25 --tol 0.05 --outdir out
"""
import argparse, json, os, sys, time
import numpy as np

EXCLUDE_NAMES = {"Modelleinfügepunkt"}   # Allplan-Hilfsobjekte, kein Aushub
EPSG = 2056                              # CH1903+/LV95


def log(m): print(m, flush=True)


def build_ifc_dsm(ifc_path, x0, y0, res, nx, ny, max_thick=None):
    """IFC -> Oberseiten-DSM (Z-Buffer max) per Dreiecks-Rasterung, in LV95-Weltkoordinaten."""
    import ifcopenshell, ifcopenshell.geom as geom
    f = ifcopenshell.open(ifc_path)
    s = geom.settings(); s.set('use-world-coords', True)
    it = geom.iterator(s, f)
    mesh_z = np.full((ny, nx), -np.inf)
    n_used = 0
    if it.initialize():
        while True:
            sh = it.get()
            prod = f.by_id(sh.id) if hasattr(sh, 'id') else None
            name = (prod.Name if prod is not None else None) or ""
            v = np.asarray(sh.geometry.verts).reshape(-1, 3)
            fa = np.asarray(sh.geometry.faces).reshape(-1, 3)
            if name in EXCLUDE_NAMES or len(v) == 0:
                if not it.next(): break
                continue
            if max_thick is not None and (v[:, 2].max() - v[:, 2].min()) > max_thick:
                if not it.next(): break
                continue
            n_used += 1
            fx = (v[:, 0] - x0) / res; fy = (v[:, 1] - y0) / res; vz = v[:, 2]
            for a, b, c in fa:
                axx, ayy, bxx, byy, cxx, cyy = fx[a], fy[a], fx[b], fy[b], fx[c], fy[c]
                minx = max(int(np.floor(min(axx, bxx, cxx))), 0); maxx = min(int(np.ceil(max(axx, bxx, cxx))), nx - 1)
                miny = max(int(np.floor(min(ayy, byy, cyy))), 0); maxy = min(int(np.ceil(max(ayy, byy, cyy))), ny - 1)
                if maxx < minx or maxy < miny: continue
                gx, gy = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
                d = (byy - cyy) * (axx - cxx) + (cxx - bxx) * (ayy - cyy)
                if abs(d) < 1e-12: continue
                l1 = ((byy - cyy) * (gx - cxx) + (cxx - bxx) * (gy - cyy)) / d
                l2 = ((cyy - ayy) * (gx - cxx) + (axx - cxx) * (gy - cyy)) / d
                l3 = 1 - l1 - l2
                ins = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
                if not ins.any(): continue
                zz = l1 * vz[a] + l2 * vz[b] + l3 * vz[c]
                np.maximum.at(mesh_z, ((gy[ins] - 0.5).astype(int), (gx[ins] - 0.5).astype(int)), zz[ins])
            if not it.next(): break
    mesh_z[~np.isfinite(mesh_z)] = np.nan
    return mesh_z, n_used


def ifc_bbox(ifc_path):
    import ifcopenshell, ifcopenshell.geom as geom
    f = ifcopenshell.open(ifc_path)
    s = geom.settings(); s.set('use-world-coords', True)
    it = geom.iterator(s, f)
    mn = np.array([np.inf]*3); mx = np.array([-np.inf]*3)
    if it.initialize():
        while True:
            sh = it.get(); prod = f.by_id(sh.id)
            name = (prod.Name if prod is not None else None) or ""
            v = np.asarray(sh.geometry.verts).reshape(-1, 3)
            if name not in EXCLUDE_NAMES and len(v):
                mn = np.minimum(mn, v.min(0)); mx = np.maximum(mx, v.max(0))
            if not it.next(): break
    return mn, mx


def cloud_ground_dsm(cloud_path, x0, y0, res, nx, ny, ground_pct, exg_thr, use_veg):
    import laspy
    las = laspy.read(cloud_path)
    px, py, pz = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    n0 = len(px); removed = 0
    if use_veg and 'red' in las.point_format.dimension_names:
        r, g, b = [np.asarray(las[c]).astype(np.float32) for c in ('red', 'green', 'blue')]
        ssum = r + g + b + 1e-6
        exg = 2 * g / ssum - r / ssum - b / ssum
        keep = exg <= exg_thr; removed = int((~keep).sum())
        px, py, pz = px[keep], py[keep], pz[keep]
    elif use_veg:
        log("  ! Wolke ohne RGB - Vegetationsfilter uebersprungen")
    ix = np.floor((px - x0) / res).astype(np.int64); iy = np.floor((py - y0) / res).astype(np.int64)
    m = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    ix, iy, pz = ix[m], iy[m], pz[m]; cell = iy * nx + ix
    order = np.lexsort((pz, cell)); cs, zs = cell[order], pz[order]
    uniq, start, cnt = np.unique(cs, return_index=True, return_counts=True)
    gidx = start + np.floor(ground_pct * (cnt - 1)).astype(np.int64)
    cloud_z = np.full(ny * nx, np.nan); cloud_z[uniq] = zs[gidx]
    return cloud_z.reshape(ny, nx), n0, removed, int(m.sum())


def export_geotiff(path, dz, x0, y1, res):
    import rasterio
    from rasterio.transform import from_origin
    arr = np.flipud(dz).astype(np.float32)          # GeoTIFF: Zeile 0 = Nord
    transform = from_origin(x0, y1, res, res)
    with rasterio.open(path, 'w', driver='GTiff', height=arr.shape[0], width=arr.shape[1],
                       count=1, dtype='float32', crs=f'EPSG:{EPSG}', transform=transform,
                       nodata=np.nan) as dst:
        dst.write(arr, 1)


def make_png(path, dz, valid, x0, x1, y0, y1, res, tol, stats):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap, BoundaryNorm
    fig, ax = plt.subplots(1, 2, figsize=(16, 6.5)); ext = [x0, x1, y0, y1]; clip = 0.30
    im = ax[0].imshow(np.where(valid, dz, np.nan), origin='lower', extent=ext,
                      cmap='RdYlBu_r', vmin=-clip, vmax=clip, aspect='equal')
    ax[0].set_title(f'Abweichung ΔZ [m]  (+/-{clip} m)'); ax[0].set_xlabel('E (LV95)'); ax[0].set_ylabel('N (LV95)')
    plt.colorbar(im, ax=ax[0], shrink=.8, label='ΔZ [m]  (+ = Material ueber Soll)')
    cat = np.full(dz.shape, np.nan)
    cat[valid & (dz < -tol)] = 0; cat[valid & (np.abs(dz) <= tol)] = 1
    cat[valid & (dz > tol) & (dz <= 0.30)] = 2; cat[valid & (dz > 0.30)] = 3
    cmap = ListedColormap(['#2c7bb6', '#1a9641', '#fdae61', '#d7191c']); norm = BoundaryNorm([0, 1, 2, 3, 4], cmap.N)
    im2 = ax[1].imshow(cat, origin='lower', extent=ext, cmap=cmap, norm=norm, aspect='equal')
    ax[1].set_title(f"Cut {stats['cut_m3']:.0f} m3  /  Fill {stats['fill_m3']:.0f} m3"); ax[1].set_xlabel('E (LV95)')
    cb = plt.colorbar(im2, ax=ax[1], shrink=.8, ticks=[0.5, 1.5, 2.5, 3.5])
    cb.ax.set_yticklabels(['zu tief', 'auf Soll', 'Rest 5-30cm', '>30cm'])
    plt.tight_layout(); plt.savefig(path, dpi=130); plt.close()


def make_pdf(path, png, stats, params):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    c = canvas.Canvas(path, pagesize=landscape(A4)); W, H = landscape(A4)
    c.setFont('Helvetica-Bold', 16); c.drawString(20*mm, H-20*mm, 'Hoehenvergleich Soll-Ist (Aushub)')
    c.setFont('Helvetica', 9)
    c.drawString(20*mm, H-26*mm, f"IFC (Soll): {os.path.basename(params['ifc'])}")
    c.drawString(20*mm, H-31*mm, f"Wolke (Ist): {os.path.basename(params['cloud'])}   |   Datum: {params['date']}")
    c.drawImage(ImageReader(png), 20*mm, 55*mm, width=H-40*mm, preserveAspectRatio=True, anchor='sw')
    rows = [
        ('Arbeitsflaeche', f"{stats['area_m2']:.0f} m2"),
        ('Restaushub (Cut, ueber Soll)', f"{stats['cut_m3']:.0f} m3"),
        ('Ueberaushub (Fill, unter Soll)', f"{stats['fill_m3']:.0f} m3"),
        ('Netto (Cut - Fill)', f"{stats['net_m3']:+.0f} m3"),
        ('Mittel / Median ΔZ', f"{stats['mean_m']:+.3f} / {stats['median_m']:+.3f} m"),
        (f"Auf Soll (+/-{params['tol']*100:.0f} cm)", f"{stats['on_target_pct']:.1f} %"),
        ('Raster / Toleranz / Boden-P', f"{params['res']} m / {params['tol']} m / {int(params['ground_pct']*100)}%"),
    ]
    y = 45*mm; c.setFont('Helvetica', 10)
    for k, v in rows:
        c.drawString(20*mm, y, k); c.drawString(120*mm, y, v); y -= 6*mm
    c.showPage(); c.save()


def main():
    ap = argparse.ArgumentParser(description='Hoehenvergleich Soll-Ist Aushub (IFC vs. Punktwolke)')
    ap.add_argument('--ifc', required=True); ap.add_argument('--cloud', required=True)
    ap.add_argument('--res', type=float, default=0.25); ap.add_argument('--tol', type=float, default=0.05)
    ap.add_argument('--ground-pct', type=float, default=0.20); ap.add_argument('--exg', type=float, default=0.10)
    ap.add_argument('--cap', type=float, default=5.0); ap.add_argument('--max-thick', type=float, default=None,
                    help='Mesh-Elemente dicker als X m verwerfen (Artefakte)')
    ap.add_argument('--no-veg', action='store_true'); ap.add_argument('--outdir', default='out')
    a = ap.parse_args()
    t0 = time.time(); os.makedirs(a.outdir, exist_ok=True)

    log('1/5 IFC-Ausdehnung ...')
    mn, mx = ifc_bbox(a.ifc); x0, y0 = mn[0], mn[1]; x1, y1 = mx[0], mx[1]
    nx = int(np.ceil((x1 - x0) / a.res)); ny = int(np.ceil((y1 - y0) / a.res))
    log(f'   LV95 E {x0:.1f}-{x1:.1f}  N {y0:.1f}-{y1:.1f}  Raster {nx}x{ny} @ {a.res} m')

    log('2/5 IFC -> Soll-DSM ...')
    mesh_z, n_used = build_ifc_dsm(a.ifc, x0, y0, a.res, nx, ny, a.max_thick)
    log(f'   {n_used} Soll-Elemente, {int(np.isfinite(mesh_z).sum())} Zellen mit Flaeche')

    log('3/5 Wolke -> Ist-DSM ...')
    cloud_z, n0, removed, n_in = cloud_ground_dsm(a.cloud, x0, y0, a.res, nx, ny, a.ground_pct, a.exg, not a.no_veg)
    log(f'   {n0} Punkte, Vegetation entfernt {removed} ({100*removed/max(n0,1):.1f}%)')

    log('4/5 Differenz + Kubatur ...')
    dz = cloud_z - mesh_z
    valid = np.isfinite(dz) & (np.abs(dz) <= a.cap)
    d = dz[valid]; A = a.res * a.res
    stats = dict(
        area_m2=float(valid.sum()*A), cut_m3=float(np.clip(d,0,None).sum()*A),
        fill_m3=float(np.clip(-d,0,None).sum()*A), net_m3=float(d.sum()*A),
        mean_m=float(d.mean()), median_m=float(np.median(d)), std_m=float(d.std()),
        min_m=float(d.min()), max_m=float(d.max()),
        on_target_pct=float(100*np.mean(np.abs(d)<=a.tol)),
        cells=int(valid.sum()))

    log('5/5 Export ...')
    base = os.path.join(a.outdir, 'hoehenvergleich')
    export_geotiff(base+'_dz.tif', np.where(valid, dz, np.nan), x0, y1, a.res)
    make_png(base+'.png', dz, valid, x0, x1, y0, y1, a.res, a.tol, stats)
    params = dict(ifc=a.ifc, cloud=a.cloud, res=a.res, tol=a.tol, ground_pct=a.ground_pct,
                  date=time.strftime('%Y-%m-%d %H:%M'))
    make_pdf(base+'_protokoll.pdf', base+'.png', stats, params)
    with open(base+'_stats.json', 'w', encoding='utf-8') as fh:
        json.dump({**stats, 'params': {k: params[k] for k in ('res','tol','ground_pct','date')}}, fh,
                  ensure_ascii=False, indent=2)

    log('\n================ ERGEBNIS ================')
    log(f"Restaushub (Cut) : {stats['cut_m3']:8.0f} m3")
    log(f"Ueberaushub(Fill): {stats['fill_m3']:8.0f} m3")
    log(f"Netto            : {stats['net_m3']:+8.0f} m3")
    log(f"Auf Soll +/-{a.tol*100:.0f}cm : {stats['on_target_pct']:.1f}%   Median {stats['median_m']:+.3f} m")
    log(f"Dateien in: {a.outdir}/  (_dz.tif, .png, _protokoll.pdf, _stats.json)")
    log(f"Laufzeit: {time.time()-t0:.1f}s")


if __name__ == '__main__':
    main()
