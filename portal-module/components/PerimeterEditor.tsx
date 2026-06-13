"use client";
/**
 * Wiederverwendbarer, KONTROLLIERTER Bauperimeter-Editor (Karte + Adresssuche +
 * Parzelle/Zeichnen + DXF-Import). Haelt KEINEN Server-State — perimeter/parcels
 * kommen via Props, jede Aenderung meldet onChange. Persistenz uebernimmt der
 * Aufrufer (Projekt anlegen: mit POST; Projektseite: PATCH).
 */
import { useState } from "react";
import dynamicImport from "next/dynamic";
import { useToast } from "@/components/ui";
import { BP } from "@/lib/api";
import type { DxfPolyline } from "@/lib/computeClient";
import type { PMapMode } from "@/components/PerimeterMap";

const PerimeterMap = dynamicImport(() => import("@/components/PerimeterMap"), { ssr: false });

export type Parcel = { egrid: string | null; number: string | null; ak: string | null };

export function PerimeterEditor({
  perimeter, parcels, onChange, stacked = false, mapHeight,
}: {
  perimeter: [number, number][][];
  parcels: Parcel[];
  onChange: (perimeter: [number, number][][], parcels: Parcel[]) => void;
  stacked?: boolean;
  mapHeight?: number;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<PMapMode>("view");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ label: string; e: number; n: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState<{ e: number; n: number } | null>(null);
  const [dxfList, setDxfList] = useState<DxfPolyline[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    const text = q.trim();
    if (text.length < 2) return;
    setSearching(true);
    try {
      const r = await fetch(`${BP}/api/cadastral/search?q=${encodeURIComponent(text)}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setResults(data.results ?? []);
      if (!data.results?.length) toast("Keine Treffer.", "error");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSearching(false);
    }
  }

  function goTo(res: { label: string; e: number; n: number }) {
    setFocus({ e: res.e, n: res.n });
    setResults([]);
    setQ(res.label);
  }

  async function onPick(e: number, n: number) {
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/cadastral/parcel?e=${e}&n=${n}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      onChange([...perimeter, data.polygon], [...parcels, { egrid: data.egrid, number: data.number, ak: data.ak }]);
      toast(`Parzelle ${data.number ?? ""}${data.ak ? " (" + data.ak + ")" : ""} hinzugefügt.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function onDrawn(pts: [number, number][]) {
    onChange([...perimeter, pts], [...parcels, { egrid: null, number: "manuell", ak: null }]);
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
    onChange([...perimeter, pl.points], [...parcels, { egrid: null, number: `DXF ${pl.layer}`, ak: null }]);
    toast(`Perimeter aus „${pl.layer}" übernommen.`);
  }

  function removeParcel(i: number) {
    onChange(perimeter.filter((_, k) => k !== i), parcels.filter((_, k) => k !== i));
  }

  const dxfId = "perim-dxf-" + (stacked ? "dlg" : "page");

  const controls = (
    <div className="grid" style={{ gap: 10 }}>
      <div className="grid" style={{ gap: 6 }}>
        <div className="row" style={{ display: "flex", gap: 6 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
            placeholder="Adresse / Ort suchen"
            autoComplete="off"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="button" onClick={() => void search()} disabled={searching}>{searching ? "…" : "Suchen"}</button>
        </div>
        {results.length > 0 && (
          <div className="grid" style={{ gap: 2 }}>
            {results.map((res, i) => (
              <button type="button" key={i} className="small" style={{ textAlign: "left" }} onClick={() => goTo(res)}>
                {res.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid cols-2">
        <button type="button" className={mode === "parcel" ? "primary" : ""} onClick={() => setMode(mode === "parcel" ? "view" : "parcel")}>Parzelle</button>
        <button type="button" className={mode === "draw" ? "primary" : ""} onClick={() => setMode(mode === "draw" ? "view" : "draw")}>Zeichnen</button>
      </div>
      {mode === "parcel" && <div className="small muted">Auf eine Parzelle klicken (amtliche Vermessung).</div>}
      {mode === "draw" && <div className="small muted">Punkte klicken; Doppelklick schliesst die Fläche.</div>}

      <div>
        <input type="file" accept=".dxf" style={{ display: "none" }} id={dxfId}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDxf(f); e.target.value = ""; }} />
        <button type="button" style={{ width: "100%" }} disabled={busy}
          onClick={() => document.getElementById(dxfId)?.click()}>
          {busy ? "…" : "DXF importieren (Aushubgrenze)"}
        </button>
        <div className="small muted" style={{ marginTop: 4 }}>DWG vorher im CAD nach DXF exportieren.</div>
      </div>

      {dxfList && (
        <div className="grid" style={{ gap: 6 }}>
          <div className="spread">
            <strong className="small">DXF-Polylinien ({dxfList.length})</strong>
            <button type="button" style={{ padding: "2px 8px" }} onClick={() => setDxfList(null)}>schliessen</button>
          </div>
          {dxfList.map((pl, i) => (
            <div key={i} className="spread small" style={{ alignItems: "center" }}>
              <span>{pl.layer || "(ohne Layer)"} · {pl.area_m2.toLocaleString("de-CH")} m²
                {!pl.looks_lv95 && <span style={{ color: "#d33" }}> · nicht LV95?</span>}</span>
              <button type="button" style={{ padding: "2px 8px" }} onClick={() => assignToPerimeter(pl)}>übernehmen</button>
            </div>
          ))}
        </div>
      )}

      {perimeter.length > 0 && (
        <div className="grid" style={{ gap: 4 }}>
          {parcels.map((pc, i) => (
            <div key={i} className="spread small" style={{ alignItems: "center" }}>
              <span>{pc.number === "manuell" ? `Fläche ${i + 1} (gezeichnet)` : `Parz. ${pc.number ?? "?"}${pc.ak ? " " + pc.ak : ""}`}</span>
              <button type="button" style={{ padding: "2px 8px" }} onClick={() => removeParcel(i)}>x</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Gestapelt (schmaler Anlege-Dialog): Karte oben, Bedienung darunter.
  if (stacked) {
    return (
      <div className="grid" style={{ gap: 10 }}>
        <PerimeterMap perimeter={perimeter} mode={mode} onPick={onPick} onDrawn={onDrawn} focus={focus} mapHeight={mapHeight ?? 300} />
        {controls}
      </div>
    );
  }

  // Standard: Karte ueber die volle Breite, Bedienung als Overlay oben rechts.
  return (
    <div style={{ position: "relative" }}>
      <PerimeterMap perimeter={perimeter} mode={mode} onPick={onPick} onDrawn={onDrawn} focus={focus} mapHeight={mapHeight ?? 560} />
      <div
        style={{
          position: "absolute", top: 10, right: 10, zIndex: 1100,
          width: 300, maxWidth: "calc(100% - 20px)", maxHeight: "calc(100% - 20px)",
          overflowY: "auto",
          background: "rgba(255,255,255,0.96)", border: "1px solid var(--border)",
          borderRadius: 10, padding: 10, boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
        }}
      >
        {controls}
      </div>
    </div>
  );
}
