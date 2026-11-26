// Validate and offline-render every sound preset in content/sounds.
//   node tools/sound-check.mjs              → validate + render all, print a level report
//   node tools/sound-check.mjs vent_drone   → just these presets
//   node tools/sound-check.mjs --wav out/   → also write <id>.wav files to listen to (mono, 22.05 kHz)
//
// Node has no Web Audio, so this file carries a tiny mono OfflineAudioContext that implements the
// subset the interpreter uses (gain, oscillator, buffer source, biquad, panner distance gain,
// AudioParam automation + audio-rate modulation). It runs the REAL Synth/Voice code, so a node or
// method the mock doesn't know throws here first. Not modelled: HRTF/stereo panning and the
// convolver (reverb returns silence), so levels are dry. Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { Synth } from '../src/audio/synth.js';
import { validatePreset, presetDuration } from '../src/audio/presets.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SR = 22050;
const Q = 128;

// ---------------------------------------------------------------- mini Web Audio
class Param {
  constructor(ctx, v) { this.ctx = ctx; this._v = v; this.ev = []; this.inputs = new Set(); this._b = -1; this._buf = new Float32Array(Q); }
  get value() { return this.ev.length ? this.at(this.ctx.currentTime) : this._v; }
  set value(v) { this._fin(v); if (this.ev.length) this.setValueAtTime(v, this.ctx.currentTime); else this._v = v; }
  _fin(...xs) { for (const x of xs) if (!Number.isFinite(x)) throw new TypeError(`non-finite AudioParam value ${x}`); }
  _push(e) { this._fin(e.v, e.time); let i = this.ev.length; while (i > 0 && this.ev[i - 1].time > e.time) i--; this.ev.splice(i, 0, e); return this; }
  setValueAtTime(v, time) { return this._push({ type: 'set', v, time }); }
  linearRampToValueAtTime(v, time) { return this._push({ type: 'lin', v, time }); }
  exponentialRampToValueAtTime(v, time) { if (v === 0) throw new RangeError('exponential ramp to 0'); return this._push({ type: 'exp', v, time }); }
  setTargetAtTime(v, time, tau) { return this._push({ type: 'target', v, time, tau }); }
  cancelScheduledValues(time) { this.ev = this.ev.filter((e) => e.time < time); return this; }
  at(t) {
    let v = this._v, vt = 0, tg = null;
    const cur = (x) => (tg ? tg.v + (v - tg.v) * Math.exp(-(x - tg.time) / tg.tau) : v);
    for (const e of this.ev) {
      if (e.type === 'set' || e.type === 'target') {
        if (t < e.time) return cur(t);
        v = cur(e.time); vt = e.time;
        if (e.type === 'set') { v = e.v; tg = null; } else tg = e;
        continue;
      }
      v = cur(vt); tg = null;
      if (t < e.time) {
        const p = e.time > vt ? (t - vt) / (e.time - vt) : 1;
        if (e.type === 'lin') return v + (e.v - v) * p;
        return v * e.v > 0 ? v * Math.pow(e.v / v, p) : v;
      }
      v = e.v; vt = e.time;
    }
    return cur(t);
  }
  block(b) {
    if (this._b === b) return this._buf;
    this._b = b;
    const out = this._buf, t0 = (b * Q) / SR;
    if (!this.ev.length) out.fill(this._v);
    else for (let i = 0; i < Q; i++) out[i] = this.at(t0 + i / SR);
    for (const n of this.inputs) { const x = n.pull(b); for (let i = 0; i < Q; i++) out[i] += x[i]; }
    return out;
  }
}

class Node {
  constructor(ctx) { this.ctx = ctx; this.inputs = new Set(); this.outs = new Set(); this._b = -1; this._buf = new Float32Array(Q); }
  connect(d) { d.inputs.add(this); this.outs.add(d); return d; }
  disconnect(d) { for (const o of d ? [d] : [...this.outs]) { o.inputs.delete(this); this.outs.delete(o); } }
  pull(b) { if (this._b !== b) { this._b = b; this.process(b, this._buf); } return this._buf; }
  mix(b, out) { out.fill(0); for (const n of this.inputs) { const x = n.pull(b); for (let i = 0; i < Q; i++) out[i] += x[i]; } }
  process(b, out) { this.mix(b, out); }
}
class Gain extends Node {
  constructor(ctx) { super(ctx); this.gain = new Param(ctx, 1); }
  process(b, out) { this.mix(b, out); const g = this.gain.block(b); for (let i = 0; i < Q; i++) out[i] *= g[i]; }
}
class Scheduled extends Node {
  constructor(ctx) { super(ctx); this.t0 = Infinity; this.t1 = Infinity; }
  start(when = 0) { if (this.t0 !== Infinity) throw new Error('start() called twice'); this.t0 = Math.max(when, this.ctx.currentTime); }
  stop(when = 0) { if (this.t0 === Infinity) throw new Error('stop() before start()'); this.t1 = Math.max(when, this.ctx.currentTime); }
}
class Osc extends Scheduled {
  constructor(ctx) { super(ctx); this.type = 'sine'; this.frequency = new Param(ctx, 440); this.detune = new Param(ctx, 0); this.ph = 0; }
  process(b, out) {
    const f = this.frequency.block(b), d = this.detune.block(b);
    for (let i = 0; i < Q; i++) {
      const t = (b * Q + i) / SR;
      if (t < this.t0 || t >= this.t1) { out[i] = 0; continue; }
      const p = this.ph;
      out[i] = this.type === 'sine' ? Math.sin(2 * Math.PI * p) : this.type === 'square' ? (p < 0.5 ? 1 : -1)
        : this.type === 'sawtooth' ? 2 * p - 1 : 4 * Math.abs(p - 0.5) - 1;
      this.ph = (p + (f[i] * 2 ** (d[i] / 1200)) / SR) % 1;
      if (this.ph < 0) this.ph += 1;
    }
  }
}
class BufSrc extends Scheduled {
  constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; this.playbackRate = new Param(ctx, 1); this.detune = new Param(ctx, 0); }
  start(when = 0, offset = 0, duration) { super.start(when); this.pos = offset * SR; if (duration !== undefined) this.t1 = this.t0 + duration; }
  process(b, out) {
    const r = this.playbackRate.block(b), d = this.detune.block(b);
    const data = this.buffer.getChannelData(0), n = data.length;
    for (let i = 0; i < Q; i++) {
      const t = (b * Q + i) / SR;
      if (t < this.t0 || t >= this.t1 || (!this.loop && this.pos >= n)) { out[i] = 0; continue; }
      const j = Math.floor(this.pos), f = this.pos - j;
      out[i] = data[j % n] * (1 - f) + data[(j + 1) % n] * f;
      this.pos += r[i] * 2 ** (d[i] / 1200);
      if (this.loop) this.pos = ((this.pos % n) + n) % n;
    }
  }
}
class Biquad extends Node {
  constructor(ctx) {
    super(ctx); this.type = 'lowpass';
    this.frequency = new Param(ctx, 350); this.Q = new Param(ctx, 1); this.gain = new Param(ctx, 0); this.detune = new Param(ctx, 0);
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  process(b, out) {
    this.mix(b, out);
    // coefficients per render quantum (Web Audio spec cookbook formulas)
    const f0 = Math.min(Math.max(this.frequency.block(b)[0] * 2 ** (this.detune.block(b)[0] / 1200), 1), SR / 2 - 1);
    const Qv = this.Q.block(b)[0], G = this.gain.block(b)[0];
    const w0 = (2 * Math.PI * f0) / SR, cw = Math.cos(w0), sw = Math.sin(w0), A = 10 ** (G / 40);
    const aQ = sw / (2 * Math.max(Qv, 1e-4)), aDb = sw / (2 * 10 ** (Qv / 20)), aS = (sw / 2) * Math.SQRT2;
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + aDb; a1 = -2 * cw; a2 = 1 - aDb; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + aDb; a1 = -2 * cw; a2 = 1 - aDb; break;
      case 'bandpass': b0 = aQ; b1 = 0; b2 = -aQ; a0 = 1 + aQ; a1 = -2 * cw; a2 = 1 - aQ; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + aQ; a1 = -2 * cw; a2 = 1 - aQ; break;
      case 'allpass': b0 = 1 - aQ; b1 = -2 * cw; b2 = 1 + aQ; a0 = 1 + aQ; a1 = -2 * cw; a2 = 1 - aQ; break;
      case 'peaking': b0 = 1 + aQ * A; b1 = -2 * cw; b2 = 1 - aQ * A; a0 = 1 + aQ / A; a1 = -2 * cw; a2 = 1 - aQ / A; break;
      case 'lowshelf': { const k = 2 * Math.sqrt(A) * aS;
        b0 = A * ((A + 1) - (A - 1) * cw + k); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - k);
        a0 = (A + 1) + (A - 1) * cw + k; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - k; break; }
      case 'highshelf': { const k = 2 * Math.sqrt(A) * aS;
        b0 = A * ((A + 1) + (A - 1) * cw + k); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - k);
        a0 = (A + 1) - (A - 1) * cw + k; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - k; break; }
      default: throw new Error('unknown biquad type ' + this.type);
    }
    for (let i = 0; i < Q; i++) {
      const x = out[i];
      const y = (b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2) / a0;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; out[i] = y;
    }
  }
}
class Panner extends Node {
  constructor(ctx) {
    super(ctx); this.panningModel = 'equalpower'; this.distanceModel = 'inverse';
    this.refDistance = 1; this.maxDistance = 10000; this.rolloffFactor = 1;
    this.positionX = new Param(ctx, 0); this.positionY = new Param(ctx, 0); this.positionZ = new Param(ctx, 0);
  }
  process(b, out) {
    this.mix(b, out);
    const L = this.ctx.listener;
    const d0 = Math.hypot(this.positionX.block(b)[0] - L.positionX.value, this.positionY.block(b)[0] - L.positionY.value, this.positionZ.block(b)[0] - L.positionZ.value);
    const d = Math.min(Math.max(d0, this.refDistance), this.maxDistance);
    const g = this.refDistance / (this.refDistance + this.rolloffFactor * (d - this.refDistance));
    for (let i = 0; i < Q; i++) out[i] *= g;
  }
}
class Convolver extends Node { constructor(ctx) { super(ctx); this.buffer = null; this.normalize = true; } process(b, out) { out.fill(0); } }
class Shaper extends Node {
  constructor(ctx) { super(ctx); this.curve = null; this.oversample = 'none'; }
  process(b, out) {
    this.mix(b, out);
    const c = this.curve;
    if (!c) return;
    for (let i = 0; i < Q; i++) {
      const v = Math.min(Math.max(out[i], -1), 1) * 0.5 + 0.5, k = v * (c.length - 1), j = Math.floor(k), f = k - j;
      out[i] = j >= c.length - 1 ? c[c.length - 1] : c[j] * (1 - f) + c[j + 1] * f;
    }
  }
}
class AudioBuf {
  constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr; this.ch = Array.from({ length: ch }, () => new Float32Array(len)); }
  getChannelData(c) { return this.ch[c]; }
}
class MiniOfflineContext {
  constructor(seconds) {
    this.sampleRate = SR; this.length = Math.ceil(seconds * SR); this.currentTime = 0; this.state = 'running';
    this.destination = new Node(this);
    const p = (v) => new Param(this, v);
    this.listener = { positionX: p(0), positionY: p(0), positionZ: p(0), forwardX: p(0), forwardY: p(0), forwardZ: p(-1), upX: p(0), upY: p(1), upZ: p(0) };
    this.hooks = []; // [{time, fn}] run before the block containing `time`
  }
  createGain() { return new Gain(this); }
  createOscillator() { return new Osc(this); }
  createBufferSource() { return new BufSrc(this); }
  createBiquadFilter() { return new Biquad(this); }
  createPanner() { return new Panner(this); }
  createConvolver() { return new Convolver(this); }
  createWaveShaper() { return new Shaper(this); }
  createBuffer(ch, len, sr) { return new AudioBuf(ch, len, sr); }
  resume() {}
  at(time, fn) { this.hooks.push({ time, fn }); this.hooks.sort((a, b) => a.time - b.time); }
  render() {
    const out = new Float32Array(this.length);
    for (let b = 0; b * Q < this.length; b++) {
      this.currentTime = (b * Q) / SR;
      while (this.hooks.length && this.hooks[0].time <= this.currentTime) this.hooks.shift().fn();
      const x = this.destination.pull(b);
      for (let i = 0; i < Q && b * Q + i < this.length; i++) out[b * Q + i] = x[i];
    }
    return out;
  }
}

// ---------------------------------------------------------------- analysis helpers
function analyse(buf) {
  let peak = 0, sum = 0, last = 0, nan = false;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (!Number.isFinite(buf[i])) nan = true;
    if (a > peak) peak = a;
    if (a > 0.001) last = i;
    sum += buf[i] * buf[i];
  }
  // spectral centroid of the loudest 2048-sample window (naive DFT, 256 bins)
  const N = 2048;
  let best = 0, bestE = -1;
  for (let s = 0; s + N <= buf.length; s += N / 2) {
    let e = 0;
    for (let i = s; i < s + N; i++) e += buf[i] * buf[i];
    if (e > bestE) { bestE = e; best = s; }
  }
  let num = 0, den = 0;
  if (buf.length >= N) {
    for (let k = 1; k < N / 2; k += 4) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
        const x = buf[best + i] * w, ph = (2 * Math.PI * k * i) / N;
        re += x * Math.cos(ph); im -= x * Math.sin(ph);
      }
      const m = Math.hypot(re, im), f = (k * SR) / N;
      num += m * f; den += m;
    }
  }
  return { peak, rms: Math.sqrt(sum / buf.length), audibleEnd: last / SR, nan, centroid: den ? num / den : 0 };
}
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');

function writeWav(file, buf) {
  const data = Buffer.alloc(44 + buf.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + buf.length * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, data);
}

// Render one play of a preset through the real Synth. Spatial presets sit 3 m in front.
function render(presets, id, { seconds, stopAt, seed } = {}) {
  const p = presets[id];
  let s = seed ?? 1;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ctx = new MiniOfflineContext(seconds);
  const synth = new Synth({ hum: false, scheduler: false, rand });
  synth.start(ctx);
  synth.loadPresets({ [id]: p });
  synth.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  let h;
  ctx.at(0, () => { h = synth.play(id, p.spatial ? { position: { x: 0, y: 1.6, z: -3 } } : {}); });
  for (let t = 0.05; t < seconds; t += 0.05) ctx.at(t, () => synth.update());
  if (stopAt) ctx.at(stopAt, () => h.stop());
  const buf = ctx.render();
  return { buf, synth, handle: h };
}

// ---------------------------------------------------------------- main
const args = process.argv.slice(2);
const wavIdx = args.indexOf('--wav');
const wavDir = wavIdx >= 0 ? path.resolve(args[wavIdx + 1]) : null;
const only = args.filter((a, i) => !a.startsWith('--') && (wavIdx < 0 || i !== wavIdx + 1));
if (wavDir) fs.mkdirSync(wavDir, { recursive: true });

const dir = path.join(ROOT, 'content/sounds');
const presets = {};
let failures = 0;
const fail = (msg) => { failures++; console.log('  ✖ ' + msg); };

for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  let p;
  try { p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { fail(`${f}: bad JSON: ${e.message}`); continue; }
  const id = p.id ?? path.basename(f, '.json');
  if (id !== path.basename(f, '.json')) fail(`${f}: id "${id}" does not match file name`);
  presets[id] = p;
}

// every object's sound.preset must exist
const objDir = path.join(ROOT, 'content/objects');
if (fs.existsSync(objDir)) {
  for (const f of fs.readdirSync(objDir).filter((f) => f.endsWith('.json'))) {
    const o = JSON.parse(fs.readFileSync(path.join(objDir, f), 'utf8'));
    const ref = o.components?.sound?.preset;
    if (ref && !presets[ref]) fail(`objects/${f}: sound.preset "${ref}" has no content/sounds/${ref}.json`);
  }
}

console.log(`backend: built-in mini OfflineAudioContext (mono, ${SR} Hz, dry: no reverb/HRTF)\n`);
console.log('preset                 bus       dur(s)  end(s)  peak dB  rms dB  centroid  vary');
const origWarn = console.warn;
for (const id of Object.keys(presets).sort()) {
  if (only.length && !only.includes(id)) continue;
  const p = presets[id];
  const errs = validatePreset(p, id);
  if (errs.length) { console.log(id); errs.forEach(fail); continue; }
  const dur = presetDuration(p);
  const loop = !!p.loop;
  const seconds = loop ? 8 : dur + 0.6;
  const stopAt = loop ? 5 : undefined;
  let r;
  try { r = render(presets, id, { seconds, stopAt, seed: 7 }); } catch (e) { console.log(id); fail(`render threw: ${e.stack}`); continue; }
  const a = analyse(r.buf);
  // a second play with a different seed must differ (per-play variation)
  const b = render(presets, id, { seconds, stopAt, seed: 99 }).buf;
  let diff = 0, ref = 0;
  for (let i = 0; i < b.length; i++) { diff += (b[i] - r.buf[i]) ** 2; ref += r.buf[i] ** 2; }
  const varPct = ref ? Math.sqrt(diff / ref) * 100 : 0;
  console.log(`${id.padEnd(22)} ${(p.bus || 'sfx').padEnd(9)} ${(loop ? 'loop' : dur.toFixed(2)).padStart(6)} ${a.audibleEnd.toFixed(2).padStart(7)} ${db(a.peak).padStart(8)} ${db(a.rms).padStart(7)} ${a.centroid.toFixed(0).padStart(8)}Hz ${varPct.toFixed(0).padStart(4)}%`);
  if (a.nan) fail(`${id}: output contains NaN/Infinity`);
  if (a.peak > 0.7) fail(`${id}: peak ${db(a.peak)} dBFS at default sliders reaches the master soft-clipper (keep < -3 dB)`);
  if (a.peak < 0.003) fail(`${id}: practically silent (peak ${db(a.peak)} dBFS)`);
  if (!loop && a.audibleEnd > dur + 0.1) fail(`${id}: still audible at ${a.audibleEnd.toFixed(2)} s, longer than computed ${dur.toFixed(2)} s`);
  if (loop) {
    // steady while looping, silent after stop() + release
    const seg = (t0, t1) => { let s = 0; for (let i = Math.floor(t0 * SR); i < t1 * SR; i++) s += r.buf[i] ** 2; return Math.sqrt(s / ((t1 - t0) * SR)); };
    const mid = seg(3.5, 4.9), tail = seg(7.5, 8);
    if (mid < 0.002) fail(`${id}: loop is silent while playing`);
    if (tail > 0.0005) fail(`${id}: loop still sounding ${(7.5 - 5).toFixed(1)} s after stop()`);
    if (r.handle.playing) fail(`${id}: handle.playing still true after stop()`);
  } else if (r.handle.playing) fail(`${id}: handle.playing still true after the sound ended`);
  if (!p.loop && varPct < 1) fail(`${id}: two plays are nearly identical (${varPct.toFixed(2)}% diff); add "vary"`);
  if (wavDir) writeWav(path.join(wavDir, id + '.wav'), r.buf);
}

// ---------------------------------------------------------------- engine behaviour
console.log('\nengine checks');
{
  const ctx = new MiniOfflineContext(3);
  const synth = new Synth({ hum: false, scheduler: false, maxVoices: 24 });
  synth.start(ctx);
  const warns = [];
  console.warn = (...m) => warns.push(m.join(' '));
  synth.loadPresets(presets);
  const h1 = synth.play('no_such_sound');
  synth.play('no_such_sound');
  console.warn = origWarn;
  if (warns.filter((w) => w.includes('no_such_sound')).length !== 1) fail('unknown preset should warn exactly once');
  else console.log('  ✔ unknown preset warns once and returns a dead handle');
  if (h1.playing !== false || typeof h1.stop !== 'function') fail('dead handle shape');

  const oneShot = presets.footstep_carpet ? 'footstep_carpet' : Object.keys(presets).find((k) => !presets[k].loop);
  const loopId = Object.keys(presets).find((k) => presets[k].loop);
  const loops = [];
  ctx.at(0, () => {
    if (loopId) for (let i = 0; i < 3; i++) loops.push(synth.play(loopId, { position: { x: i, y: 0, z: 0 } }));
    for (let i = 0; i < 40; i++) synth.play(oneShot);
  });
  let maxLive = 0;
  for (let t = 0.05; t < 3; t += 0.05) ctx.at(t, () => { synth.update(); maxLive = Math.max(maxLive, synth.voiceCount); });
  ctx.at(0.01, () => { maxLive = Math.max(maxLive, synth.voiceCount); });
  const out = analyse(ctx.render());
  if (maxLive > 24) fail(`voice cap exceeded: ${maxLive} live voices`);
  else console.log(`  ✔ voice cap holds (max ${maxLive} live voices for 43 plays)`);
  if (loops.some((l) => !l.playing)) fail('a looping voice was stolen');
  else if (loopId) console.log('  ✔ looping voices survive stealing');
  if (out.nan) fail('NaN in mixed output');
  if (synth.voices.length > 3 + 2) fail(`finished voices not freed (${synth.voices.length} left)`);
  else console.log(`  ✔ finished voices are freed (${synth.voices.length} left: the loops)`);
  loops.forEach((l) => l.stop(0.1));
}
{
  // distance attenuation: a spatial preset far away should be quieter than near
  const sp = Object.keys(presets).find((k) => presets[k].spatial && !presets[k].loop);
  if (sp) {
    const level = (z) => {
      const ctx = new MiniOfflineContext(presetDuration(presets[sp]) + 0.3);
      const synth = new Synth({ hum: false, scheduler: false, rand: () => 0.5 });
      synth.start(ctx); synth.loadPresets({ [sp]: presets[sp] });
      synth.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      ctx.at(0, () => synth.play(sp, { position: { x: 0, y: 0, z } }));
      return analyse(ctx.render()).rms;
    };
    const near = level(-1), far = level(-15);
    if (!(far < near * 0.5)) fail(`spatial ${sp}: far (${db(far)}) not clearly quieter than near (${db(near)})`);
    else console.log(`  ✔ spatial distance: ${sp} at 1 m ${db(near)} dB, at 15 m ${db(far)} dB`);
  }
}

console.log(failures ? `\n✖ ${failures} problem(s)` : `\n✔ ${Object.keys(presets).length} presets OK`);
process.exitCode = failures ? 1 : 0;
