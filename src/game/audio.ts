/** Tiny WebAudio synth: engine, wind, rumble, stall horn and a dreamy pad. No audio files needed. */
export interface AudioState {
  kind: "air" | "space"; rpm: number; speed: number; stall: boolean; wow: boolean; gs: number; jet: boolean; playing: boolean; cockpit: boolean; brake: number;
}

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private enabled = true; private paused = false;
  private eng1!: OscillatorNode; private eng2!: OscillatorNode; private engG!: GainNode; private engF!: BiquadFilterNode;
  private jetG!: GainNode; private jetF!: BiquadFilterNode;
  private windG!: GainNode; private windF!: BiquadFilterNode;
  private rumG!: GainNode;
  private horn!: GainNode; private hornO!: OscillatorNode;
  private padG!: GainNode; private spaceG!: GainNode;
  private noise!: AudioBufferSourceNode; private t = 0;

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = this.enabled ? 0.9 : 0; this.master.connect(c.destination);
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }
    const noise = (this.noise = c.createBufferSource()); noise.buffer = buf; noise.loop = true; noise.start();
    const mk = (type: BiquadFilterType, f: number, q = 0.7) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    // propeller / engine
    this.eng1 = c.createOscillator(); this.eng1.type = "sawtooth"; this.eng2 = c.createOscillator(); this.eng2.type = "triangle";
    this.engF = mk("lowpass", 600); this.engG = c.createGain(); this.engG.gain.value = 0;
    this.eng1.connect(this.engF); this.eng2.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master);
    this.eng1.start(); this.eng2.start();
    // jet whoosh
    this.jetF = mk("bandpass", 900, 0.5); this.jetG = c.createGain(); this.jetG.gain.value = 0;
    noise.connect(this.jetF); this.jetF.connect(this.jetG); this.jetG.connect(this.master);
    // wind
    this.windF = mk("lowpass", 500); this.windG = c.createGain(); this.windG.gain.value = 0;
    noise.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    // rolling rumble
    const rf = mk("lowpass", 140); this.rumG = c.createGain(); this.rumG.gain.value = 0; noise.connect(rf); rf.connect(this.rumG); this.rumG.connect(this.master);
    // stall horn
    this.hornO = c.createOscillator(); this.hornO.type = "square"; this.hornO.frequency.value = 740; this.horn = c.createGain(); this.horn.gain.value = 0;
    const hf = mk("lowpass", 1800); this.hornO.connect(hf); hf.connect(this.horn); this.horn.connect(this.master); this.hornO.start();
    // dreamy pad (always on, very quiet) + deep space organ
    this.padG = c.createGain(); this.padG.gain.value = 0.0; this.padG.connect(this.master);
    this.spaceG = c.createGain(); this.spaceG.gain.value = 0.0; this.spaceG.connect(this.master);
    const chord = [220, 277.2, 329.6, 440.0, 554.4];
    chord.forEach((f, i) => {
      for (const det of [-3, 3]) { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f; o.detune.value = det; const g = c.createGain(); g.gain.value = 0.05 / (1 + i * 0.4); o.connect(g); g.connect(this.padG); o.start(); }
    });
    const organ = [55, 110, 82.4, 164.8, 220, 277.2];
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(this.spaceG.gain); lfo.start();
    organ.forEach((f, i) => { const o = c.createOscillator(); o.type = i < 2 ? "sawtooth" : "triangle"; o.frequency.value = f; const lp = mk("lowpass", 420 + i * 60); const g = c.createGain(); g.gain.value = 0.11 / (1 + i * 0.5); o.connect(lp); lp.connect(g); g.connect(this.spaceG); o.start(); });
  }

  setEnabled(e: boolean) { this.enabled = e; if (this.ctx) this.master.gain.setTargetAtTime(e && !this.paused ? 0.9 : 0, this.ctx.currentTime, 0.1); }
  setPaused(p: boolean) { this.paused = p; if (this.ctx) this.master.gain.setTargetAtTime(this.enabled && !p ? 0.9 : 0.12 * (this.enabled ? 1 : 0), this.ctx.currentTime, 0.15); }

  update(s: AudioState) {
    const c = this.ctx; if (!c) return;
    const now = c.currentTime;
    const k = 0.08;
    const space = s.kind === "space";
    const run = s.playing ? 1 : 0.0;
    const cab = s.cockpit ? 0.8 : 1.0;
    const eg = space ? 0 : (0.05 + s.rpm * 0.17) * run * cab * (s.jet ? 0.35 : 1);
    this.engG.gain.setTargetAtTime(eg, now, k);
    const base = s.jet ? 48 : 38;
    const f = base + s.rpm * (s.jet ? 90 : 62) + s.speed * 0.04;
    this.eng1.frequency.setTargetAtTime(f, now, k); this.eng2.frequency.setTargetAtTime(f * 2.01, now, k);
    this.engF.frequency.setTargetAtTime(380 + s.rpm * 900, now, k);
    this.jetG.gain.setTargetAtTime((space ? s.rpm * s.rpm * 0.28 : s.jet ? (0.02 + s.rpm * 0.2) * run : 0) * cab, now, k);
    this.jetF.frequency.setTargetAtTime(space ? 220 + s.rpm * 300 : 500 + s.rpm * 1500, now, k);
    const wind = space ? 0 : Math.min(1, s.speed / 120);
    this.windG.gain.setTargetAtTime(wind * 0.28 * run * (s.cockpit ? 0.7 : 1), now, k);
    this.windF.frequency.setTargetAtTime(300 + wind * 2200, now, k);
    this.rumG.gain.setTargetAtTime(s.wow && s.playing ? Math.min(1, s.gs / 40) * 0.5 * (1 + s.brake * 0.4) : 0, now, k);
    this.t += 1 / 60;
    const beep = s.stall && s.playing && Math.floor(this.t * 5) % 2 === 0 ? 0.12 : 0;
    this.horn.gain.setTargetAtTime(beep, now, 0.01);
    this.padG.gain.setTargetAtTime(space ? 0 : 0.5, now, 1.5);
    this.spaceG.gain.setTargetAtTime(space ? 0.9 : 0, now, 1.5);
  }

  private blip(freq: number, dur: number, vol: number, type: OscillatorType = "sine", slide = 0) {
    const c = this.ctx; if (!c || !this.enabled) return;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, c.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.05);
  }
  thump(v: number) { this.blip(70, 0.25, 0.5 * v, "sine", -35); }
  crash() { this.blip(110, 0.9, 0.8, "sawtooth", -90); this.blip(60, 1.2, 0.8, "square", -40); }
  chime() { this.blip(659, 0.5, 0.18); setTimeout(() => this.blip(880, 0.6, 0.16), 120); setTimeout(() => this.blip(1318, 0.9, 0.12), 260); }
  dispose() { try { this.ctx?.close(); } catch { /* ignore */ } this.ctx = null; }
}
