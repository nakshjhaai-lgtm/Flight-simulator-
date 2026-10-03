import type { Hud, Settings } from "../game/engine";

const CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const cardinal = (h: number) => CARD[Math.round(((h % 360) + 360) % 360 / 45) % 8];

export function fmtSpeed(ms: number, u: Settings["units"]) { return u === "metric" ? { v: Math.round(ms * 3.6), unit: "km/h" } : { v: Math.round(ms * 1.944), unit: "kt" }; }
export function fmtAlt(m: number, u: Settings["units"]) { return u === "metric" ? { v: Math.round(m), unit: "m" } : { v: Math.round(m * 3.281), unit: "ft" }; }

function SpeedBar({ hud, units }: { hud: Hud; units: Settings["units"] }) {
  const max = hud.vMax;
  const p = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const rot = hud.vStall * 1.22;
  const sp = fmtSpeed(hud.speed, units);
  return (
    <div className={"speed " + (hud.tut?.hl === "speed" ? "hl" : "")}>
      <div className="num"><span className="lab">SPEED</span><b>{sp.v}</b><small>{sp.unit}</small></div>
      <div className="bar">
        <i className="z red" style={{ left: 0, width: p(hud.vStall) }} />
        <i className="z yel" style={{ left: p(hud.vStall), width: `calc(${p(hud.vStall * 1.3)} - ${p(hud.vStall)})` }} />
        <i className="z grn" style={{ left: p(hud.vStall * 1.3), width: `calc(${p(max * 0.82)} - ${p(hud.vStall * 1.3)})` }} />
        <i className="z red" style={{ left: p(max * 0.82), right: 0 }} />
        {hud.state === "Parked" || hud.state === "Taking off" || hud.state === "Taxiing" ? <u className="rot" style={{ left: p(rot) }}><em>ROTATE</em></u> : null}
        <span className="needle" style={{ left: p(hud.speed) }} />
      </div>
    </div>
  );
}

export function HudView({ hud, units, showFps }: { hud: Hud; units: Settings["units"]; showFps: boolean }) {
  const alt = fmtAlt(hud.alt, units);
  const vs = units === "metric" ? hud.vs : hud.vs * 3.281;
  const space = hud.kind === "space";
  const hl = hud.tut?.hl;
  const sd = space && hud.space ? hud.space : null;
  return (
    <div className="hud">
      <div className="hud-tl">
        {space ? (
          <div className="speed">
            <div className="num"><span className="lab">SPEED</span><b>{(hud.speed).toFixed(1)}</b><small>m/s</small></div>
            <div className="bar space"><span className="needle" style={{ left: `${Math.min(100, (hud.speed / 60) * 100)}%` }} /></div>
          </div>
        ) : <SpeedBar hud={hud} units={units} />}
        <div className="row2">
          <div className={"mini " + (hl === "alt" ? "hl" : "")}><span className="lab">{space ? "RANGE" : "HEIGHT"}</span><b>{space ? Math.round(hud.alt) : alt.v}</b><small>{space ? "m" : alt.unit}</small></div>
          <div className="mini"><span className="lab">{space ? "CLOSING" : "CLIMB"}</span><b className={space ? "" : vs > 0.5 ? "up" : vs < -0.5 ? "dn" : ""}>{space ? hud.vs.toFixed(1) : (vs > 0 ? "▲ " : vs < 0 ? "▼ " : "") + Math.abs(vs).toFixed(units === "metric" ? 1 : 0)}</b><small>{space ? "m/s" : units === "metric" ? "m/s" : "ft/s"}</small></div>
        </div>
      </div>

      <div className="hud-tc">
        {!space && (
          <div className="compass"><b>{String(Math.round(hud.hdg) % 360).padStart(3, "0")}°</b><span>{cardinal(hud.hdg)}</span></div>
        )}
        {hud.tut ? (
          <div className={"tut " + (hud.tut.done ? "done" : "")}>
            <div className="dots">{Array.from({ length: hud.tut.n }).map((_, i) => <i key={i} className={i < hud.tut!.i ? "d" : i === hud.tut!.i ? "c" : ""} />)}</div>
            <h4>{hud.tut.done ? "✓ " : ""}{hud.tut.title}</h4>
            <p>{hud.tut.text}</p>
          </div>
        ) : (
          <div className="obj"><b>{hud.objective}</b>{hud.progress ? <span>{hud.progress}</span> : null}</div>
        )}
        {hud.warn ? <div className={"warn l" + hud.warnLevel}>{hud.warn}</div> : null}
      </div>

      <div className="hud-tr-state">
        <span className="state">{hud.state}</span>
        {!space && <span className={"att " + (hud.assist ? "on" : "")}>{hud.assist ? "ASSIST" : "MANUAL"}</span>}
        {showFps && <span className="fps">{hud.fps} fps</span>}
      </div>

      {sd && (
        <div className="dock">
          <div className={sd.dock.ok[0] ? "ok" : ""}><span>OFFSET</span><b>{sd.dock.lateral.toFixed(1)} m</b></div>
          <div className={sd.dock.ok[1] ? "ok" : ""}><span>ALIGN</span><b>{sd.dock.angle.toFixed(0)}°</b></div>
          <div className={sd.dock.ok[2] ? "ok" : ""}><span>SPIN Δ</span><b>{(sd.dock.spinDelta * 9.549).toFixed(1)} rpm</b></div>
          <div className={sd.dock.ok[3] ? "ok" : ""}><span>CLOSING</span><b>{sd.dock.closing.toFixed(1)} m/s</b></div>
        </div>
      )}

      {hud.hint && <div className={"hint " + hud.hint.tone}>{hud.hint.text}</div>}

      {hud.marker && (
        <div className={"marker " + (hud.marker.vis ? "in" : "out") + (hl === "marker" ? " hl" : "")} style={{ left: `${hud.marker.x}%`, top: `${hud.marker.y}%` }}>
          {hud.marker.vis ? <div className="ring" /> : <div className="arrow" style={{ transform: `rotate(${-hud.marker.edge}deg)` }} />}
          <span>{hud.marker.label} · {hud.marker.dist > 1000 ? (hud.marker.dist / 1000).toFixed(1) + " km" : Math.round(hud.marker.dist) + " m"}</span>
        </div>
      )}
    </div>
  );
}
