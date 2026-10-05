import * as THREE from "three";
import alea from "alea";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

const SKY_VS = `varying vec3 vDir; void main(){ vDir=normalize(position); vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p; gl_Position.z=gl_Position.w; }`;
const SKY_FS = `
uniform vec3 uBH, uPl, uSun, uDiskN; uniform float uTime, uDist, uCone, uDiskI, uSteps;
varying vec3 vDir;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.02+vec2(11.,7.);a*=.5;}return s;}
vec2 proj(vec3 d, vec3 c, out float facing){ vec3 up=abs(c.y)>0.95?vec3(1,0,0):vec3(0,1,0); vec3 r=normalize(cross(up,c)); vec3 u=cross(c,r); facing=dot(d,c); return vec2(dot(d,r),dot(d,u)); }

// Everything that is not the black hole: nebula, starfield, ringed gas giant.
vec3 skyBase(vec3 d){
  float n1=fbm(d.xy*2.4+d.z*1.7), n2=fbm(d.zy*3.1-d.x*2.3+4.);
  vec3 col=vec3(0.012,0.014,0.04);
  col+=vec3(0.30,0.12,0.28)*pow(n1,3.2)*0.75+vec3(0.08,0.22,0.34)*pow(n2,3.4)*0.8;
  float band=smoothstep(0.55,0.0,abs(d.y*1.0+d.x*0.35));
  col+=vec3(0.5,0.42,0.6)*band*fbm(d.xz*14.)*0.18;
  vec3 sp=d*300.; vec3 c=floor(sp); float r=hash(c.xy+c.z*19.1);
  float st=step(0.9965,r); col+=vec3(0.9,0.93,1.)*st*(0.5+0.5*sin(uTime*1.5+r*80.));
  float st2=step(0.9992,hash(c.yz*1.3+c.x)); col+=vec3(1.,0.9,0.8)*st2*1.4;
  float f; vec2 q=proj(d,uPl,f);
  if(f>0.0){
    float pr=0.19; vec2 s=q/pr; float rr=length(s);
    float tilt=0.24; vec2 rs2=vec2(s.x*cos(tilt)+s.y*sin(tilt), -s.x*sin(tilt)+s.y*cos(tilt));
    float ell=length(vec2(rs2.x/1.0,rs2.y/0.26));
    float ringM=smoothstep(1.55,1.62,ell)*(1.-smoothstep(2.35,2.42,ell))*(0.55+0.45*vn(vec2(ell*40.,0.)));
    ringM*=(1.-smoothstep(2.0,2.4,ell)*0.6);
    bool front=rs2.y<0.0;
    vec3 ringC=mix(vec3(0.95,0.8,0.9),vec3(0.7,0.85,1.),vn(vec2(ell*18.,3.)))*ringM*0.8;
    if(rr<1.0){
      float zz=sqrt(1.-rr*rr); vec3 nrm=normalize(vec3(s,zz));
      float lat=nrm.y; float bands=0.5+0.5*sin(lat*16.+fbm(vec2(nrm.x*3.,lat*7.))*3.);
      vec3 base=mix(vec3(0.95,0.62,0.78),vec3(0.62,0.72,1.0),bands);
      float lit=clamp(dot(nrm,normalize(uSun))*0.8+0.25,0.05,1.1);
      vec3 pc=base*lit; pc+=vec3(0.5,0.5,0.8)*pow(1.-zz,3.)*0.5;
      col=pc; if(front) col=mix(col,ringC*1.1,clamp(ringM,0.,1.)*0.9);
    } else {
      col=mix(col,ringC,clamp(ringM,0.,1.)*0.9);
      col+=vec3(0.5,0.45,0.8)*exp(-(rr-1.)*9.)*0.25;
    }
  }
  return col;
}

// ---- Gargantua: backward integration of Schwarzschild null geodesics.
// d2u/dlambda2 = -1.5 * h2 * u / |u|^5, with h2 = |u x v|^2 conserved along the ray.
// Units are Schwarzschild radii, so the horizon sits at |u| = 1 and the photon sphere at 1.5.
vec3 traceBH(vec3 d, mat3 toBH, mat3 fromBH){
  vec3 ro = toBH * (-normalize(uBH) * uDist);
  vec3 rd = toBH * d;
  vec3 v  = rd;
  vec3 p  = ro;
  vec3 cr = cross(p, rd);
  float h2 = dot(cr, cr);
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float dt = uDist * 0.045;
  bool captured = false;
  int steps = int(uSteps);
  for (int i = 0; i < 220; i++) {
    if (i >= steps) break;
    float r2 = dot(p, p);
    float r = sqrt(r2);
    if (r < 1.03) { captured = true; break; }                 // crossed the horizon
    vec3 a = -1.5 * h2 * p / (r2 * r2 * r);
    vec3 np = p + v * dt + 0.5 * a * dt * dt;
    vec3 nv = normalize(v + a * dt);
    // accretion disk: the equatorial plane of the BH frame, ISCO (3) out to 12
    if (p.y * np.y < 0.0) {
      vec3 hp = mix(p, np, p.y / (p.y - np.y));
      float hr = length(hp.xz);
      if (hr > 3.0 && hr < 12.0) {
        float beta = sqrt(0.5 / max(hr - 1.0, 0.55));         // Keplerian speed seen by a static observer
        vec3 vel = normalize(vec3(-hp.z, 0.0, hp.x)) * beta;
        float gam = 1.0 / sqrt(max(1.0 - beta * beta, 1e-4));
        float dop = 1.0 / (gam * max(1.0 - dot(vel, -v), 1e-3));
        float g = dop * sqrt(max(1.0 - 1.0 / hr, 0.0));       // Doppler x gravitational redshift
        float turb = 0.55 + 0.7 * fbm(vec2(atan(hp.z, hp.x) * 3.0 + uTime * 0.05, hr * 2.2));
        float emis = pow(3.0 / hr, 2.2) * turb * (1.0 - smoothstep(8.0, 12.0, hr));
        vec3 c = mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.52, 0.18), smoothstep(3.0, 11.0, hr));
        c = mix(c, vec3(0.66, 0.82, 1.0), clamp((g - 1.0) * 1.4, 0.0, 0.85));   // approaching side blueshifts
        c = mix(c, vec3(1.0, 0.26, 0.10), clamp((1.0 - g) * 1.4, 0.0, 0.85));   // receding side redshifts
        acc += trans * c * emis * pow(g, 3.0) * uDiskI;
        trans *= 0.5;
      }
    }
    p = np; v = nv;
    dt = clamp(0.16 * max(r - 1.0, 0.25), 0.02, 0.9);         // fine near the hole, coarse far out
    if (r > uDist * 0.9 && dot(p, v) > 0.0) { captured = false; break; }  // escaped to infinity
  }
  vec3 sky = captured ? vec3(0.0) : skyBase(fromBH * normalize(v));
  // the photon ring: rays with impact parameter just above the critical 3*sqrt(3)/2 orbit forever
  float b = length(cross(ro, rd));
  acc += vec3(1.0, 0.86, 0.62) * exp(-pow((b - 2.5981) * 3.2, 2.0)) * 0.22;
  return acc + sky * trans;
}

void main(){
  vec3 d=normalize(vDir);
  vec3 col;
  float ang=acos(clamp(dot(d,normalize(uBH)),-1.,1.));
  if(ang<uCone){
    // BH frame: y is the disk normal, so "crossing the equatorial plane" means crossing the disk
    vec3 nrm=normalize(uDiskN);
    vec3 tmp=abs(nrm.y)>0.95?vec3(1.,0.,0.):vec3(0.,1.,0.);
    vec3 bx=normalize(cross(nrm,tmp));
    vec3 bz=cross(nrm,bx);
    mat3 fromBH=mat3(bx,nrm,bz);                                          // BH frame -> world
    mat3 toBH=mat3(bx.x,nrm.x,bz.x, bx.y,nrm.y,bz.y, bx.z,nrm.z,bz.z);     // world -> BH frame
    col=traceBH(d,toBH,fromBH);
    col=mix(skyBase(d),col,smoothstep(uCone,uCone*0.62,ang));   // no seam at the edge of the cone
  } else {
    col=skyBase(d);
  }
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function panelTex() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const c = cv.getContext("2d")!; const r = alea("panels");
  c.fillStyle = "#e9e6ee"; c.fillRect(0, 0, 256, 256);
  c.strokeStyle = "rgba(60,55,80,0.35)"; c.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 256); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(256, i); c.stroke(); }
  for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(${90 + r() * 80},${90 + r() * 80},${110 + r() * 80},0.12)`; c.fillRect(r() * 256, r() * 256, 3 + r() * 14, 3 + r() * 10); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

export interface DockState {
  range: number; closing: number; lateral: number; angle: number; spinDelta: number; roll: number; ok: boolean[]; docked: boolean; crashed: string;
}

export class SpaceWorld {
  scene = new THREE.Scene();
  station = new THREE.Group();
  spin = 0.34; // rad/s about station axis
  angle = 0;
  portLocal = new THREE.Vector3(0, 0, 118);
  skyMat: THREE.ShaderMaterial; sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  guide: THREE.Group;
  beacons: THREE.Mesh[] = [];
  tick = 0;

  constructor(quality: number) {
    const s = this.scene;
    s.background = new THREE.Color("#02030a");
    this.sun = new THREE.DirectionalLight("#ffe8d0", 3.2);
    this.sun.position.set(-0.6, 0.5, 0.62).multiplyScalar(500);
    this.sun.castShadow = quality > 0;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 50; sc.far = 1200;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.5;
    s.add(this.sun, this.sun.target);
    s.add(new THREE.HemisphereLight("#8a7bd0", "#2a2040", 0.55));
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uBH: { value: new THREE.Vector3(0.62, 0.12, -0.78).normalize() },
        uPl: { value: new THREE.Vector3(-0.72, 0.28, 0.63).normalize() },
        uSun: { value: new THREE.Vector3(-0.6, 0.5, 0.62).normalize() },
        uTime: { value: 0 },
        // Disk normal sits almost perpendicular to the line of sight, so we look at Gargantua
        // nearly edge-on and get the light from the far side of the disk bent over the top.
        uDiskN: { value: new THREE.Vector3(-0.1, 0.985, 0.14).normalize() },
        uDist: { value: 26 }, uCone: { value: 0.46 }, uDiskI: { value: 1.15 }, uSteps: { value: 90 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.sky.scale.setScalar(9000); this.sky.frustumCulled = false; this.sky.renderOrder = -10; s.add(this.sky);
    // environment for reflections
    this.buildStation();
    this.guide = this.buildGuide();
    s.add(this.station);
    // dust motes for a sense of speed/parallax
    const r = alea("dust"); const pos: number[] = [];
    for (let i = 0; i < 700; i++) { const a = r() * 6.28, b = Math.acos(2 * r() - 1), d = 60 + r() * 700; pos.push(Math.sin(b) * Math.cos(a) * d, Math.cos(b) * d, Math.sin(b) * Math.sin(a) * d); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, color: "#cfd0ff", transparent: true, opacity: 0.7, sizeAttenuation: true, depthWrite: false }));
    s.add(this.dust);
  }
  dust: THREE.Points;

  private buildStation() {
    const st = this.station;
    const pt = panelTex();
    const white = new THREE.MeshStandardMaterial({ color: "#f2eef6", map: pt, roughness: 0.5, metalness: 0.35 });
    const gray = new THREE.MeshStandardMaterial({ color: "#8d8aa0", roughness: 0.45, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: "#2a2838", roughness: 0.6, metalness: 0.5 });
    const lamp = new THREE.MeshBasicMaterial({ color: "#ffb85a", toneMapped: false });
    const mod = new THREE.Group(); mod.name = "ring"; st.add(mod);
    const Rr = 100;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = new THREE.Group(); m.position.set(Math.cos(a) * Rr, Math.sin(a) * Rr, 0); m.rotation.z = a + Math.PI / 2;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(8.2, 16, 6, 16), white); body.rotation.z = Math.PI / 2; body.castShadow = true; body.receiveShadow = true; m.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 2, 20), gray); cap.rotation.z = Math.PI / 2; m.add(cap);
      for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 5), lamp); w.position.set(s * 7, 8.6, 0); m.add(w); }
      const hatch = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.2, 16), dark); hatch.position.set(0, 0, 8.3); hatch.rotation.x = Math.PI / 2; m.add(hatch);
      mod.add(m);
      // connecting truss
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2 * Math.PI * Rr / 12 - 36, 8), gray);
      const a2 = a + Math.PI / 12; tr.position.set(Math.cos(a2) * Rr, Math.sin(a2) * Rr, 0); tr.rotation.z = a2; mod.add(tr);
      // spokes
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, Rr - 18, 8), gray); sp.position.set(Math.cos(a) * (Rr / 2 + 6), Math.sin(a) * (Rr / 2 + 6), 0); sp.rotation.z = a - Math.PI / 2; mod.add(sp);
    }
    // spine + docking hub (axis +Z)
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 210, 28), white); spine.rotation.x = Math.PI / 2; spine.castShadow = true; spine.receiveShadow = true; st.add(spine);
    for (let z = -90; z <= 90; z += 30) { const b = new THREE.Mesh(new THREE.TorusGeometry(9.3, 0.7, 6, 28), gray); b.position.z = z; st.add(b); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 12, 28), gray); hub.rotation.x = Math.PI / 2; hub.position.z = 110; st.add(hub);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 6.4, 4, 24), dark); collar.rotation.x = Math.PI / 2; collar.position.z = 116; st.add(collar);
    const portRing = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.5, 8, 28), lamp); portRing.position.z = 118.2; st.add(portRing);
    // docking guide lights around hub
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; const l = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? "#6fe3ff" : "#ff8aa8", toneMapped: false })); l.position.set(Math.cos(a) * 8.2, Math.sin(a) * 8.2, 116.5); st.add(l); this.beacons.push(l); }
    // solar-like arrays on the back end
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 22), new THREE.MeshStandardMaterial({ color: "#2b3c7a", metalness: 0.8, roughness: 0.25, emissive: "#111a40", emissiveIntensity: 0.4 })); p.position.set(s * 38, 0, -80); st.add(p); }
    st.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }

  private buildGuide() {
    // approach corridor made of glowing rings pointing down the docking axis (+Z)
    const g = new THREE.Group();
    for (let i = 1; i <= 8; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(3 + i * 0.9, 0.12, 6, 36), new THREE.MeshBasicMaterial({ color: "#6fe3ff", transparent: true, opacity: 0.55 - i * 0.04, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      r.position.z = 118 + i * 14; g.add(r);
    }
    this.station.add(g);
    return g;
  }

  advance(dt: number) {
    this.angle += this.spin * dt;
    this.station.rotation.z = this.angle;
    this.station.updateMatrixWorld(true);
  }
  update(dt: number, camPos: THREE.Vector3) {
    this.tick += dt;
    this.sky.position.copy(camPos);
    this.skyMat.uniforms.uTime.value = this.tick;
    this.guide.children.forEach((c, i) => { ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.4 * Math.max(0, Math.sin(this.tick * 2.5 - i * 0.7)); });
    this.dust.position.copy(camPos);
  }
  portWorld(out = new THREE.Vector3()) { return out.copy(this.portLocal).applyMatrix4(this.station.matrixWorld); }
}

// ------------------------------------------------------------------- Ranger sim
export class RangerSim {
  pos = new THREE.Vector3(70, -38, 470);
  vel = new THREE.Vector3(0, 0, -0.5);
  quat = new THREE.Quaternion();
  w = new THREE.Vector3(); // body angular velocity (rad/s)
  ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, tx: 0, ty: 0, tz: 0, assist: true };
  crashed = ""; docked = false;
  engine = 0; main = 0; rcs = 0;
  dock: DockState = { range: 999, closing: 0, lateral: 0, angle: 0, spinDelta: 0, roll: 0, ok: [false, false, false, false], docked: false, crashed: "" };
  events: string[] = [];
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private q2 = new THREE.Quaternion();
  world: SpaceWorld;
  speedCap = 120;
  constructor(world: SpaceWorld) { this.world = world; this.reset(); }

  reset() {
    this.pos.set(62, -40, 470); this.vel.set(0, 0, -0.4); this.w.set(0, 0, 0);
    const dir = this.tmp.set(0, 0, 118).sub(this.pos).normalize();
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    this.q2.setFromAxisAngle(new THREE.Vector3(0, 0, -1), 0.5); this.quat.multiply(this.q2);
    this.crashed = ""; this.docked = false; this.engine = 0; this.events.length = 0;
    this.ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, tx: 0, ty: 0, tz: 0, assist: true };
  }

  step(dt: number) {
    if (this.crashed || this.docked) { this.vel.multiplyScalar(Math.exp(-dt * 2)); this.w.multiplyScalar(Math.exp(-dt * 2)); this.integrate(dt); return; }
    const c = this.ctl;
    // rotation (body axes: x pitch+, y yaw left+, z roll left+)
    const aP = 1.1, aY = 1.1, aR = 1.6, wMaxP = 0.8, wMaxY = 0.8, wMaxR = 1.1;
    const expo = (x: number) => x * (0.4 + 0.6 * Math.abs(x));
    const tp = expo(c.pitch), ty = -expo(c.yaw), tr = -expo(c.roll);
    if (c.assist) {
      const approach = (cur: number, target: number, a: number) => cur + clamp(target - cur, -a * dt, a * dt);
      this.w.x = approach(this.w.x, tp * wMaxP, aP * (Math.abs(tp) > 0.01 ? 1 : 0.8));
      this.w.y = approach(this.w.y, ty * wMaxY, aY * (Math.abs(ty) > 0.01 ? 1 : 0.8));
      this.w.z = approach(this.w.z, tr * wMaxR, aR * (Math.abs(tr) > 0.01 ? 1 : 0.8));
    } else {
      this.w.x = clamp(this.w.x + tp * aP * dt, -1.6, 1.6); this.w.y = clamp(this.w.y + ty * aY * dt, -1.6, 1.6); this.w.z = clamp(this.w.z + tr * aR * dt, -2, 2);
    }
    // translation
    const a = this.tmp.set(0, 0, 0);
    const thr = clamp(c.throttle, 0, 1);
    const mainA = 12 * thr * thr;
    this.main = thr;
    a.z -= mainA;
    a.x += c.tx * 3; a.y += c.ty * 3; a.z -= c.tz * 3;
    this.rcs = Math.min(1, Math.abs(c.tx) + Math.abs(c.ty) + Math.abs(c.tz));
    const acc = this.tmp2.copy(a).applyQuaternion(this.quat);
    this.vel.addScaledVector(acc, dt);
    if (c.brake > 0.05) {
      const sp = this.vel.length();
      if (sp > 0.001) { const dec = Math.min(sp, 7 * c.brake * dt); this.vel.multiplyScalar((sp - dec) / sp); }
    }
    const sp = this.vel.length(); if (sp > this.speedCap) this.vel.multiplyScalar(this.speedCap / sp);
    this.integrate(dt);
    this.evaluate();
  }

  private integrate(dt: number) {
    this.pos.addScaledVector(this.vel, dt);
    this.q2.set(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0).premultiply(this.quat);
    this.quat.x += this.q2.x; this.quat.y += this.q2.y; this.quat.z += this.q2.z; this.quat.w += this.q2.w; this.quat.normalize();
  }

  private evaluate() {
    const W = this.world;
    // station-local frame
    const inv = new THREE.Matrix4().copy(W.station.matrixWorld).invert();
    const nose = new THREE.Vector3(0, 0, -5.2).applyQuaternion(this.quat).add(this.pos).applyMatrix4(inv);
    const pl = W.portLocal;
    const rel = nose.clone().sub(pl);
    const axial = rel.z; // distance in front of the port along +Z
    const lateral = Math.hypot(rel.x, rel.y);
    // velocity relative to port point on the spinning station
    const sw = new THREE.Vector3(0, 0, W.spin);
    const rW = new THREE.Vector3(0, 0, 0).copy(nose).applyQuaternion(W.station.quaternion);
    const vStation = sw.clone().cross(rW); // world
    const vRelW = this.vel.clone().sub(vStation);
    const vRelL = vRelW.applyQuaternion(W.station.quaternion.clone().invert());
    const closing = -vRelL.z;
    // axis alignment: ranger forward in station-local should be -Z
    const fwdL = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat).applyQuaternion(W.station.quaternion.clone().invert());
    const angle = (Math.acos(clamp(-fwdL.z, -1, 1)) * 180) / Math.PI;
    // spin delta about axis (world angular velocity z-component along station axis)
    const wW = this.w.clone().applyQuaternion(this.quat);
    const axisW = new THREE.Vector3(0, 0, 1).applyQuaternion(W.station.quaternion);
    const wAxis = wW.dot(axisW);
    // sign: body w is (x,y,z) with roll-left positive about +Z body... measure rotation about the station axis directly
    const spinDelta = wAxis - W.spin;
    // roll phase relative to station (twist angle)
    const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat).applyQuaternion(W.station.quaternion.clone().invert());
    const twist = Math.atan2(upL.x, upL.y);
    const d = this.dock;
    d.range = Math.max(0, axial); d.closing = closing; d.lateral = lateral; d.angle = angle; d.spinDelta = spinDelta; d.roll = twist;
    d.ok = [lateral < 1.4, angle < 9, Math.abs(spinDelta) < 0.1, closing < 1.8 && closing > -0.5];
    // contact with the port
    if (axial < 0.8 && axial > -6 && lateral < 6.5) {
      if (d.ok.every(Boolean) || (lateral < 1.8 && angle < 12 && Math.abs(spinDelta) < 0.16 && closing < 2.4)) { this.docked = true; d.docked = true; this.events.push("docked"); }
      else if (axial < 0.8) { this.crash(!d.ok[2] ? "spin mismatch tore the docking clamps" : !d.ok[3] ? "closing speed too high" : "misaligned docking"); }
    }
    // station body collisions (spine / ring / hub)
    const p = this.pos.clone().applyMatrix4(inv);
    const rad = Math.hypot(p.x, p.y);
    if (Math.abs(p.z) < 106 && rad < 15) this.crash("hit the station spine");
    if (p.z > 104 && p.z < 119 && rad < 13 && !(rad < 7 && p.z > 110)) this.crash("hit the docking hub");
    if (Math.abs(p.z) < 11 && Math.abs(rad - 100) < 15) this.crash("hit the Endurance ring");
    if (this.pos.length() > 2600) this.crash("drifted into the void");
  }
  private crash(r: string) { if (!this.crashed && !this.docked) { this.crashed = r; this.dock.crashed = r; this.events.push("crash"); } }
}

// ------------------------------------------------------------------- Ranger visuals
export function buildRanger(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: "#eceaf2", map: panelTex(), roughness: 0.42, metalness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: "#2c2a38", roughness: 0.5, metalness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: "#ff8f4a", roughness: 0.4, metalness: 0.3, emissive: "#ff6a20", emissiveIntensity: 0.15 });
  const glass = new THREE.MeshStandardMaterial({ color: "#0b0d1a", roughness: 0.05, metalness: 0.9 });
  const side = new THREE.Shape();
  const pts: [number, number][] = [[-6.2, -0.1], [-5.4, 0.9], [-2.6, 1.55], [3.4, 1.65], [5.6, 1.1], [5.8, -0.6], [3.6, -1.35], [-3.4, -1.25], [-6.0, -0.65]];
  side.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) side.lineTo(pts[i][0], pts[i][1]);
  const geo = new THREE.ExtrudeGeometry(side, { depth: 3.2, bevelEnabled: true, bevelSize: 0.55, bevelThickness: 0.6, bevelSegments: 4, curveSegments: 8 });
  geo.translate(0, 0, -1.6); geo.rotateY(Math.PI / 2); // length now along -Z (nose = -Z)
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, hull); body.scale.set(1, 1, 1); g.add(body);
  // canopy
  const can = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.35, 2.1), glass); can.position.set(0, 1.6, -3.6); can.rotation.x = -0.32; g.add(can);
  const can2 = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.12, 0.9), glass); can2.position.set(0, 0.55, -6.1); can2.rotation.x = 0.55; g.add(can2);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 8), accent); stripe.position.set(0, 0.2, 0.6); g.add(stripe);
  // nacelles
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 5.5, 20), hull); n.rotation.x = Math.PI / 2; n.position.set(s * 2.9, -0.2, 2.4); g.add(n);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.7, 0.9, 20), dark); noz.rotation.x = Math.PI / 2; noz.position.set(s * 2.9, -0.2, 5.4); g.add(noz);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 2.6), hull); fin.position.set(s * 3.9, 0.9, 3.4); fin.rotation.z = s * 0.22; g.add(fin);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 3.2), hull); wing.position.set(s * 2.4, -0.55, 0.4); g.add(wing);
    const rcs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), dark); rcs.position.set(s * 2.1, 1.2, -4.4); g.add(rcs);
  }
  // main engine glow (scaled by throttle)
  const glow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1, 16), new THREE.MeshBasicMaterial({ color: "#9fd0ff", transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const glow2 = glow.clone(); glow.rotation.x = -Math.PI / 2; glow2.rotation.x = -Math.PI / 2;
  glow.position.set(-2.9, -0.2, 5.9); glow2.position.set(2.9, -0.2, 5.9);
  g.add(glow, glow2); g.userData.glow = [glow, glow2];
  // docking probe at the nose
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 0.8, 18), dark); probe.rotation.x = Math.PI / 2; probe.position.set(0, -0.15, -6.6); g.add(probe);
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

export class RangerCockpit {
  group = new THREE.Group();
  canvas = document.createElement("canvas");
  tex: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  sticks: THREE.Group[] = [];
  private acc = 0;
  constructor() {
    this.canvas.width = 512; this.canvas.height = 256;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    const dark = new THREE.MeshStandardMaterial({ color: "#16171f", roughness: 0.7, metalness: 0.3 });
    const trim = new THREE.MeshStandardMaterial({ color: "#3b3c4a", roughness: 0.45, metalness: 0.6 });
    const amber = new THREE.MeshBasicMaterial({ color: "#ffb04d", toneMapped: false });
    const blue = new THREE.MeshBasicMaterial({ color: "#6fd8ff", toneMapped: false });
    const g = this.group;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me; };
    // dash and window frame (eye at origin, nose -Z)
    add(new THREE.BoxGeometry(3.4, 0.7, 1.1), dark, 0, -0.7, -1.0, -0.25);
    add(new THREE.BoxGeometry(3.4, 0.1, 0.5), trim, 0, -0.32, -1.38, -0.5);
    add(new THREE.BoxGeometry(3.4, 0.45, 0.6), dark, 0, 0.72, -0.9, 0.5);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.16, 1.7, 0.2), dark, s * 1.55, 0.05, -1.0, 0, 0, -s * 0.42);
      add(new THREE.BoxGeometry(0.9, 0.9, 1.6), dark, s * 1.6, -0.55, -0.1, 0, s * 0.3, 0);
      add(new THREE.BoxGeometry(0.1, 1.6, 1.8), dark, s * 1.75, 0.2, 0.35);
    }
    add(new THREE.BoxGeometry(0.12, 1.2, 0.18), trim, 0, 0.1, -1.55, 0, 0, 0); // centre mullion
    // overhead button rows
    for (let i = 0; i < 18; i++) add(new THREE.BoxGeometry(0.07, 0.03, 0.07), i % 3 ? amber : blue, -0.6 + i * 0.07, 0.62, -0.78, 0.5);
    // main display on the dash (tilted toward pilot)
    const dispM = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    add(new THREE.PlaneGeometry(1.3, 0.65), dispM, 0, -0.5, -0.72, -0.9);
    // side consoles glow strips
    for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.5, 0.02, 0.9), s > 0 ? amber : blue, s * 1.6, -0.09, -0.1, 0, s * 0.3, 0); }
    // pilot handles (two sticks like the film)
    for (const s of [-1, 1]) {
      const st = new THREE.Group(); st.position.set(s * 0.38, -0.62, -0.3);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.3, 8), trim); shaft.position.y = 0.12; st.add(shaft);
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.08, 4, 8), dark); grip.position.y = 0.3; st.add(grip);
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), s > 0 ? amber : blue); btn.position.set(0, 0.33, -0.03); st.add(btn);
      g.add(st); this.sticks.push(st);
    }
    g.traverse((o) => { o.frustumCulled = false; });
    g.visible = false;
  }
  update(dt: number, d: DockState, speed: number, thr: number, pitch: number, roll: number, assist: boolean, spin: number) {
    for (const s of this.sticks) { s.rotation.x += (-pitch * 0.35 - s.rotation.x) * Math.min(1, dt * 10); s.rotation.z += (-roll * 0.35 - s.rotation.z) * Math.min(1, dt * 10); }
    this.acc += dt; if (this.acc < 0.08) return; this.acc = 0;
    const c = this.ctx; c.fillStyle = "#07080d"; c.fillRect(0, 0, 512, 256);
    c.font = "bold 20px 'Courier New', monospace"; c.textBaseline = "top";
    const amber = "#ffb04d", ok = "#6dffb0", bad = "#ff5d6e", cy = "#7fe3ff";
    c.fillStyle = cy; c.fillText("RANGER 1   " + (assist ? "DOCKING MODE" : "MANUAL RCS"), 16, 12);
    c.strokeStyle = "#2a3350"; c.beginPath(); c.moveTo(16, 42); c.lineTo(496, 42); c.stroke();
    const row = (y: number, label: string, val: string, good: boolean | null) => { c.fillStyle = "#8a95b8"; c.fillText(label, 16, y); c.fillStyle = good === null ? amber : good ? ok : bad; c.textAlign = "right"; c.fillText(val, 496, y); c.textAlign = "left"; };
    row(54, "RANGE TO PORT", d.range.toFixed(0) + " m", null);
    row(82, "CLOSING SPEED", d.closing.toFixed(1) + " m/s", d.ok[3]);
    row(110, "LATERAL OFFSET", d.lateral.toFixed(1) + " m", d.ok[0]);
    row(138, "AXIS ALIGNMENT", d.angle.toFixed(0) + "°", d.ok[1]);
    row(166, "SPIN DIFFERENCE", (d.spinDelta * 9.549).toFixed(1) + " rpm", d.ok[2]);
    row(194, "STATION SPIN", (spin * 9.549).toFixed(1) + " rpm", null);
    c.fillStyle = "#1a2236"; c.fillRect(16, 226, 480, 14); c.fillStyle = amber; c.fillRect(16, 226, 480 * clamp(thr, 0, 1), 14);
    c.fillStyle = "#8a95b8"; c.font = "bold 14px monospace"; c.fillText("MAIN " + Math.round(thr * 100) + "%   SPEED " + speed.toFixed(1) + " m/s", 20, 208 + 0);
    this.tex.needsUpdate = true;
  }
}
