"use client";
/**
 * 3D-Viewer fuer das Baufortschritt-Status-GLB: zeigt das GANZE Modell, je
 * Status zu einer Gruppe zusammengefasst (gruen=gebaut, grau=nicht gebaut,
 * orange=verdeckt, dunkel=nicht erfasst). Pro Status ein-/ausblendbar.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const STATUSES = [
  { key: "gebaut", label: "gebaut", color: "#28b450" },
  { key: "nicht_gebaut", label: "nicht gebaut", color: "#969696" },
  { key: "verdeckt", label: "verdeckt", color: "#f0962a" },
  { key: "nicht_erfasst", label: "nicht erfasst", color: "#5a5a6e" },
];

export default function StatusViewer3D({ url, height = 480 }: { url: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const groupsRef = useRef<Record<string, THREE.Object3D[]>>({});
  const [status, setStatus] = useState("Lade Modell …");
  const [vis, setVis] = useState<Record<string, boolean>>(
    { gebaut: true, nicht_gebaut: true, verdeckt: true, nicht_erfasst: true },
  );
  const [present, setPresent] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0; let cancelled = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0f1115);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(1, 1, 2); scene.add(dir);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100000); cam.up.set(0, 0, 1);
    const controls = new OrbitControls(cam, renderer.domElement); controls.enableDamping = true;
    const resize = () => { const w = el.clientWidth || 1; const h = el.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el);

    new GLTFLoader().load(url, (gltf) => {
      if (cancelled) return;
      const root = gltf.scene; scene.add(root);
      const groups: Record<string, THREE.Object3D[]> = {};
      const found: Record<string, boolean> = {};
      root.traverse((o) => {
        const nm = (o.name || "") + " " + ((o.parent && o.parent.name) || "");
        for (const s of STATUSES) {
          if (nm.includes(s.key)) { (groups[s.key] ||= []).push(o); found[s.key] = true; }
        }
      });
      groupsRef.current = groups; setPresent(found);
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3()); const r = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 1);
      controls.target.copy(c);
      cam.position.set(c.x - r * 1.4, c.y - r * 1.4, c.z + r * 1.2);
      cam.near = r / 1000; cam.far = r * 100; cam.updateProjectionMatrix(); controls.update();
      resize(); setStatus("");
    }, undefined, () => { if (!cancelled) setStatus("Status-Modell konnte nicht geladen werden."); });

    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, cam); };
    raf = requestAnimationFrame(animate);
    return () => { cancelled = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement); };
  }, [url]);

  function toggle(key: string) {
    setVis((v) => {
      const next = { ...v, [key]: !v[key] };
      for (const o of groupsRef.current[key] ?? []) o.visible = next[key];
      return next;
    });
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", position: "relative", height }}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      {/* Status-Umschalter (oben links) */}
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 5, display: "grid", gap: 4 }}>
        {STATUSES.filter((s) => present[s.key]).map((s) => (
          <button key={s.key} onClick={() => toggle(s.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", fontSize: 12,
              background: vis[s.key] ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.45)",
              border: "1px solid var(--border)", borderRadius: 6, opacity: vis[s.key] ? 1 : 0.6,
            }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: "inline-block" }} />
            {s.label}{vis[s.key] ? "" : " (aus)"}
          </button>
        ))}
      </div>
      {status && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", background: "rgba(0,0,0,.35)" }}>
          <div className="small">{status}</div>
        </div>
      )}
    </div>
  );
}
