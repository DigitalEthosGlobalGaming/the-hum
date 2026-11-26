// Procedural filler room: used when no template matches a slot's connectors.
// Always valid: borders follow the connector profiles, every walkable cell (so every
// opening) is in one connected component.
import { CELLS_PER_BLOCK, CELL_M, CORE_LEGEND, isConnected } from './grid.js';
import { stampBorders } from './templates.js';

const B = CELLS_PER_BLOCK;

/**
 * @param edges  {n:[], s:[], e:[], w:[]} world-oriented connectors (n.length = width in blocks)
 * @param rng    a seeded Rng (core/rng.js) owned by this slot
 * @param opts   { pools?: string[] } spot pools to sprinkle
 * @returns { layout: string[], legend, spots }
 */
export function generateFillerRoom(edges, rng, opts = {}) {
  const wb = edges.n.length, hb = edges.w.length;
  const W = wb * B, H = hb * B;
  const footprint = [];
  for (let bz = 0; bz < hb; bz++) for (let bx = 0; bx < wb; bx++) footprint.push([bx, bz]);

  // 1. open box with stamped borders
  let rows = [];
  for (let r = 0; r < H; r++) {
    let s = '';
    for (let c = 0; c < W; c++) s += r === 0 || c === 0 || r === H - 1 || c === W - 1 ? '#' : '.';
    rows.push(s);
  }
  const connAt = (bx, bz, side) => {
    const arr = edges[side];
    return side === 'n' || side === 's' ? arr[bx] : arr[bz];
  };
  rows = stampBorders(rows, footprint, connAt);
  const g = rows.map((r) => r.split(''));

  // cells just inside an opening stay floor so the doorway is never plugged
  const keep = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const open = (r === 0 || r === H - 1 || c === 0 || c === W - 1) && g[r][c] !== '#';
    if (!open) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr > 0 && cc > 0 && rr < H - 1 && cc < W - 1) keep[rr * W + cc] = 1;
    }
  }

  const tryApply = (cells, ch) => {
    const old = [];
    for (const [c, r] of cells) {
      if (r <= 0 || c <= 0 || r >= H - 1 || c >= W - 1) return false;
      if (keep[r * W + c] || g[r][c] !== '.') return false;
    }
    for (const [c, r] of cells) { old.push(g[r][c]); g[r][c] = ch; }
    if (isConnected(g.map((x) => x.join('')), CORE_LEGEND)) return true;
    cells.forEach(([c, r], i) => { g[r][c] = old[i]; });
    return false;
  };

  // 2. features: pillars and partial walls (bounded attempts)
  const style = rng.pick(['pillars', 'partitions', 'mixed', 'bare']);
  const pillarCount = style === 'pillars' ? rng.int(3, 8) : style === 'mixed' ? rng.int(1, 4) : style === 'bare' ? rng.int(0, 1) : 0;
  const wallCount = style === 'partitions' ? rng.int(2, 4) : style === 'mixed' ? rng.int(1, 2) : 0;
  let placed = 0;
  for (let a = 0; a < pillarCount * 6 && placed < pillarCount; a++) {
    if (tryApply([[rng.int(2, W - 3), rng.int(2, H - 3)]], 'P')) placed++;
  }
  placed = 0;
  for (let a = 0; a < wallCount * 8 && placed < wallCount; a++) {
    const horiz = rng.chance(0.5);
    const len = rng.int(2, horiz ? Math.min(6, W - 4) : Math.min(6, H - 4));
    const c0 = rng.int(1, W - 2), r0 = rng.int(1, H - 2);
    const cells = [];
    for (let i = 0; i < len; i++) cells.push(horiz ? [c0 + i, r0] : [c0, r0 + i]);
    if (tryApply(cells, '#')) placed++;
  }
  // 3. a few ceiling lights (walkable, so connectivity is unchanged)
  const lights = rng.int(1, 3);
  for (let a = 0, n = 0; a < 20 && n < lights; a++) {
    const c = rng.int(1, W - 2), r = rng.int(1, H - 2);
    if (g[r][c] === '.') { g[r][c] = 'L'; n++; }
  }
  // 4. spots on free floor
  const spots = [];
  const pools = opts.pools ?? [];
  for (let a = 0, n = 0; pools.length && a < 20 && n < 2; a++) {
    const c = rng.int(1, W - 2), r = rng.int(1, H - 2);
    if (g[r][c] !== '.' || keep[r * W + c]) continue;
    spots.push({ id: `filler_${n}`, pos: [c * CELL_M + 1, 0, r * CELL_M + 1], rot: rng.int(0, 359), pool: pools[n % pools.length] });
    n++;
  }
  const layout = g.map((r) => r.join(''));
  return { layout, legend: { ...CORE_LEGEND }, spots };
}
