import * as THREE from "three";
import alea from "alea";
import { MapDef, TodId, Terrain, makeTerrainFn, buildTerrainMeshes, tileNoiseTexture, normalFromTexture, smooth } from "./terrain";
import type { Ground } from "./flight";

export interface Tod {
  id: TodId; label: string; sunEl: number; sunAz: number; zenith: string; horizon: string; ground: string;
  sunColor: string; sunInt: number; hemiSky: string; hemiGround: string; hemiInt: number; fog: string; fogDensity: number;
  stars: number; exposure: number; cloudLit: string; cloudDark: string; lights: number; moon: number; env: number;
}

export const TODS: Record<TodId, Tod> = {
  dawn: { id: "dawn", label: "Dawn", sunEl: 7, sunAz: 100, zenith: "#6f86d6", horizon: "#ffc3b6", ground: "#f3b9b4", sunColor: "#ffcfa0", sunInt: 3.0, hemiSky: "#b6c4ff", hemiGround: "#ffd0c0", hemiInt: 0.75, fog: "#f6c7c0", fogDensity: 0.000042, stars: 0.15, exposure: 0.9, cloudLit: "#fff0e6", cloudDark: "#c89ab8", lights: 0.35, moon: 0.5, env: 0.9 },
  day: { id: "day", label: "Day", sunEl: 50, sunAz: 150, zenith: "#4d8fe6", horizon: "#cfe6ff", ground: "#bcd6ee", sunColor: "#fff4dc", sunInt: 3.4, hemiSky: "#bfdcff", hemiGround: "#d9d6c8", hemiInt: 0.9, fog: "#cde3f4", fogDensity: 0.000036, stars: 0, exposure: 0.88, cloudLit: "#ffffff", cloudDark: "#b6c6e2", lights: 0, moon: 0.3, env: 1 },
  sunset: { id: "sunset", label: "Sunset", sunEl: 4, sunAz: 255, zenith: "#4b3f93", horizon: "#ff9467", ground: "#e39a86", sunColor: "#ff9a62", sunInt: 3.1, hemiSky: "#a58bd8", hemiGround: "#ffb08a", hemiInt: 0.7, fog: "#eaa38c", fogDensity: 0.000046, stars: 0.2, exposure: 0.92, cloudLit: "#ffd1b0", cloudDark: "#7a5aa0", lights: 0.4, moon: 0.7, env: 0.85 },
  twilight: { id: "twilight", label: "Twilight", sunEl: -5, sunAz: 250, zenith: "#1c2870", horizon: "#e07fb4", ground: "#8b5f9e", sunColor: "#ff7fa8", sunInt: 0.5, hemiSky: "#6d7ad8", hemiGround: "#9a6aa8", hemiInt: 0.55, fog: "#9a6aa6", fogDensity: 0.00005, stars: 0.55, exposure: 1.0, cloudLit: "#f0a8d0", cloudDark: "#4a4a98", lights: 0.85, moon: 0.9, env: 0.7 },
  night: { id: "night", label: "Night", sunEl: -30, sunAz: 250, zenith: "#040719", horizon: "#1d2658", ground: "#10163a", sunColor: "#9fb4ff", sunInt: 0.7, hemiSky: "#4a5bb0", hemiGround: "#2b2f66", hemiInt: 0.5, fog: "#141b44", fogDensity: 0.000052, stars: 1, exposure: 1.1, cloudLit: "#6a78c8", cloudDark: "#1a2050", lights: 1, moon: 1, env: 0.55 },
};

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`;
const SKY_FS = `
uniform vec3 uZenith,uHorizon,uGround,uSunDir,uSunCol,uMoonDir,uCloudLit,uCloudDark,uAurA,uAurB,uHaze;
uniform float uStars,uTime,uMoon,uCover,uAurora,uSunI,uSunUp;
varying vec3 vDir;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec2(17.,9.);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vDir); float h=d.y;
  float t=pow(clamp(h,0.,1.),0.48);
  vec3 col=mix(uHorizon,uZenith,t);
  col=mix(col,uGround,smoothstep(0.,-0.18,h));
  // The ground fades into the scene fog; make the sky converge on that same colour at the
  // horizon so the terrain/sky boundary disappears instead of showing a hard line.
  float hzb=1.-smoothstep(0.0,0.19,abs(h));
  col=mix(col,uHaze,hzb*0.78);
  float sd=max(dot(d,uSunDir),0.);
  col+=uSunCol*(pow(sd,5.)*0.16+pow(sd,48.)*0.35)*uSunI*0.35;
  col+=uHorizon*pow(sd,2.)*0.25*(1.-t);
  col+=uSunCol*smoothstep(0.99935,0.9998,sd)*3.5*uSunUp;
  if(uStars>0.&&h>0.){vec3 sp=d*260.;vec3 c=floor(sp);float r=hash(c.xy+c.z*17.3);float s=step(0.9972,r)*smoothstep(0.,.25,h);col+=vec3(.92,.95,1.)*s*uStars*(.55+.45*sin(uTime*2.+r*60.));
    float mw=smoothstep(0.35,0.0,abs(d.x*0.6+d.z*0.8-d.y*0.7)); col+=vec3(.35,.3,.6)*mw*fbm(d.xz*9.)*0.25*uStars*smoothstep(0.,.3,h);}
  if(uAurora>0.&&h>0.05){float w=fbm(vec2(d.x*3.+uTime*0.03,d.z*3.))*6.28;float band=smoothstep(.5,.0,abs(sin(d.x*5.+w)*0.5+h*1.6-0.75));col+=mix(uAurA,uAurB,fbm(d.xz*4.+uTime*.05))*band*uAurora*smoothstep(.05,.4,h)*0.8;}
  float ma=acos(clamp(dot(d,uMoonDir),-1.,1.));
  float mr=0.115;
  float disc=1.-smoothstep(mr*0.97,mr,ma);
  vec3 mp=d-uMoonDir*dot(d,uMoonDir);
  float surf=fbm(mp.xy*9.+3.);
  vec3 mcol=mix(vec3(.95,.9,1.),vec3(.62,.66,.9),smoothstep(.35,.7,surf));
  mcol*=0.75+0.35*smoothstep(mr,-mr,mp.x*2.2-mp.y);
  col=mix(col,mcol*1.15,disc*uMoon*step(-0.02,uMoonDir.y));
  col+=vec3(.6,.65,1.)*exp(-ma*9.)*0.35*uMoon*step(-0.1,uMoonDir.y);
  if(h>0.004){
    vec2 uv=d.xz/(h+0.1)*1.5+vec2(uTime*0.004,0.);
    float f=fbm(uv*0.8);
    float c=smoothstep(0.62-uCover*0.2,0.92-uCover*0.1,f)*smoothstep(0.0,0.1,h);
    float sh=clamp((f-fbm(uv*0.8+uSunDir.xz*0.35))*3.5+0.55,0.,1.);
    vec3 cc=mix(uCloudDark,uCloudLit,sh);
    cc+=uSunCol*pow(sd,10.)*0.5*uSunI*0.25;
    col=mix(col,cc,c*0.88);
  }
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BILL_VS = `
attribute vec3 aOff; attribute vec4 aSc; varying vec2 vUv; varying float vA; varying float vShade; varying float vFog;
uniform float uFade;
void main(){
  vUv=uv; vec4 mv=viewMatrix*vec4(aOff,1.);
  float dist=length(mv.xyz);
  vA=smoothstep(60.,420.,dist)*aSc.w; vShade=aOff.y*0.;
  vFog=1.-exp(-dist*dist*uFade*uFade*0.35);
  mv.xy+=position.xy*aSc.x; gl_Position=projectionMatrix*mv;
}`;
const BILL_FS = `
uniform sampler2D uMap; uniform vec3 uLit,uDark,uFogC; varying vec2 vUv; varying float vA; varying float vFog;
void main(){ vec4 t=texture2D(uMap,vUv); float a=t.a*vA*0.85; if(a<0.01) discard; vec3 c=mix(uDark,uLit,clamp(vUv.y*0.9+t.r*0.3,0.,1.)); c=mix(c,uFogC,vFog*0.6); gl_FragColor=vec4(c,a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const glowTex = () => canvasTex(64, 64, (c) => {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
});

export interface Gate { pos: THREE.Vector3; dir: THREE.Vector3; mesh: THREE.Group; passed: boolean }

export class World {
  scene = new THREE.Scene();
  map: MapDef; tod: Tod; terr: Terrain; quality: number;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight;
  skyMat: THREE.ShaderMaterial; skyMesh: THREE.Mesh;
  water: THREE.Mesh | null = null; waterNormal: THREE.DataTexture | null = null;
  airport = new THREE.Group();
  lightMats: THREE.PointsMaterial[] = [];
  glowMats: THREE.MeshBasicMaterial[] = [];
  emissiveMats: THREE.MeshStandardMaterial[] = [];
  papi: THREE.Points; papiPos = new THREE.Vector3();
  gates: Gate[] = [];
  spawn = { x: 0, z: 0, hdg: 0, y: 0 };
  parking: { x: number; z: number; hdg: number }[] = [];
  clouds: THREE.Mesh; cloudMat: THREE.ShaderMaterial;
  orbs: THREE.Points;
  windsock: THREE.Group; ground: Ground; tick = 0;
  detail: THREE.DataTexture;
  terrMat: THREE.MeshStandardMaterial | null = null;
  pmrem: THREE.PMREMGenerator | null = null;
  envRT: THREE.WebGLRenderTarget | null = null;
  sunDir = new THREE.Vector3(); moonDir = new THREE.Vector3(0.4, 0.62, -0.67).normalize();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private lt = { x: 0, z: 0 };
  private disposables: { dispose(): void }[] = [];

  constructor(map: MapDef, todId: TodId, quality: number, private renderer: THREE.WebGLRenderer) {
    this.map = map; this.quality = quality; this.tod = TODS[todId];
    this.terr = makeTerrainFn(map);
    const wl = map.waterLevel;
    const terr = this.terr;
    this.ground = {
      height: (x, z) => Math.max(terr.height(x, z), wl),
      surface: (x, z) => (terr.height(x, z) < wl + 0.15 ? 2 : terr.inAsphalt(x, z) ? 0 : 1),
    };
    const scene = this.scene;
    scene.fog = new THREE.FogExp2("#ffffff", 0.00004);

    // lights
    this.hemi = new THREE.HemisphereLight("#fff", "#888", 0.8); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff", 3);
    this.sun.castShadow = quality > 0;
    const ss = quality >= 2 ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ss, ss);
    const sc = this.sun.shadow.camera; sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 900;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    // sky
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() },
        uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uMoonDir: { value: this.moonDir },
        uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
        uAurA: { value: new THREE.Color(map.accent) }, uAurB: { value: new THREE.Color(map.accent2) },
        uStars: { value: 0 }, uTime: { value: 0 }, uMoon: { value: 0.5 }, uCover: { value: map.cloudCover }, uAurora: { value: map.palette === "peaks" ? 1 : 0.0 },
        uSunI: { value: 1 }, uSunUp: { value: 1 },
      },
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.skyMesh.scale.setScalar(90000); this.skyMesh.frustumCulled = false; this.skyMesh.renderOrder = -10;
    scene.add(this.skyMesh);

    // terrain
    this.detail = tileNoiseTexture(256, map.seed + "det", 4);
    const tg = buildTerrainMeshes(map, terr, this.detail, quality);
    this.terrMat = tg.userData.mat as THREE.MeshStandardMaterial;
    this.syncTerrainHaze();
    scene.add(tg);

    // water
    if (wl > -1000) {
      this.waterNormal = normalFromTexture(tileNoiseTexture(256, map.seed + "wat", 4), 5);
      const wm = new THREE.MeshStandardMaterial({
        color: map.waterColor, roughness: 0.07, metalness: 0.05, transparent: true, opacity: 0.86, normalMap: this.waterNormal,
        normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 1.4,
      });
      this.waterNormal.repeat.set(2600, 2600);
      this.water = new THREE.Mesh(new THREE.PlaneGeometry(260000, 260000), wm);
      this.water.rotation.x = -Math.PI / 2; this.water.position.y = wl;
      scene.add(this.water);
    }

    this.buildAirport();
    this.papi = this.buildPapi();
    this.windsock = this.buildWindsock();
    this.buildScatter();
    this.buildRoute();
    this.buildDreamObjects();
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: BILL_VS, fragmentShader: BILL_FS, transparent: true, depthWrite: false, fog: false,
      uniforms: { uMap: { value: this.cloudTexture() }, uLit: { value: new THREE.Color() }, uDark: { value: new THREE.Color() }, uFogC: { value: new THREE.Color() }, uFade: { value: 0.00003 } },
    });
    this.clouds = this.buildClouds();
    this.orbs = this.buildOrbs();
    this.setTod(todId);
  }

  /** Keeps the terrain's aerial-perspective uniforms in step with the time of day. */
  private syncTerrainHaze() {
    const U = this.terrMat?.userData.u as
      | { uSunDir: { value: THREE.Vector3 }; uSunI: { value: number }; uSunCol: { value: THREE.Color }; uHazeD: { value: number } }
      | undefined;
    if (!U) return;
    const t = this.tod;
    U.uSunDir.value.copy(this.sunDir);
    U.uSunI.value = Math.min(1.2, t.sunInt / 3) * (t.sunEl < 0 ? 0.4 : 1);
    U.uSunCol.value.set(t.sunColor);
    U.uHazeD.value = t.fogDensity * this.map.fog;
  }

  // ------------------------------------------------------------------ tod
  setTod(id: TodId) {
    const t = (this.tod = TODS[id]);
    const u = this.skyMat.uniforms;
    (u.uZenith.value as THREE.Color).set(t.zenith); (u.uHorizon.value as THREE.Color).set(t.horizon); (u.uGround.value as THREE.Color).set(t.ground);
    (u.uSunCol.value as THREE.Color).set(t.sunColor); (u.uCloudLit.value as THREE.Color).set(t.cloudLit); (u.uCloudDark.value as THREE.Color).set(t.cloudDark);
    u.uStars.value = t.stars; u.uMoon.value = t.moon; u.uSunI.value = Math.min(1, t.sunInt / 3);
    const az = ((this.map.rwHdg + t.sunAz - 90) * Math.PI) / 180 * 0 + (t.sunAz * Math.PI) / 180, el = (t.sunEl * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    u.uSunUp.value = t.sunEl > -2 ? 1 : 0;
    const night = t.sunEl < -8;
    const lightDir = night ? this.moonDir : this.sunDir;
    this.sun.userData.dir = lightDir.clone();
    this.sun.color.set(night ? "#9fb4ff" : t.sunColor);
    this.sun.intensity = night ? 0.9 : Math.max(0.5, t.sunInt) * (t.sunEl < 0 ? 0.35 : 1);
    this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround); this.hemi.intensity = t.hemiInt;
    (this.scene.fog as THREE.FogExp2).color.set(t.fog);
    (u.uHaze.value as THREE.Color).set(t.fog);
    (this.scene.fog as THREE.FogExp2).density = t.fogDensity * this.map.fog;
    this.syncTerrainHaze();
    this.renderer.toneMappingExposure = t.exposure;
    for (const m of this.lightMats) m.opacity = Math.min(1, 0.12 + t.lights * 0.95);
    for (const m of this.emissiveMats) m.emissiveIntensity = t.lights * 1.5;
    for (const m of this.glowMats) m.opacity = 0.18 + t.lights * 0.2;
    if (this.water) (this.water.material as THREE.MeshStandardMaterial).color.set(this.map.waterColor).lerp(new THREE.Color(t.horizon), 0.18 + (night ? -0.1 : 0)).multiplyScalar(night ? 0.25 : 1);
    const cu = this.cloudMat.uniforms;
    (cu.uLit.value as THREE.Color).set(t.cloudLit); (cu.uDark.value as THREE.Color).set(t.cloudDark); (cu.uFogC.value as THREE.Color).set(t.fog);
    // environment (IBL) from the sky dome
    this.rebuildEnv();
    this.sun.position.copy(lightDir).multiplyScalar(500).add(this.sun.target.position);
  }

  private rebuildEnv() {
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const es = new THREE.Scene();
    const m = this.skyMesh.clone();
    m.scale.setScalar(50);
    es.add(m);
    const prev = this.envRT;
    const rt = this.pmrem.fromScene(es, 0, 0.1, 1000);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = this.tod.env * 0.9;
    this.envRT = rt;
    prev?.dispose();
  }

  // ------------------------------------------------------------------ helpers
  mat(color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const key = color + JSON.stringify(o, (k, v) => (k === "map" || k === "emissiveMap" ? undefined : v));
    if (!o.map && !o.emissiveMap && this.mats.has(key)) return this.mats.get(key)!;
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o });
    if (!o.map && !o.emissiveMap) this.mats.set(key, m);
    this.disposables.push(m);
    return m;
  }
  box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, cast = true) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y + h / 2, z); b.castShadow = cast; b.receiveShadow = true; parent.add(b); return b;
  }
  cyl(parent: THREE.Object3D, rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 20, cast = true) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    c.position.set(x, y + h / 2, z); c.castShadow = cast; c.receiveShadow = true; parent.add(c); return c;
  }
  facade(cols: number, rows: number, tint: string, lit = true) {
    return canvasTex(256, 128, (c) => {
      c.fillStyle = "#1c2a3a"; c.fillRect(0, 0, 256, 128);
      const r = alea("fac" + cols + rows);
      const cw = 256 / cols, rh = 128 / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        c.fillStyle = lit && r() > 0.45 ? tint : "#34506a";
        c.fillRect(i * cw + 2, j * rh + 2, cw - 4, rh - 4);
      }
    });
  }
  private points(positions: number[], colors: number[] | null, size: number, color = "#ffffff") {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (colors) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.PointsMaterial({ size, map: glowTex(), color, vertexColors: !!colors, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false });
    this.lightMats.push(m);
    const p = new THREE.Points(g, m); p.frustumCulled = false;
    return p;
  }

  localToWorld(x: number, z: number, out = new THREE.Vector3()) {
    const phi = -(this.map.rwHdg * Math.PI) / 180;
    out.set(x * Math.cos(phi) + z * Math.sin(phi), this.map.elev, -x * Math.sin(phi) + z * Math.cos(phi));
    return out;
  }
  worldToLocal(x: number, z: number) { this.terr.toLocal(x, z, this.lt); return this.lt; }

  // ------------------------------------------------------------------ airport
  private buildAirport() {
    const map = this.map, ap = this.airport, L = map.rwLen, W = map.rwWid;
    const rg = alea(map.seed + "ap");
    ap.rotation.y = -(map.rwHdg * Math.PI) / 180; ap.position.y = map.elev;
    this.scene.add(ap);
    const pal = map.palette === "atoll" ? ["#ffd1dc", "#c8f0ea", "#fff1c9", "#d6c9ff"] : map.palette === "mesa" ? ["#f6d2b8", "#e9a98a", "#f8e3c9", "#c9a4e0"] : ["#e6ecff", "#cdb8f2", "#ffd6ea", "#bfe8e0"];
    const asphaltTex = canvasTex(256, 256, (c) => {
      c.fillStyle = "#4b4b55"; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9000; i++) { const g = 60 + rg() * 40; c.fillStyle = `rgb(${g},${g},${g + 6})`; c.fillRect(rg() * 256, rg() * 256, 1 + rg() * 2, 1 + rg() * 2); }
      c.strokeStyle = "rgba(20,20,26,0.35)"; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(rg() * 256, rg() * 256); c.lineTo(rg() * 256, rg() * 256); c.stroke(); }
    });
    const mk = (repX: number, repY: number, color = "#ffffff") => { const t = asphaltTex.clone(); t.repeat.set(repX, repY); t.needsUpdate = true; return this.mat(color, { map: t, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); };
    const slab = (w: number, d: number, x: number, z: number, m: THREE.Material, y = 0.05) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; ap.add(p); return p;
    };
    slab(W + 24, L + 50, 0, 0, mk((W + 24) / 18, (L + 50) / 18, "#d0d0d8"), 0.04);
    slab(W, L, 0, 0, mk(W / 14, L / 14), 0.07);
    slab(23, L, 80, 0, mk(2, L / 14, "#d8d8e0"), 0.06);
    const conn = [-L / 2 + 130, -L * 0.18, L * 0.18, L / 2 - 130];
    for (const z of conn) slab(80, 23, 40, z, mk(5, 2, "#d8d8e0"), 0.06);
    slab(260, 490, 230, 15, mk(14, 26, "#c6c6d2"), 0.05);

    // markings
    const wm = this.mat("#f4f4ef", { roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const ym = this.mat("#ffcf3d", { roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const quad = (pos: number[], idx: number[], x: number, z: number, w: number, d: number) => {
      const b = pos.length / 3; pos.push(x - w / 2, 0, z - d / 2, x + w / 2, 0, z - d / 2, x + w / 2, 0, z + d / 2, x - w / 2, 0, z + d / 2); idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 2);
    };
    const mesh = (pos: number[], idx: number[], m: THREE.Material, y: number) => {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const me = new THREE.Mesh(g, m); me.position.y = y; me.receiveShadow = true; ap.add(me);
    };
    {
      const p: number[] = [], ix: number[] = [];
      for (let z = -L / 2 + 280; z < L / 2 - 280; z += 50) quad(p, ix, 0, z, 0.9, 30);
      quad(p, ix, -W / 2 + 0.9, 0, 0.5, L - 40); quad(p, ix, W / 2 - 0.9, 0, 0.5, L - 40);
      for (const s of [1, -1]) {
        const zt = s * (L / 2 - 14);
        for (let i = -5; i <= 5; i++) if (i !== 0) quad(p, ix, i * 3.7 - Math.sign(i) * 1.0, zt - s * 0, 1.8, 30);
        for (const off of [300, 450, 600]) { const zz = s * (L / 2 - off); const w = off === 300 ? 8 : 4; quad(p, ix, -W * 0.22, zz, w < 5 ? 3 : 4, w * 1.0 + 14); quad(p, ix, W * 0.22, zz, w < 5 ? 3 : 4, w * 1.0 + 14); }
      }
      mesh(p, ix, wm, 0.09);
      const p2: number[] = [], i2: number[] = [];
      quad(p2, i2, 80, 0, 0.5, L);
      for (const z of conn) quad(p2, i2, 40, z, 80, 0.5);
      quad(p2, i2, 230, 15, 0.5, 440);
      for (let i = -3; i <= 3; i++) quad(p2, i2, 230 + 40, 15 + i * 58, 40, 0.4);
      mesh(p2, i2, ym, 0.08);
    }
    // numbers
    const num = (n: number) => canvasTex(128, 256, (c) => { c.fillStyle = "rgba(0,0,0,0)"; c.fillRect(0, 0, 128, 256); c.fillStyle = "#f4f4ef"; c.font = "bold 150px 'Arial Narrow', Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(n).padStart(2, "0"), 64, 130); });
    const n1 = Math.round(map.rwHdg / 10) % 36 || 36, n2 = ((n1 + 18 - 1) % 36) + 1;
    for (const [n, s] of [[n1, 1], [n2, -1]] as const) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(10, 20), new THREE.MeshBasicMaterial({ map: num(n), transparent: true, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, color: "#e8e8e4" }));
      pm.rotation.x = -Math.PI / 2; pm.rotation.z = s === 1 ? 0 : Math.PI; pm.position.set(0, 0.1, s * (L / 2 - 52)); ap.add(pm);
    }

    // lights
    const edge: number[] = [], thrG: number[] = [], thrR: number[] = [], appr: number[] = [], taxi: number[] = [];
    for (let z = -L / 2; z <= L / 2; z += 60) { edge.push(-W / 2 - 1.5, 0.35, z, W / 2 + 1.5, 0.35, z); }
    for (let i = -W / 2; i <= W / 2; i += 4) { thrG.push(i, 0.3, L / 2 + 1.5); thrR.push(i, 0.3, -L / 2 - 1.5); }
    for (let k = 1; k <= 14; k++) { const z = L / 2 + k * 32; appr.push(0, 0.5 + k * 0.02, z); if (k % 3 === 0) for (let i = -2; i <= 2; i++) if (i) appr.push(i * 4, 0.5, z); }
    for (let z = -L / 2; z <= L / 2; z += 50) taxi.push(68, 0.3, z, 92, 0.3, z);
    ap.add(this.points(edge, null, 3.2, "#fff4dc"), this.points(thrG, null, 3.4, "#4dff8a"), this.points(thrR, null, 3.4, "#ff4d4d"), this.points(appr, null, 4.2, "#ffffff"), this.points(taxi, null, 2.6, "#4d9bff"));
    // apron flood poles
    const poleM = this.mat("#9aa0b0", { metalness: 0.6, roughness: 0.4 });
    const flood: number[] = [];
    for (let i = 0; i < 6; i++) { const z = -190 + i * 85; this.cyl(ap, 0.35, 0.5, 22, poleM, 125, 0, z, 8); flood.push(125, 22.5, z); this.cyl(ap, 0.35, 0.5, 22, poleM, 340, 0, z, 8); flood.push(340, 22.5, z); }
    const fl = this.points(flood, null, 22, "#ffe6bf"); ap.add(fl);

    // terminal
    const glassTex = this.facade(18, 3, "#ffe3a8");
    const glassM = this.mat("#ffffff", { map: glassTex, emissive: "#ffd9a0", emissiveMap: glassTex, emissiveIntensity: 0, metalness: 0.3, roughness: 0.2 }); this.emissiveMats.push(glassM);
    const term = new THREE.Group(); term.position.set(390, 0, 15); ap.add(term);
    const tm = this.mat(pal[0], { roughness: 0.6 });
    this.box(term, 30, 15, 150, glassM, 0, 0, 0); this.box(term, 40, 1.4, 160, this.mat(pal[3], { roughness: 0.5 }), -6, 15, 0);
    this.box(term, 22, 24, 40, tm, 8, 0, 70); this.box(term, 26, 1.2, 46, this.mat(pal[1]), 8, 24, 70);
    this.box(term, 4, 8, 60, this.mat("#ffffff"), -30, 0, 0); // canopy
    this.box(term, 4, 0.6, 62, this.mat(pal[2]), -30, 8, 0);
    for (let i = -2; i <= 2; i++) this.cyl(term, 0.4, 0.4, 8, this.mat("#ffffff"), -31, 0, i * 12, 8);
    // jet bridges
    for (let i = -1; i <= 1; i++) { this.box(term, 40, 3.4, 3.4, this.mat("#d8dce8", { metalness: 0.4 }), -52, 4.2, i * 52 - 6); this.box(term, 5, 5, 5, this.mat("#8892a8"), -72, 3, i * 52 - 6); }
    // sign
    const sign = canvasTex(512, 96, (c) => { c.fillStyle = "#12142a"; c.fillRect(0, 0, 512, 96); c.fillStyle = map.accent; c.shadowColor = map.accent; c.shadowBlur = 18; c.font = "700 44px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("welcome home", 256, 50); });
    const signM = new THREE.MeshBasicMaterial({ map: sign, toneMapped: false });
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(22, 4.1), signM); sg.position.set(-15.2, 19.5, 0); sg.rotation.y = -Math.PI / 2; term.add(sg);
    // tower
    const tower = new THREE.Group(); tower.position.set(300, 0, 230); ap.add(tower);
    this.cyl(tower, 4.2, 5.8, 34, this.mat(pal[0], { roughness: 0.5 }), 0, 0, 0, 24);
    const cab = this.cyl(tower, 8.5, 6.4, 6.5, glassM, 0, 34, 0, 24); void cab;
    this.cyl(tower, 9.2, 9.2, 0.8, this.mat(pal[3]), 0, 40.5, 0, 24);
    this.cyl(tower, 0.2, 0.2, 7, poleM, 0, 41.3, 0, 6);
    const beacon = this.points([300, 49, 230], null, 24, "#ff8aa8"); ap.add(beacon);
    // hangars
    const hm = [this.mat(pal[1], { roughness: 0.55 }), this.mat(pal[3], { roughness: 0.55 }), this.mat(pal[2], { roughness: 0.55 })];
    for (let i = 0; i < 3; i++) {
      const hg = new THREE.Group(); hg.position.set(405, 0, -170 - i * 58 + 0); hg.rotation.y = 0; ap.add(hg);
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 52, 28, 1, true, 0, Math.PI), hm[i]);
      arch.rotation.z = Math.PI / 2; arch.rotation.y = 0; arch.rotation.order = "YXZ"; arch.rotation.set(0, 0, 0);
      arch.geometry.rotateZ(Math.PI / 2); arch.geometry.rotateY(0);
      arch.position.set(-4, 0, 0); arch.rotation.x = 0; arch.castShadow = true; arch.receiveShadow = true;
      (arch.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      hg.add(arch);
      // door and end walls
      const door = this.mat("#f0f0ff", { roughness: 0.4, metalness: 0.2 });
      this.box(hg, 0.6, 15, 40, door, -29.9, 0, 0);
      this.box(hg, 0.6, 12, 43, this.mat("#2b2f4a"), 21.9, 0, 0);
    }
    // fuel tanks + props
    for (let i = 0; i < 3; i++) this.cyl(ap, 9, 9, 14, this.mat(i % 2 ? "#ffffff" : pal[0], { roughness: 0.45 }), 270 + i * 22, 0, -270, 20);
    const vehM = [this.mat("#ffcf3d"), this.mat("#ffffff"), this.mat("#ff8aa8")];
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Group(); v.position.set(150 + rg() * 180, 0, -150 + rg() * 380); v.rotation.y = rg() * Math.PI;
      this.box(v, 2.2, 1.5, 4.6, vehM[i % 3], 0, 0.5, 0); this.box(v, 2, 0.9, 1.6, this.mat("#1a2238", { metalness: 0.6, roughness: 0.2 }), 0, 2.0, -1.1, false);
      if (i % 3 === 0) this.cyl(v, 0.9, 0.9, 3, this.mat("#d8dce8"), 0, 2, 0.9, 12, false);
      ap.add(v);
    }
    // cones
    for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 8), this.mat("#ff7a3d")); c.position.set(112 + rg() * 12, 0.45, -180 + i * 28); ap.add(c); }
    // road & parking lot
    const roadM = this.mat("#3a3a48", { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 1400), roadM); road.rotation.x = -Math.PI / 2; road.position.set(455, 0.04, 560); ap.add(road);
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), roadM); lot.rotation.x = -Math.PI / 2; lot.position.set(440, 0.045, 100); ap.add(lot);
    for (let i = 0; i < 8; i++) { const car = new THREE.Group(); car.position.set(420 + (i % 4) * 8, 0, 82 + Math.floor(i / 4) * 18); this.box(car, 1.8, 0.9, 4.1, this.mat(pal[i % 4]), 0, 0.3, 0); this.box(car, 1.6, 0.7, 2, this.mat("#1a2238"), 0, 1.15, 0.1, false); ap.add(car); }
    // town along the road
    const town = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mat("#ffffff", { roughness: 0.8 }), 90);
    const tc = new THREE.Color(); const mtx = new THREE.Matrix4(); const winP: number[] = [];
    for (let i = 0; i < 90; i++) {
      const side = i % 2 ? 1 : -1; const z = 700 + (i >> 1) * 22 + rg() * 8; const x = 455 + side * (24 + rg() * 40);
      const w = 10 + rg() * 12, h = 6 + rg() * 16, d = 10 + rg() * 12;
      mtx.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d)); town.setMatrixAt(i, mtx);
      tc.set(pal[i % 4]); tc.offsetHSL(0, 0, (rg() - 0.5) * 0.08); town.setColorAt(i, tc);
      for (let k = 0; k < 3; k++) winP.push(x + (rg() - 0.5) * w, 2 + rg() * h * 0.8, z - d / 2 - 0.2);
    }
    town.castShadow = false; town.receiveShadow = false; ap.add(town); ap.add(this.points(winP, null, 3.2, "#ffd9a0"));
    // ground under town: flatten with a cream pad so houses do not float/sink
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(190, 1100), this.mat(pal[0], { roughness: 1, color: "#cfd9c8" }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(455, 0.02, 1230); pad.visible = false; ap.add(pad);

    const hd = (map.rwHdg * Math.PI) / 180;
    const sp = this.localToWorld(0, L / 2 - 90);
    this.spawn = { x: sp.x, z: sp.z, hdg: hd, y: map.elev };
    // parking stands on apron (for decorative parked aircraft)
    for (const z of [-170, -55, 60]) { const w = this.localToWorld(300, z); this.parking.push({ x: w.x, z: w.z, hdg: hd + Math.PI * 0.5 }); }
  }

  private buildPapi() {
    const L = this.map.rwLen, W = this.map.rwWid;
    const pos: number[] = [], col: number[] = [];
    for (let i = 0; i < 4; i++) { pos.push(-(W / 2 + 18 + i * 9), 0.8, L / 2 - 330); col.push(1, 1, 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 6, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false });
    const p = new THREE.Points(g, m); p.frustumCulled = false; this.airport.add(p);
    this.papiPos.copy(this.localToWorld(-(W / 2 + 18 + 13), L / 2 - 330)); this.papiPos.y = this.map.elev;
    // housings
    for (let i = 0; i < 4; i++) this.box(this.airport, 2.2, 1.0, 1.6, this.mat("#d8dce8"), -(W / 2 + 18 + i * 9), 0, L / 2 - 330);
    return p;
  }

  private buildWindsock() {
    const g = new THREE.Group();
    const pole = this.cyl(g, 0.12, 0.16, 7, this.mat("#d8dce8"), 0, 0, 0, 6);
    void pole;
    const sock = new THREE.Group(); sock.position.y = 7; g.add(sock);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.7, 3.6, 12, 1, true), this.mat("#ff8a3d", { side: THREE.DoubleSide, roughness: 0.8 }));
    cone.rotation.z = -Math.PI / 2; cone.position.x = 1.8; sock.add(cone);
    const w = this.localToWorld(-60, 0); g.position.set(w.x, this.map.elev, w.z);
    g.userData.sock = sock;
    this.scene.add(g);
    return g;
  }

  // trees / props scattered across land (instanced)
  private buildScatter() {
    const map = this.map, terr = this.terr;
    const r = alea(map.seed + "tr");
    const count = [900, 1900, 3200][this.quality];
    const treeGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const tr = new THREE.CylinderGeometry(0.35, 0.5, 3, 5); tr.translate(0, 1.5, 0); paint(tr, "#8a6a7a"); parts.push(tr);
      if (map.palette === "peaks") {
        for (let i = 0; i < 3; i++) { const c = new THREE.ConeGeometry(3.4 - i * 0.9, 5.2, 7); c.translate(0, 4.2 + i * 2.5, 0); paint(c, "#ffffff"); parts.push(c); }
      } else {
        const b = new THREE.IcosahedronGeometry(3.4, 1); b.scale(1, 0.85, 1); b.translate(0, 5.2, 0); paint(b, "#ffffff"); parts.push(b);
        const b2 = new THREE.IcosahedronGeometry(2.2, 1); b2.translate(1.4, 7.4, 0.6); paint(b2, "#ffffff"); parts.push(b2);
      }
      return merge(parts);
    })();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const inst = new THREE.InstancedMesh(treeGeo, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let n = 0, tries = 0;
    const wl = map.waterLevel;
    const lt = { x: 0, z: 0 };
    const palette = map.palette === "atoll" ? ["#f6a5c8", "#9fe3b0", "#c6a7ff", "#ffd7a3"] : map.palette === "mesa" ? ["#9d7fc4", "#c28aa8", "#8d9a7a"] : ["#2f7a72", "#3a8d7d", "#285f66", "#7c6fc0"];
    while (n < count && tries < count * 14) {
      tries++;
      const a = r() * Math.PI * 2, d = 220 + Math.pow(r(), 0.7) * 6800;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = terr.height(x, z);
      if (h < wl + 2.5) continue;
      terr.toLocal(x, z, lt);
      if (lt.x > -160 && lt.x < 1700 && Math.abs(lt.z) < map.rwLen / 2 + 400 + (lt.x > 400 ? 1500 : 0) && lt.x < 1700 && lt.z > -map.rwLen / 2 - 300) continue;
      const hx = terr.height(x + 6, z), hz = terr.height(x, z + 6);
      if (Math.abs(hx - h) > 5 || Math.abs(hz - h) > 5) continue;
      if (map.palette === "peaks" && h > 1750) continue;
      if (map.palette === "mesa" && r() > 0.12) continue;
      if (map.palette === "atoll" && h > 85) continue;
      const s = (map.palette === "mesa" ? 0.55 : 0.8) + r() * 0.9;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m4.compose(new THREE.Vector3(x, h - 0.3, z), q, new THREE.Vector3(s, s * (0.9 + r() * 0.5), s));
      inst.setMatrixAt(n, m4);
      c.set(palette[Math.floor(r() * palette.length)]); c.offsetHSL(0, 0, (r() - 0.5) * 0.08);
      inst.setColorAt(n, c); n++;
    }
    inst.count = n; inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false; inst.frustumCulled = false;
    this.scene.add(inst);
  }

  private cloudTexture() {
    return canvasTex(128, 128, (c) => {
      const r = alea("cloudpuff");
      c.clearRect(0, 0, 128, 128);
      for (let i = 0; i < 18; i++) {
        const x = 64 + (r() - 0.5) * 56, y = 64 + (r() - 0.5) * 34, rad = 20 + r() * 26;
        const g = c.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.6, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      }
    }, false);
  }

  private buildClouds() {
    const r = alea(this.map.seed + "cl");
    const N = [90, 150, 220][this.quality];
    const offs = new Float32Array(N * 3), sc = new Float32Array(N * 4);
    const wl = Math.max(this.map.waterLevel, this.map.elev - 40);
    let i = 0;
    while (i < N) {
      const cx = (r() - 0.5) * 36000, cz = (r() - 0.5) * 36000, cy = wl + this.map.cloudAlt + (r() - 0.5) * 500;
      const k = 5 + Math.floor(r() * 6), size = 380 + r() * 520;
      for (let j = 0; j < k && i < N; j++, i++) {
        offs[i * 3] = cx + (r() - 0.5) * size * 2.4; offs[i * 3 + 1] = cy + (r() - 0.4) * size * 0.4; offs[i * 3 + 2] = cz + (r() - 0.5) * size * 2.4;
        sc[i * 4] = size * (0.6 + r() * 0.6); sc[i * 4 + 3] = 0.7 + r() * 0.3;
      }
    }
    const q = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry(); g.index = q.index; g.setAttribute("position", q.getAttribute("position")); g.setAttribute("uv", q.getAttribute("uv"));
    g.setAttribute("aOff", new THREE.InstancedBufferAttribute(offs, 3)); g.setAttribute("aSc", new THREE.InstancedBufferAttribute(sc, 4));
    g.instanceCount = N;
    const m = new THREE.Mesh(g, this.cloudMat); m.frustumCulled = false; m.renderOrder = 5;
    this.scene.add(m);
    return m;
  }

  private buildOrbs() {
    const r = alea(this.map.seed + "orb");
    const N = 110; const pos: number[] = [], col: number[] = [];
    const cc = [new THREE.Color(this.map.accent), new THREE.Color(this.map.accent2), new THREE.Color("#fff3b0"), new THREE.Color("#c9b6ff")];
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2, d = 400 + r() * 7000;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = Math.max(this.terr.height(x, z), this.map.waterLevel) + 40 + r() * 520;
      pos.push(x, y, z); const c = cc[i % 4]; col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 46, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.8, fog: false });
    const p = new THREE.Points(g, m); p.frustumCulled = false; this.scene.add(p);
    return p;
  }

  // surreal landmarks: doors, arches and monoliths standing in the landscape
  private buildDreamObjects() {
    const r = alea(this.map.seed + "dream"), map = this.map, terr = this.terr;
    const pal = [map.accent, map.accent2, "#fff2a8", "#c9b6ff"];
    const lt = { x: 0, z: 0 };
    const doorGlow = (c: string) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); this.glowMats.push(m); return m; };
    let placed = 0, tries = 0;
    while (placed < 16 && tries < 400) {
      tries++;
      const a = r() * Math.PI * 2, d = 1400 + r() * 7500;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      terr.toLocal(x, z, lt); if (lt.x > -300 && lt.x < 1800 && Math.abs(lt.z) < map.rwLen) continue;
      const h = Math.max(terr.height(x, z), map.waterLevel);
      const onWater = terr.height(x, z) < map.waterLevel;
      const g = new THREE.Group(); g.position.set(x, h, z); g.rotation.y = r() * 6.28;
      const c = pal[placed % 4];
      const frameM = this.mat("#f7f1ff", { roughness: 0.5 });
      const kind = placed % 4;
      if (kind === 0 || kind === 3) {
        // monumental door
        const s = 5 + r() * 3;
        this.box(g, 0.5 * s, 4 * s, 0.35 * s, frameM, -1.1 * s, 0, 0); this.box(g, 0.5 * s, 4 * s, 0.35 * s, frameM, 1.1 * s, 0, 0);
        this.box(g, 2.7 * s, 0.5 * s, 0.35 * s, frameM, 0, 4 * s, 0);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.9 * s, 4 * s), doorGlow(c)); p.position.set(0, 2 * s, 0); g.add(p);
        const pt = this.points([0, 2 * s, 0], null, 6 * s, c); g.add(pt);
      } else if (kind === 1) {
        // torii-like arch
        const s = 7 + r() * 5;
        this.cyl(g, 0.45 * s, 0.55 * s, 6 * s, this.mat(c, { roughness: 0.45 }), -2 * s, 0, 0, 10); this.cyl(g, 0.45 * s, 0.55 * s, 6 * s, this.mat(c, { roughness: 0.45 }), 2 * s, 0, 0, 10);
        this.box(g, 6.6 * s, 0.6 * s, 0.7 * s, this.mat(c, { roughness: 0.45 }), 0, 5.4 * s, 0); this.box(g, 5 * s, 0.35 * s, 0.5 * s, this.mat(c, { roughness: 0.45 }), 0, 4.3 * s, 0);
      } else {
        // glowing monolith
        const s = 9 + r() * 8;
        const m = this.box(g, 1.2 * s, 7 * s, 0.5 * s, this.mat("#ffffff", { roughness: 0.15, metalness: 0.7, emissive: c, emissiveIntensity: 0.25 }), 0, 0, 0);
        void m;
        if (!onWater) g.position.y += 0;
      }
      this.scene.add(g); placed++;
    }
  }

  // mission route
  private buildRoute() {
    const map = this.map, terr = this.terr;
    const spec: Record<string, number[][]> = {
      atoll: [[0, 2600, 190], [40, 4200, 230], [95, 5200, 270], [150, 4800, 210], [200, 4300, 160], [250, 3600, 240], [300, 2800, 170]],
      mesa: [[0, 2800, 200], [-35, 4300, 170], [-80, 5200, 150], [-130, 5000, 240], [-180, 4200, 190], [-230, 3600, 160], [-290, 2800, 200]],
      peaks: [[0, 1700, 150], [48, 2000, 210], [100, 2050, 270], [160, 1900, 190], [215, 2050, 240], [275, 1850, 160]],
    };
    const pts = spec[map.id] || spec.atoll;
    const wl = map.waterLevel;
    const pos: THREE.Vector3[] = [];
    for (const [da, R, agl] of pts) {
      const a = ((map.rwHdg + da) * Math.PI) / 180;
      const x = Math.sin(a) * R, z = -Math.cos(a) * R;
      let hmax = Math.max(terr.height(x, z), wl);
      for (let k = 0; k < 8; k++) { const b = (k / 8) * Math.PI * 2; hmax = Math.max(hmax, terr.height(x + Math.cos(b) * 260, z + Math.sin(b) * 260)); }
      pos.push(new THREE.Vector3(x, hmax + agl, z));
    }
    const ringGeo = new THREE.TorusGeometry(46, 1.7, 10, 64);
    for (let i = 0; i < pos.length; i++) {
      const next = pos[(i + 1) % pos.length], prev = i === 0 ? new THREE.Vector3(Math.sin((map.rwHdg * Math.PI) / 180) * 1000, pos[0].y, -Math.cos((map.rwHdg * Math.PI) / 180) * 1000).setY(pos[0].y) : pos[i - 1];
      const dir = i === pos.length - 1 ? next.clone().setY(map.elev + 200).sub(pos[i]) : next.clone().sub(prev);
      dir.y *= 0.2; dir.normalize();
      const g = new THREE.Group(); g.position.copy(pos[i]); g.lookAt(pos[i].clone().add(dir));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: map.accent, toneMapped: false, fog: false })); g.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(46, 40), new THREE.MeshBasicMaterial({ color: map.accent2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); g.add(disc);
      const outer = new THREE.Mesh(new THREE.TorusGeometry(54, 0.6, 6, 64), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, toneMapped: false, fog: false })); g.add(outer);
      g.visible = false; g.scale.setScalar(1);
      this.scene.add(g);
      this.gates.push({ pos: pos[i].clone(), dir, mesh: g, passed: false });
    }
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number, cam: THREE.Camera, focus: THREE.Vector3) {
    this.tick += dt;
    this.skyMesh.position.copy(cam.position);
    this.skyMat.uniforms.uTime.value = this.tick;
    const k = this.tod.sunEl < -8 ? 0 : 1;
    void k;
    if (this.waterNormal) { this.waterNormal.offset.x = (this.tick * 0.0009) % 1; this.waterNormal.offset.y = (this.tick * 0.0006) % 1; }
    // shadows & light follow the focus (aircraft)
    const dir: THREE.Vector3 = this.sun.userData.dir;
    const snap = 4;
    this.sun.target.position.set(Math.round(focus.x / snap) * snap, Math.round(focus.y / snap) * snap, Math.round(focus.z / snap) * snap);
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 450);
    this.sun.target.updateMatrixWorld();
    // windsock
    const s = this.windsock.userData.sock as THREE.Group;
    const wd = ((this.map.wind.dir + 180) * Math.PI) / 180;
    s.rotation.y = -wd + Math.PI * 0.5 * 0 + Math.sin(this.tick * 2) * 0.05;
    s.rotation.z = -Math.min(0.9, 0.9 - this.map.wind.speed * 0.08) * 0 + 0;
    // PAPI colouring from the focus position
    const dx = focus.x - this.papiPos.x, dz = focus.z - this.papiPos.z;
    const lx = this.worldToLocal(focus.x, focus.z);
    const hd = Math.max(1, Math.hypot(dx, dz));
    const ang = Math.atan2(focus.y - this.map.elev - 2, hd);
    const col = this.papi.geometry.getAttribute("color") as THREE.BufferAttribute;
    const thr = [2.5, 2.83, 3.17, 3.5].map((d) => (d * Math.PI) / 180);
    const onApproach = lx.z > 0 && Math.abs(lx.x) < 900;
    for (let i = 0; i < 4; i++) {
      const white = ang > thr[i];
      if (!onApproach) col.setXYZ(i, 1, 1, 1);
      else if (white) col.setXYZ(i, 1, 1, 0.95); else col.setXYZ(i, 1, 0.08, 0.05);
    }
    col.needsUpdate = true;
    (this.papi.material as THREE.PointsMaterial).opacity = Math.min(1, 0.7 + this.tod.lights * 0.3);
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mt = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mt)) mt.forEach((x) => x.dispose()); else mt?.dispose();
    });
    this.envRT?.dispose(); this.pmrem?.dispose();
    this.detail.dispose();
  }
}

function paint(g: THREE.BufferGeometry, color: string) {
  const c = new THREE.Color(color); const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}
function merge(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    const g = p;
    const P = g.getAttribute("position"), N = g.getAttribute("normal"), C = g.getAttribute("color");
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(C.getX(i), C.getY(i), C.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < P.count; i++) idx.push(i + off);
    off += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  return g;
}
void smooth;
