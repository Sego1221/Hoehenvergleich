"use client";
/**
 * Schlanker 3D-Viewer fuer das Baufortschritt-Status-GLB (Bauteile bereits nach
 * Status eingefaerbt: gruen=gebaut, grau=nicht, orange=verdeckt). Plain Three.js
 * + OrbitControls. Nur clientseitig (dynamic ssr:false).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export default function StatusViewer3D({ url, height = 460 }: { url: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Lade Modell …");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0; let cancelled = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1115);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(1, 1, 2); scene.add(dir);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100000); cam.up.set(0, 0, 1);
    const controls = new OrbitControls(cam, renderer.domElement); controls.enableDamping = true;

    const resize = () => {
      const w = el.clientWidth || 1; const h = el.clientHeight || 1;
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el);

    new GLTFLoader().load(url, (gltf) => {
      if (cancelled) return;
      const root = gltf.scene; scene.add(root);
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3()); const r = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 1);
      controls.target.copy(c);
      cam.position.set(c.x - r * 1.4, c.y - r * 1.4, c.z + r * 1.2);
      cam.near = r / 1000; cam.far = r * 100; cam.updateProjectionMatrix();
      controls.update();
      resize(); setStatus("");
    }, undefined, () => { if (!cancelled) setStatus("Status-Modell konnte nicht geladen werden."); });

    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, cam); };
    raf = requestAnimationFrame(animate);
    return () => {
      cancelled = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [url]);

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", position: "relative", height }}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      {status && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", background: "rgba(0,0,0,.35)" }}>
          <div className="small">{status}</div>
        </div>
      )}
    </div>
  );
}
