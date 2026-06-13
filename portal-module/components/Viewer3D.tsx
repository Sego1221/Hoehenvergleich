"use client";
/**
 * 3D-Viewer für einen Höhenvergleich — PLAIN THREE.JS (kein Potree).
 *
 * - lädt scene.json (Offset, bbox, deviation, binUrl, meshUrl),
 * - lädt cloud.bin (uint32 count, M*3 float32 Positionen RELATIV zum offset,
 *   M*3 uint8 RGB bereits nach ΔZ eingefärbt) als THREE.Points,
 * - lädt das Soll-GLB halbtransparent (bereits um denselben offset verschoben),
 * - Grundriss-Umschalter (Perspektive <-> orthografische Top-Ansicht),
 * - Schnitt-Werkzeug: zwei Klicks -> Linie nach LV95 zurückrechnen
 *   (lokal + offset) -> POST /profile -> ProfileChart unter dem Viewer,
 * - mehrere Schnitte nacheinander, Schnittlinie auch im 3D als THREE.Line.
 *
 * LV95-Präzision ist serverseitig durch den Offset gelöst (Wolke + Mesh bereits
 * verschoben) -> hier NICHT nochmal verschieben. Welt-Koordinaten im Viewer sind
 * LOKAL (relativ zum offset); für LV95 gilt: E = x + offset[0], N = y + offset[1].
 *
 * Nur clientseitig einsetzen (dynamic ssr:false).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useToast, Slider } from "@/components/ui";
import { ProfileChart } from "@/components/ProfileChart";
import { BP } from "@/lib/api";
import type { Profile, Scene } from "@/lib/computeClient";

type ViewMode = "3d" | "plan";
type ColorMode = "dz" | "rgb";

// RdYlBu_r-Stützfarben (blau = unter Soll … rot = über Soll).
const RAMP: ReadonlyArray<[number, number, number]> = [
  [69, 117, 180], [145, 191, 219], [224, 243, 248],
  [254, 224, 144], [252, 141, 89], [215, 48, 39],
];
function rampColor(t: number): [number, number, number] {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = t * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[Math.min(i + 1, RAMP.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
/** Farb-Buffer (uint8 0..255) für die Wolke berechnen: ΔZ-Rampe oder Echtfarbe. */
function computeCloudColors(
  count: number, dev: Float32Array | null, rgb: Uint8Array | null,
  mode: ColorMode, range: number, out?: Uint8Array,
): Uint8Array {
  const col = out ?? new Uint8Array(count * 3);
  if (mode === "rgb" || !dev) {
    if (rgb) col.set(rgb.subarray(0, count * 3));
    else col.fill(180);
    return col;
  }
  const inv = 1 / (2 * (range || 0.0001));
  for (let i = 0; i < count; i++) {
    const d = dev[i];
    if (!Number.isFinite(d)) { col[i * 3] = 150; col[i * 3 + 1] = 150; col[i * 3 + 2] = 150; continue; }
    const c = rampColor((d + range) * inv);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  return col;
}

export function Viewer3D({ comparisonId, tol = 0.05 }: { comparisonId: string; tol?: number }) {
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  // Three-Kernobjekte (in Refs, damit React-Renders sie nicht neu erzeugen).
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const perspRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const meshRef = useRef<THREE.Object3D | null>(null);
  const rafRef = useRef<number>(0);
  const sceneJsonRef = useRef<Scene | null>(null);
  const cutLinesRef = useRef<THREE.Object3D[]>([]);
  const cutPickRef = useRef<THREE.Vector3[]>([]); // gesammelte Klickpunkte (lokal)

  // bbox-Mittelpunkt (lokal) + Radius für Kamera/Top-Ansicht.
  const centerRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const radiusRef = useRef<number>(100);
  const planZRef = useRef<number>(100); // Schnitt-Pickebene (z = bbox-Mitte) im Plan

  const [status, setStatus] = useState<string>("Lade Viewer …");
  const [ready, setReady] = useState(false);
  const [meshVisible, setMeshVisible] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [cutMode, setCutMode] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [pointSize, setPointSize] = useState(0.5);
  const pointSizeRef = useRef(0.5);
  const [colorMode, setColorMode] = useState<ColorMode>("dz");
  const [dzRange, setDzRange] = useState(0.3);
  const devRef = useRef<Float32Array | null>(null);  // ΔZ pro Punkt (v2)
  const rgbRef = useRef<Uint8Array | null>(null);     // Echtfarbe pro Punkt
  const cloudCountRef = useRef(0);
  const colorArrRef = useRef<Uint8Array | null>(null);
  const viewModeRef = useRef<ViewMode>("3d");
  const cutModeRef = useRef(false);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { cutModeRef.current = cutMode; }, [cutMode]);

  const activeCamera = useCallback(
    () => (viewModeRef.current === "plan" ? orthoRef.current! : perspRef.current!),
    [],
  );

  // ---------------------------------------------------------------- Init -----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1115);
    sceneRef.current = scene;

    // Licht für das (Standard-)Material des Soll-Mesh.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404050, 1.0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 1, 2);
    scene.add(dir);

    const persp = new THREE.PerspectiveCamera(60, 1, 0.1, 100000);
    persp.up.set(0, 0, 1); // Z = oben (LV95-Höhe)
    perspRef.current = persp;
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    ortho.up.set(0, 1, 0); // Plan: Norden (N=+y) zeigt nach oben am Bildschirm
    orthoRef.current = ortho;

    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      // Ortho-Frustum an Aspekt + Radius anpassen.
      const r = radiusRef.current * 1.1;
      const aspect = w / h;
      ortho.left = -r * aspect; ortho.right = r * aspect;
      ortho.top = r; ortho.bottom = -r;
      ortho.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      controls.update();
      const cam = viewModeRef.current === "plan" ? ortho : persp;
      renderer.render(scene, cam);
    };
    rafRef.current = requestAnimationFrame(animate);

    // Klick-Handler für das Schnitt-Werkzeug.
    const onClick = (ev: MouseEvent) => {
      if (!cutModeRef.current) return;
      const p = pickPoint(ev);
      if (!p) return;
      cutPickRef.current.push(p);
      addCutMarker(p);
      if (cutPickRef.current.length === 2) {
        const [a, b] = cutPickRef.current;
        cutPickRef.current = [];
        void runProfile(a, b);
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    // scene.json + cloud.bin + GLB laden.
    (async () => {
      try {
        const r = await fetch(`${BP}/api/comparisons/${comparisonId}/scene`, { cache: "no-store" });
        if (r.status === 404) {
          if (!cancelled) setStatus("Für diesen Vergleich liegt noch keine 3D-Datengrundlage vor.");
          return;
        }
        if (!r.ok) throw new Error(`scene.json: ${r.status} ${await r.text().catch(() => "")}`);
        const sj = (await r.json()) as Scene;
        if (cancelled) return;
        sceneJsonRef.current = sj;

        // bbox lokal (relativ zum offset) -> Kamera einpassen.
        const off = sj.offset;
        const minL = new THREE.Vector3(
          sj.bbox.min[0] - off[0], sj.bbox.min[1] - off[1], sj.bbox.min[2] - off[2],
        );
        const maxL = new THREE.Vector3(
          sj.bbox.max[0] - off[0], sj.bbox.max[1] - off[1], sj.bbox.max[2] - off[2],
        );
        const center = minL.clone().add(maxL).multiplyScalar(0.5);
        const radius = Math.max(minL.distanceTo(maxL) * 0.5, 1);
        centerRef.current.copy(center);
        radiusRef.current = radius;
        planZRef.current = center.z;
        resize();
        placeCameras();

        if ((sj.binCount ?? 0) <= 0) {
          if (!cancelled) setStatus("Diese 3D-Datengrundlage enthält keine Punkte (binCount 0).");
          // Mesh trotzdem versuchen.
        } else {
          await loadCloud(sj.binUrl);
        }
        if (cancelled) return;

        await loadMesh(sj.meshUrl);
        if (cancelled) return;

        setReady(true);
        setStatus("");
      } catch (e) {
        if (!cancelled) {
          setStatus(`Fehler: ${(e as Error).message}`);
          toast((e as Error).message, "error");
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      disposePoints();
      disposeMesh();
      clearCutLines();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
    };
    // Einmaliger Init pro comparisonId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonId]);

  // ----------------------------------------------------- Punktwolke laden ----
  async function loadCloud(binUrl: string) {
    const resp = await fetch(binUrl, { cache: "no-store" });
    if (!resp.ok) throw new Error(`cloud.bin: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const dv = new DataView(buf);
    const count = dv.getUint32(0, true); // little-endian
    const fmt = sceneJsonRef.current?.cloudFormat;

    let positions: Float32Array;
    let dev: Float32Array | null = null;
    let rgb: Uint8Array | null = null;
    if (fmt === "v2") {
      // count, pos(f32*3), dev(f32), rgb(u8*3) — Floats 4-aligned.
      const oPos = 4;
      const oDev = oPos + count * 12;
      const oRgb = oDev + count * 4;
      positions = new Float32Array(buf, oPos, count * 3);
      dev = new Float32Array(buf, oDev, count);
      rgb = new Uint8Array(buf, oRgb, count * 3);
    } else {
      // Legacy v1: count, pos(f32*3), rgb(u8*3, gebackene ΔZ-Farbe). Kein dev.
      positions = new Float32Array(buf, 4, count * 3);
      rgb = new Uint8Array(buf, 4 + count * 12, count * 3);
    }
    devRef.current = dev;
    rgbRef.current = rgb;
    cloudCountRef.current = count;

    // Anfangsfarbe: bei v2 nach ΔZ, sonst die (gebackene) Echtfarbe.
    const initialMode: ColorMode = dev ? "dz" : "rgb";
    const colArr = computeCloudColors(count, dev, rgb, initialMode, dzRange);
    colorArrRef.current = colArr;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colArr, 3, true)); // normalized
    geom.computeBoundingSphere();

    const mat = new THREE.PointsMaterial({
      size: pointSizeRef.current,
      sizeAttenuation: true,
      vertexColors: true,
    });
    const points = new THREE.Points(geom, mat);
    pointsRef.current = points;
    sceneRef.current?.add(points);
    if (!dev) setColorMode("rgb"); // Legacy: kein ΔZ-Modus möglich
  }

  // Wolke clientseitig neu einfärben (ΔZ-Skala oder Echtfarbe), ohne Neuladen.
  function applyCloudColors(mode: ColorMode, range: number) {
    const pts = pointsRef.current;
    const arr = colorArrRef.current;
    if (!pts || !arr) return;
    computeCloudColors(cloudCountRef.current, devRef.current, rgbRef.current, mode, range, arr);
    (pts.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  // ---------------------------------------------------------- Mesh laden -----
  async function loadMesh(meshUrl: string) {
    const loader = new GLTFLoader();
    await new Promise<void>((resolve) => {
      loader.load(
        meshUrl,
        (gltf) => {
          const root = gltf.scene || gltf.scenes?.[0];
          if (!root) { resolve(); return; }
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if ((m as THREE.Mesh).isMesh) {
              m.material = new THREE.MeshStandardMaterial({
                color: 0x3a7bd5,
                transparent: true,
                opacity: 0.45,
                depthWrite: false,
                side: THREE.DoubleSide,
                metalness: 0.0,
                roughness: 0.9,
              });
            }
          });
          meshRef.current = root;
          sceneRef.current?.add(root);
          resolve();
        },
        undefined,
        () => resolve(), // Mesh optional -> Fehler still
      );
    });
  }

  // -------------------------------------------------- Kameras positionieren --
  function placeCameras() {
    const c = centerRef.current;
    const r = radiusRef.current;
    const persp = perspRef.current!;
    const ortho = orthoRef.current!;
    const controls = controlsRef.current!;

    // Perspektive: schräg von Südwesten oben.
    persp.position.set(c.x - r * 1.4, c.y - r * 1.4, c.z + r * 1.4);
    persp.near = Math.max(r / 1000, 0.1);
    persp.far = r * 100;
    persp.updateProjectionMatrix();

    // Ortho: senkrecht von oben (Plan), N=+y oben.
    ortho.position.set(c.x, c.y, c.z + r * 4);
    ortho.up.set(0, 1, 0);

    controls.target.copy(c);
    persp.lookAt(c);
    ortho.lookAt(c);
    controls.update();
  }

  // ----------------------------------------------- Ansicht umschalten --------
  useEffect(() => {
    const controls = controlsRef.current;
    const c = centerRef.current;
    const r = radiusRef.current;
    if (!controls) return;
    if (viewMode === "plan") {
      const ortho = orthoRef.current!;
      controls.object = ortho;
      controls.enableRotate = false; // reine Draufsicht
      ortho.position.set(c.x, c.y, c.z + r * 4);
      ortho.up.set(0, 1, 0);
      ortho.lookAt(c);
    } else {
      const persp = perspRef.current!;
      controls.object = persp;
      controls.enableRotate = true;
    }
    controls.target.copy(c);
    controls.update();
  }, [viewMode]);

  // ---------------------------------------------- Mesh ein/aus ---------------
  useEffect(() => {
    if (meshRef.current) meshRef.current.visible = meshVisible;
  }, [meshVisible]);

  // ---------------------------------------------- Punktgrösse (live) ---------
  useEffect(() => {
    pointSizeRef.current = pointSize;
    const m = pointsRef.current?.material as THREE.PointsMaterial | undefined;
    if (m) { m.size = pointSize; m.needsUpdate = true; }
  }, [pointSize]);

  // ------------------------------------------- Einfärbung (live) -------------
  useEffect(() => {
    applyCloudColors(colorMode, dzRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, dzRange, ready]);

  // ------------------------------------------------ Schnitt: Punkt picken ----
  // Raycast gegen Punkte/Mesh; Fallback auf horizontale Ebene z = bbox-Mitte.
  function pickPoint(ev: MouseEvent): THREE.Vector3 | null {
    const renderer = rendererRef.current;
    if (!renderer) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: radiusRef.current * 0.01 };
    ray.setFromCamera(ndc, activeCamera());

    const targets: THREE.Object3D[] = [];
    if (meshRef.current && meshRef.current.visible) targets.push(meshRef.current);
    if (pointsRef.current) targets.push(pointsRef.current);
    if (targets.length) {
      const hits = ray.intersectObjects(targets, true);
      if (hits.length) return hits[0].point.clone();
    }
    // Fallback: horizontale Ebene auf bbox-Mittelhöhe.
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planZRef.current);
    const out = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, out)) return out.clone();
    return null;
  }

  function addCutMarker(p: THREE.Vector3) {
    const scene = sceneRef.current;
    if (!scene) return;
    const g = new THREE.SphereGeometry(radiusRef.current * 0.01, 12, 12);
    const m = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const s = new THREE.Mesh(g, m);
    s.position.copy(p);
    scene.add(s);
    cutLinesRef.current.push(s);
  }

  function addCutLine(a: THREE.Vector3, b: THREE.Vector3) {
    const scene = sceneRef.current;
    if (!scene) return;
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const m = new THREE.LineBasicMaterial({ color: 0xffcc00 });
    const line = new THREE.Line(g, m);
    scene.add(line);
    cutLinesRef.current.push(line);
  }

  function clearCutLines() {
    const scene = sceneRef.current;
    cutLinesRef.current.forEach((o) => {
      scene?.remove(o);
      const any = o as THREE.Mesh | THREE.Line;
      (any.geometry as THREE.BufferGeometry)?.dispose?.();
      const mat = (any as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else (mat as THREE.Material)?.dispose?.();
    });
    cutLinesRef.current = [];
  }

  // ------------------------------------------------ Profil rechnen -----------
  // Welt (lokal) -> LV95: E = x + offset[0], N = y + offset[1].
  async function runProfile(a: THREE.Vector3, b: THREE.Vector3) {
    const sj = sceneJsonRef.current;
    if (!sj) return;
    addCutLine(a, b);
    const off = sj.offset;
    const line: [number, number][] = [
      [a.x + off[0], a.y + off[1]],
      [b.x + off[0], b.y + off[1]],
    ];
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/comparisons/${comparisonId}/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ line }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setProfile(data.profile as Profile);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------- Dispose --------
  function disposePoints() {
    const p = pointsRef.current;
    if (!p) return;
    sceneRef.current?.remove(p);
    p.geometry.dispose();
    (p.material as THREE.Material).dispose();
    pointsRef.current = null;
  }
  function disposeMesh() {
    const m = meshRef.current;
    if (!m) return;
    sceneRef.current?.remove(m);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else (mat as THREE.Material)?.dispose?.();
      }
    });
    meshRef.current = null;
  }

  function toggleCut() {
    setCutMode((v) => {
      const next = !v;
      if (next) {
        cutPickRef.current = [];
        toast("Schnitt: zwei Punkte in die Szene klicken.");
      }
      return next;
    });
  }

  function clearCuts() {
    clearCutLines();
    cutPickRef.current = [];
    setProfile(null);
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 300px", alignItems: "start" }}>
        {/* Viewer-Bühne */}
        <div
          className="panel"
          style={{ position: "relative", padding: 0, overflow: "hidden", height: "70vh", minHeight: 460 }}
        >
          <div
            ref={containerRef}
            style={{ position: "absolute", inset: 0, cursor: cutMode ? "crosshair" : "grab" }}
          />
          {/* Legende ΔZ-Einfärbung (nur im Abweichungs-Modus) */}
          {colorMode === "dz" && (
            <div
              style={{
                position: "absolute", left: 12, bottom: 12, zIndex: 4,
                background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 8,
                padding: "8px 10px", fontSize: 11, lineHeight: 1.4, maxWidth: 260,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Abweichung ΔZ ±{dzRange.toFixed(2)} m</div>
              <div
                style={{
                  height: 8, borderRadius: 4, marginBottom: 4,
                  background: "linear-gradient(90deg,#4575b4,#91bfdb,#e0f3f8,#fee090,#fc8d59,#d73027)",
                }}
              />
              <div className="spread" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>−{dzRange.toFixed(2)} (zu tief)</span><span>0</span><span>+{dzRange.toFixed(2)} (zu hoch)</span>
              </div>
            </div>
          )}
          {status && (
            <div
              style={{
                position: "absolute", inset: 0, display: "grid", placeItems: "center",
                background: "rgba(0,0,0,0.35)", color: "#fff", textAlign: "center",
                padding: 24, zIndex: 5,
              }}
            >
              <div className="small" style={{ maxWidth: 420 }}>{status}</div>
            </div>
          )}
        </div>

        {/* Werkzeuge */}
        <div className="grid" style={{ gap: 12 }}>
          <div className="panel">
            <label className="small">Ansicht</label>
            <div className="grid cols-2" style={{ marginTop: 8 }}>
              <button className={viewMode === "3d" ? "primary" : ""} onClick={() => setViewMode("3d")}>3D</button>
              <button className={viewMode === "plan" ? "primary" : ""} onClick={() => setViewMode("plan")}>Grundriss</button>
            </div>
            <div className="grid" style={{ marginTop: 8 }}>
              <button onClick={placeCameras}>Einpassen</button>
            </div>
          </div>

          <div className="panel">
            <div className="spread">
              <label className="small">Soll-Mesh</label>
              <button className={meshVisible ? "primary" : ""} onClick={() => setMeshVisible((v) => !v)}>
                {meshVisible ? "ein" : "aus"}
              </button>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>Halbtransparent über der Ist-Wolke.</div>
          </div>

          <div className="panel">
            <label className="small">Punktgrösse: {pointSize.toFixed(2)} m</label>
            <div style={{ marginTop: 8 }}>
              <Slider value={pointSize} min={0.05} max={3} step={0.05} onChange={setPointSize} />
            </div>
          </div>

          <div className="panel">
            <label className="small">Einfärbung</label>
            <div className="grid cols-2" style={{ marginTop: 8 }}>
              <button className={colorMode === "dz" ? "primary" : ""} onClick={() => setColorMode("dz")}>Abweichung</button>
              <button className={colorMode === "rgb" ? "primary" : ""} onClick={() => setColorMode("rgb")}>Echtfarbe</button>
            </div>
            {colorMode === "dz" && (
              <div style={{ marginTop: 10 }}>
                <label className="small">Skala ±{(dzRange * 100).toFixed(0)} cm</label>
                <div style={{ marginTop: 6 }}>
                  <Slider value={dzRange} min={0.01} max={2} step={0.01} onChange={setDzRange} />
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <label className="small">Schnitt / Profil</label>
            <div className="grid cols-2" style={{ marginTop: 8 }}>
              <button className={cutMode ? "primary" : ""} onClick={toggleCut} disabled={!ready}>
                {cutMode ? "Schnitt aktiv" : "Schnitt"}
              </button>
              <button onClick={clearCuts} disabled={!ready}>Löschen</button>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Zwei Punkte klicken; das Profil erscheint unten. Mehrere Schnitte möglich.
            </div>
            {busy && <div className="small" style={{ marginTop: 6 }}>Profil …</div>}
          </div>

          <div className="panel">
            <div className="small muted">
              „Abweichung" färbt nach ΔZ (Skala oben verstellbar); „Echtfarbe" zeigt das
              Original-Foto der Wolke. Toleranz-Slider (2D-Karte): {(tol * 100).toFixed(0)} cm.
            </div>
          </div>
        </div>
      </div>

      {/* Profil-Diagramm unter dem Viewer */}
      {profile && (
        <div className="panel">
          <div className="spread" style={{ marginBottom: 8 }}>
            <strong>Schnitt-Profil ({profile.length_m.toFixed(1)} m)</strong>
            <button onClick={() => setProfile(null)}>Schliessen</button>
          </div>
          <ProfileChart profile={profile} />
        </div>
      )}
    </div>
  );
}

export default Viewer3D;
