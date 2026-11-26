// Herringbone slots over the infinite block grid (pure maths, no state).
//
// Let d = (bx - bz) mod 4 for block (bx, bz):
//   d = 0 → top-left of an h slot   (covers (bx, bz) and (bx+1, bz))
//   d = 1 → right half of the h slot anchored at (bx-1, bz)
//   d = 3 → top of a v slot         (covers (bx, bz) and (bx, bz+1))
//   d = 2 → bottom half of the v slot anchored at (bx, bz-1)
// Every block gets exactly one slot, so the slots tile the plane. Each row is the
// previous row shifted one block east, which gives the staircase herringbone look.

export const mod = (a, n) => ((a % n) + n) % n;

function mk(bx, bz, orient) {
  return { key: `${orient}:${bx},${bz}`, bx, bz, orient };
}

/** Slot that owns block (bx, bz): { key, bx, bz, orient } with (bx, bz) = top-left block. */
export function slotAtBlock(bx, bz) {
  const d = mod(bx - bz, 4);
  if (d === 0) return mk(bx, bz, 'h');
  if (d === 1) return mk(bx - 1, bz, 'h');
  if (d === 3) return mk(bx, bz, 'v');
  return mk(bx, bz - 1, 'v');
}

/** true when (bx, bz) is the top-left block of a slot. */
export function isSlotAnchor(bx, bz) {
  const d = mod(bx - bz, 4);
  return d === 0 || d === 3;
}

/** Parse a slot key ("h:3,-2") back into a slot. */
export function parseSlotKey(key) {
  const orient = key[0];
  const [bx, bz] = key.slice(2).split(',').map(Number);
  return mk(bx, bz, orient);
}

/** Size in blocks [w, h]. */
export const slotSize = (orient) => (orient === 'h' ? [2, 1] : [1, 2]);

/** The two blocks of a slot as [[bx, bz], [bx, bz]]. */
export function slotBlocks(slot) {
  return slot.orient === 'h'
    ? [[slot.bx, slot.bz], [slot.bx + 1, slot.bz]]
    : [[slot.bx, slot.bz], [slot.bx, slot.bz + 1]];
}

/** Every slot touching the inclusive block rectangle, sorted by (bz, bx). */
export function slotsInBlockRect(minBx, minBz, maxBx, maxBz) {
  const seen = new Map();
  for (let bz = minBz; bz <= maxBz; bz++) {
    for (let bx = minBx; bx <= maxBx; bx++) {
      const s = slotAtBlock(bx, bz);
      if (!seen.has(s.key)) seen.set(s.key, s);
    }
  }
  return [...seen.values()].sort((a, b) => a.bz - b.bz || a.bx - b.bx);
}

// ── Edge segments ─────────────────────────────────────────────────────────────
// A segment is one block-width unit edge of the block grid:
//   "H:bx,bz" = the horizontal edge on line z = bz from x = bx to bx+1 (north side of block (bx, bz))
//   "V:bx,bz" = the vertical edge on line x = bx from z = bz to bz+1   (west side of block (bx, bz))
// Both neighbours compute the same key, so it is world-unique and shared.

export const segH = (bx, bz) => `H:${bx},${bz}`;
export const segV = (bx, bz) => `V:${bx},${bz}`;

/** Segment key for side n/s/e/w of block (bx, bz). */
export function blockSideSegment(bx, bz, side) {
  switch (side) {
    case 'n': return segH(bx, bz);
    case 's': return segH(bx, bz + 1);
    case 'w': return segV(bx, bz);
    case 'e': return segV(bx + 1, bz);
  }
  throw new Error(`bad side ${side}`);
}

/** The two blocks a segment separates: [north-or-west, south-or-east]. */
export function segmentBlocks(key) {
  const [bx, bz] = key.slice(2).split(',').map(Number);
  return key[0] === 'H' ? [[bx, bz - 1], [bx, bz]] : [[bx - 1, bz], [bx, bz]];
}

/** The two slots sharing a segment (could be the same slot for its internal edge). */
export function segmentSlots(key) {
  const [a, b] = segmentBlocks(key);
  return [slotAtBlock(a[0], a[1]), slotAtBlock(b[0], b[1])];
}

const SIDE_DELTA = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

/**
 * Perimeter of a set of blocks (a slot or a multi-slot footprint).
 * @param blocks  [[bx, bz], ...]
 * @returns [{ key, side, bx, bz }] where (bx, bz) is the block inside the footprint.
 *   Sorted: n, s by x then z; e, w by z then x (so per-side order is W→E / N→S).
 */
export function footprintPerimeter(blocks) {
  const set = new Set(blocks.map(([x, z]) => `${x},${z}`));
  const out = [];
  for (const [bx, bz] of blocks) {
    for (const side of ['n', 's', 'e', 'w']) {
      const [dx, dz] = SIDE_DELTA[side];
      if (set.has(`${bx + dx},${bz + dz}`)) continue;
      out.push({ key: blockSideSegment(bx, bz, side), side, bx, bz });
    }
  }
  const order = { n: 0, s: 1, e: 2, w: 3 };
  out.sort((a, b) => order[a.side] - order[b.side]
    || (a.side === 'n' || a.side === 's' ? a.bx - b.bx || a.bz - b.bz : a.bz - b.bz || a.bx - b.bx));
  return out;
}

/** Segment keys of a slot grouped by side: h → n:2, s:2, e:1, w:1; v → n:1, s:1, e:2, w:2. */
export function slotSegments(slot) {
  const out = { n: [], s: [], e: [], w: [] };
  for (const p of footprintPerimeter(slotBlocks(slot))) out[p.side].push(p.key);
  return out;
}
