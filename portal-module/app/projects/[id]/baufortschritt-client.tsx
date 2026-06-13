"use client";
/**
 * Modul „Baufortschritt" v2: Modell-Katalog EINMAL (alle Etappen-IFCs), danach
 * TAEGLICH nur den Scan -> Status je Bauteil + Zeitachse „gebaut seit".
 * Status pro Bauteil manuell korrigierbar (Override). 3D-Viewer mit Status-
 * Einblendung. Effektiver Status = Override ?? Auto.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import dynamicImport from "next/dynamic";
import { Dialog, Select, useToast } from "@/components/ui";
import { BP } from "@/lib/api";
import { dateCH } from "@/lib/format";
import type { BauteilRow } from "@/lib/computeClient";

const StatusViewer3D = dynamicImport(() => import("@/components/StatusViewer3D"), { ssr: false });

type Model = {
  id: string; computeModelId: string; nElements: number | null;
  betonagen: string[] | null; ifcNames: string[] | null;
  files: { name: string; size: number; mtime?: number }[] | null;
  elements: { guid: string | null; name: string | null; betonage: string | null }[] | null;
};
type Run = {
  id: string; name: string; scanName: string | null; surveyDate: string | null; createdAt: string;
  summary: { n_elements: number; gebaut: number; nicht_gebaut: number; verdeckt: number; nicht_erfasst?: number } | null;
  elements: BauteilRow[] | null;
  overrides: Record<string, string> | null;
};
type StatusKey = "gebaut" | "nicht_gebaut" | "verdeckt" | "nicht_erfasst";

const STATUS_OPTS: { value: StatusKey; label: string }[] = [
  { value: "gebaut", label: "gebaut" }, { value: "nicht_gebaut", label: "nicht gebaut" },
  { value: "verdeckt", label: "verdeckt" }, { value: "nicht_erfasst", label: "nicht erfasst" },
];
const COLOR: Record<string, string> = { gebaut: "#28b450", nicht_gebaut: "#969696", verdeckt: "#f0962a", nicht_erfasst: "#5a5a6e" };
const dkey = (r: Run) => r.surveyDate ?? r.createdAt;

export function BaufortschrittPanel({
  projectId, hasTransform, initialModel, initialRuns,
}: {
  projectId: string; hasTransform: boolean; initialModel: Model | null; initialRuns: Run[];
}) {
  const toast = useToast();
  const [model, setModel] = useState<Model | null>(initialModel);
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [sel, setSel] = useState<Run | null>(initialRuns[0] ?? null);
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);

  const [overrides, setOverrides] = useState<Record<string, string>>({});
  useEffect(() => { setOverrides((sel?.overrides as Record<string, string>) ?? {}); }, [sel?.id]); // eslint-disable-line

  const statusByGuid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of sel?.elements ?? []) if (e.guid) m[e.guid] = overrides[e.guid] ?? e.status;
    return m;
  }, [sel, overrides]);

  // Zeitachse: je Bauteil erster Scan (nach Datum) mit effektivem Status "gebaut".
  const gebautSeit = useMemo(() => {
    const m: Record<string, string> = {};
    const sorted = [...runs].sort((a, b) => dkey(a).localeCompare(dkey(b)));
    for (const run of sorted) {
      const ov = run.overrides ?? {};
      for (const e of run.elements ?? []) {
        if (e.guid && !m[e.guid] && (ov[e.guid] ?? e.status) === "gebaut") m[e.guid] = dkey(run);
      }
    }
    return m;
  }, [runs]);

  const total = model?.nElements ?? sel?.elements?.length ?? 0;
  const kumGebaut = useMemo(() => {
    if (!sel) return 0;
    const d = dkey(sel);
    return Object.values(gebautSeit).filter((dd) => dd <= d).length;
  }, [gebautSeit, sel]);

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

  async function uploadModel(files: FileList) {
    setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("ifcs", f));
      const r = await fetch(`${BP}/api/projects/${projectId}/bf-model`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setModel(data as Model);
      toast(`Katalog: ${data.nElements} Bauteile.`);
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  }

  async function rerun(run: Run) {
    setRerunning(run.id);
    try {
      const r = await fetch(`${BP}/api/baufortschritt/${run.id}/rescan`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setRuns((rs) => rs.map((x) => (x.id === run.id ? { ...x, ...(data as Run) } : x)));
      if (sel?.id === run.id) setSel({ ...sel, ...(data as Run) });
      toast("Auswertung erneuert.");
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setRerunning(null); }
  }

  async function deleteModel() {
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/projects/${projectId}/bf-model`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Fehler ${r.status}`);
      setModel(null); setConfirmDel(false);
      toast("Modell-Katalog gelöscht.");
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  }

  async function removeFile(name: string) {
    if (!model) return;
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/projects/${projectId}/bf-model/files/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setModel(data as Model);
      toast(`Etappe „${name}" entfernt — Katalog: ${data.nElements} Bauteile.`);
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  }

  if (!hasTransform) {
    return (
      <div className="panel">
        <strong>Baufortschritt</strong>
        <div className="small muted" style={{ marginTop: 6 }}>
          Zuerst die <b>Georef-Transformation</b> beim Projekt hinterlegen (Verwaltung → Projekt bearbeiten).
          Gleiche Transformation wie der Aushub; das lokale Tekla-Modell wird damit nach LV95 gebracht.
        </div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* Modell-Katalog */}
      <div className="panel">
        <div className="spread">
          <strong>Modell-Katalog</strong>
          <div className="row" style={{ display: "flex", gap: 8 }}>
            <input ref={modelFileRef} type="file" accept=".ifc,.ifczip" multiple style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.length) void uploadModel(e.target.files); e.target.value = ""; }} />
            <button disabled={busy} onClick={() => modelFileRef.current?.click()}>
              {busy ? "Lädt …" : model ? "Etappen ergänzen / ersetzen" : "Etappen-IFCs hochladen"}
            </button>
            {model && <button onClick={() => setShowPreview((v) => !v)}>{showPreview ? "Vorschau aus" : "Modell ansehen"}</button>}
            {model && !confirmDel && <button disabled={busy} onClick={() => setConfirmDel(true)}>Modell löschen</button>}
            {model && confirmDel && (
              <>
                <button className="primary" disabled={busy} onClick={() => void deleteModel()} style={{ borderColor: "var(--cut)" }}>
                  {busy ? "Löscht …" : "Wirklich löschen"}
                </button>
                <button disabled={busy} onClick={() => setConfirmDel(false)}>Abbrechen</button>
              </>
            )}
          </div>
        </div>
        {model ? (
          <>
            <div className="small muted" style={{ marginTop: 6 }}>
              {model.nElements} Bauteile · Betonagen: {(model.betonagen ?? []).join(", ") || "—"}
            </div>
            {(model.files?.length ?? 0) > 0 && (
              <div className="grid" style={{ gap: 4, marginTop: 8 }}>
                <div className="small muted">Etappen-Dateien ({model.files?.length}):</div>
                <div style={{ display: "grid", gap: 2, maxHeight: 220, overflowY: "auto" }}>
                  {(model.files ?? []).map((f) => (
                    <div key={f.name} className="spread small" style={{ alignItems: "center", padding: "2px 0" }}>
                      <span style={{ fontFamily: "var(--mono, monospace)" }}>{f.name}</span>
                      <div className="row" style={{ display: "flex", gap: 6 }}>
                        <span className="muted" style={{ fontSize: 11 }}>{(f.size / 1024).toFixed(0)} KB</span>
                        <button style={{ padding: "1px 8px" }} title="Entfernen"
                          onClick={() => void removeFile(f.name)}>x</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="small muted">Re-Upload mit gleichem Dateinamen <b>ersetzt</b> die Etappe; Auswertungen mit neuem Scan wiederholen.</div>
              </div>
            )}
          </>
        ) : (
          <div className="small muted" style={{ marginTop: 6 }}>
            Lade alle Etappen-IFCs (Bodenplatte + Wände …) einmal hoch. Danach täglich nur den Scan.
          </div>
        )}
        {model && showPreview && (
          <div style={{ marginTop: 10 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Ganzes Modell (alle Etappen) zur Kontrolle: lädt alles vollständig, sind Bauteile/Form plausibel?
              (oben rechts „Material/Status"). Georef-Lage prüfst du über „Neu auswerten" eines Scans.
            </div>
            <StatusViewer3D
              url={`${BP}/api/projects/${projectId}/bf-model/preview.glb`}
              statusByGuid={{}}
              guids={(model.elements ?? []).map((e) => e.guid)}
              defaultMode="material"
              height={420}
            />
          </div>
        )}
      </div>

      {/* Tages-Scans */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="spread" style={{ padding: "12px 14px" }}>
          <strong>Tages-Scans</strong>
          <button className="primary" disabled={!model} onClick={() => setScanOpen(true)}>+ Neuer Tages-Scan</button>
        </div>
        <table>
          <thead><tr>
            <th style={{ width: 120 }}>Datum</th><th>Scan</th>
            <th style={{ width: 90 }}>gebaut</th><th style={{ width: 100 }}>nicht erf.</th><th style={{ width: 160 }}></th>
          </tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Scans.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id} style={{ background: sel?.id === r.id ? "var(--panel-2)" : undefined }}>
                <td>{dateCH(r.surveyDate ?? r.createdAt)}</td>
                <td className="muted">{r.scanName ?? r.name}</td>
                <td style={{ color: COLOR.gebaut }}>{r.summary?.gebaut ?? "—"}</td>
                <td className="muted">{r.summary?.nicht_erfasst ?? "—"}</td>
                <td>
                  <div className="row" style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setSel(r)}>Öffnen</button>
                    <button disabled={rerunning === r.id} onClick={() => void rerun(r)} title="Gegen aktuellen Katalog + Georef neu auswerten">
                      {rerunning === r.id ? "…" : "Neu auswerten"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <>
          <div className="spread">
            <div className="small muted">
              Stand {dateCH(dkey(sel))}: <b style={{ color: COLOR.gebaut }}>{kumGebaut}</b> von {total} Bauteilen gebaut
              {total ? ` (${Math.round((100 * kumGebaut) / total)} %)` : ""} · kumuliert über alle Scans bis zu diesem Datum.
            </div>
            <a href={`${BP}/api/baufortschritt/${sel.id}/pdf`} target="_blank" rel="noopener noreferrer">
              <button>PDF-Protokoll</button>
            </a>
          </div>
          <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
            <StatusViewer3D url={`${BP}/api/baufortschritt/${sel.id}/status.glb`} statusByGuid={statusByGuid} guids={(sel.elements ?? []).map((e) => e.guid)} />
            <div className="panel" style={{ padding: 0, maxHeight: 480, overflowY: "auto" }}>
              <div className="spread" style={{ padding: "10px 12px" }}>
                <strong className="small">Bauteile</strong>
                <span className="small muted">Status korrigierbar</span>
              </div>
              <table>
                <thead><tr>
                  <th>Bauteil</th><th style={{ width: 64 }}>OK</th><th style={{ width: 140 }}>Status</th>
                  <th style={{ width: 96 }}>gebaut seit</th>
                </tr></thead>
                <tbody>
                  {(sel.elements ?? []).map((e, i) => {
                    const eff = (e.guid ? statusByGuid[e.guid] : e.status) as StatusKey;
                    const corrected = !!(e.guid && overrides[e.guid] && overrides[e.guid] !== e.status);
                    const seit = e.guid ? gebautSeit[e.guid] : undefined;
                    return (
                      <tr key={i}>
                        <td>{e.material ?? e.bauteil ?? "—"}{e.betonage ? ` · ${e.betonage}` : ""}{corrected && <span className="small muted"> ✎</span>}</td>
                        <td className="muted">{e.kote_ok ?? "—"}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLOR[eff] ?? "#999", flex: "0 0 auto" }} />
                            {e.guid
                              ? <Select<StatusKey> value={eff} options={STATUS_OPTS} onChange={(v) => setStatusOverride(e.guid as string, v)} />
                              : <span>{eff}</span>}
                          </div>
                        </td>
                        <td className="muted small">{seit ? dateCH(seit) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {scanOpen && model && (
        <NewScanDialog projectId={projectId} onClose={() => setScanOpen(false)}
          onDone={(run) => { setRuns((rs) => [run, ...rs]); setSel(run); setScanOpen(false); }} />
      )}
    </div>
  );
}

function NewScanDialog({ projectId, onClose, onDone }: {
  projectId: string; onClose: () => void; onDone: (run: Run) => void;
}) {
  const toast = useToast();
  const [surveyDate, setSurveyDate] = useState("");
  const [scan, setScan] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!scan) { toast("Scan-Datei wählen.", "error"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("scan", scan);
      if (surveyDate) fd.append("surveyDate", surveyDate);
      const r = await fetch(`${BP}/api/projects/${projectId}/baufortschritt`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      toast("Scan ausgewertet.");
      onDone(data as Run);
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open title="Neuer Tages-Scan" onClose={onClose} footer={
      <>
        <button onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={busy} onClick={start}>{busy ? "Wertet aus …" : "Auswerten"}</button>
      </>
    }>
      <div className="grid">
        <div><label>Datum (Befliegung)</label><input type="date" value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} autoComplete="off" /></div>
        <div><label>Scan (LAZ/LAS)</label><input type="file" onChange={(e) => setScan(e.target.files?.[0] ?? null)} /></div>
        <div className="small muted">Wird gegen den Modell-Katalog ausgewertet (Georef des Projekts).</div>
      </div>
    </Dialog>
  );
}
