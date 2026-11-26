// Light-state model for ceiling fixtures and room circuits. Pure JS (no Three.js, no DOM), so the
// node tests and tools can use it.
//
// A fixture has a tube condition `cond`:
//   'on'      working tube (the normal, barely-there fluorescent stutter)
//   'flicker' failing tube: stutters, buzzes, drops out
//   'dead'    no light at all (renders the _off ceiling texture). A spare tube or a fuse fixes it.
// A fixture belongs to a circuit (one per 8×8-cell block of its room). A circuit is
//   powered  false while the room's fuse box is missing its fuse
//   on       the wall switch position
// A fixture emits when cond !== 'dead' && circuit.powered && circuit.on.
import { hash } from '../core/rng.js';

export const CONDS = ['on', 'flicker', 'dead'];

export const DEFAULTS = {
  patchScale: 40,       // metres per value-noise cell for the dark patches
  patchThreshold: 0.62, // noise above this = inside a dark patch
  patchDead: 0.75,      // chance a fixture in a dark patch is dead
  patchFlicker: 0.15,
  baseDead: 0.05,       // chance elsewhere
  baseFlicker: 0.07,
  safeDepth: 2.5,       // rooms closer than this (blocks from the origin) roll nothing: the start stays bright
  stutterSeconds: 1.0,  // revived tubes stutter on over about this long
  fixtureRange: 11,
  fixtureColor: [1.0, 0.92, 0.62],
};

const u01 = (...parts) => hash(...parts) / 4294967296;
const smooth = (t) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in 0..1 (bilinear over hashed lattice points). */
export function valueNoise(seed, x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = smooth(x - x0), fz = smooth(z - z0);
  const v = (i, j) => u01(seed, 'patch', x0 + i, z0 + j);
  const a = v(0, 0) + (v(1, 0) - v(0, 0)) * fx;
  const b = v(0, 1) + (v(1, 1) - v(0, 1)) * fx;
  return a + (b - a) * fz;
}

/** How dark the lobby is around world (x, z): 0..1, > patchThreshold is a dark patch. */
export function darkness(seed, x, z, cfg = DEFAULTS) {
  const s = cfg.patchScale ?? DEFAULTS.patchScale;
  return valueNoise(seed, x / s, z / s);
}

/**
 * Starting condition of one fixture, seeded per fixture.
 * @param o { seed, roomKey, idx, fixture: 'light'|'dead'|'flicker', x, z, depth, room?, cfg? }
 *   room.power = { dead?, flicker? } in a room JSON overrides the chances (zone/room rule).
 */
export function rollFixture({ seed, roomKey, idx, fixture = 'light', x = 0, z = 0, depth = 99, room = null, cfg = DEFAULTS }) {
  if (fixture === 'dead') return 'dead';
  if (fixture === 'flicker') return 'flicker';
  const c = { ...DEFAULTS, ...cfg };
  if (depth < c.safeDepth) return 'on';
  let dead, flicker;
  if (room?.power && (room.power.dead != null || room.power.flicker != null)) {
    dead = room.power.dead ?? 0; flicker = room.power.flicker ?? 0;
  } else if (darkness(seed, x, z, c) > c.patchThreshold) {
    dead = c.patchDead; flicker = c.patchFlicker;
  } else {
    dead = c.baseDead; flicker = c.baseFlicker;
  }
  const r = u01(seed, 'fixture', roomKey, idx);
  return r < dead ? 'dead' : r < dead + flicker ? 'flicker' : 'on';
}

/** Circuit id of a fixture cell: one circuit per 8×8-cell block of the room. */
export const circuitOf = (cx, cz) => `${Math.floor(cx / 8)},${Math.floor(cz / 8)}`;

/**
 * Light output 0..1 of a fixture this instant.
 * @param fx  { cond, seed, stutterFrom?, stutterUntil? }
 * @param circuit { powered, on }
 * @param t   power clock (seconds, pause-aware)
 */
export function fixtureOutput(fx, circuit, t) {
  if (fx.cond === 'dead' || !circuit?.powered || !circuit?.on) return 0;
  const seed = fx.seed ?? 0;
  if (fx.stutterUntil != null && t < fx.stutterUntil) {
    // stuttering on: random bursts that settle towards steady as the tube warms
    const from = fx.stutterFrom ?? fx.stutterUntil - 1;
    if (t < from) return 0; // still waiting for its turn (fuse revives ripple outwards)
    const k = Math.max(0, Math.min(1, (t - from) / Math.max(0.01, fx.stutterUntil - from)));
    const r = u01(seed, 'stutter', Math.floor(t * 16));
    return r < 0.25 + k * 0.6 ? 1 : r < 0.9 ? 0 : 0.35;
  }
  if (fx.cond === 'flicker') {
    // failing tube: long-ish dropouts plus a fast buzz
    const slow = Math.sin(t * 0.9 + seed) * Math.sin(t * 0.37 + seed * 1.7);
    if (slow > 0.55) return u01(seed, 'fl', Math.floor(t * 20)) < 0.3 ? 0.6 : 0.04;
    const r = u01(seed, 'fl', Math.floor(t * 9));
    return r < 0.12 ? 0.05 : r < 0.2 ? 0.45 : 1;
  }
  // healthy tube: mostly steady, occasional drop seeded per fixture
  const s = Math.sin(t * 7.3 + seed) * Math.sin(t * 1.7 + seed * 0.3);
  return s > 0.97 ? 0.25 : 1;
}

/** Attenuation used by the PS1 shader: (1 - d / range)² clamped. */
export function attenuation(d, range) {
  const a = Math.max(0, 1 - d / range);
  return a * a;
}

// ---------------------------------------------------------------- per-run persistence

/**
 * The power slice of world.run (plain objects so a save can JSON it):
 *   { clock, rooms: { [roomKey]: RoomRecord }, lights: TimedLight[], auras: Aura[], seq }
 * RoomRecord = { circuits?: { [cid]: { powered?, on? } }, fixtures?: { [idx]: cond }, revive?: true }
 */
export function powerRun(run) {
  run.power ??= { clock: 0, rooms: {}, lights: [], auras: [], seq: 0 };
  return run.power;
}

export function roomRecord(run, key) {
  const p = powerRun(run);
  return (p.rooms[key] ??= {});
}

/**
 * Resolve a room's fixtures and circuits from rolls + its saved record.
 * @param fixtures [{ idx, cell:[cx,cz], fixture, x, z, seed }]
 * @param o { seed, roomKey, depth, room, cfg, unpowered (room has an unpowered fuse box) }
 * @param rec RoomRecord (mutated: `revive` is consumed into fixture overrides)
 * @returns { conds: string[], circuits: { [cid]: { powered, on } } }
 */
export function resolveRoom(fixtures, o, rec = {}) {
  const c = { ...DEFAULTS, ...(o.cfg ?? {}) };
  const safe = (o.depth ?? 99) < c.safeDepth;
  const conds = fixtures.map((f) => {
    const saved = rec.fixtures?.[f.idx];
    if (saved) return saved;
    return rollFixture({ seed: o.seed, roomKey: o.roomKey, idx: f.idx, fixture: f.fixture, x: f.x, z: f.z, depth: o.depth, room: o.room, cfg: c });
  });
  if (rec.revive) {
    rec.fixtures ??= {};
    conds.forEach((cond, i) => { if (cond === 'dead') { conds[i] = 'on'; rec.fixtures[fixtures[i].idx] = 'on'; } });
    delete rec.revive;
  }
  const circuits = {};
  for (const f of fixtures) {
    const cid = circuitOf(f.cell[0], f.cell[1]);
    if (circuits[cid]) continue;
    const saved = rec.circuits?.[cid] ?? {};
    circuits[cid] = {
      powered: saved.powered ?? !(o.unpowered && !safe),
      on: saved.on ?? true,
    };
  }
  return { conds, circuits };
}

/** Flip a room's switch: if any circuit is on, all go off; otherwise all come on. Returns the new on. */
export function toggleCircuits(circuits, rec, only = null) {
  const ids = Object.keys(circuits).filter((id) => only == null || id === only);
  const anyOn = ids.some((id) => circuits[id].on);
  rec.circuits ??= {};
  for (const id of ids) {
    circuits[id].on = !anyOn;
    (rec.circuits[id] ??= {}).on = !anyOn;
  }
  return !anyOn;
}

/** Power every circuit of a room (fuse inserted). */
export function powerCircuits(circuits, rec) {
  rec.circuits ??= {};
  for (const [id, c] of Object.entries(circuits)) { c.powered = true; (rec.circuits[id] ??= {}).powered = true; }
}
