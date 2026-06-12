"use client";
/**
 * Vergleichs-Ansicht (Client): Karte + Toleranz-Slider (live statsForTol) +
 * Kennzahl-Kacheln + Schnitt-Werkzeug (Profil-Diagramm) + Bereichs-Werkzeug
 * (Cut/Fill der Auswahl) + PDF-Protokoll.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import dynamicImport from "next/dynamic";
import { useRouter } from "next/navigation";
import { Slider, useToast } from "@/components/ui";
import { ProfileChart } from "@/components/ProfileChart";
import { m3, m2, pct } from "@/lib/format";
import type { Profile, Stats, Volumes } from "@/lib/computeClient";
import { BP } from "@/lib/api";

// Karte nur clientseitig (Leaflet kennt window/document).
const HoehenMap = dynamicImport(() => import("@/components/HoehenMap"), { ssr: false });

type Mode = "view" | "line" | "polygon";

type Section = { id: string; name: string; kind: string | null; line: [number, number][] };
type Region = { id: string; name: string; polygon: [number, number][]; volumes: Record<string, number> | null };

export function CompareView({
  comparisonId, projectName, comparisonName, stats, params,
  initialSections, initialRegions,
}: {
  comparisonId: string; projectName: string; comparisonName: string;
  stats: Record<string, number> | null; params: Record<string, number> | null;
  initialSections: Section[]; initialRegions: Region[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [tol, setTol] = useState<number>(params?.tol ?? 0.05);
  const [live, setLive] = useState<Stats | null>(stats as unknown as Stats | null);
  const [mode, setMode] = useState<Mode>("view");
  const [sections, setSections] = useState<Section[]>(initialSections);
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lastVolume, setLastVolume] = useState<Volumes | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toleranz-Slider: live statsForTol abrufen (debounced), OHNE Neuberechnung.
  useEffect(() => {
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${BP}/api/comparisons/${comparisonId}/stats?tol=${tol}`);
        if (r.ok) setLive(await r.json());
      } catch { /* still */ }
    }, 250);
    return () => { if (debTimer.current) clearTimeout(debTimer.current); };
  }, [tol, comparisonId]);

  const onTarget = live?.on_target_pct ?? stats?.on_target_pct;

  async function handleDrawn(pts: [number, number][]) {
    if (mode === "line") {
      setBusy("Profil…");
      try {
        const r = await fetch(`${BP}/api/comparisons/${comparisonId}/profile`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ line: pts }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setProfile(data.profile);
        setPendingLine(pts);
      } catch (e) { toast((e as Error).message, "error"); }
      finally { setBusy(null); }
    } else if (mode === "polygon") {
      setBusy("Volumen…");
      try {
        const r = await fetch(`${BP}/api/comparisons/${comparisonId}/regions`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ polygon: pts, tol }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setLastVolume(data.volumes);
        setPendingPoly(pts);
      } catch (e) { toast((e as Error).message, "error"); }
      finally { setBusy(null); }
    }
    setMode("view");
  }

  const [pendingLine, setPendingLine] = useState<[number, number][] | null>(null);
  const [pendingPoly, setPendingPoly] = useState<[number, number][] | null>(null);

  async function saveSection(name: string) {
    if (!pendingLine) return;
    const r = await fetch(`${BP}/api/comparisons/${comparisonId}/sections`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, line: pendingLine }),
    });
    const row = await r.json();
    if (r.ok) { setSections((s) => [...s, row]); setPendingLine(null); toast("Schnitt gespeichert."); }
    else toast(row.error ?? "Fehler", "error");
  }

  async function saveRegion(name: string) {
    if (!pendingPoly) return;
    const r = await fetch(`${BP}/api/comparisons/${comparisonId}/regions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, polygon: pendingPoly, tol, save: true }),
    });
    const data = await r.json();
    if (r.ok && data.region) { setRegions((s) => [...s, data.region]); setPendingPoly(null); toast("Bereich gespeichert."); }
    else toast(data.error ?? "Fehler", "error");
  }

  async function downloadPdf() {
    setBusy("PDF…");
    try {
      const r = await fetch(`${BP}/api/comparisons/${comparisonId}/protocol`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tol, title: `Höhenvergleich ${projectName}` }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Fehler ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Protokoll_${comparisonName}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(null); }
  }

  const extent = useMemo<[number, number, number, number] | null>(() => {
    // Falls der Compute-Service extent in stats geliefert hat — sonst null.
    const e = (stats as any)?.extent;
    return Array.isArray(e) && e.length === 4 ? (e as [number, number, number, number]) : null;
  }, [stats]);

  return (
    <div className="grid" style={{ gap: 14, gridTemplateColumns: "1fr 340px", alignItems: "start" }}>
      {/* Linke Spalte: Karte + Profil */}
      <div className="grid" style={{ gap: 14 }}>
        <HoehenMap
          comparisonId={comparisonId}
          tol={tol}
          extent={extent}
          mode={mode}
          sections={sections}
          regions={regions}
          onDrawn={handleDrawn}
        />

        {profile && (
          <div className="panel">
            <div className="spread" style={{ marginBottom: 8 }}>
              <strong>Schnitt-Profil ({profile.length_m.toFixed(1)} m)</strong>
              <div className="row">
                {pendingLine && (
                  <button onClick={() => saveSection(`Schnitt ${sections.length + 1}`)}>
                    Schnitt speichern
                  </button>
                )}
                <button onClick={() => { setProfile(null); setPendingLine(null); }}>Schliessen</button>
              </div>
            </div>
            <ProfileChart profile={profile} />
          </div>
        )}
      </div>

      {/* Rechte Spalte: Werkzeuge + Kennzahlen */}
      <div className="grid" style={{ gap: 14 }}>
        <div className="panel">
          <label>Toleranz: {(tol * 100).toFixed(0)} cm (0–20)</label>
          <Slider value={tol} min={0} max={0.2} step={0.01} onChange={setTol} />
          <div className="small muted" style={{ marginTop: 6 }}>
            Aktualisiert Kennzahlen und Einfärbung live, ohne Neuberechnung.
          </div>
        </div>

        <div className="grid cols-2">
          <div className="kpi cut"><div className="l">Abtrag (Cut)</div><div className="v">{m3(live?.cut_m3 ?? stats?.cut_m3)}</div></div>
          <div className="kpi fill"><div className="l">Auftrag (Fill)</div><div className="v">{m3(live?.fill_m3 ?? stats?.fill_m3)}</div></div>
          <div className="kpi"><div className="l">Netto</div><div className="v">{m3(live?.net_m3 ?? stats?.net_m3)}</div></div>
          <div className="kpi"><div className="l">% auf Soll</div><div className="v">{pct(onTarget)}</div></div>
        </div>

        <div className="panel">
          <strong className="small">Werkzeuge</strong>
          <div className="grid cols-2" style={{ marginTop: 8 }}>
            <button className={mode === "line" ? "primary" : ""} onClick={() => setMode(mode === "line" ? "view" : "line")}>
              Schnitt zeichnen
            </button>
            <button className={mode === "polygon" ? "primary" : ""} onClick={() => setMode(mode === "polygon" ? "view" : "polygon")}>
              Bereich zeichnen
            </button>
          </div>
          {mode !== "view" && (
            <div className="small muted" style={{ marginTop: 8 }}>
              In die Karte klicken; Doppelklick beendet die {mode === "line" ? "Linie" : "Fläche"}.
            </div>
          )}
          {busy && <div className="small" style={{ marginTop: 8 }}>{busy}</div>}
        </div>

        {lastVolume && (
          <div className="panel">
            <div className="spread" style={{ marginBottom: 6 }}>
              <strong className="small">Bereichs-Volumen</strong>
              {pendingPoly && <button onClick={() => saveRegion(`Bereich ${regions.length + 1}`)}>Speichern</button>}
            </div>
            <div className="grid cols-2">
              <div className="kpi cut"><div className="l">Cut</div><div className="v" style={{ fontSize: 16 }}>{m3(lastVolume.cut_m3)}</div></div>
              <div className="kpi fill"><div className="l">Fill</div><div className="v" style={{ fontSize: 16 }}>{m3(lastVolume.fill_m3)}</div></div>
              <div className="kpi"><div className="l">Netto</div><div className="v" style={{ fontSize: 16 }}>{m3(lastVolume.net_m3)}</div></div>
              <div className="kpi"><div className="l">Fläche</div><div className="v" style={{ fontSize: 16 }}>{m2(lastVolume.area_m2)}</div></div>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="spread" style={{ marginBottom: 6 }}>
            <strong className="small">Gespeichert</strong>
          </div>
          <div className="small muted">Schnitte: {sections.length} · Bereiche: {regions.length}</div>
        </div>

        <button className="primary" disabled={!!busy} onClick={downloadPdf}>PDF-Protokoll</button>
      </div>
    </div>
  );
}
