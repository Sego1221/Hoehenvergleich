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
  url, statusByGuid, guids, height = 480, defaultMode = "status", perimeter = null, offset = null,
}: {
  url: string; statusByGuid: Record<string, string>; guids: (string | null)[];
  height?: number; defaultMode?: "status" | "material";
  perimeter?: [number, number][][] | null; offset?: [number, number, number] | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const meshesRef = useRef<{ guid: string; mesh: THREE.Mesh; orig: THREE.Material }[]>([]);
  const matsRef = useRef<Record<string, THREE.Material>>({});
  const mapRef = useRef(statusByGuid);
  const guidsRef = useRef(guids);
  const perimRef = useRef(perimeter);
  const offsetRef = useRef(offset);
  const perimGroupRef = useRef<THREE.Group | null>(null);
  const visRef = useRef<Record<string, boolean>>({ gebaut: true, nicht_gebaut: true, verdeckt: true, nicht_erfasst: true });
  const modeRef = useRef<"status" | "material">(defaultMode);
  const showPerimRef = useRef(true);
  const [status, setStatus] = useState("Lade Modell …");
  const [vis, setVis] = useState<Record<string, boolean>>(visRef.current);
  const [mode, setMode] = useState<"status" | "material">(defaultMode);
  const [showPerim, setShowPerim] = useState(true);
  mapRef.current = statusByGuid;
  guidsRef.current = guids;
  perimRef.current = perimeter;
  offsetRef.current = offset;
  const hasPerim = !!(perimeter && perimeter.length && offset);

  const present = useMemo(() => {
    const set = new Set(Object.values(statusByGuid));
    return STATUSES.filter((s) => set.has(s.key));
  }, [statusByGuid]);

  function applyColorsVis() {
    const m = modeRef.current;
    for (const { guid, mesh, orig } of meshesRef.current) {
      const st = mapRef.current[guid] ?? "nicht_erfasst";
      mesh.material = m === "material"
        ? orig
        : (matsRef.current[st] ?? matsRef.current.nicht_erfasst);
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
    // Original-(IFC-)Material: vertexColors aus GLB nutzen, doppelseitig.
    const origMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.9, side: THREE.DoubleSide });
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100000); cam.up.set(0, 0, 1);
    const controls = new OrbitControls(cam, renderer.domElement); controls.enableDamping = true;
    const resize = () => { const w = el.clientWidth || 1; const h = el.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el);

    new GLTFLoader().load(url, (gltf) => {
      if (cancelled) return;
      const root = gltf.scene; scene.add(root);
      // Meshes in Reihenfolge sammeln. Bauteil-GUID kommt primaer aus dem
      // Knotennamen ('bf_' + hex(guid), Sonderzeichen-sicher), Fallback = Index
      // in der Element-Reihenfolge.
      type MN = { mesh: THREE.Mesh; nodeName: string };
      const mns: MN[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // Das trimesh-GLB wird ohne Normalen exportiert -> MeshStandardMaterial
        // rendert ohne Normalen schwarz. Daher hier bei Bedarf nachberechnen.
        if (m.geometry && !m.geometry.getAttribute("normal")) m.geometry.computeVertexNormals();
        let nm = o.name || "";
        let p: THREE.Object3D | null = o;
        while (p && !nm.startsWith("bf_")) { p = p.parent; nm = p?.name ?? ""; }
        mns.push({ mesh: m, nodeName: nm });
      });
      const gs = guidsRef.current;
      const decode = (s: string) => {
        if (!s.startsWith("bf_")) return "";
        try {
          const hex = s.slice(3);
          const bytes = new Uint8Array(hex.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
          return new TextDecoder().decode(bytes);
        } catch { return ""; }
      };
      const list = mns.map(({ mesh, nodeName }, i) => ({
        guid: (decode(nodeName) || gs[i] || "") as string, mesh, orig: origMat,
      }));
      meshesRef.current = list; applyColorsVis();
      const box = new THREE.Box3().setFromObject(root);

      // Bauperimeter (LV95-Polygone) zur Kontrolle einblenden. Das GLB ist um
      // 'offset' (LV95-Minimum) nach lokal verschoben; der Perimeter muss gleich
      // verschoben werden. Z = Modell-Unterkante.
      const off = offsetRef.current; const perim = perimRef.current;
      if (off && perim?.length) {
        const grp = new THREE.Group();
        const z = box.min.z;
        const mat = new THREE.LineBasicMaterial({ color: 0xe000a0 });
        for (const ring of perim) {
          if (!ring?.length) continue;
          const pts = ring.map(([E, N]) => new THREE.Vector3(E - off[0], N - off[1], z));
          grp.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
        grp.visible = showPerimRef.current;
        scene.add(grp); perimGroupRef.current = grp;
        box.expandByObject(grp);
      }

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
      {/* Modus-Umschalter (oben rechts) */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 5, display: "flex", gap: 4,
        background: "rgba(255,255,255,0.92)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
        <button onClick={() => { modeRef.current = "status"; setMode("status"); applyColorsVis(); }}
          className={mode === "status" ? "primary" : ""} style={{ padding: "3px 10px" }}>Status</button>
        <button onClick={() => { modeRef.current = "material"; setMode("material"); applyColorsVis(); }}
          className={mode === "material" ? "primary" : ""} style={{ padding: "3px 10px" }}>Material</button>
        {hasPerim && (
          <button onClick={() => { const n = !showPerimRef.current; showPerimRef.current = n; setShowPerim(n); if (perimGroupRef.current) perimGroupRef.current.visible = n; }}
            className={showPerim ? "primary" : ""} style={{ padding: "3px 10px" }} title="Bauperimeter zur Kontrolle ein-/ausblenden">Perimeter</button>
        )}
      </div>
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
