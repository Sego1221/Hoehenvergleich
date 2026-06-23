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
import type { Profile, Stats, Volumes, Exclusions } from "@/lib/computeClient";
import { BP } from "@/lib/api";

// Karte nur clientseitig (Leaflet kennt window/document).
const HoehenMap = dynamicImport(() => import("@/components/HoehenMap"), { ssr: false });
// 3D-Viewer (Three.js) ebenfalls nur clientseitig.
const Viewer3D = dynamicImport(() => import("@/components/Viewer3D"), { ssr: false });

type Tab = "3d" | "2d";

type Mode = "view" | "line" | "polygon" | "exclude";
type Excl = { polygons: [number, number][][]; zMin: number | null; zMax: number | null };

type Section = { id: string; name: string; kind: string | null; line: [number, number][] };
type Region = { id: string; name: string; polygon: [number, number][]; volumes: Record<string, number> | null };

export function CompareView({
  comparisonId, projectId, projectName, comparisonName, stats, params,
  initialSections, initialRegions, initialPerimeter, initialParcels, initialExclusions,
}: {
  comparisonId: string; projectId: string; projectName: string; comparisonName: string;
  stats: Record<string, number> | null; params: Record<string, number> | null;
  initialSections: Section[]; initialRegions: Region[];
  initialPerimeter: [number, number][][] | null;
  initialParcels: { egrid: string | null; number: string | null; ak: string | null }[] | null;
  initialExclusions: Excl | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("3d");
  const [tol, setTol] = useState<number>(params?.tol ?? 0.05);
  const [clipOverride, setClipOverride] = useState<number | null>(null); // null = Auto-Skala
  const [excl, setExcl] = useState<Excl>(initialExclusions ?? { polygons: [], zMin: null, zMax: null });
  const [reloadKey, setReloadKey] = useState(0); // bump nach Ausschluss-Aenderung -> Karte/Stats neu

  // Ausschluss speichern (PATCH) und Karte/Kennzahlen neu laden.
  async function saveExclusions(next: Excl) {
    setExcl(next);
    try {
      const body: Exclusions = (next.polygons.length || next.zMin != null || next.zMax != null) ? next : null;
      await fetch(`${BP}/api/comparisons/${comparisonId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ exclusions: body }),
      });
      setReloadKey((k) => k + 1);
    } catch { toast("Ausschluss konnte nicht gespeichert werden.", "error"); }
  }
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
        const r = await fetch(`${BP}/api/comparisons/${comparisonId}/stats?tol=${tol}&_=${reloadKey}`);
        if (r.ok) setLive(await r.json());
      } catch { /* still */ }
    }, 250);
    return () => { if (debTimer.current) clearTimeout(debTimer.current); };
  }, [tol, comparisonId, reloadKey]);

  const onTarget = live?.on_target_pct ?? stats?.on_target_pct;

  // Wolke-gegen-Wolke: ΔZ = B − A, daher sind Abtrag/Auftrag gegenüber dem
  // Aushub vertauscht (cut_m3 = positiv = Auftrag). Spalten behalten ihre
  // Bedeutung, der passende Wert wird eingesetzt.
  const isClouds = (params as Record<string, unknown> | null)?.mode === "clouds";
  const abtragVal = isClouds ? (live?.fill_m3 ?? stats?.fill_m3) : (live?.cut_m3 ?? stats?.cut_m3);
  const auftragVal = isClouds ? (live?.cut_m3 ?? stats?.cut_m3) : (live?.fill_m3 ?? stats?.fill_m3);
  const onTargetLabel = isClouds ? "% unverändert" : "% auf Soll";

  // Farbskala der ΔZ-Karte: Auto (Perzentil aus Compute) oder manuell übersteuert.
  const autoClip = live?.clip_auto ?? stats?.clip_auto ?? 0.30;
  const clip = clipOverride ?? autoClip;

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
    } else if (mode === "exclude") {
      if (pts.length >= 3) {
        void saveExclusions({ ...excl, polygons: [...excl.polygons, pts] });
        toast("Sperrbereich hinzugefügt.");
      }
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

  // Vergleichs-Ansicht über die volle Breite (Breitenlimit der .content aufheben),
  // damit der Viewer maximal gross wird.
  useEffect(() => {
    document.body.classList.add("hv-wide");
    return () => document.body.classList.remove("hv-wide");
  }, []);

  const extent = useMemo<[number, number, number, number] | null>(() => {
    // Falls der Compute-Service extent in stats geliefert hat — sonst null.
    const e = (stats as any)?.extent;
    return Array.isArray(e) && e.length === 4 ? (e as [number, number, number, number]) : null;
  }, [stats]);

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* Tab-Umschalter: 3D-Viewer (Default) vs. 2D-Karte */}
      <div className="row" style={{ gap: 6 }}>
        <button className={tab === "3d" ? "primary" : ""} onClick={() => setTab("3d")}>3D-Viewer</button>
        <button className={tab === "2d" ? "primary" : ""} onClick={() => setTab("2d")}>2D-Karte</button>
      </div>

      {tab === "3d" ? (
        <Viewer3D
          comparisonId={comparisonId}
          projectId={projectId}
          tol={tol}
          initialPerimeter={initialPerimeter}
          initialParcels={initialParcels}
          excludePolygons={excl.polygons}
          onAddExclude={(poly) => void saveExclusions({ ...excl, polygons: [...excl.polygons, poly] })}
        />
      ) : (
        Map2D()
      )}

      {/* Differenzen direkt unter dem Viewer — in beiden Tabs sichtbar. */}
      <div className="panel">
        <div className="spread" style={{ marginBottom: 8, alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <strong className="small">Differenzen (ΔZ = {isClouds ? "B − A" : "Ist − Soll"})</strong>
          <span className="small muted">
            {(() => {
              const z = (live ?? stats) as Record<string, number> | null;
              const f = (v?: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)} m`);
              return `Ø ${f(z?.mean_m)} · Median ${f(z?.median_m)} · Spanne ${f(z?.min_m)} … ${f(z?.max_m)}`;
            })()}
          </span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <div className="kpi cut"><div className="l">Abtrag</div><div className="v">{m3(abtragVal)}</div></div>
          <div className="kpi fill"><div className="l">Auftrag</div><div className="v">{m3(auftragVal)}</div></div>
          <div className="kpi"><div className="l">Netto</div><div className="v">{m3(live?.net_m3 ?? stats?.net_m3)}</div></div>
          <div className="kpi"><div className="l">{onTargetLabel}</div><div className="v">{pct(onTarget)}</div></div>
          <div className="kpi"><div className="l">Fläche</div><div className="v">{m2(live?.area_m2 ?? stats?.area_m2)}</div></div>
        </div>
        {(initialPerimeter?.length || excl.polygons.length || excl.zMin != null || excl.zMax != null) ? (
          <div className="small muted" style={{ marginTop: 8 }}>
            {initialPerimeter?.length ? "Auf den Bauperimeter beschränkt. " : ""}
            {(excl.polygons.length || excl.zMin != null || excl.zMax != null) ? "Ausschluss (Sperrbereiche/Höhenband) ist berücksichtigt." : ""}
          </div>
        ) : null}
      </div>
    </div>
  );

  function Map2D() {
   return (
    <div className="grid" style={{ gap: 14, gridTemplateColumns: "1fr 340px", alignItems: "start" }}>
      {/* Linke Spalte: Karte + Profil */}
      <div className="grid" style={{ gap: 14 }}>
        <HoehenMap
          comparisonId={comparisonId}
          tol={tol}
          clip={clip}
          extent={extent}
          mode={mode}
          sections={sections}
          regions={regions}
          excludePolygons={excl.polygons}
          reloadKey={reloadKey}
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
          <div className="spread" style={{ marginTop: 12, alignItems: "center" }}>
            <label style={{ marginBottom: 0 }}>Farbskala: ±{Math.round(clip * 100)} cm</label>
            <button style={{ padding: "2px 10px" }} className={clipOverride === null ? "primary" : ""}
              onClick={() => setClipOverride(null)} title="Automatisch aus den Daten (98.-Perzentil)">Auto</button>
          </div>
          <Slider value={clip} min={0.02} max={0.5} step={0.01} onChange={setClipOverride} />
          <div className="small muted" style={{ marginTop: 6 }}>
            {clipOverride === null ? "Automatisch — feine Unterschiede werden sichtbar." : "Manuell übersteuert; Auto-Knopf stellt zurück."}
          </div>
        </div>

        {initialPerimeter && initialPerimeter.length > 0 && (
          <div className="small muted">Karte bezieht sich auf den Bauperimeter (Kennzahlen unter dem Viewer).</div>
        )}

        <div className="panel">
          <strong className="small">Werkzeuge</strong>
          <div className="grid cols-2" style={{ marginTop: 8 }}>
            <button className={mode === "line" ? "primary" : ""} onClick={() => setMode(mode === "line" ? "view" : "line")}>
              Schnitt zeichnen
            </button>
            <button className={mode === "polygon" ? "primary" : ""} onClick={() => setMode(mode === "polygon" ? "view" : "polygon")}>
              Bereich zeichnen
            </button>
            <button className={mode === "exclude" ? "primary" : ""} onClick={() => setMode(mode === "exclude" ? "view" : "exclude")}>
              Sperrbereich zeichnen
            </button>
          </div>
          {mode !== "view" && (
            <div className="small muted" style={{ marginTop: 8 }}>
              In die Karte klicken; Doppelklick beendet {mode === "line" ? "die Linie" : "die Fläche"}.
              {mode === "exclude" && " Die Fläche wird aus Statistik/Volumen/Karte ausgeschlossen."}
            </div>
          )}
          {busy && <div className="small" style={{ marginTop: 8 }}>{busy}</div>}
        </div>

        {/* Cleanup: Sperrbereiche + Höhenband (live maskiert, keine Neuberechnung) */}
        <div className="panel">
          <div className="spread">
            <strong className="small">Punkte ausschliessen</strong>
            {(excl.polygons.length > 0 || excl.zMin != null || excl.zMax != null) && (
              <button style={{ padding: "2px 10px" }} onClick={() => void saveExclusions({ polygons: [], zMin: null, zMax: null })}>
                Alles zurücksetzen
              </button>
            )}
          </div>
          {excl.polygons.length > 0 ? (
            <div className="grid" style={{ gap: 3, marginTop: 8 }}>
              {excl.polygons.map((_, i) => (
                <div key={i} className="spread small" style={{ alignItems: "center" }}>
                  <span>Sperrbereich {i + 1} ({excl.polygons[i].length} Punkte)</span>
                  <button style={{ padding: "1px 8px" }} title="Entfernen"
                    onClick={() => void saveExclusions({ ...excl, polygons: excl.polygons.filter((__, j) => j !== i) })}>x</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 6 }}>
              „Sperrbereich zeichnen" entfernt Flächen (Bagger, Material, Vegetation) aus dem Ergebnis.
            </div>
          )}

          {(() => {
            const zlo = live?.ist_min_m ?? stats?.ist_min_m;
            const zhi = live?.ist_max_m ?? stats?.ist_max_m;
            if (zlo == null || zhi == null || zhi - zlo < 0.02) return null;
            const lo = Math.floor(zlo * 100) / 100, hi = Math.ceil(zhi * 100) / 100;
            return (
              <div style={{ marginTop: 12 }}>
                <div className="spread" style={{ alignItems: "center" }}>
                  <label style={{ marginBottom: 0 }}>Höhenband (Ist) [m ü.M.]</label>
                  {(excl.zMin != null || excl.zMax != null) && (
                    <button style={{ padding: "2px 10px" }} onClick={() => void saveExclusions({ ...excl, zMin: null, zMax: null })}>Aus</button>
                  )}
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  von {(excl.zMin ?? lo).toFixed(2)} bis {(excl.zMax ?? hi).toFixed(2)} — nur Zellen in diesem Höhenband zählen.
                </div>
                <div className="row" style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <Slider value={excl.zMin ?? lo} min={lo} max={hi} step={0.05}
                    onChange={(v) => void saveExclusions({ ...excl, zMin: v <= lo ? null : v })} />
                  <Slider value={excl.zMax ?? hi} min={lo} max={hi} step={0.05}
                    onChange={(v) => void saveExclusions({ ...excl, zMax: v >= hi ? null : v })} />
                </div>
              </div>
            );
          })()}
        </div>

        {lastVolume && (
          <div className="panel">
            <div className="spread" style={{ marginBottom: 6 }}>
              <strong className="small">Bereichs-Volumen</strong>
              {pendingPoly && <button onClick={() => saveRegion(`Bereich ${regions.length + 1}`)}>Speichern</button>}
            </div>
            <div className="grid cols-2">
              <div className="kpi cut"><div className="l">Abtrag</div><div className="v" style={{ fontSize: 16 }}>{m3(isClouds ? lastVolume.fill_m3 : lastVolume.cut_m3)}</div></div>
              <div className="kpi fill"><div className="l">Auftrag</div><div className="v" style={{ fontSize: 16 }}>{m3(isClouds ? lastVolume.cut_m3 : lastVolume.fill_m3)}</div></div>
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
}
