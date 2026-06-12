"use client";
/** Projekt anlegen (Dialog mit Custom-UI). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui";
import { BP } from "@/lib/api";

export function NewProject() {
  const [open, setOpen] = useState(false);
  const [projektNummer, setProjektNummer] = useState("");
  const [name, setName] = useState("");
  const [adresse, setAdresse] = useState("");
  const [ort, setOrt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const valid = projektNummer.trim() !== "" && name.trim() !== "";

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BP}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projektNummer, name, adresse, ort, notes }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Fehler");
      setOpen(false);
      setProjektNummer(""); setName(""); setAdresse(""); setOrt(""); setNotes("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>+ Neues Projekt</button>
      <Dialog
        open={open}
        title="Neues Projekt"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button onClick={() => setOpen(false)}>Abbrechen</button>
            <button className="primary" disabled={busy || !valid} onClick={save}>
              {busy ? "Speichern…" : "Anlegen"}
            </button>
          </>
        }
      >
        <div className="grid">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label>Projektnummer</label>
              <input value={projektNummer} onChange={(e) => setProjektNummer(e.target.value)} autoComplete="off" placeholder="z.B. 12901" />
            </div>
            <div>
              <label>Projektname</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="z.B. Müligasse" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label>Adresse</label>
              <input value={adresse} onChange={(e) => setAdresse(e.target.value)} autoComplete="off" placeholder="Strasse / Nr." />
            </div>
            <div>
              <label>Ort</label>
              <input value={ort} onChange={(e) => setOrt(e.target.value)} autoComplete="off" placeholder="z.B. Döttingen" />
            </div>
          </div>
          <div>
            <label>Notiz (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} autoComplete="off" />
          </div>
          {err && <div className="small" style={{ color: "var(--cut)" }}>{err}</div>}
        </div>
      </Dialog>
    </>
  );
}
