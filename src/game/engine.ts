import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AircraftDef, getAircraft } from "./aircraftDefs";
import { MODEL_URLS } from "./modelUrls";
import { buildAircraft } from "./aircraftMesh";
import { FlightModel, RHO0, G } from "./flight";
import { InstrumentData } from "./instruments";
import { World, TODS, glowTex } from "./world";
import { getMap, TodId, MapDef } from "./terrain";
import { Cockpit } from "./cockpit";
import { SpaceWorld, RangerSim, buildRanger, RangerCockpit, DockState } from "./space";
import { AudioSys } from "./audio";

export interface Settings {
  quality: 0 | 1 | 2; units: "metric" | "imperial"; assist: boolean; invertPitch: boolean; sensitivity: number; sound: boolean; shake: boolean;
}
export const defaultSettings = (): Settings => ({ quality: 1, units: "metric", assist: true, invertPitch: false, sensitivity: 1, sound: true, shake: true });

export type MissionId = "school" | "route" | "free";
export interface LaunchOpts { mode: "air" | "space"; map: string; tod: TodId; aircraft: string; mission: MissionId }

export interface Marker { x: number; y: number; vis: boolean; edge: number; dist: number; label: string }
export interface Hud {
  kind: "air" | "space"; phase: "menu" | "playing" | "paused" | "ended";
  speed: number; alt: number; vs: number; hdg: number; thr: number; flaps: number; pitch: number; bank: number; g: number;
  vStall: number; vFlap: number; vMax: number;
  state: string; warn: string; warnLevel: 0 | 1 | 2; objective: string; progress: string;
  assist: boolean; camera: string; marker: Marker | null; hint: { text: string; tone: "ok" | "warn" | "bad" } | null;
  tut: { i: number; n: number; title: string; text: string; hl: string; done: boolean } | null;
  space: { dock: DockState; spin: number; speed: number } | null;
  stickX: number; stickY: number; fps: number; time: number; score: number; hasFlaps: boolean; engineRun: boolean;
}
export interface Result {
  kind: "landed" | "crashed" | "docked" | "complete"; title: string; sub: string; lines: { label: string; value: string; pts?: number }[]; score: number; stars: number; best: number; mission: MissionId; key: string;
}

interface TutStep { title: string; text: string; hl: string; check: () => boolean; hold?: number }

const loader = new GLTFLoader();
const tpl = new Map<string, THREE.Group>();
const CAMS = ["Chase", "Cockpit", "Orbit", "Tower"];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function floatGeo(g: THREE.BufferGeometry) {
  const n = new THREE.BufferGeometry();
  const pos = g.getAttribute("position");
  for (const name of ["position", "normal", "uv"]) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) { arr[i * a.itemSize] = a.getX(i); arr[i * a.itemSize + 1] = a.getY(i); if (a.itemSize > 2) arr[i * a.itemSize + 2] = a.getZ(i); }
    n.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (!n.getAttribute("uv")) n.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  if (g.index) n.setIndex(g.index.clone()); else { const ix = new Uint32Array(pos.count); for (let i = 0; i < ix.length; i++) ix[i] = i; n.setIndex(new THREE.BufferAttribute(ix, 1)); }
  if (!n.getAttribute("normal")) n.computeVertexNormals();
  return n;
}

async function loadModel(def: AircraftDef): Promise<THREE.Group> {
  if (tpl.has(def.id)) return tpl.get(def.id)!.clone(true);
  const procedural = () => {
    const p = buildAircraft(def, "#e2564f");
    tpl.set(def.id, p);
    return p.clone(true);
  };
  let gltf;
  try {
    gltf = await loader.loadAsync(MODEL_URLS[def.id]);
  } catch (err) {
    // The .glb files in this repo are not parseable (see tools/verify-assets.mjs). Rather than
    // leaving the player with an invisible aeroplane and no flight model, fly the stand-in.
    console.warn(`[Liminal Wings] ${def.id}.glb could not be loaded, using the procedural airframe:`, (err as Error)?.message ?? err);
    return procedural();
  }
  const src = gltf.scene; src.updateMatrixWorld(true);
  const out = new THREE.Group();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kept: THREE.Mesh[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    if (def.keep.test(m.name) || (m.parent && def.keep.test(m.parent.name)) || def.hideInCockpit?.test(m.name)) { kept.push(m); return; }
    const mt = Array.isArray(m.material) ? m.material[0] : m.material;
    const g = floatGeo(m.geometry); g.applyMatrix4(m.matrixWorld);
    (byMat.get(mt) ?? byMat.set(mt, []).get(mt)!).push(g);
  });
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  byMat.forEach((geos, mat) => {
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (!merged) return;
    const me = new THREE.Mesh(merged, mat);
    const std = mat as THREE.MeshStandardMaterial;
    if (std.isMeshStandardMaterial) {
      if (std.map) std.map.anisotropy = 8;
      std.envMapIntensity = 1.1;
      if (std.metalness > 0.7 && !std.metalnessMap) std.metalness = 0.7;
      if (std.transparent || /glass|vitre|window|canopy|verre/i.test(std.name)) { me.userData.glass = true; me.castShadow = false; std.depthWrite = false; }
      else me.castShadow = true;
    }
    out.add(me);
  });
  for (const m of kept) { out.attach(m); m.castShadow = true; const mt = m.material as THREE.MeshStandardMaterial; if (mt?.transparent) m.userData.glass = true; }
  out.updateMatrixWorld(true);
  tpl.set(def.id, out);
  return out.clone(true);
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(62, 1, 0.5, 130000);
  settings: Settings = defaultSettings();
  hud: Hud;
  onHud: (h: Hud) => void; onEvent: (e: { type: string; result?: Result; text?: string }) => void;
  audio = new AudioSys();
  kind: "air" | "space" = "air";
  phase: Hud["phase"] = "menu";
  opts!: LaunchOpts;
  world: World | null = null; map!: MapDef;
  def!: AircraftDef; fm!: FlightModel;
  acRoot = new THREE.Group(); modelRoot = new THREE.Group(); cockpit: Cockpit | null = null;
  navLights: THREE.Points | null = null; spinParts: { o: THREE.Object3D; axis: "x" | "y" | "z"; rate: number; kind: number }[] = [];
  glassMeshes: THREE.Object3D[] = [];
  // space
  space: SpaceWorld | null = null; ranger: RangerSim | null = null; rangerMesh: THREE.Group | null = null; rangerCockpit: RangerCockpit | null = null;
  // loop
  private raf = 0; private last = 0; private acc = 0; private running = false;
  private prevPos = new THREE.Vector3(); private prevQ = new THREE.Quaternion();
  private pos = new THREE.Vector3(); private quat = new THREE.Quaternion();
  camMode = 0; private chaseQ = new THREE.Quaternion(); private chasePos = new THREE.Vector3(); private camInit = false;
  orbit = { az: 0.6, el: 0.25, r: 1 }; look = { yaw: 0, pitch: 0 };
  private shake = 0; private fovCur = 62;
  // input
  keys = new Set<string>();
  touch = { x: 0, y: 0, yaw: 0, brake: false, rx: 0, ry: 0, rz: 0 };
  private kb = { pitch: 0, roll: 0, yaw: 0 };
  throttle = 0; flapsDetent = 0;
  private lastHud = 0; private fpsAcc = 0; private fpsN = 0; fps = 60; private adaptT = 0;
  maxPR = 1.5; minPR = 0.8; pr = 1;
  // mission
  mission: MissionId = "free"; private mStart = 0; gateIdx = 0; private prevS = 0; passed = 0; stalls = 0; private stallLatch = false;
  private tdInfo: { sink: number; off: number; speed: number; onRunway: boolean; bank: number } | null = null; private stoppedT = 0;
  private liftedOff = false; private endT = 0; private ended = false; scoreLive = 0; private missionDone = false;
  tutI = 0; private tutHold = 0; private tutDone = 0; private tutSteps: TutStep[] = []; private tutMem: Record<string, number> = {};
  private startTime = 0; private simTime = 0;
  private resizeObs: ResizeObserver | null = null;
  private tmpV = new THREE.Vector3(); private tmpV2 = new THREE.Vector3(); private tmpQ = new THREE.Quaternion(); private tmpM = new THREE.Matrix4();

  constructor(public canvas: HTMLCanvasElement, onHud: (h: Hud) => void, onEvent: Engine["onEvent"]) {
    this.onHud = onHud; this.onEvent = onEvent;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.hud = this.blankHud();
    this.camera.rotation.order = "YXZ";
    window.addEventListener("keydown", this.onKey); window.addEventListener("keyup", this.onKeyUp); window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVis);
    this.resizeObs = new ResizeObserver(() => this.resize()); this.resizeObs.observe(canvas.parentElement ?? canvas);
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 250));
    this.applyQuality();
    this.resize();
  }

  blankHud(): Hud {
    return { kind: "air", phase: "menu", speed: 0, alt: 0, vs: 0, hdg: 0, thr: 0, flaps: 0, pitch: 0, bank: 0, g: 1, vStall: 20, vFlap: 18, vMax: 80, state: "", warn: "", warnLevel: 0, objective: "", progress: "", assist: true, camera: "Chase", marker: null, hint: null, tut: null, space: null, stickX: 0, stickY: 0, fps: 60, time: 0, score: 0, hasFlaps: true, engineRun: false };
  }

  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const q = this.settings.quality;
    this.maxPR = Math.min(dpr, q === 2 ? 2.2 : q === 1 ? 1.75 : 1.25);
    this.minPR = Math.min(this.maxPR, q === 0 ? 0.7 : 0.9);
    this.pr = Math.min(this.maxPR, Math.max(this.minPR, this.pr || this.maxPR));
    this.renderer.setPixelRatio(this.pr);
    this.renderer.shadowMap.enabled = q > 0;
    this.resize();
  }

  resize() {
    const p = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(2, p.clientWidth), h = Math.max(2, p.clientHeight);
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ loading
  async load(opts: LaunchOpts, progress?: (p: number, label: string) => void) {
    this.stopLoop();
    this.disposeWorld();
    this.opts = opts; this.kind = opts.mode; this.mission = opts.mission;
    this.phase = "menu"; this.ended = false;
    const wait = () => new Promise((r) => setTimeout(r, 30));
    progress?.(0.1, "Painting the sky"); await wait();
    if (opts.mode === "space") {
      this.space = new SpaceWorld(this.settings.quality);
      this.ranger = new RangerSim(this.space);
      this.rangerMesh = buildRanger(); this.space.scene.add(this.rangerMesh);
      this.rangerCockpit = new RangerCockpit(); this.rangerMesh.add(this.rangerCockpit.group);
      this.rangerCockpit.group.position.set(0, 0.7, -3.4);
      this.rangerCockpit.group.visible = false;
      this.rangerMesh.userData.eye = new THREE.Vector3(0, 0.7, -3.4);
      this.camera.far = 40000;
      this.hud.hasFlaps = false;
      this.buildSpaceTutorial();
      progress?.(0.9, "Spinning up Endurance"); await wait();
    } else {
      this.map = getMap(opts.map);
      this.def = getAircraft(opts.aircraft);
      progress?.(0.2, "Raising islands"); await wait();
      this.world = new World(this.map, opts.tod, this.settings.quality, this.renderer);
      this.camera.far = 130000;
      progress?.(0.6, "Rolling out the " + this.def.name); await wait();
      await this.mountAircraft(this.def);
      this.hud.hasFlaps = true;
      this.buildAirTutorial();
    }
    progress?.(1, "Ready");
    this.resetMission();
    this.startLoop();
  }

  async swapAircraft(id: string) {
    if (this.kind !== "air" || !this.world) return;
    this.def = getAircraft(id); this.opts.aircraft = id;
    await this.mountAircraft(this.def);
    this.resetMission();
  }

  async swapTod(tod: TodId) {
    if (!this.world) return;
    this.opts.tod = tod; this.world.setTod(tod);
  }

  private async mountAircraft(def: AircraftDef) {
    const w = this.world!;
    if (this.acRoot.parent) this.acRoot.parent.remove(this.acRoot);
    this.acRoot = new THREE.Group(); this.modelRoot = new THREE.Group(); this.spinParts = []; this.glassMeshes = [];
    const model = await loadModel(def);
    this.fm = new FlightModel(def, w.ground);
    this.fm.wind.set(Math.sin((this.map.wind.dir * Math.PI) / 180 + Math.PI) * this.map.wind.speed, 0, -Math.cos((this.map.wind.dir * Math.PI) / 180 + Math.PI) * this.map.wind.speed);
    this.fm.turb = this.map.turbulence;
    this.modelRoot.add(model);
    this.modelRoot.quaternion.copy(this.fm.yawQ);
    this.modelRoot.position.copy(this.fm.cgOffset).negate().applyQuaternion(this.fm.yawQ);
    this.acRoot.add(this.modelRoot);
    model.traverse((o) => {
      if (o.userData.glass) this.glassMeshes.push(o);
      for (const s of def.spin) if (s.re.test(o.name)) this.spinParts.push({ o, axis: s.axis, rate: s.rate, kind: /blur|disc/i.test(o.name) ? 1 : 0 });
    });
    // navigation lights
    const hp = this.fm.hull;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([hp[0].x, hp[0].y + 0.1, hp[0].z, hp[1].x, hp[1].y + 0.1, hp[1].z, hp[3].x, hp[3].y + 0.2, hp[3].z, hp[3].x, hp[3].y + 0.2, hp[3].z], 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute([1, 0.1, 0.1, 0.1, 1, 0.2, 1, 1, 1, 1, 0.4, 0.4], 3));
    const size = Math.max(0.5, def.bounds.span * 0.045);
    this.navLights = new THREE.Points(g, new THREE.PointsMaterial({ size, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }));
    this.navLights.frustumCulled = false; this.acRoot.add(this.navLights);
    // cockpit
    this.cockpit = new Cockpit(def.cockpit, this.map.accent);
    this.cockpit.group.position.copy(this.fm.eyeBody);
    this.acRoot.add(this.cockpit.group);
    w.scene.add(this.acRoot);
    this.acRoot.traverse((o) => { o.frustumCulled = o === this.navLights ? false : o.frustumCulled; });
    this.placeOnRunway();
    // settle gear
    for (let i = 0; i < 180; i++) this.fm.step(1 / 120);
    this.fm.ctl.brake = 1;
    this.syncVisual(1);
  }

  private placeOnRunway() {
    const w = this.world!, s = w.spawn;
    this.fm.place(s.x, s.z, s.hdg, s.y);
    this.fm.ctl.assist = this.settings.assist;
    this.throttle = 0; this.flapsDetent = this.def.phys.startFlaps; this.fm.ctl.flaps = this.flapsDetent;
    this.prevPos.copy(this.fm.pos); this.prevQ.copy(this.fm.quat);
  }

  // ------------------------------------------------------------------ mission control
  resetMission() {
    this.gateIdx = 0; this.passed = 0; this.stalls = 0; this.tdInfo = null; this.stoppedT = 0; this.liftedOff = false; this.endT = 0; this.ended = false; this.missionDone = false;
    this.tutI = 0; this.tutHold = 0; this.tutDone = 0; this.tutMem = {}; this.simTime = 0; this.scoreLive = 0; this.prevS = 0; this.camInit = false;
    this.camMode = 0; this.look.yaw = this.look.pitch = 0;
    if (this.kind === "air" && this.world) {
      this.placeOnRunway();
      for (let i = 0; i < 150; i++) this.fm.step(1 / 120);
      this.fm.ctl.brake = 1; this.fm.crashed = false;
      this.world.gates.forEach((g) => { g.passed = false; g.mesh.visible = false; });
      if (this.mission !== "free") this.updateGateVis();
      this.syncVisual(1);
    } else if (this.kind === "space" && this.ranger) {
      this.ranger.reset(); this.space!.angle = 0; this.throttle = 0;
    }
    this.acc = 0;
  }

  private updateGateVis() {
    const w = this.world!;
    w.gates.forEach((g, i) => {
      const active = i === this.gateIdx && this.mission !== "free" && !this.tutGateOff(), next = i === this.gateIdx + 1 && this.mission === "route";
      g.mesh.visible = active || next;
      g.mesh.children[1].visible = active; g.mesh.children[2].visible = active;
    });
  }
  private tutGateOff() { return this.mission === "school" && this.gateIdx > 0; }

  start() {
    if (this.phase === "playing") return;
    this.phase = "playing"; this.startTime = performance.now();
    this.audio.setEnabled(this.settings.sound); this.audio.start();
    this.camMode = this.kind === "space" ? 0 : 0; this.camInit = false;
    if (this.kind === "air") { this.fm.ctl.brake = 0; }
  }
  restart() {
    this.phase = "menu"; this.resetMission(); this.phase = "playing"; this.camInit = false;
    if (this.kind === "air") this.fm.ctl.brake = 0;
  }
  toMenuPreview() { this.phase = "menu"; this.resetMission(); }
  pause(p: boolean) {
    if (p && this.phase === "playing") this.phase = "paused";
    else if (!p && this.phase === "paused") { this.phase = "playing"; this.last = performance.now(); }
    this.audio.setPaused(this.phase !== "playing");
  }
  cycleCamera() { this.camMode = (this.camMode + 1) % CAMS.length; this.look.yaw = this.look.pitch = 0; this.camInit = false; }
  setCamera(i: number) { this.camMode = i; this.camInit = false; }
  cycleFlaps() { if (this.kind !== "air") return; this.flapsDetent = (this.flapsDetent + 1) % 3; this.fm.ctl.flaps = this.flapsDetent; }
  toggleAssist() { this.settings.assist = !this.settings.assist; if (this.fm) this.fm.ctl.assist = this.settings.assist; if (this.ranger) this.ranger.ctl.assist = this.settings.assist; }
  setSettings(s: Partial<Settings>) {
    const qChanged = s.quality !== undefined && s.quality !== this.settings.quality;
    Object.assign(this.settings, s);
    if (qChanged) this.applyQuality();
    if (this.fm) this.fm.ctl.assist = this.settings.assist;
    if (this.ranger) this.ranger.ctl.assist = this.settings.assist;
    this.audio.setEnabled(this.settings.sound);
  }
  setMission(m: MissionId) { this.mission = m; this.resetMission(); }
  setThrottle(v: number) { this.throttle = clamp(v, 0, 1); }
  orbitDrag(dx: number, dy: number) {
    if (this.camMode === 1) { this.look.yaw = clamp(this.look.yaw - dx * 0.006, -2.4, 2.4); this.look.pitch = clamp(this.look.pitch - dy * 0.006, -1.0, 1.0); }
    else { this.orbit.az -= dx * 0.006; this.orbit.el = clamp(this.orbit.el + dy * 0.005, -0.2, 1.3); }
  }
  orbitZoom(f: number) { this.orbit.r = clamp(this.orbit.r * f, 0.5, 3); }

  // ------------------------------------------------------------------ input
  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.code;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(k)) e.preventDefault();
    if (e.repeat) { this.keys.add(k); return; }
    this.keys.add(k);
    if (this.phase === "playing") {
      if (k === "KeyC") this.cycleCamera();
      if (k === "KeyF") this.cycleFlaps();
      if (k === "KeyV") this.toggleAssist();
      if (k === "KeyR") this.restart();
    }
    if (k === "KeyP" || k === "Escape") this.onEvent({ type: "togglePause" });
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onBlur = () => { this.keys.clear(); if (this.phase === "playing") this.onEvent({ type: "autoPause" }); };
  private onVis = () => { if (document.hidden && this.phase === "playing") this.onEvent({ type: "autoPause" }); };

  private readInput(dt: number) {
    const K = this.keys, inv = this.settings.invertPitch ? -1 : 1;
    const sens = this.settings.sensitivity;
    const k = (c: string) => (K.has(c) ? 1 : 0);
    const space = this.kind === "space";
    // keyboard analog ramp
    const tp = (k("KeyS") - k("KeyW") + (space ? 0 : k("ArrowDown") - k("ArrowUp"))) * inv;
    const tr = k("KeyD") - k("KeyA") + (space ? 0 : k("ArrowRight") - k("ArrowLeft"));
    const ty = k("KeyE") - k("KeyQ");
    const ramp = (cur: number, t: number) => cur + clamp(t - cur, -(t === 0 ? 9 : 4.2) * dt, (t === 0 ? 9 : 4.2) * dt);
    this.kb.pitch = ramp(this.kb.pitch, tp); this.kb.roll = ramp(this.kb.roll, tr); this.kb.yaw = ramp(this.kb.yaw, ty);
    const pitch = clamp(this.kb.pitch + this.touch.y * inv * -1 * -1, -1, 1) * 1;
    void pitch;
    // touch stick: y>0 is drag down = pull back = nose up
    const tY = this.touch.y * inv, tX = this.touch.x;
    const P = clamp(this.kb.pitch + tY, -1, 1) * Math.min(1.25, sens), R = clamp(this.kb.roll + tX, -1, 1) * Math.min(1.25, sens), Y = clamp(this.kb.yaw + this.touch.yaw, -1, 1);
    if (K.has("ShiftLeft") || K.has("ShiftRight")) this.throttle = clamp(this.throttle + dt * 0.55, 0, 1);
    if (K.has("ControlLeft") || K.has("ControlRight")) this.throttle = clamp(this.throttle - dt * 0.55, 0, 1);
    const brake = K.has("Space") || this.touch.brake ? 1 : 0;
    if (space && this.ranger) {
      const c = this.ranger.ctl;
      c.pitch = clamp(P, -1, 1); c.roll = clamp(R, -1, 1); c.yaw = Y; c.throttle = this.throttle; c.brake = brake;
      c.tx = clamp(k("ArrowRight") - k("ArrowLeft") + this.touch.rx, -1, 1); c.ty = clamp(k("ArrowUp") - k("ArrowDown") + this.touch.ry, -1, 1);
      c.tz = clamp(k("KeyZ") - k("KeyX") + this.touch.rz, -1, 1); c.assist = this.settings.assist;
    } else if (this.fm) {
      const c = this.fm.ctl;
      c.pitch = clamp(P, -1, 1); c.roll = clamp(R, -1, 1); c.yaw = clamp(Y, -1, 1); c.throttle = this.throttle; c.brake = brake; c.assist = this.settings.assist;
    }
  }

  // ------------------------------------------------------------------ loop
  private startLoop() {
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const frame = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const dtRaw = Math.min(0.1, (t - this.last) / 1000); this.last = t;
      this.tick(dtRaw);
    };
    this.raf = requestAnimationFrame(frame);
  }
  private stopLoop() { this.running = false; cancelAnimationFrame(this.raf); }

  private tick(dt: number) {
    // fps + adaptive resolution
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 1) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.adapt(); }
    const playing = this.phase === "playing";
    if (playing) {
      this.readInput(dt);
      this.acc += dt; let steps = 0; const H = 1 / 120;
      while (this.acc >= H && steps < 8) {
        this.prevPos.copy(this.pos); this.prevQ.copy(this.quat);
        if (this.kind === "air") this.stepAir(H); else this.stepSpace(H);
        this.acc -= H; steps++; this.simTime += H;
      }
      if (steps === 8) this.acc = 0;
      this.updateMission(dt);
    } else if (this.phase === "menu" && this.kind === "air" && this.fm) {
      this.fm.step(1 / 120); this.prevPos.copy(this.pos); this.prevQ.copy(this.quat);
    }
    const alpha = playing ? this.acc * 120 : 1;
    this.syncVisual(alpha);
    this.animate(dt);
    this.updateCamera(dt, playing);
    if (this.kind === "air" && this.world) this.world.update(dt, this.camera, this.pos);
    if (this.kind === "space" && this.space) { this.space.update(this.phase === "paused" ? 0 : dt, this.camera.position); if (this.phase === "menu") { this.space.advance(dt); } }
    const scene = this.kind === "air" ? this.world?.scene : this.space?.scene;
    if (scene) this.renderer.render(scene, this.camera);
    this.audio.update(this.audioState());
    this.lastHud += dt;
    if (this.lastHud > 0.06) { this.lastHud = 0; this.pushHud(); }
  }

  private adapt() {
    this.adaptT++;
    if (this.phase === "paused") return;
    let npr = this.pr;
    if (this.fps < 46 && this.pr > this.minPR) npr = Math.max(this.minPR, this.pr - 0.15);
    else if (this.fps > 57.5 && this.pr < this.maxPR && this.adaptT % 3 === 0) npr = Math.min(this.maxPR, this.pr + 0.1);
    if (Math.abs(npr - this.pr) > 0.01) { this.pr = npr; this.renderer.setPixelRatio(npr); this.resize(); }
  }

  private stepAir(H: number) {
    const fm = this.fm;
    fm.step(H);
    this.pos.copy(fm.pos); this.quat.copy(fm.quat);
    for (const e of fm.events) {
      if (e.type === "touchdown") this.onTouchdown(e);
      else if (e.type === "crash") this.onCrash(e.reason);
      else if (e.type === "liftoff") this.liftedOff = true;
    }
    fm.events.length = 0;
  }
  private stepSpace(H: number) {
    const r = this.ranger!; this.space!.advance(H);
    r.step(H);
    this.pos.copy(r.pos); this.quat.copy(r.quat);
    for (const e of r.events) {
      if (e === "docked") this.onDocked();
      if (e === "crash") this.onSpaceCrash();
    }
    r.events.length = 0;
  }

  private syncVisual(alpha: number) {
    const a = clamp(alpha, 0, 1);
    if (this.kind === "air" && this.fm) {
      this.pos.copy(this.fm.pos); this.quat.copy(this.fm.quat);
    } else if (this.ranger) { this.pos.copy(this.ranger.pos); this.quat.copy(this.ranger.quat); }
    const p = this.tmpV.copy(this.prevPos).lerp(this.pos, a);
    const q = this.tmpQ.copy(this.prevQ).slerp(this.quat, a);
    if (this.kind === "air") { this.acRoot.position.copy(p); this.acRoot.quaternion.copy(q); }
    else if (this.rangerMesh) { this.rangerMesh.position.copy(p); this.rangerMesh.quaternion.copy(q); }
    this.visPos = this.visPos ?? new THREE.Vector3(); this.visQ = this.visQ ?? new THREE.Quaternion();
    this.visPos.copy(p); this.visQ.copy(q);
  }
  visPos!: THREE.Vector3; visQ!: THREE.Quaternion;

  private animate(dt: number) {
    const t = performance.now() / 1000;
    if (this.kind === "air" && this.fm) {
      const rpm = this.fm.eng;
      for (const s of this.spinParts) {
        if (s.kind === 1) { s.o.visible = rpm > 0.35; continue; }
        const rate = s.rate * (rpm * 60 + 2);
        if (s.axis === "y") s.o.rotateY(rate * dt); else if (s.axis === "z") s.o.rotateZ(rate * dt); else s.o.rotateX(rate * dt);
        s.o.visible = !(this.def.id === "pa28" && rpm > 0.55);
      }
      if (this.navLights) {
        const m = this.navLights.material as THREE.PointsMaterial;
        m.opacity = 0.5 + 0.5 * (Math.sin(t * 7) > 0.85 ? 1 : 0.4); m.visible = this.camMode !== 1 || true;
        const night = 1 - clamp(this.world!.tod.sunEl / 20 + 0.2, 0, 1);
        m.size = Math.max(0.4, this.def.bounds.span * 0.04) * (1 + night * 1.5);
      }
      const cockpitView = this.camMode === 1;
      if (this.cockpit) {
        this.cockpit.group.visible = cockpitView;
        const b = clamp(0.35 + this.world!.tod.hemiInt * 0.6 + (this.world!.tod.sunEl > 5 ? 0.4 : 0), 0.45, 1.3);
        this.cockpit.setLight(b);
        for (const m of this.cockpit.mats) m.envMapIntensity = 0.6;
        if (cockpitView || this.phase === "playing") this.cockpit.update(dt, this.instData(), this.fm.ctl.pitch, this.fm.ctl.roll);
      }
      for (const g of this.glassMeshes) g.visible = !cockpitView;
      this.def.hideInCockpit && this.acRoot.traverse((o) => { if (this.def.hideInCockpit!.test(o.name)) o.visible = !cockpitView; });
    } else if (this.kind === "space" && this.rangerMesh && this.ranger) {
      const cv = this.camMode === 1;
      this.rangerCockpit!.group.visible = cv;
      const gl = this.rangerMesh.userData.glow as THREE.Mesh[];
      const thr = this.ranger.main;
      for (const g of gl) { g.scale.set(1 + thr * 0.6, 1 + thr * 5, 1 + thr * 0.6); g.position.z = 5.4 + (1 + thr * 5) * 0.5; (g.material as THREE.MeshBasicMaterial).opacity = thr * 0.9; }
      const d = this.ranger.dock;
      this.rangerCockpit!.update(dt, d, this.ranger.vel.length(), this.ranger.main, this.ranger.ctl.pitch, this.ranger.ctl.roll, this.settings.assist, this.space!.spin);
    }
  }

  /**
   * The one place instrument values are assembled. The 2-D HUD and the 3-D cockpit panel are
   * both driven from this object, which is why they can no longer disagree.
   */
  instData(): InstrumentData {
    const fm = this.fm, p = fm.ph;
    // stall speed at the current flap setting, so the HUD tape and the ASI arc move together
    const vsNow = Math.sqrt((2 * p.mass * G) / (RHO0 * p.S * (p.CL0 + p.CLa * p.aStall * 0.96 + p.flapCL * fm.flap)));
    return {
      units: this.settings.units,
      ias: fm.ias, agl: fm.agl, alt: fm.pos.y, vs: fm.vel.y, hdg: fm.heading,
      pitch: fm.pitchDeg, bank: fm.bankDeg, g: fm.gLoad,
      // the detent the pilot selected, not the half-travelled flap position
      thr: this.throttle, flaps: this.flapsDetent, vStall: vsNow, vFlapStall: fm.vsFlap, vMax: p.vRef * 1.9,
    };
  }

  // ------------------------------------------------------------------ camera
  private updateCamera(dt: number, playing: boolean) {
    const cam = this.camera;
    const p = this.visPos ?? this.pos, q = this.visQ ?? this.quat;
    const mode = this.phase === "menu" ? 2 : this.camMode;
    const space = this.kind === "space";
    const size = space ? 18 : this.def ? this.def.chase : 15;
    let fov = 62;
    const spd = space ? (this.ranger?.vel.length() ?? 0) : (this.fm?.gs ?? 0);
    if (mode === 0) {
      const fwd = this.tmpV.set(0, 0, -1).applyQuaternion(q);
      const up = this.tmpV2.set(0, 1, 0).applyQuaternion(q);
      let tgtQ: THREE.Quaternion;
      if (space) { tgtQ = q; }
      else {
        const vel = this.fm.vel;
        const F = fwd.clone();
        if (vel.length() > 12 && !this.fm.wow) F.lerp(this.tmpV.copy(vel).normalize(), 0.35).normalize();
        const U = new THREE.Vector3(0, 1, 0).lerp(up, 0.22).normalize();
        this.tmpM.lookAt(new THREE.Vector3(), F, U);
        tgtQ = new THREE.Quaternion().setFromRotationMatrix(this.tmpM);
      }
      if (!this.camInit) { this.chaseQ.copy(tgtQ); this.camInit = true; }
      this.chaseQ.slerp(tgtQ, 1 - Math.exp(-dt * (space ? 3.2 : 4.2)));
      const d = size * (this.hud.kind === "space" ? 1 : 1) * (1 + Math.min(0.12, spd * 0.0006));
      const off = new THREE.Vector3(0, d * 0.26, d).applyQuaternion(this.chaseQ);
      cam.position.copy(p).add(off);
      const look = new THREE.Vector3(0, d * 0.08, -d * 0.55).applyQuaternion(this.chaseQ).add(p);
      cam.up.set(0, 1, 0).applyQuaternion(space ? this.chaseQ : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)));
      cam.lookAt(look);
      fov = 62 + Math.min(14, spd * (space ? 0.1 : 0.12));
    } else if (mode === 1) {
      const eye = space ? (this.rangerMesh!.userData.eye as THREE.Vector3) : this.fm.eyeBody;
      const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.pitch, this.look.yaw, 0, "YXZ"));
      if (Math.abs(this.look.yaw) < 0.001 && Math.abs(this.look.pitch) < 0.001) { /* centred */ }
      cam.position.copy(this.tmpV.copy(eye).applyQuaternion(q).add(p));
      cam.quaternion.copy(q).multiply(lq);
      cam.up.set(0, 1, 0);
      fov = space ? 78 : 76;
      if (this.settings.shake && playing && !space) {
        const stall = this.fm.stallWarn ? 0.012 : 0, rough = this.fm.wow ? Math.min(0.004, this.fm.gs * 0.00005) : 0, turb = this.fm.turb * 0.002;
        this.shake = stall + rough + turb;
        cam.rotateX((Math.random() - 0.5) * this.shake); cam.rotateY((Math.random() - 0.5) * this.shake);
      }
      cam.position.y = Math.max(cam.position.y, (space ? -1e9 : this.world!.ground.height(cam.position.x, cam.position.z) + 0.5));
    } else if (mode === 2) {
      if (this.phase === "menu") this.orbit.az += dt * 0.18;
      const r = size * 0.78 * this.orbit.r * (this.phase === "menu" ? 1.15 : 1);
      const e = this.orbit.el;
      const off = new THREE.Vector3(Math.sin(this.orbit.az) * Math.cos(e), Math.sin(e), Math.cos(this.orbit.az) * Math.cos(e)).multiplyScalar(r);
      if (space) off.applyQuaternion(q);
      cam.position.copy(p).add(off);
      cam.up.set(0, 1, 0); cam.lookAt(p.x, p.y + (space ? 0 : size * 0.05), p.z);
      fov = 50;
    } else {
      // tower / docking camera
      let tp: THREE.Vector3;
      if (space) { tp = this.space!.portWorld(new THREE.Vector3()); tp.add(new THREE.Vector3(14, 10, 60).applyQuaternion(this.space!.station.quaternion)); }
      else { tp = this.world!.localToWorld(300, 230, new THREE.Vector3()); tp.y = this.map.elev + 46; }
      cam.position.copy(tp); cam.up.set(0, 1, 0); cam.lookAt(p);
      const dist = cam.position.distanceTo(p);
      fov = clamp((2 * Math.atan((space ? 14 : size * 0.9) / Math.max(dist, 1)) * 180) / Math.PI, 8, 70);
    }
    if (!space && this.world) {
      const gh = this.world.ground.height(cam.position.x, cam.position.z) + 1.2;
      if (cam.position.y < gh) cam.position.y = gh;
    }
    this.fovCur += (fov - this.fovCur) * (1 - Math.exp(-dt * 5));
    if (Math.abs(cam.fov - this.fovCur) > 0.05) { cam.fov = this.fovCur; }
    const near = mode === 1 ? 0.1 : space ? 0.4 : 0.6;
    if (cam.near !== near) cam.near = near;
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ events and scoring
  private runwayLocal(x: number, z: number) { const l = this.world!.worldToLocal(x, z); return { x: l.x, z: l.z }; }

  private onTouchdown(e: { sink: number; speed: number; bank: number; x: number; z: number; heading: number }) {
    if (this.tdInfo) return;
    const l = this.runwayLocal(e.x, e.z), map = this.map;
    const onRunway = Math.abs(l.x) < map.rwWid / 2 + 3 && Math.abs(l.z) < map.rwLen / 2 + 10;
    this.tdInfo = { sink: e.sink, off: Math.abs(l.x), speed: e.speed, onRunway, bank: Math.abs(e.bank) };
    this.audio.thump(clamp(e.sink / 4, 0.2, 1));
    this.onEvent({ type: "touchdown", text: e.sink < 1.2 ? "Smooth touchdown" : e.sink < 2.5 ? "Firm touchdown" : "Hard touchdown" });
  }
  private onCrash(reason: string) {
    if (this.ended) return;
    this.ended = true; this.endT = 1.8;
    this.pendingResult = { kind: "crashed", title: "Crashed", sub: "You " + reason + ".", lines: [{ label: "Gates flown", value: `${this.passed}` }, { label: "Time", value: this.fmtTime() }], score: Math.round(this.passed * 100), stars: 0, best: this.bestFor(Math.round(this.passed * 100), true), mission: this.mission, key: this.key() };
    this.audio.crash();
  }
  private onSpaceCrash() {
    if (this.ended) return;
    this.ended = true; this.endT = 1.6;
    const r = this.ranger!.crashed;
    this.pendingResult = { kind: "crashed", title: "Docking failed", sub: "Ranger " + r + ".", lines: [{ label: "Time", value: this.fmtTime() }], score: 0, stars: 0, best: this.bestFor(0, true), mission: this.mission, key: this.key() };
    this.audio.crash();
  }
  private onDocked() {
    if (this.ended) return;
    this.ended = true; this.endT = 1.4;
    const d = this.ranger!.dock;
    const t = this.simTime;
    const pSpeed = Math.round(clamp(1 - Math.max(0, d.closing) / 2.4, 0, 1) * 800);
    const pAlign = Math.round(clamp(1 - d.lateral / 1.8, 0, 1) * 500 + clamp(1 - d.angle / 12, 0, 1) * 400);
    const pSpin = Math.round(clamp(1 - Math.abs(d.spinDelta) / 0.16, 0, 1) * 600);
    const pTime = Math.round(clamp(1 - (t - 60) / 240, 0, 1) * 700);
    const score = pSpeed + pAlign + pSpin + pTime + 500;
    const stars = score > 2800 ? 3 : score > 2100 ? 2 : 1;
    this.pendingResult = { kind: "docked", title: "Docking complete", sub: "Hard dock. Endurance welcomes Ranger aboard.", lines: [
      { label: "Soft contact", value: d.closing.toFixed(2) + " m/s", pts: pSpeed }, { label: "Port alignment", value: d.lateral.toFixed(1) + " m · " + d.angle.toFixed(0) + "°", pts: pAlign },
      { label: "Spin match", value: (d.spinDelta * 9.549).toFixed(2) + " rpm off", pts: pSpin }, { label: "Time", value: this.fmtTime(), pts: pTime }, { label: "Mission", value: "Complete", pts: 500 }], score, stars, best: this.bestFor(score), mission: this.mission, key: this.key(),
    };
    this.audio.chime();
  }
  pendingResult: Result | null = null;
  private key() { return `${this.opts.mode}-${this.opts.map}-${this.opts.mission}-${this.opts.aircraft}`; }
  private bestFor(score: number, noStore = false) {
    const k = "dream-best-" + this.key();
    let best = 0; try { best = Number(localStorage.getItem(k) || 0); } catch { /* ignore */ }
    if (!noStore && score > best) { best = score; try { localStorage.setItem(k, String(best)); } catch { /* ignore */ } }
    return best;
  }
  private fmtTime() { const t = Math.round(this.simTime); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; }

  private finishLanding() {
    if (this.ended) return;
    const td = this.tdInfo, W = this.map.rwWid;
    this.ended = true; this.endT = 0.9;
    if (!td) return;
    const pSmooth = td.sink < 0.9 ? 700 : td.sink < 1.8 ? 550 : td.sink < 3 ? 350 : td.sink < 4.5 ? 150 : 50;
    const pLine = !td.onRunway ? 0 : td.off < W * 0.12 ? 400 : td.off < W * 0.25 ? 300 : 150;
    const pGates = this.mission === "route" ? this.passed * 220 : 0;
    const pBase = td.onRunway ? 600 : 100;
    const pTime = this.mission === "route" ? Math.round(clamp(1 - (this.simTime - 240) / 600, 0, 1) * 400) : 0;
    const score = pSmooth + pLine + pGates + pBase + pTime - this.stalls * 60;
    const stars = !td.onRunway ? 1 : score > (this.mission === "route" ? 2700 : 1500) ? 3 : score > (this.mission === "route" ? 1900 : 1100) ? 2 : 1;
    const lines: Result["lines"] = [
      { label: "Touchdown", value: `${td.sink.toFixed(1)} m/s sink`, pts: pSmooth }, { label: "Centerline", value: td.onRunway ? `${td.off.toFixed(0)} m off` : "Off the runway", pts: pLine },
      { label: "On the runway", value: td.onRunway ? "Yes" : "No", pts: pBase },
    ];
    if (this.mission === "route") { lines.push({ label: "Gates flown", value: `${this.passed} / ${this.world!.gates.length}`, pts: pGates }); lines.push({ label: "Time", value: this.fmtTime(), pts: pTime }); }
    if (this.stalls) lines.push({ label: "Stalls", value: String(this.stalls), pts: -this.stalls * 60 });
    this.pendingResult = { kind: this.mission === "school" ? "complete" : "landed", title: this.mission === "school" ? "Flight school complete" : "Safe landing", sub: stars === 3 ? "Beautiful flying." : stars === 2 ? "Nicely done." : "Down safely. Try for a smoother touchdown.", lines, score, stars, best: this.bestFor(score), mission: this.mission, key: this.key() };
    this.audio.chime();
  }

  private updateMission(dt: number) {
    if (this.ended) {
      this.endT -= dt;
      if (this.endT <= 0 && this.pendingResult) { const r = this.pendingResult; this.pendingResult = null; this.phase = "ended"; this.onEvent({ type: "result", result: r }); }
      return;
    }
    if (this.kind === "space") { this.updateSpaceTutorial(dt); return; }
    const fm = this.fm, w = this.world!;
    // stall counting
    if (fm.stalled && !fm.wow && fm.agl > 5) { if (!this.stallLatch) { this.stalls++; this.stallLatch = true; } } else if (!fm.stalled) this.stallLatch = false;
    // gates
    if (this.mission !== "free" && this.gateIdx < w.gates.length && !(this.mission === "school" && this.gateIdx > 0)) {
      const g = w.gates[this.gateIdx];
      const rel = this.tmpV.copy(fm.pos).sub(g.pos);
      const s = rel.dot(g.dir), dist = rel.length();
      if (this.prevS < 0 && s >= 0 && dist < 62) this.passGate(); else if (dist < 36) this.passGate();
      this.prevS = s;
    }
    // landing end
    if (this.tdInfo && fm.wow && fm.gs < 1.6) { this.stoppedT += dt; if (this.stoppedT > 1.2 && this.landingValid()) this.finishLanding(); } else this.stoppedT = 0;
    if (this.tdInfo && !this.missionAllowsLanding()) { /* free flight: still score landings */ }
    this.updateAirTutorial(dt);
  }
  private landingValid() { return this.mission === "free" || this.mission === "school" ? this.tutI >= this.tutSteps.length - 1 || this.mission === "free" : this.gateIdx >= this.world!.gates.length || true; }
  private missionAllowsLanding() { return true; }
  private passGate() {
    const w = this.world!; w.gates[this.gateIdx].passed = true; this.passed++; this.gateIdx++; this.prevS = 0;
    this.updateGateVis(); this.audio.chime(); this.onEvent({ type: "gate", text: this.gateIdx >= w.gates.length ? "Final gate! Now land." : `Gate ${this.gateIdx} / ${w.gates.length}` });
  }

  // ------------------------------------------------------------------ tutorials
  private buildAirTutorial() {
    if (!this.def) return;
    const fm = () => this.fm;
    const vr = () => Math.max(fm().vs * 1.22, 18);
    const T = (t: number) => (this.tutMem[String(t)] = this.tutMem[String(t)] ?? 0);
    void T;
    const holdTimer = (key: string, cond: boolean, dtNeed: number) => { this.tutMem[key] = cond ? (this.tutMem[key] ?? 0) + 1 / 60 : 0; return this.tutMem[key] >= dtNeed; };
    const kmh = (v: number) => Math.round(v * 3.6);
    const steps: TutStep[] = [
      { title: "Engine power", text: "Push the throttle lever all the way up. (Keyboard: hold Shift)", hl: "throttle", check: () => this.throttle > 0.85 },
      { title: "Roll down the runway", text: "Keep going straight. The plane steers itself, just wait until the speed needle passes ROTATE.", hl: "speed", check: () => fm().ias > vr() },
      { title: "Lift off", text: "Pull the stick back gently — drag DOWN (or hold S) — until the wheels leave the ground.", hl: "stick", check: () => !fm().wow && fm().agl > 4 },
      { title: "Climb", text: "Keep a gentle climb. Reach 150 m above the ground.", hl: "alt", check: () => fm().agl > 150 },
      { title: "Bank to turn", text: "Slide the stick sideways. The plane banks and turns — bank at least 25° and hold it for a moment.", hl: "stick", check: () => holdTimer("bank", Math.abs(fm().bankDeg) > 25, 1.1) },
      { title: "Level out", text: "Let go of the stick. Assist levels the wings and holds your path.", hl: "stick", check: () => holdTimer("lvl", Math.abs(fm().bankDeg) < 6 && fm().agl > 40, 1.2) },
      { title: "Fly through the gate", text: "Follow the glowing marker and fly through the ring. Turn toward it with sideways stick.", hl: "marker", check: () => this.gateIdx >= 1 },
      { title: "Slow flight", text: `Ease the throttle back until speed is under ${kmh(fm().vs * 1.7)} km/h but still in the green. Never let it enter the red.`, hl: "speed", check: () => holdTimer("slow", fm().ias < fm().vs * 1.7 && fm().ias > fm().vs * 1.15 && !fm().wow, 2.2) },
      { title: "Flaps for landing", text: "Tap FLAPS twice for landing flaps. They add lift so you can fly slower.", hl: "flaps", check: () => this.flapsDetent >= 2 },
      { title: "Line up and descend", text: "Fly to the runway marker. Aim to descend gently on the glide path — use the PAPI lights: two red, two white is perfect.", hl: "marker", check: () => { const l = this.runwayLocal(fm().pos.x, fm().pos.z); return l.z > 0 && l.z < 2500 && Math.abs(l.x) < 260 && fm().agl < 330; } },
      { title: "Touch down", text: "Reduce throttle to idle and flare gently: pull back a little just before the wheels touch.", hl: "throttle", check: () => !!this.tdInfo },
      { title: "Brake to a stop", text: "Hold the BRAKE button (Space) until the aircraft stops.", hl: "brake", check: () => false },
    ];
    this.tutSteps = steps;
  }

  private updateAirTutorial(dt: number) {
    if (this.mission !== "school" || this.tutI >= this.tutSteps.length) return;
    if (this.tutDone > 0) { this.tutDone -= dt; if (this.tutDone <= 0) { this.tutI++; this.tutMem = {}; } return; }
    const s = this.tutSteps[this.tutI];
    if (s.check()) this.tutDone = 1.1;
  }

  private buildSpaceTutorial() {
    const r = () => this.ranger!;
    const hold = (key: string, cond: boolean, need: number) => { this.tutMem[key] = cond ? (this.tutMem[key] ?? 0) + 1 / 60 : 0; return this.tutMem[key] >= need; };
    this.tutSteps = [
      { title: "Rotate the ship", text: "Drag the stick to pitch and roll, use the side buttons to yaw. There is no air here: the ship keeps spinning until you stop it.", hl: "stick", check: () => r().w.length() > 0.3 },
      { title: "Fire the main engine", text: "Raise the thrust lever until you reach 8 m/s. In space speed never fades.", hl: "throttle", check: () => r().vel.length() > 8 },
      { title: "Brake", text: "Hold BRAKE to cut your speed to nearly zero. Retro thrusters burn against your motion.", hl: "brake", check: () => hold("brk", r().vel.length() < 1.2 && this.throttle < 0.08, 0.6) },
      { title: "Face Endurance", text: "Turn the nose toward the docking port (the circle marker) until ALIGN is under 15°. Lower the thrust lever first.", hl: "marker", check: () => hold("face", r().dock.angle < 15, 1.0) },
      { title: "Match the spin", text: "Endurance rotates! Use ROLL to turn with it until SPIN reads about 0 rpm difference. This is the hardest part.", hl: "stick", check: () => hold("spin", Math.abs(r().dock.spinDelta) < 0.08, 1.8) },
      { title: "Approach slowly", text: "Keep the spin matched and drift to the port: pulse the engine, use RCS (arrows) to center the dot. Contact speed below 1.8 m/s.", hl: "rcs", check: () => false },
    ];
  }
  private updateSpaceTutorial(dt: number) {
    if (this.mission !== "school" || this.tutI >= this.tutSteps.length) return;
    if (this.tutDone > 0) { this.tutDone -= dt; if (this.tutDone <= 0) { this.tutI++; this.tutMem = {}; } return; }
    if (this.tutSteps[this.tutI].check()) this.tutDone = 1.0;
  }

  // ------------------------------------------------------------------ HUD
  private project(p: THREE.Vector3, label: string): Marker {
    const v = this.tmpV2.copy(p).project(this.camera);
    const behind = v.z > 1 || (this.tmpV.copy(p).sub(this.camera.position).dot(this.camera.getWorldDirection(new THREE.Vector3())) < 0);
    let x = v.x, y = v.y;
    if (behind) { x = -x; y = -y; }
    const out = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
    const ang = (Math.atan2(y, x) * 180) / Math.PI;
    if (out) { const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.82, 0.0001); x /= m; y /= m; }
    return { x: (x * 0.5 + 0.5) * 100, y: (1 - (y * 0.5 + 0.5)) * 100, vis: !out, edge: ang, dist: p.distanceTo(this.camera.position), label };
  }

  private audioState() {
    if (this.kind === "air" && this.fm) return { kind: "air" as const, rpm: this.fm.eng, speed: this.fm.ias, stall: this.fm.stallWarn && !this.fm.wow, wow: this.fm.wow, gs: this.fm.gs, jet: this.def.phys.engine === "jet", playing: this.phase === "playing", cockpit: this.camMode === 1, brake: this.fm.ctl.brake };
    return { kind: "space" as const, rpm: this.ranger?.main ?? 0, speed: this.ranger?.vel.length() ?? 0, stall: false, wow: false, gs: 0, jet: true, playing: this.phase === "playing", cockpit: this.camMode === 1, brake: 0 };
  }

  private pushHud() {
    const h = this.hud;
    h.kind = this.kind; h.phase = this.phase; h.camera = this.phase === "menu" ? "Orbit" : CAMS[this.camMode]; h.assist = this.settings.assist; h.fps = Math.round(this.fps);
    h.time = this.simTime; h.stickX = this.touch.x;
    h.thr = this.throttle;
    if (this.kind === "air" && this.fm) {
      const fm = this.fm, d = this.instData();
      // straight off instData() — the cockpit panel is drawing these same numbers
      h.speed = d.ias; h.alt = d.agl; h.vs = d.vs; h.hdg = d.hdg; h.flaps = d.flaps; h.pitch = d.pitch; h.bank = d.bank; h.g = d.g;
      h.vStall = d.vStall; h.vFlap = d.vFlapStall; h.vMax = d.vMax; h.engineRun = fm.eng > 0.05;
      let state = "";
      if (fm.crashed) state = "Crashed";
      else if (fm.wow) state = fm.gs < 1.5 ? (this.tdInfo ? "Stopped" : "Parked") : fm.ias > d.vStall * 0.8 && this.throttle > 0.5 ? "Taking off" : this.tdInfo ? "Rolling out" : "Taxiing";
      else if (fm.stalled) state = "Stalled";
      else if (this.world && this.approachActive()) state = "On approach";
      else state = fm.vel.y > 2 ? "Climbing" : fm.vel.y < -2 ? "Descending" : "Level flight";
      h.state = state;
      let warn = "", lvl: 0 | 1 | 2 = 0;
      if (!fm.wow && fm.stallWarn) { warn = fm.stalled ? "STALL — lower the nose!" : "Low speed — add power"; lvl = fm.stalled ? 2 : 1; }
      else if (!fm.wow && fm.agl < 160 && fm.vel.y < -7) { warn = "PULL UP"; lvl = 2; }
      else if (fm.overspeedFlap) { warn = "Flaps too fast"; lvl = 1; }
      else if (!fm.wow && fm.ias < d.vStall * 1.12 && fm.agl > 3 && fm.agl < 400) { warn = "Too slow"; lvl = 1; }
      h.warn = warn; h.warnLevel = lvl;
      this.fillObjective(h);
      h.space = null;
    } else if (this.ranger) {
      const r = this.ranger;
      h.speed = r.vel.length(); h.alt = r.dock.range; h.vs = r.dock.closing; h.hdg = 0; h.state = r.crashed ? "Collision" : r.docked ? "Docked" : r.dock.range < 40 ? "Final approach" : r.vel.length() < 0.5 ? "Drifting" : "Underway";
      h.space = { dock: r.dock, spin: this.space!.spin, speed: r.vel.length() };
      h.warn = r.dock.range < 30 && !r.dock.ok[3] && r.dock.closing > 1.8 ? "Closing too fast" : r.dock.range < 30 && !r.dock.ok[2] ? "Match the spin" : ""; h.warnLevel = h.warn ? 1 : 0;
      h.objective = this.mission === "free" ? "Free drift — dock when ready" : "Dock with Endurance";
      h.progress = `${Math.max(0, Math.round(r.dock.range))} m to port`;
      h.marker = this.project(this.space!.portWorld(new THREE.Vector3()), "Docking port");
      h.hint = null;
      h.pitch = 0; h.bank = 0; h.flaps = 0; h.engineRun = true;
      this.fillTut(h);
      return this.onHud({ ...h });
    }
    this.fillTut(h);
    this.onHud({ ...h });
  }

  private approachActive() {
    const l = this.runwayLocal(this.fm.pos.x, this.fm.pos.z);
    return l.z > 100 && l.z < 7000 && Math.abs(l.x) < 600 && this.fm.agl < 700 && !this.fm.wow && this.fm.vel.y < 0.5 && this.fm.heading !== undefined && this.facingRunway();
  }
  private facingRunway() {
    const d = Math.abs(((this.fm.heading - this.map.rwHdg + 540) % 360) - 180); // 0 when aligned with takeoff direction reversed
    return d < 55;
  }

  private fillTut(h: Hud) {
    if (this.mission === "school" && this.tutI < this.tutSteps.length) {
      const s = this.tutSteps[this.tutI];
      h.tut = { i: this.tutI, n: this.tutSteps.length, title: s.title, text: s.text, hl: s.hl, done: this.tutDone > 0 };
    } else h.tut = null;
  }

  private fillObjective(h: Hud) {
    const w = this.world!, fm = this.fm;
    h.marker = null; h.hint = null;
    const L = this.map.rwLen;
    const landingPhase = this.mission === "free" || (this.mission === "route" && this.gateIdx >= w.gates.length) || (this.mission === "school" && this.tutI >= 9);
    if (this.mission === "free") { h.objective = fm.wow && !this.tdInfo ? "Free flight — take off when ready" : "Free flight"; h.progress = ""; }
    else if (this.mission === "school") { h.objective = "Flight school"; h.progress = `Step ${Math.min(this.tutI + 1, this.tutSteps.length)} of ${this.tutSteps.length}`; }
    else {
      if (!this.liftedOff && fm.wow && this.gateIdx === 0) { h.objective = "Take off"; h.progress = "Full throttle, then pull back gently"; }
      else if (this.gateIdx < w.gates.length) { h.objective = "Fly through the gates"; h.progress = `Gate ${this.gateIdx + 1} / ${w.gates.length}`; }
      else if (!this.tdInfo) { h.objective = "Land on the runway"; h.progress = "Follow the runway marker"; }
      else { h.objective = "Brake to a stop"; h.progress = "Hold BRAKE"; }
    }
    // marker
    if (this.mission !== "free" && !this.tdInfo && this.gateIdx < w.gates.length && !(this.mission === "school" && (this.tutI < 6 || this.tutI > 6))) {
      if (this.mission === "route" ? (this.liftedOff || !fm.wow) : true) h.marker = this.project(w.gates[this.gateIdx].pos, `Gate ${this.gateIdx + 1}`);
    }
    if (!h.marker && landingPhase && !this.tdInfo) {
      const rp = w.localToWorld(0, L / 2 - 250, new THREE.Vector3()); rp.y = this.map.elev + 5;
      if (fm.agl > 10 || !fm.wow) h.marker = this.project(rp, "Runway");
    }
    // approach hints
    if (this.approachActive() && !this.tdInfo) {
      const l = this.runwayLocal(fm.pos.x, fm.pos.z);
      const dHor = Math.max(60, l.z - (L / 2 - 250));
      const ideal = Math.tan((3 * Math.PI) / 180) * dHor + 4;
      const alt = fm.pos.y - this.map.elev;
      const dev = alt - ideal;
      const d = this.instData();
      if (fm.agl < 400) {
        if (Math.abs(l.x) > 70) h.hint = { text: l.x > 0 ? "Runway is to your left — turn left" : "Runway is to your right — turn right", tone: "warn" };
        else if (fm.ias > d.vStall * 1.75 && dHor < 3500) h.hint = { text: "Too fast — reduce power", tone: "warn" };
        else if (dev > Math.max(30, dHor * 0.03)) h.hint = { text: "Too high — ease the nose down", tone: "warn" };
        else if (dev < -Math.max(25, dHor * 0.025)) h.hint = { text: "Too low — add power, pull up a little", tone: "bad" };
        else h.hint = { text: "On the glide path — hold steady", tone: "ok" };
        if (fm.agl < 18 && fm.vel.y < -1.5 && !fm.wow) h.hint = { text: fm.vel.y < -3 ? "Flare! Pull back gently" : "Flare gently — pull back a little", tone: "warn" };
      }
    }
    h.score = this.scoreLive;
  }

  // ------------------------------------------------------------------ teardown
  private disposeWorld() {
    if (this.world) { this.world.dispose(); this.world = null; }
    if (this.space) { this.space.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); this.space = null; }
    this.ranger = null; this.rangerMesh = null; this.rangerCockpit = null; this.cockpit = null;
    this.acRoot = new THREE.Group();
  }
  dispose() {
    this.stopLoop(); this.disposeWorld();
    window.removeEventListener("keydown", this.onKey); window.removeEventListener("keyup", this.onKeyUp); window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
    this.resizeObs?.disconnect(); this.audio.dispose(); this.renderer.dispose();
  }
  todLabel() { return TODS[this.opts.tod].label; }
}
