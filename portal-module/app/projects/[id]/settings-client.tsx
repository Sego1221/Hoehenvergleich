"use client";
/**
 * Projekt-Einstellungen (Dialog): Projektangaben, Georef-Transformation und
 * Bauperimeter — alles EINMALIGE Projekt-Grundlagen. Die Projektseite selbst
 * zeigt nur die Vergleichs-Historie; diese Grundlagen liegen hinter dem Button.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, useToast } from "@/components/ui";
import { BP } from "@/lib/api";
import { TransformPanel } from "./transform-client";
import { PerimeterPanel } from "./perimeter-client";
import type { Parcel } from "@/components/PerimeterEditor";

type TransformInit = {
  tE: number; tN: number; tH: number; angleDeg: number;
  unit: string; label?: string; verifiedAt?: string | Date | null;
} | null;

type StructTf = { tE: number; tN: number; tH: number; angleDeg: number } | null;

export function ProjectSettings({
  projectId, projektNummer, name, adresse, ort, notes,
  transform, initialPerimeter, initialParcels, structureTransform,
}: {
  projectId: string;
  projektNummer: string; name: string; adresse: string | null; ort: string | null; notes: string | null;
  transform: TransformInit;
  initialPerimeter: [number, number][][] | null;
  initialParcels: Parcel[] | null;
  structureTransform: StructTf;
}) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nm, setNm] = useState(name);
  const [ad, setAd] = useState(adresse ?? "");
  const [or, setOr] = useState(ort ?? "");
  const [nt, setNt] = useState(notes ?? "");
  const [busy, setBusy] = useState(false);
  // Strukturmodell-Georef (Baufortschritt).
  const [sE, setSE] = useState(structureTransform ? String(structureTransform.tE) : "");
  const [sN, setSN] = useState(structureTransform ? String(structureTransform.tN) : "");
  const [sH, setSH] = useState(structureTransform ? String(structureTransform.tH) : "");
  const [sA, setSA] = useState(structureTransform ? String(structureTransform.angleDeg) : "0");
  const [savingStruct, setSavingStruct] = useState(false);

  async function saveStruct() {
    setSavingStruct(true);
    try {
      const empty = !sE.trim() && !sN.trim() && !sH.trim();
      const body = empty ? { structureTransform: null }
        : { structureTransform: { tE: Number(sE), tN: Number(sN), tH: Number(sH), angleDeg: Number(sA || "0") } };
      const r = await fetch(`${BP}/api/projects/${projectId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Fehler ${r.status}`);
      toast("Strukturmodell-Georef gespeichert.");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingStruct(false);
    }
  }

  async function saveFields() {
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/projects/${projectId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nm, adresse: ad, ort: or, notes: nt }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Fehler ${r.status}`);
      toast("Projektangaben gespeichert.");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}>Bearbeiten</button>
      <Dialog open={open} title="Projekt-Einstellungen" onClose={() => setOpen(false)} maxWidth={1100}>
        <div style={{ maxHeight: "82vh", overflowY: "auto", display: "grid", gap: 14, paddingRight: 4 }}>
          {/* Angaben */}
          <div className="panel">
            <div className="spread" style={{ marginBottom: 8 }}>
              <strong>Projektangaben</strong>
              <button className="primary" disabled={busy || !nm.trim()} onClick={saveFields}>
                {busy ? "Speichert …" : "Speichern"}
              </button>
            </div>
            <div className="grid cols-2">
              <div><label>Projektnummer</label><input value={projektNummer} disabled autoComplete="off" /></div>
              <div><label>Projektname</label><input value={nm} onChange={(e) => setNm(e.target.value)} autoComplete="off" /></div>
              <div><label>Adresse</label><input value={ad} onChange={(e) => setAd(e.target.value)} autoComplete="off" /></div>
              <div><label>Ort</label><input value={or} onChange={(e) => setOr(e.target.value)} autoComplete="off" /></div>
            </div>
            <div style={{ marginTop: 8 }}>
              <label>Notiz</label>
              <textarea value={nt} onChange={(e) => setNt(e.target.value)} rows={2} autoComplete="off" />
            </div>
          </div>

          {/* Georef-Grundlage (einmalig) */}
          <TransformPanel projectId={projectId} initial={transform} />

          {/* Strukturmodell-Georef (Baufortschritt): Tekla lokal -> LV95 */}
          <div className="panel">
            <div className="spread" style={{ marginBottom: 8 }}>
              <strong>Strukturmodell-Georef (Baufortschritt)</strong>
              <button className="primary" disabled={savingStruct} onClick={saveStruct}>
                {savingStruct ? "Speichert …" : "Speichern"}
              </button>
            </div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              Tekla-Modell ist lokal → LV95 = Rz(−α)·(lokal − T). Leer lassen, wenn nicht genutzt.
            </div>
            <div className="grid cols-2">
              <div><label>tE [m]</label><input value={sE} onChange={(e) => setSE(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
              <div><label>tN [m]</label><input value={sN} onChange={(e) => setSN(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
              <div><label>tH [m]</label><input value={sH} onChange={(e) => setSH(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
              <div><label>Drehung α [°]</label><input value={sA} onChange={(e) => setSA(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
            </div>
          </div>

          {/* Bauperimeter (einmalig) */}
          <PerimeterPanel projectId={projectId} initialPerimeter={initialPerimeter} initialParcels={initialParcels} />
        </div>
      </Dialog>
    </>
  );
}
