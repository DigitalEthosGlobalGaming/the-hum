// Power network: ceiling-fixture states, room circuits, fuse boxes, wall switches, spare tubes,
// timed lights (glow sticks, matches), candles, calm auras (music box) and dark-reveal writing.
// The world creates one (world.power) and registers it with world.addSystem; it also owns the
// shader light list (world.updateLights → updateLights) and world.lightAt / world.auras.
//
// Light is safety: everything here feeds lightAt(pos) → 0..1, which vitals (sanity) and the
// Tenant read. See src/CONTRACTS.md "Power network" for the API and events.
import * as THREE from 'three';
import { shared, MAX_LIGHTS } from '../render/ps1.js';
import { slotAtBlock } from '../world/layout/index.js';
import { rollPool } from '../spawn/pools.js';
import { Rng, hash } from '../core/rng.js';
import {
  DEFAULTS, circuitOf, fixtureOutput, attenuation, powerRun, roomRecord, resolveRoom,
  toggleCircuits, powerCircuits,
} from './lightModel.js';
import { TimedEffects } from './timed.js';
import { glowMaterial, darkMessage } from './glow.js';

const CELL = 2;
const WALL_H = 3;
const _c = new THREE.Color();
const _v = new THREE.Vector3();

let active = null;
/** The live network (scripts reach it through this; there is one world per page). */
export const getPower = () => active;

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export class PowerNetwork {
  constructor(world) {
    this.world = world;
    active = this;
    this.cfg = { ...DEFAULTS, darkReveal: 0.12, lootChance: 0.3, switchChance: 0.3, writingChance: 0.15, ...(world.content?.config?.power ?? {}) };
    this.fixtureColor = new THREE.Color(...this.cfg.fixtureColor);
    this.started = false;
    this.paused = false;
    this.later = [];             // [{ at (power clock), fn }]
    this.auraSounds = new Map(); // aura id → synth handle
    this.flickerT = 0;
    this._frame = [];            // this frame's world lights { pos, color, range, k }
    this._pool = [];
    this._seenStore = null;
    const ev = world.events;
    if (ev) {
      ev.on('game:start', () => { this.started = true; });
      ev.on('game:pause', () => { this.paused = true; });
      ev.on('game:resume', () => { this.paused = false; });
    }
  }

  /** Timed effects only advance while playing (started, not paused). */
  get running() { return this.started && !this.paused; }
  set running(v) { this.started = !!v; this.paused = !v; }

  get store() { return powerRun(this.world.run); }
  get timed() {
    const s = this.store;
    if (this._seenStore !== s) { this._seenStore = s; this._timed = new TimedEffects(s); }
    return this._timed;
  }
  get clock() { return this.timed.clock; }
  /** Calm zones etc. [{ pos, radius, kind: 'calm', until }] (until in power-clock seconds). */
  get auras() { return this.timed.auras; }

  get synth() { return this.world.objects?.audio ?? null; }
  emit(name, payload) { this.world.events?.emit(name, payload); }
  after(sec, fn) { this.later.push({ at: this.clock + sec, fn }); }

  play(preset, pos, opts = {}) {
    const s = this.synth;
    if (!s?.play) return null;
    return s.play(preset, { position: pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined, ...opts });
  }

  /** Per-run state of a world instance (same keys as game.gameplay.stableKey). */
  objState(inst) {
    const m = inst.meta ?? {};
    const key = m.placedKey ?? (m.spotKey ? `${m.spotKey}:${inst.id}` : m.roomKey != null && m.fixed != null ? `${m.roomKey}#${m.fixed}` : null);
    const saved = key ? this.world.run.objState?.get(key) : null;
    return saved ?? inst.state ?? (inst.state = {});
  }

  // ---------------------------------------------------------------- room streaming

  onRoomPlaced(placed, world) {
    const key = placed.key;
    const lights = placed.built.lights;
    const salt = hash(world.seed, 'lights', key) % 997;
    const unpowered = (placed.objects ?? []).some((i) => i.id === 'fuse_box' && !this.objState(i).powered);
    const rec = roomRecord(world.run, key);
    const fixtures = lights.map((l) => ({ idx: l.idx, cell: l.cell, fixture: l.fixture, x: l.pos.x, z: l.pos.z }));
    const { conds, circuits } = resolveRoom(fixtures, {
      seed: world.seed, roomKey: key, depth: placed.depth, room: placed.json, cfg: this.cfg, unpowered,
    }, rec);
    placed.power = { circuits, rec, fixtureInsts: new Map() };
    lights.forEach((l, i) => {
      l.cond = conds[i];
      l.circuit = circuitOf(l.cell[0], l.cell[1]);
      l.color = this.fixtureColor;
      l.range = this.cfg.fixtureRange;
      if (!l.salted) { l.seed += salt; l.salted = true; }
      l.out = fixtureOutput(l, circuits[l.circuit], this.clock);
      placed.built.setFixtureLit?.(i, l.out > 0 ? 1 : 0);
    });
    this.syncFixtureInsts(placed);
    this.decorate(placed);
  }

  onRoomDropped(placed) {
    if (placed.power) placed.power.fixtureInsts.clear();
  }

  /** Invisible-ish interactables under dead fixtures, so E with a spare tube can find them. */
  syncFixtureInsts(placed) {
    const objs = this.world.objects;
    if (!objs?.defs?.light_fixture) return;
    const map = placed.power.fixtureInsts;
    for (const l of placed.built.lights) {
      const inst = map.get(l.idx);
      if (l.cond === 'dead' && !inst) {
        const it = objs.spawn('light_fixture', { x: l.pos.x, y: WALL_H - 0.035, z: l.pos.z }, 0, { roomKey: placed.key, fixtureIdx: l.idx });
        if (it) { map.set(l.idx, it); placed.objects?.push(it); }
      } else if (l.cond !== 'dead' && inst) {
        objs.remove(inst);
        map.delete(l.idx);
        const j = placed.objects?.indexOf(inst) ?? -1;
        if (j >= 0) placed.objects.splice(j, 1);
      }
    }
  }

  /**
   * Seeded extras a room may get from this system (tunable in config.power, 0 turns one off):
   * a loot spot rolled from power_room_loot, a wall light switch, dark-reveal writing.
   * They use spot keys "<roomKey>/power_*", so taken ones never come back.
   */
  decorate(placed) {
    const world = this.world, objs = world.objects, run = world.run;
    const pools = world.content?.pools ?? {};
    const g = placed.built.grid;
    if (!g || !objs) return;
    const rng = new Rng(hash(world.seed, 'power-decor', placed.key));
    const safe = placed.depth < this.cfg.safeDepth;
    const floorCells = [];
    for (let cz = 1; cz < g.h - 1; cz++) for (let cx = 1; cx < g.w - 1; cx++) if (!g.solid[cz * g.w + cx]) floorCells.push([cx, cz]);
    if (!floorCells.length) return;
    const spawn = (id, pos, rot, spotKey) => {
      if (run.taken?.has(spotKey)) return null;
      if (objs.instances.some((i) => i.meta?.spotKey === spotKey)) return null;
      const inst = objs.spawn(id, pos, rot, { roomKey: placed.key, spotKey });
      if (inst) placed.objects?.push(inst);
      return inst;
    };
    // 1. loot
    if (pools.power_room_loot && rng.chance(this.cfg.lootChance)) {
      const [cx, cz] = rng.pick(floorCells);
      const ids = rollPool('power_room_loot', pools, rng, { depth: placed.depth, zone: placed.entry?.zone, spawnedUnique: run.spawnedUnique });
      if (ids[0]) spawn(ids[0], { x: g.ox + cx * CELL + 1, y: 0, z: g.oz + cz * CELL + 1 }, rng.range(0, Math.PI * 2), `${placed.key}/power_loot`);
    }
    // wall faces: floor cell + a solid (non-void) neighbour
    const wallSpot = () => {
      for (let a = 0; a < 30; a++) {
        const [cx, cz] = rng.pick(floorCells);
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const [dx, dz] = dirs[rng.int(0, 3)];
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h || !g.solid[nz * g.w + nx]) continue;
        const kind = placed.json.legend?.[placed.json.layout[nz]?.[nx]];
        if (kind === 'void') continue;
        const n = { x: -dx, z: -dz };            // wall normal, into the cell
        const along = rng.range(-0.5, 0.5);
        return {
          x: g.ox + cx * CELL + 1 + dx * 0.985 + (dz !== 0 ? along : 0),
          z: g.oz + cz * CELL + 1 + dz * 0.985 + (dx !== 0 ? along : 0),
          yaw: Math.atan2(-n.x, -n.z), // front (-z local) faces into the cell (= yawFacing(n))
        };
      }
      return null;
    };
    // 2. a light switch (rooms with fixtures)
    if (!safe && placed.built.lights.length && rng.chance(this.cfg.switchChance)) {
      const s = wallSpot();
      if (s) spawn('light_switch', { x: s.x, y: 1.1, z: s.z }, s.yaw, `${placed.key}/power_switch`);
    }
    // 3. dark-reveal writing
    if (rng.chance(this.cfg.writingChance)) {
      const s = wallSpot();
      if (s) spawn(rng.chance(0.4) ? 'dark_arrow' : 'dark_writing', { x: s.x, y: 0.7, z: s.z }, s.yaw, `${placed.key}/power_writing`);
    }
  }

  // ---------------------------------------------------------------- queries

  /** Which room fixture an interactable (light_fixture inst) stands for: { placed, light } | null. */
  fixtureFor(inst) {
    const key = inst?.meta?.roomKey;
    const placed = key != null ? this.world.rooms.get(key) : null;
    const light = placed?.built.lights[inst.meta.fixtureIdx];
    return light ? { placed, light } : null;
  }

  /** Room keys that share a block edge with a placed room (loaded or not). */
  neighbourKeys(placed) {
    const e = placed.entry;
    const own = new Set(e.bigRoom?.slots ?? [e.slotKey]);
    const [ox, oz] = e.origin;
    const [cols, rows] = e.size ?? [placed.built.grid.w, placed.built.grid.h];
    const out = new Set();
    for (let bz = oz; bz < oz + Math.ceil(rows / 8); bz++) {
      for (let bx = ox; bx < ox + Math.ceil(cols / 8); bx++) {
        if (!own.has(slotAtBlock(bx, bz).key)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const s = slotAtBlock(bx + dx, bz + dz);
          if (own.has(s.key)) continue;
          const r = this.world.layout?.slotResult?.(s);
          out.add(r ? (r.bigRoom?.key ?? r.slotKey) : s.key);
        }
      }
    }
    return [...out];
  }

  /** Circuit state for a world position: { placed, circuits } | null. */
  roomPower(pos) {
    const placed = this.world.roomAt(pos.x, pos.z);
    return placed?.power ? placed : null;
  }

  // ---------------------------------------------------------------- actions (scripts call these)

  /** Bring a fixture back: cond → 'on', stutters on over ~1 s with the buzz. */
  reviveFixture(placed, light, delay = 0) {
    light.cond = 'on';
    (placed.power.rec.fixtures ??= {})[light.idx] = 'on';
    const len = this.cfg.stutterSeconds * (0.7 + 0.6 * ((light.seed * 0.618) % 1));
    light.stutterFrom = this.clock + delay;
    light.stutterUntil = this.clock + delay + len;
    this.syncFixtureInsts(placed);
    return light;
  }

  /** Spare tube into a dead fixture (inst = its light_fixture interactable). */
  installTube(inst) {
    const f = this.fixtureFor(inst);
    if (!f || f.light.cond !== 'dead') return false;
    this.reviveFixture(f.placed, f.light);
    this.play('fluoro_flicker_buzz', f.light.pos, { volume: 0.9 });
    this.emit('power:tube', { roomKey: f.placed.key, idx: f.light.idx });
    return true;
  }

  /**
   * A fuse went into a box: the room's circuits are powered and every dead tube in the room and
   * its neighbours stutters on. Rooms not built yet are revived when they stream in.
   */
  fuseInserted(pos) {
    const placed = this.roomPower(pos);
    if (!placed) return null;
    powerCircuits(placed.power.circuits, placed.power.rec);
    const revived = [];
    let n = 0;
    const reviveRoom = (p, baseDelay) => {
      for (const l of p.built.lights) {
        if (l.cond !== 'dead') {
          // newly powered tubes in this room stutter too
          if (p === placed) { l.stutterFrom = this.clock + baseDelay; l.stutterUntil = this.clock + baseDelay + this.cfg.stutterSeconds * 0.8; }
          continue;
        }
        const d = baseDelay + Math.min(0.6, n++ * 0.07);
        this.reviveFixture(p, l, d);
        revived.push(l);
      }
    };
    reviveRoom(placed, 0.3);
    const rooms = [placed.key];
    for (const k of this.neighbourKeys(placed)) {
      const p = this.world.rooms.get(k);
      if (p?.power) reviveRoom(p, 0.6);
      else roomRecord(this.world.run, k).revive = true;
      rooms.push(k);
    }
    // a few buzzes at the tubes coming back (not one per fixture: voices are capped)
    const buzz = [...placed.built.lights.filter((l) => l.cond !== 'dead'), ...revived];
    buzz.slice(0, 4).forEach((l, i) => this.after(0.3 + i * 0.18, () => this.play('fluoro_flicker_buzz', l.pos, { volume: 0.8 })));
    this.emit('power:fuse', { roomKey: placed.key, rooms, revived: revived.length });
    return { roomKey: placed.key, rooms, revived: revived.length };
  }

  /** Flip the room's light switch at pos. Returns the new on/off, or null if no room. */
  toggleSwitch(pos, circuit = null) {
    const placed = this.roomPower(pos);
    if (!placed) return null;
    const on = toggleCircuits(placed.power.circuits, placed.power.rec, circuit);
    if (on) for (const l of placed.built.lights) if (l.cond !== 'dead') { l.stutterFrom = this.clock; l.stutterUntil = this.clock + 0.35; }
    this.emit('power:switch', { roomKey: placed.key, on });
    return on;
  }

  /** true when the room's switch is on (any circuit), false when off, null without circuits. */
  switchOn(pos) {
    const placed = this.roomPower(pos);
    const cs = placed ? Object.values(placed.power.circuits) : [];
    return cs.length ? cs.some((c) => c.on) : null;
  }

  /** A struck match: tiny warm light around the player for `duration` s; lights candles near pos. */
  strikeMatch(pos, { duration = 10, radius = 1.8 } = {}) {
    const L = this.timed.addLight({ follow: 'player', pos, color: [0.95, 0.62, 0.3], range: 3.6, flicker: 0.2, duration });
    const lit = [];
    for (const inst of this.world.objects.instances) {
      if (!inst.def.tags?.includes('candle')) continue;
      const p = inst.root.position;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) <= radius && this.lightCandle(inst)) lit.push(inst);
    }
    this.emit('light:timed', { kind: 'match', light: L });
    return { light: L, candles: lit };
  }

  lightCandle(inst) {
    const st = this.objState(inst);
    if (st.lit) return false;
    st.lit = true;
    this.play('match_strike', inst.root.position, { volume: 0.4 });
    this.emit('light:candle', { inst });
    return true;
  }

  /** Expiry for something placed in a room (glow marker): state.expiresAt on the power clock. */
  expiresIn(seconds) { return this.clock + seconds; }

  /**
   * Wind a music box. `state` = the box's state (travels with it between pocket and floor);
   * `inst` = the world inst if it's on the floor, else it's carried. Starts a calm aura.
   */
  windMusicBox(state, inst = null, pos = null, { duration = 30, radius = 5 } = {}) {
    state.auraId ??= `mb:${this.store.seq++}`;
    const p = inst ? inst.root.position : pos;
    const a = this.timed.addAura({ id: state.auraId, pos: p, radius, kind: 'calm', duration, follow: 'music_box', roomKey: inst?.meta?.roomKey ?? null });
    state.playUntil = a.until;
    this.auraSounds.get(a.id)?.stop?.(0.1);
    const h = this.play('music_box_melody', p, { loop: true });
    if (h) this.auraSounds.set(a.id, h);
    this.emit('aura:start', { aura: a });
    return a;
  }

  // ---------------------------------------------------------------- per frame

  update(dt, ctx, world = this.world) {
    const timed = this.timed;
    const gone = timed.tick(dt, this.running);
    for (const e of gone) {
      const h = this.auraSounds.get(e.id);
      if (h) { h.stop?.(0.8); this.auraSounds.delete(e.id); }
      if (e.kind) this.emit('aura:end', { aura: e });
    }
    const t = timed.clock;
    if (this.later.length) {
      const due = this.later.filter((l) => l.at <= t);
      if (due.length) {
        this.later = this.later.filter((l) => l.at > t);
        for (const l of due) { try { l.fn(); } catch (err) { console.error('[power] timer failed', err); } }
      }
    }
    const player = ctx?.player?.pos ?? null;
    const cam = ctx?.camera?.position ?? player;

    // follow-the-player timed lights
    for (const L of timed.lights) if (L.follow === 'player' && player) L.pos = { x: player.x, y: player.y + 1.2, z: player.z };

    // objects: timed markers, candles, switches, dark writing, music boxes
    const carriedAuras = new Set(timed.auras.filter((a) => a.follow === 'music_box').map((a) => a.id));
    for (const inst of [...world.objects.instances]) {
      const id = inst.id;
      const tags = inst.def.tags;
      if (id === 'glow_marker' || inst.state?.expiresAt != null) {
        const st = inst.state ?? {};
        if (st.expiresAt != null && st.expiresAt <= t) { this.expire(inst); continue; }
        if (inst.light && st.expiresAt != null) {
          inst.light.base ??= inst.light.color.clone();
          const left = st.expiresAt - t;
          inst.light.color.copy(inst.light.base).multiplyScalar(left < 30 ? Math.max(0.1, left / 30) : 1);
        }
      }
      if (tags?.includes('candle')) {
        const lit = !!this.objState(inst).lit;
        const flame = inst.root.children[inst.root.children.length - 1];
        if (flame) flame.visible = lit;
        if (lit) this.pushLight(_v.set(inst.root.position.x, inst.root.position.y + 0.25, inst.root.position.z), _c.setRGB(1.0, 0.62, 0.28), 3.4, 0.85 + 0.15 * Math.sin(t * 13 + inst.uid) * Math.sin(t * 5.3));
      }
      if (id === 'light_switch') {
        const on = this.switchOn(inst.root.position);
        const nub = inst.root.children[1];
        if (nub) nub.rotation.x = on === false ? 0.5 : -0.5;
      }
      if (tags?.includes('dark_writing')) this.updateWriting(inst, cam);
      if (id === 'music_box') {
        const st = this.objState(inst);
        const a = st.auraId && carriedAuras.has(st.auraId) ? timed.auras.find((x) => x.id === st.auraId) : null;
        if (a) {
          a.pos = { x: inst.root.position.x, y: inst.root.position.y, z: inst.root.position.z };
          a.roomKey = inst.meta?.roomKey ?? null;
          carriedAuras.delete(a.id);
        }
      }
    }
    // music-box auras with no box on the floor: carried (follow the player) unless their room unloaded
    for (const id of carriedAuras) {
      const a = timed.auras.find((x) => x.id === id);
      if (a.roomKey && !world.rooms.has(a.roomKey)) continue;
      if (player) { a.pos = { x: player.x, y: player.y, z: player.z }; a.roomKey = null; }
    }
    for (const a of timed.auras) this.auraSounds.get(a.id)?.setPosition?.(a.pos);

    // fixture outputs → ceiling texture/emissive + light list
    this.flickerT -= dt;
    const buzzNow = this.running && this.flickerT <= 0;
    if (buzzNow) this.flickerT = 0.5;
    for (const placed of world.rooms.values()) {
      if (!placed.power) continue;
      const { circuits } = placed.power;
      const lights = placed.built.lights;
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        const out = fixtureOutput(L, circuits[L.circuit], t);
        L.out = out;
        placed.built.setFixtureLit?.(i, out > 0.5 ? 1 : out > 0.02 ? 0.4 : 0);
        if (buzzNow && L.cond === 'flicker' && out > 0 && cam && Math.random() < 0.12) {
          const d = Math.hypot(L.pos.x - cam.x, L.pos.z - cam.z);
          if (d < 8) this.play('fluoro_flicker_buzz', L.pos, { volume: 0.35 });
        }
      }
    }
  }

  /** Remove an expired placed thing for good (its world.run.placed entry too). */
  expire(inst) {
    const run = this.world.run, m = inst.meta ?? {};
    if (m.placedKey) { run.placed?.delete(m.placedKey); run.objState?.delete(m.placedKey); }
    this.world.objects.remove(inst);
    this.emit('light:expired', { id: inst.id });
  }

  /** Dark writing glows only while its spot is dark and the torch isn't on it. */
  updateWriting(inst, cam) {
    if (!inst._glow) {
      inst._glow = true;
      const st = this.objState(inst);
      const kind = inst.id === 'dark_arrow' ? 'arrow' : 'text';
      const seed = hash(this.world.seed, 'writing', inst.meta?.spotKey ?? inst.meta?.placedKey ?? inst.uid);
      st.message ??= kind === 'arrow' ? (seed % 2 ? '→' : '←') : darkMessage(this.cfg.messages, seed);
      const mat = glowMaterial(this.world.textures, st.message);
      if (mat) inst.root.traverse((m) => { if (m.isMesh && !m.userData.overlay) m.material = mat; });
    }
    const c = inst.center ?? inst.root.position;
    let show = this.lightAt(c, { occlude: true }) < this.cfg.darkReveal;
    if (show && this.flashOn(c)) show = false;
    inst.root.visible = show;
  }

  /** Is the flashlight beam on this point (cone + range + no wall in between)? */
  flashOn(p) {
    const on = shared.uFlashOn.value;
    if (on <= 0.02) return false;
    const fp = shared.uFlashPos.value;
    _v.set(p.x - fp.x, p.y - fp.y, p.z - fp.z);
    const d = _v.length();
    if (d > shared.uFlashRange.value * 0.85 || d < 0.01) return false;
    if (_v.divideScalar(d).dot(shared.uFlashDir.value) < shared.uFlashCos.value - 0.04) return false;
    return !this.world.wallBetween(fp, p);
  }

  // ---------------------------------------------------------------- light list

  pushLight(pos, color, range, k = 1) {
    const e = this._pool[this._frame.length] ?? (this._pool[this._frame.length] = { pos: new THREE.Vector3(), color: new THREE.Color(), range: 1, k: 1, d: 0 });
    e.pos.copy(pos); e.color.copy(color); e.range = range; e.k = k;
    this._frame.push(e);
    return e;
  }

  /** Every light source this frame (fixtures, object lights, timed lights, candles) → this._frame. */
  collect(time) {
    const t = this.clock;
    // candles were pushed during update(); keep them, append the rest
    const frame = this._frame;
    for (const placed of this.world.rooms.values()) {
      for (const L of placed.built.lights) {
        const out = L.out ?? 1;
        if (out <= 0.01) continue;
        this.pushLight(L.pos, L.color ?? this.fixtureColor, L.range ?? 11, out);
      }
    }
    for (const L of this.world.objects.lights) {
      const s = Math.sin(time * 7.3 + L.seed) * Math.sin(time * 1.7 + L.seed * 0.3);
      this.pushLight(L.pos, L.color, L.range, s > 1 - (L.flicker ?? 0) ? 0.25 : 1);
    }
    for (const L of this.timed.lights) {
      if (!L.pos) continue;
      const fl = L.flicker ? 1 - L.flicker * 0.5 * (1 + Math.sin(t * 17 + L.range) * Math.sin(t * 6.1)) : 1;
      const fade = Math.min(1, (L.until - t) / 1.5); // gutters out over the last 1.5 s
      this.pushLight(_v.set(L.pos.x, L.pos.y, L.pos.z), _c.setRGB(L.color[0], L.color[1], L.color[2]), L.range, fl * Math.max(0, fade));
    }
    return frame;
  }

  /** Nearest lights to the camera into the shared shader uniforms. */
  updateLights(camera, time) {
    const all = this.collect(time);
    const cp = camera.position;
    for (const e of all) e.d = e.pos.distanceToSquared(cp);
    const near = all.filter((e) => e.d < 900 || e.range > 20);
    near.sort((a, b) => a.d - b.d);
    const n = Math.min(MAX_LIGHTS, near.length);
    for (let i = 0; i < n; i++) {
      const e = near[i];
      shared.uLightPos.value[i].copy(e.pos);
      shared.uLightColor.value[i].copy(e.color).multiplyScalar(e.k);
      shared.uLightRange.value[i] = e.range;
    }
    shared.uLightCount.value = n;
    this._lastFrame = near; // lightAt reuses this list until the next frame's update clears it
    this._frame = [];
  }

  /**
   * How lit a point is, 0..1 (world lights only, not the flashlight): the shader's falloff summed
   * over every fixture, lamp, candle and timed light in range, skipping ones behind a wall.
   * ~0.7 right under a working tube, ~0.25 five metres off, < 0.1 in a dead patch.
   */
  lightAt(pos, { occlude = true } = {}) {
    let sum = 0;
    const add = (lp, color, range, k) => {
      if (k <= 0.01) return;
      const dx = lp.x - pos.x, dy = (lp.y ?? 0) - (pos.y ?? 0), dz = lp.z - pos.z;
      if (Math.abs(dx) > range || Math.abs(dz) > range) return;
      const d = Math.hypot(dx, dy, dz);
      const a = attenuation(d, range);
      if (a <= 0) return;
      const c = lum(color.r ?? color[0], color.g ?? color[1], color.b ?? color[2]) * a * k;
      if (c < 0.01) return;
      if (occlude && c > 0.02 && this.world.wallBetween(lp, pos)) return;
      sum += c;
    };
    for (const placed of this.world.rooms.values()) {
      const g = placed.built.grid;
      if (g && (pos.x < g.ox - 12 || pos.z < g.oz - 12 || pos.x > g.ox + g.w * CELL + 12 || pos.z > g.oz + g.h * CELL + 12)) continue;
      for (const L of placed.built.lights) add(L.pos, L.color ?? this.fixtureColor, L.range ?? 11, L.out ?? 0);
    }
    for (const L of this.world.objects.lights) add(L.pos, L.color, L.range, 1);
    for (const L of this.timed.lights) if (L.pos) add(L.pos, L.color, L.range, Math.min(1, (L.until - this.clock) / 1.5));
    for (const inst of this.world.objects.instances) {
      if (inst.def.tags?.includes('candle') && this.objState(inst).lit) add({ x: inst.root.position.x, y: inst.root.position.y + 0.25, z: inst.root.position.z }, [1, 0.62, 0.28], 3.4, 1);
    }
    return Math.min(1, sum);
  }

  /** The calm (or other kind) aura covering pos, or null. */
  auraAt(pos, kind = null) { return this.timed.auraAt(pos, kind); }

  debugLines(pos) {
    const placed = pos ? this.world.roomAt(pos.x, pos.z) : null;
    const ls = placed?.built.lights ?? [];
    const c = (k) => ls.filter((l) => l.cond === k).length;
    return [
      `power      ${placed ? `${c('on')} on · ${c('flicker')} flicker · ${c('dead')} dead · switch ${this.switchOn(pos) === false ? 'off' : 'on'}` : '-'} · lightAt ${pos ? this.lightAt({ x: pos.x, y: 1.5, z: pos.z }).toFixed(2) : '-'}`,
      `timed      ${this.timed.lights.length} lights · ${this.timed.auras.length} auras · clock ${this.clock.toFixed(0)} s`,
    ];
  }
}
