// Procedural Web Audio: no sound files. Buses: master → ambience (← env) / sfx / tenant.
// Bus gain = slider² so sliders feel even across their travel (audio-design skill).
// Sounds are data: content/sounds/*.json presets, played by src/audio/presets.js (format: presets.md).
import { Voice, DEAD_HANDLE, BUSES, makeNoiseBuffers, makeImpulse, validatePreset } from './presets.js';

// Linear up to `knee` (0.7 ≈ -3 dBFS), then a tanh shoulder (full-scale input → 0.93). A WaveShaper
// maps input -1..1 across the curve and holds the end values beyond that.
// Room impulses for setAcoustics() (makeImpulse options). Index order = the weights order.
export const ROOM_IMPULSES = [
  { name: 'small', seconds: 0.9, rt60: 0.45, predelay: 0.003, bright: 0.92, dark: 0.3, early: [[0.004, 0.5], [0.0085, 0.35], [0.013, 0.25], [0.019, 0.15]] },
  { name: 'hall', seconds: 3.4, rt60: 2.9, predelay: 0.028, bright: 0.7, dark: 0.05, early: [[0.03, 0.25], [0.052, 0.18], [0.081, 0.12]] },
  { name: 'corridor', seconds: 2.2, rt60: 1.5, predelay: 0.006, bright: 0.8, dark: 0.12, flutter: { period: 0.0125, gain: 0.35, decay: 0.7 } },
];

function softClipCurve(n = 2049, knee = 0.7) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return c;
}

export class Synth {
  // opts: { maxVoices = 32, hrtf = true, hum = true (the old global hum; src/ambience replaces it),
  //         acoustics = true (three room impulses crossfaded by setAcoustics; false = one convolver),
  //         scheduler = true (false = call update() yourself), rand = Math.random }
  constructor(opts = {}) {
    this.ctx = null;
    this.state = 'not started';
    this.opts = { maxVoices: 32, hrtf: true, hum: true, acoustics: true, scheduler: true, ...opts };
    this.rand = this.opts.rand || Math.random;
    this.presets = {};
    this.voices = [];
    this.listenerPos = null;
    this._warned = new Set();
    this.playHooks = []; // fn(voice, id, opts) after every successful play() (occlusion, ducking)
    this.acoustics = { weights: [1], sends: {} };
    this.sliders = { master: 0.9, ambience: 0.8, sfx: 0.8, tenant: 1 };
  }

  // Must be called from a user gesture (click) to satisfy autoplay policy.
  // Pass an existing (e.g. Offline) AudioContext to render without a browser.
  start(context) {
    if (this.ctx) { this.ctx.resume?.(); return; }
    let ctx = context;
    if (!ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { this.state = 'unsupported'; return; }
      ctx = new AC();
    }
    this.ctx = ctx;
    // master → safety soft-clipper. Memoryless (no attack/release), so it can't pump and leaves
    // everything below ~-3 dBFS untouched. (A DynamicsCompressor was tried: in Chrome it dulled
    // short clicks by 6-13 dB even far below its threshold.)
    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = softClipCurve();
    this.limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(this.limiter);

    // Shared reverb. Each bus has a send (follows its slider, so muting a bus also mutes its tail)
    // and a sendScale (room acoustics: tight small rooms, washy halls) into one reverb input.
    // With opts.acoustics the input feeds several room impulses whose return gains are
    // crossfaded by setAcoustics(); idle rooms are disconnected so they cost nothing.
    this.reverbIn = ctx.createGain();
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.5;
    this.reverbReturn.connect(this.master);
    const rooms = this.opts.acoustics ? ROOM_IMPULSES : [{ name: 'default' }];
    this.rooms = rooms.map((r, i) => {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx, r, this.rand);
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0;
      conv.connect(g).connect(this.reverbReturn);
      if (i === 0) this.reverbIn.connect(conv);
      return { name: r.name, conv, gain: g, weight: i === 0 ? 1 : 0, connected: i === 0, idleAt: 0, tail: r.seconds ?? 2.2 };
    });
    this.reverb = this.rooms[0].conv; // back-compat: the first (or only) convolver
    this.acoustics.weights = this.rooms.map((r) => r.weight);

    this.buses = {};
    this.sends = {};
    this.sendScale = {};
    for (const name of BUSES) {
      const g = ctx.createGain();
      this.buses[name] = g;
      const s = ctx.createGain();
      const k = ctx.createGain();
      s.connect(k).connect(this.reverbIn);
      this.sends[name] = s;
      this.sendScale[name] = k;
    }
    for (const name of BUSES) this.buses[name].connect(name === 'env' ? this.buses.ambience : this.master);
    for (const [bus, v] of Object.entries(this.sliders)) this.setVolume(bus, v);

    this.noise = makeNoiseBuffers(ctx, 4, this.rand);
    this.noiseBuf = this.noise.white;
    this.engine = {
      ctx, noise: this.noise, buses: this.buses, sends: this.sends, hrtf: this._hrtfOk(),
      rand: this.rand, listenerPos: this.listenerPos,
    };
    if (this.opts.hum) this.startHum();
    if (this.opts.scheduler && typeof setInterval !== 'undefined') this._timer = setInterval(() => this.update(), 50);
    ctx.onstatechange = () => { this.state = ctx.state; };
    this.state = ctx.state;
  }

  _hrtfOk() {
    if (!this.opts.hrtf) return false;
    try {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      return p.panningModel === 'HRTF';
    } catch { return false; }
  }

  setVolume(bus, slider01) {
    const v = Math.min(1, Math.max(0, slider01));
    this.sliders[bus] = v;
    if (!this.ctx) return;
    const g = bus === 'master' ? this.master : this.buses[bus];
    if (g) g.gain.value = v * v;
    if (this.sends[bus]) this.sends[bus].gain.value = v * v;
    if (bus === 'ambience' && this.sends.env) this.sends.env.gain.value = v * v; // env sits under ambience
  }

  // Level of a bus that has no settings slider (env: environment level × duck × pause), smoothed.
  setBusGain(bus, gain, tau = 0.1) {
    if (!this.ctx || bus in this.sliders) return;
    const g = this.buses[bus];
    if (!g) return;
    const now = this.ctx.currentTime;
    if (tau <= 0) { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(gain, now); } else g.gain.setTargetAtTime(gain, now, tau);
  }

  // Room acoustics. weights: one per ROOM_IMPULSES entry (normalised here, equal-power crossfade);
  // sends: { bus: scale } multiplies that bus's reverb send. fade ≈ seconds to settle.
  setAcoustics(weights, sends = {}, fade = 1) {
    this.acoustics = { weights: [...weights], sends: { ...this.acoustics.sends, ...sends } };
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tau = Math.max(0.01, fade / 3);
    const sum = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    this.rooms.forEach((r, i) => {
      const w = this.rooms.length === 1 ? 1 : Math.max(0, weights[i] ?? 0) / sum;
      r.weight = w;
      if (w > 0.001 && !r.connected) { this.reverbIn.connect(r.conv); r.connected = true; }
      if (w <= 0.001) r.idleAt = now + fade + r.tail; // disconnect once faded and its tail has rung out
      r.gain.gain.setTargetAtTime(Math.sqrt(w), now, tau);
    });
    for (const [bus, k] of Object.entries(sends)) this.sendScale[bus]?.gain.setTargetAtTime(k, now, tau);
  }

  // Peak level (linear) going into the master soft-clipper since the last call (dev metering).
  meterPeak() {
    if (!this.ctx?.createAnalyser) return 0;
    if (!this._meter) {
      this._meter = this.ctx.createAnalyser();
      this._meter.fftSize = 2048;
      this._meterBuf = new Float32Array(this._meter.fftSize);
      this.master.connect(this._meter);
    }
    this._meter.getFloatTimeDomainData(this._meterBuf);
    let m = 0;
    for (let i = 0; i < this._meterBuf.length; i++) m = Math.max(m, Math.abs(this._meterBuf[i]));
    return m;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ------------------------------------------------------------ presets
  // map: { id: preset } (content.sounds). Can be called before start(). Invalid presets are
  // reported with console.warn and skipped.
  loadPresets(map) {
    for (const [id, p] of Object.entries(map || {})) {
      const errs = validatePreset(p, id);
      if (errs.length) { console.warn(`[synth] preset "${id}" skipped:\n  ` + errs.join('\n  ')); continue; }
      this.presets[id] = p;
    }
    return this;
  }

  has(id) { return !!this.presets[id]; }

  get presetIds() { return Object.keys(this.presets).sort(); }

  get voiceCount() { return this.voices.filter((v) => !v.stopped).length; }

  // Play a preset. opts: { position?: {x,y,z}, volume? = 1, loop?, delay? (s) }.
  // Returns a handle: { id, playing, stop(fadeSec), setPosition(p), setVolume(v, fadeSec) }.
  play(id, opts = {}) {
    const p = this.presets[id];
    if (!p) {
      if (!this._warned.has(id)) { this._warned.add(id); console.warn(`[synth] unknown sound preset "${id}"`); }
      return DEAD_HANDLE;
    }
    if (!this.ctx || this.ctx.state === 'closed') return DEAD_HANDLE;
    this.engine.listenerPos = this.listenerPos;
    const live = this.voices.filter((v) => !v.stopped);
    if (live.length >= this.opts.maxVoices) {
      const victim = live.filter((v) => !v.loop).sort((a, b) => a.startedAt - b.startedAt)[0];
      if (!victim) {
        if (!this._warned.has('#cap')) { this._warned.add('#cap'); console.warn('[synth] voice cap reached by loops; dropping one-shot'); }
        return DEAD_HANDLE;
      }
      victim.stop(0.03);
    }
    const v = new Voice(this.engine, id, p, opts);
    this.voices.push(v);
    for (const fn of this.playHooks) { try { fn(v, id, opts); } catch (e) { console.error('[synth] play hook failed', e); } }
    return v;
  }

  stopAll(fadeSec = 0.1) {
    for (const v of this.voices) v.stop(fadeSec);
  }

  // Call each frame with the camera: position {x,y,z}, forward and up unit vectors.
  setListener(position, forward, up = { x: 0, y: 1, z: 0 }) {
    this.listenerPos = { x: position.x, y: position.y, z: position.z };
    if (!this.ctx) return;
    this.engine.listenerPos = this.listenerPos;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = position.x; L.positionY.value = position.y; L.positionZ.value = position.z;
      L.forwardX.value = forward.x; L.forwardY.value = forward.y; L.forwardZ.value = forward.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(position.x, position.y, position.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
    for (const v of this.voices) if (v.send && v.panner) v._updateSend();
  }

  // Scheduler tick (runs on a 50 ms timer unless opts.scheduler = false): schedules looping
  // triggers ahead of time and frees finished voices.
  update() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const r of this.rooms) {
      if (r.connected && r.weight <= 0.001 && r.idleAt && now > r.idleAt) { this.reverbIn.disconnect(r.conv); r.connected = false; }
    }
    this.voices = this.voices.filter((v) => {
      if (v.disposed) return false;
      if (now > v.endTime + 0.1) { v.dispose(); return false; }
      if (!v.stopped && v.loop) v.pump(now + 0.3);
      return true;
    });
  }

  // ------------------------------------------------------------ built-ins
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

  stopHum(fadeSec = 0.5) {
    if (!this.hum || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.hum.gain.cancelScheduledValues(now);
    this.hum.gain.setTargetAtTime(0, now, fadeSec / 3);
    const h = this.hum;
    this.hum = null;
    setTimeout(() => h.disconnect(), fadeSec * 1000 + 200);
  }

  // Player footstep. Uses the footstep_<surface> preset when loaded, else the built-in thump.
  footstep(intensity = 1, surface = 'carpet') {
    if (!this.ctx) return DEAD_HANDLE;
    const volume = Math.min(1.6, 0.6 + intensity * 0.5);
    const id = this.presets['footstep_' + surface] ? 'footstep_' + surface : 'footstep_carpet';
    if (this.presets[id]) return this.play(id, { volume });
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380 + Math.random() * 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16 + Math.random() * 0.05);
    src.connect(lp).connect(g).connect(this.buses.sfx);
    src.start(t, Math.random() * 1.5, 0.25);
    return DEAD_HANDLE;
  }

  // Flashlight switch. Uses the flashlight_click preset when loaded.
  click() {
    if (!this.ctx) return DEAD_HANDLE;
    if (this.presets.flashlight_click) return this.play('flashlight_click');
    const ctx = this.ctx;
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
    return DEAD_HANDLE;
  }
}
