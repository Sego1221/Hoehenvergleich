"use client";
/**
 * Profil-Diagramm (Distanz vs. Hoehe): Soll-Linie, Ist-Linie, ΔZ-Band.
 * Reines SVG (kein Browser-Default-Chart), ans App-Layout angepasst.
 */
import { useMemo } from "react";
import type { Profile } from "@/lib/computeClient";

export function ProfileChart({ profile }: { profile: Profile }) {
  const W = 760, H = 240, pad = { l: 48, r: 12, t: 12, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  const { sollPath, istPath, bandPath, yTicks, xTicks } = useMemo(() => {
    const xs = profile.dist;
    const ys = [...profile.soll, ...profile.ist].filter((v): v is number => v !== null && Number.isFinite(v));
    const xMin = xs[0] ?? 0, xMax = xs[xs.length - 1] ?? 1;
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
    const yPad = (yMax - yMin) * 0.1 || 0.5;
    yMin -= yPad; yMax += yPad;

    const sx = (d: number) => pad.l + ((d - xMin) / (xMax - xMin || 1)) * iw;
    const sy = (z: number) => pad.t + (1 - (z - yMin) / (yMax - yMin || 1)) * ih;

    const lineFor = (arr: (number | null)[]) => {
      let d = ""; let pen = false;
      arr.forEach((z, i) => {
        if (z === null || !Number.isFinite(z)) { pen = false; return; }
        const cmd = pen ? "L" : "M";
        d += `${cmd}${sx(xs[i]).toFixed(1)},${sy(z).toFixed(1)} `;
        pen = true;
      });
      return d.trim();
    };

    // ΔZ-Band: Flaeche zwischen Soll und Ist.
    let band = "";
    {
      const top: string[] = [], bot: string[] = [];
      xs.forEach((d, i) => {
        const s = profile.soll[i], t = profile.ist[i];
        if (s === null || t === null || !Number.isFinite(s) || !Number.isFinite(t)) return;
        top.push(`${sx(d).toFixed(1)},${sy(s as number).toFixed(1)}`);
        bot.push(`${sx(d).toFixed(1)},${sy(t as number).toFixed(1)}`);
      });
      if (top.length > 1) band = `M${top.join(" L")} L${bot.reverse().join(" L")} Z`;
    }

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const z = yMin + (i / 4) * (yMax - yMin);
      return { y: sy(z), label: z.toFixed(1) };
    });
    const xTicks = Array.from({ length: 5 }, (_, i) => {
      const d = xMin + (i / 4) * (xMax - xMin);
      return { x: sx(d), label: d.toFixed(0) };
    });

    return { sollPath: lineFor(profile.soll), istPath: lineFor(profile.ist), bandPath: band, yTicks, xTicks };
  }, [profile, ih, iw, pad.b, pad.l, pad.r, pad.t]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="var(--panel-2)" stroke="var(--border)" />
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={t.y} x2={W - pad.r} y2={t.y} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={pad.l - 6} y={t.y + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{t.label}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{t.label}</text>
        ))}
        {bandPath && <path d={bandPath} fill="rgba(59,130,246,0.18)" stroke="none" />}
        {sollPath && <path d={sollPath} fill="none" stroke="#9aa3b2" strokeWidth="2" />}
        {istPath && <path d={istPath} fill="none" stroke="#3b82f6" strokeWidth="2" />}
      </svg>
      <div className="row small muted" style={{ gap: 16, marginTop: 4 }}>
        <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#9aa3b2", verticalAlign: "middle" }} /> Soll</span>
        <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#3b82f6", verticalAlign: "middle" }} /> Ist</span>
        <span><span style={{ display: "inline-block", width: 12, height: 8, background: "rgba(59,130,246,0.18)", verticalAlign: "middle" }} /> ΔZ</span>
        <span style={{ marginLeft: "auto" }}>x: Distanz [m] · y: Höhe [m ü.M.]</span>
      </div>
    </div>
  );
}
