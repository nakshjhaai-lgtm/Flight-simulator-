import { useCallback, useEffect, useRef, useState } from "react";
import { Engine, Hud, Result, Settings, defaultSettings, MissionId } from "./game/engine";
import { AIRCRAFT } from "./game/aircraftDefs";
import { MAPS } from "./game/terrain";
import { TODS } from "./game/world";
import type { TodId } from "./game/terrain";
import { HudView } from "./ui/Hud";
import { TouchControls } from "./ui/Controls";

type Screen = "title" | "setup" | "game";
const SPACE = { id: "space", name: "Endurance Approach", sub: "Deep space · Docking", blurb: "Fly the Ranger through a nebula past a black hole and dock with the spinning Endurance. Match its spin, then glide in.", difficulty: 3, art: "linear-gradient(160deg,#07071e 0%,#3a2a78 45%,#ff9a52 100%)" };

const loadSettings = (): Settings => { try { return { ...defaultSettings(), ...JSON.parse(localStorage.getItem("dream-settings") || "{}") }; } catch { return defaultSettings(); } };
const isCoarse = () => typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || new URLSearchParams(location.search).has("touch"));

function useFullscreen() {
  const [fs, setFs] = useState(false);
  useEffect(() => { const f = () => setFs(!!document.fullscreenElement); document.addEventListener("fullscreenchange", f); return () => document.removeEventListener("fullscreenchange", f); }, []);
  const can = typeof document !== "undefined" && (document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
  const toggle = useCallback(async () => {
    try {
      const d = document as unknown as { webkitExitFullscreen?: () => void }; const el = document.documentElement as unknown as { webkitRequestFullscreen?: () => void } & HTMLElement;
      if (document.fullscreenElement) { await document.exitFullscreen(); }
      else { if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" } as FullscreenOptions); else el.webkitRequestFullscreen?.(); (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => {}); }
      void d;
    } catch { /* ignore */ }
  }, []);
  return { fs, can: !!can, toggle };
}

const stars = (n: number) => <div className="stars">{[1, 2, 3].map((i) => <span key={i} className={i <= n ? "" : "off"}>★</span>)}</div>;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engRef = useRef<Engine | null>(null);
  const [screen, setScreen] = useState<Screen>("title");
  const [hud, setHud] = useState<Hud | null>(null);
  const [loading, setLoading] = useState({ on: true, p: 0.02, label: "Waking up" });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [toast, setToast] = useState<{ t: string; k: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [sel, setSel] = useState({ map: "atoll", aircraft: "pa28", mission: "school" as MissionId, tod: "dawn" as TodId });
  const [showFps, setShowFps] = useState(false);
  const [legend, setLegend] = useState(true);
  const fsx = useFullscreen();
  const screenRef = useRef<Screen>("title");
  const coarse = isCoarse();
  screenRef.current = screen;

  const doLoad = useCallback(async (s: typeof sel) => {
    const e = engRef.current; if (!e) return;
    setLoading({ on: true, p: 0.05, label: "Loading" });
    try {
      await e.load({ mode: s.map === "space" ? "space" : "air", map: s.map, tod: s.tod, aircraft: s.aircraft, mission: s.mission }, (p, label) => setLoading({ on: true, p, label }));
    } catch (err) { console.error(err); }
    setLoading({ on: false, p: 1, label: "" });
  }, []);

  // engine lifecycle
  useEffect(() => {
    if (!canvasRef.current || engRef.current) return;
    const q = new URLSearchParams(location.search);
    const s0 = loadSettings();
    const e = new Engine(canvasRef.current, (h) => setHud(h), (ev) => {
      if (ev.type === "result" && ev.result) { setResult(ev.result); setPaused(false); }
      else if (ev.type === "togglePause" || ev.type === "autoPause") {
        if (screenRef.current !== "game") return;
        if (e.phase === "playing") { e.pause(true); setPaused(true); } else if (e.phase === "paused" && ev.type === "togglePause") { e.pause(false); setPaused(false); }
      } else if (ev.text) setToast({ t: ev.text, k: Math.random() });
    });
    e.settings = s0; e.applyQuality();
    if (q.has("pr")) { e.maxPR = e.minPR = e.pr = Number(q.get("pr")); e.resize(); }
    engRef.current = e;
    (window as unknown as { __engine: Engine }).__engine = e;
    const init = { map: q.get("map") || "atoll", aircraft: q.get("ac") || "pa28", mission: (q.get("mission") as MissionId) || "school", tod: (q.get("tod") as TodId) || "dawn" };
    setSel(init);
    doLoad(init).then(() => {
      if (q.has("auto")) { e.start(); setScreen("game"); const cam = Number(q.get("cam") ?? 0); e.setCamera(cam); if (q.has("thr")) e.setThrottle(Number(q.get("thr"))); }
    });
    const prevent = (ev: Event) => ev.preventDefault();
    document.addEventListener("gesturestart", prevent as EventListener); document.addEventListener("contextmenu", prevent);
    const tm = (ev: TouchEvent) => { if (screenRef.current === "game" && !(ev.target as HTMLElement).closest?.(".panel")) ev.preventDefault(); };
    document.addEventListener("touchmove", tm, { passive: false });
    return () => { document.removeEventListener("touchmove", tm); };
  }, [doLoad]);

  useEffect(() => { try { localStorage.setItem("dream-settings", JSON.stringify(settings)); } catch { /* ignore */ } engRef.current?.setSettings(settings); }, [settings]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 2100); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { if (screen === "game") { const t = setTimeout(() => setLegend(false), 9000); return () => clearTimeout(t); } }, [screen]);

  // canvas drag for look / orbit
  useEffect(() => {
    const c = canvasRef.current!; const ptrs = new Map<number, { x: number; y: number }>(); let pd = 0;
    const down = (e: PointerEvent) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); c.setPointerCapture(e.pointerId); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pd = Math.hypot(a.x - b.x, a.y - b.y); } };
    const move = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 1) engRef.current?.orbitDrag(dx, dy);
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pd) engRef.current?.orbitZoom(pd / d); pd = d; }
    };
    const up = (e: PointerEvent) => { ptrs.delete(e.pointerId); };
    const wheel = (e: WheelEvent) => engRef.current?.orbitZoom(e.deltaY > 0 ? 1.08 : 0.93);
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move); c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up); c.addEventListener("wheel", wheel, { passive: true });
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up); c.removeEventListener("wheel", wheel); };
  }, []);

  const e = engRef.current;
  const set = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));

  const pickMap = async (id: string) => {
    if (id === sel.map || loading.on) return;
    const next = { ...sel, map: id, mission: id === "space" ? ("school" as MissionId) : sel.mission === "route" || sel.mission === "free" || sel.mission === "school" ? sel.mission : "school", tod: id === "space" ? sel.tod : (MAPS.find((m) => m.id === id)!.defaultTod) };
    setSel(next); await doLoad(next);
  };
  const pickAircraft = async (id: string) => { if (id === sel.aircraft) return; setSel({ ...sel, aircraft: id }); if (sel.map !== "space") await e?.swapAircraft(id); };
  const pickTod = (t: TodId) => { setSel({ ...sel, tod: t }); e?.swapTod(t); };
  const pickMission = (m: MissionId) => { setSel({ ...sel, mission: m }); if (e) { e.mission = m; e.resetMission(); } };

  const launch = () => { if (!e || loading.on) return; e.mission = sel.mission; e.resetMission(); e.start(); setResult(null); setPaused(false); setScreen("game"); setLegend(true); };
  const toSetup = () => { e?.toMenuPreview(); e?.pause(false); setPaused(false); setResult(null); setScreen("setup"); };
  const resume = () => { e?.pause(false); setPaused(false); };
  const restart = () => { e?.restart(); setPaused(false); setResult(null); };

  const isSpace = sel.map === "space";
  const map = MAPS.find((m) => m.id === sel.map);
  const ac = AIRCRAFT.find((a) => a.id === sel.aircraft)!;
  const missions: { id: MissionId; label: string }[] = isSpace ? [{ id: "school", label: "Docking school" }, { id: "free", label: "Free dock" }] : [{ id: "school", label: "Flight school" }, { id: "route", label: "Dream route" }, { id: "free", label: "Free flight" }];

  return (
    <div className="app">
      <div className="stage"><canvas ref={canvasRef} /></div>
      <div className="dream-fx" />

      {screen === "title" && (
        <div className="layer title">
          <div>
            <h1><b>A DREAMCORE FLIGHT SIMULATOR</b>Liminal Wings</h1>
            <p>a flight into somewhere you almost remember</p>
            <button className="btn big" disabled={loading.on} onClick={() => { e?.audio.start(); setScreen("setup"); }}>Begin</button>
          </div>
          <div className="small"><button onClick={() => setShowCredits(true)}>Credits &amp; licenses</button><button onClick={() => setShowSettings(true)}>Settings</button></div>
        </div>
      )}

      {screen === "setup" && (
        <div className="layer setup">
          <header>
            <button className="icon-btn" onClick={() => setScreen("title")} aria-label="Back">‹</button>
            <h2>Choose your flight</h2>
            {fsx.can && <button className="icon-btn" onClick={fsx.toggle} aria-label="Fullscreen">{fsx.fs ? "⤡" : "⤢"}</button>}
            <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">⚙</button>
          </header>
          <section className="col">
            <h3>DESTINATION</h3>
            {[...MAPS, SPACE as unknown as (typeof MAPS)[number]].map((m) => (
              <button key={m.id} className={"card " + (sel.map === m.id ? "sel" : "")} onClick={() => pickMap(m.id)}>
                <div className="art" style={{ background: m.art }} />
                <b>{m.name}</b><span>{m.sub}</span>
                <div className="dots">{[1, 2, 3].map((i) => <i key={i} className={i <= m.difficulty ? "on" : ""} />)}<span style={{ margin: 0 }}>&nbsp;{["Easy", "Medium", "Hard"][m.difficulty - 1]}</span></div>
              </button>
            ))}
          </section>
          <div className="centerinfo">
            <b>{isSpace ? "Ranger" : ac.name}</b>
            {isSpace ? SPACE.blurb : ac.blurb}
            <br /><small style={{ opacity: 0.8 }}>{map?.blurb}</small>
          </div>
          <section className="col">
            <h3>{isSpace ? "SPACECRAFT" : "AIRCRAFT"}</h3>
            {isSpace ? (
              <button className="card sel"><b>Ranger</b><span>Interstellar-style shuttle</span><div className="stats">{[["THRUST", 4], ["AGILITY", 5], ["EASE", 2]].map(([l, v]) => <div key={l as string}>{l}<em><i style={{ width: `${(v as number) * 20}%` }} /></em></div>)}</div></button>
            ) : AIRCRAFT.map((a) => (
              <button key={a.id} className={"card " + (sel.aircraft === a.id ? "sel" : "")} onClick={() => pickAircraft(a.id)}>
                <b>{a.name}</b><span>{a.maker} · {a.cls}</span>
                <div className="stats">{[["SPEED", a.ui.speed], ["AGILITY", a.ui.agility], ["EASE", a.ui.ease]].map(([l, v]) => <div key={l as string}>{l}<em><i style={{ width: `${(v as number) * 20}%` }} /></em></div>)}</div>
              </button>
            ))}
          </section>
          <footer>
            <div className="chips"><label>MISSION</label>{missions.map((m) => <button key={m.id} className={"chip " + (sel.mission === m.id ? "sel" : "")} onClick={() => pickMission(m.id)}>{m.label}</button>)}
              {!isSpace && <><label style={{ marginLeft: 8 }}>TIME</label>{(Object.keys(TODS) as TodId[]).map((t) => <button key={t} className={"chip " + (sel.tod === t ? "sel" : "")} onClick={() => pickTod(t)}>{TODS[t].label}</button>)}</>}
            </div>
            <button className="btn big" disabled={loading.on} onClick={launch}>Launch ▸</button>
          </footer>
        </div>
      )}

      {screen === "game" && hud && e && (
        <>
          <HudView hud={hud} units={settings.units} showFps={showFps} />
          {(coarse || true) && <TouchControls engine={e} hud={hud} />}
          <div className="topbtns">
            <button className="icon-btn" onClick={() => e.cycleCamera()} aria-label="Camera">◎<small>{hud.camera.toUpperCase()}</small></button>
            <button className="icon-btn" onClick={() => { e.pause(true); setPaused(true); }} aria-label="Pause">❚❚</button>
          </div>
          {toast && <div key={toast.k} className="toast">{toast.t}</div>}
          {!coarse && legend && (
            <div className="legend">
              <div><kbd>W</kbd><kbd>S</kbd> pitch {settings.invertPitch ? "(inverted)" : "(W = nose down)"} · <kbd>A</kbd><kbd>D</kbd> roll · <kbd>Q</kbd><kbd>E</kbd> yaw</div>
              <div><kbd>Shift</kbd><kbd>Ctrl</kbd> throttle · <kbd>Space</kbd> brake · <kbd>F</kbd> flaps · <kbd>C</kbd> camera · <kbd>P</kbd> pause · <kbd>V</kbd> assist{hud.kind === "space" ? " · Arrows RCS · Z/X fwd/back" : ""}</div>
            </div>
          )}
        </>
      )}

      {screen === "game" && paused && !result && (
        <div className="overlay"><div className="panel">
          <h2>Paused</h2><p className="sub">Take a breath. The sky will wait.</p>
          <div className="pgrid">
            <button className="btn" onClick={resume}>Resume</button>
            <button className="btn ghost" onClick={restart}>Restart</button>
            <button className="btn ghost" onClick={() => { e?.cycleCamera(); }}>Camera: {hud?.camera}</button>
            <button className="btn ghost" onClick={() => e?.toggleAssist()}>{hud?.kind === "space" ? "Docking mode" : "Assist"}: {hud?.assist ? "On" : "Off"}</button>
            <button className="btn ghost" onClick={() => setShowSettings(true)}>Settings</button>
            {fsx.can ? <button className="btn ghost" onClick={fsx.toggle}>{fsx.fs ? "Exit fullscreen" : "Fullscreen"}</button> : <button className="btn ghost" onClick={() => setShowCredits(true)}>Credits</button>}
            <button className="btn ghost" style={{ gridColumn: "1 / -1" }} onClick={toSetup}>‹ Back to hangar</button>
          </div>
        </div></div>
      )}

      {screen === "game" && result && (
        <div className="overlay"><div className="panel">
          <h2>{result.title}</h2><p className="sub">{result.sub}</p>
          {result.kind !== "crashed" && stars(result.stars)}
          <div className="lines">{result.lines.map((l, i) => <div key={i}><span>{l.label}</span><b>{l.value}</b>{l.pts !== undefined && <em>{l.pts > 0 ? "+" : ""}{l.pts}</em>}</div>)}</div>
          {result.kind !== "crashed" && <div className="score">{result.score}<small>SCORE · BEST {Math.max(result.best, result.score)}</small></div>}
          <div className="btns"><button className="btn" onClick={restart}>{result.kind === "crashed" ? "Try again" : "Fly again"}</button><button className="btn ghost" onClick={toSetup}>Hangar</button></div>
        </div></div>
      )}

      {showSettings && (
        <div className="overlay" style={{ zIndex: 50 }}><div className="panel" style={{ width: "min(92vw, 460px)" }}>
          <h2>Settings</h2>
          <div className="row"><div>Graphics<small>Higher looks richer, lower flies smoother</small></div><div className="seg">{["Low", "Medium", "High"].map((l, i) => <button key={l} className={settings.quality === i ? "sel" : ""} onClick={() => set({ quality: i as 0 | 1 | 2 })}>{l}</button>)}</div></div>
          <div className="row"><div>Units</div><div className="seg"><button className={settings.units === "metric" ? "sel" : ""} onClick={() => set({ units: "metric" })}>km/h · m</button><button className={settings.units === "imperial" ? "sel" : ""} onClick={() => set({ units: "imperial" })}>kt · ft</button></div></div>
          <div className="row"><div>Flight assist<small>Levels wings, holds climb, prevents stalls</small></div><button className={"tog " + (settings.assist ? "on" : "")} onClick={() => set({ assist: !settings.assist })}><i /></button></div>
          <div className="row"><div>Stick direction<small>{settings.invertPitch ? "Drag UP to climb" : "Drag DOWN to climb (real aircraft)"}</small></div><div className="seg"><button className={!settings.invertPitch ? "sel" : ""} onClick={() => set({ invertPitch: false })}>Standard</button><button className={settings.invertPitch ? "sel" : ""} onClick={() => set({ invertPitch: true })}>Inverted</button></div></div>
          <div className="row"><div>Control sensitivity</div><input type="range" min="0.6" max="1.25" step="0.05" value={settings.sensitivity} onChange={(ev) => set({ sensitivity: Number(ev.target.value) })} /></div>
          <div className="row"><div>Sound</div><button className={"tog " + (settings.sound ? "on" : "")} onClick={() => set({ sound: !settings.sound })}><i /></button></div>
          <div className="row"><div>Camera shake</div><button className={"tog " + (settings.shake ? "on" : "")} onClick={() => set({ shake: !settings.shake })}><i /></button></div>
          <div className="row"><div>Show FPS</div><button className={"tog " + (showFps ? "on" : "")} onClick={() => setShowFps(!showFps)}><i /></button></div>
          <div className="btns"><button className="btn" onClick={() => setShowSettings(false)}>Done</button></div>
        </div></div>
      )}

      {showCredits && (
        <div className="overlay" style={{ zIndex: 50 }}><div className="panel" style={{ width: "min(92vw, 520px)" }}>
          <h2>Credits &amp; licenses</h2>
          <div className="credits">
            <p><b>Aircraft models</b> — Flightradar24 “fr24-3d-models” (github.com/Flightradar24/fr24-3d-models), derived from the FlightGear FGMEMBERS community aircraft (Piper PA-28, ASK 21, ATR 42, Cessna Citation, Airbus A320, Beluga). Licensed GPLv2; optimised and re-packed for the web. Source and licenses at the linked repositories.</p>
            <p><b>Flight dynamics</b> — rigid-body stability-derivative model after Stevens &amp; Lewis and Beard &amp; McLain (stall blending), ISA atmosphere, spring-damper gear. Written for this game; simplified (no compressibility or propwash).</p>
            <p><b>Libraries</b> — three.js (MIT), simplex-noise (MIT), alea (MIT), React. Terrain, sky, clouds, airport, Ranger and Endurance are procedural. Audio is synthesised.</p>
            <p>Inspired by Interstellar’s Ranger docking sequence. No film assets used.</p>
          </div>
          <div className="btns"><button className="btn" onClick={() => setShowCredits(false)}>Close</button></div>
        </div></div>
      )}

      <div className={"loading " + (loading.on ? "" : "off")}>
        <div className="box"><h2>Liminal Wings</h2><div className="pbar"><i style={{ width: `${loading.p * 100}%` }} /></div><small>{loading.label.toUpperCase()}</small></div>
      </div>
      <div className="rotate"><div><i>⟳</i>Rotate your device<br />to landscape</div></div>
    </div>
  );
}
