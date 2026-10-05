import * as THREE from "three";
import { createNoise2D, createNoise4D } from "simplex-noise";
import alea from "alea";

export type TodId = "dawn" | "day" | "sunset" | "twilight" | "night";

export interface MapDef {
  id: string; name: string; sub: string; blurb: string; difficulty: 1 | 2 | 3;
  defaultTod: TodId;
  seed: string; waterLevel: number; elev: number;
  rwHdg: number; rwLen: number; rwWid: number;
  wind: { speed: number; dir: number }; turbulence: number; fog: number;
  waterColor: string; accent: string; accent2: string;
  cloudCover: number; cloudAlt: number;
  art: string; // css gradient for card
  palette: "atoll" | "mesa" | "peaks";
}

export const MAPS: MapDef[] = [
  {
    id: "atoll", name: "Halcyon Atoll", sub: "Pastel archipelago · Dawn",
    blurb: "A sleepy island chain under an impossible pink sky. Gentle winds, long runway, floating doors in the sea.",
    difficulty: 1, defaultTod: "dawn", seed: "halcyon", waterLevel: 0, elev: 14, rwHdg: 80, rwLen: 1900, rwWid: 45,
    wind: { speed: 2.5, dir: 40 }, turbulence: 0.1, fog: 1, waterColor: "#58c7c9", accent: "#ff9ec7", accent2: "#7fe6e0",
    cloudCover: 0.7, cloudAlt: 1100,
    art: "linear-gradient(160deg,#ffb7c9 0%,#ffd9b0 45%,#7fe6e0 100%)", palette: "atoll",
  },
  {
    id: "mesa", name: "Velvet Mesas", sub: "Salt flats & canyons · Sunset",
    blurb: "Terracotta towers rise from a dry lakebed. Thermals bump you around and the gates slip through narrow canyons.",
    difficulty: 2, defaultTod: "sunset", seed: "velvet", waterLevel: -9999, elev: 420, rwHdg: 150, rwLen: 2300, rwWid: 50,
    wind: { speed: 5.5, dir: 300 }, turbulence: 0.45, fog: 0.8, waterColor: "#ffffff", accent: "#ff9a62", accent2: "#c59bff",
    cloudCover: 0.35, cloudAlt: 1500,
    art: "linear-gradient(160deg,#5a3d8a 0%,#ff8a5c 55%,#ffd08a 100%)", palette: "mesa",
  },
  {
    id: "peaks", name: "Lullaby Peaks", sub: "Alpine lake valley · Twilight",
    blurb: "A short alpine strip beside a glassy lake, ringed by snow ridges and aurora. Thin air, tight approach.",
    difficulty: 3, defaultTod: "twilight", seed: "lullaby", waterLevel: 868, elev: 905, rwHdg: 20, rwLen: 1500, rwWid: 40,
    wind: { speed: 4, dir: 200 }, turbulence: 0.3, fog: 1.1, waterColor: "#3a6fa8", accent: "#9bf0c8", accent2: "#ff8fd1",
    cloudCover: 0.5, cloudAlt: 2600,
    art: "linear-gradient(160deg,#16205e 0%,#7a5bd0 50%,#ff9fd0 100%)", palette: "peaks",
  },
];

export const getMap = (id: string) => MAPS.find((m) => m.id === id) ?? MAPS[0];

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export interface Terrain {
  height(x: number, z: number): number; // terrain surface (may be below water)
  toLocal(x: number, z: number, out: { x: number; z: number }): void;
  inAsphalt(x: number, z: number): boolean;
}

export function makeTerrainFn(map: MapDef): Terrain {
  const n2 = createNoise2D(alea(map.seed + "a"));
  const n2b = createNoise2D(alea(map.seed + "b"));
  const fbm = (x: number, z: number, o = 4) => {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < o; i++) { s += a * n2(x * f, z * f); a *= 0.5; f *= 2.03; }
    return s;
  };
  const hdg = (map.rwHdg * Math.PI) / 180;
  const phi = -hdg;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const toLocal = (x: number, z: number, out: { x: number; z: number }) => {
    out.x = x * cp - z * sp;
    out.z = x * sp + z * cp;
  };
  const tmp = { x: 0, z: 0 };
  const halfL = map.rwLen / 2 + 260;
  const atoll = () => {
    const blobs = [[0, 0, 4300], [-6200, 3800, 1800], [5200, -5600, 2200], [7800, 3500, 1500], [-3500, -7000, 1900], [1500, 8200, 1700], [-9500, -1500, 1200], [12000, -3000, 2400], [-13000, 7000, 1400], [-1500, -13000, 2600], [9000, 11000, 1900]];
    return (x: number, z: number) => {
      const warp = fbm(x / 1700, z / 1700, 3) * 0.32 + 0.1 * n2b(x / 380, z / 380);
      let f = -9;
      for (const b of blobs) {
        const d = Math.hypot(x - b[0], z - b[1]);
        f = Math.max(f, 1 - d / b[2] + warp);
      }
      const land = smooth(-0.03, 0.05, f);
      const seaH = -3 - 85 * Math.pow(clamp(-f * 2.0, 0, 1), 0.8);
      const ridge = 1 - Math.abs(n2b(x / 900 + 4, z / 900));
      const landH = 3 + 150 * Math.pow(Math.max(f, 0), 1.25) * (0.3 + 0.7 * ridge * ridge) + 5 * n2b(x / 120, z / 120);
      return lerp(seaH, landH, land);
    };
  };
  const mesa = () => (x: number, z: number) => {
    const d = Math.hypot(x, z);
    const base = 410 + 14 * fbm(x / 1800, z / 1800, 3);
    const m = fbm(x / 4200 + 7, z / 4200 - 3, 3) * 1.6;
    const pl = smooth(0.07, 0.095, m) * smooth(2600, 4300, d);
    let top = 150 + 120 * smooth(0.3, 0.55, m) + 30 * n2b(x / 500, z / 500);
    top = lerp(top, Math.floor(top / 36) * 36, 0.55);
    const c = 1 - Math.abs(n2b(x / 1500, z / 1500));
    const cut = smooth(0.93, 0.99, c) * 55 * smooth(2200, 3600, d);
    const dunes = 4 * n2b(x / 140, z / 140) + 10 * fbm(x / 600, z / 600, 2) * smooth(1800, 3200, d);
    return base + pl * top + dunes - cut * (1 - pl);
  };
  const peaks = () => (x: number, z: number) => {
    const d = Math.hypot(x * 0.8, z);
    const m = smooth(2300, 5400, d);
    const ridge = 1 - Math.abs(n2b(x / 2600 + fbm(x / 1700, z / 1700, 2) * 0.5, z / 2600));
    const lakeD = Math.hypot(x + 2800, z - 1800);
    const lake = smooth(1500, 550, lakeD);
    let h = 900 + 40 * fbm(x / 1300, z / 1300, 3) + m * (380 + 2300 * Math.pow(ridge, 1.45) + 420 * fbm(x / 650, z / 650, 4));
    h -= lake * 85;
    return h;
  };
  const raw = map.palette === "atoll" ? atoll() : map.palette === "mesa" ? mesa() : peaks();
  const height = (x: number, z: number) => {
    const h = raw(x, z);
    toLocal(x, z, tmp);
    const dz = Math.max(0, Math.abs(tmp.z) - halfL);
    const dx = tmp.x < -200 ? -200 - tmp.x : tmp.x > 560 ? tmp.x - 560 : 0;
    const dist = Math.hypot(dx, dz);
    const w = 1 - smooth(0, 380, dist);
    return w >= 1 ? map.elev : lerp(h, map.elev, w);
  };
  const lt = { x: 0, z: 0 };
  const inAsphalt = (x: number, z: number) => {
    toLocal(x, z, lt);
    // runway, parallel taxiway, connectors and apron in local space (+x is airport side)
    if (Math.abs(lt.x) < map.rwWid / 2 + 12 && Math.abs(lt.z) < map.rwLen / 2 + 25) return true;
    if (lt.x > 60 && lt.x < 100 && Math.abs(lt.z) < map.rwLen / 2) return true;
    if (lt.x > 20 && lt.x < 100) {
      for (const cz of [-map.rwLen / 2 + 130, -map.rwLen * 0.18, map.rwLen * 0.18, map.rwLen / 2 - 130]) if (Math.abs(lt.z - cz) < 13) return true;
    }
    if (lt.x > 100 && lt.x < 360 && lt.z > -230 && lt.z < 260) return true;
    return false;
  };
  return { height, toLocal, inAsphalt };
}

// ------------------------------------------------------------ textures
export function tileNoiseTexture(size = 256, seed = "tile", octaves = 3): THREE.DataTexture {
  const n4 = createNoise4D(alea(seed));
  const data = new Uint8Array(size * size * 4);
  const R = 1.1;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * Math.PI * 2, v = (j / size) * Math.PI * 2;
      let s = 0, a = 0.5, f = 1;
      for (let o = 0; o < octaves; o++) {
        s += a * n4(Math.cos(u) * R * f, Math.sin(u) * R * f, Math.cos(v) * R * f, Math.sin(v) * R * f);
        a *= 0.55; f *= 2;
      }
      const val = clamp(0.5 + s * 0.45, 0, 1) * 255;
      const k = (j * size + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = val; data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function normalFromTexture(src: THREE.DataTexture, strength = 3): THREE.DataTexture {
  const size = src.image.width;
  const d = src.image.data as Uint8Array;
  const out = new Uint8Array(size * size * 4);
  const H = (i: number, j: number) => d[(((j + size) % size) * size + ((i + size) % size)) * 4] / 255;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (H(i + 1, j) - H(i - 1, j)) * strength, dy = (H(i, j + 1) - H(i, j - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (j * size + i) * 4;
    out[k] = ((-dx / l) * 0.5 + 0.5) * 255; out[k + 1] = ((-dy / l) * 0.5 + 0.5) * 255; out[k + 2] = ((1 / l) * 0.5 + 0.5) * 255; out[k + 3] = 255;
  }
  const t = new THREE.DataTexture(out, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------ palettes
type RGB = [number, number, number];
const hex = (h: string): RGB => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mixc = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function makeColorFn(map: MapDef) {
  const n = createNoise2D(alea(map.seed + "c"));
  if (map.palette === "atoll") {
    const deep = hex("#1d3d8f"), shallow = hex("#53d6cf"), sand = hex("#ffe3c2"), grass = hex("#a6d98a"), grass2 = hex("#d4e88c"),
      pink = hex("#f4a3c4"), rock = hex("#b9a7e6"), cliff = hex("#f1d4ef");
    return (x: number, z: number, h: number, ny: number): RGB => {
      const v = n(x / 260, z / 260) * 0.5 + 0.5, v2 = n(x / 55, z / 55) * 0.5 + 0.5;
      if (h < 0) return mixc(shallow, deep, smooth(0, 60, -h));
      let c = mixc(sand, grass, smooth(1.5, 6, h));
      c = mixc(c, mixc(grass, grass2, v), smooth(5, 14, h));
      c = mixc(c, pink, smooth(0.55, 0.8, v2) * smooth(18, 40, h) * 0.65);
      c = mixc(c, rock, smooth(70, 120, h + v * 20));
      c = mixc(c, cliff, smooth(0.78, 0.55, ny) * 0.9);
      return c;
    };
  }
  if (map.palette === "mesa") {
    const bands = [hex("#c9604a"), hex("#e4895a"), hex("#f0b27a"), hex("#b04a58"), hex("#d8785e")];
    const flat = hex("#f6dcc8"), dune = hex("#eeb78c"), top = hex("#f4d3a1"), shrub = hex("#9a7bb8");
    return (x: number, z: number, h: number, ny: number): RGB => {
      const v = n(x / 300, z / 300) * 0.5 + 0.5, v2 = n(x / 40, z / 40) * 0.5 + 0.5;
      const rel = h - 410;
      const bi = Math.floor((rel * 0.09 + v * 0.8 + 50) % bands.length);
      const bf = ((rel * 0.09 + v * 0.8 + 50) % 1);
      const strata = mixc(bands[bi], bands[(bi + 1) % bands.length], smooth(0.7, 1, bf));
      let c = mixc(flat, dune, smooth(0.3, 0.7, v));
      c = mixc(c, shrub, smooth(0.72, 0.8, v2) * 0.35 * (1 - smooth(0.5, 0.9, 1 - ny)));
      c = mixc(c, strata, smooth(0.92, 0.7, ny) * smooth(8, 40, rel));
      c = mixc(c, top, smooth(0.97, 0.995, ny) * smooth(60, 130, rel) * 0.8);
      return c;
    };
  }
  const forest = hex("#2c6f6a"), forest2 = hex("#3f8f7a"), meadow = hex("#97d9a8"), rock = hex("#9d8fc4"), rock2 = hex("#7d72a8"), snow = hex("#fdf0fb"), lakeb = hex("#2b4f8f"), shore = hex("#c9d8e8");
  return (x: number, z: number, h: number, ny: number): RGB => {
    const v = n(x / 320, z / 320) * 0.5 + 0.5, v2 = n(x / 70, z / 70) * 0.5 + 0.5;
    if (h < 868) return mixc(shore, lakeb, smooth(868, 820, h));
    let c = mixc(meadow, mixc(forest, forest2, v), smooth(0.35, 0.55, v2) * 0.7 + 0.2);
    c = mixc(c, mixc(forest, forest2, v), smooth(930, 1050, h));
    c = mixc(c, meadow, smooth(1450, 1700, h) * 0.8);
    c = mixc(c, mixc(rock, rock2, v), smooth(1500 + v * 200, 1900, h));
    c = mixc(c, mixc(rock, rock2, v2), smooth(0.86, 0.6, ny));
    c = mixc(c, snow, smooth(2050 + v * 250, 2350, h) * smooth(0.45, 0.8, ny + 0.1) + smooth(2500, 2700, h));
    return c;
  };
}

// ------------------------------------------------------------ terrain meshes (3 LODs with skirts)
function buildLevel(
  heightFn: (x: number, z: number) => number,
  colorFn: (x: number, z: number, h: number, ny: number) => RGB,
  size: number, N: number, hole: number,
  /** Shared slope epsilon. Using each ring's own cell size instead makes the coarse rings
   *  compute flatter normals (and therefore flatter vertex colours) than the fine ring at the
   *  same world position, which reads as a hard seam across the landscape from the air. */
  normalEps: number,
): THREE.BufferGeometry {
  const step = size / N, half = size / 2;
  const V = N + 1;
  const H = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) H[j * V + i] = heightFn(-half + i * step, -half + j * step);
  const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
  const vmap = new Int32Array(V * V).fill(-1);
  const useCell = (i: number, j: number) => {
    if (!hole) return true;
    const cx = -half + (i + 0.5) * step, cz = -half + (j + 0.5) * step;
    return Math.abs(cx) > hole || Math.abs(cz) > hole;
  };
  const getV = (i: number, j: number) => {
    const k = j * V + i;
    if (vmap[k] >= 0) return vmap[k];
    const x = -half + i * step, z = -half + j * step, h = H[k];
    let nx: number, nz: number;
    if (normalEps < step * 0.95) {
      nx = (heightFn(x - normalEps, z) - heightFn(x + normalEps, z)) / (2 * normalEps);
      nz = (heightFn(x, z - normalEps) - heightFn(x, z + normalEps)) / (2 * normalEps);
    } else {
      const hl = H[j * V + Math.max(i - 1, 0)], hr = H[j * V + Math.min(i + 1, N)], hd = H[Math.max(j - 1, 0) * V + i], hu = H[Math.min(j + 1, N) * V + i];
      nx = (hl - hr) / (2 * step); nz = (hd - hu) / (2 * step);
    }
    const l = Math.hypot(nx, 1, nz);
    const ny = 1 / l;
    const c = colorFn(x, z, h, ny);
    const id = pos.length / 3;
    pos.push(x, h, z); nor.push(nx / l, ny, nz / l); col.push(c[0], c[1], c[2]);
    vmap[k] = id;
    return id;
  };
  const edges = new Map<number, [number, number, number]>();
  const addEdge = (a: number, b: number) => {
    const key = Math.min(a, b) * 4000000 + Math.max(a, b);
    const e = edges.get(key);
    if (e) e[2]++; else edges.set(key, [a, b, 1]);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (!useCell(i, j)) continue;
    const a = getV(i, j), b = getV(i + 1, j), c = getV(i, j + 1), d = getV(i + 1, j + 1);
    if ((i + j) & 1) { idx.push(a, c, b, b, c, d); addEdge(a, c); addEdge(c, b); addEdge(b, a); addEdge(b, c); addEdge(c, d); addEdge(d, b); }
    else { idx.push(a, c, d, a, d, b); addEdge(a, c); addEdge(c, d); addEdge(d, a); addEdge(a, d); addEdge(d, b); addEdge(b, a); }
  }
  // skirts on boundary edges
  const skirt = Math.max(30, step * 0.8);
  const sk = new Map<number, number>();
  const skV = (v: number) => {
    let s = sk.get(v);
    if (s === undefined) {
      s = pos.length / 3;
      pos.push(pos[v * 3], pos[v * 3 + 1] - skirt, pos[v * 3 + 2]);
      nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); col.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
      sk.set(v, s);
    }
    return s;
  };
  edges.forEach(([a, b, cnt]) => {
    if (cnt === 1) {
      const sa = skV(a), sb = skV(b);
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export function buildTerrainMeshes(map: MapDef, terr: Terrain, detail: THREE.Texture, quality: number): THREE.Group {
  const colorFn = makeColorFn(map);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, map: detail });
  mat.userData.u = {
    uSunDir: { value: new THREE.Vector3(0.3, 0.6, -0.7) },
    uSunI: { value: 1 },
    uSunCol: { value: new THREE.Color("#fff4dc") },
    uHazeD: { value: 0.000042 },
  };
  const U = mat.userData.u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWP = (modelMatrix * vec4(position,1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP;\nuniform vec3 uSunDir,uSunCol;\nuniform float uSunI,uHazeD;")
      .replace("#include <fog_fragment>", `
        {
          // in-scattering toward the sun: what actually makes distance look like air
          float hd = length(vWP - cameraPosition);
          float hf = 1.0 - exp(-hd * hd * uHazeD * uHazeD);
          vec3 vd = (vWP - cameraPosition) / max(hd, 1.0);
          float sc = pow(max(dot(vd, normalize(uSunDir)), 0.0), 4.0);
          gl_FragColor.rgb += uSunCol * sc * hf * uSunI * 0.55;
        }
        #include <fog_fragment>`)
      .replace("#include <map_fragment>", `
        float dd = length(vWP - cameraPosition);
        float n1 = texture2D(map, vWP.xz * 0.043).r;
        float n2 = texture2D(map, vWP.xz * 0.0071 + 0.37).r;
        float n3 = texture2D(map, vWP.xz * 0.31).r;
        float fine = mix(1.0, n3 * 2.0, 0.28 * (1.0 - smoothstep(30.0, 600.0, dd)));
        float det = mix(1.0, n1 * 2.0 * fine, 0.55 * (1.0 - smoothstep(200.0, 4500.0, dd)));
        det *= mix(1.0, n2 * 2.0, 0.55);
        diffuseColor.rgb *= clamp(det, 0.45, 1.6);
      `);
  };
  const g = new THREE.Group();
  const f = quality >= 2 ? 1 : quality === 1 ? 0.8 : 0.62;
  const levels: [number, number, number][] = [
    [9000, Math.round(280 * f), 0],
    [34000, Math.round(252 * f), 6000],
    [120000, Math.round(192 * f), 26000],
  ];
  const normalEps = levels[0][0] / levels[0][1]; // the finest ring's cell size, used by every ring
  for (const [size, N, hole] of levels) {
    const geo = buildLevel(terr.height, colorFn, size, N, hole, normalEps);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = size < 20000;
    m.frustumCulled = false;
    g.add(m);
  }
  g.userData.mat = mat;
  return g;
}
