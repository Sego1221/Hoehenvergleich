"use client";
/**
 * Custom-UI-Bausteine (kein nativer Browser-Default): Dialog, Select, Slider,
 * Toast. Alle ans App-Layout angepasst. Deutsch, echte Umlaute.
 */
import { useEffect, useRef, useState, createContext, useContext, useCallback } from "react";

/* ---------- Dialog (ersetzt alert/confirm) ---------- */
export function Dialog({
  open, title, children, onClose, footer, maxWidth = 560,
}: {
  open: boolean; title: string; children?: React.ReactNode;
  onClose: () => void; footer?: React.ReactNode;
  // Maximale Breite des Dialogs (px). Default 560; grosse Formulare (z.B. mit
  // Karte) koennen breiter sein.
  maxWidth?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="panel"
        style={{ minWidth: 380, maxWidth, width: maxWidth > 700 ? "95%" : "90%" }}
      >
        <div className="spread" style={{ marginBottom: 10 }}>
          <strong>{title}</strong>
          <button onClick={onClose} aria-label="Schliessen">x</button>
        </div>
        <div>{children}</div>
        {footer && <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Custom Select ---------- */
export function Select<T extends string>({
  value, options, onChange, autoComplete = "off",
}: {
  value: T; options: { value: T; label: string }[];
  onChange: (v: T) => void; autoComplete?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const cur = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: "relative" }} data-autocomplete={autoComplete}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between" }}
      >
        <span>{cur?.label ?? "—"}</span>
        <span className="muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div
          className="panel"
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, padding: 4 }}
        >
          {options.map((o) => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={{
                padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                background: o.value === value ? "var(--panel-2)" : "transparent",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = o.value === value ? "var(--panel-2)" : "transparent")}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Custom Slider ---------- */
export function Slider({
  value, min, max, step, onChange,
}: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ["--p" as string]: `${p}%` }}
    />
  );
}

/* ---------- Toast ---------- */
type Toast = { id: number; msg: string; kind: "info" | "error" };
const ToastCtx = createContext<(msg: string, kind?: "info" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), []);
  const push = useCallback((msg: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, kind }]);
    // Fehler bleiben stehen, bis sie weggeklickt werden; Infos verschwinden selbst.
    if (kind !== "error") setTimeout(() => remove(id), 4000);
  }, [remove]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div style={{ position: "fixed", right: 16, bottom: 16, display: "grid", gap: 8, zIndex: 2000 }}>
        {items.map((t) => (
          <div
            key={t.id}
            className="panel"
            style={{
              borderColor: t.kind === "error" ? "var(--cut)" : "var(--border)",
              minWidth: 240, maxWidth: 420, display: "flex", alignItems: "flex-start", gap: 10,
            }}
          >
            <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>
              {t.kind === "error" && <strong style={{ color: "var(--cut)", display: "block", marginBottom: 2 }}>Fehler</strong>}
              {t.msg}
            </div>
            <button
              onClick={() => remove(t.id)}
              title="Schliessen"
              aria-label="Schliessen"
              style={{ flex: "0 0 auto", padding: "0 8px", lineHeight: "20px", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--muted, #888)" }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
