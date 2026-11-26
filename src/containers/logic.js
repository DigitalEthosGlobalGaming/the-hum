// Container rules (filing cabinets, vending machines). Pure: no DOM, no Three, Node-testable.
//
// A container has N compartments. Each compartment rolls its pool ONCE per run, the first time it is
// opened, seeded by hash(runSeed, 'container', stableKey, index), so the same drawer in the same run
// always holds the same thing no matter when you open it or how often the room streams.
// The state object is the instance's per-run state (gameplay.stateOf), so it persists per run:
//   state.opened  [bool]      which compartments are open
//   state.rolled  [[ids]]     what each one held when it was opened
//   state.rattles n           attempts on the stuck drawer
//   state.coins   n           coins a vending machine has taken
import { Rng, hash } from '../core/rng.js';
import { rollPool } from '../spawn/pools.js';

export const DRAWER_NAMES = ['top', 'middle', 'bottom', 'fourth', 'fifth', 'sixth'];

/** Normalised compartment list of a `container` component config. */
export function compartmentsOf(cfg = {}) {
  if (cfg.vend) return [];
  return (cfg.compartments ?? []).map((c, i) => ({
    pool: c.pool,
    name: c.name ?? `${DRAWER_NAMES[i] ?? '#' + (i + 1)} drawer`,
  }));
}

/**
 * Index of this container's stuck compartment, or -1. At most one per container, seeded per run.
 * cfg.stuckChance (default 0.5) is the chance a container has one at all.
 */
export function stuckIndex(cfg, seed, key) {
  const n = compartmentsOf(cfg).length;
  if (n < 2) return -1; // never jam the only drawer
  const rng = new Rng(hash(seed >>> 0, 'stuck', key ?? '?'));
  return rng.chance(cfg.stuckChance ?? 0.5) ? rng.int(0, n - 1) : -1;
}

/**
 * Try to open compartment i.
 * @param {object} state  per-run instance state (mutated)
 * @param {object} cfg    the container component
 * @param {number} i
 * @param {object} o      { seed, key, pools, ctx } ctx = pool context { depth, zone, spawnedUnique }
 * @returns {{ status: 'opened'|'already'|'stuck'|'none', items: string[] }}
 */
export function openCompartment(state, cfg, i, { seed, key, pools, ctx = {} }) {
  const comps = compartmentsOf(cfg);
  if (!comps[i]) return { status: 'none', items: [] };
  state.opened ??= [];
  state.rolled ??= [];
  if (i === stuckIndex(cfg, seed, key)) {
    state.rattles = (state.rattles ?? 0) + 1;
    return { status: 'stuck', items: [] };
  }
  if (state.opened[i]) return { status: 'already', items: [] };
  const rng = new Rng(hash(seed >>> 0, 'container', key ?? '?', i));
  const items = comps[i].pool ? rollPool(comps[i].pool, pools, rng, ctx) : [];
  state.opened[i] = true;
  state.rolled[i] = items;
  return { status: 'opened', items };
}

/**
 * Feed a vending machine one coin. Each coin is its own seeded roll (coin n of this machine).
 * cfg.vend = { pool, wrongPool?, eatChance = 0.15, wrongChance = 0.15 }
 * @returns {{ outcome: 'item'|'wrong'|'eaten', items: string[], coin: number }}
 */
export function vend(state, cfg, { seed, key, pools, ctx = {} }) {
  const v = cfg.vend ?? {};
  const coin = (state.coins = (state.coins ?? 0) + 1);
  const rng = new Rng(hash(seed >>> 0, 'vend', key ?? '?', coin));
  const r = rng.next();
  const eat = v.eatChance ?? 0.15, wrong = v.wrongChance ?? 0.15;
  if (r < eat) return { outcome: 'eaten', items: [], coin };
  const isWrong = r < eat + wrong && v.wrongPool;
  const items = rollPool(isWrong ? v.wrongPool : v.pool, pools, rng, ctx);
  if (!items.length) return { outcome: 'eaten', items: [], coin };
  return { outcome: isWrong ? 'wrong' : 'item', items: items.slice(0, 1), coin };
}

/**
 * Which compartment the view ray points at, for a container standing at `pos` turned `rotY`.
 * Front faces local -z. layout: { bottom, height, count, front } (metres, local).
 * Rows are numbered from the top (0 = top drawer). Misses clamp to the nearest row.
 */
export function aimedCompartment(pos, rotY, eye, dir, layout) {
  const { bottom = 0.06, height = 0.42, count = 3, front = -0.31 } = layout;
  // world → local (undo the Y rotation)
  const c = Math.cos(-rotY), s = Math.sin(-rotY);
  const rx = (x, z) => [x * c + z * s, -x * s + z * c];
  const [ex, ez] = rx(eye.x - pos.x, eye.z - pos.z);
  const [dx, dz] = rx(dir.x, dir.z);
  const ey = eye.y - pos.y;
  let y;
  if (Math.abs(dz) > 1e-4) {
    const t = (front - ez) / dz;
    y = t > 0 ? ey + dir.y * t : ey;
  } else y = ey;
  void ex; void dx;
  const fromBottom = Math.floor((y - bottom) / height);
  const row = count - 1 - Math.max(0, Math.min(count - 1, fromBottom));
  return row;
}
