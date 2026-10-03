
export type V3 = [number, number, number];

export interface GearPoint {
  p: V3; // model coords (y = height above ground plane of model)
  kind: "wheel" | "skid";
  steer?: boolean;
  brake?: boolean;
  share: number; // fraction of weight carried
}

export interface Phys {
  mass: number; S: number; b: number; c: number; len: number;
  CL0: number; CLa: number; aStall: number; CD0: number; AR: number; e: number;
  Cm0: number; Cma: number; Cmq: number; CmdE: number;
  Clb: number; Clp: number; Clda: number; Cnb: number; Cnr: number; Cndr: number; CYb: number;
  flapCL: number; flapCD: number; flapCm: number;
  engine: "prop" | "jet";
  power: number; // W effective (prop)  | N total static thrust (jet)
  vc: number; // prop lapse speed
  spool: number; // seconds
  propTorque: number;
  vRef: number; // cruise speed for control scaling
  rollRate: number; pitchRate: number; // rad/s authority in assist mode
  brake: number; // wheel brake mu
  crashSink: number; // m/s
  maxFlapSpeed: number;
  startFlaps: number;
  Ixx: number; Iyy: number; Izz: number; // pitch(x) yaw(y) roll(z) inertias
}

export interface AircraftDef {
  id: string; name: string; maker: string; cls: string; blurb: string;
  url: string; yaw: number;
  cg: V3; gear: GearPoint[]; hull: V3[];
  eye: V3; cockpit: "ga" | "jet" | "liner" | "glider";
  spin: { re: RegExp; axis: "z" | "y" | "x"; rate: number }[];
  keep: RegExp;
  hideInCockpit?: RegExp;
  bounds: { len: number; span: number; h: number };
  phys: Phys;
  ui: { speed: number; agility: number; ease: number };
  chase: number; // chase distance
}

function mk(p: Partial<Phys> & Pick<Phys, "mass" | "S" | "b" | "c" | "len" | "power" | "engine" | "vRef">): Phys {
  const base: Phys = {
    mass: 1000, S: 15, b: 10, c: 1.5, len: 7,
    CL0: 0.32, CLa: 5.0, aStall: 0.26, CD0: 0.028, AR: 7.5, e: 0.78,
    Cm0: 0.0, Cma: -1.3, Cmq: -14, CmdE: 0.55,
    Clb: -0.07, Clp: -0.45, Clda: 0.06, Cnb: 0.08, Cnr: -0.12, Cndr: 0.07, CYb: 0.45,
    flapCL: 0.55, flapCD: 0.045, flapCm: -0.05,
    engine: "prop", power: 100000, vc: 40, spool: 0.7, propTorque: 0, vRef: 55,
    rollRate: 1.3, pitchRate: 0.55, brake: 0.55, crashSink: 6, maxFlapSpeed: 40, startFlaps: 0,
    Ixx: 0, Iyy: 0, Izz: 0,
  };
  const o = { ...base, ...p } as Phys;
  o.Izz = o.Izz || 0.04 * o.mass * (o.b / 2) ** 2;
  o.Ixx = o.Ixx || 0.03 * o.mass * o.len ** 2;
  o.Iyy = o.Iyy || 0.85 * (o.Izz + o.Ixx);
  // roll authority from desired steady roll rate at cruise
  o.Clda = Math.abs(o.Clp) * o.rollRate * o.b / (2 * o.vRef);
  return o;
}

export const AIRCRAFT: AircraftDef[] = [
  {
    id: "pa28",
    name: "Cherokee 180",
    maker: "Piper PA-28",
    cls: "Trainer",
    blurb: "Gentle, forgiving four-seater. The perfect first aircraft.",
    url: "", yaw: 0,
    cg: [-0.13, 0.9, 0.35],
    gear: [
      { p: [-0.13, 0, -1.76], kind: "wheel", steer: true, share: 0.14 },
      { p: [1.49, 0, 0.18], kind: "wheel", brake: true, share: 0.43 },
      { p: [-1.74, 0, 0.18], kind: "wheel", brake: true, share: 0.43 },
    ],
    hull: [[-5.2, 0.75, 0.7], [5.0, 0.75, 0.7], [-0.13, 1.0, -2.45], [-0.13, 1.9, 4.5], [-0.13, 0.5, 1.0]],
    eye: [-0.45, 1.36, 0.1], cockpit: "ga",
    spin: [
      { re: /^helice$/, axis: "y", rate: 1 },
      { re: /^propblur$|^propdisc$/, axis: "y", rate: 0 },
    ],
    keep: /^(helice|propblur|propdisc|aileron|volet)/i,
    hideInCockpit: /^(vitres|vitreporteG|propdisc)$/,
    bounds: { len: 7.1, span: 10.5, h: 2.7 },
    phys: mk({
      mass: 1100, S: 15.8, b: 10.8, c: 1.5, len: 7.2, CL0: 0.35, CLa: 4.8, aStall: 0.27, CD0: 0.028, AR: 7.4,
      engine: "prop", power: 128000, vc: 40, spool: 0.6, propTorque: 0.05, vRef: 55,
      rollRate: 1.35, pitchRate: 0.6, maxFlapSpeed: 40, crashSink: 5.5, CmdE: 0.6,
    }),
    ui: { speed: 2, agility: 4, ease: 5 },
    chase: 13,
  },
  {
    id: "ask21",
    name: "Silent Wing",
    maker: "Schleicher ASK 21",
    cls: "Glider",
    blurb: "Long graceful wings with a quiet electric sustainer. Floats forever.",
    url: "", yaw: Math.PI,
    cg: [-0.19, 0.75, 0.1],
    gear: [
      { p: [-0.19, 0.05, 0.9], kind: "wheel", brake: true, share: 0.6 },
      { p: [-0.19, 0.1, 3.1], kind: "wheel", share: 0.08 },
      { p: [-0.19, 0.2, -2.5], kind: "skid", share: 0.12 },
      { p: [-8.0, 0.5, 0.3], kind: "skid", share: 0.1 },
      { p: [7.7, 0.5, 0.3], kind: "skid", share: 0.1 },
    ],
    hull: [[-8.2, 0.7, 0.3], [8.1, 0.7, 0.3], [-0.19, 0.8, -3.5], [-0.19, 1.8, 3.7]],
    eye: [-0.19, 1.25, -1.45], cockpit: "glider",
    spin: [],
    keep: /^speedbrake/i,
    bounds: { len: 8.3, span: 17, h: 2.1 },
    phys: mk({
      mass: 620, S: 17.95, b: 17.0, c: 1.1, len: 8.3, CL0: 0.45, CLa: 5.6, aStall: 0.26, CD0: 0.0105, AR: 16.1, e: 0.92,
      engine: "prop", power: 52000, vc: 26, spool: 0.4, propTorque: 0, vRef: 32,
      rollRate: 0.95, pitchRate: 0.5, maxFlapSpeed: 30, crashSink: 4.0, CmdE: 0.5, Cma: -1.4, Clb: -0.08,
    }),
    ui: { speed: 1, agility: 4, ease: 3 },
    chase: 16,
  },
  {
    id: "atr42",
    name: "Skyhopper 42",
    maker: "ATR 42-500",
    cls: "Turboprop",
    blurb: "Twin turboprop regional liner. Strong climb, short fields, stable ride.",
    url: "", yaw: 0,
    cg: [0, 2.2, -0.8],
    gear: [
      { p: [-0.09, 0.05, -7.0], kind: "wheel", steer: true, share: 0.12 },
      { p: [3.0, 0.1, 0.4], kind: "wheel", brake: true, share: 0.44 },
      { p: [-3.0, 0.1, 0.4], kind: "wheel", brake: true, share: 0.44 },
    ],
    hull: [[-13.5, 3.8, -1.0], [13.5, 3.8, -1.0], [0, 2.5, -10.5], [0, 5.5, 11.6], [0, 1.3, 2.0]],
    eye: [-0.55, 3.15, -8.0], cockpit: "liner",
    spin: [{ re: /^Prop/i, axis: "y", rate: 1 }],
    keep: /^(Prop|rootNode)/i,
    hideInCockpit: /^(Prop2)$/,
    bounds: { len: 22.8, span: 27.7, h: 7.6 },
    phys: mk({
      mass: 16000, S: 54.5, b: 24.6, c: 2.4, len: 22.7, CL0: 0.4, CLa: 5.3, aStall: 0.26, CD0: 0.029, AR: 11.1,
      engine: "prop", power: 3200000, vc: 55, spool: 1.0, propTorque: 0.015, vRef: 105,
      rollRate: 0.7, pitchRate: 0.35, startFlaps: 1, maxFlapSpeed: 75, crashSink: 3.8, CmdE: 0.5, brake: 0.5,
    }),
    ui: { speed: 3, agility: 3, ease: 3 },
    chase: 34,
  },
  {
    id: "citation",
    name: "Cirrus Jet",
    maker: "Cessna Citation II",
    cls: "Light jet",
    blurb: "Quick, sleek business jet. Fast climb, high speed, needs a steady hand.",
    url: "", yaw: 0,
    cg: [0.03, 1.2, 0.2],
    gear: [
      { p: [0.03, 0.05, -3.3], kind: "wheel", steer: true, share: 0.1 },
      { p: [1.15, 0.05, 1.8], kind: "wheel", brake: true, share: 0.45 },
      { p: [-1.1, 0.05, 1.8], kind: "wheel", brake: true, share: 0.45 },
    ],
    hull: [[-7.6, 1.1, 1.2], [7.6, 1.1, 1.2], [0.03, 1.1, -6.1], [0.03, 3.6, 7.9], [0.03, 0.75, 2.0]],
    eye: [-0.4, 1.78, -3.0], cockpit: "jet",
    spin: [],
    keep: /^(LEngine_fan|REngine_fan)/i,
    hideInCockpit: /^(Glass|Glass_001|Glass_inside|Glass_001_inside)$/,
    bounds: { len: 14.5, span: 15.6, h: 4.1 },
    phys: mk({
      mass: 5400, S: 30, b: 15.8, c: 2.0, len: 14.4, CL0: 0.3, CLa: 5.0, aStall: 0.25, CD0: 0.022, AR: 8.3,
      engine: "jet", power: 40000, vc: 1, spool: 1.6, vRef: 130,
      rollRate: 1.0, pitchRate: 0.45, startFlaps: 1, maxFlapSpeed: 90, crashSink: 4.2, CmdE: 0.45, brake: 0.6,
    }),
    ui: { speed: 4, agility: 4, ease: 2 },
    chase: 24,
  },
  {
    id: "a320",
    name: "Horizon 320",
    maker: "Airbus A320",
    cls: "Airliner",
    blurb: "The classic narrow-body. Heavy, smooth and demanding: plan every approach.",
    url: "", yaw: 0,
    cg: [0, 1.9, 1.5],
    gear: [
      { p: [0, -0.7, -12.4], kind: "wheel", steer: true, share: 0.1 },
      { p: [-3.8, -0.7, 1.9], kind: "wheel", brake: true, share: 0.45 },
      { p: [3.8, -0.7, 1.9], kind: "wheel", brake: true, share: 0.45 },
    ],
    hull: [[-16.5, 1.9, 4.0], [16.5, 1.9, 4.0], [0, 2.0, -15.5], [0, 5.2, 21.5], [0, 0.0, 3.0]],
    eye: [-0.5, 3.5, -13.0], cockpit: "liner",
    spin: [],
    keep: /^(fanWheel|blades)/i,
    bounds: { len: 38.2, span: 33.9, h: 11.6 },
    phys: mk({
      mass: 62000, S: 122, b: 34.1, c: 4.2, len: 37.6, CL0: 0.3, CLa: 5.5, aStall: 0.24, CD0: 0.024, AR: 9.5,
      engine: "jet", power: 205000, vc: 1, spool: 2.2, vRef: 130,
      rollRate: 0.45, pitchRate: 0.25, startFlaps: 1, maxFlapSpeed: 90, crashSink: 3.5, CmdE: 0.4, brake: 0.5, flapCL: 0.8, flapCD: 0.05,
    }),
    ui: { speed: 5, agility: 2, ease: 2 },
    chase: 56,
  },
  {
    id: "beluga",
    name: "Great Whale",
    maker: "Airbus Beluga",
    cls: "Freighter",
    blurb: "A flying whale. Enormous, gentle and utterly dreamlike in the clouds.",
    url: "", yaw: 0,
    cg: [0, 1.6, 2.5],
    gear: [
      { p: [1.6, -1.0, -6.3], kind: "wheel", steer: true, share: 0.1 },
      { p: [-6.6, -1.0, 4.8], kind: "wheel", brake: true, share: 0.45 },
      { p: [9.7, -1.0, 4.8], kind: "wheel", brake: true, share: 0.45 },
    ],
    hull: [[-20, 4.5, 4.0], [23.5, 4.5, 4.0], [1.6, 2.0, -24.8], [1.6, 15.5, 29.5], [1.6, 0.0, 3.0]],
    eye: [-0.2, 5.0, -22.0], cockpit: "liner",
    spin: [{ re: /^eng\dFan$/i, axis: "z", rate: 1 }],
    keep: /^(eng\dFan)/i,
    bounds: { len: 55.5, span: 45, h: 17 },
    phys: mk({
      mass: 105000, S: 260, b: 44.8, c: 6.5, len: 56, CL0: 0.32, CLa: 5.3, aStall: 0.24, CD0: 0.036, AR: 7.7, e: 0.75,
      engine: "jet", power: 430000, vc: 1, spool: 2.6, vRef: 120,
      rollRate: 0.32, pitchRate: 0.2, startFlaps: 1, maxFlapSpeed: 85, crashSink: 3.2, CmdE: 0.4, brake: 0.5, flapCL: 0.8, flapCD: 0.06,
    }),
    ui: { speed: 3, agility: 1, ease: 2 },
    chase: 80,
  },
];

export const getAircraft = (id: string) => AIRCRAFT.find((a) => a.id === id) ?? AIRCRAFT[0];
