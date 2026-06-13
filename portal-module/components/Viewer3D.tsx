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
import type { DxfPolyline, Profile, Scene } from "@/lib/computeClient";

type ViewMode = "3d" | "plan";
type ColorMode = "dz" | "rgb";
type PerimeterMode = "off" | "draw" | "parcel";
type CloudFilter = "all" | "inside" | "outside";
type Parcel = { egrid: string | null; number: string | null; ak: string | null };

// Punkt-in-Polygon (Ray-Casting) gegen eine Liste von Polygonen (flach gespeichert).
// "innen" = in irgendeinem Polygon. polys: Array von Float64Array [x0,y0,x1,y1,...].
function pointInPolys(x: number, y: number, polys: Float64Array[], bboxes: Float64Array): boolean {
  for (let p = 0; p < polys.length; p++) {
    const bx = p * 4;
    if (x < bboxes[bx] || x > bboxes[bx + 2] || y < bboxes[bx + 1] || y > bboxes[bx + 3]) continue;
    const poly = polys[p];
    let inside = false;
    const n = poly.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i * 2], yi = poly[i * 2 + 1];
      const xj = poly[j * 2], yj = poly[j * 2 + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

type RGB = [number, number, number];
type Stops = ReadonlyArray<RGB>;

// Vordefinierte Farbskalen (blau/grün = unter Soll … rot = über Soll).
const PRESETS: ReadonlyArray<{ id: string; label: string; stops: Stops }> = [
  { id: "rdylbu", label: "Blau-Gelb-Rot", stops: [
    [69, 117, 180], [145, 191, 219], [224, 243, 248], [254, 224, 144], [252, 141, 89], [215, 48, 39]] },
  { id: "rwb", label: "Blau-Weiss-Rot", stops: [[33, 102, 172], [247, 247, 247], [178, 24, 43]] },
  { id: "gwr", label: "Grün-Weiss-Rot", stops: [[26, 150, 65], [255, 255, 255], [215, 25, 28]] },
  { id: "turbo", label: "Regenbogen", stops: [
    [48, 18, 59], [33, 144, 255], [27, 229, 138], [223, 227, 38], [251, 134, 39], [122, 4, 3]] },
];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]: RGB): string {
  const c = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function rampColor(stops: Stops, t: number): RGB {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = t * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
function gradientCss(stops: Stops): string {
  return "linear-gradient(90deg," + stops.map((s) => `rgb(${s[0]|0},${s[1]|0},${s[2]|0})`).join(",") + ")";
}
/** Farb-Buffer (uint8 0..255) für die Wolke berechnen: ΔZ-Rampe oder Echtfarbe.
 *  lo = Untergrenze (zu tief, i. d. R. negativ), hi = Obergrenze (zu hoch). Die
 *  Skala wird linear von lo..hi auf die Farbrampe abgebildet (asymmetrisch). */
function computeCloudColors(
  count: number, dev: Float32Array | null, rgb: Uint8Array | null,
  mode: ColorMode, lo: number, hi: number, stops: Stops, out?: Uint8Array,
): Uint8Array {
  const col = out ?? new Uint8Array(count * 3);
  if (mode === "rgb" || !dev) {
    if (rgb) col.set(rgb.subarray(0, count * 3));
    else col.fill(180);
    return col;
  }
  const span = (hi - lo) || 0.0001;
  const inv = 1 / span;
  for (let i = 0; i < count; i++) {
    const d = dev[i];
    if (!Number.isFinite(d)) { col[i * 3] = 150; col[i * 3 + 1] = 150; col[i * 3 + 2] = 150; continue; }
    const c = rampColor(stops, (d - lo) * inv);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  return col;
}

export function Viewer3D({
  comparisonId, projectId, tol = 0.05, initialPerimeter = null, initialParcels = null,
}: {
  comparisonId: string; projectId: string; tol?: number;
  initialPerimeter?: [number, number][][] | null;
  initialParcels?: Parcel[] | null;
}) {
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
  const [density, setDensity] = useState(1);   // Anzeigedichte 0..1 (clientseitig)
  const densityRef = useRef(1);
  const [colorMode, setColorMode] = useState<ColorMode>("dz");
  const [dzMin, setDzMin] = useState(-0.3); // Untergrenze (zu tief)
  const [dzMax, setDzMax] = useState(0.3);  // Obergrenze (zu hoch)
  const [stops, setStops] = useState<Stops>(PRESETS[0].stops);
  const stopsRef = useRef<Stops>(PRESETS[0].stops);
  const [toolsOpen, setToolsOpen] = useState(true);   // Werkzeug-Spalte ein/aus
  const [fsActive, setFsActive] = useState(false);    // Vollbild
  const stageRef = useRef<HTMLDivElement>(null);

  // Bauperimeter (LV95-Polygone) + amtliche Parzellen-Metadaten.
  const [perimeter, setPerimeter] = useState<[number, number][][]>(initialPerimeter ?? []);
  const [parcels, setParcels] = useState<Parcel[]>(
    initialParcels ?? (initialPerimeter ?? []).map(() => ({ egrid: null, number: null, ak: null })),
  );
  const [perimeterMode, setPerimeterMode] = useState<PerimeterMode>("off");
  const [cloudFilter, setCloudFilter] = useState<CloudFilter>("all");
  const [perimeterDirty, setPerimeterDirty] = useState(false);
  const [savingPerimeter, setSavingPerimeter] = useState(false);
  const [drawCount, setDrawCount] = useState(0);     // Punkte im laufenden Zeichnen
  const perimeterRef = useRef<[number, number][][]>(initialPerimeter ?? []);
  const perimeterModeRef = useRef<PerimeterMode>("off");
  const cloudFilterRef = useRef<CloudFilter>("all");
  const perimObjRef = useRef<THREE.Group | null>(null);    // gerenderte Perimeter-Linien
  const drawTmpRef = useRef<THREE.Object3D[]>([]);          // Marker/Vorschau beim Zeichnen
  const drawPtsRef = useRef<THREE.Vector3[]>([]);           // laufende Zeichen-Punkte (lokal)

  // DXF-Import (Aushubgrenze/Bereiche) + in dieser Sitzung importierte Bereiche.
  const [dxfList, setDxfList] = useState<DxfPolyline[] | null>(null);
  const [dxfBusy, setDxfBusy] = useState(false);
  const [importedRegions, setImportedRegions] = useState<{ name: string; polygon: [number, number][] }[]>([]);
  const regionsObjRef = useRef<THREE.Group | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const devRef = useRef<Float32Array | null>(null);  // ΔZ pro Punkt (v2)
  const rgbRef = useRef<Uint8Array | null>(null);     // Echtfarbe pro Punkt
  const posRef = useRef<Float32Array | null>(null);   // Positionen (lokal) für Clipping
  const cloudCountRef = useRef(0);
  const colorArrRef = useRef<Uint8Array | null>(null);
  const viewModeRef = useRef<ViewMode>("3d");
  const cutModeRef = useRef(false);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { cutModeRef.current = cutMode; }, [cutMode]);
  useEffect(() => { perimeterModeRef.current = perimeterMode; }, [perimeterMode]);
  useEffect(() => { cloudFilterRef.current = cloudFilter; }, [cloudFilter]);

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

    // Klick-Handler: Schnitt-Werkzeug ODER Perimeter (Parzelle/Zeichnen).
    const onClick = (ev: MouseEvent) => {
      // Perimeter hat Vorrang, wenn aktiv.
      if (perimeterModeRef.current === "parcel") {
        const p = pickPoint(ev);
        if (p) void fetchParcelAt(p);
        return;
      }
      if (perimeterModeRef.current === "draw") {
        const p = pickPoint(ev);
        if (p) addDrawPoint(p);
        return;
      }
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
    // Doppelklick schliesst das manuell gezeichnete Perimeter-Polygon.
    const onDblClick = (ev: MouseEvent) => {
      if (perimeterModeRef.current !== "draw") return;
      ev.preventDefault();
      closeDrawPolygon();
    };
    renderer.domElement.addEventListener("dblclick", onDblClick);

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
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      controls.dispose();
      disposePoints();
      disposeMesh();
      clearCutLines();
      clearDrawTmp();
      disposePerimeterObj();
      if (regionsObjRef.current) {
        regionsObjRef.current.traverse((o) => (o as THREE.Line).geometry?.dispose?.());
        regionsObjRef.current = null;
      }
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
    posRef.current = positions;
    cloudCountRef.current = count;

    // Anfangsfarbe: bei v2 nach ΔZ, sonst die (gebackene) Echtfarbe.
    const initialMode: ColorMode = dev ? "dz" : "rgb";
    const colArr = computeCloudColors(count, dev, rgb, initialMode, dzMin, dzMax, stopsRef.current);
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

  // Wolke clientseitig neu einfärben (ΔZ-Skala/Farben oder Echtfarbe), ohne Neuladen.
  function applyCloudColors(mode: ColorMode, lo: number, hi: number, st: Stops) {
    const pts = pointsRef.current;
    const arr = colorArrRef.current;
    if (!pts || !arr) return;
    computeCloudColors(cloudCountRef.current, devRef.current, rgbRef.current, mode, lo, hi, st, arr);
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
    stopsRef.current = stops;
    applyCloudColors(colorMode, dzMin, dzMax, stops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, dzMin, dzMax, stops, ready]);

  // ------------------------------------------- Vollbild ----------------------
  useEffect(() => {
    const onFs = () => setFsActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

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

  // ============================================ Bauperimeter =================
  // Welt(lokal) <-> LV95: E = x + off[0], N = y + off[1].
  function offset(): [number, number, number] | null {
    return sceneJsonRef.current?.offset ?? null;
  }

  // Perimeter (LV95) als geschlossene Linien rendern (auf bbox-Mittelhöhe).
  function renderPerimeter() {
    disposePerimeterObj();
    const scene = sceneRef.current;
    const off = offset();
    if (!scene || !off || perimeterRef.current.length === 0) return;
    const group = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0xff8c1a });
    const z = planZRef.current;
    for (const poly of perimeterRef.current) {
      const pts = poly.map(([E, N]) => new THREE.Vector3(E - off[0], N - off[1], z));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.LineLoop(g, mat));
    }
    perimObjRef.current = group;
    scene.add(group);
  }

  function disposePerimeterObj() {
    const scene = sceneRef.current;
    const g = perimObjRef.current;
    if (!g) return;
    scene?.remove(g);
    g.traverse((o) => {
      const l = o as THREE.Line;
      (l.geometry as THREE.BufferGeometry)?.dispose?.();
    });
    perimObjRef.current = null;
  }

  // Lokale Polygone + bboxes für die Punkt-in-Polygon-Prüfung aufbauen.
  function buildLocalPolys(): { polys: Float64Array[]; bboxes: Float64Array } | null {
    const off = offset();
    if (!off || perimeterRef.current.length === 0) return null;
    const polys: Float64Array[] = [];
    const bboxes = new Float64Array(perimeterRef.current.length * 4);
    perimeterRef.current.forEach((poly, p) => {
      const flat = new Float64Array(poly.length * 2);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      poly.forEach(([E, N], i) => {
        const x = E - off[0], y = N - off[1];
        flat[i * 2] = x; flat[i * 2 + 1] = y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      });
      polys.push(flat);
      bboxes[p * 4] = minx; bboxes[p * 4 + 1] = miny; bboxes[p * 4 + 2] = maxx; bboxes[p * 4 + 3] = maxy;
    });
    return { polys, bboxes };
  }

  // Sichtbare Punkte bestimmen: Anzeigedichte (Stride) UND Perimeter-Aufteilung
  // (alle / nur innen / nur aussen) in EINEM Index-Buffer kombiniert.
  function applyCloudFilter() {
    const pts = pointsRef.current;
    const pos = posRef.current;
    if (!pts || !pos) return;
    const geom = pts.geometry as THREE.BufferGeometry;
    const filter = cloudFilterRef.current;
    const built = buildLocalPolys();
    const usePerim = !(filter === "all" || !built);
    const dens = densityRef.current;
    const stride = dens >= 1 ? 1 : Math.max(1, Math.round(1 / dens));
    // Nichts einzuschränken -> alle Punkte (kein Index).
    if (!usePerim && stride === 1) {
      geom.setIndex(null);
      return;
    }
    const want = filter === "inside";
    const count = cloudCountRef.current;
    const idx: number[] = [];
    for (let i = 0; i < count; i += stride) {
      if (usePerim) {
        const inside = pointInPolys(pos[i * 3], pos[i * 3 + 1], built!.polys, built!.bboxes);
        if (inside !== want) continue;
      }
      idx.push(i);
    }
    geom.setIndex(idx);
  }

  // Marker beim manuellen Zeichnen + Vorschau-Linie.
  function addDrawPoint(p: THREE.Vector3) {
    const scene = sceneRef.current;
    if (!scene) return;
    drawPtsRef.current.push(p.clone());
    const g = new THREE.SphereGeometry(radiusRef.current * 0.008, 10, 10);
    const m = new THREE.MeshBasicMaterial({ color: 0xff8c1a });
    const s = new THREE.Mesh(g, m);
    s.position.copy(p);
    scene.add(s);
    drawTmpRef.current.push(s);
    // Vorschau-Linie neu zeichnen.
    if (drawPtsRef.current.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(drawPtsRef.current),
        new THREE.LineBasicMaterial({ color: 0xff8c1a }),
      );
      scene.add(line);
      drawTmpRef.current.push(line);
    }
    setDrawCount(drawPtsRef.current.length);
  }

  function clearDrawTmp() {
    const scene = sceneRef.current;
    drawTmpRef.current.forEach((o) => {
      scene?.remove(o);
      const any = o as THREE.Mesh | THREE.Line;
      (any.geometry as THREE.BufferGeometry)?.dispose?.();
      const mat = (any as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else (mat as THREE.Material)?.dispose?.();
    });
    drawTmpRef.current = [];
    drawPtsRef.current = [];
    setDrawCount(0);
  }

  function closeDrawPolygon() {
    const off = offset();
    if (!off) return;
    if (drawPtsRef.current.length < 3) {
      toast("Mindestens 3 Punkte für eine Fläche.", "error");
      return;
    }
    const poly: [number, number][] = drawPtsRef.current.map((v) => [v.x + off[0], v.y + off[1]]);
    clearDrawTmp();
    setPerimeter((ps) => [...ps, poly]);
    setParcels((ps) => [...ps, { egrid: null, number: "manuell", ak: null }]);
    setPerimeterDirty(true);
    setPerimeterMode("off");
    toast("Fläche hinzugefügt.");
  }

  // Parzelle aus amtlicher Vermessung an Klickpunkt holen.
  async function fetchParcelAt(p: THREE.Vector3) {
    const off = offset();
    if (!off) return;
    const E = p.x + off[0], N = p.y + off[1];
    setBusy(true);
    try {
      const r = await fetch(`${BP}/api/cadastral/parcel?e=${E}&n=${N}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setPerimeter((ps) => [...ps, data.polygon as [number, number][]]);
      setParcels((ps) => [...ps, { egrid: data.egrid, number: data.number, ak: data.ak }]);
      setPerimeterDirty(true);
      toast(`Parzelle ${data.number ?? ""}${data.ak ? " (" + data.ak + ")" : ""} hinzugefügt.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function removeParcel(i: number) {
    setPerimeter((ps) => ps.filter((_, k) => k !== i));
    setParcels((ps) => ps.filter((_, k) => k !== i));
    setPerimeterDirty(true);
  }

  function clearPerimeter() {
    clearDrawTmp();
    setPerimeter([]);
    setParcels([]);
    setPerimeterDirty(true);
    setCloudFilter("all");
  }

  async function savePerimeter() {
    setSavingPerimeter(true);
    try {
      const r = await fetch(`${BP}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          perimeter: perimeter.length ? perimeter : null,
          perimeterParcels: parcels,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Fehler ${r.status}`);
      setPerimeterDirty(false);
      toast("Perimeter beim Projekt gespeichert.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingPerimeter(false);
    }
  }

  // ---- DXF-Import (Aushubgrenze / Bereiche) ----
  async function importDxf(file: File) {
    setDxfBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const r = await fetch(`${BP}/api/dxf`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      const list = (data.polylines as DxfPolyline[]).filter((p) => p.n >= 3);
      if (!list.length) throw new Error("Keine verwertbaren (geschlossenen) Polylinien im DXF.");
      setDxfList(list);
      if (list.some((p) => !p.looks_lv95)) {
        toast("Achtung: Koordinaten wirken nicht wie LV95 (Meter). Lage prüfen.", "error");
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDxfBusy(false);
    }
  }

  function assignToPerimeter(pl: DxfPolyline) {
    setPerimeter((ps) => [...ps, pl.points]);
    setParcels((ps) => [...ps, { egrid: null, number: `DXF ${pl.layer}`, ak: null }]);
    setPerimeterDirty(true);
    toast(`Perimeter aus „${pl.layer}" übernommen.`);
  }

  async function assignToRegion(pl: DxfPolyline) {
    try {
      const r = await fetch(`${BP}/api/comparisons/${comparisonId}/regions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: pl.layer || "Bereich", polygon: pl.points, tol, save: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`);
      setImportedRegions((rs) => [...rs, { name: pl.layer || "Bereich", polygon: pl.points }]);
      const v = data.volumes ?? {};
      toast(`Bereich „${pl.layer}": Cut ${Math.round(v.cut_m3 ?? 0)} / Fill ${Math.round(v.fill_m3 ?? 0)} m³.`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  // Importierte Bereiche (grün) rendern.
  function renderRegions() {
    const scene = sceneRef.current;
    const off = offset();
    if (regionsObjRef.current) {
      scene?.remove(regionsObjRef.current);
      regionsObjRef.current.traverse((o) => (o as THREE.Line).geometry?.dispose?.());
      regionsObjRef.current = null;
    }
    if (!scene || !off || importedRegions.length === 0) return;
    const group = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x1aa64b });
    const z = planZRef.current;
    for (const reg of importedRegions) {
      const pts = reg.polygon.map(([E, N]) => new THREE.Vector3(E - off[0], N - off[1], z));
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    regionsObjRef.current = group;
    scene.add(group);
  }

  useEffect(() => {
    if (ready) renderRegions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedRegions, ready]);

  // Perimeter rendern, sobald er sich ändert / die Szene bereit ist.
  useEffect(() => {
    perimeterRef.current = perimeter;
    if (ready) { renderPerimeter(); applyCloudFilter(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter, ready]);

  // Wolken-Aufteilung / Anzeigedichte neu anwenden.
  useEffect(() => {
    densityRef.current = density;
    if (ready) applyCloudFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudFilter, density, ready]);

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
    setPerimeterMode("off");
    clearDrawTmp();
    setCutMode((v) => {
      const next = !v;
      if (next) {
        cutPickRef.current = [];
        toast("Schnitt: zwei Punkte in die Szene klicken.");
      }
      return next;
    });
  }

  // Perimeter-Modus umschalten (deaktiviert das Schnitt-Werkzeug).
  function setPMode(next: PerimeterMode) {
    setCutMode(false);
    clearDrawTmp();
    setPerimeterMode((cur) => (cur === next ? "off" : next));
  }

  function clearCuts() {
    clearCutLines();
    cutPickRef.current = [];
    setProfile(null);
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div
        className="grid"
        style={{
          gap: 12,
          gridTemplateColumns: toolsOpen ? "1fr 300px" : "1fr",
          alignItems: "start",
        }}
      >
        {/* Viewer-Bühne */}
        <div
          ref={stageRef}
          className="panel"
          style={{
            position: "relative",
            padding: 0,
            overflow: "hidden",
            height: fsActive ? "100vh" : "70vh",
            minHeight: 460,
            background: "#0f1115",
          }}
        >
          <div
            ref={containerRef}
            style={{ position: "absolute", inset: 0, cursor: (cutMode || perimeterMode !== "off") ? "crosshair" : "grab" }}
          />
          {/* Steuerknöpfe oben rechts: Werkzeuge ein/aus + Vollbild */}
          <div
            style={{
              position: "absolute", top: 10, right: 10, zIndex: 6,
              display: "flex", gap: 6,
            }}
          >
            <button
              onClick={() => setToolsOpen((v) => !v)}
              title={toolsOpen ? "Werkzeuge ausblenden" : "Werkzeuge einblenden"}
              style={{
                background: "rgba(0,0,0,0.55)", color: "#fff",
                border: "1px solid rgba(255,255,255,0.25)", borderRadius: 6,
                padding: "4px 10px", fontSize: 12, cursor: "pointer",
              }}
            >
              {toolsOpen ? "Werkzeuge »" : "« Werkzeuge"}
            </button>
            <button
              onClick={toggleFullscreen}
              title={fsActive ? "Vollbild verlassen" : "Vollbild"}
              style={{
                background: "rgba(0,0,0,0.55)", color: "#fff",
                border: "1px solid rgba(255,255,255,0.25)", borderRadius: 6,
                padding: "4px 10px", fontSize: 12, cursor: "pointer",
              }}
            >
              {fsActive ? "Vollbild aus" : "Vollbild"}
            </button>
          </div>
          {/* Legende ΔZ-Einfärbung (nur im Abweichungs-Modus) */}
          {colorMode === "dz" && (
            <div
              style={{
                position: "absolute", left: 12, bottom: 12, zIndex: 4,
                background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 8,
                padding: "8px 10px", fontSize: 11, lineHeight: 1.4, maxWidth: 260,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Abweichung ΔZ (m)</div>
              <div
                style={{ height: 8, borderRadius: 4, marginBottom: 4, background: gradientCss(stops) }}
              />
              <div className="spread" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{dzMin.toFixed(2)} (zu tief)</span><span>0</span><span>+{dzMax.toFixed(2)} (zu hoch)</span>
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
        {toolsOpen && (
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
            <label className="small">Bauperimeter</label>
            <div className="grid cols-2" style={{ marginTop: 8 }}>
              <button className={perimeterMode === "parcel" ? "primary" : ""} onClick={() => setPMode("parcel")} disabled={!ready}>
                Parzelle
              </button>
              <button className={perimeterMode === "draw" ? "primary" : ""} onClick={() => setPMode("draw")} disabled={!ready}>
                Zeichnen
              </button>
            </div>
            {perimeterMode === "parcel" && (
              <div className="small muted" style={{ marginTop: 6 }}>
                Auf eine Parzelle klicken — Grenze kommt aus der amtlichen Vermessung.
              </div>
            )}
            {perimeterMode === "draw" && (
              <div className="small muted" style={{ marginTop: 6 }}>
                Punkte klicken; Doppelklick schliesst die Fläche ({drawCount}).
                {drawCount >= 3 && (
                  <button style={{ marginTop: 6 }} onClick={closeDrawPolygon}>Fläche schliessen</button>
                )}
              </div>
            )}

            {/* DXF-Import (Aushubgrenze / Bereiche) */}
            <div style={{ marginTop: 8 }}>
              <input
                ref={fileRef}
                type="file"
                accept=".dxf"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDxf(f); e.target.value = ""; }}
              />
              <button style={{ width: "100%" }} disabled={dxfBusy} onClick={() => fileRef.current?.click()}>
                {dxfBusy ? "Lese DXF …" : "DXF importieren (Grenze/Bereiche)"}
              </button>
              <div className="small muted" style={{ marginTop: 4 }}>DWG vorher im CAD nach DXF exportieren.</div>
            </div>

            {dxfList && (
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <div className="spread">
                  <strong className="small">DXF-Polylinien ({dxfList.length})</strong>
                  <button style={{ padding: "2px 8px" }} onClick={() => setDxfList(null)}>schliessen</button>
                </div>
                {dxfList.map((pl, i) => (
                  <div key={i} className="panel" style={{ padding: 8 }}>
                    <div className="small" style={{ marginBottom: 4 }}>
                      {pl.layer || "(ohne Layer)"} · {pl.area_m2.toLocaleString("de-CH")} m²
                      {!pl.closed && <span className="muted"> · offen</span>}
                      {!pl.looks_lv95 && <span style={{ color: "var(--danger,#d33)" }}> · nicht LV95?</span>}
                    </div>
                    <div className="grid cols-2">
                      <button onClick={() => assignToPerimeter(pl)}>als Perimeter</button>
                      <button onClick={() => void assignToRegion(pl)}>als Bereich</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {perimeter.length > 0 && (
              <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                {parcels.map((pc, i) => (
                  <div key={i} className="spread small" style={{ alignItems: "center" }}>
                    <span>
                      {pc.number === "manuell"
                        ? `Fläche ${i + 1} (gezeichnet)`
                        : `Parz. ${pc.number ?? "?"}${pc.ak ? " " + pc.ak : ""}`}
                    </span>
                    <button onClick={() => removeParcel(i)} title="Entfernen" style={{ padding: "2px 8px" }}>x</button>
                  </div>
                ))}
              </div>
            )}

            <label className="small" style={{ display: "block", marginTop: 10 }}>Wolke anzeigen</label>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
              <button className={cloudFilter === "all" ? "primary" : ""} onClick={() => setCloudFilter("all")}>alle</button>
              <button className={cloudFilter === "inside" ? "primary" : ""} onClick={() => setCloudFilter("inside")} disabled={perimeter.length === 0}>innen</button>
              <button className={cloudFilter === "outside" ? "primary" : ""} onClick={() => setCloudFilter("outside")} disabled={perimeter.length === 0}>aussen</button>
            </div>

            <div className="grid cols-2" style={{ marginTop: 8 }}>
              <button className="primary" disabled={!perimeterDirty || savingPerimeter} onClick={savePerimeter}>
                {savingPerimeter ? "Speichert …" : "Speichern"}
              </button>
              <button disabled={perimeter.length === 0} onClick={clearPerimeter}>Alle löschen</button>
            </div>
            {perimeterDirty && <div className="small muted" style={{ marginTop: 6 }}>Ungespeicherte Änderung.</div>}
          </div>

          <div className="panel">
            <label className="small">Punktgrösse: {pointSize.toFixed(2)} m</label>
            <div style={{ marginTop: 8 }}>
              <Slider value={pointSize} min={0.01} max={3} step={0.01} onChange={setPointSize} />
            </div>
            <label className="small" style={{ display: "block", marginTop: 10 }}>
              Anzeigedichte: {(density * 100).toFixed(0)} %
            </label>
            <div style={{ marginTop: 8 }}>
              <Slider value={density} min={0.02} max={1} step={0.02} onChange={setDensity} />
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Dünnt nur die Anzeige aus (Performance) — Berechnung nutzt immer alle Punkte.
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
                <div className="spread">
                  <label className="small">Untergrenze (zu tief)</label>
                  <span className="small muted">{(dzMin * 100).toFixed(0)} cm</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <Slider
                    value={dzMin} min={-2} max={-0.01} step={0.01}
                    onChange={(v) => setDzMin(Math.min(v, dzMax - 0.01))}
                  />
                </div>

                <div className="spread" style={{ marginTop: 10 }}>
                  <label className="small">Obergrenze (zu hoch)</label>
                  <span className="small muted">+{(dzMax * 100).toFixed(0)} cm</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <Slider
                    value={dzMax} min={0.01} max={2} step={0.01}
                    onChange={(v) => setDzMax(Math.max(v, dzMin + 0.01))}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => { const a = Math.max(Math.abs(dzMin), dzMax); setDzMin(-a); setDzMax(a); }}
                    style={{ width: "100%" }}
                  >
                    Symmetrisch (±{(Math.max(Math.abs(dzMin), dzMax) * 100).toFixed(0)} cm)
                  </button>
                </div>

                <label className="small" style={{ display: "block", marginTop: 10 }}>Farbskala</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {PRESETS.map((p) => (
                    <button key={p.id} onClick={() => setStops(p.stops)}
                      style={{ flex: "1 1 46%", padding: "3px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
                      <span className="small" style={{ fontSize: 10 }}>{p.label}</span>
                      <span style={{ height: 6, borderRadius: 3, background: gradientCss(p.stops) }} />
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {([["zu tief", "lo"], ["auf Soll", "mid"], ["zu hoch", "hi"]] as const).map(([lbl, pos]) => {
                    const idx = pos === "lo" ? 0 : pos === "hi" ? stops.length - 1 : Math.floor((stops.length - 1) / 2);
                    return (
                      <label key={pos} className="small" style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center", flex: 1 }}>
                        <span style={{ fontSize: 10 }}>{lbl}</span>
                        <input
                          type="color"
                          value={rgbToHex(stops[idx])}
                          onChange={(e) => {
                            const lo = stops[0], mi = stops[Math.floor((stops.length - 1) / 2)], hi = stops[stops.length - 1];
                            const nc = hexToRgb(e.target.value);
                            setStops([pos === "lo" ? nc : lo, pos === "mid" ? nc : mi, pos === "hi" ? nc : hi]);
                          }}
                          style={{ width: 36, height: 24, border: "1px solid var(--border)", borderRadius: 4, background: "none", padding: 0, cursor: "pointer" }}
                        />
                      </label>
                    );
                  })}
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
        )}
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
