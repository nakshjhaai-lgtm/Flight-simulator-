#!/usr/bin/env npx tsx
/**
 * Headless flight-dynamics test rig.
 *
 * FlightModel is DOM-free, so it can be driven directly in Node against a flat ground
 * plane. Each aircraft flies a scripted profile (taxi, take-off, climb, level turns,
 * slow flight/stall, approach, landing, glide) with a closed-loop pilot on the stick, and
 * the numbers that come out are compared with what the airframe should physically do.
 *
 *   npx tsx tools/physics.test.ts
 *   npx tsx tools/physics.test.ts --verbose
 */
import { FlightModel, G } from "../src/game/flight";
import { AIRCRAFT, AircraftDef } from "../src/game/aircraftDefs";

const flatGround = { height: () => 0, surface: () => 0 };
const H = 1 / 120;
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
const onlyFlag = process.argv.indexOf("--only");
const only = onlyFlag >= 0 ? process.argv[onlyFlag + 1].split(",") : null;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

let failures = 0;
const log: string[] = [];
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  log.push(`${ok ? "  ok   " : "  FAIL "} ${label.padEnd(44)} ${detail}`);
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (v: number, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : "n/a");

/** One simulation frame; keeps the event queue drained. */
function step(fm: FlightModel, onTouchdown?: (sink: number) => void, onCrash?: (r: string) => void) {
  fm.step(H);
  for (const e of fm.events) {
    if (e.type === "touchdown") onTouchdown?.(e.sink);
    if (e.type === "crash") onCrash?.(e.reason);
  }
  fm.events.length = 0;
}

interface Res { [k: string]: number | boolean | string }

function profile(def: AircraftDef) {
  const p = def.phys;
  const o: Res = { id: def.id };
  const fm = new FlightModel(def, flatGround);

  // ── 1. parked ────────────────────────────────────────────────────────────
  fm.place(0, 0, 0, 0);
  for (let i = 0; i < 3 / H; i++) step(fm);
  o.parkDrift = Math.hypot(fm.pos.x, fm.pos.z);
  o.parkPitch = fm.pitchDeg;
  o.parkWow = fm.wow;

  // ── 2. take-off ──────────────────────────────────────────────────────────
  const rotateV = fm.vs * 1.15;
  fm.ctl.brake = 0;
  fm.ctl.throttle = 1;
  fm.ctl.assist = true;
  let t = 0, airborne = false, crashed = "";
  for (let i = 0; i < 90 / H; i++) {
    fm.ctl.pitch = fm.ias > rotateV ? 0.45 : 0;
    step(fm, undefined, (r) => (crashed = r));
    t += H;
    if (!fm.wow && fm.agl > 3) { airborne = true; break; }
    if (crashed) break;
  }
  o.takeoffSec = t;
  o.takeoffRollM = Math.hypot(fm.pos.x, fm.pos.z);
  o.airborne = airborne && !crashed;
  o.vStallKmh = fm.vs * 3.6;

  // ── 3. climb, closed loop on 8 deg pitch attitude ────────────────────────
  const climbFrom = fm.pos.y;
  const vs: number[] = [];
  let ct = 0;
  for (let i = 0; i < 150 / H && fm.agl < 500; i++) {
    fm.ctl.throttle = 1;
    fm.ctl.roll = 0;
    fm.ctl.pitch = clamp(0.5 * (8 - fm.pitchDeg) - 0.35 * (fm.w.x * 57.3), -1, 1);
    step(fm, undefined, (r) => (crashed = r));
    ct += H;
    if (fm.agl > 80) vs.push(fm.vel.y);
    if (crashed) break;
  }
  o.climbAg = fm.agl;
  o.climbSec = ct;
  o.climbRate = avg(vs);
  o.climbSpeedKmh = fm.gs * 3.6;
  o.maxClimbFpm = (avg(vs) || 0) * 196.85;

  // ── 4. level out, then steady banked turns (closed loop on bank) ─────────
  fm.ctl.throttle = 0.75;
  let bankI = 0;
  const holdBank = (target: number) => {
    const e = target - fm.bankDeg;
    bankI = clamp(bankI + e * H * 0.6, -0.35, 0.35);
    fm.ctl.roll = clamp(1.1 * e * 0.03 + bankI - fm.w.z * 57.3 * 0.006, -1, 1);
  };
  const level = (secs: number) => {
    for (let i = 0; i < secs / H; i++) {
      holdBank(0);
      fm.ctl.pitch = clamp(0.25 * (0 - fm.vel.y) - 0.2 * (fm.w.x * 57.3), -1, 1);
      step(fm, undefined, (r) => (crashed = r));
    }
  };
  level(8);
  o.levelSpeedKmh = fm.gs * 3.6;
  o.levelAltDrift = 0;

  const turn = (targetBank: number, secs: number) => {
    // power target set on entry: a steep turn needs the speed that goes with the load factor
    const targetSpeed = Math.max(fm.gs, fm.vs * (targetBank > 45 ? 1.6 : 1.25));
    const gs: number[] = [], alts: number[] = [], hdg: number[] = [], spd: number[] = [], banks: number[] = [];
    const y0 = fm.pos.y;
    for (let i = 0; i < secs / H; i++) {
      holdBank(targetBank);
      // power holds speed, pitch holds altitude — exactly what a pilot does in a turn
      fm.ctl.throttle = clamp(fm.ctl.throttle + (targetSpeed - fm.gs) * 0.012, 0, 1);
      fm.ctl.pitch = clamp(0.05 * (y0 - fm.pos.y) - 0.12 * (fm.vel.y) - 0.02 * (fm.w.x * 57.3), -1, 1);
      step(fm, undefined, (r) => (crashed = r));
      if (crashed) break;
      if (i * H > 3.5) { gs.push(fm.gLoad); alts.push(fm.pos.y); hdg.push(fm.heading); spd.push(fm.gs); banks.push(fm.bankDeg); }
    }
    let dHdg = Math.abs(hdg[hdg.length - 1] - hdg[0]);
    if (dHdg > 180) dHdg = 360 - dHdg;
    const n = hdg.length ? (secs - 3.5) : 1;
    return { g: avg(gs), dAlt: alts.length ? alts[alts.length - 1] - y0 : NaN, rate: dHdg / n, bank: avg(banks), spd: avg(spd) };
  };
  const t30 = turn(30, 12);
  // 2 g needs sqrt(2) x stall speed: accelerate before rolling into 60 deg
  fm.ctl.throttle = 1;
  for (let i = 0; i < 40 / H && fm.ias < fm.vs * 1.55; i++) { holdBank(0); fm.ctl.pitch = 0; step(fm, undefined, (r) => (crashed = r)); }
  fm.ctl.throttle = 0.85;
  const t60 = turn(60, 12);
  o.g30 = t30.g; o.altDrift30 = t30.dAlt; o.turnRate30 = t30.rate; o.bank30 = t30.bank;
  o.g60 = t60.g; o.altDrift60 = t60.dAlt; o.bank60 = t60.bank;
  o.turnCrash = crashed;
  level(6);

  // ── 5. slow flight and stall, assist OFF (a real pilot can stall it) ─────
  fm.ctl.assist = false;
  fm.ctl.roll = 0; fm.ctl.pitch = 0; fm.ctl.throttle = 0; // idle: energy must bleed off for a real break
  level(0);
  let sawWarn = false, sawStall = false;
  const stallAlt = fm.pos.y;
  for (let i = 0; i < 45 / H; i++) {
    // creep the nose up toward the break instead of yanking it: a real stall entry
    fm.ctl.pitch = 1; // full back pressure until it breaks — the classic stall entry
    step(fm, undefined, (r) => (crashed = r));
    if (crashed) break;
    if (fm.stallWarn) sawWarn = true;
    if (fm.stalled) { sawStall = true; break; }
  }
  o.stallWarned = sawWarn;
  o.stalled = sawStall;
  o.stallSpeedKmh = fm.ias * 3.6;
  fm.ctl.throttle = 1;
  let recovered = false;
  for (let i = 0; i < 40 / H; i++) {
    fm.ctl.pitch = -0.9;
    fm.ctl.roll = clamp(-fm.bankDeg * 0.02, -1, 1);
    step(fm, undefined, (r) => (crashed = r));
    if (!fm.stalled && fm.ias > fm.vs * 1.2) { recovered = true; break; }
  }
  o.recovered = recovered;
  o.stallAltLoss = stallAlt - fm.pos.y;
  o.stallCrash = crashed;
  fm.ctl.assist = true;
  fm.ctl.pitch = 0; fm.ctl.roll = 0;

  // ── 6. approach + landing on the flat plane ──────────────────────────────
  if (crashed) { o.landed = false; o.touchdownSink = -1; o.landCrash = crashed; o.stopped = false; }
  else {
    // climb back to a safe pattern altitude
    for (let i = 0; i < 60 / H && fm.agl < 220; i++) {
      fm.ctl.throttle = 1; holdBank(0);
      fm.ctl.pitch = clamp(0.5 * (8 - fm.pitchDeg) - 0.35 * (fm.w.x * 57.3), -1, 1);
      step(fm, undefined, (r) => (crashed = r));
    }
    fm.ctl.throttle = 0.3;
    if (fm.ctl.flaps === undefined) fm.ctl.flaps = 0;
    fm.ctl.flaps = 2;
    let sink = -1;
    let landCrash = "";
    for (let i = 0; i < 300 / H; i++) {
      holdBank(0);
      if (fm.agl < 30) fm.ctl.roll = clamp(-fm.bankDeg * 0.06 - fm.w.z * 57.3 * 0.01, -1, 1);
      // glide path, then a round-out on a radio-altitude pitch schedule (like an autoland).
      // Heavier airframes need the round-out started higher.
      const flareHi = Math.min(26, 14 + def.phys.len * 0.45);
      const flareLo = Math.min(11, 5 + def.phys.len * 0.2);
      if (fm.agl > flareHi) {
        fm.ctl.pitch = clamp(0.6 * (-2.6 - fm.vel.y) - 0.12 * (fm.w.x * 57.3), -1, 1);
      } else {
        const flarePitch = fm.agl > flareLo ? 3.5 : 7.5;
        fm.ctl.pitch = clamp(0.22 * (flarePitch - fm.pitchDeg) - 0.1 * (fm.w.x * 57.3), -1, 1);
        if (fm.agl < flareHi) fm.ctl.throttle = 0;
      }
      step(fm, (s) => (sink = s), (r) => (landCrash = r));
      if (landCrash) break;
      if (sink >= 0 && fm.wow && fm.gs < 0.6) break;
    }
    o.touchdownSink = sink;
    o.landed = !landCrash && sink >= 0;
    o.landCrash = landCrash;
    o.landAlt = fm.pos.y; o.landSpeed = fm.gs; o.landAg = fm.agl;
    fm.ctl.brake = 1; fm.ctl.throttle = 0; fm.ctl.pitch = 0;
    for (let i = 0; i < 20 / H; i++) step(fm, undefined, (r) => (landCrash = r));
    o.stopped = !landCrash && fm.gs < 0.5;
    o.rolloutM = Math.abs(fm.pos.z);
  }

  // ── 7. glide polar ───────────────────────────────────────────────────────
  const g = new FlightModel(def, flatGround);
  g.placeAir(0, 1500, 0, 0, def.phys.vRef);
  g.ctl.throttle = 0; g.ctl.assist = true; g.ctl.roll = 0;
  const gt = fm.vs * 1.25; // best-glide-ish target
  for (let i = 0; i < 30 / H; i++) {
    const gamma = Math.asin(clamp(g.vel.y / Math.max(5, g.vel.length()), -1, 1)) * 57.3;
    g.ctl.pitch = clamp(-0.09 * (gt - g.ias) - 0.16 * gamma, -1, 1);
    step(g);
  }
  o.glideSink = -g.vel.y;
  o.glideRatio = g.gs / Math.max(0.05, -g.vel.y);
  o.glideSpeedKmh = g.gs * 3.6;

  // ── 8. top speed at full throttle, level ─────────────────────────────────
  const s = new FlightModel(def, flatGround);
  s.placeAir(0, 1500, 0, 0, def.phys.vRef);
  s.ctl.throttle = 1; s.ctl.assist = true; s.ctl.roll = 0;
  for (let i = 0; i < 40 / H; i++) {
    s.ctl.pitch = clamp(0.3 * (def.phys.vRef - s.gs) * 0 + 0.25 * (0 - s.vel.y), -1, 1);
    step(s);
  }
  o.maxSpeedKmh = s.gs * 3.6;
  return o;
}

const list = AIRCRAFT.filter((d) => !only || only.includes(d.id));
console.log("\nflight-dynamics rig — flat ground, 120 Hz, closed-loop pilot\n");
for (const def of list) {
  const o = profile(def);
  log.length = 0;
  const id = String(o.id);
  console.log(`── ${def.name} (${def.maker})  ${def.phys.mass} kg · ${Math.round(def.phys.power / 1000)} kW · Vs ${f(o.vStallKmh as number, 0)} km/h · Vmax ${f(o.maxSpeedKmh as number, 0)} km/h · climb ${f(o.maxClimbFpm as number, 0)} fpm · glide ${f(o.glideRatio as number)}:1`);
  check("parked: holds position", (o.parkDrift as number) < 0.5, `drift ${f(o.parkDrift as number, 3)} m`);
  check("parked: level on its wheels", Math.abs(o.parkPitch as number) < 4 && o.parkWow === true, `pitch ${f(o.parkPitch as number)}°`);
  check("takes off cleanly", o.airborne === true, `${f(o.takeoffSec as number)} s · ${f(o.takeoffRollM as number, 0)} m roll`);
  check("take-off roll plausible", (o.takeoffRollM as number) > 40 && (o.takeoffRollM as number) < 2800, `${f(o.takeoffRollM as number, 0)} m`);
  check("climbs at > 1.5 m/s", (o.climbRate as number) > 1.5, `${f(o.climbRate as number, 2)} m/s · reached AGL ${f(o.climbAg as number, 0)} m`);
  check("survives the turn sequence", !o.turnCrash, o.turnCrash ? String(o.turnCrash) : "no crash");
  check("30° turn: holds the bank ±6°", Math.abs((o.bank30 as number) - 30) < 6, `bank ${f(o.bank30 as number)}° · ${f(o.g30 as number, 2)} g (theory 1.15)`);
  check("60° turn: holds the bank ±6°", Math.abs((o.bank60 as number) - 60) < 6, `bank ${f(o.bank60 as number)}° · ${f(o.g60 as number, 2)} g (theory 2.00)`);
  check("30° turn: n within 15% of 1/cos(bank)", Math.abs((o.g30 as number) - 1 / Math.cos((o.bank30 as number) * Math.PI / 180)) < 0.17, `${f(o.g30 as number, 2)} g`);
  check("60° turn: n within 15% of 1/cos(bank)", Math.abs((o.g60 as number) - 1 / Math.cos((o.bank60 as number) * Math.PI / 180)) < 0.3, `${f(o.g60 as number, 2)} g`);
  check("30° turn: altitude held ±30 m", Math.abs(o.altDrift30 as number) < 30, `${(o.altDrift30 as number) >= 0 ? "+" : ""}${f(o.altDrift30 as number, 0)} m`);
  check("60° turn: altitude held ±130 m", Math.abs(o.altDrift60 as number) < 130, `${(o.altDrift60 as number) >= 0 ? "+" : ""}${f(o.altDrift60 as number, 0)} m`);
  check("turn rate usable (2–15 °/s)", (o.turnRate30 as number) > 2 && (o.turnRate30 as number) < 15, `${f(o.turnRate30 as number)} °/s`);
  check("stall warning before the break", o.stallWarned === true && o.stalled === true, `warn=${o.stallWarned} stall=${o.stalled} at ${f(o.stallSpeedKmh as number, 0)} km/h`);
  check("recovers from the stall", o.recovered === true && !o.stallCrash, `recovered=${o.recovered} lost ${f(o.stallAltLoss as number, 0)} m ${o.stallCrash ? "· " + o.stallCrash : ""}`);
  check("lands without crashing", o.landed === true, o.landed ? `touchdown ${f(o.touchdownSink as number, 2)} m/s` : `crash="${o.landCrash}" left at AGL ${f(o.landAg as number, 0)} m, ${f(o.landSpeed as number, 0)} m/s`);
  check("gentle touchdown (< 3.0 m/s)", o.landed === true && (o.touchdownSink as number) >= 0 && (o.touchdownSink as number) < 3.0, `${f(o.touchdownSink as number, 2)} m/s`);
  check("brakes to a stop", o.stopped === true, `ground speed settled`);
  check("glide sink < 6 m/s", (o.glideSink as number) < 6, `${f(o.glideSink as number, 2)} m/s · L/D ${f(o.glideRatio as number)}`);
  if (id === "ask21") check("glider L/D > 14", (o.glideRatio as number) > 14, `L/D ${f(o.glideRatio as number)}`);
  for (const line of verbose ? log : log.filter((x) => x.startsWith("  FAIL"))) console.log(line);
}
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}   (G = ${G})`);
process.exit(failures ? 1 : 0);
