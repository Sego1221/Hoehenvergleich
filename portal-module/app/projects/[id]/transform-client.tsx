"use client";
/** Georef-Transformation konfigurieren (kompakt, Custom-Select). */
import { useState } from "react";
import { Select, useToast } from "@/components/ui";
import { dateCH } from "@/lib/format";
import { BP } from "@/lib/api";

type T = {
  tE: number; tN: number; tH: number; angleDeg: number;
  unit: string; label?: string; verifiedAt?: string | Date | null;
};

export function TransformPanel({ projectId, initial }: { projectId: string; initial: T | null }) {
  const toast = useToast();
  const [tE, setTE] = useState(String(initial?.tE ?? ""));
  const [tN, setTN] = useState(String(initial?.tN ?? ""));
  const [tH, setTH] = useState(String(initial?.tH ?? ""));
  const [angle, setAngle] = useState(String(initial?.angleDeg ?? "0"));
  const [unit, setUnit] = useState<"m" | "mm">((initial?.unit as "m" | "mm") ?? "m");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/projects/${projectId}/transform`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tE: Number(tE), tN: Number(tN), tH: Number(tH),
          angleDeg: Number(angle), unit,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Fehler");
      toast("Transformation gespeichert.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 10 }}>
        <strong>Georef-Transformation (lokal ↔ LV95)</strong>
        {initial?.verifiedAt && <span className="badge">geprüft {dateCH(initial.verifiedAt)}</span>}
      </div>
      <div className="grid cols-2">
        <div><label>tE [m]</label><input value={tE} onChange={(e) => setTE(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
        <div><label>tN [m]</label><input value={tN} onChange={(e) => setTN(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
        <div><label>tH [m]</label><input value={tH} onChange={(e) => setTH(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
        <div><label>Drehung α [°]</label><input value={angle} onChange={(e) => setAngle(e.target.value)} autoComplete="off" inputMode="decimal" /></div>
        <div>
          <label>Modell-Einheit</label>
          <Select<"m" | "mm">
            value={unit}
            onChange={setUnit}
            options={[{ value: "m", label: "Meter (m)" }, { value: "mm", label: "Millimeter (mm)" }]}
          />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="primary" style={{ width: "100%" }} disabled={busy} onClick={save}>
            {busy ? "Speichern…" : "Transformation speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
