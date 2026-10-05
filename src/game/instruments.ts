/**
 * One source of truth for the numbers a pilot reads.
 *
 * The 2-D HUD and the 3-D cockpit panel used to format their own copies of the same
 * telemetry, which is how they drifted apart (the HUD followed the units setting, the
 * panel was hard-wired to knots; one read height above ground, the other sea level).
 * Everything that shows a speed, an altitude or a rate now goes through these helpers, so
 * the panel and the HUD cannot disagree.
 */

export type Units = "metric" | "imperial";

/** Every value the flight instruments need, in SI. Convert only at the edges, here. */
export interface InstrumentData {
  units: Units;
  ias: number; // calibrated airspeed, m/s
  agl: number; // height above the ground, m
  alt: number; // altitude above sea level, m
  vs: number; // vertical speed, m/s (+ up)
  hdg: number; // deg, 0 = north
  pitch: number; // deg
  bank: number; // deg, + = right wing down
  g: number; // load factor
  thr: number; // 0..1
  flaps: number; // detent 0..2
  vStall: number; // m/s
  vFlapStall: number; // m/s
  vMax: number; // m/s
}

export const KT = 1.94384;
export const KMH = 3.6;
export const FT = 3.28084;
export const FPM = 196.85;

export interface Reading { v: number; unit: string; text: string }

/** Airspeed in whatever units the player picked. */
export function speedReading(ias: number, units: Units): Reading {
  const v = units === "metric" ? ias * KMH : ias * KT;
  const unit = units === "metric" ? "km/h" : "kt";
  return { v: Math.round(v), unit, text: `${Math.round(v)} ${unit}` };
}

/** Height above the ground — what the HUD calls HEIGHT and the panel calls RADIO ALT. */
export function heightReading(agl: number, units: Units): Reading {
  const v = units === "metric" ? agl : agl * FT;
  const unit = units === "metric" ? "m" : "ft";
  return { v: Math.round(v), unit, text: `${Math.round(v)} ${unit}` };
}

/** Altitude above sea level for the altimeter. */
export function altReading(alt: number, units: Units): Reading {
  const v = units === "metric" ? alt : alt * FT;
  const unit = units === "metric" ? "m" : "ft";
  return { v: Math.round(v), unit, text: `${Math.round(v)} ${unit}` };
}

/** Vertical speed: m/s in metric, ft/min on the imperial panel. */
export function vsReading(vs: number, units: Units): Reading {
  const v = units === "metric" ? vs : vs * FPM;
  const unit = units === "metric" ? "m/s" : "fpm";
  return { v: Math.round(v), unit, text: `${v > 0 ? "+" : ""}${Math.round(v)} ${unit}` };
}

export const hdgText = (hdg: number) => `${Math.round((((hdg % 360) + 360) % 360)).toString().padStart(3, "0")}°`;

const CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const cardinal = (h: number) => CARD[Math.round((((h % 360) + 360) % 360) / 45) % 8];
