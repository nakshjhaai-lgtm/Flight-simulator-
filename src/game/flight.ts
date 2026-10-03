/**
 * Rigid-body 6-DOF flight dynamics.
 *
 * Aerodynamics follow the classic stability-derivative formulation (Stevens & Lewis / Beard & McLain "Small
 * Unmanned Aircraft") including the sigmoid linear-to-flat-plate stall blend, ISA density lapse, propeller
 * power-limited thrust (T = P/(V+Vc)), jet thrust lapse, wheel spring-damper landing gear with brake and nose
 * wheel steering, and an optional fly-by-wire "assist" layer (rate command / flight-path hold / alpha protection)
 * that drives the very same control surfaces.
 *
 * Limitations: fixed centre of gravity & fuel mass, no ground slope in tyre normals, no compressibility, no
 * propeller slipstream over the tail, simplified gyroscopics.
 *
 * Body axes (three.js convention): +X right wing, +Y up, -Z nose.
 */
import * as THREE from "three";
import type { AircraftDef, Phys } from "./aircraftDefs";

export const G = 9.81;
const DEBUG = typeof process !== "undefined";
export const RHO0 = 1.225;
export const SEA_RHO = (h: number) => RHO0 * Math.pow(Math.max(0.15, 1 - 2.25577e-5 * h), 4.25588);

export interface Ground {
  height(x: number, z: number): number; // effective surface height (>= water level)
  surface(x: number, z: number): number; // 0 asphalt, 1 grass/dirt, 2 water
}

export interface Controls {
  pitch: number; // + = pull (nose up)
  roll: number; // + = right wing down
  yaw: number; // + = nose right
  throttle: number; // 0..1
  brake: number; // 0..1
  flaps: number; // 0,1,2 detents
  assist: boolean;
}

export type FlightEvent =
  | { type: "touchdown"; sink: number; speed: number; bank: number; x: number; z: number; heading: number }
  | { type: "crash"; reason: string }
  | { type: "liftoff" };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sat = (v: number) => clamp(v, -1, 1);

const vbT = new THREE.Vector3();
const vhT = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const qInv = new THREE.Quaternion();

interface GearRt {
  rb: THREE.Vector3; // body-relative position
  kind: "wheel" | "skid";
  steer: boolean;
  brake: boolean;
  k: number;
  c: number;
  comp: number;
  fn: number;
}

export class FlightModel {
  def: AircraftDef;
  ph: Phys;
  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  vel = new THREE.Vector3();
  w = new THREE.Vector3(); // body angular velocity (rad/s)
  ctl: Controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, flaps: 0, assist: true };
  wind = new THREE.Vector3();
  gust = 0;
  ground: Ground;
  yawQ: THREE.Quaternion;
  cgOffset = new THREE.Vector3();
  gears: GearRt[] = [];
  hull: THREE.Vector3[] = [];
  eyeBody = new THREE.Vector3();
  // surfaces
  de = 0; da = 0; dr = 0;
  eng = 0; flap = 0; steer = 0;
  ie = 0; gammaHold = 0; holdLatched = false; releaseT = 0;
  // state
  wow = false; wowPrev = false; airTime = 0; prevVy = 0; maxSink = 0;
  crashed = false; crashReason = "";
  events: FlightEvent[] = [];
  t = 0;
  // telemetry
  alpha = 0; beta = 0; V = 0; ias = 0; gs = 0; agl = 0; heading = 0; pitchDeg = 0; bankDeg = 0;
  gLoad = 1; stalled = false; stallWarn = false; vs = 0; vsFlap = 0; thrust = 0; sigma = 0; overspeedFlap = false;
  rpm = 0; assistActive = false; cgHeight = 1; turb = 0;
  onRunwaySurface = 0;
  yawG = 0; gndHold = 0; gndLatched = false;
  private fAero = new THREE.Vector3();
  private lastSpecific = new THREE.Vector3();

  constructor(def: AircraftDef, ground: Ground) {
    this.def = def;
    this.ph = def.phys;
    this.ground = ground;
    this.yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), def.yaw);
    this.cgOffset.set(...def.cg);
    {
      // centre of gravity follows the gear load distribution so the aircraft sits level on its wheels
      let sw = 0, cx = 0, cz = 0;
      for (const g of def.gear) if (g.kind === "wheel") { sw += g.share; cx += g.share * g.p[0]; cz += g.share * g.p[2]; }
      if (sw > 0) { this.cgOffset.x = cx / sw; this.cgOffset.z = cz / sw; }
    }
    const toBody = (p: [number, number, number], out: THREE.Vector3) =>
      out.set(p[0], p[1], p[2]).sub(this.cgOffset).applyQuaternion(this.yawQ);
    let lowest = 0;
    const staticComp = 0.06 + 0.006 * def.bounds.len;
    for (const g of def.gear) {
      const rb = toBody(g.p, new THREE.Vector3());
      lowest = Math.min(lowest, rb.y);
      const sh = g.share * this.ph.mass;
      const k = (sh * G) / (g.kind === "skid" ? staticComp * 0.5 : staticComp);
      const c = 2 * 0.65 * Math.sqrt(k * Math.max(sh, 20));
      this.gears.push({ rb, kind: g.kind, steer: !!g.steer, brake: !!g.brake, k, c, comp: 0, fn: 0 });
    }
    this.cgHeight = -lowest;
    for (const h of def.hull) this.hull.push(toBody(h, new THREE.Vector3()));
    toBody(def.eye, this.eyeBody);
    this.computeSpeeds();
  }

  computeSpeeds() {
    const p = this.ph;
    const clmax = (flap: number) => p.CL0 + p.CLa * p.aStall * 0.96 + p.flapCL * flap;
    this.vs = Math.sqrt((2 * p.mass * G) / (RHO0 * p.S * clmax(0)));
    this.vsFlap = Math.sqrt((2 * p.mass * G) / (RHO0 * p.S * clmax(1)));
  }

  /** Place the aircraft on the ground, heading in radians (0 = north = -Z, clockwise positive). */
  place(x: number, z: number, heading: number, groundY: number) {
    this.quat.setFromAxisAngle(tmpA.set(0, 1, 0), -heading);
    this.pos.set(x, groundY + this.cgHeight + 0.02, z);
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.reset();
  }

  /** Place in flight at a given speed (m/s) and altitude. */
  placeAir(x: number, y: number, z: number, heading: number, speed: number) {
    this.quat.setFromAxisAngle(tmpA.set(0, 1, 0), -heading);
    this.pos.set(x, y, z);
    this.vel.set(0, 0, -1).applyQuaternion(this.quat).multiplyScalar(speed);
    this.w.set(0, 0, 0);
    this.reset();
    this.eng = 0.6;
    this.ctl.throttle = 0.6;
    this.airTime = 5;
  }

  private reset() {
    this.crashed = false; this.crashReason = ""; this.events.length = 0;
    this.de = this.da = this.dr = 0; this.eng = 0; this.flap = this.ph.startFlaps * 0.5; this.ie = 0;
    this.holdLatched = false; this.wow = true; this.wowPrev = true; this.airTime = 0; this.t = 0;
    this.ctl.throttle = 0; this.ctl.flaps = this.ph.startFlaps; this.ctl.pitch = this.ctl.roll = this.ctl.yaw = 0; this.ctl.brake = 1;
  }

  get forward() { return tmpA.set(0, 0, -1).applyQuaternion(this.quat); }

  step(dt: number) {
    if (this.crashed) { this.stepWreck(dt); return; }
    const p = this.ph;
    const c = this.ctl;
    this.t += dt;
    const h = this.pos.y;
    const rho = SEA_RHO(h);
    const sigmaD = rho / RHO0;

    // ---------- air-relative velocity in body axes ----------
    const gustT = this.t * 0.37;
    const turbAmp = this.turb * (Math.sin(gustT) * 0.6 + Math.sin(gustT * 2.3 + 1.3) * 0.3 + Math.sin(gustT * 5.1) * 0.1);
    tmpA.copy(this.vel).sub(this.wind);
    tmpA.y -= turbAmp * 1.6;
    qInv.copy(this.quat).invert();
    const vb = vbT.copy(tmpA).applyQuaternion(qInv);
    const V = vb.length();
    this.V = V;
    this.ias = V * Math.sqrt(sigmaD);
    const Vf = -vb.z;
    const alpha = V > 1 ? Math.atan2(-vb.y, Vf) : 0;
    const beta = V > 1 ? Math.asin(clamp(vb.x / V, -1, 1)) : 0;
    this.alpha = alpha; this.beta = beta;
    const q = this.w.x, pr = -this.w.z, r = -this.w.y;

    // ---------- attitude ----------
    tmpC.set(0, 0, -1).applyQuaternion(this.quat);
    const fwd = tmpC;
    const theta = Math.asin(clamp(fwd.y, -1, 1));
    tmpQ.copy(this.quat);
    const rightV = tmpA.set(1, 0, 0).applyQuaternion(tmpQ);
    const upV = tmpB.set(0, 1, 0).applyQuaternion(tmpQ);
    const bank = Math.atan2(-rightV.y, upV.y);
    this.pitchDeg = (theta * 180) / Math.PI;
    this.bankDeg = (bank * 180) / Math.PI;
    let hd = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
    if (hd < 0) hd += 360;
    this.heading = hd;
    const spd = this.vel.length();
    const gamma = spd > 3 ? Math.asin(clamp(this.vel.y / spd, -1, 1)) : theta;
    this.gs = Math.hypot(this.vel.x, this.vel.z);

    // ---------- control laws ----------
    const vScale = clamp(p.vRef / Math.max(V, 10), 0.55, 2.6);
    const agl = this.pos.y - this.ground.height(this.pos.x, this.pos.z) - this.cgHeight;
    this.agl = Math.max(0, agl);
    const flying = !this.wow && agl > 1.5 && V > 0.55 * this.vs;
    this.assistActive = c.assist && flying;
    const expo = (x: number) => x * (0.45 + 0.55 * Math.abs(x));
    const pIn = expo(c.pitch), rIn = expo(c.roll), yIn = expo(c.yaw);
    let deT: number, daT: number, drT: number;
    if (this.assistActive) {
      // --- roll: rate command, auto-level on release
      const pMax = p.rollRate;
      let pCmd = rIn * pMax;
      if (Math.abs(c.roll) < 0.05) {
        pCmd = Math.abs(bank) < 1.5 ? clamp(-bank * 1.3, -pMax * 0.55, pMax * 0.55) : 0;
      } else if (Math.abs(bank) > 1.05 && Math.sign(bank) === Math.sign(pCmd)) pCmd = 0;
      daT = sat((pCmd / pMax) * vScale + 0.55 * ((pCmd - pr) / pMax) * vScale);
      // --- pitch: rate command, flight-path hold on release, alpha protection
      const qMax = p.pitchRate;
      let qCmd: number;
      if (Math.abs(c.pitch) > 0.05) {
        qCmd = pIn * qMax; this.holdLatched = false; this.releaseT = 0;
      } else {
        this.releaseT += dt;
        if (!this.holdLatched && this.releaseT > 0.35) {
          this.gammaHold = clamp(gamma, -0.6, 0.6); this.holdLatched = true; this.ie = this.ie;
        }
        qCmd = this.holdLatched && Math.abs(theta) < 1.25 ? clamp(1.1 * (this.gammaHold - gamma), -qMax * 0.7, qMax * 0.7) : -q * 0.0;
        if (!this.holdLatched) qCmd = 0;
      }
      // bank compensation (keeps altitude in turns even before hold latches)
      const cosB = Math.max(0.35, Math.cos(bank));
      if (Math.abs(bank) < 1.2 && Math.abs(c.pitch) < 0.05) qCmd += (G / Math.max(V, 20)) * (1 / cosB - 1) * 0.0;
      const aLim = p.aStall * 0.8 + p.flapCL * this.flap * 0.02;
      qCmd = Math.min(qCmd, Math.max(-0.4, (aLim - alpha) * 2.6));
      const qErr = qCmd - q;
      this.ie = clamp(this.ie + 0.9 * qErr * dt * vScale, -0.7, 0.7);
      deT = sat(this.ie + 1.1 * qErr * vScale);
      // --- yaw: turn coordination + damper
      drT = sat(yIn + clamp((p.Cnb / p.Cndr) * beta * 1.6 - 0.22 * r * vScale, -0.45, 0.45));
    } else {
      this.ie *= 0.9;
      this.holdLatched = false;
      deT = pIn; daT = rIn; drT = yIn;
    }
    // ground directional assist (taxi / take-off roll): holds runway heading when the pedals are released
    {
      let yg = c.yaw;
      if (c.assist && this.wow && this.gs > 1.5) {
        if (Math.abs(c.yaw) < 0.06) {
          const hdR = (hd * Math.PI) / 180;
          if (!this.gndLatched) { this.gndHold = hdR; this.gndLatched = true; }
          let e = this.gndHold - hdR;
          while (e > Math.PI) e -= 2 * Math.PI;
          while (e < -Math.PI) e += 2 * Math.PI;
          yg += clamp(2.2 * e - 0.9 * r, -0.8, 0.8);
        } else this.gndLatched = false;
      } else this.gndLatched = false;
      this.yawG = yg;
      if (this.wow) drT = clamp(yg, -1, 1);
    }
    // surface actuator dynamics (lag + rate limit)
    const aS = 1 - Math.exp(-dt / 0.075);
    const lim = 7 * dt;
    this.de += clamp((deT - this.de) * aS, -lim, lim);
    this.da += clamp((daT - this.da) * aS, -lim, lim);
    this.dr += clamp((drT - this.dr) * aS, -lim, lim);

    // flaps
    const flapT = c.flaps * 0.5;
    this.flap += clamp(flapT - this.flap, -0.25 * dt, 0.25 * dt);
    this.overspeedFlap = this.ias > p.maxFlapSpeed && this.flap > 0.05;

    // engine
    const thr = clamp(c.throttle, 0, 1);
    const tau = thr > this.eng ? p.spool : p.spool * 0.7;
    this.eng += (thr - this.eng) * (1 - Math.exp(-dt / tau));
    this.rpm = this.eng;

    // ---------- aerodynamics ----------
    const qd = 0.5 * rho * V * V;
    const F = this.fAero.set(0, 0, 0);
    let Mx = 0, My = 0, Mz = 0;
    if (V > 0.5) {
      const M = 28;
      const a0 = p.aStall;
      const ex1 = Math.exp(clamp(-M * (alpha - a0), -40, 40));
      const ex2 = Math.exp(clamp(M * (alpha + a0), -40, 40));
      const sg = (1 + ex1 + ex2) / ((1 + ex1) * (1 + ex2));
      this.sigma = sg;
      const aEff = clamp(alpha, -1.4, 1.4);
      const clLin = p.CL0 + p.CLa * aEff + p.flapCL * this.flap;
      const sa = Math.sin(alpha), ca = Math.cos(alpha);
      const clFlat = 2.1 * Math.sign(alpha) * sa * sa * ca;
      const CL = (1 - sg) * clLin + sg * clFlat;
      const k = 1 / (Math.PI * p.e * p.AR);
      const cdAtt = p.CD0 + p.flapCD * this.flap + k * clLin * clLin;
      const cdFlat = p.CD0 + p.flapCD * this.flap + 1.85 * sa * sa;
      const CD = (1 - sg) * cdAtt + sg * cdFlat + 0.9 * beta * beta;
      this.stalled = sg > 0.5;
      this.stallWarn = alpha > a0 * 0.82 && V > 5;
      const vh = vhT.copy(vb).multiplyScalar(1 / V);
      // lift direction = right x velocity
      const lx = 0, ly = -vh.z, lz = vh.y;
      const ll = Math.hypot(ly, lz) || 1;
      const Lm = qd * p.S * CL;
      const Dm = qd * p.S * CD;
      F.set(lx * Lm / ll - vh.x * Dm - qd * p.S * p.CYb * beta, (ly / ll) * Lm - vh.y * Dm, (lz / ll) * Lm - vh.z * Dm);
      // moments
      const cb = p.c / (2 * Math.max(V, 8));
      const bb = p.b / (2 * Math.max(V, 8));
      const aMom = clamp(alpha, -0.7, 0.7);
      const Cm = p.Cm0 + p.Cma * aMom + p.Cmq * q * cb + p.CmdE * this.de + p.flapCm * this.flap
        - 0.18 * sg * Math.sign(alpha);
      const Cl = p.Clb * beta + p.Clp * pr * bb + p.Clda * this.da + 0.1 * r * bb * 2;
      const Cn = p.Cnb * beta + p.Cnr * r * bb + p.Cndr * this.dr - 0.12 * p.Clda * this.da;
      // stalled wing drop: roll couples with sideslip + noise
      const stallRoll = sg * (0.04 * Math.sin(this.t * 3.1) + 0.2 * beta) * (p.b > 20 ? 0.3 : 1);
      Mx = qd * p.S * p.c * Cm;
      Mz = -qd * p.S * p.b * (Cl + stallRoll);
      My = -qd * p.S * p.b * Cn;
    } else {
      this.stalled = false; this.stallWarn = false; this.sigma = 0;
    }

    // ---------- thrust ----------
    let T = 0;
    if (p.engine === "prop") {
      const P = p.power * this.eng * clamp((sigmaD - 0.12) / 0.88, 0.1, 1);
      T = P / (Math.max(Vf, 0) + p.vc);
      T = Math.min(T, (P / p.vc) * 1.0);
      My += p.propTorque * T * p.b * (V > 0 ? 1 : 1) * 0.9 * Math.max(0.0, 1 - Vf / 70) * (this.wow ? 0.35 : 1); // left-turning tendency (nose left => +Y)
    } else {
      T = p.power * (0.02 + 0.98 * this.eng) * Math.pow(sigmaD, 0.8) * Math.max(0.5, 1 - Math.max(Vf, 0) / 420);
    }
    this.thrust = T;
    F.z -= T;

    // ---------- gravity and gear (world frame) ----------
    const Fw = tmpB.copy(F).applyQuaternion(this.quat); // aero + thrust in world
    // keep for g-load
    this.lastSpecific.copy(F);
    const Tw = tmpC.set(Mx, My, Mz); // body torque so far
    const gforce = { x: 0, y: -G * p.mass, z: 0 };
    let fx = Fw.x + gforce.x, fy = Fw.y + gforce.y, fz = Fw.z + gforce.z;
    let tqx = 0, tqy = 0, tqz = 0; // world torque from gear
    const wW = tmpA.copy(this.w).applyQuaternion(this.quat);
    let anyContact = false;
    let hullHit = false;
    const steerAng = clamp(this.yawG, -1, 1) * 0.62 / (1 + this.gs / 14);
    this.steer += (steerAng - this.steer) * (1 - Math.exp(-dt / 0.08));
    for (const g of this.gears) {
      const rw = tmpQ2 && new THREE.Vector3().copy(g.rb).applyQuaternion(this.quat);
      const px = this.pos.x + rw.x, py = this.pos.y + rw.y, pz = this.pos.z + rw.z;
      const gh = this.ground.height(px, pz);
      const comp = gh - py;
      g.comp = 0; g.fn = 0;
      if (comp <= 0) continue;
      const surf = this.ground.surface(px, pz);
      if (surf === 2) { this.crash("splashed into the water"); hullHit = true; break; }
      // velocity at contact
      const vpx = this.vel.x + wW.y * rw.z - wW.z * rw.y;
      const vpy = this.vel.y + wW.z * rw.x - wW.x * rw.z;
      const vpz = this.vel.z + wW.x * rw.y - wW.y * rw.x;
      let fn = g.k * comp - g.c * vpy;
      if (comp > 0.75) fn += g.k * 6 * (comp - 0.75);
      if (fn < 0) fn = 0;
      g.comp = comp; g.fn = fn;
      anyContact = true;
      this.onRunwaySurface = surf;
      // wheel axes
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
      let fxh = fw.x, fzh = fw.z;
      const l = Math.hypot(fxh, fzh) || 1; fxh /= l; fzh /= l;
      if (g.steer) {
        const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
        const nx = fxh * cs - fzh * sn; // rotate by steer (nose right = clockwise seen from above)
        const nz = fxh * sn + fzh * cs;
        fxh = nx; fzh = nz;
      }
      const rxh = -fzh, rzh = fxh;
      const vlong = vpx * fxh + vpz * fzh;
      const vlat = vpx * rxh + vpz * rzh;
      const roll = g.kind === "skid" ? 0.3 : surf === 1 ? 0.075 : 0.018;
      const brk = g.brake ? clamp(this.ctl.brake, 0, 1) * p.brake : 0;
      let flong = -sat(vlong / 0.6) * (roll + brk) * fn;
      const park = this.ctl.throttle < 0.04 ? 0.12 : 0;
      if (Math.abs(vlong) < 0.6 && this.gs < 1.2 && park) flong = -sat(vlong / 0.3) * Math.min(park * fn, Math.abs(vlong) * p.mass * 3);
      const muLat = g.kind === "skid" ? 0.7 : surf === 1 ? 0.7 : 1.0;
      const flat = -sat(vlat / 0.3) * muLat * fn;
      const ffx = fxh * flong + rxh * flat;
      const ffz = fzh * flong + rzh * flat;
      fx += ffx; fy += fn; fz += ffz;
      // torque r x F
      tqx += rw.y * ffz - rw.z * fn;
      tqy += rw.z * ffx - rw.x * ffz;
      tqz += rw.x * fn - rw.y * ffx;
      if (surf === 1 && g.kind === "wheel") {
        // grass roughness
        const bump = Math.sin(px * 0.9 + pz * 1.3) * Math.sin(px * 0.37 - pz * 0.71);
        fy += bump * fn * 0.08;
      }
    }
    this.wow = anyContact;
    // hull collision
    if (!this.crashed) {
      for (let hi = 0; hi < this.hull.length; hi++) {
        const hp = this.hull[hi];
        const rw = new THREE.Vector3().copy(hp).applyQuaternion(this.quat);
        const px = this.pos.x + rw.x, py = this.pos.y + rw.y, pz = this.pos.z + rw.z;
        const gh = this.ground.height(px, pz);
        if (py < gh + 0.05) {
          const surf = this.ground.surface(px, pz);
          this.crash(surf === 2 ? "splashed into the water" : (spd > 20 ? "crashed into the terrain" : "scraped the ground") + (DEBUG ? " hull" + hi : ""));
          hullHit = true; break;
        }
      }
    }
    void hullHit;
    // touchdown / liftoff events
    if (this.wow && !this.wowPrev) {
      if (this.airTime > 1.5) {
        const sink = Math.max(0, -this.prevVy);
        this.events.push({ type: "touchdown", sink, speed: this.gs, bank: this.bankDeg, x: this.pos.x, z: this.pos.z, heading: this.heading });
        if (sink > p.crashSink * 1.25 || Math.abs(this.bankDeg) > 38) this.crash("hard impact on landing");
      }
      this.airTime = 0;
    }
    if (!this.wow && this.wowPrev && this.gs > 8) this.events.push({ type: "liftoff" });
    if (!this.wow) this.airTime += dt; else if (this.airTime > 0 && this.wowPrev) this.airTime = 0;
    this.wowPrev = this.wow;
    this.prevVy = this.vel.y;

    // ---------- integrate ----------
        const ax = fx / p.mass, ay = fy / p.mass, az = fz / p.mass;
    this.gLoad = 1 + 0; // placeholder updated below
    this.vel.x += ax * dt; this.vel.y += ay * dt; this.vel.z += az * dt;
    // specific force in body up (g-load)
    {
      const sf = tmpA.set(ax, ay + G, az).applyQuaternion(qInv);
      this.gLoad = sf.y / G;
    }
    this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt; this.pos.z += this.vel.z * dt;

    // rotational dynamics in body frame
    qInv.copy(this.quat).invert();
    const tg = new THREE.Vector3(tqx, tqy, tqz).applyQuaternion(qInv);
    const tx = Tw.x + tg.x, ty = Tw.y + tg.y, tz = Tw.z + tg.z;
    const { Ixx, Iyy, Izz } = p;
    const wx = this.w.x, wy = this.w.y, wz = this.w.z;
    const dwx = (tx - (Izz - Iyy) * wy * wz) / Ixx;
    const dwy = (ty - (Ixx - Izz) * wz * wx) / Iyy;
    const dwz = (tz - (Iyy - Ixx) * wx * wy) / Izz;
    this.w.x += dwx * dt; this.w.y += dwy * dt; this.w.z += dwz * dt;
    // orientation
    tmpQ.set(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0);
    tmpQ.multiplyQuaternions(this.quat, tmpQ);
    this.quat.x += tmpQ.x; this.quat.y += tmpQ.y; this.quat.z += tmpQ.z; this.quat.w += tmpQ.w;
    this.quat.normalize();
  }

  private crash(reason: string) {
    if (this.crashed) return;
    this.crashed = true; this.crashReason = reason;
    this.events.push({ type: "crash", reason });
  }

  private stepWreck(dt: number) {
    // simple slide-to-stop after a crash
    this.vel.multiplyScalar(Math.exp(-dt * 1.8));
    this.w.multiplyScalar(Math.exp(-dt * 2.5));
    const gh = this.ground.height(this.pos.x, this.pos.z);
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < gh + 0.3) { this.pos.y = gh + 0.3; this.vel.y = Math.max(0, this.vel.y); }
    tmpQ.set(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0).premultiply(this.quat);
    this.quat.x += tmpQ.x; this.quat.y += tmpQ.y; this.quat.z += tmpQ.z; this.quat.w += tmpQ.w;
    this.quat.normalize();
  }
}
