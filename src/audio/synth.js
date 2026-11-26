// Procedural Web Audio: no sound files. Buses: master → ambience / sfx / tenant.
// Bus gain = slider² so sliders feel even across their travel (audio-design skill).
export class Synth {
  constructor() {
    this.ctx = null;
    this.state = 'not started';
  }

  // Must be called from a user gesture (click) to satisfy autoplay policy.
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.state = 'unsupported'; return; }
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.buses = {};
    for (const name of ['ambience', 'sfx', 'tenant']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.setVolume('master', 0.9);
    this.setVolume('ambience', 0.8);
    this.setVolume('sfx', 0.8);
    this.noiseBuf = this.makeNoise(2);
    this.startHum();
    ctx.onstatechange = () => { this.state = ctx.state; };
    this.state = ctx.state;
  }

  setVolume(bus, slider01) {
    const g = bus === 'master' ? this.master : this.buses[bus];
    if (g) g.gain.value = slider01 * slider01;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Fluorescent hum: mains fundamental + harmonics + a hiss of ballast noise, slowly wobbling.
  startHum() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.22;
    out.connect(this.buses.ambience);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(out);
    const parts = [[60, 'sawtooth', 0.12], [120, 'sine', 0.35], [180, 'sine', 0.08], [240, 'triangle', 0.05]];
    for (const [f, type, gain] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(lp);
      o.start();
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3800;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0.02;
    n.connect(bp).connect(ng).connect(out);
    n.start();
    // slow wobble so it never sounds like a test tone
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.05;
    lfo.connect(lfoG).connect(out.gain);
    lfo.start();
    this.hum = out;
  }

  // Carpet footstep: a soft filtered noise thump with random pitch and filter.
  footstep(intensity = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380 + Math.random() * 260;
    const g = ctx.createGain();
    const peak = 0.35 * Math.min(1.6, 0.6 + intensity * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16 + Math.random() * 0.05);
    src.connect(lp).connect(g).connect(this.buses.sfx);
    src.start(t, Math.random() * 1.5, 0.25);
  }

  click() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(this.buses.sfx);
    o.start(t);
    o.stop(t + 0.06);
  }
}
