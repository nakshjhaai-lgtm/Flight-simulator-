import * as THREE from "three";

export interface InstData {
  ias: number; // m/s
  alt: number; // m
  vs: number; // m/s
  hdg: number; pitch: number; bank: number;
  thr: number; flaps: number; g: number;
  vStall: number; vFlapStall: number; vMax: number;
}

type Style = "ga" | "jet" | "liner" | "glider";

const cfg: Record<Style, { w: number; panelY: number; panelZ: number; roof: number; side: number; yoke: number; scale: number; tint: string }> = {
  ga: { w: 1.25, panelY: -0.4, panelZ: -0.8, roof: 0.62, side: 0.62, yoke: 1, scale: 1, tint: "#26242b" },
  glider: { w: 0.8, panelY: -0.36, panelZ: -0.7, roof: 0.7, side: 0.45, yoke: 2, scale: 0.85, tint: "#2a2d33" },
  jet: { w: 1.55, panelY: -0.46, panelZ: -0.9, roof: 0.68, side: 0.8, yoke: 1, scale: 1.15, tint: "#1d2028" },
  liner: { w: 2.2, panelY: -0.6, panelZ: -1.1, roof: 0.8, side: 1.15, yoke: 3, scale: 1.5, tint: "#20242c" },
};

/** Cockpit interior built around the pilot eye (local origin = eye, -Z forward). */
export class Cockpit {
  group = new THREE.Group();
  canvas = document.createElement("canvas");
  tex: THREE.CanvasTexture;
  yoke = new THREE.Group();
  ctx: CanvasRenderingContext2D;
  light = new THREE.Color(1, 1, 1);
  mats: THREE.MeshStandardMaterial[] = [];
  glow: THREE.MeshBasicMaterial;
  private acc = 0;

  constructor(style: Style, accent: string) {
    const c = cfg[style];
    const S = c.scale;
    this.canvas.width = 768; this.canvas.height = 256;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    const dark = new THREE.MeshStandardMaterial({ color: c.tint, roughness: 0.78, metalness: 0.1 });
    const trim = new THREE.MeshStandardMaterial({ color: "#3b3f4d", roughness: 0.5, metalness: 0.4 });
    const accentM = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, emissive: accent, emissiveIntensity: 0.25 });
    this.mats.push(dark, trim, accentM);
    const g = this.group;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me;
    };
    // dashboard body (slanted top)
    const dash = new THREE.Shape();
    dash.moveTo(0, 0); dash.lineTo(0.5 * S, 0); dash.lineTo(0.5 * S, 0.14 * S); dash.lineTo(0.12 * S, 0.3 * S); dash.lineTo(0, 0.3 * S);
    const dg = new THREE.ExtrudeGeometry(dash, { depth: c.w * 2 + 0.3, bevelEnabled: false });
    dg.rotateY(Math.PI / 2); dg.translate(-(c.w + 0.15), 0, 0);
    const dashM = add(dg, dark, 0, c.panelY - 0.32 * S, c.panelZ + 0.18 * S * 0, 0, 0, 0);
    dashM.rotation.y = Math.PI; dashM.position.set(c.w + 0.15, c.panelY - 0.32 * S, c.panelZ - 0.18 * S * 0 + 0.5 * S);
    dashM.rotation.y = 0;
    // fix orientation: after rotateY the extrude depth runs along X, shape along Z (flip so slope faces pilot)
    dashM.scale.z = -1; dashM.position.set(0, c.panelY - 0.32 * S, c.panelZ + 0.15 * S);
    // instrument panel face
    const panelW = Math.min(c.w * 1.5, 1.5 * S + 0.25);
    this.glow = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    const panel = add(new THREE.PlaneGeometry(panelW, panelW / 3), this.glow, 0, c.panelY - 0.02 * S + 0.0, c.panelZ + 0.17 * S, -0.55, 0, 0);
    void panel;
    // glare shield
    add(new THREE.BoxGeometry(c.w * 2 + 0.2, 0.045, 0.34 * S), dark, 0, c.panelY + 0.1 * S, c.panelZ - 0.05 * S, 0.2, 0, 0);
    add(new THREE.BoxGeometry(c.w * 2 + 0.2, 0.02, 0.03), accentM, 0, c.panelY + 0.12 * S, c.panelZ - 0.21 * S, 0.2, 0, 0);
    // side sills + door panels
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.16, 0.12, 1.9 * S), dark, s * (c.side + 0.05), -0.32 * S, -0.1 - 0.0, 0, 0, 0);
      add(new THREE.BoxGeometry(0.06, 0.55 * S, 1.9 * S), dark, s * (c.side + 0.1), -0.6 * S, -0.1, 0, 0, 0);
      // A-pillars
      add(new THREE.BoxGeometry(0.07, 0.8 * S, 0.1), trim, s * (c.side * 0.88), 0.05 * S, c.panelZ - 0.1 * S, 0.0, 0, -s * 0.35);
      // B-pillar
      add(new THREE.BoxGeometry(0.1, 0.9 * S, 0.14), dark, s * (c.side + 0.04), 0.1, 0.55 * S, 0, 0, 0);
    }
    // roof / header
    add(new THREE.BoxGeometry(c.w * 2 + 0.2, 0.05, 1.2 * S), dark, 0, c.roof, 0.3 * S, 0, 0, 0);
    add(new THREE.BoxGeometry(c.w * 2 + 0.2, 0.08 * S, 0.08), dark, 0, c.roof - 0.04, c.panelZ - 0.3 * S, 0.25, 0, 0);
    // seat back hint & floor
    add(new THREE.BoxGeometry(c.w * 2 + 0.2, 0.05, 2), dark, 0, -0.95 * S, 0, 0, 0, 0);
    add(new THREE.BoxGeometry(0.5, 0.65, 0.12), new THREE.MeshStandardMaterial({ color: "#3a2f3a", roughness: 0.9 }), 0, -0.45, 0.45, 0.1, 0, 0);
    // centre console / throttle quadrant
    add(new THREE.BoxGeometry(0.2 * S, 0.12, 0.7 * S), dark, 0, -0.62 * S, c.panelZ + 0.55 * S);
    const lever = add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), trim, -0.03, -0.52 * S, c.panelZ + 0.55 * S, 0.6, 0, 0);
    void lever;
    add(new THREE.SphereGeometry(0.025, 10, 8), accentM, -0.03, -0.45 * S, c.panelZ + 0.5 * S);
    // yoke / stick
    this.yoke.position.set(c.yoke === 3 ? -0.35 * S : 0, -0.42 * S, c.panelZ + 0.5 * S);
    if (c.yoke === 2) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.4, 8), trim); st.position.y = 0.17; this.yoke.add(st);
      const gr = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), accentM); gr.position.y = 0.38; this.yoke.add(gr);
    } else {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 8), trim); col.rotation.x = Math.PI / 2; col.position.z = 0.22; this.yoke.add(col);
      const wheel = new THREE.Group(); wheel.position.set(0, 0.04, 0.0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15 * S, 0.016, 8, 24), dark); ring.rotation.x = Math.PI * 0.5 * 0 + 0.0; wheel.add(ring);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.32 * S, 0.03, 0.03), dark); wheel.add(bar);
      const gripL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), accentM); gripL.position.set(-0.15 * S, 0, 0); wheel.add(gripL);
      const gripR = gripL.clone(); gripR.position.x = 0.15 * S; wheel.add(gripR);
      this.yoke.add(wheel); this.yoke.userData.wheel = wheel;
      this.yoke.rotation.x = -0.15;
    }
    g.add(this.yoke);
    g.traverse((o) => { o.frustumCulled = false; });
    g.visible = false;
  }

  setLight(brightness: number) { this.light.setScalar(brightness); this.glow.color.copy(this.light); }

  update(dt: number, d: InstData, pitchIn: number, rollIn: number) {
    const w = this.yoke.userData.wheel as THREE.Group | undefined;
    if (w) { w.rotation.z += (-rollIn * 1.1 - w.rotation.z) * Math.min(1, dt * 12); this.yoke.position.z += (((this.yoke.userData.baseZ ??= this.yoke.position.z) + pitchIn * 0.06) - this.yoke.position.z) * Math.min(1, dt * 10); }
    else { this.yoke.rotation.z += (-rollIn * 0.4 - this.yoke.rotation.z) * Math.min(1, dt * 12); this.yoke.rotation.x += (-pitchIn * 0.4 - this.yoke.rotation.x) * Math.min(1, dt * 12); }
    this.acc += dt;
    if (this.acc < 1 / 14) return;
    this.acc = 0;
    this.draw(d);
  }

  private draw(d: InstData) {
    const c = this.ctx, W = 768, H = 256;
    c.fillStyle = "#0b0d14"; c.fillRect(0, 0, W, H);
    const kts = d.ias * 1.944;
    const cy = 122;
    // ---- airspeed (left)
    const R = 100;
    const asi = (cx: number) => {
      c.save(); c.translate(cx, cy);
      c.fillStyle = "#12151f"; c.beginPath(); c.arc(0, 0, R + 8, 0, 7); c.fill();
      const vmax = Math.max(160, d.vMax * 1.944);
      const ang = (v: number) => -2.2 + (Math.min(v, vmax) / vmax) * 4.4;
      const band = (a: number, b: number, col: string) => { c.strokeStyle = col; c.lineWidth = 9; c.beginPath(); c.arc(0, 0, R - 8, ang(a) - Math.PI / 2, ang(b) - Math.PI / 2); c.stroke(); };
      band(0, d.vStall * 1.944, "#ff4d5e"); band(d.vStall * 1.944, d.vStall * 1.944 * 1.3, "#ffd23d"); band(d.vStall * 1.944 * 1.3, vmax * 0.85, "#4dff9d");
      c.strokeStyle = "#dfe6ff"; c.fillStyle = "#dfe6ff"; c.font = "bold 15px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      for (let v = 0; v <= vmax; v += 20) { const a = ang(v) - Math.PI / 2; c.lineWidth = 2; c.beginPath(); c.moveTo(Math.cos(a) * (R - 22), Math.sin(a) * (R - 22)); c.lineTo(Math.cos(a) * (R - 32), Math.sin(a) * (R - 32)); c.stroke(); if (v % 40 === 0) c.fillText(String(v), Math.cos(a) * (R - 48), Math.sin(a) * (R - 48)); }
      const a = ang(kts) - Math.PI / 2; c.strokeStyle = "#ffb04d"; c.lineWidth = 5; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * (R - 18), Math.sin(a) * (R - 18)); c.stroke();
      c.fillStyle = "#ffb04d"; c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill();
      c.fillStyle = "#9aa4c8"; c.font = "bold 13px sans-serif"; c.fillText("KNOTS", 0, 52);
      c.restore();
    };
    asi(128);
    // ---- attitude (centre)
    c.save(); c.translate(384, cy);
    c.beginPath(); c.arc(0, 0, R + 8, 0, 7); c.fillStyle = "#12151f"; c.fill(); c.clip();
    c.rotate((-d.bank * Math.PI) / 180);
    const py = (d.pitch * 4.2);
    c.translate(0, py);
    c.fillStyle = "#4aa3ff"; c.fillRect(-200, -400, 400, 400);
    c.fillStyle = "#9a6a3c"; c.fillRect(-200, 0, 400, 400);
    c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.moveTo(-200, 0); c.lineTo(200, 0); c.stroke();
    c.font = "bold 13px sans-serif"; c.fillStyle = "#fff"; c.textAlign = "center";
    for (let p = -30; p <= 30; p += 10) { if (!p) continue; const y = -p * 4.2; const w = p % 20 === 0 ? 40 : 22; c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke(); if (p % 20 === 0) { c.fillText(String(Math.abs(p)), -w - 14, y + 4); c.fillText(String(Math.abs(p)), w + 14, y + 4); } }
    c.restore();
    c.save(); c.translate(384, cy); c.strokeStyle = "#ffcf3d"; c.lineWidth = 5; c.beginPath(); c.moveTo(-60, 0); c.lineTo(-20, 0); c.lineTo(-20, 10); c.moveTo(60, 0); c.lineTo(20, 0); c.lineTo(20, 10); c.stroke(); c.fillStyle = "#ffcf3d"; c.beginPath(); c.arc(0, 0, 4, 0, 7); c.fill();
    c.strokeStyle = "#e8eeff"; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, R + 4, 0, 7); c.stroke(); c.restore();
    // ---- altimeter (right)
    c.save(); c.translate(640, cy);
    c.fillStyle = "#12151f"; c.beginPath(); c.arc(0, 0, R + 8, 0, 7); c.fill();
    const ft = d.alt * 3.281;
    c.strokeStyle = "#dfe6ff"; c.fillStyle = "#dfe6ff"; c.font = "bold 17px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283 - Math.PI / 2; c.lineWidth = 2; c.beginPath(); c.moveTo(Math.cos(a) * (R - 12), Math.sin(a) * (R - 12)); c.lineTo(Math.cos(a) * (R - 26), Math.sin(a) * (R - 26)); c.stroke(); c.fillText(String(i), Math.cos(a) * (R - 44), Math.sin(a) * (R - 44)); }
    const hand = (v: number, len: number, w: number, col: string) => { const a = v * 6.283 - Math.PI / 2; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * len, Math.sin(a) * len); c.stroke(); };
    hand((ft / 10000) % 1, R * 0.45, 7, "#ffffff"); hand((ft / 1000) % 1, R * 0.68, 5, "#ffb04d"); hand((ft / 100) % 1, R * 0.88, 3, "#9fe8ff");
    c.fillStyle = "#9aa4c8"; c.font = "bold 13px sans-serif"; c.fillText("ALT  FT", 0, 54);
    c.restore();
    // ---- strip: heading, vs, throttle
    c.fillStyle = "#171b29"; c.fillRect(250, 236, 268, 16);
    c.fillStyle = "#9fe8ff"; c.font = "bold 15px sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
    c.fillText(`HDG ${Math.round(d.hdg).toString().padStart(3, "0")}°`, 258, 244);
    c.fillText(`VS ${Math.round(d.vs * 196.85)} fpm`, 350, 244);
    c.fillStyle = "#ffb04d"; c.fillText(`THR ${Math.round(d.thr * 100)}%`, 456, 244);
    this.tex.needsUpdate = true;
  }
}
