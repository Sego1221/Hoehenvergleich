"use client";
/**
 * Projekt-Bauperimeter festlegen (Aushubgrenze) — auf PROJEKTEBENE, gilt fuer
 * alle Vergleiche. Parzelle aus amtlicher Vermessung anklicken, manuell zeichnen
 * oder DXF importieren. Speichert in projects.perimeter / perimeter_parcels.
 */
import { useState } from "react";
import dynamicImport from "next/dynamic";
import { useToast } from "@/components/ui";
import { BP } from "@/lib/api";
import type { DxfPolyline } from "@/lib/computeClient";
import type { PMapMode } from "@/components/PerimeterMap";

const PerimeterMap = dynamicImport(() => import("@/components/PerimeterMap"), { ssr: false });

type Parcel = { egrid: string | null; number: string | null; ak: string | null };

export function PerimeterPanel({
  projectId, initialPerimeter, initialParcels,
}: {
  projectId: string;
  initialPerimeter: [number, number][][] | null;
  initialParcels: Parcel[] | null;
}) {
  const toast = useToast();
  const [perimeter, setPerimeter] = useState<[number, number][][]>(initialPerimeter ?? []);
  const [parcels, setParcels] = useState<Parcel[]>(
    initialParcels ?? (initialPerimeter ?? []).map(() => ({ egrid: null, number: null, ak: null })),
  );
  const [mode, setMode] = useState<PMapMode>("view");
  const [dxfList, setDxfList] = useState<DxfPolyline[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onPick(e: number, n: number) {
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/cadastral/parcel?e=${e}&n=${n}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setPerimeter((ps) => [...ps, data.polygon]);
      setParcels((ps) => [...ps, { egrid: data.egrid, number: data.number, ak: data.ak }]);
      setDirty(true);
      toast(`Parzelle ${data.number ?? ""}${data.ak ? " (" + data.ak + ")" : ""} hinzugefügt.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function onDrawn(pts: [number, number][]) {
    setPerimeter((ps) => [...ps, pts]);
    setParcels((ps) => [...ps, { egrid: null, number: "manuell", ak: null }]);
    setDirty(true);
    setMode("view");
    toast("Fläche hinzugefügt.");
  }

  async function importDxf(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const r = await fetch(`${BP}/api/dxf`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      const list = (data.polylines as DxfPolyline[]).filter((p) => p.n >= 3);
      if (!list.length) throw new Error("Keine verwertbaren Polylinien im DXF.");
      setDxfList(list);
      if (list.some((p) => !p.looks_lv95)) toast("Achtung: Koordinaten wirken nicht wie LV95.", "error");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function assignToPerimeter(pl: DxfPolyline) {
    setPerimeter((ps) => [...ps, pl.points]);
    setParcels((ps) => [...ps, { egrid: null, number: `DXF ${pl.layer}`, ak: null }]);
    setDirty(true);
    toast(`Perimeter aus „${pl.layer}" übernommen.`);
  }

  function removeParcel(i: number) {
    setPerimeter((ps) => ps.filter((_, k) => k !== i));
    setParcels((ps) => ps.filter((_, k) => k !== i));
    setDirty(true);
  }

  function clearAll() {
    setPerimeter([]); setParcels([]); setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`${BP}/api/projects/${projectId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ perimeter: perimeter.length ? perimeter : null, perimeterParcels: parcels }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Fehler ${r.status}`);
      setDirty(false);
      toast("Bauperimeter beim Projekt gespeichert.");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 8 }}>
        <strong>Bauperimeter (Projekt)</strong>
        <span className="small muted">gilt für alle Vergleiche</span>
      </div>

      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 280px", alignItems: "start" }}>
        <PerimeterMap perimeter={perimeter} mode={mode} onPick={onPick} onDrawn={onDrawn} />

        <div className="grid" style={{ gap: 10 }}>
          <div className="grid cols-2">
            <button className={mode === "parcel" ? "primary" : ""} onClick={() => setMode(mode === "parcel" ? "view" : "parcel")}>
              Parzelle
            </button>
            <button className={mode === "draw" ? "primary" : ""} onClick={() => setMode(mode === "draw" ? "view" : "draw")}>
              Zeichnen
            </button>
          </div>
          {mode === "parcel" && <div className="small muted">Auf eine Parzelle in der Karte klicken (amtliche Vermessung).</div>}
          {mode === "draw" && <div className="small muted">Punkte klicken; Doppelklick schliesst die Fläche.</div>}

          <label className="small" style={{ display: "block" }}>
            <input type="file" accept=".dxf" style={{ display: "none" }}
              id="perim-dxf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDxf(f); e.target.value = ""; }} />
            <button style={{ width: "100%" }} disabled={busy}
              onClick={() => document.getElementById("perim-dxf")?.click()}>
              {busy ? "…" : "DXF importieren (Aushubgrenze)"}
            </button>
          </label>
          <div className="small muted">DWG vorher im CAD nach DXF exportieren.</div>

          {dxfList && (
            <div className="grid" style={{ gap: 6 }}>
              <div className="spread">
                <strong className="small">DXF-Polylinien ({dxfList.length})</strong>
                <button style={{ padding: "2px 8px" }} onClick={() => setDxfList(null)}>schliessen</button>
              </div>
              {dxfList.map((pl, i) => (
                <div key={i} className="spread small" style={{ alignItems: "center" }}>
                  <span>{pl.layer || "(ohne Layer)"} · {pl.area_m2.toLocaleString("de-CH")} m²
                    {!pl.looks_lv95 && <span style={{ color: "#d33" }}> · nicht LV95?</span>}</span>
                  <button style={{ padding: "2px 8px" }} onClick={() => assignToPerimeter(pl)}>übernehmen</button>
                </div>
              ))}
            </div>
          )}

          {perimeter.length > 0 && (
            <div className="grid" style={{ gap: 4 }}>
              {parcels.map((pc, i) => (
                <div key={i} className="spread small" style={{ alignItems: "center" }}>
                  <span>{pc.number === "manuell" ? `Fläche ${i + 1} (gezeichnet)` : `Parz. ${pc.number ?? "?"}${pc.ak ? " " + pc.ak : ""}`}</span>
                  <button style={{ padding: "2px 8px" }} onClick={() => removeParcel(i)}>x</button>
                </div>
              ))}
            </div>
          )}

          <div className="grid cols-2">
            <button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? "Speichert …" : "Speichern"}</button>
            <button disabled={perimeter.length === 0} onClick={clearAll}>Alle löschen</button>
          </div>
          {dirty && <div className="small muted">Ungespeicherte Änderung.</div>}
        </div>
      </div>
    </div>
  );
}
