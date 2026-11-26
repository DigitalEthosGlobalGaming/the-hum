// Environmental + spatial audio (a world system, bound to the live game by ./register.js).
//
//   hum        a pool of `humEmitters` looping fluoro_hum_unit voices, re-assigned a few times a
//              second to the nearest working fixtures (on/flicker, circuit powered and switched on).
//              Each follows its fixture's light output every frame, so flicker stutters and fuse/
//              switch changes are heard in sync; failing tubes crackle on their dropouts.
//   room tone  one quiet head-locked loop so silence is never digital zero
//   acoustics  flood fill of the cell grid around the listener (when it moves a cell, ≤ 4×/s) →
//              crossfade of the small / hall / corridor impulses + per-bus reverb send scales
//   occlusion  every positioned voice gets lowpass + gain from the walls between it and the
//              listener: new voices at once, then a few per frame round-robin, smoothed
//   emitters   leaks drip, vents breathe (vent_drone pool), from pooled records spawned in
//              onRoomPlaced and released in onRoomDropped
//   director   rare seeded distant events far away (game.audioDirector, see ./director.js)
//   mix        everything here plays on the `env` bus (under the ambience slider): its gain is
//              config level × duck (reading / notebook / stings) × pause fade
import { AcousticsEstimator, ROOMS, CELL_M } from './acoustics.js';
import { Occluder, wallCells } from './occlusion.js';
import { nearestK, assignSlots, Pool } from './pool.js';
import { scanRoom } from './emitters.js';
import { AudioDirector } from './director.js';
import { presetDuration } from '../audio/presets.js';
import { Rng, hash } from '../core/rng.js';
import { installDebug } from './debug.js';

export const AUDIO_DEFAULTS = {
  maxVoices: 32,
  env: 1,               // env bus level (all environmental audio)
  roomTone: 0.6,
  hum: 0.8,             // per-emitter hum level
  humEmitters: 6,
  humRange: 16,         // metres
  crackle: 0.55,
  vents: 0.55,
  ventEmitters: 2,
  ventRange: 14,
  ventsPerRoom: [0, 2],
  drips: 0.7,
  dripEmitters: 4,
  dripRange: 14,
  distant: 1,
  distantMinGap: 25,    // seconds between distant events at intensity 1
  distantMaxGap: 110,   // ... at intensity 0
  distantFirst: 45,
  distantDistance: [20, 32],
  intensity: 0,
  acousticsRadius: 12,
  acousticsInterval: 0.25,
  acousticsFade: 1,
  occlusion: { perWallDb: -6, maxDb: -20, minCutoff: 280, maxWalls: 6, perFrame: 4, smooth: 0.12, detourPerWall: 6 },
  duckDb: -10,
  duckAttack: 0.25,
  duckRelease: 0.9,
  duckPresets: ['sting_low'],
  pausedLevel: 0.15,
  pauseFade: 0.5,
};

const FAR_PRESET = { thud: 'far_thud', door: 'far_door', phone: 'far_phone', chair: 'far_chair', steps: 'far_step' };

let bound = null;

/** Bind to the live game once (called from the first Gameplay.update by register.js). */
export function bindAmbience(gp) {
  const game = gp?.game;
  if (bound?.game === game) return bound;
  // only a real game: a world that takes systems and our Synth (Node tests pass fakes)
  if (typeof game?.world?.addSystem !== 'function' || !Array.isArray(game.synth?.playHooks)) return null;
  bound = new AmbienceSystem(game);
  game.ambience = bound;
  game.audioDirector = bound.director;
  game.world.addSystem(bound);
  return bound;
}

export class AmbienceSystem {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.synth = game.synth;
    const user = game.content?.config?.audio ?? game.cfg?.audio ?? {};
    this.cfg = { ...AUDIO_DEFAULTS, ...user, occlusion: { ...AUDIO_DEFAULTS.occlusion, ...(user.occlusion ?? {}) } };
    const cfg = this.cfg;
    const world = this.world;
    this.isSolid = (cx, cz) => world.isSolidAt(cx * CELL_M + 1, cz * CELL_M + 1);
    this.acoustics = new AcousticsEstimator(cfg.acousticsRadius);
    this.acu = null;                 // last estimate (the estimator's reused result object)
    this.acuCell = null;
    this.acuAt = -1;
    this.occluder = new Occluder(this.synth, this.isSolid, cfg.occlusion, this.acoustics);
    this.director = new AudioDirector(game.seed ?? world.seed ?? 0, cfg);
    this.rng = new Rng(hash((game.seed ?? 0) >>> 0, 'ambience'));
    this.clock = 0;                  // advances only while playing (pause-aware)
    this.t = 0;                      // wall time (frames), for fades and throttles

    // pooled emitter records: fixtures (for the hum), leaks, vents
    this.records = new Pool(() => ({ kind: '', x: 0, y: 0, z: 0, d2: 0, roomKey: null, light: null, placed: null, next: 0, rng: null }),
      (r) => { r.light = null; r.placed = null; r.next = 0; r.rng = null; });
    this.byRoom = new Map();         // roomKey → [records]
    this.fixtures = [];
    this.leaks = [];
    this.vents = [];
    this._cands = [];
    this._near = [];
    this._wantHum = [];
    this._wantVent = [];

    this.humSlots = Array.from({ length: cfg.humEmitters }, () => ({ target: null, h: null, vol: 0, moveAt: 0, prevOut: 1, crackleAt: 0 }));
    this.ventSlots = Array.from({ length: cfg.ventEmitters }, () => ({ target: null, h: null, vol: 0, moveAt: 0 }));
    this.tone = null;
    this.refreshAt = 0;
    this.dirty = true;
    this.crackleBudget = 0;
    this.envGain = -1;
    this.duckUntil = 0;
    this.steps = null;               // active "footsteps that answer yours" event
    this.started = false;

    if (cfg.maxVoices) this.synth.opts.maxVoices = cfg.maxVoices;
    // every new positioned voice is occluded at once (no bright first frames); stings duck the env
    this._hook = (v, id) => {
      if (v.occFilter) this.occluder.applyNow(v);
      if (cfg.duckPresets.includes(id)) this.duckUntil = Math.max(this.duckUntil, this.t + Math.min(12, presetDuration(v.p)) + 0.3);
    };
    this.synth.playHooks.push(this._hook);

    const ev = game.events;
    this.unsubs = [];
    if (ev) {
      this.unsubs.push(ev.on('power:switch', (e) => this.onPower(e.roomKey, e.on ? 'hum_surge' : 'hum_kill', 0)));
      this.unsubs.push(ev.on('power:fuse', (e) => this.onPower(e.roomKey, 'hum_surge', 0.3)));
      this.unsubs.push(ev.on('power:tube', () => { this.dirty = true; }));
      this.unsubs.push(ev.on('player:step', () => this.onPlayerStep()));
    }
    this.debug = installDebug(this);
  }

  // ---------------------------------------------------------------- rooms

  onRoomPlaced(placed, world) {
    if (this.byRoom.has(placed.key)) this.onRoomDropped(placed);
    const list = [];
    for (const L of placed.built?.lights ?? []) {
      const r = this.records.acquire();
      r.kind = 'fixture'; r.x = L.pos.x; r.y = L.pos.y; r.z = L.pos.z; r.light = L; r.placed = placed; r.roomKey = placed.key;
      list.push(r);
      this.fixtures.push(r);
    }
    scanRoom(placed, world?.seed ?? this.game.seed ?? 0, this.cfg, (kind, x, y, z) => {
      const r = this.records.acquire();
      r.kind = kind; r.x = x; r.y = y; r.z = z; r.roomKey = placed.key; r.placed = placed;
      if (kind === 'leak') {
        r.rng = new Rng(hash(world?.seed ?? 0, 'drip', placed.key, Math.round(x * 10), Math.round(z * 10)));
        r.next = 0;
        this.leaks.push(r);
      } else this.vents.push(r);
      list.push(r);
    });
    this.byRoom.set(placed.key, list);
    this.dirty = true;
  }

  onRoomDropped(placed) {
    const list = this.byRoom.get(placed.key);
    if (!list) return;
    this.byRoom.delete(placed.key);
    for (const r of list) {
      const arr = r.kind === 'fixture' ? this.fixtures : r.kind === 'leak' ? this.leaks : this.vents;
      const i = arr.indexOf(r);
      if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
      for (const s of this.humSlots) if (s.target === r) { s.target = null; s.moveAt = 0; }
      for (const s of this.ventSlots) if (s.target === r) { s.target = null; s.moveAt = 0; }
      this.records.release(r);
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- voices

  /** Create the pooled loops once audio is running (and again if something stopped them). */
  ensureVoices() {
    const s = this.synth;
    if (!s.ctx) return false;
    const far = { x: 0, y: -50, z: 0 };
    for (const slot of this.humSlots) {
      if (slot.h?.playing) continue;
      slot.h = s.play('fluoro_hum_unit', { position: far, volume: 0, loop: true });
      slot.vol = 0; slot.target = null;
    }
    for (const slot of this.ventSlots) {
      if (slot.h?.playing) continue;
      slot.h = s.play('vent_drone', { position: far, volume: 0, loop: true });
      slot.vol = 0; slot.target = null;
    }
    if (!this.tone?.playing) this.tone = s.play('room_tone', { volume: this.cfg.roomTone, loop: true });
    if (!this.started) { this.started = true; this.dirty = true; }
    return true;
  }

  listener() {
    return this.synth.listenerPos ?? this.game.player?.pos ?? null;
  }

  /** Is fixture record r giving light (or about to: stuttering back on)? */
  static working(r) {
    const L = r.light;
    if (!L || L.cond === 'dead') return false;
    const c = r.placed?.power?.circuits?.[L.circuit];
    return !c || (c.powered && c.on);
  }

  refresh(lp) {
    const cfg = this.cfg;
    // hum: nearest working fixtures
    const cands = this._cands;
    let n = 0;
    for (const r of this.fixtures) if (AmbienceSystem.working(r)) cands[n++] = r;
    nearestK(cands, n, lp.x, lp.z, cfg.humEmitters, cfg.humRange, this._wantHum);
    assignSlots(this.humSlots, this._wantHum, (slot) => this.retarget(slot));
    // vents
    nearestK(this.vents, this.vents.length, lp.x, lp.z, cfg.ventEmitters, cfg.ventRange, this._wantVent);
    assignSlots(this.ventSlots, this._wantVent, (slot) => this.retarget(slot));
    cands.length = 0;
  }

  // A slot changed target: fade out (if audible), then move while silent.
  retarget(slot) {
    if (slot.vol > 0.01) {
      slot.h?.setVolume(0, 0.12);
      slot.vol = 0;
      slot.moveAt = this.t + 0.15;
    } else slot.moveAt = this.t;
  }

  moveSlot(slot) {
    slot.moveAt = 0;
    const r = slot.target;
    if (!r || !slot.h) return;
    slot.h.setPosition(r);
    this.occluder.applyNow(slot.h);
    slot.prevOut = r.light?.out ?? 1;
  }

  updateHum() {
    const cfg = this.cfg;
    for (const slot of this.humSlots) {
      if (!slot.h) continue;
      if (slot.moveAt && this.t >= slot.moveAt) this.moveSlot(slot);
      const r = slot.target;
      const L = r?.light;
      const out = L && !slot.moveAt ? (L.out ?? 0) : 0;
      const target = cfg.hum * out;
      if (Math.abs(target - slot.vol) > 0.02 || (target === 0 && slot.vol !== 0)) {
        const unsteady = L && (L.cond === 'flicker' || (L.stutterUntil ?? 0) > (this.world.power?.clock ?? 0));
        slot.h.setVolume(target, unsteady ? 0.012 : target < slot.vol ? 0.06 : 0.1);
        slot.vol = target;
      }
      // failing tube: crackle on the edges of its dropouts, in sync with the picture
      if (L && !slot.moveAt) {
        const unsteady = L.cond === 'flicker' || (L.stutterUntil ?? 0) > (this.world.power?.clock ?? 0);
        const edge = (slot.prevOut > 0.4 && out < 0.15) || (slot.prevOut < 0.15 && out > 0.4);
        if (unsteady && edge && this.t - slot.crackleAt > 0.09 && this.crackleBudget >= 1 && this.running) {
          this.crackleBudget -= 1;
          slot.crackleAt = this.t;
          this.synth.play('flicker_crackle', { position: L.pos, volume: cfg.crackle * (0.6 + 0.4 * this.rng.next()) });
        }
        slot.prevOut = out;
      }
    }
  }

  updateVents() {
    for (const slot of this.ventSlots) {
      if (!slot.h) continue;
      if (slot.moveAt && this.t >= slot.moveAt) this.moveSlot(slot);
      const target = slot.target && !slot.moveAt ? this.cfg.vents : 0;
      if (Math.abs(target - slot.vol) > 0.01) {
        slot.h.setVolume(target, target > slot.vol ? 1.2 : 0.12);
        slot.vol = target;
      }
    }
  }

  updateDrips(lp) {
    const near = nearestK(this.leaks, this.leaks.length, lp.x, lp.z, this.cfg.dripEmitters, this.cfg.dripRange, this._near);
    for (const r of near) {
      if (!r.next) { r.next = this.clock + 0.3 + r.rng.next() * 3; continue; }
      if (this.clock < r.next) continue;
      this.synth.play('drip', { position: r, volume: this.cfg.drips * (0.55 + 0.45 * r.rng.next()) });
      r.next = this.clock + dripGap(r.rng);
    }
  }

  // ---------------------------------------------------------------- power events

  onPower(roomKey, preset, delay) {
    this.dirty = true;
    const placed = this.world.rooms.get(roomKey);
    const lp = this.listener();
    if (!placed || !lp) return;
    let best = null, bd = Infinity;
    for (const L of placed.built.lights) {
      const d = (L.pos.x - lp.x) ** 2 + (L.pos.z - lp.z) ** 2;
      if (d < bd) { bd = d; best = L; }
    }
    if (best && bd < 30 * 30) this.synth.play(preset, { position: best.pos, delay, volume: this.cfg.hum });
  }

  // ---------------------------------------------------------------- distant events

  /** A far point, preferring unloaded space and directions with walls in the way. */
  farPoint(lp) {
    const [lo, hi] = this.cfg.distantDistance;
    const base = this.rng.next() * Math.PI * 2;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = base + (i * Math.PI) / 4;
      const d = lo + (hi - lo) * this.rng.next();
      const x = lp.x + Math.cos(a) * d, z = lp.z + Math.sin(a) * d;
      const walls = wallCells(this.isSolid, lp.x, lp.z, x, z, CELL_M, 4);
      const unloaded = this.world.roomAt(x, z) ? 0 : 2;
      const score = Math.min(walls, 3) + unloaded + this.rng.next() * 1.5;
      if (score > bestScore) { bestScore = score; best = { x, y: 0.8, z }; }
    }
    return best;
  }

  playDistant(kind, lp) {
    const pos = this.farPoint(lp);
    this.director.last.pos = pos;
    const vol = this.cfg.distant;
    if (kind === 'steps') {
      // a few steps of its own, then it only walks while you walk, and stops when you stop
      this.steps = { pos: { x: pos.x, y: 0, z: pos.z }, until: this.clock + 7 + this.rng.next() * 6, own: 2 + Math.floor(this.rng.next() * 3), ownAt: this.clock, lastYou: -9, late: this.rng.next() < 0.25 };
      return;
    }
    this.synth.play(FAR_PRESET[kind], { position: pos, volume: vol });
  }

  farStep(delay = 0) {
    const s = this.steps;
    // it drifts a little each step, like someone pacing
    s.pos.x += (this.rng.next() - 0.5) * 0.9;
    s.pos.z += (this.rng.next() - 0.5) * 0.9;
    this.synth.play('far_step', { position: s.pos, delay, volume: this.cfg.distant * (0.8 + 0.2 * this.rng.next()) });
  }

  onPlayerStep() {
    const s = this.steps;
    if (!s || !this.running) return;
    s.lastYou = this.clock;
    if (s.own > 0) return;
    this.farStep(0.18 + this.rng.next() * 0.14);
  }

  updateSteps() {
    const s = this.steps;
    if (!s) return;
    if (s.own > 0 && this.clock >= s.ownAt) {
      this.farStep();
      s.own--;
      s.ownAt = this.clock + 0.55 + this.rng.next() * 0.1;
    }
    // you stopped: sometimes one more step, a beat too late
    if (s.own <= 0 && s.late && s.lastYou > 0 && this.clock - s.lastYou > 0.9) {
      s.late = false;
      this.farStep();
    }
    if (this.clock > s.until && this.clock - s.lastYou > 0.6) this.steps = null;
  }

  // ---------------------------------------------------------------- mix

  get running() { return !!this.game.playing && !this.game.paused; }

  updateMix() {
    const cfg = this.cfg;
    const reading = !!(this.game.diegetic?.reading || this.game.diegetic?.notebookOpen);
    const ducked = reading || this.t < this.duckUntil;
    const paused = !this.running;
    const target = cfg.env * (ducked ? 10 ** (cfg.duckDb / 20) : 1) * (paused ? cfg.pausedLevel : 1);
    if (Math.abs(target - this.envGain) < 0.002) return;
    const down = target < this.envGain;
    const fade = paused !== this._wasPaused ? cfg.pauseFade : down ? cfg.duckAttack : cfg.duckRelease;
    this._wasPaused = paused;
    this.synth.setBusGain('env', target, this.envGain < 0 ? 0 : fade / 3);
    this.envGain = target;
    this.ducked = ducked;
  }

  updateAcoustics(lp) {
    const cx = Math.floor(lp.x / CELL_M), cz = Math.floor(lp.z / CELL_M);
    const moved = !this.acuCell || this.acuCell[0] !== cx || this.acuCell[1] !== cz;
    if (!moved || this.t - this.acuAt < this.cfg.acousticsInterval) return;
    this.acuCell = [cx, cz];
    this.acuAt = this.t;
    this.acu = this.acoustics.estimate(this.isSolid, cx, cz);
    this.synth.setAcoustics(this.acu.weights, this.acu.sends, this.cfg.acousticsFade);
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    this.t += dt;
    const running = this.running;
    if (running) this.clock += dt;
    if (!this.ensureVoices()) return;
    const lp = this.listener();
    if (!lp) return;
    this.crackleBudget = Math.min(3, this.crackleBudget + dt * 4); // ≤ ~4 crackles a second overall
    this.updateMix();
    this.updateAcoustics(lp);
    if (this.dirty || this.t >= this.refreshAt) {
      this.dirty = false;
      this.refreshAt = this.t + 0.2;
      this.refresh(lp);
    }
    this.updateHum();
    this.updateVents();
    this.occluder.update();
    if (running) {
      this.updateDrips(lp);
      this.updateSteps();
      const kind = this.director.tick(dt, true, !!this.steps);
      if (kind) this.playDistant(kind, lp);
    }
    this.debug?.update(dt);
  }

  dispose() {
    for (const u of this.unsubs) u?.();
    const i = this.synth.playHooks.indexOf(this._hook);
    if (i >= 0) this.synth.playHooks.splice(i, 1);
    for (const s of [...this.humSlots, ...this.ventSlots]) s.h?.stop(0.3);
    this.tone?.stop(0.5);
    this.debug?.remove();
  }

  // ---------------------------------------------------------------- debug

  debugLines() {
    const a = this.acu;
    const lp = this.listener();
    const f = (v, d = 2) => (v == null ? '-' : v.toFixed(d));
    const lines = [];
    lines.push(`AMBIENCE  env ${f(this.envGain)}${this.ducked ? ' (ducked)' : ''}${this.running ? '' : ' (paused)'} · voices ${this.synth.voiceCount}/${this.synth.opts.maxVoices} · peak ${peakDb(this.synth.meterPeak())} dBFS`);
    if (a) {
      lines.push(`acoustics ${ROOMS.map((n, i) => `${n} ${f(a.weights[i])}`).join(' · ')}`);
      lines.push(`          cells ${a.cells} size ${f(a.size)} elong ${f(a.elong)} width ${f(a.width, 0)} m len ${f(a.length, 0)} m open ${f(a.open)} wet ${f(a.wet)}`);
      lines.push(`          sends sfx ${f(a.sends.sfx)} env ${f(a.sends.env)} tenant ${f(a.sends.tenant)}`);
    }
    lines.push(`hum       ${this.humSlots.filter((s) => s.target).length}/${this.humSlots.length} emitters · ${this.fixtures.length} fixtures loaded`);
    for (const s of this.humSlots) {
      if (!s.target || !lp) continue;
      const L = s.target.light;
      lines.push(`  tube ${f(Math.hypot(L.pos.x - lp.x, L.pos.z - lp.z), 1).padStart(5)} m  ${L.cond.padEnd(7)} out ${f(L.out)} vol ${f(s.vol)}  ${occText(s.h)}`);
    }
    lines.push(`vents     ${this.ventSlots.filter((s) => s.target).length}/${this.ventSlots.length} playing · ${this.vents.length} loaded`);
    for (const s of this.ventSlots) if (s.target && lp) lines.push(`  vent ${f(Math.hypot(s.target.x - lp.x, s.target.z - lp.z), 1).padStart(5)} m  ${occText(s.h)}`);
    lines.push(`leaks     ${this.leaks.length} loaded · ${this._near.length} dripping nearby`);
    const d = this.director;
    lines.push(`director  intensity ${f(d.intensity)} · next in ${f(d.next, 0)} s · events ${d.count}${d.last ? ` · last ${d.last.kind} @${f(d.last.at, 0)} s` : ''}${this.steps ? ' · STEPS answering' : ''}`);
    lines.push(`pool      records ${this.records.live} live / ${this.records.made} made`);
    lines.push('occlusion (positioned voices)');
    let n = 0;
    for (const v of this.synth.voices) {
      if (!v.occFilter || v.stopped || n >= 10) continue;
      n++;
      lines.push(`  ${v.id.padEnd(16)} ${lp && v.pos ? f(Math.hypot(v.pos.x - lp.x, v.pos.z - lp.z), 1).padStart(5) + ' m' : ''}  ${occText(v)}`);
    }
    return lines;
  }
}

const peakDb = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
const occText = (v) => (v?.occ ? `walls ${v._occWalls ?? 0} amt ${(v._occAmount ?? 0).toFixed(2)} lp ${Math.round(v.occ.cutoff)} Hz ${(20 * Math.log10(Math.max(1e-4, v.occ.gain))).toFixed(1)} dB` : 'open');

/** Seconds until a leak's next drop: mostly a slow irregular beat, sometimes a quick double, sometimes a long pause. */
export function dripGap(rng) {
  const r = rng.next();
  if (r < 0.18) return 0.15 + rng.next() * 0.25;
  if (r < 0.26) return 7 + rng.next() * 9;
  return 1.1 + rng.next() * rng.next() * 4;
}
