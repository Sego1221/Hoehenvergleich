"use client";
/**
 * Vergleichs-Historie (Tabelle benannt+datiert mit Cut/Fill/% auf Soll) +
 * "Neuer Vergleich" (Upload Soll + Ist + Parameter).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, Slider, useToast } from "@/components/ui";
import { m3, pct, dateCH } from "@/lib/format";
import { BP } from "@/lib/api";

type Comp = {
  id: string; name: string; surveyDate: string | null;
  stats: Record<string, number> | null;
  mode?: string;
};

export function HistoryAndCompare({
  projectId, initialComparisons, hasTransform,
}: {
  projectId: string; initialComparisons: Comp[]; hasTransform: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="spread" style={{ padding: "12px 14px" }}>
        <strong>Vergleichs-Historie</strong>
        <button className="primary" onClick={() => setOpen(true)}>+ Neuer Vergleich</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: 80 }}>Art</th>
            <th style={{ width: 110 }}>Befliegung</th>
            <th style={{ width: 120 }}>Abtrag</th>
            <th style={{ width: 120 }}>Auftrag</th>
            <th style={{ width: 120 }}>Netto</th>
            <th style={{ width: 110 }}>% i.T.</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {initialComparisons.length === 0 && (
            <tr><td colSpan={8} className="muted">Noch keine Vergleiche.</td></tr>
          )}
          {initialComparisons.map((c) => {
            // Wolke-vs-Wolke: ΔZ = B − A, Abtrag/Auftrag gegenüber Aushub vertauscht.
            const isClouds = c.mode === "clouds";
            const abtrag = isClouds ? c.stats?.fill_m3 : c.stats?.cut_m3;
            const auftrag = isClouds ? c.stats?.cut_m3 : c.stats?.fill_m3;
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted small">{isClouds ? "Wolke/Wolke" : "Aushub"}</td>
                <td className="muted">{dateCH(c.surveyDate)}</td>
                <td style={{ color: "var(--cut)" }}>{m3(abtrag)}</td>
                <td style={{ color: "var(--fill)" }}>{m3(auftrag)}</td>
                <td>{m3(c.stats?.net_m3)}</td>
                <td>{pct(c.stats?.on_target_pct)}</td>
                <td><Link href={`/comparisons/${c.id}`}>Öffnen →</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {open && (
        <NewComparisonDialog
          projectId={projectId}
          hasTransform={hasTransform}
          onClose={() => setOpen(false)}
          onDone={(id) => { setOpen(false); router.push(`/comparisons/${id}`); }}
        />
      )}
    </div>
  );
}

function NewComparisonDialog({
  projectId, hasTransform, onClose, onDone,
}: {
  projectId: string; hasTransform: boolean;
  onClose: () => void; onDone: (comparisonId: string) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"aushub" | "clouds">("aushub");
  const [name, setName] = useState("");
  const [surveyDate, setSurveyDate] = useState("");
  const [soll, setSoll] = useState<File | null>(null);
  const [ist, setIst] = useState<File | null>(null);
  const [res, setRes] = useState(0.25);
  const [tol, setTol] = useState(0.05);
  const [groundPct, setGroundPct] = useState(20);
  const [useVeg, setUseVeg] = useState(false);
  const [busy, setBusy] = useState(false);
  const clouds = mode === "clouds";

  async function start() {
    if (!soll || !ist) {
      toast(clouds ? "Beide Wolken (A und B) wählen." : "Soll- und Ist-Datei wählen.", "error");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      if (clouds) {
        fd.append("mode", "clouds");
        fd.append("cloud1", soll);
        fd.append("cloud2", ist);
      } else {
        fd.append("soll", soll);
        fd.append("ist", ist);
      }
      if (name.trim()) fd.append("name", name.trim());
      if (surveyDate) fd.append("surveyDate", surveyDate);
      fd.append("res", String(res));
      fd.append("tol", String(tol));
      // Slider ist Prozent (1..50); die Engine erwartet einen Bruch (0..1).
      fd.append("ground_pct", String(groundPct / 100));
      fd.append("use_veg", String(useVeg));
      // Georef-Transformation ist eine Projekt-Grundlage -> immer automatisch
      // anwenden (keine Frage pro Messung).
      if (hasTransform) {
        const tr = await fetch(`${BP}/api/projects/${projectId}/transform`).then((r) => r.json());
        // Kanonische lokal->LV95-Form (mit angle_deg-Key); Engine ueberspringt
        // ohnehin Modelle, die schon in LV95 liegen (Aushub).
        if (tr?.forward) fd.append("transform", JSON.stringify(tr.forward));
      }
      const r = await fetch(`${BP}/api/projects/${projectId}/comparisons`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Fehler");
      toast("Vergleich berechnet.");
      onDone(data.comparison.id);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Neuer Vergleich"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={busy} onClick={start}>
            {busy ? "Berechne…" : "Vergleich starten"}
          </button>
        </>
      }
    >
      <div className="grid">
        <div>
          <label>Vergleichsart</label>
          <div className="row" style={{ display: "flex", gap: 6 }}>
            <button type="button" className={mode === "aushub" ? "primary" : ""} style={{ flex: 1 }}
              onClick={() => setMode("aushub")}>Aushub (Modell vs. Wolke)</button>
            <button type="button" className={clouds ? "primary" : ""} style={{ flex: 1 }}
              onClick={() => setMode("clouds")}>Wolke vs. Wolke</button>
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {clouds
              ? "Höhendifferenz B − A zweier Punktwolken (positiv = Auftrag, negativ = Abtrag)."
              : "Soll-Modell (IFC/TIN) gegen Ist-Punktwolke."}
          </div>
        </div>
        <div className="grid cols-2">
          <div>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="z.B. Befliegung KW24" />
          </div>
          <div>
            <label>Datum Befliegung</label>
            <input type="date" value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="grid cols-2">
          <div>
            <label>{clouds ? "Wolke A — Referenz / früher (LAZ / LAS)" : "Soll (IFC / TIN)"}</label>
            {/* Kein accept-Filter: iOS Safari graut .ifc/.laz/.tif sonst aus (kein
                bekannter UTI). Validierung erfolgt client- und serverseitig nach Endung. */}
            <input type="file" onChange={(e) => setSoll(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label>{clouds ? "Wolke B — Vergleich / später (LAZ / LAS)" : "Ist (LAZ / LAS / DSM-GeoTIFF)"}</label>
            <input type="file" onChange={(e) => setIst(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="grid cols-3">
          <div>
            <label>Rasterweite: {res.toFixed(2)} m</label>
            <Slider value={res} min={0.1} max={1} step={0.05} onChange={setRes} />
          </div>
          <div>
            <label>Default-Toleranz: {(tol * 100).toFixed(0)} cm</label>
            <Slider value={tol} min={0} max={0.2} step={0.01} onChange={setTol} />
          </div>
          <div>
            <label>Boden-Perzentil: {groundPct} %</label>
            <Slider value={groundPct} min={1} max={50} step={1} onChange={setGroundPct} />
          </div>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <label className="row" style={{ gap: 6, marginBottom: 0 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={useVeg} onChange={(e) => setUseVeg(e.target.checked)} />
            <span>Vegetation filtern (ExG)</span>
          </label>
          <span className="small muted">
            {hasTransform ? "Projekt-Georeferenzierung wird automatisch angewendet." : "Keine Projekt-Georeferenzierung hinterlegt."}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
