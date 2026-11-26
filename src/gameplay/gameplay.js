// M4 runtime: owns the inventory, per-run object state, script timers and note reading.
// The verbs (interact / use / drop / combine) live in src/interaction/interaction.js and the script
// ctx in src/scripts/api.js; both work through this object (game.gameplay).
// No Three.js import: positions are plain {x,y,z}, so this stays light and testable.
import { Inventory } from '../inventory/inventory.js';
import { hash } from '../core/rng.js';
import { resolveNote } from './notes.js';
import { dropPoint, castSurface } from './placement.js';

export class Gameplay {
  constructor(game) {
    this.game = game;
    this.inventory = new Inventory({
      size: game.cfg.inventory?.slots ?? 4,
      defs: game.content.objects ?? {},
      events: game.events,
    });
    this.notesCollected = new Set();  // note ids read (M8 saves this across runs)
    this.timers = [];
    this.inputBlocked = false;        // M5 sets true while the pockets view / notebook owns the input
    this._calls = new Map();
  }

  // ---- per-run state (lives on world.run so M3/M8 can stream and save it) ----
  get run() {
    const run = this.game.world.run;
    run.placed ??= new Map();     // placedKey → { id, pos:[x,y,z], rotY, state, roomKey }: drops, chalk marks
    run.objState ??= new Map();   // stableKey → state object of world instances scripts have touched
    run.scriptState ??= {};       // free-form per-run scratch for scripts (ctx.state.run)
    run.placedSeq ??= 0;
    return run;
  }
  get runState() { return this.run.scriptState; }

  nextCall(uid) {
    const n = (this._calls.get(uid) ?? 0) + 1;
    this._calls.set(uid, n);
    return n;
  }

  /**
   * A key for a world instance that survives room streaming:
   * placed:<n> for dropped/spawned things, <spotKey>:<id> for pool spawns, <roomKey>#<i> for fixed room objects.
   */
  stableKey(inst) {
    if (!inst?.root) return null;
    const m = inst.meta ?? {};
    if (m.placedKey) return m.placedKey;
    if (m.spotKey) return `${m.spotKey}:${inst.id}`;
    if (m.roomKey != null && m.fixed != null) return `${m.roomKey}#${m.fixed}`;
    return null;
  }

  /** Mutable state for a world inst (rehydrated from world.run.objState) or an ItemStack. */
  stateOf(target) {
    if (!target) return null;
    if (!target.root) return (target.state ??= {});
    const key = this.stableKey(target);
    if (!key) return (target.state ??= {});
    const saved = this.run.objState.get(key);
    if (saved !== target.state) {
      target.state = Object.assign(target.state ?? {}, saved ?? {});
      this.run.objState.set(key, target.state);
    }
    return target.state;
  }

  // ---- world helpers ----
  instances() { return this.game.world.objects.instances; }

  nearby(pos, radius) {
    const out = [];
    for (const inst of this.instances()) {
      const p = inst.root.position;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d <= radius) out.push({ inst, d });
    }
    return out.sort((a, b) => a.d - b.d).map((e) => e.inst);
  }

  /** Unit view direction from the player's yaw/pitch (camera uses Euler order YXZ). */
  viewDir() {
    const { yaw, pitch } = this.game.player;
    const c = Math.cos(pitch);
    return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
  }

  solid = (x, z) => this.game.world.isSolidAt(x, z);

  castFromEye(maxDist = 2) {
    const e = this.game.camera.position;
    return castSurface({ x: e.x, y: e.y, z: e.z }, this.viewDir(), this.solid, { maxDist, floorY: this.game.player.pos.y });
  }

  dropPoint() {
    const p = this.game.player.pos;
    return dropPoint({ x: p.x, y: p.y, z: p.z }, this.game.player.yaw, this.solid);
  }

  /**
   * Spawn an object. opts: { persist, state, meta }.
   * persist: recorded in world.run.placed so the world can respawn it when its room streams back in.
   */
  spawn(id, pos, rotY = 0, opts = {}) {
    const world = this.game.world;
    const roomKey = world.roomAt(pos.x, pos.z)?.key ?? null;
    const meta = { roomKey, ...(opts.meta ?? {}) };
    let key = null;
    if (opts.persist) { key = `placed:${this.run.placedSeq++}`; meta.placedKey = key; }
    const inst = world.objects.spawn(id, { x: pos.x, y: pos.y, z: pos.z }, rotY, meta);
    if (!inst) return null;
    if (opts.state) inst.state = opts.state;
    if (key) {
      this.run.placed.set(key, { id, pos: [pos.x, pos.y, pos.z], rotY, state: inst.state, roomKey });
      this.run.objState.set(key, inst.state);
    }
    return inst;
  }

  /** Remove a world inst for good: it won't respawn (spot taken / placed entry dropped). */
  removeInst(inst) {
    if (!inst) return;
    const m = inst.meta ?? {};
    if (m.spotKey) this.run.taken.add(m.spotKey);
    if (m.placedKey) { this.run.placed.delete(m.placedKey); this.run.objState.delete(m.placedKey); }
    else if (m.roomKey != null && m.fixed != null) this.run.taken.add(`${m.roomKey}#${m.fixed}`);
    this.game.world.objects.remove(inst);
    if (this.game.focus?.inst === inst) this.game.focus = null;
  }

  // ---- sound / ui ----
  playSound(preset, opts = {}, self = null) {
    const synth = this.game.synth;
    if (!synth?.play) return null;
    const at = opts.at ?? (self?.root ? self : null);
    let position;
    if (at?.root) { const c = at.center ?? at.root.position; position = { x: c.x, y: c.y, z: c.z }; }
    else if (at && at !== 'player' && typeof at.x === 'number') position = { x: at.x, y: at.y, z: at.z };
    // no position → head-locked (in your hands)
    return synth.play(preset, { position, volume: opts.volume, loop: opts.loop });
  }

  stopObjectSound(inst) {
    if (!inst?.sound) return;
    inst.sound.fired = true;
    inst.sound.handle?.stop?.(0.15);
  }

  caption(text, seconds) {
    if (!text) return;
    const s = seconds ?? Math.max(2, Math.min(6, 1.5 + text.length * 0.05));
    this.game.events.emit('ui:caption', { text, seconds: s });
  }

  // ---- timers (play time; paused whenever updateGameplay isn't running) ----
  after(sec, fn) {
    const t = { left: Math.max(0, sec), fn, dead: false };
    this.timers.push(t);
    return () => { t.dead = true; };
  }

  update(dt) {
    if (!this.timers.length) return;
    const due = [];
    for (const t of this.timers) { t.left -= dt; if (t.left <= 0 && !t.dead) { t.dead = true; due.push(t); } }
    this.timers = this.timers.filter((t) => !t.dead);
    for (const t of due) {
      try { t.fn(); } catch (e) { console.error('[scripts] timer callback failed', e); }
    }
  }

  // ---- notes ----
  /** The note a readable inst or a carried note stack resolved to (after it was first read). */
  noteOf(target) {
    const id = this.stateOf(target)?.noteId;
    return id ? this.game.content.notes?.[id] ?? null : null;
  }

  /**
   * Text for a readable inst: { title, text, display, noteId? } or null.
   * textId notes ("random", "spine" or a note id) resolve on first read and stick to the instance.
   */
  resolveReadable(inst) {
    const r = inst.readable;
    if (!r) return null;
    if (!r.textId) {
      if (!r.text) return null;
      return { title: inst.name, text: r.text, display: r.display, noteId: r.display === 'notebook' ? `text:${inst.id}` : undefined };
    }
    const st = this.stateOf(inst);
    let note = st.noteId ? this.game.content.notes?.[st.noteId] : null;
    if (!note) {
      const seed = hash(this.game.seed >>> 0, 'note', this.stableKey(inst) ?? inst.uid);
      note = resolveNote(r.textId, this.game.content.notes ?? {}, this.notesCollected, seed);
      if (!note) return null;
      st.noteId = note.id;
    }
    inst.readable.text = note.text; // lets debug overlays show it
    return { title: note.title ?? inst.name, text: note.text, display: r.display, noteId: note.id };
  }
}
