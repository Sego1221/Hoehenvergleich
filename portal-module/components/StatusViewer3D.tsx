"use client";
/**
 * 3D-Viewer fuer das Baufortschritt-Modell: EIN Mesh pro Bauteil (Knotenname =
 * GUID). Faerbung anhand der Status-Karte (guid->Status); pro Status ein-/
 * ausblendbar. Korrekturen (Override) kommen ueber die Status-Karte rein und
 * faerben sofort um.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const STATUSES = [
  { key: "gebaut", label: "gebaut", color: 0x28b450 },
  { key: "nicht_gebaut", label: "nicht gebaut", color: 0x969696 },
  { key: "verdeckt", label: "verdeckt", color: 0xf0962a },
  { key: "nicht_erfasst", label: "nicht erfasst", color: 0x5a5a6e },
] as const;
const HEX: Record<string, string> = { gebaut: "#28b450", nicht_gebaut: "#969696", verdeckt: "#f0962a", nicht_erfasst: "#5a5a6e" };

export default function StatusViewer3D({
  url, statusByGuid, height = 480,
}: {
  url: string; statusByGuid: Record<string, string>; height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const meshesRef = useRef<{ guid: string; mesh: THREE.Mesh }[]>([]);
  const matsRef = useRef<Record<string, THREE.Material>>({});
  const mapRef = useRef(statusByGuid);
  const visRef = useRef<Record<string, boolean>>({ gebaut: true, nicht_gebaut: true, verdeckt: true, nicht_erfasst: true });
  const [status, setStatus] = useState("Lade Modell …");
  const [vis, setVis] = useState<Record<string, boolean>>(visRef.current);
  mapRef.current = statusByGuid;

  const present = useMemo(() => {
    const set = new Set(Object.values(statusByGuid));
    return STATUSES.filter((s) => set.has(s.key));
  }, [statusByGuid]);

  function applyColorsVis() {
    for (const { guid, mesh } of meshesRef.current) {
      const st = mapRef.current[guid] ?? "nicht_erfasst";
      mesh.material = matsRef.current[st] ?? matsRef.current.nicht_erfasst;
      mesh.visible = visRef.current[st] !== false;
    }
  }

  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0; let cancelled = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef2f6);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d0d8, 1.1));
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(1, 1, 2); scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4); dir2.position.set(-1, -1, 1); scene.add(dir2);
    for (const s of STATUSES) matsRef.current[s.key] = new THREE.MeshStandardMaterial({ color: s.color, metalness: 0, roughness: 0.9, side: THREE.DoubleSide });
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100000); cam.up.set(0, 0, 1);
    const controls = new OrbitControls(cam, renderer.domElement); controls.enableDamping = true;
    const resize = () => { const w = el.clientWidth || 1; const h = el.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el);

    new GLTFLoader().load(url, (gltf) => {
      if (cancelled) return;
      const root = gltf.scene; scene.add(root);
      const list: { guid: string; mesh: THREE.Mesh }[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if ((m as THREE.Mesh).isMesh) list.push({ guid: o.name || (o.parent?.name ?? ""), mesh: m });
      });
      meshesRef.current = list; applyColorsVis();
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3()); const r = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 1);
      controls.target.copy(c);
      cam.position.set(c.x - r * 1.4, c.y - r * 1.4, c.z + r * 1.2);
      cam.near = r / 1000; cam.far = r * 100; cam.updateProjectionMatrix(); controls.update();
      resize(); setStatus("");
    }, undefined, () => { if (!cancelled) setStatus("Modell konnte nicht geladen werden."); });

    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, cam); };
    raf = requestAnimationFrame(animate);
    return () => { cancelled = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement); };
  }, [url]);

  // Override/Statusaenderung -> sofort umfaerben.
  useEffect(() => { applyColorsVis(); }, [statusByGuid]); // eslint-disable-line

  function toggle(key: string) {
    setVis((v) => {
      const next = { ...v, [key]: !v[key] };
      visRef.current = next; applyColorsVis();
      return next;
    });
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", position: "relative", height }}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 5, display: "grid", gap: 4 }}>
        {present.map((s) => (
          <button key={s.key} onClick={() => toggle(s.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", fontSize: 12,
              background: vis[s.key] ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.45)",
              border: "1px solid var(--border)", borderRadius: 6, opacity: vis[s.key] ? 1 : 0.6,
            }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: HEX[s.key], display: "inline-block" }} />
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
