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
            <th style={{ width: 110 }}>Befliegung</th>
            <th style={{ width: 120 }}>Abtrag (Cut)</th>
            <th style={{ width: 120 }}>Auftrag (Fill)</th>
            <th style={{ width: 120 }}>Netto</th>
            <th style={{ width: 110 }}>% auf Soll</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {initialComparisons.length === 0 && (
            <tr><td colSpan={7} className="muted">Noch keine Vergleiche.</td></tr>
          )}
          {initialComparisons.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="muted">{dateCH(c.surveyDate)}</td>
              <td style={{ color: "var(--cut)" }}>{m3(c.stats?.cut_m3)}</td>
              <td style={{ color: "var(--fill)" }}>{m3(c.stats?.fill_m3)}</td>
              <td>{m3(c.stats?.net_m3)}</td>
              <td>{pct(c.stats?.on_target_pct)}</td>
              <td><Link href={`/comparisons/${c.id}`}>Öffnen →</Link></td>
            </tr>
          ))}
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
  const [name, setName] = useState("");
  const [surveyDate, setSurveyDate] = useState("");
  const [soll, setSoll] = useState<File | null>(null);
  const [ist, setIst] = useState<File | null>(null);
  const [res, setRes] = useState(0.25);
  const [tol, setTol] = useState(0.05);
  const [groundPct, setGroundPct] = useState(10);
  const [useVeg, setUseVeg] = useState(false);
  const [useTransform, setUseTransform] = useState(hasTransform);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!soll || !ist) { toast("Soll- und Ist-Datei wählen.", "error"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("soll", soll);
      fd.append("ist", ist);
      if (name.trim()) fd.append("name", name.trim());
      if (surveyDate) fd.append("surveyDate", surveyDate);
      fd.append("res", String(res));
      fd.append("tol", String(tol));
      fd.append("ground_pct", String(groundPct));
      fd.append("use_veg", String(useVeg));
      if (useTransform) {
        const tr = await fetch(`${BP}/api/projects/${projectId}/transform`).then((r) => r.json());
        if (tr) fd.append("transform", JSON.stringify(tr));
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
            <label>Soll (IFC / TIN)</label>
            <input type="file" accept=".ifc,.obj,.ply,.stl,.xml,.land,.tin" onChange={(e) => setSoll(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label>Ist (LAZ / LAS / DSM-GeoTIFF)</label>
            <input type="file" accept=".laz,.las,.tif,.tiff,.asc" onChange={(e) => setIst(e.target.files?.[0] ?? null)} />
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
          <label className="row" style={{ gap: 6, marginBottom: 0, opacity: hasTransform ? 1 : 0.5 }}>
            <input type="checkbox" style={{ width: "auto" }} disabled={!hasTransform} checked={useTransform} onChange={(e) => setUseTransform(e.target.checked)} />
            <span>Projekt-Transformation anwenden{hasTransform ? "" : " (keine vorhanden)"}</span>
          </label>
        </div>
      </div>
    </Dialog>
  );
}
