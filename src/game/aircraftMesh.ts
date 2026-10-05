import * as THREE from "three";
import type { AircraftDef } from "./aircraftDefs";

/**
 * Procedural stand-in airframes.
 *
 * The .glb files committed to this repo are not loadable (see tools/verify-assets.mjs), so
 * the loader falls back to these. They are built in the same model space the flight model
 * expects — nose toward -Z, wheels resting on y = 0, and struts that land exactly on the
 * gear points from the aircraft definition, so the aeroplane sits on the runway the way the
 * physics thinks it does.
 */

type Spec = {
  fuseLen: number; fuseR: number; fuseW: number; fuseH: number; fuseY: number;
  noseLen: number; tailTaper: number;
  wingY: number; wingSpan: number; wingRoot: number; wingTip: number; wingThick: number;
  wingSweep: number; wingDih: number; wingZ: number;
  tailSpan: number; tailRoot: number; tailZ: number; tailY: number;
  finH: number; finRoot: number; tTail: boolean;
  engines: { x: number; y: number; z: number; r: number; len: number; fan: string[]; prop?: boolean; name?: string }[];
  windows: [number, number, number, number][]; // x, y, z, size
  accentStripe: boolean;
};

const SPECS: Record<string, Spec> = {
  pa28: {
    fuseLen: 6.4, fuseR: 0.62, fuseW: 0.95, fuseH: 1.0, fuseY: 1.05, noseLen: 1.1, tailTaper: 0.34,
    wingY: 1.0, wingSpan: 10.4, wingRoot: 1.75, wingTip: 0.95, wingThick: 0.16, wingSweep: 0.05, wingDih: 0.11, wingZ: 0.35,
    tailSpan: 3.3, tailRoot: 1.25, tailZ: 2.75, tailY: 1.35, finH: 1.35, finRoot: 1.5, tTail: false,
    engines: [{ x: 0, y: 1.05, z: -3.15, r: 0.36, len: 0.9, fan: ["helice"], prop: true }],
    windows: [[-0.42, 1.55, -0.75, 0.62], [0.42, 1.55, -0.75, 0.62]],
    accentStripe: true,
  },
  ask21: {
    fuseLen: 8.0, fuseR: 0.42, fuseW: 0.8, fuseH: 1.05, fuseY: 0.78, noseLen: 1.0, tailTaper: 0.2,
    wingY: 1.12, wingSpan: 16.8, wingRoot: 1.15, wingTip: 0.4, wingThick: 0.11, wingSweep: 0.12, wingDih: 0.14, wingZ: 0.3,
    tailSpan: 3.6, tailRoot: 0.95, tailZ: 3.3, tailY: 2.05, finH: 1.5, finRoot: 1.2, tTail: true,
    engines: [],
    windows: [[0, 1.28, -1.5, 0.72]],
    accentStripe: true,
  },
  atr42: {
    fuseLen: 21.5, fuseR: 1.35, fuseW: 1.0, fuseH: 1.15, fuseY: 2.6, noseLen: 2.6, tailTaper: 0.3,
    wingY: 3.7, wingSpan: 24.2, wingRoot: 2.7, wingTip: 1.1, wingThick: 0.3, wingSweep: 0.1, wingDih: 0.05, wingZ: 0.2,
    tailSpan: 8.4, tailRoot: 2.2, tailZ: 9.6, tailY: 6.4, finH: 3.6, finRoot: 3.4, tTail: true,
    engines: [
      { x: -4.6, y: 3.75, z: -0.4, r: 1.05, len: 3.0, fan: ["Prop1"], prop: true },
      { x: 4.6, y: 3.75, z: -0.4, r: 1.05, len: 3.0, fan: ["Prop2"], prop: true },
    ],
    windows: [[-1.25, 3.2, -4.0, 0.9], [1.25, 3.2, -4.0, 0.9]],
    accentStripe: true,
  },
  citation: {
    fuseLen: 14.0, fuseR: 0.95, fuseW: 1.0, fuseH: 1.1, fuseY: 1.75, noseLen: 2.4, tailTaper: 0.26,
    wingY: 1.55, wingSpan: 15.2, wingRoot: 2.5, wingTip: 0.9, wingThick: 0.24, wingSweep: 0.22, wingDih: 0.05, wingZ: 1.1,
    tailSpan: 5.2, tailRoot: 1.7, tailZ: 6.2, tailY: 4.0, finH: 2.4, finRoot: 2.4, tTail: true,
    engines: [
      { x: -1.15, y: 2.25, z: 4.1, r: 0.62, len: 2.6, fan: ["LEngine_fan"] },
      { x: 1.15, y: 2.25, z: 4.1, r: 0.62, len: 2.6, fan: ["REngine_fan"] },
    ],
    windows: [[-0.85, 2.2, -4.2, 0.95], [0.85, 2.2, -4.2, 0.95]],
    accentStripe: true,
  },
  a320: {
    fuseLen: 36.0, fuseR: 2.0, fuseW: 1.0, fuseH: 1.05, fuseY: 3.1, noseLen: 4.4, tailTaper: 0.26,
    wingY: 2.1, wingSpan: 33.0, wingRoot: 5.2, wingTip: 1.5, wingThick: 0.5, wingSweep: 0.34, wingDih: 0.09, wingZ: 2.0,
    tailSpan: 12.0, tailRoot: 3.6, tailZ: 15.4, tailY: 6.2, finH: 6.2, finRoot: 5.4, tTail: false,
    engines: [
      { x: -6.6, y: 1.15, z: 0.6, r: 1.35, len: 3.6, fan: ["fanWheel", "blades"] },
      { x: 6.6, y: 1.15, z: 0.6, r: 1.35, len: 3.6, fan: ["fanWheel2", "blades2"] },
    ],
    windows: [[-1.7, 3.9, -13.5, 1.5], [1.7, 3.9, -13.5, 1.5]],
    accentStripe: true,
  },
  beluga: {
    fuseLen: 52.0, fuseR: 4.1, fuseW: 1.0, fuseH: 1.05, fuseY: 6.0, noseLen: 8.0, tailTaper: 0.3,
    wingY: 3.2, wingSpan: 43.0, wingRoot: 7.0, wingTip: 2.2, wingThick: 0.7, wingSweep: 0.3, wingDih: 0.06, wingZ: 4.0,
    tailSpan: 15.0, tailRoot: 5.0, tailZ: 22.0, tailY: 10.5, finH: 8.0, finRoot: 7.5, tTail: false,
    engines: [
      { x: -8.6, y: 1.5, z: 1.0, r: 2.1, len: 5.2, fan: ["eng1Fan"] },
      { x: 8.6, y: 1.5, z: 1.0, r: 2.1, len: 5.2, fan: ["eng2Fan"] },
    ],
    windows: [[-2.6, 6.2, -21.0, 1.9], [2.6, 6.2, -21.0, 1.9]],
    accentStripe: true,
  },
};

/** Tapered, swept, dihedralled wing built by reshaping a box. */
function wingGeom(span: number, root: number, tip: number, thick: number, sweep: number, dihedral: number) {
  const g = new THREE.BoxGeometry(span, thick, root, 12, 1, 4);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const half = span / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.min(1, Math.abs(x) / half);
    const c = root + (tip - root) * t;
    const k = c / root;
    let zz = -root * 0.35 + (z + root * 0.35) * k; // keep the leading edge as the reference
    zz += sweep * root * 2.2 * t;
    pos.setXYZ(i, x, y * (1 - 0.4 * t) + Math.tan(dihedral) * Math.abs(x), zz);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Body of revolution along Z, nose at -Z. */
function fuseGeom(len: number, r: number, noseLen: number, tailTaper: number, wScale: number, hScale: number) {
  const pts: THREE.Vector2[] = [];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 = tail, 1 = nose
    const y = len / 2 - t * len;
    let rad: number;
    if (t < 0.3) rad = r * (tailTaper + (1 - tailTaper) * Math.pow(t / 0.3, 0.65)); // tail cone
    else if (t > 1 - noseLen / len) {
      const u = (t - (1 - noseLen / len)) / (noseLen / len);
      rad = r * Math.sqrt(Math.max(0, 1 - u * u * 0.94)); // rounded nose
    } else rad = r * (1 - 0.06 * Math.pow(Math.abs(t - 0.6) * 2, 2));
    pts.push(new THREE.Vector2(Math.max(0.02, rad), y));
  }
  const g = new THREE.LatheGeometry(pts, 24);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z, tail at +Z, nose at -Z
  g.scale(wScale, hScale, 1);
  g.computeVertexNormals();
  return g;
}

export function buildAircraft(def: AircraftDef, accent: string): THREE.Group {
  const spec = SPECS[def.id] ?? SPECS.pa28;
  const g = new THREE.Group();
  const pal = {
    pa28: ["#f6f1e8", "#e2564f"], ask21: ["#f7f7fb", "#3f7fd0"], atr42: ["#f2f4f8", "#2f6fb5"],
    citation: ["#f4f4f6", "#2b3550"], a320: ["#f6f7fa", "#3f6fb0"], beluga: ["#f2f4f7", "#2e7ec0"],
  }[def.id] ?? ["#f4f4f7", accent];

  const hull = new THREE.MeshStandardMaterial({ color: pal[0], roughness: 0.42, metalness: 0.28, envMapIntensity: 1.1 });
  const belly = new THREE.MeshStandardMaterial({ color: "#cfd3dc", roughness: 0.5, metalness: 0.3 });
  const stripe = new THREE.MeshStandardMaterial({ color: pal[1], roughness: 0.4, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: "#2b2f3a", roughness: 0.55, metalness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: "#9aa1ad", roughness: 0.3, metalness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({ color: "#141a2a", roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.85, depthWrite: false, envMapIntensity: 1.6 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, name = "") => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (name) m.name = name;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // ---- fuselage
  add(fuseGeom(spec.fuseLen, spec.fuseR, spec.noseLen, spec.tailTaper, spec.fuseW, spec.fuseH), hull, 0, spec.fuseY, 0);
  // belly shading + cheatline
  const bl = add(new THREE.CylinderGeometry(spec.fuseR * 0.94 * spec.fuseW, spec.fuseR * 0.94 * spec.fuseW, spec.fuseLen * 0.82, 20, 1, true, Math.PI * 0.15, Math.PI * 0.7), belly, 0, spec.fuseY, 0);
  bl.rotation.x = Math.PI / 2;
  if (spec.accentStripe) {
    const st = add(new THREE.CylinderGeometry(spec.fuseR * 1.005 * spec.fuseW, spec.fuseR * 1.005 * spec.fuseW, spec.fuseLen * 0.9, 24, 1, true, -Math.PI * 0.12, Math.PI * 0.24), stripe, 0, spec.fuseY, 0);
    st.rotation.x = Math.PI / 2;
  }

  // ---- wing + tailplane
  add(wingGeom(spec.wingSpan, spec.wingRoot, spec.wingTip, spec.wingThick, spec.wingSweep, spec.wingDih), hull, 0, spec.wingY, spec.wingZ);
  add(wingGeom(spec.tailSpan, spec.tailRoot, spec.tailRoot * 0.45, spec.wingThick * 0.8, spec.wingSweep * 0.8, 0.05), hull, 0, spec.tailY, spec.tailZ);
  // winglets on the swept types
  if (spec.wingSweep > 0.2) for (const s of [-1, 1]) {
    const wl = add(new THREE.BoxGeometry(0.12, spec.wingRoot * 0.9, spec.wingTip * 1.6), hull, s * spec.wingSpan * 0.495, spec.wingY + spec.wingRoot * 0.45 + Math.tan(spec.wingDih) * spec.wingSpan * 0.5, spec.wingZ + spec.wingSweep * spec.wingRoot * 2.2);
    wl.rotation.z = s * 0.12;
  }

  // ---- fin
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(spec.finRoot * 1.1, 0);
  finShape.lineTo(spec.finRoot * 0.35, spec.finH);
  finShape.lineTo(-spec.finRoot * 0.15, spec.finH);
  finShape.lineTo(0, 0);
  const fin = add(new THREE.ExtrudeGeometry(finShape, { depth: 0.16, bevelEnabled: false }), hull, -0.08, spec.tailY, spec.tailZ - spec.finRoot * 0.2);
  fin.rotation.y = Math.PI / 2;
  fin.rotation.x = 0;
  fin.position.set(-0.08, spec.tailY, spec.tailZ - spec.finRoot * 0.55);

  // ---- engines / propellers
  for (const e of spec.engines) {
    const pylon = add(new THREE.BoxGeometry(0.22, 0.9, e.len * 0.8), dark, e.x, e.y + e.r * 0.7, e.z);
    void pylon;
    add(new THREE.CylinderGeometry(e.r, e.r * 0.92, e.len, 20), metal, e.x, e.y, e.z).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(e.r * 0.98, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal, e.x, e.y, e.z - e.len / 2).rotation.x = -Math.PI / 2;
    if (e.prop) {
      const hub = add(new THREE.ConeGeometry(e.r * 0.34, e.r * 1.1, 14), dark, e.x, e.y, e.z - e.len / 2 - e.r * 0.4);
      hub.rotation.x = -Math.PI / 2;
      const blades = new THREE.Group();
      blades.name = e.fan[0];
      const n = def.id === "pa28" ? 2 : 4;
      const rad = e.r * (def.id === "pa28" ? 2.6 : 2.3);
      // Blades hang directly off the named group (no intermediate arms) so the loader's
      // keep-rule, which only looks at a mesh and its parent, keeps them spinning.
      const bladeGeo = new THREE.BoxGeometry(rad * 0.16, rad, 0.05);
      bladeGeo.translate(0, rad / 2, 0);
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(bladeGeo, dark);
        b.name = "blade";
        b.rotation.z = (i / n) * Math.PI * 2 + 0.35;
        blades.add(b);
      }
      blades.position.set(e.x, e.y, e.z - e.len / 2 - e.r * 0.5);
      blades.traverse((o) => { o.castShadow = true; });
      g.add(blades);
      // blurred disc, shown once the rpm is up (engine swaps visibility by name)
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(rad, 32),
        new THREE.MeshBasicMaterial({ color: "#dfe6f2", transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      disc.name = e.fan[0] === "helice" ? "propblur" : e.fan[0].replace(/(\d*)$/, "Blur$1");
      disc.position.copy(blades.position);
      disc.visible = false;
      g.add(disc);
    } else {
      // fan face + spinner for the jets
      const fan = new THREE.Group();
      fan.name = e.fan[0];
      const face = new THREE.Mesh(new THREE.CircleGeometry(e.r * 0.9, 24), new THREE.MeshStandardMaterial({ color: "#1a1e28", roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }));
      face.name = "fanFace";
      fan.add(face);
      const vaneGeo = new THREE.BoxGeometry(e.r * 0.12, e.r * 0.82, 0.04);
      vaneGeo.translate(0, e.r * 0.44, 0);
      for (let i = 0; i < 14; i++) {
        const b = new THREE.Mesh(vaneGeo, metal);
        b.name = "blade";
        b.rotation.z = (i / 14) * Math.PI * 2;
        fan.add(b);
      }
      const spin2 = new THREE.Mesh(new THREE.ConeGeometry(e.r * 0.28, e.r * 0.7, 12), metal);
      spin2.rotation.x = -Math.PI / 2;
      spin2.position.z = -e.r * 0.3;
      spin2.name = e.fan[1] ?? "";
      fan.add(spin2);
      fan.position.set(e.x, e.y, e.z - e.len / 2 - 0.02);
      fan.traverse((o) => { o.castShadow = false; });
      g.add(fan);
    }
  }

  // ---- glazing (hidden from the cockpit camera by the engine's glass list)
  for (const [x, y, z, s] of spec.windows) {
    const w = add(new THREE.SphereGeometry(s * 0.85, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), glass, x, y, z);
    w.userData.glass = true;
    w.castShadow = false;
    w.scale.set(1, 0.75, 1.5);
  }
  // cabin window line for the bigger types
  if (spec.fuseLen > 16) {
    const n = Math.floor(spec.fuseLen / 1.6);
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
      const z = -spec.fuseLen * 0.32 + i * 1.6;
      const w = add(new THREE.BoxGeometry(0.06, 0.34, 0.5), glass, s * spec.fuseR * 0.99 * spec.fuseW, spec.fuseY + spec.fuseR * 0.32, z);
      w.userData.glass = true; w.castShadow = false;
    }
  }

  // ---- landing gear: struts land exactly on the definition's gear points
  for (const gp of def.gear) {
    const [gx, gy, gz] = gp.p;
    if (gp.kind === "skid") {
      add(new THREE.BoxGeometry(0.3, 0.14, 1.5), dark, gx, gy + 0.07, gz);
      continue;
    }
    const r = Math.max(0.16, Math.min(0.75, spec.fuseR * 0.3));
    const topY = spec.wingY > 2.6 ? spec.fuseY - spec.fuseR * 0.5 : spec.fuseY - spec.fuseR * 0.55;
    const strut = add(new THREE.CylinderGeometry(r * 0.16, r * 0.2, Math.max(0.2, topY - gy - r), 8), metal, gx, gy + r + (topY - gy - r) / 2, gz);
    strut.rotation.z = gx === 0 ? 0 : -Math.sign(gx) * 0.06;
    const wheel = add(new THREE.CylinderGeometry(r, r, r * 0.5, 14), dark, gx, gy + r, gz);
    wheel.rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 0.54, 10), metal, gx, gy + r, gz).rotation.z = Math.PI / 2;
  }

  // ---- navigation light anchors match the hull points used by the engine
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material === glass) m.userData.glass = true; });
  return g;
}
