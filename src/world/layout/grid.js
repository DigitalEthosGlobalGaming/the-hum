// Cell-grid helpers shared by templates, filler, stitching and the sweep.
// Pure JS, no DOM / Three.js.

export const CELLS_PER_BLOCK = 8; // a block is 8×8 cells
export const CELL_M = 2;          // a cell is 2 m
export const BLOCK_M = CELLS_PER_BLOCK * CELL_M; // 16 m

// Mirrors the tile kinds in roomBuilder.js (solid = blocks movement).
export const SOLID_KINDS = { wall: true, pillar: true, void: true, floor: false, door: false, light: false };

// Characters the layout core writes itself (stamped borders, filler, void outside big-room footprints).
export const CORE_LEGEND = { '#': 'wall', '.': 'floor', P: 'pillar', L: 'light', D: 'door', ' ': 'void' };

/** true when the layout character is solid under `legend` (unknown chars count as solid). */
export function isSolidChar(ch, legend) {
  const k = legend[ch] ?? CORE_LEGEND[ch];
  if (k === undefined) return true;
  return SOLID_KINDS[k] ?? true;
}

/** rows (string[] or char[][]) → Uint8Array walkable mask (1 = walkable). */
export function walkMask(rows, legend) {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) m[r * w + c] = isSolidChar(row[c], legend) ? 0 : 1;
  }
  return m;
}

/** 4-way flood fill over a walkable mask. Returns { seen, count }. */
export function floodFill(w, h, walk, start) {
  const seen = new Uint8Array(w * h);
  if (start < 0 || !walk[start]) return { seen, count: 0 };
  const stack = [start];
  seen[start] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop();
    count++;
    const x = i % w, z = (i - x) / w;
    if (x > 0 && walk[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && walk[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
    if (z > 0 && walk[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
    if (z < h - 1 && walk[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
  }
  return { seen, count };
}

/** true when the layout has walkable cells and they all form one 4-connected component. */
export function isConnected(rows, legend) {
  const h = rows.length, w = rows[0].length;
  const m = walkMask(rows, legend);
  let total = 0, first = -1;
  for (let i = 0; i < m.length; i++) if (m[i]) { total++; if (first < 0) first = i; }
  if (!total) return false;
  return floodFill(w, h, m, first).count === total;
}

export const toCharRows = (rows) => rows.map((r) => r.split(''));
export const toStringRows = (rows) => rows.map((r) => (typeof r === 'string' ? r : r.join('')));
