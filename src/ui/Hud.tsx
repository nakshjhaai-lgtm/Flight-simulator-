import type { Hud, Settings } from "../game/engine";
import { cardinal, speedReading, heightReading, vsReading, hdgText } from "../game/instruments";

/**
 * Flight HUD.
 *
 * Everything a pilot reads often lives in one card; everything they read rarely is hidden
 * until it is true (a warning, a hint, an out-of-tolerance docking value). The numbers come
 * from the same formatters the 3-D cockpit panel uses, so the two never disagree.
 */
export function HudView({ hud, units, showFps }: { hud: Hud; units: Settings["units"]; showFps: boolean }) {
  const space = hud.kind === "space";
  const hl = hud.tut?.hl;
  const sd = space && hud.space ? hud.space : null;
  const spd = space ? { v: hud.speed, unit: "m/s" } : speedReading(hud.speed, units);
  const hgt = space ? { v: Math.round(hud.alt), unit: "m" } : heightReading(hud.alt, units);
  const vs = vsReading(hud.vs, units);
  // docking tolerances: only shout about the one the pilot has to fix
  const dock = sd?.dock;
  const dockBad = dock ? dock.ok.findIndex((ok) => !ok) : -1;

  return (
    <div className="hud">
      {/* ── one primary flight card ─────────────────────────────────────── */}
      <div className={"pcard " + (hl === "speed" || hl === "alt" ? "hl" : "")}>
        <div className="pmain">
          <span className="lab">{space ? "SPEED" : "SPEED"}</span>
          <b>{typeof spd.v === "number" && !space ? spd.v : spd.v.toFixed(space ? 1 : 0)}</b>
          <small>{spd.unit}</small>
        </div>
        {!space && (
          <div className="bar">
            <i className="z red" style={{ left: 0, width: `${pct(hud.vStall, hud.vMax)}%` }} />
            <i className="z yel" style={{ left: `${pct(hud.vStall, hud.vMax)}%`, width: `${pct(hud.vStall * 1.3, hud.vMax) - pct(hud.vStall, hud.vMax)}%` }} />
            <i className="z grn" style={{ left: `${pct(hud.vStall * 1.3, hud.vMax)}%`, width: `${pct(hud.vMax * 0.82, hud.vMax) - pct(hud.vStall * 1.3, hud.vMax)}%` }} />
            <i className="z red" style={{ left: `${pct(hud.vMax * 0.82, hud.vMax)}%`, right: 0 }} />
            {isRolling(hud.state) ? <u className="rot" style={{ left: `${pct(hud.vStall * 1.22, hud.vMax)}%` }}><em>ROTATE</em></u> : null}
            <span className="needle" style={{ left: `${pct(hud.speed, hud.vMax)}%` }} />
          </div>
        )}
        {space && <div className="bar space"><span className="needle" style={{ left: `${Math.min(100, (hud.speed / 60) * 100)}%` }} /></div>}
        <div className="prow">
          <div className={"pcell " + (hl === "alt" ? "hl" : "")}>
            <span className="lab">{space ? "RANGE" : "HEIGHT"}</span>
            <b>{hgt.v}</b><small>{hgt.unit}</small>
          </div>
          <div className="pcell">
            <span className="lab">{space ? "CLOSING" : "V/S"}</span>
            <b className={space ? "" : hud.vs > 0.5 ? "up" : hud.vs < -0.5 ? "dn" : ""}>
              {space ? hud.vs.toFixed(1) : `${hud.vs > 0.5 ? "▲" : hud.vs < -0.5 ? "▼" : ""}${Math.abs(vs.v)}`}
            </b>
            <small>{space ? "m/s" : vs.unit}</small>
          </div>
          {!space && (
            <div className="pcell hdg">
              <span className="lab">HDG</span>
              <b>{hdgText(hud.hdg)}</b><small>{cardinal(hud.hdg)}</small>
            </div>
          )}
        </div>
      </div>

      {/* ── objective / tutorial, centred and only as big as it needs to be ─ */}
      <div className="hud-tc">
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

      {/* ── one status pill top-right ───────────────────────────────────── */}
      <div className="hud-tr-state">
        <span className="state">{hud.state}{!space && !hud.assist ? <i className="man"> · MANUAL</i> : null}</span>
        {showFps && <span className="fps">{hud.fps} fps</span>}
      </div>

      {/* ── docking: a single strip; the failing value is the loud one ──── */}
      {dock && (
        <div className={"dock " + (dockBad === -1 ? "all" : "")}>
          {[
            { k: "OFFSET", v: `${dock.lateral.toFixed(1)} m`, ok: dock.ok[0] },
            { k: "ALIGN", v: `${dock.angle.toFixed(0)}°`, ok: dock.ok[1] },
            { k: "SPIN", v: `${(dock.spinDelta * 9.549).toFixed(1)} rpm`, ok: dock.ok[2] },
            { k: "CLOSING", v: `${dock.closing.toFixed(1)} m/s`, ok: dock.ok[3] },
          ].map((d, i) => (
            <div key={d.k} className={d.ok ? "ok" : i === dockBad ? "bad" : "dim"}>
              <span>{d.k}</span><b>{d.v}</b>
            </div>
          ))}
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

const pct = (v: number, max: number) => Math.min(100, Math.max(0, (v / Math.max(1, max)) * 100));
const isRolling = (state: string) => state === "Parked" || state === "Taking off" || state === "Taxiing" || state === "Stopped";
