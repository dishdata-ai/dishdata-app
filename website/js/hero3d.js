// DishData hero — interactive Three.js "neural orb".
// A glowing point-cloud sphere + wireframe shell + drifting particles that
// reacts to the cursor. Reads as restaurant data converging into intelligence.
// Imported from a full CDN URL (not a bare "three" specifier) so this works both
// as a plain static site and when served through a bundler's dev server.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const canvas = document.getElementById("hero-canvas");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function init() {
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.z = 7.6;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch (e) {
    return; // WebGL unavailable — hero still has CSS blobs behind it.
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const group = new THREE.Group();
  scene.add(group);

  const cBrand = new THREE.Color(0x6ee7b7);
  const cAccent = new THREE.Color(0x22d3ee);
  const cViolet = new THREE.Color(0xa78bfa);

  // --- Point-cloud sphere (Fibonacci distribution) ---
  const R = 2.5;
  const N = 1200;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = Math.PI * (3 - Math.sqrt(5)) * i;
    pos[i * 3] = Math.cos(theta) * radius * R;
    pos[i * 3 + 1] = y * R;
    pos[i * 3 + 2] = Math.sin(theta) * radius * R;
    tmp.copy(cBrand).lerp(cAccent, (y + 1) / 2);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const sphereGeo = new THREE.BufferGeometry();
  sphereGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sphereGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const sphereMat = new THREE.PointsMaterial({
    size: 0.044, vertexColors: true, transparent: true, opacity: 0.72,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sphere = new THREE.Points(sphereGeo, sphereMat);
  group.add(sphere);

  // --- Wireframe shell ---
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.02, 1)),
    new THREE.LineBasicMaterial({ color: cAccent, transparent: true, opacity: 0.07 })
  );
  group.add(wire);

  const wire2 = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 0.55, 0)),
    new THREE.LineBasicMaterial({ color: cViolet, transparent: true, opacity: 0.12 })
  );
  group.add(wire2);

  // --- Drifting ambient particles (depth) ---
  const M = 200;
  const dpos = new Float32Array(M * 3);
  for (let i = 0; i < M; i++) {
    dpos[i * 3] = (Math.random() - 0.5) * 16;
    dpos[i * 3 + 1] = (Math.random() - 0.5) * 11;
    dpos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.03, color: cBrand, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(dust);

  // --- Pointer reactivity ---
  let mx = 0, my = 0, tx = 0, ty = 0;
  window.addEventListener("mousemove", (e) => {
    tx = (e.clientX / window.innerWidth - 0.5);
    ty = (e.clientY / window.innerHeight - 0.5);
  }, { passive: true });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    const t = clock.getElapsedTime();
    sphere.rotation.y += 0.0016;
    sphere.rotation.x = Math.sin(t * 0.15) * 0.12;
    wire.rotation.y -= 0.0011;
    wire.rotation.z += 0.0006;
    wire2.rotation.y += 0.003;
    wire2.rotation.x -= 0.002;
    dust.rotation.y += 0.0004;

    mx += (tx - mx) * 0.05;
    my += (ty - my) * 0.05;
    group.rotation.y += (mx * 0.6 - group.rotation.y) * 0.05;
    group.rotation.x += (my * 0.4 - group.rotation.x) * 0.05;
    const breathe = 1 + Math.sin(t * 0.8) * 0.015;
    group.scale.setScalar(breathe);

    renderer.render(scene, camera);
    if (!reduced) requestAnimationFrame(frame);
  }
  frame();
}

init();
