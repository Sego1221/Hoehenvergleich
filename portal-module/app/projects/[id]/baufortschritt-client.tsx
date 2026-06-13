"use client";
/**
 * Modul „Baufortschritt" (Projekt-Tab): Etappen-IFC + Scan hochladen -> Status je
 * Bauteil (gebaut/nicht/verdeckt) gegen den Scan; Etappen-Liste, Bauteil-Ampel-
 * Tabelle und 3D-Status-Viewer (Status-GLB).
 */
import { useEffect, useMemo, useState } from "react";
import dynamicImport from "next/dynamic";
import { Dialog, Select, useToast } from "@/components/ui";
import { BP } from "@/lib/api";
import { dateCH } from "@/lib/format";
import type { BauteilRow } from "@/lib/computeClient";

const StatusViewer3D = dynamicImport(() => import("@/components/StatusViewer3D"), { ssr: false });

type Run = {
  id: string; name: string; betonage: string | null; scanName: string | null;
  surveyDate: string | null; createdAt: string;
  summary: { n_elements: number; gebaut: number; nicht_gebaut: number; verdeckt: number } | null;
  elements: BauteilRow[] | null;
  overrides: Record<string, string> | null;
};

type StatusKey = "gebaut" | "nicht_gebaut" | "verdeckt" | "nicht_erfasst";
const STATUS_OPTS: { value: StatusKey; label: string }[] = [
  { value: "gebaut", label: "gebaut" }, { value: "nicht_gebaut", label: "nicht gebaut" },
  { value: "verdeckt", label: "verdeckt" }, { value: "nicht_erfasst", label: "nicht erfasst" },
];

const LABEL: Record<string, string> = { gebaut: "gebaut", nicht_gebaut: "nicht gebaut", verdeckt: "verdeckt" };
const COLOR: Record<string, string> = { gebaut: "#28b450", nicht_gebaut: "#969696", verdeckt: "#f0962a" };

function Ampel({ s }: { s: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLOR[s] ?? "#999", display: "inline-block" }} />
      {LABEL[s] ?? s}
    </span>
  );
}

export function BaufortschrittPanel({
  projectId, hasStructTransform, initialRuns,
}: {
  projectId: string; hasStructTransform: boolean; initialRuns: Run[];
}) {
  const toast = useToast();
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [sel, setSel] = useState<Run | null>(initialRuns[0] ?? null);
  const [open, setOpen] = useState(false);
  // Manuelle Korrekturen (Override) je gewaehltem Lauf.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  useEffect(() => { setOverrides((sel?.overrides as Record<string, string>) ?? {}); }, [sel?.id]); // eslint-disable-line
  const statusByGuid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of sel?.elements ?? []) if (e.guid) m[e.guid] = overrides[e.guid] ?? e.status;
    return m;
  }, [sel, overrides]);
  async function setStatusOverride(guid: string, st: StatusKey) {
    if (!sel) return;
    const next = { ...overrides, [guid]: st };
    setOverrides(next);
    setRuns((rs) => rs.map((r) => (r.id === sel.id ? { ...r, overrides: next } : r)));
    try {
      await fetch(`${BP}/api/baufortschritt/${sel.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ overrides: next }),
      });
    } catch { toast("Korrektur konnte nicht gespeichert werden.", "error"); }
  }

  if (!hasStructTransform) {
    return (
      <div className="panel">
        <strong>Baufortschritt</strong>
        <div className="small muted" style={{ marginTop: 6 }}>
          Es ist noch keine <b>Georef-Transformation</b> hinterlegt. In der Verwaltung das Projekt
          bearbeiten und tE/tN/tH/Winkel setzen — danach können hier Etappen ausgewertet werden.
          (Gleiche Transformation wie der Aushub; das lokale Tekla-Modell wird damit nach LV95 gebracht.)
        </div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="spread" style={{ padding: "12px 14px" }}>
          <strong>Baufortschritt — Etappen</strong>
          <button className="primary" onClick={() => setOpen(true)}>+ Neue Etappe auswerten</button>
        </div>
        <table>
          <thead><tr>
            <th>Etappe</th><th style={{ width: 90 }}>Betonage</th><th style={{ width: 110 }}>Datum</th>
            <th style={{ width: 90 }}>Bauteile</th><th style={{ width: 90 }}>gebaut</th>
            <th style={{ width: 90 }}>verdeckt</th><th style={{ width: 80 }}></th>
          </tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={7} className="muted">Noch keine Etappen ausgewertet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id} style={{ background: sel?.id === r.id ? "var(--panel-2)" : undefined }}>
                <td>{r.name}</td>
                <td className="muted">{r.betonage ?? "—"}</td>
                <td className="muted">{dateCH(r.surveyDate ?? r.createdAt)}</td>
                <td>{r.summary?.n_elements ?? "—"}</td>
                <td style={{ color: COLOR.gebaut }}>{r.summary?.gebaut ?? "—"}</td>
                <td style={{ color: COLOR.verdeckt }}>{r.summary?.verdeckt ?? "—"}</td>
                <td><button onClick={() => setSel(r)}>Öffnen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
          <StatusViewer3D url={`${BP}/api/baufortschritt/${sel.id}/status.glb`} statusByGuid={statusByGuid} />
          <div className="panel" style={{ padding: 0, maxHeight: 480, overflowY: "auto" }}>
            <div className="spread" style={{ padding: "10px 12px" }}>
              <strong className="small">Bauteile — {sel.name}</strong>
              <span className="small muted">Status korrigierbar (Override)</span>
            </div>
            <table>
              <thead><tr>
                <th>Material</th><th style={{ width: 70 }}>OK</th><th style={{ width: 140 }}>Status</th>
                <th style={{ width: 54 }}>geb%</th><th style={{ width: 64 }}>ΔZ</th>
              </tr></thead>
              <tbody>
                {(sel.elements ?? []).map((e, i) => {
                  const eff = (e.guid ? statusByGuid[e.guid] : e.status) as StatusKey;
                  const corrected = !!(e.guid && overrides[e.guid] && overrides[e.guid] !== e.status);
                  return (
                    <tr key={i}>
                      <td>{e.material ?? e.bauteil ?? "—"}{corrected && <span className="small muted"> ✎</span>}</td>
                      <td className="muted">{e.kote_ok ?? "—"}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLOR[eff] ?? "#999", flex: "0 0 auto" }} />
                          {e.guid
                            ? <Select<StatusKey> value={eff} options={STATUS_OPTS} onChange={(v) => setStatusOverride(e.guid as string, v)} />
                            : <span>{LABEL[eff] ?? eff}</span>}
                        </div>
                      </td>
                      <td>{Math.round((e.frac_gebaut ?? 0) * 100)}</td>
                      <td className="muted">{e.dz_mean != null ? `${e.dz_mean > 0 ? "+" : ""}${(e.dz_mean * 100).toFixed(1)} cm` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <NewRunDialog projectId={projectId} onClose={() => setOpen(false)}
          onDone={(run) => { setRuns((rs) => [run, ...rs]); setSel(run); setOpen(false); }} />
      )}
    </div>
  );
}

function NewRunDialog({ projectId, onClose, onDone }: {
  projectId: string; onClose: () => void; onDone: (run: Run) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [betonage, setBetonage] = useState("");
  const [surveyDate, setSurveyDate] = useState("");
  const [ifc, setIfc] = useState<File | null>(null);
  const [scan, setScan] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!ifc || !scan) { toast("Struktur-IFC und Scan wählen.", "error"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("ifc", ifc); fd.append("scan", scan);
      if (name.trim()) fd.append("name", name.trim());
      if (betonage.trim()) fd.append("betonage", betonage.trim());
      if (surveyDate) fd.append("surveyDate", surveyDate);
      const r = await fetch(`${BP}/api/projects/${projectId}/baufortschritt`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      toast("Etappe ausgewertet.");
      onDone(data as Run);
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open title="Neue Etappe auswerten" onClose={onClose} footer={
      <>
        <button onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={busy} onClick={start}>{busy ? "Wertet aus …" : "Auswerten"}</button>
      </>
    }>
      <div className="grid">
        <div className="grid cols-2">
          <div><label>Etappenname</label><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="z.B. UG Wände ET12" /></div>
          <div><label>Betonagenummer</label><input value={betonage} onChange={(e) => setBetonage(e.target.value)} autoComplete="off" placeholder="z.B. ET12" /></div>
        </div>
        <div><label>Datum Scan</label><input type="date" value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} autoComplete="off" /></div>
        <div className="grid cols-2">
          <div><label>Struktur-IFC</label><input type="file" onChange={(e) => setIfc(e.target.files?.[0] ?? null)} /></div>
          <div><label>Scan (LAZ/LAS)</label><input type="file" onChange={(e) => setScan(e.target.files?.[0] ?? null)} /></div>
        </div>
        <div className="small muted">Georef = Strukturmodell-Transformation des Projekts (Verwaltung).</div>
      </div>
    </Dialog>
  );
}
