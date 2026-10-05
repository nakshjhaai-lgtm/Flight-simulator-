import * as THREE from "three";
import { InstrumentData, speedReading, heightReading, altReading, vsReading, hdgText, Units } from "./instruments";

export type { InstrumentData as InstData } from "./instruments";

type Style = "ga" | "jet" | "liner" | "glider";

interface Cfg {
  w: number; // half width of the panel
  panelY: number; panelZ: number;
  roof: number; side: number;
  stick: "yoke" | "center" | "side"; // control column type
  levers: number; // throttle levers on the pedestal
  scale: number; tint: string; seat: number;
  windowTop: number; pillar: number;
}

const cfg: Record<Style, Cfg> = {
  ga: { w: 0.62, panelY: -0.40, panelZ: -0.80, roof: 0.62, side: 0.62, stick: "yoke", levers: 2, scale: 1.00, tint: "#26242b", seat: 1, windowTop: 0.56, pillar: 0.52 },
  glider: { w: 0.42, panelY: -0.36, panelZ: -0.70, roof: 0.72, side: 0.44, stick: "center", levers: 1, scale: 0.86, tint: "#2a2d33", seat: 1, windowTop: 0.66, pillar: 0.62 },
  jet: { w: 0.72, panelY: -0.46, panelZ: -0.90, roof: 0.66, side: 0.78, stick: "yoke", levers: 2, scale: 1.12, tint: "#1d2028", seat: 1, windowTop: 0.58, pillar: 0.56 },
  liner: { w: 1.05, panelY: -0.58, panelZ: -1.10, roof: 0.82, side: 1.12, stick: "side", levers: 3, scale: 1.45, tint: "#20242c", seat: 2, windowTop: 0.70, pillar: 0.66 },
};

/**
 * Cockpit interior built around the pilot's eye (local origin = eye, -Z forward).
 *
 * The panel is a live canvas texture driven from the very same InstrumentData the 2-D HUD
 * reads, so the two can never disagree about what the aeroplane is doing.
 */
export class Cockpit {
  group = new THREE.Group();
  canvas = document.createElement("canvas");
  tex: THREE.CanvasTexture;
  yoke = new THREE.Group();
  ctx: CanvasRenderingContext2D;
  light = new THREE.Color(1, 1, 1);
  mats: THREE.MeshStandardMaterial[] = [];
  glow: THREE.MeshBasicMaterial;
  cabin = new THREE.PointLight("#ffd9a8", 0, 3.2, 2);
  levers: THREE.Object3D[] = [];
  private leverPivot = -1.05;
  private acc = 0;
  private style: Style;
  private c: Cfg;

  constructor(style: Style, accent: string) {
    this.style = style;
    const c = (this.c = cfg[style]);
    const S = c.scale;
    this.canvas.width = 1024; this.canvas.height = 320;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;

    const dark = new THREE.MeshStandardMaterial({ color: c.tint, roughness: 0.82, metalness: 0.08 });
    const trim = new THREE.MeshStandardMaterial({ color: "#3b3f4d", roughness: 0.5, metalness: 0.45 });
    const soft = new THREE.MeshStandardMaterial({ color: "#2f2b36", roughness: 0.95, metalness: 0.02 });
    const accentM = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, emissive: accent, emissiveIntensity: 0.25 });
    const chrome = new THREE.MeshStandardMaterial({ color: "#8f939f", roughness: 0.28, metalness: 0.85 });
    this.mats.push(dark, trim, soft, accentM, chrome);
    const g = this.group;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me;
    };

    // ---- instrument panel: a slanted binnacle rather than a floating board
    const panelW = Math.min(c.w * 2.5, 1.5 * S + 0.3);
    const binnacle = new THREE.Shape();
    binnacle.moveTo(0, 0);
    binnacle.lineTo(0.62 * S, 0);
    binnacle.lineTo(0.62 * S, 0.10 * S);
    binnacle.lineTo(0.16 * S, 0.34 * S);
    binnacle.lineTo(0, 0.34 * S);
    const bg = new THREE.ExtrudeGeometry(binnacle, { depth: panelW, bevelEnabled: false });
    bg.translate(0, 0, -panelW / 2);
    const bin = add(bg, dark, 0, c.panelY - 0.30 * S, c.panelZ + 0.30 * S);
    bin.rotation.y = Math.PI / 2;
    bin.scale.z = -1;
    // the live instrument face, tilted toward the pilot
    this.glow = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    add(new THREE.PlaneGeometry(panelW, panelW * (320 / 1024)), this.glow, 0, c.panelY - 0.02 * S, c.panelZ + 0.34 * S, -0.52, 0, 0);
    // chrome bezel around the face
    const bez = new THREE.Mesh(new THREE.PlaneGeometry(panelW + 0.05, panelW * (320 / 1024) + 0.05), trim);
    bez.position.set(0, c.panelY - 0.025 * S, c.panelZ + 0.345 * S); bez.rotation.x = -0.52; g.add(bez);

    // ---- glareshield + sun visor
    add(new THREE.BoxGeometry(panelW + 0.24, 0.05, 0.36 * S), dark, 0, c.panelY + 0.10 * S, c.panelZ + 0.02 * S, 0.16);
    add(new THREE.BoxGeometry(panelW + 0.24, 0.018, 0.028), accentM, 0, c.panelY + 0.125 * S, c.panelZ - 0.15 * S, 0.16);
    add(new THREE.BoxGeometry(panelW + 0.2, 0.02, 0.16 * S), soft, 0, c.panelY + 0.20 * S, c.panelZ - 0.20 * S, -0.28);

    // ---- windshield structure: A-pillars, header rail, centre post
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.055, c.windowTop + 0.24, 0.075), trim, s * c.pillar, c.windowTop * 0.32, c.panelZ - 0.20 * S, -0.30, 0, -s * 0.16);
      // side window frame (door glass surround)
      add(new THREE.BoxGeometry(0.05, 0.42 * S, 0.05), trim, s * (c.side + 0.02), 0.12 * S, -0.34 * S);
      add(new THREE.BoxGeometry(0.05, 0.42 * S, 0.05), trim, s * (c.side + 0.02), 0.12 * S, 0.30 * S);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.7 * S), trim, s * (c.side + 0.02), 0.33 * S, -0.02 * S);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.7 * S), trim, s * (c.side + 0.02), -0.09 * S, -0.02 * S);
      // door / sill
      add(new THREE.BoxGeometry(0.07, 0.60 * S, 2.0 * S), soft, s * (c.side + 0.07), -0.58 * S, 0.05 * S);
      add(new THREE.BoxGeometry(0.20, 0.11, 1.9 * S), dark, s * (c.side - 0.02), -0.30 * S, 0.0);
      // map-pocket handle
      add(new THREE.BoxGeometry(0.02, 0.02, 0.16), chrome, s * (c.side + 0.02), -0.42 * S, 0.1 * S);
    }
    if (style === "ga") add(new THREE.BoxGeometry(0.045, c.windowTop + 0.1, 0.06), trim, 0, c.windowTop * 0.34, c.panelZ - 0.22 * S, -0.30);
    // header rail + roof
    add(new THREE.BoxGeometry(panelW + 0.3, 0.07, 0.14), dark, 0, c.windowTop + 0.02, c.panelZ - 0.16 * S, 0.22);
    add(new THREE.BoxGeometry(panelW + 0.34, 0.05, 1.5 * S), soft, 0, c.roof, 0.34 * S);
    add(new THREE.BoxGeometry(panelW + 0.34, 0.06, 0.1), dark, 0, c.roof - 0.03, c.panelZ - 0.34 * S, 0.2);
    // overhead switch panel (liner/jet)
    if (style === "liner" || style === "jet") {
      add(new THREE.BoxGeometry(panelW * 0.7, 0.03, 0.34 * S), dark, 0, c.roof - 0.07, 0.02, 0.12);
      for (let i = 0; i < 14; i++) add(new THREE.BoxGeometry(0.018, 0.012, 0.02), i % 3 ? accentM : trim, -panelW * 0.3 + i * (panelW * 0.045), c.roof - 0.09, 0.04, 0.12);
    }
    // floor + seat backs
    add(new THREE.BoxGeometry(panelW + 0.4, 0.04, 2.4 * S), soft, 0, -0.98 * S, 0.3 * S);
    for (let i = 0; i < c.seat; i++) {
      const sx = c.seat === 2 ? (i === 0 ? -0.42 * S : 0.42 * S) : 0;
      add(new THREE.BoxGeometry(0.46 * S, 0.62 * S, 0.1), new THREE.MeshStandardMaterial({ color: "#3a2f3a", roughness: 0.94 }), sx, -0.5 * S, 0.5 * S, 0.12);
      add(new THREE.BoxGeometry(0.46 * S, 0.08 * S, 0.42 * S), new THREE.MeshStandardMaterial({ color: "#332a35", roughness: 0.94 }), sx, -0.8 * S, 0.32 * S);
    }

    // ---- centre pedestal with throttle levers that actually move
    const pedW = style === "liner" ? 0.3 * S : 0.2 * S;
    add(new THREE.BoxGeometry(pedW, 0.16, 0.86 * S), dark, 0, -0.66 * S, c.panelZ + 0.62 * S, -0.06);
    add(new THREE.BoxGeometry(pedW + 0.02, 0.02, 0.88 * S), trim, 0, -0.575 * S, c.panelZ + 0.62 * S, -0.06);
    for (let i = 0; i < c.levers; i++) {
      const lx = (i - (c.levers - 1) / 2) * (pedW / Math.max(1, c.levers)) * 0.9;
      const piv = new THREE.Group();
      piv.position.set(lx, -0.56 * S, c.panelZ + 0.62 * S);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.19, 8), chrome);
      shaft.position.y = 0.09; piv.add(shaft);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), i === 0 ? accentM : trim);
      knob.position.y = 0.19; knob.scale.set(1, 0.8, 1.3); piv.add(knob);
      piv.rotation.x = this.leverPivot;
      g.add(piv); this.levers.push(piv);
    }
    // flap / airbrake lever on the left sill
    const flapPiv = new THREE.Group();
    flapPiv.position.set(-pedW * 0.9, -0.60 * S, c.panelZ + 0.42 * S);
    const fshaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.13, 8), chrome); fshaft.position.y = 0.06; flapPiv.add(fshaft);
    const fknob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), trim); fknob.position.y = 0.13; flapPiv.add(fknob);
    flapPiv.rotation.x = -0.4; g.add(flapPiv);
    this.levers.push(flapPiv);

    // ---- control column / stick
    this.yoke.position.set(c.stick === "side" ? -0.42 * S : 0, -0.44 * S, c.panelZ + 0.46 * S);
    if (c.stick === "center") {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.017, 0.42, 8), trim); st.position.y = 0.18; this.yoke.add(st);
      const gr = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.07, 4, 10), dark); gr.position.y = 0.40; this.yoke.add(gr);
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), accentM); btn.position.set(0, 0.43, -0.022); this.yoke.add(btn);
    } else if (c.stick === "side") {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.24, 8), trim); st.position.y = 0.1; this.yoke.add(st);
      const gr = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.06, 4, 10), dark); gr.position.y = 0.24; this.yoke.add(gr);
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.2), dark); tray.position.y = -0.02; this.yoke.add(tray);
    } else {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.5, 10), trim);
      col.rotation.x = Math.PI / 2; col.position.z = 0.22; this.yoke.add(col);
      const wheel = new THREE.Group(); wheel.position.set(0, 0.03, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15 * S, 0.015, 8, 28), dark); wheel.add(ring);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.32 * S, 0.028, 0.028), dark); wheel.add(bar);
      for (const s of [-1, 1]) {
        const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.05, 4, 8), dark);
        grip.position.set(s * 0.15 * S, 0, 0); wheel.add(grip);
      }
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), accentM); btn.position.set(0.07 * S, 0.02, -0.014); wheel.add(btn);
      this.yoke.add(wheel); this.yoke.userData.wheel = wheel;
      this.yoke.rotation.x = -0.15;
    }
    g.add(this.yoke);

    // rudder pedals
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.09 * S, 0.13 * S, 0.02), trim, s * 0.16 * S, -0.86 * S, c.panelZ + 0.24 * S, -0.35);

    // cabin light (kept in the graph with intensity 0 so toggling it never recompiles shaders)
    this.cabin.position.set(0, 0.34, -0.1);
    this.cabin.castShadow = false;
    g.add(this.cabin);

    g.traverse((o) => { o.frustumCulled = false; });
    g.visible = false;
  }

  setLight(brightness: number) {
    this.light.setScalar(brightness);
    this.glow.color.copy(this.light);
    // instruments glow harder as the cabin gets darker, like a real panel at dusk
    this.cabin.intensity = Math.max(0, 1.25 - brightness) * 0.55;
  }

  update(dt: number, d: InstrumentData, pitchIn: number, rollIn: number) {
    const w = this.yoke.userData.wheel as THREE.Group | undefined;
    if (w) {
      w.rotation.z += (-rollIn * 1.1 - w.rotation.z) * Math.min(1, dt * 12);
      this.yoke.position.z += (((this.yoke.userData.baseZ ??= this.yoke.position.z) + pitchIn * 0.06) - this.yoke.position.z) * Math.min(1, dt * 10);
    } else {
      this.yoke.rotation.z += (-rollIn * 0.4 - this.yoke.rotation.z) * Math.min(1, dt * 12);
      this.yoke.rotation.x += (-pitchIn * 0.4 - this.yoke.rotation.x) * Math.min(1, dt * 12);
    }
    // throttle + flap levers follow the actual lever positions
    const n = this.levers.length;
    for (let i = 0; i < n; i++) {
      const target = i === n - 1 ? -0.4 - d.flaps * 0.42 : this.leverPivot - d.thr * 0.95;
      this.levers[i].rotation.x += (target - this.levers[i].rotation.x) * Math.min(1, dt * 9);
    }
    this.acc += dt;
    if (this.acc < 1 / 14) return;
    this.acc = 0;
    this.draw(d);
  }

  private draw(d: InstrumentData) {
    const c = this.ctx, W = 1024, H = 320;
    const metric = d.units !== "imperial";
    const spd = speedReading(d.ias, d.units);
    const hgt = heightReading(d.agl, d.units);
    const alt = altReading(d.alt, d.units);
    const vs = vsReading(d.vs, d.units);
    c.fillStyle = "#0a0c13"; c.fillRect(0, 0, W, H);

    // bezel
    c.strokeStyle = "#2c3145"; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
    const cy = 132, R = 96;

    // ---------------- airspeed ----------------
    {
      const cx = 128;
      c.save(); c.translate(cx, cy);
      c.fillStyle = "#10131d"; c.beginPath(); c.arc(0, 0, R + 10, 0, 7); c.fill();
      c.strokeStyle = "#3a4160"; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, R + 10, 0, 7); c.stroke();
      const vsU = (v: number) => (metric ? v * 3.6 : v * 1.94384);
      const vmax = Math.max(vsU(d.vMax), vsU(d.vStall) * 1.6);
      const step = vmax > 220 ? 40 : 20;
      const ang = (v: number) => -2.2 + (Math.min(v, vmax) / vmax) * 4.4;
      const band = (a: number, b: number, col: string) => { c.strokeStyle = col; c.lineWidth = 10; c.beginPath(); c.arc(0, 0, R - 6, ang(a) - Math.PI / 2, ang(b) - Math.PI / 2); c.stroke(); };
      const s0 = vsU(d.vStall), s1 = vsU(d.vFlapStall);
      band(0, s0, "#ff4d5e"); band(s0, Math.min(s0 * 1.3, vmax), "#ffd23d"); band(Math.min(s0 * 1.3, vmax), vmax * 0.85, "#4dff9d"); band(vmax * 0.85, vmax, "#ff4d5e");
      c.strokeStyle = "#dfe6ff"; c.fillStyle = "#dfe6ff"; c.font = "bold 15px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      for (let v = 0; v <= vmax; v += step) {
        const a = ang(v) - Math.PI / 2;
        c.lineWidth = 2; c.beginPath(); c.moveTo(Math.cos(a) * (R - 20), Math.sin(a) * (R - 20)); c.lineTo(Math.cos(a) * (R - 30), Math.sin(a) * (R - 30)); c.stroke();
        if (v % (step * 2) === 0) c.fillText(String(v), Math.cos(a) * (R - 46), Math.sin(a) * (R - 46));
      }
      const a = ang(spd.v) - Math.PI / 2;
      c.strokeStyle = "#ffb04d"; c.lineWidth = 5; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * (R - 16), Math.sin(a) * (R - 16)); c.stroke();
      c.fillStyle = "#ffb04d"; c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill();
      c.fillStyle = "#9aa4c8"; c.font = "bold 13px sans-serif"; c.fillText(spd.unit.toUpperCase(), 0, 54);
      c.restore();
      // digital readout so the panel matches the HUD digit for digit
      c.fillStyle = "#10131d"; c.fillRect(cx - 40, cy + 68, 80, 26);
      c.strokeStyle = "#3a4160"; c.lineWidth = 2; c.strokeRect(cx - 40, cy + 68, 80, 26);
      c.fillStyle = "#ffb04d"; c.font = "bold 20px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(spd.v), cx, cy + 82);
    }

    // ---------------- attitude ----------------
    {
      c.save(); c.translate(384, cy);
      c.beginPath(); c.arc(0, 0, R + 10, 0, 7); c.fillStyle = "#10131d"; c.fill(); c.save(); c.clip();
      c.rotate((-d.bank * Math.PI) / 180);
      c.translate(0, d.pitch * 4.2);
      c.fillStyle = "#3f8fd6"; c.fillRect(-220, -440, 440, 440);
      c.fillStyle = "#8a5c33"; c.fillRect(-220, 0, 440, 440);
      c.strokeStyle = "#ffffff"; c.lineWidth = 3; c.beginPath(); c.moveTo(-220, 0); c.lineTo(220, 0); c.stroke();
      c.font = "bold 13px sans-serif"; c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
      for (let p = -30; p <= 30; p += 10) {
        if (!p) continue;
        const y = -p * 4.2, w = p % 20 === 0 ? 42 : 22;
        c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke();
        if (p % 20 === 0) { c.fillText(String(Math.abs(p)), -w - 16, y); c.fillText(String(Math.abs(p)), w + 16, y); }
      }
      c.restore();
      // fixed aircraft symbol + roll scale
      c.strokeStyle = "#ffcf3d"; c.lineWidth = 5;
      c.beginPath(); c.moveTo(-62, 0); c.lineTo(-20, 0); c.lineTo(-20, 11); c.moveTo(62, 0); c.lineTo(20, 0); c.lineTo(20, 11); c.stroke();
      c.fillStyle = "#ffcf3d"; c.beginPath(); c.arc(0, 0, 4, 0, 7); c.fill();
      c.strokeStyle = "#e8eeff"; c.lineWidth = 2;
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const rad = (a * Math.PI) / 180 - Math.PI / 2, len = a % 30 === 0 ? 14 : 8;
        c.beginPath(); c.moveTo(Math.cos(rad) * (R + 2), Math.sin(rad) * (R + 2)); c.lineTo(Math.cos(rad) * (R + 2 + len), Math.sin(rad) * (R + 2 + len)); c.stroke();
      }
      c.beginPath(); c.arc(0, 0, R + 2, 0, 7); c.stroke();
      c.restore();
      // slip/skid + load factor strip
      c.fillStyle = "#9aa4c8"; c.font = "bold 13px sans-serif"; c.textAlign = "center";
      c.fillText(`G ${d.g.toFixed(1)}`, 384, cy + 82);
    }

    // ---------------- altimeter ----------------
    {
      const cx = 640;
      c.save(); c.translate(cx, cy);
      c.fillStyle = "#10131d"; c.beginPath(); c.arc(0, 0, R + 10, 0, 7); c.fill();
      c.strokeStyle = "#3a4160"; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, R + 10, 0, 7); c.stroke();
      const altU = metric ? d.alt : d.alt * 3.28084;
      const range = metric ? 1000 : 1000;
      c.strokeStyle = "#dfe6ff"; c.fillStyle = "#dfe6ff"; c.font = "bold 16px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 6.283 - Math.PI / 2;
        c.lineWidth = 2; c.beginPath(); c.moveTo(Math.cos(a) * (R - 10), Math.sin(a) * (R - 10)); c.lineTo(Math.cos(a) * (R - 24), Math.sin(a) * (R - 24)); c.stroke();
        c.fillText(String(i), Math.cos(a) * (R - 42), Math.sin(a) * (R - 42));
      }
      const hand = (v: number, len: number, w: number, col: string) => { const a = v * 6.283 - Math.PI / 2; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * len, Math.sin(a) * len); c.stroke(); };
      hand((altU / (range * 10)) % 1, R * 0.44, 7, "#ffffff");
      hand((altU / range) % 1, R * 0.68, 5, "#ffb04d");
      hand(((altU % 100) / 100), R * 0.88, 3, "#9fe8ff");
      c.fillStyle = "#9aa4c8"; c.font = "bold 13px sans-serif";
      c.fillText(`ALT ${metric ? "×100 M" : "×100 FT"}`, 0, 54);
      c.restore();
      // digital altitude (same number the HUD shows) + radio altimeter
      c.fillStyle = "#10131d"; c.fillRect(cx - 62, cy + 68, 124, 26);
      c.strokeStyle = "#3a4160"; c.lineWidth = 2; c.strokeRect(cx - 62, cy + 68, 124, 26);
      c.fillStyle = "#9fe8ff"; c.font = "bold 20px sans-serif"; c.textAlign = "center";
      c.fillText(`${alt.v}`, cx - 14, cy + 82);
      c.fillStyle = "#7f8bb0"; c.font = "bold 12px sans-serif"; c.textAlign = "left";
      c.fillText(alt.unit, cx + 30, cy + 82);
    }

    // ---------------- heading strip + engine + trim ----------------
    {
      // compass ribbon, exactly the heading the HUD prints
      const cx = 862;
      c.save(); c.translate(cx, cy - 26);
      c.fillStyle = "#10131d"; c.fillRect(-118, -34, 236, 68);
      c.strokeStyle = "#3a4160"; c.lineWidth = 2; c.strokeRect(-118, -34, 236, 68);
      const hdg = ((d.hdg % 360) + 360) % 360;
      c.save(); c.beginPath(); c.rect(-116, -32, 232, 64); c.clip();
      c.strokeStyle = "#8a95b8"; c.fillStyle = "#dfe6ff"; c.lineWidth = 2; c.textAlign = "center"; c.textBaseline = "middle";
      const lbl = (n: number) => (n % 90 === 0 ? ["N", "E", "S", "W"][n / 90] : String(n / 10));
      for (let k = -8; k <= 8; k++) {
        const deg = Math.round((hdg + k * 10) / 10) * 10;
        const x = (deg - hdg) * 2.2;
        if (x < -120 || x > 120) continue;
        c.beginPath(); c.moveTo(x, 22); c.lineTo(x, deg % 30 === 0 ? 8 : 15); c.stroke();
        if (deg % 30 === 0) { c.font = "bold 15px sans-serif"; c.fillText(lbl(((deg % 360) + 360) % 360), x, -4); }
      }
      c.restore();
      c.strokeStyle = "#ffcf3d"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, 30); c.lineTo(-7, 20); c.lineTo(7, 20); c.closePath(); c.stroke();
      c.fillStyle = "#ffcf3d"; c.font = "bold 22px sans-serif"; c.fillText(hdgText(d.hdg), 0, -18);
      c.restore();

      // engine / configuration block
      c.textAlign = "left"; c.textBaseline = "middle";
      const bx = 762, by = cy + 44;
      c.fillStyle = "#10131d"; c.fillRect(bx, by, 216, 74);
      c.strokeStyle = "#3a4160"; c.lineWidth = 2; c.strokeRect(bx, by, 216, 74);
      c.font = "bold 13px sans-serif"; c.fillStyle = "#8a95b8"; c.fillText("POWER", bx + 10, by + 16);
      c.fillStyle = "#1a2236"; c.fillRect(bx + 70, by + 8, 120, 14);
      c.fillStyle = d.thr > 0.9 ? "#ff9d5c" : "#ffb04d"; c.fillRect(bx + 70, by + 8, 120 * Math.max(0, Math.min(1, d.thr)), 14);
      c.fillStyle = "#ffb04d"; c.textAlign = "right"; c.fillText(`${Math.round(d.thr * 100)}%`, bx + 206, by + 16);
      c.textAlign = "left";
      c.fillStyle = "#8a95b8"; c.fillText("FLAPS", bx + 10, by + 38);
      c.fillStyle = d.flaps > 0 ? "#6dffb0" : "#5a6488";
      c.textAlign = "right"; c.fillText(["UP", "TO", "LDG"][Math.round(d.flaps)] ?? "UP", bx + 206, by + 38);
      c.textAlign = "left"; c.fillStyle = "#8a95b8"; c.fillText("V/S", bx + 10, by + 60);
      c.fillStyle = Math.abs(vs.v) > 0.5 ? (vs.v > 0 ? "#6dffb0" : "#ffb04d") : "#dfe6ff";
      c.textAlign = "right"; c.fillText(vs.text, bx + 206, by + 60);

      // radio altimeter + stall reference, left column
      c.textAlign = "left";
      const lx = 44, ly = cy + 44;
      c.fillStyle = "#10131d"; c.fillRect(lx, ly, 216, 74);
      c.strokeStyle = "#3a4160"; c.lineWidth = 2; c.strokeRect(lx, ly, 216, 74);
      c.font = "bold 13px sans-serif"; c.fillStyle = "#8a95b8"; c.fillText("RADIO ALT", lx + 10, ly + 16);
      c.fillStyle = d.agl < 30 ? "#ff5d6e" : "#9fe8ff"; c.textAlign = "right";
      c.fillText(`${hgt.v} ${hgt.unit}`, lx + 206, ly + 16);
      c.textAlign = "left"; c.fillStyle = "#8a95b8"; c.fillText("PITCH", lx + 10, ly + 38);
      c.fillStyle = "#dfe6ff"; c.textAlign = "right"; c.fillText(`${d.pitch > 0 ? "+" : ""}${d.pitch.toFixed(0)}°`, lx + 206, ly + 38);
      c.textAlign = "left"; c.fillStyle = "#8a95b8"; c.fillText("BANK", lx + 10, ly + 60);
      c.fillStyle = Math.abs(d.bank) > 35 ? "#ffb04d" : "#dfe6ff"; c.textAlign = "right";
      c.fillText(`${d.bank > 0 ? "R" : "L"}${Math.abs(d.bank).toFixed(0)}°`, lx + 206, ly + 60);

      // stall margin tape between the two blocks
      const tx = 300, tw = 380;
      c.fillStyle = "#10131d"; c.fillRect(tx, cy + 68, tw, 26);
      c.strokeStyle = "#3a4160"; c.lineWidth = 2; c.strokeRect(tx, cy + 68, tw, 26);
      const margin = d.ias / Math.max(1, d.vStall);
      const frac = Math.max(0, Math.min(1, (margin - 1) / 1.4));
      c.fillStyle = margin < 1.15 ? "#ff5d6e" : margin < 1.35 ? "#ffd23d" : "#4dff9d";
      c.fillRect(tx + 4, cy + 72, (tw - 8) * frac, 18);
      c.fillStyle = "#c8d2f0"; c.font = "bold 13px sans-serif"; c.textAlign = "left";
      c.fillText(`STALL MARGIN  ${margin.toFixed(2)} × Vs`, tx + 12, cy + 82);
    }
    this.tex.needsUpdate = true;
  }
}

export type { Units };
