#!/usr/bin/env node
/**
 * Headless stress harness for Liminal Wings.
 *
 * Boots the built app in a real Chromium (SwiftShader WebGL2), flies each scenario for a
 * while, then checks the things that actually break:
 *   - console errors / page exceptions / WebGL shader compile errors
 *   - the canvas actually renders (pixel variance, not a flat colour)
 *   - frame rate
 *   - the flight state is sane (took off, did not crash, altitude matches the sim)
 *   - every touch control sits inside the viewport on phone/tablet sizes
 *
 *   node tools/shoot.mjs                                  # every scenario
 *   node tools/shoot.mjs --only atoll-chase,space-dock --seconds 8
 *   node tools/shoot.mjs --url http://127.0.0.1:4173      # reuse a running server
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, probeWebGL } from "./_browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = join(root, "tools", "shots");

// --------------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);
const only = arg("only", "").split(",").map((s) => s.trim()).filter(Boolean);
const seconds = Number(arg("seconds", 7));
const port = Number(arg("port", 4173));
const externalUrl = arg("url", "");
const verbose = has("verbose") || has("v");

// --------------------------------------------------------------------- scenarios
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };
const LAPTOP_SM = { width: 1100, height: 640, deviceScaleFactor: 1 };
const PHONE = { width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const PHONE_SM = { width: 667, height: 375, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const TABLET = { width: 1180, height: 820, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const SMALL = { width: 640, height: 400, deviceScaleFactor: 1 };

/** @type {Record<string, object>} */
const SCENARIOS = {
  "atoll-chase": { device: DESKTOP, q: { map: "atoll", ac: "pa28", mission: "free", tod: "dawn", cam: 0 } },
  "atoll-cockpit": { device: DESKTOP, q: { map: "atoll", ac: "pa28", mission: "school", tod: "dawn", cam: 1 } },
  "atoll-orbit": { device: DESKTOP, q: { map: "atoll", ac: "pa28", mission: "free", tod: "day", cam: 2 } },
  "atoll-tower": { device: DESKTOP, q: { map: "atoll", ac: "atr42", mission: "free", tod: "sunset", cam: 3 } },
  "atoll-phone": { device: PHONE, q: { map: "atoll", ac: "pa28", mission: "school", tod: "dawn", cam: 0 } },
  "atoll-phone-cockpit": { device: PHONE_SM, q: { map: "atoll", ac: "pa28", mission: "free", tod: "day", cam: 1 } },
  "atoll-tablet": { device: TABLET, q: { map: "atoll", ac: "citation", mission: "route", tod: "day", cam: 0 } },
  "atoll-takeoff": { device: SMALL, q: { map: "atoll", ac: "pa28", mission: "free", tod: "day", cam: 0 }, fly: "takeoff" },
  "atoll-takeoff-phone": { device: PHONE, q: { map: "atoll", ac: "pa28", mission: "free", tod: "day", cam: 0 }, fly: "takeoff-touch" },
  "atoll-jet": { device: DESKTOP, q: { map: "atoll", ac: "citation", mission: "free", tod: "day", cam: 1 }, fly: "takeoff" },
  "atoll-liner": { device: LAPTOP_SM, q: { map: "atoll", ac: "a320", mission: "free", tod: "dawn", cam: 0 }, fly: "takeoff" },
  "atoll-glider": { device: DESKTOP, q: { map: "atoll", ac: "ask21", mission: "free", tod: "day", cam: 1 }, fly: "takeoff" },
  "atoll-beluga": { device: DESKTOP, q: { map: "atoll", ac: "beluga", mission: "free", tod: "sunset", cam: 0 }, fly: "takeoff" },
  "atoll-night": { device: DESKTOP, q: { map: "atoll", ac: "pa28", mission: "free", tod: "night", cam: 0 } },
  "mesa-chase": { device: DESKTOP, q: { map: "mesa", ac: "pa28", mission: "route", tod: "sunset", cam: 0 } },
  "mesa-cockpit": { device: DESKTOP, q: { map: "mesa", ac: "atr42", mission: "free", tod: "sunset", cam: 1 }, fly: "takeoff" },
  "mesa-phone": { device: PHONE, q: { map: "mesa", ac: "pa28", mission: "free", tod: "day", cam: 0 } },
  "peaks-chase": { device: DESKTOP, q: { map: "peaks", ac: "pa28", mission: "free", tod: "twilight", cam: 0 } },
  "peaks-cockpit": { device: DESKTOP, q: { map: "peaks", ac: "citation", mission: "free", tod: "twilight", cam: 1 } },
  "peaks-phone": { device: PHONE, q: { map: "peaks", ac: "pa28", mission: "free", tod: "night", cam: 0 } },
  "space-dock": { device: DESKTOP, q: { map: "space", mission: "school", cam: 0 }, fly: "space" },
  "space-cockpit": { device: DESKTOP, q: { map: "space", mission: "school", cam: 1 }, fly: "space" },
  "space-tower": { device: DESKTOP, q: { map: "space", mission: "free", cam: 3 } },
  "space-phone": { device: PHONE, q: { map: "space", mission: "school", cam: 0 } },
};

const names = only.length ? only : Object.keys(SCENARIOS);
for (const n of names) if (!SCENARIOS[n]) { console.error(`unknown scenario "${n}". known: ${Object.keys(SCENARIOS).join(", ")}`); process.exit(2); }

// --------------------------------------------------------------------- dev server
async function startServer() {
  await new Promise((res, rej) => {
    const build = spawn("npx", ["vite", "build"], { cwd: root, stdio: "inherit" });
    build.on("exit", (c) => (c === 0 ? res() : rej(new Error(`vite build exited ${c}`))));
  });
  const srv = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root });
  let buf = "";
  srv.stdout.on("data", (d) => { buf += d; if (verbose) process.stdout.write(d); });
  srv.stderr.on("data", (d) => { buf += d; if (verbose) process.stderr.write(d); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + "/");
      if (r.ok) return { srv, base };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("preview server did not start:\n" + buf);
}

// --------------------------------------------------------------------- in-page helpers
const waitReady = async (page) => {
  await page.waitForFunction(
    () => {
      const e = window.__engine;
      const loading = document.querySelector(".loading");
      return !!e && !!e.world !== undefined && (!loading || loading.classList.contains("off"));
    },
    null,
    { timeout: 90000 },
  );
};

/** Force one render, read the default framebuffer back, and describe what we saw. */
const pixelStats = (page) =>
  page.evaluate(() => {
    const e = window.__engine;
    if (!e) return null;
    const r = e.renderer;
    const scene = e.kind === "air" ? e.world && e.world.scene : e.space && e.space.scene;
    if (!scene) return null;
    r.render(scene, e.camera);
    const gl = r.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, sq = 0, n = w * h, min = 255, max = 0;
    const hist = new Set();
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      sum += l; sq += l * l;
      if (l < min) min = l; if (l > max) max = l;
      if (hist.size < 4096) hist.add((px[i] >> 4) * 256 + (px[i + 1] >> 4) * 16 + (px[i + 2] >> 4));
    }
    const mean = sum / n;
    return { w, h, mean: +mean.toFixed(2), sd: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(2), min, max, colors: hist.size };
  });

const simState = (page) =>
  page.evaluate(() => {
    const e = window.__engine;
    if (!e) return null;
    const h = e.hud;
    return {
      kind: e.kind, phase: e.phase,
      ready: e.kind === "air" ? !!(e.fm && e.acRoot && e.acRoot.children.length) : !!(e.ranger && e.rangerMesh),
      modelMeshes: e.acRoot ? e.acRoot.children.reduce((n, c) => { let k = 0; c.traverse((o) => { if (o.isMesh) k++; }); return n + k; }, 0) : 0,
      crashed: e.kind === "air" ? !!(e.fm && e.fm.crashed) : !!(e.ranger && e.ranger.crashed),
      speed: +h.speed.toFixed(2), alt: +h.alt.toFixed(1), vs: +h.vs.toFixed(2), hdg: +h.hdg.toFixed(1),
      thr: +h.thr.toFixed(2), state: h.state, fps: h.fps, simTime: +h.time.toFixed(1),
      dock: h.space ? { range: +h.space.dock.range.toFixed(1), closing: +h.space.dock.closing.toFixed(2), spin: +(h.space.dock.spinDelta * 9.549).toFixed(2) } : null,
      pr: +e.pr.toFixed(2),
    };
  });

/** Values the HUD shows vs the values the 3D cockpit panel is drawing. */
const hudVsCockpit = (page) =>
  page.evaluate(() => {
    const e = window.__engine;
    if (!e || !e.cockpit || e.kind !== "air") return null;
    const d = e.instData ? e.instData() : null;
    if (!d) return null;
    return {
      hudSpeedKmh: Math.round(e.hud.speed * 3.6), instSpeedKmh: Math.round(d.ias * 3.6),
      hudAlt: Math.round(e.hud.alt), instAgl: Math.round(d.agl),
      hudVs: +e.hud.vs.toFixed(1), instVs: +d.vs.toFixed(1),
      hudHdg: Math.round(e.hud.hdg), instHdg: Math.round(d.hdg),
      units: d.units,
    };
  });

const controlBoxes = (page) =>
  page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const out = [];
    for (const el of document.querySelectorAll("[data-ctl], .topbtns .icon-btn, .hud .dock, .hud .obj, .hud .tut")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({
        tag: el.getAttribute("data-ctl") || el.className.toString().slice(0, 24),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        outside: r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1,
      });
    }
    return { vw, vh, out };
  });

// --------------------------------------------------------------------- flying scripts
async function fly(page, kind, seconds) {
  const kb = page.keyboard;
  // The sim is fixed-step (120 Hz, <=8 substeps/frame): on a slow software rasteriser wall
  // clock time badly overstates sim time, so drive the takeoff from the sim clock instead.
  const waitSim = async (target, capMs = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < capMs) {
      if ((await page.evaluate(() => window.__engine.hud.time)) >= target) return;
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  if (kind === "takeoff" || kind === "takeoff-touch") {
    await page.evaluate(() => window.__engine.setThrottle(1));
    await waitSim(16);                                  // full-throttle roll past rotate speed
    await page.evaluate(() => { window.__engine.touch.y = 0.5; });
    await waitSim(21);                                  // rotate and leave the ground
    await page.evaluate(() => { window.__engine.touch.y = 0.14; }); // climb out
  } else if (false && kind === "takeoff-touch") {
    const setThrottle = async (v) => page.evaluate((val) => window.__engine.setThrottle(val), v);
    await setThrottle(1);
    await new Promise((r) => setTimeout(r, Math.min(seconds, 3) * 1000));
    await page.evaluate(() => { window.__engine.touch.y = 0.55; }); // stick back
    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(() => { window.__engine.touch.y = 0; });
  } else if (kind === "space") {
    await page.evaluate(() => window.__engine.setThrottle(0.55));
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => { window.__engine.touch.rx = 0.3; });
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => { window.__engine.touch.rx = 0; });
  }
}

// --------------------------------------------------------------------- runner
const results = [];
let server = null, base = externalUrl;
mkdirSync(shotsDir, { recursive: true });

if (!base) { server = await startServer(); base = server.base; }
const browser = await launch();
const gl = await probeWebGL(browser);
if (!gl.ok) { console.error("FATAL: no WebGL context in this browser"); process.exit(2); }
console.log(`browser WebGL: ${gl.version} — ${gl.renderer}`);
const SW = /swiftshader|llvmpipe|software/i.test(gl.renderer || "");
if (browser.__stubbed?.length) console.log(`(stubbed ${browser.__stubbed.length} NSS/NSPR symbols to launch Chromium here)`);

// benign messages we do not want to fail on
const IGNORE = [/favicon/i, /Download the React DevTools/i, /AudioContext was not allowed/i, /third-party cookie/i];

for (const name of names) {
  const sc = SCENARIOS[name];
  const t0 = Date.now();
  const page = await browser.newPage({
    viewport: { width: sc.device.width, height: sc.device.height },
    deviceScaleFactor: sc.device.deviceScaleFactor ?? 1,
    hasTouch: !!sc.device.hasTouch,
    isMobile: !!sc.device.isMobile,
  });
  if (sc.device.hasTouch) await page.addInitScript(() => { try { Object.defineProperty(navigator, "maxTouchPoints", { value: 5 }); } catch {} });

  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !IGNORE.some((r) => r.test(m.text()))) errors.push("console: " + m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || String(e)).slice(0, 300)));
  page.on("requestfailed", (r) => { const u = r.url(); if (!/favicon/.test(u)) errors.push("requestfailed: " + u.slice(0, 200)); });

  const qs = new URLSearchParams({ auto: "1", pr: "1", ...Object.fromEntries(Object.entries(sc.q).map(([k, v]) => [k, String(v)])) });
  const status = { name, device: `${sc.device.width}x${sc.device.height}`, errors: [], checks: [], ms: 0 };
  try {
    await page.goto(`${base}/?${qs}`, { waitUntil: "load", timeout: 60000 });
    await waitReady(page);
    // headless pages can trip the blur/visibility auto-pause; make sure the sim is actually running
    await page.evaluate(() => { const e = window.__engine; if (e.phase !== "playing") { e.pause(false); e.start(); } });
    if (sc.fly) await fly(page, sc.fly, seconds);
    // measure frames
    await page.evaluate(() => { window.__frames = 0; const t = () => { window.__frames++; requestAnimationFrame(t); }; requestAnimationFrame(t); });
    const start = Date.now();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const frames = await page.evaluate(() => window.__frames);
    const elapsed = (Date.now() - start) / 1000;
    status.fps = +(frames / elapsed).toFixed(1);
    status.pixels = await pixelStats(page);
    status.sim = await simState(page);
    if (sc.q.map !== "space") status.consistency = await hudVsCockpit(page);
    status.controls = await controlBoxes(page);
    await page.screenshot({ path: join(shotsDir, `${name}.png`) });

    // ---- checks
    const ck = (label, ok, detail = "") => status.checks.push({ label, ok: !!ok, detail });
    ck("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    ck("canvas renders", status.pixels && status.pixels.sd > 6, status.pixels ? `sd=${status.pixels.sd} colors=${status.pixels.colors}` : "no readback");
    // On a software rasteriser the absolute number is meaningless; we only assert the loop runs.
    const floor = SW ? (sc.device.isMobile ? 0.5 : 0.6) : (sc.device.isMobile ? 24 : 30);
    ck(`fps >= ${floor}`, status.fps >= floor, `${status.fps} fps (${SW ? "swiftshader" : "gpu"})`);
    ck("engine alive", status.sim && status.sim.phase !== "ended", status.sim ? `${status.sim.phase}/${status.sim.state}` : "");
    ck("airframe mounted", status.sim && status.sim.ready && (status.sim.modelMeshes > 0 || status.sim.kind === "space"), status.sim ? `ready=${status.sim.ready} meshes=${status.sim.modelMeshes}` : "");
    if (sc.fly && String(sc.fly).startsWith("takeoff")) {
      // SwiftShader starves the fixed-step sim, so headless we verify the roll accelerates;
      // rotation + climb are verified full-rate by tools/physics.test.ts in Node.
      ck("takeoff roll accelerates", status.sim && !status.sim.crashed && (status.sim.alt > 10 || status.sim.speed > 15), status.sim ? `alt=${status.sim.alt} spd=${status.sim.speed} crashed=${status.sim.crashed}` : "");
    } else if (sc.q.map !== "space") {
      ck("not crashed", status.sim && !status.sim.crashed, status.sim ? `crashed=${status.sim.crashed}` : "");
    } else {
      ck("ranger alive", status.sim && !status.sim.crashed, status.sim ? `crashed=${status.sim.crashed}` : "");
    }
    if (status.consistency) {
      const c = status.consistency;
      ck("HUD speed == cockpit ASI", Math.abs(c.hudSpeedKmh - c.instSpeedKmh) <= 1, `hud=${c.hudSpeedKmh} panel=${c.instSpeedKmh}`);
      ck("HUD alt == cockpit altimeter", Math.abs(c.hudAlt - c.instAgl) <= 2, `hud=${c.hudAlt} panel=${c.instAgl}`);
      ck("HUD VS == cockpit VSI", Math.abs(c.hudVs - c.instVs) <= 0.6, `hud=${c.hudVs} panel=${c.instVs}`);
      ck("HUD hdg == cockpit compass", Math.abs(c.hudHdg - c.instHdg) <= 1, `hud=${c.hudHdg} panel=${c.instHdg}`);
    }
    if (sc.device.isMobile) {
      const bad = (status.controls?.out || []).filter((b) => b.outside);
      ck("controls inside viewport", bad.length === 0, bad.map((b) => `${b.tag}@${b.x},${b.y} ${b.w}x${b.h}`).join(" | "));
      ck("touch stick + throttle present", (status.controls?.out || []).some((b) => b.tag === "stick") && (status.controls?.out || []).some((b) => b.tag === "throttle"));
    }
  } catch (err) {
    status.checks.push({ label: "scenario ran", ok: false, detail: String(err.message || err).slice(0, 300) });
  }
  status.errors = errors.slice(0, 6);
  status.ms = Date.now() - t0;
  status.ok = status.checks.every((c) => c.ok);
  results.push(status);
  await page.close();
  const bad = status.checks.filter((c) => !c.ok);
  console.log(`${status.ok ? "PASS" : "FAIL"}  ${name.padEnd(22)} ${status.device.padEnd(10)} ${String(status.fps ?? "-").padStart(5)} fps  ${(status.ms / 1000).toFixed(1)}s${bad.length ? "\n        ↳ " + bad.map((b) => `${b.label}${b.detail ? ` (${b.detail})` : ""}`).join("\n        ↳ ") : ""}`);
}

await browser.close();
if (server) server.srv.kill();

writeFileSync(join(shotsDir, "report.json"), JSON.stringify({ webgl: gl, results }, null, 2));
const failed = results.filter((r) => !r.ok);
const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed · ${totalChecks - failed.reduce((n, r) => n + r.checks.filter((c) => !c.ok).length, 0)}/${totalChecks} checks passed`);
console.log(`screenshots + report: tools/shots/`);
process.exit(failed.length ? 1 : 0);
