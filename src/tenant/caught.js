// What being caught costs (PLAN §13): wake up elsewhere with less sanity, one random pocket item
// left where it got you, and a smudged notebook map. If sanity was already near zero the tape
// ejects instead (run over). Pure logic over small interfaces so node tests can use fakes:
//   inventory { slots, remove(i) }, stats { sanity }, map { toJSON(), fromJSON(arr) },
//   dropAt(stack, pos) (spawns + persists the item), rng { next() }
// The VHS tear, the fade and the teleport itself live in system.js.

export const CAUGHT_DEFAULTS = {
  sanity: 0.35,          // sanity lost
  endBelow: 0.1,         // sanity already below this → the run ends
  smudge: 0.4,           // fraction of seen map cells forgotten
  wakeBlocks: [6, 15],   // wake-up distance in blocks (16 m)
};

/** Index of a random occupied pocket (a two-slot item counts once), or -1. */
export function pickDropSlot(inventory, rng) {
  const seen = new Set();
  const idx = [];
  inventory.slots.forEach((s, i) => { if (s && !seen.has(s)) { seen.add(s); idx.push(i); } });
  if (!idx.length) return -1;
  return idx[Math.min(idx.length - 1, Math.floor(rng.next() * idx.length))];
}

/** Forget a random `fraction` of the map's seen cells (through its save API). Returns how many. */
export function smudgeMap(map, fraction, rng) {
  if (!map?.toJSON || !map?.fromJSON) return 0;
  const cells = map.toJSON();
  const keep = cells.filter(() => rng.next() >= fraction);
  map.fromJSON(keep);
  return cells.length - keep.length;
}

/**
 * Apply the cost of being caught at `pos`.
 * @returns {{ ended: boolean, sanityBefore, sanityAfter, dropped: string|null, forgotten: number }}
 */
export function applyCaught({ inventory, stats, map, dropAt, rng, pos }, cfg = CAUGHT_DEFAULTS) {
  const c = { ...CAUGHT_DEFAULTS, ...cfg };
  const before = stats.sanity;
  if (before < c.endBelow) return { ended: true, sanityBefore: before, sanityAfter: before, dropped: null, forgotten: 0 };
  stats.sanity = Math.max(0, before - c.sanity);
  let dropped = null;
  const i = inventory ? pickDropSlot(inventory, rng) : -1;
  if (i >= 0) {
    const stack = inventory.remove(i);
    if (stack) { dropped = stack.id; dropAt?.(stack, pos); }
  }
  const forgotten = smudgeMap(map, c.smudge, rng);
  return { ended: false, sanityBefore: before, sanityAfter: stats.sanity, dropped, forgotten };
}

/**
 * A wake-up block `wakeBlocks` away from (bx, bz) in a random direction.
 * Returns { bx, bz }.
 */
export function wakeBlock(bx, bz, rng, [lo, hi] = CAUGHT_DEFAULTS.wakeBlocks) {
  const a = rng.next() * Math.PI * 2;
  const r = lo + (hi - lo) * rng.next();
  return { bx: Math.round(bx + Math.cos(a) * r), bz: Math.round(bz + Math.sin(a) * r) };
}
