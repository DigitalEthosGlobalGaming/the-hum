// Secrets runtime: discoverable interactions written as data (content/secrets/*.json).
//
// game.secrets (bound on the first gameplay frame by ./register.js):
//   list()        → [{ id, title, hint, found, foundAt? }]   stable order (order, then id)
//   count()       → { found, total }
//   markFound(id) → true the first time it's found this run; emits `secret:found { id, title, first }`
//                   (first: never found in an earlier run either)
// Found state: this run in world.run.scriptState.secrets.found ({ id: epochMs }, plain JSON for
// saves), and across runs in localStorage `the-hum.secrets.v1` (./store.js). A secret found in an
// earlier run stays found in list(), but still fires once in every new run (its reward replays).
//
// Each secret listens to its trigger event (./matcher.js decides) and, on a match, runs its script
// through the item-script system: self = the event's subject (payload.a / inst), params = the
// secret's params + { event, secretId }. The secret is marked found when the script returns ok.
import { Trigger, payloadPos } from './matcher.js';
import { loadFound, saveFound, defaultStorage } from './store.js';
import { runScript } from '../scripts/api.js';

const TICK = 0.25;           // s between `tick` evaluations
const RECENT_KEEP = 300;     // s of history kept for $recent

export class Secrets {
  /**
   * @param gp       Gameplay runtime (game = gp.game)
   * @param o.defs   content.secrets ({ id: def })
   * @param o.storage  localStorage-like, or null (default: the browser's, if it works)
   */
  constructor(gp, { defs = gp.game.content?.secrets ?? {}, storage = defaultStorage() } = {}) {
    this.gp = gp;
    this.game = gp.game;
    this.storage = storage;
    this.defs = Object.entries(defs)
      .map(([id, d]) => ({ ...d, id: d.id ?? id }))
      .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.byId = new Map(this.defs.map((d) => [d.id, d]));
    this.known = loadFound(storage);            // across runs
    this.triggers = new Map(this.defs.map((d) => [d.id, new Trigger(d.trigger)]));
    this.recentLog = new Map();                 // event → [{ t, payload }]
    this.offs = [];
    this.tickLeft = TICK;
    this.firing = new Set();
    const events = new Set(), recents = new Set();
    for (const d of this.defs) {
      if (d.trigger?.event && d.trigger.event !== 'tick') events.add(d.trigger.event);
      collectRecent(d.trigger?.where, recents);
    }
    for (const ev of recents) this.offs.push(this.game.events.on(ev, (p) => this.remember(ev, p)));
    for (const ev of events) this.offs.push(this.game.events.on(ev, (p) => this.offer(ev, p)));
  }

  // ---- public API ----
  list() {
    const run = this.runFound;
    return this.defs.map((d) => {
      const at = this.known[d.id]?.at ?? run[d.id];
      const found = d.id in run || d.id in this.known;
      const e = { id: d.id, title: d.title, hint: d.hint ?? null, found };
      if (found && at != null) e.foundAt = at;
      return e;
    });
  }

  count() {
    const l = this.list();
    return { found: l.filter((s) => s.found).length, total: l.length };
  }

  markFound(id) {
    const d = this.byId.get(id);
    if (!d) return false;
    const run = this.runFound;
    if (id in run) return false;
    const now = Date.now();
    run[id] = now;
    const first = !(id in this.known);
    if (first) {
      this.known[id] = { at: now };
      saveFound(this.storage, this.known);
    }
    this.game.events.emit('secret:found', { id, title: d.title, first });
    return true;
  }

  /** Found in this run? */
  foundThisRun(id) { return id in this.runFound; }

  dispose() { for (const off of this.offs) off?.(); this.offs = []; }

  // ---- internals ----
  get runFound() {
    const st = this.gp.runState;
    st.secrets ??= { found: {} };
    st.secrets.found ??= {};
    return st.secrets.found;
  }

  env() {
    const g = this.game;
    const p = g.player?.pos;
    return {
      now: g.time ?? 0,
      lightAt: (pos) => g.world?.lightAt?.(pos) ?? 1,
      torchOn: !!g.flashlight?.on,
      playerPos: p ? { x: p.x, y: p.y, z: p.z } : null,
      roomAt: (x, z) => g.world?.roomAt?.(x, z) ?? null,
      stage: g.stage ?? spineCount(g),
      held: this.gp.inventory?.held?.id ?? null,
      recent: (ev, within) => {
        const now = g.time ?? 0;
        return (this.recentLog.get(ev) ?? []).filter((e) => now - e.t <= within && e.t <= now).map((e) => e.payload);
      },
    };
  }

  remember(ev, payload) {
    const now = this.game.time ?? 0;
    const list = this.recentLog.get(ev) ?? [];
    list.push({ t: now, payload: snapshot(payload, this.game) });
    while (list.length > 64 || (list.length && now - list[0].t > RECENT_KEEP)) list.shift();
    this.recentLog.set(ev, list);
  }

  offer(ev, payload) {
    if (this.game.paused) return;
    let env = null;
    for (const d of this.defs) {
      if (d.trigger?.event !== ev || !this.armed(d)) continue;
      env ??= this.env();
      if (this.triggers.get(d.id).offer(payload ?? {}, env)) this.fire(d, payload ?? {});
    }
  }

  /** Called every frame (world system). Polls `tick` triggers. */
  update(dt) {
    const g = this.game;
    if (!g.playing || g.paused || !dt) return;
    this.tickLeft -= dt;
    if (this.tickLeft > 0) return;
    this.tickLeft = TICK;
    const p = g.player?.pos;
    this.offer('tick', { pos: p ? { x: p.x, y: p.y, z: p.z } : null, t: g.time ?? 0 });
  }

  armed(d) { return !(d.once !== false && this.foundThisRun(d.id)) && !this.firing.has(d.id); }

  fire(d, payload) {
    this.firing.add(d.id);
    try {
      const self = payload.a ?? payload.inst ?? payload.stack ?? null;
      const res = runScript(this.gp, d.script, { self, params: { ...(d.params ?? {}), event: payload, secretId: d.id }, verb: 'secret' });
      if (res.ok) this.markFound(d.id);
      return res;
    } finally {
      this.firing.delete(d.id);
    }
  }
}

function collectRecent(where, out) {
  if (!where || typeof where !== 'object') return;
  const r = where.$recent;
  if (r?.event) { out.add(r.event); collectRecent(r.where, out); }
}

/** Keep what a $recent check needs (the payload, plus the room key it happened in). */
function snapshot(payload, game) {
  const p = payload && typeof payload === 'object' ? { ...payload } : { value: payload };
  if (p.roomKey == null) {
    const pos = payloadPos(p) ?? game.player?.pos;
    if (pos) p.roomKey = game.world?.roomAt?.(pos.x, pos.z)?.key ?? null;
  }
  return p;
}

function spineCount(game) {
  const notes = game.content?.notes ?? {};
  let n = 0;
  for (const id of game.gameplay?.notesCollected ?? []) if (Number.isInteger(notes[id]?.spine)) n++;
  return n;
}

/** Bind game.secrets to this gameplay instance (idempotent). */
export function bindSecrets(gp, opts) {
  const game = gp?.game;
  if (!game?.world || !game.events) return null;
  if (game.secrets?.gp === gp) return game.secrets;
  game.secrets?.dispose?.();
  const s = new Secrets(gp, opts);
  game.secrets = s;
  game.world.addSystem?.({ update: (dt) => { if (game.secrets === s) s.update(dt); } });
  return s;
}
