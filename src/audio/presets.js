// Sound preset interpreter: turns content/sounds/*.json recipes into Web Audio graphs.
// Format reference: src/audio/presets.md. Pure module (no DOM): also used by tools/sound-check.mjs.
//
// Graph per voice (one play() call):
//   layer instance: source → [tremolo] → [filter] → env gain ─┐
//   layer instance: ...                                         ├→ voice.out → [occ lowpass → occ gain → panner] → bus
//                                                               └→ voice.send ──────────→ reverb send (per bus)
// The occlusion pair only exists on positioned spatial voices; it starts transparent (22 kHz, ×1)
// and is driven by voice.setOcclusion() (src/ambience occlusion). play(..., { occlude: false }) skips it.

export const WAVES = { sine: 'sine', square: 'square', saw: 'sawtooth', triangle: 'triangle' };
export const NOISES = ['white', 'pink', 'brown'];
// `env` (environment: hum, room tone, drips, vents, distant events) feeds the ambience bus, so the
// ambience slider applies; its own gain is the environment level / duck / pause fade.
export const BUSES = ['ambience', 'sfx', 'tenant', 'env'];
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf', 'allpass'];
export const LFO_TARGETS = ['gain', 'pitch', 'filter'];
export const LFO_WAVES = ['sine', 'square', 'saw', 'triangle', 'noise'];
export const CURVES = ['exp', 'lin'];
export const MAX_ONESHOT_SEC = 12;

export const PRESET_DEFAULTS = {
  bus: 'sfx', volume: 1, spatial: false, refDistance: 1, maxDistance: 30, rolloff: 1, reverb: 0, loop: false,
};
export const ENV_DEFAULTS = { a: 0.005, d: 0.2, s: 0, sus: 0, r: 0.05, curve: 'exp' };
const SILENT = 0.0001; // exponential ramps can't reach 0
export const OCC_OPEN_HZ = 22000; // occlusion lowpass when nothing is in the way
const MIN_ATTACK = 0.001; // avoid clicks from instant onsets

export const envOf = (layer) => ({ ...ENV_DEFAULTS, ...(layer.env || {}) });
// Time from trigger until the envelope is silent (sustain-free envelopes end after decay).
export const envLength = (e) => Math.max(e.a, MIN_ATTACK) + e.d + (e.s > 0 ? e.sus + e.r : 0);
const lfosOf = (layer) => (layer.lfo ? (Array.isArray(layer.lfo) ? layer.lfo : [layer.lfo]) : []);
const repeatSpan = (rep) => (rep ? (rep.count - 1) * rep.interval + (rep.jitter || 0) : 0);

// Longest a single play of the preset can last (Infinity for loop presets).
export function presetDuration(p) {
  if (p.loop) return Infinity;
  let layerEnd = 0;
  for (const L of p.layers) {
    layerEnd = Math.max(layerEnd, (L.start || 0) + (L.vary?.time || 0) + repeatSpan(L.repeat) + envLength(envOf(L)));
  }
  return (p.vary?.time || 0) + repeatSpan(p.repeat) + layerEnd;
}

// ---------------------------------------------------------------- validation
// Returns a list of human-readable problems ([] = valid). Unknown keys are errors so typos surface.
const PRESET_KEYS = ['id', 'note', 'bus', 'volume', 'spatial', 'refDistance', 'maxDistance', 'rolloff', 'reverb', 'loop', 'repeat', 'vary', 'layers'];
const LAYER_KEYS = ['note', 'osc', 'noise', 'freq', 'rate', 'detune', 'gain', 'start', 'env', 'pitchEnv', 'filter', 'lfo', 'repeat', 'vary'];

export function validatePreset(p, id = p?.id ?? '?') {
  const errs = [];
  const err = (where, msg) => errs.push(`${id}${where ? '.' + where : ''}: ${msg}`);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (o, k, min, max, where, required = false) => {
    if (o[k] === undefined) { if (required) err(where, `missing "${k}"`); return; }
    if (!isNum(o[k])) return err(where, `"${k}" must be a number`);
    if (o[k] < min || o[k] > max) err(where, `"${k}" = ${o[k]} outside [${min}, ${max}]`);
  };
  const keys = (o, allowed, where) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return err(where, 'must be an object'), false;
    for (const k of Object.keys(o)) if (!allowed.includes(k)) err(where, `unknown key "${k}"`);
    return true;
  };
  const oneOf = (o, k, list, where) => {
    if (o[k] !== undefined && !list.includes(o[k])) err(where, `"${k}" = ${JSON.stringify(o[k])}, expected one of ${list.join('|')}`);
  };
  const repeat = (r, where) => {
    if (r === undefined || !keys(r, ['count', 'interval', 'jitter'], where)) return;
    num(r, 'count', 1, 64, where, true);
    if (r.count !== undefined && !Number.isInteger(r.count)) err(where, '"count" must be an integer');
    num(r, 'interval', 0.01, 30, where, true);
    num(r, 'jitter', 0, (r.interval || 0) / 2, where);
  };
  const vary = (v, where) => {
    if (v === undefined || !keys(v, ['pitch', 'filter', 'gain', 'time'], where)) return;
    num(v, 'pitch', 0, 24, where); num(v, 'filter', 0, 4, where); num(v, 'gain', 0, 24, where); num(v, 'time', 0, 2, where);
  };
  const sweep = (s, where, lo, hi) => {
    if (s === undefined || !keys(s, ['from', 'to', 'time', 'delay', 'curve'], where)) return;
    num(s, 'from', lo, hi, where); num(s, 'to', lo, hi, where, true);
    num(s, 'time', 0.001, 30, where, true); num(s, 'delay', 0, 30, where);
    oneOf(s, 'curve', CURVES, where);
  };

  if (!keys(p, PRESET_KEYS, '')) return errs;
  oneOf(p, 'bus', BUSES, '');
  num(p, 'volume', 0, 2, '');
  num(p, 'refDistance', 0.01, 100, '');
  num(p, 'maxDistance', 0.1, 1000, '');
  num(p, 'rolloff', 0, 10, '');
  num(p, 'reverb', 0, 1, '');
  for (const k of ['spatial', 'loop']) if (p[k] !== undefined && typeof p[k] !== 'boolean') err('', `"${k}" must be true|false`);
  if ((p.maxDistance ?? 30) <= (p.refDistance ?? 1)) err('', 'maxDistance must be > refDistance');
  repeat(p.repeat, 'repeat');
  vary(p.vary, 'vary');
  if (!Array.isArray(p.layers) || !p.layers.length) return err('', '"layers" must be a non-empty array'), errs;
  if (p.layers.length > 12) err('', 'more than 12 layers');

  p.layers.forEach((L, i) => {
    const w = `layers[${i}]`;
    if (!keys(L, LAYER_KEYS, w)) return;
    if ((L.osc === undefined) === (L.noise === undefined)) return err(w, 'needs exactly one of "osc" or "noise"');
    if (L.osc !== undefined) {
      oneOf(L, 'osc', Object.keys(WAVES), w);
      num(L, 'freq', 10, 20000, w, true);
      if (L.rate !== undefined) err(w, '"rate" is for noise layers; use "freq"');
    } else {
      oneOf(L, 'noise', NOISES, w);
      num(L, 'rate', 0.05, 8, w);
      if (L.freq !== undefined) err(w, '"freq" is for osc layers; use "rate"');
    }
    num(L, 'detune', -2400, 2400, w);
    num(L, 'gain', 0.0001, 2, w);
    num(L, 'start', 0, 10, w);
    if (L.env !== undefined && keys(L.env, Object.keys(ENV_DEFAULTS), w + '.env')) {
      for (const k of ['a', 'd', 'sus', 'r']) num(L.env, k, 0, 20, w + '.env');
      num(L.env, 's', 0, 1, w + '.env');
      oneOf(L.env, 'curve', CURVES, w + '.env');
    }
    sweep(L.pitchEnv, w + '.pitchEnv', 0.01, 16);
    if (L.filter !== undefined && keys(L.filter, ['type', 'freq', 'q', 'gain', 'env'], w + '.filter')) {
      const f = L.filter;
      if (!FILTER_TYPES.includes(f.type)) err(w + '.filter', `"type" must be one of ${FILTER_TYPES.join('|')}`);
      num(f, 'freq', 10, 22000, w + '.filter', true);
      num(f, 'q', 0.05, 40, w + '.filter');
      num(f, 'gain', -40, 40, w + '.filter');
      sweep(f.env, w + '.filter.env', 10, 22000);
    }
    lfosOf(L).forEach((lf, j) => {
      const lw = `${w}.lfo[${j}]`;
      if (!keys(lf, ['target', 'wave', 'rate', 'depth'], lw)) return;
      if (!LFO_TARGETS.includes(lf.target)) err(lw, `"target" must be one of ${LFO_TARGETS.join('|')}`);
      oneOf(lf, 'wave', LFO_WAVES, lw);
      num(lf, 'rate', 0.01, 200, lw, true);
      num(lf, 'depth', 0, lf.target === 'gain' ? 1 : 4800, lw, true);
      if (lf.target === 'filter' && !L.filter) err(lw, 'filter LFO on a layer with no filter');
    });
    if (lfosOf(L).filter((lf) => lf.target === 'gain').reduce((s, lf) => s + (lf.depth || 0), 0) > 1) err(w, 'gain LFO depths sum above 1');
    repeat(L.repeat, w + '.repeat');
    vary(L.vary, w + '.vary');
  });

  if (!p.loop && errs.length === 0) {
    const d = presetDuration(p);
    if (d > MAX_ONESHOT_SEC) err('', `one-shot lasts ${d.toFixed(2)} s (> ${MAX_ONESHOT_SEC} s); make it a loop or shorten it`);
  }
  return errs;
}

// ---------------------------------------------------------------- engine helpers
// Shared noise buffers. `smooth` is value noise with one random knot per second (±1), used as a
// slow organic LFO: its playbackRate = knots per second.
export function makeNoiseBuffers(ctx, seconds = 4, rand = Math.random) {
  const sr = ctx.sampleRate;
  const make = (fill, secs = seconds) => {
    const buf = ctx.createBuffer(1, Math.floor(sr * secs), sr);
    fill(buf.getChannelData(0), sr);
    return buf;
  };
  const normalize = (d) => {
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.95 / m;
  };
  return {
    white: make((d) => { for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1; }),
    pink: make((d) => { // Paul Kellet's refined pink filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = rand() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
      normalize(d);
    }),
    brown: make((d) => {
      let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (rand() * 2 - 1)) / 1.02; d[i] = last; }
      // remove DC so the loop seam doesn't thump, then normalize
      let mean = 0;
      for (let i = 0; i < d.length; i++) mean += d[i];
      mean /= d.length;
      for (let i = 0; i < d.length; i++) d[i] -= mean;
      normalize(d);
    }),
    smooth: make((d, rate) => {
      const knots = 16;
      const k = Array.from({ length: knots }, () => rand() * 2 - 1);
      for (let i = 0; i < d.length; i++) {
        const x = i / rate, j = Math.floor(x), f = x - j;
        const a = k[j % knots], b = k[(j + 1) % knots];
        const c = (1 - Math.cos(f * Math.PI)) / 2;
        d[i] = a + (b - a) * c;
      }
    }, 16),
  };
}

// Reverb impulse: stereo decaying noise whose tail gets darker over time (air + soft surfaces).
// Optional (all backwards-compatible): `bright`/`dark` = one-pole coefficient at the start/end of the
// tail (0..1, higher = brighter), `early` = [[seconds, gain], ...] discrete early reflections,
// `flutter` = { period, gain, decay } a train of parallel-wall slap echoes (corridors).
export function makeImpulse(ctx, { seconds = 2.2, rt60 = 1.7, predelay = 0.012, bright = 0.85, dark = 0.1, early = null, flutter = null } = {}, rand = Math.random) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * predelay);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / rt60);
      const k = bright - (bright - dark) * Math.min(1, t / seconds); // one-pole lowpass closing over time
      y += ((rand() * 2 - 1) - y) * k;
      d[i] = y * env;
    }
    // discrete reflections, slightly offset per channel so they image wide
    for (const [et, eg] of early || []) {
      const j = pre + Math.floor(sr * (et * (c ? 1.07 : 1)));
      if (j < len) d[j] += eg * (rand() < 0.5 ? -1 : 1);
    }
    if (flutter) {
      const per = Math.max(0.002, flutter.period) * (c ? 1.04 : 1);
      const fd = flutter.decay ?? rt60 * 0.5;
      for (let n = 1; ; n++) {
        const t = n * per;
        const j = pre + Math.floor(sr * t);
        if (j >= len || t > fd * 1.5) break;
        const g = (flutter.gain ?? 0.4) * Math.exp((-6.9 * t) / fd);
        d[j] += g * (n % 2 ? 1 : -1);
        if (j + 1 < len) d[j + 1] += g * 0.5 * (n % 2 ? 1 : -1); // a little width so it isn't a click
      }
    }
  }
  return buf;
}

// Web Audio's lowpass/highpass Q is a resonance in dB; presets use classic linear Q everywhere.
const webQ = (type, q) => (type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(q) : q);

function ramp(param, value, time, curve) {
  if (curve === 'lin') param.linearRampToValueAtTime(value, time);
  else param.exponentialRampToValueAtTime(Math.max(value, SILENT), time);
}
// Sweep a param from s.from·scale to s.to·scale (pitch: ratios × base freq; filter: Hz × vary).
const sweepTo = (param, s, t, scale) => {
  const from = (s.from ?? 1) * scale;
  const t1 = t + (s.delay || 0);
  param.setValueAtTime(from, t);
  if (s.delay) param.setValueAtTime(from, t1);
  ramp(param, s.to * scale, t1 + s.time, s.curve);
};

function setXYZ(param3, p) {
  param3[0].value = p.x; param3[1].value = p.y; param3[2].value = p.z;
}

// ---------------------------------------------------------------- voice
// engine = { ctx, noise, buses, sends, hrtf, rand, listenerPos }
export class Voice {
  constructor(engine, id, preset, opts = {}) {
    const ctx = (this.ctx = engine.ctx);
    this.engine = engine;
    this.id = id;
    this.p = preset;
    this.loop = opts.loop ?? !!preset.loop;
    this.t0 = ctx.currentTime + Math.max(0, opts.delay || 0) + 0.005;
    this.startedAt = this.t0;
    this.stopped = false;
    this.disposed = false;
    this.insts = []; // { srcs: [node], out: node, end }
    this.endTime = this.loop ? Infinity : this.t0;
    this.vol = opts.volume ?? 1;
    this.pos = null;

    const bus = engine.buses[preset.bus || 'sfx'] || engine.buses.sfx;
    const out = (this.out = ctx.createGain());
    out.gain.value = (preset.volume ?? 1) * this.vol;
    // A spatial preset played without a position plays head-locked (no panner).
    if (preset.spatial && opts.position) {
      const pn = (this.panner = ctx.createPanner());
      pn.panningModel = engine.hrtf ? 'HRTF' : 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = preset.refDistance ?? PRESET_DEFAULTS.refDistance;
      pn.maxDistance = preset.maxDistance ?? PRESET_DEFAULTS.maxDistance;
      pn.rolloffFactor = preset.rolloff ?? PRESET_DEFAULTS.rolloff;
      if (opts.occlude !== false) {
        // occlusion: transparent until setOcclusion() is called
        const lp = (this.occFilter = ctx.createBiquadFilter());
        lp.type = 'lowpass';
        lp.frequency.value = OCC_OPEN_HZ;
        lp.Q.value = webQ('lowpass', 0.707);
        this.occGain = ctx.createGain();
        out.connect(lp).connect(this.occGain).connect(pn).connect(bus);
      } else {
        out.connect(pn).connect(bus);
      }
      this.setPosition(opts.position);
    } else {
      out.connect(bus);
    }
    const sendBus = engine.sends?.[preset.bus || 'sfx'];
    if (preset.reverb > 0 && sendBus) {
      this.send = ctx.createGain();
      // after the occlusion lowpass (if any): a sound behind walls fills the room dark, not bright
      (this.occFilter ?? out).connect(this.send).connect(sendBus);
      this._updateSend();
    }

    // Trigger streams. The preset stream fires the whole layer list; layer streams fire one layer.
    const rep = preset.repeat;
    // A non-loop preset forced to loop restarts every <its duration> seconds.
    const forced = this.loop && !preset.loop && !rep;
    this.layerLoop = this.loop && !rep && !forced; // designed loop: sustain / repeat layers forever
    const interval = rep ? rep.interval : forced ? presetDuration(preset) + 0.05 : 0;
    this.streams = [{
      kind: 'preset', base: this.t0, next: this.t0, k: 0, interval, jitter: rep?.jitter || 0,
      count: this.loop && !this.layerLoop ? Infinity : rep ? rep.count : 1,
    }];
    this.pump(this.loop ? ctx.currentTime + 0.3 : Infinity);
  }

  get playing() {
    return !this.stopped && !this.disposed && this.ctx.currentTime < this.endTime;
  }

  // Schedule every trigger due before `until` (seconds, context time).
  pump(until) {
    const rand = this.engine.rand;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.streams.length; i++) { // streams may grow while we iterate
      const s = this.streams[i];
      while (s.k < s.count && s.next <= until) {
        const t = s.next;
        s.k++;
        s.next = s.base + s.k * s.interval + (s.jitter ? (rand() * 2 - 1) * s.jitter : 0);
        if (this.loop && t < now - 0.05) continue; // scheduler fell behind: skip, don't pile up
        if (s.kind === 'preset') this._firePreset(t);
        else this._fireLayer(s.L, t, s.pv, false);
      }
    }
    this.streams = this.streams.filter((s) => s.k < s.count);
    // drop finished layer instances so long loops don't accumulate nodes
    if (this.insts.length > 8) {
      this.insts = this.insts.filter((inst) => {
        if (inst.end < now - 0.1) { inst.out.disconnect(); return false; }
        return true;
      });
    }
  }

  _firePreset(t) {
    const rand = this.engine.rand;
    const v = this.p.vary || {};
    const r = (x) => (x ? (rand() * 2 - 1) * x : 0);
    const pv = { pitch: r(v.pitch), filter: r(v.filter), gain: r(v.gain) };
    t += v.time ? rand() * v.time : 0;
    for (const L of this.p.layers) {
      const lt = t + (L.start || 0);
      if (L.repeat) {
        this.streams.push({
          kind: 'layer', L, pv, base: lt, next: lt, k: 0, interval: L.repeat.interval,
          jitter: L.repeat.jitter || 0, count: this.layerLoop ? Infinity : L.repeat.count,
        });
      } else {
        this._fireLayer(L, lt, pv, this.layerLoop);
      }
    }
  }

  _fireLayer(L, t, pv, sustain) {
    const { ctx, engine } = this;
    const rand = engine.rand;
    const lv = L.vary || {};
    const r = (x) => (x ? (rand() * 2 - 1) * x : 0);
    const semis = pv.pitch + r(lv.pitch);
    const oct = pv.filter + r(lv.filter);
    const db = pv.gain + r(lv.gain);
    t += lv.time ? rand() * lv.time : 0;
    const pr = 2 ** (semis / 12);

    let src, pitchParam, base;
    if (L.osc) {
      src = ctx.createOscillator();
      src.type = WAVES[L.osc];
      base = L.freq * pr;
      pitchParam = src.frequency;
    } else {
      src = ctx.createBufferSource();
      src.buffer = engine.noise[L.noise];
      src.loop = true;
      base = (L.rate ?? 1) * pr;
      pitchParam = src.playbackRate;
    }
    if (L.detune) src.detune.value = L.detune;
    if (L.pitchEnv) sweepTo(pitchParam, L.pitchEnv, t, base);
    else pitchParam.setValueAtTime(base, t);

    const srcs = [src];
    let node = src;
    const lfos = lfosOf(L);
    const gainDepth = lfos.filter((lf) => lf.target === 'gain').reduce((s, lf) => s + lf.depth, 0);
    let trem = null;
    if (gainDepth > 0) {
      trem = ctx.createGain();
      trem.gain.value = 1 - gainDepth / 2;
      node = node.connect(trem);
    }
    let filter = null;
    if (L.filter) {
      const f = L.filter;
      const k = 2 ** oct;
      filter = ctx.createBiquadFilter();
      filter.type = f.type;
      filter.Q.value = webQ(f.type, f.q ?? 0.707);
      if (f.gain !== undefined) filter.gain.value = f.gain;
      if (f.env) sweepTo(filter.frequency, { ...f.env, from: f.env.from ?? f.freq }, t, k);
      else filter.frequency.setValueAtTime(f.freq * k, t);
      node = node.connect(filter);
    }
    const g = ctx.createGain();
    node.connect(g).connect(this.out);

    // gain envelope
    const e = envOf(L);
    const peak = (L.gain ?? 1) * 10 ** (db / 20);
    const tA = t + Math.max(e.a, MIN_ATTACK);
    const tD = tA + e.d;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, tA);
    let end;
    if (e.s >= 1) g.gain.setValueAtTime(peak, tD);
    else if (e.d > 0) ramp(g.gain, e.s * peak, tD, e.curve);
    if (e.s <= 0) {
      end = tD;
      g.gain.setValueAtTime(0, tD + 0.002);
    } else if (sustain) {
      end = Infinity;
    } else {
      const tS = tD + e.sus;
      g.gain.setValueAtTime(Math.max(e.s * peak, SILENT), tS);
      ramp(g.gain, 0, tS + e.r, e.curve);
      g.gain.setValueAtTime(0, tS + e.r + 0.002);
      end = tS + e.r;
    }

    // LFOs
    for (const lf of lfos) {
      let lo;
      if (lf.wave === 'noise') {
        lo = ctx.createBufferSource();
        lo.buffer = engine.noise.smooth;
        lo.loop = true;
        lo.playbackRate.value = lf.rate;
      } else {
        lo = ctx.createOscillator();
        lo.type = WAVES[lf.wave || 'sine'];
        lo.frequency.value = lf.rate;
      }
      const dg = ctx.createGain();
      let param;
      if (lf.target === 'gain') { dg.gain.value = lf.depth / 2; param = trem.gain; }
      else if (lf.target === 'pitch') { dg.gain.value = lf.depth; param = src.detune; }
      else if (filter) { dg.gain.value = lf.depth; param = filter.detune; }
      else continue;
      lo.connect(dg).connect(param);
      srcs.push(lo);
    }

    for (const s of srcs) {
      if (s.buffer) s.start(t, rand() * s.buffer.duration);
      else s.start(t);
      if (end !== Infinity) s.stop(end + 0.02);
    }
    this.insts.push({ srcs, out: g, end });
    if (!this.loop && end > this.endTime) this.endTime = end;
  }

  // Fade out and stop. Default fade: the longest layer release (loops) or 50 ms.
  stop(fadeSec) {
    if (this.stopped || this.disposed) return;
    this.stopped = true;
    this.streams.length = 0;
    const now = this.ctx.currentTime;
    const defFade = this.loop ? Math.max(0.05, ...this.p.layers.map((L) => envOf(L).r)) : 0.05;
    const f = Math.max(0.005, fadeSec ?? defFade);
    const g = this.out.gain;
    const cur = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(cur, now);
    g.linearRampToValueAtTime(0, now + f);
    for (const inst of this.insts) {
      if (inst.end > now + f) for (const s of inst.srcs) { try { s.stop(now + f + 0.02); } catch { /* already stopped */ } }
    }
    this.endTime = now + f + 0.03;
  }

  setVolume(volume, fadeSec = 0.05) {
    if (this.stopped || this.disposed) return;
    this.vol = volume;
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    const cur = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(cur, now);
    g.linearRampToValueAtTime((this.p.volume ?? 1) * volume, now + Math.max(0.005, fadeSec));
    this._updateSend();
  }

  setPosition(p) {
    if (!p) return;
    this.pos = { x: p.x, y: p.y, z: p.z };
    const pn = this.panner;
    if (pn) {
      if (pn.positionX) setXYZ([pn.positionX, pn.positionY, pn.positionZ], p);
      else pn.setPosition(p.x, p.y, p.z);
    }
    this._updateSend();
  }

  // Muffle a spatial voice: lowpass `cutoff` Hz and `gain` (linear, 0..1), smoothed with time
  // constant `tau` seconds (0 = jump, for a voice that just started). No-op without the nodes.
  setOcclusion(cutoff, gain, tau = 0.1) {
    if (!this.occFilter || this.disposed) return;
    const now = this.ctx.currentTime;
    const f = Math.min(OCC_OPEN_HZ, Math.max(40, cutoff));
    const g = Math.min(1, Math.max(0, gain));
    this.occ = { cutoff: f, gain: g };
    const fp = this.occFilter.frequency, gp = this.occGain.gain;
    if (tau <= 0) {
      fp.cancelScheduledValues(now); gp.cancelScheduledValues(now);
      fp.setValueAtTime(f, now); gp.setValueAtTime(g, now);
    } else {
      fp.setTargetAtTime(f, now, tau);
      gp.setTargetAtTime(g, now, tau);
    }
  }

  // Reverb send falls off more gently than the direct sound, so distant sources sound farther.
  _updateSend() {
    if (!this.send) return;
    let k = 1;
    const L = this.engine.listenerPos;
    if (this.panner && this.pos && L) {
      const ref = this.p.refDistance ?? 1;
      const d = Math.min(Math.hypot(this.pos.x - L.x, this.pos.y - L.y, this.pos.z - L.z), this.p.maxDistance ?? 30);
      k = Math.sqrt(ref / (ref + (this.p.rolloff ?? 1) * Math.max(0, d - ref)));
    }
    this.send.gain.value = this.p.reverb * k;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopped = true;
    for (const inst of this.insts) for (const s of inst.srcs) { try { s.stop(); } catch { /* */ } }
    this.out.disconnect();
    this.panner?.disconnect();
    this.occFilter?.disconnect();
    this.occGain?.disconnect();
    this.send?.disconnect();
    this.insts.length = 0;
    this.streams.length = 0;
  }
}

// What play() returns when nothing will sound (unknown preset, audio not started, cap reached).
export const DEAD_HANDLE = Object.freeze({
  id: null, playing: false, stop() {}, setPosition() {}, setVolume() {}, setOcclusion() {},
});
