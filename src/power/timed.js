// Timed effects: lights and auras with a duration, on a pause-aware clock.
// Pure JS (positions are plain {x,y,z}); the store is the power slice of world.run, so effects
// placed in rooms survive room streaming and a save can JSON them.
//
//   light: { id, pos:{x,y,z} | null, follow?: 'player', color:[r,g,b], range, flicker?, until, roomKey? }
//   aura:  { id, pos:{x,y,z}, radius, kind: 'calm', until, follow?: string (a source id), roomKey? }
// `until` is in power-clock seconds. The clock only advances while the game runs (not paused,
// not on the title), so a 5 min glow stick is 5 min of play.
export class TimedEffects {
  /** @param store { clock, lights: [], auras: [], seq } (see powerRun in lightModel.js) */
  constructor(store) {
    this.store = store;
    store.clock ??= 0;
    store.lights ??= [];
    store.auras ??= [];
    store.seq ??= 0;
  }

  get clock() { return this.store.clock; }
  get lights() { return this.store.lights; }
  get auras() { return this.store.auras; }

  /** Advance the clock and drop expired effects. Returns the expired entries. */
  tick(dt, running = true) {
    if (running && dt > 0) this.store.clock += dt;
    const t = this.store.clock;
    const gone = [];
    for (const list of [this.store.lights, this.store.auras]) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].until <= t) gone.push(...list.splice(i, 1));
      }
    }
    return gone;
  }

  /** Add a timed light. o: { pos?, follow?, color, range, flicker?, duration, roomKey? } */
  addLight(o) {
    const L = {
      id: `tl:${this.store.seq++}`,
      pos: o.pos ? { x: o.pos.x, y: o.pos.y, z: o.pos.z } : null,
      follow: o.follow ?? null,
      color: [...(o.color ?? [1, 1, 1])],
      range: o.range ?? 4,
      flicker: o.flicker ?? 0,
      until: this.store.clock + (o.duration ?? 10),
      start: this.store.clock,
      roomKey: o.roomKey ?? null,
    };
    this.store.lights.push(L);
    return L;
  }

  /** Add an aura. o: { pos, radius, kind = 'calm', duration, follow?, roomKey? } */
  addAura(o) {
    const A = {
      id: o.id ?? `au:${this.store.seq++}`,
      pos: { x: o.pos?.x ?? 0, y: o.pos?.y ?? 0, z: o.pos?.z ?? 0 },
      radius: o.radius ?? 5,
      kind: o.kind ?? 'calm',
      until: this.store.clock + (o.duration ?? 30),
      follow: o.follow ?? null,
      roomKey: o.roomKey ?? null,
    };
    // re-winding the same source replaces its aura
    const i = this.store.auras.findIndex((a) => a.id === A.id);
    if (i >= 0) this.store.auras.splice(i, 1);
    this.store.auras.push(A);
    return A;
  }

  /** Seconds left on an effect (0 when gone). */
  left(e) { return Math.max(0, (e?.until ?? 0) - this.store.clock); }

  /** The first aura of `kind` covering pos (x/z distance), or null. */
  auraAt(pos, kind = null) {
    for (const a of this.store.auras) {
      if (kind && a.kind !== kind) continue;
      if (a.until <= this.store.clock) continue;
      if (Math.hypot(pos.x - a.pos.x, pos.z - a.pos.z) <= a.radius) return a;
    }
    return null;
  }
}
