import { useCallback, useEffect, useRef, useState } from "react";
import type { Engine, Hud } from "../game/engine";

/** Pointer-captured virtual stick. y>0 = dragged DOWN = pull back = nose up. */
function Stick({ engine, hl, space }: { engine: Engine; hl: boolean; space: boolean }) {
  const pad = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0, r: 60 });

  const apply = (cx: number, cy: number) => {
    const c = center.current;
    let dx = cx - c.x, dy = cy - c.y;
    const m = Math.hypot(dx, dy), lim = c.r;
    if (m > lim) { dx = (dx / m) * lim; dy = (dy / m) * lim; }
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    let x = dx / lim, y = dy / lim;
    const dz = 0.07;
    x = Math.abs(x) < dz ? 0 : (x - Math.sign(x) * dz) / (1 - dz);
    y = Math.abs(y) < dz ? 0 : (y - Math.sign(y) * dz) / (1 - dz);
    engine.touch.x = x; engine.touch.y = y;
  };
  const release = () => {
    id.current = null;
    engine.touch.x = 0; engine.touch.y = 0;
    if (knob.current) knob.current.style.transform = "translate(0px,0px)";
    pad.current?.classList.remove("on");
  };
  const down = (e: React.PointerEvent) => {
    if (id.current !== null) return;
    e.preventDefault();
    id.current = e.pointerId;
    pad.current!.setPointerCapture(e.pointerId);
    const r = pad.current!.getBoundingClientRect();
    center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width * 0.36 };
    pad.current!.classList.add("on");
    apply(e.clientX, e.clientY);
  };
  const move = (e: React.PointerEvent) => { if (e.pointerId === id.current) { e.preventDefault(); apply(e.clientX, e.clientY); } };
  const up = (e: React.PointerEvent) => { if (e.pointerId === id.current) release(); };
  useEffect(() => release, []); // eslint-disable-line

  return (
    <div className={"stick-wrap " + (hl ? "hl" : "")} data-ctl="stick">
      <div ref={pad} className="stick" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={(e) => e.preventDefault()}>
        <i className="tick t-up">{space ? "NOSE DOWN" : "DIVE"}</i><i className="tick t-dn">{space ? "NOSE UP" : "CLIMB"}</i>
        <i className="tick t-l">⟲ ROLL</i><i className="tick t-r">ROLL ⟳</i>
        <div className="ring r1" /><div className="ring r2" />
        <div ref={knob} className="knob"><span /></div>
      </div>
    </div>
  );
}

function Throttle({ engine, hud, hl }: { engine: Engine; hud: Hud; hl: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const set = (cy: number) => {
    const r = track.current!.getBoundingClientRect();
    const pad = 18;
    const v = 1 - (cy - r.top - pad) / (r.height - pad * 2);
    engine.setThrottle(Math.round(Math.min(1, Math.max(0, v)) * 100) / 100);
  };
  const down = (e: React.PointerEvent) => { if (id.current !== null) return; e.preventDefault(); id.current = e.pointerId; track.current!.setPointerCapture(e.pointerId); set(e.clientY); };
  const move = (e: React.PointerEvent) => { if (e.pointerId === id.current) { e.preventDefault(); set(e.clientY); } };
  const up = (e: React.PointerEvent) => { if (e.pointerId === id.current) id.current = null; };
  const t = hud.thr;
  return (
    <div className={"thr-wrap " + (hl ? "hl" : "")} data-ctl="throttle">
      <div className="thr-label">{hud.kind === "space" ? "THRUST" : "POWER"}</div>
      <div ref={track} className="thr" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
        <div className="thr-fill" style={{ height: `calc((100% - 36px) * ${t})` }} />
        <div className="thr-ticks">{[0, 1, 2, 3, 4].map((i) => <b key={i} />)}</div>
        <div className="thr-knob" style={{ bottom: `calc(18px + (100% - 36px) * ${t} - 17px)` }}><span /></div>
      </div>
      <div className="thr-val">{Math.round(t * 100)}<small>%</small></div>
    </div>
  );
}

function HoldBtn({ children, onDown, onUp, className, dataCtl }: { children: React.ReactNode; onDown: () => void; onUp: () => void; className?: string; dataCtl?: string }) {
  const id = useRef<number | null>(null);
  const [on, setOn] = useState(false);
  const rel = () => { if (id.current !== null) { id.current = null; setOn(false); onUp(); } };
  useEffect(() => rel, []); // eslint-disable-line
  return (
    <button
      data-ctl={dataCtl}
      className={`hold ${className ?? ""} ${on ? "on" : ""}`}
      onPointerDown={(e) => { e.preventDefault(); if (id.current !== null) return; id.current = e.pointerId; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setOn(true); onDown(); }}
      onPointerUp={(e) => { if (e.pointerId === id.current) rel(); }}
      onPointerCancel={(e) => { if (e.pointerId === id.current) rel(); }}
      onLostPointerCapture={rel}
      onContextMenu={(e) => e.preventDefault()}
    >{children}</button>
  );
}

function RcsPad({ engine, hl }: { engine: Engine; hl: boolean }) {
  const pad = useRef<HTMLDivElement>(null); const knob = useRef<HTMLDivElement>(null); const id = useRef<number | null>(null);
  const apply = (cx: number, cy: number) => {
    const r = pad.current!.getBoundingClientRect(); const R = r.width * 0.34;
    let dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2); const m = Math.hypot(dx, dy); if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
    knob.current!.style.transform = `translate(${dx}px,${dy}px)`;
    engine.touch.rx = Math.abs(dx / R) < 0.1 ? 0 : dx / R; engine.touch.ry = Math.abs(dy / R) < 0.1 ? 0 : -dy / R;
  };
  const rel = () => { id.current = null; engine.touch.rx = 0; engine.touch.ry = 0; if (knob.current) knob.current.style.transform = "translate(0,0)"; };
  useEffect(() => rel, []); // eslint-disable-line
  return (
    <div ref={pad} data-ctl="rcs" className={"rcs " + (hl ? "hl" : "")}
      onPointerDown={(e) => { if (id.current !== null) return; e.preventDefault(); id.current = e.pointerId; pad.current!.setPointerCapture(e.pointerId); apply(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (e.pointerId === id.current) apply(e.clientX, e.clientY); }}
      onPointerUp={(e) => { if (e.pointerId === id.current) rel(); }} onPointerCancel={rel} onLostPointerCapture={rel}>
      <i className="tick t-up">UP</i><i className="tick t-dn">DOWN</i><i className="tick t-l">◀</i><i className="tick t-r">▶</i>
      <div className="rcs-label">RCS</div>
      <div ref={knob} className="knob small"><span /></div>
    </div>
  );
}

export function TouchControls({ engine, hud }: { engine: Engine; hud: Hud }) {
  const hl = hud.tut?.hl ?? "";
  const space = hud.kind === "space";
  const yawL = useCallback(() => (engine.touch.yaw = -1), [engine]);
  const yawR = useCallback(() => (engine.touch.yaw = 1), [engine]);
  const yawO = useCallback(() => (engine.touch.yaw = 0), [engine]);
  const flapLabel = ["UP", "TAKEOFF", "LANDING"][hud.flaps] ?? "UP";
  useEffect(() => () => { engine.touch.x = engine.touch.y = engine.touch.yaw = 0; engine.touch.brake = false; engine.touch.rx = engine.touch.ry = engine.touch.rz = 0; }, [engine]);
  return (
    <div className="touch-layer">
      <Stick engine={engine} hl={hl === "stick"} space={space} />
      <div className="right-cluster">
        <div className="mid-cluster">
          <div className="mid-top">
            <HoldBtn dataCtl="brake" className={"brake " + (hl === "brake" ? "hl" : "")} onDown={() => (engine.touch.brake = true)} onUp={() => (engine.touch.brake = false)}>{space ? "RETRO" : "BRAKE"}</HoldBtn>
            {space ? (
              <button className={"chip-btn " + (hud.assist ? "active" : "")} onClick={() => engine.toggleAssist()}>DOCKING<br />MODE</button>
            ) : (
              <button data-ctl="flaps" className={"chip-btn " + (hl === "flaps" ? "hl" : "")} onClick={() => engine.cycleFlaps()}>FLAPS<br /><b>{flapLabel}</b></button>
            )}
          </div>
          <div className="mid-bot">
            <HoldBtn className="yaw" dataCtl="yawl" onDown={yawL} onUp={yawO}><span>◀</span><small>YAW</small></HoldBtn>
            <HoldBtn className="yaw" dataCtl="yawr" onDown={yawR} onUp={yawO}><span>▶</span><small>YAW</small></HoldBtn>
          </div>
        </div>
        {space && (
          <div className="rcs-col">
            <RcsPad engine={engine} hl={hl === "rcs"} />
            <div className="rz">
              <HoldBtn className="rzb" onDown={() => (engine.touch.rz = 1)} onUp={() => (engine.touch.rz = 0)}>▲<small>FWD</small></HoldBtn>
              <HoldBtn className="rzb" onDown={() => (engine.touch.rz = -1)} onUp={() => (engine.touch.rz = 0)}>▼<small>BACK</small></HoldBtn>
            </div>
          </div>
        )}
        <Throttle engine={engine} hud={hud} hl={hl === "throttle"} />
      </div>
    </div>
  );
}
