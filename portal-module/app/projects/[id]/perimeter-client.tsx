"use client";
/**
 * Projekt-Bauperimeter (Aushubgrenze) BEARBEITEN — auf Projektebene, gilt fuer
 * alle Vergleiche. Nutzt den gemeinsamen PerimeterEditor und persistiert per
 * PATCH in projects.perimeter / perimeter_parcels.
 */
import { useState } from "react";
import { useToast } from "@/components/ui";
import { BP } from "@/lib/api";
import { PerimeterEditor, type Parcel } from "@/components/PerimeterEditor";

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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  function update(p: [number, number][][], pc: Parcel[]) {
    setPerimeter(p); setParcels(pc); setDirty(true);
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
        <div className="row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dirty && <span className="small muted">ungespeichert</span>}
          <button onClick={() => update([], [])} disabled={perimeter.length === 0}>Alle löschen</button>
          <button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? "Speichert …" : "Speichern"}</button>
        </div>
      </div>
      <PerimeterEditor perimeter={perimeter} parcels={parcels} onChange={update} />
    </div>
  );
}
