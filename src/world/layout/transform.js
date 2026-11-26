// Rotating / mirroring room templates.
//
// Map view: +x east (columns), +z south (rows), north up. `quarterTurns` = clockwise turns
// in map view (= Three.js rotation.y of -90° each). `mirror` flips east↔west and is applied
// BEFORE the rotation. Room-local origin stays the top-left corner of the (transformed) layout.
//
// For a point in metres in a room of size (Wm × Hm):
//   mirror:      (x, z) → (Wm − x, z),  rot → −rot
//   1 CW turn:   (x, z) → (Hm − z, x),  rot → rot − 90, size (Wm, Hm) → (Hm, Wm)
// Cells use the same maths on cell indices: mirror c → W−1−c; turn (c, r) → (H−1−r, c).
import { CELL_M, CELLS_PER_BLOCK } from './grid.js';

const normRot = (r) => ((r % 360) + 360) % 360;

/** Transform a cell grid (string[]) → string[]. */
export function transformLayout(rows, quarterTurns = 0, mirror = false) {
  let g = rows.map((r) => r.split(''));
  if (mirror) g = g.map((r) => r.slice().reverse());
  for (let t = 0; t < mod4(quarterTurns); t++) {
    const H = g.length, W = g[0].length;
    const n = [];
    for (let r = 0; r < W; r++) {
      const row = new Array(H);
      for (let c = 0; c < H; c++) row[c] = g[H - 1 - c][r]; // new (c, r) ← old (r, H-1-c)
      n.push(row);
    }
    g = n;
  }
  return g.map((r) => r.join(''));
}

const mod4 = (q) => ((q % 4) + 4) % 4;

/**
 * Point mapper for a room of size wUnits × hUnits (any unit: metres, blocks).
 * Returns f([x, y, z, rot?]) → [x', y, z', rot'] in the transformed room.
 */
export function makePointMap(wUnits, hUnits, quarterTurns = 0, mirror = false) {
  const q = mod4(quarterTurns);
  return ([x, y, z, rot = 0]) => {
    let W = wUnits, H = hUnits;
    if (mirror) { x = W - x; rot = -rot; }
    for (let t = 0; t < q; t++) {
      [x, z] = [H - z, x];
      [W, H] = [H, W];
      rot -= 90;
    }
    return [x, y, z, normRot(rot)];
  };
}

/** Transformed size [w, h] (any unit). */
export const transformedSize = (w, h, quarterTurns) => (mod4(quarterTurns) % 2 ? [h, w] : [w, h]);

/**
 * Transform an edges object {n:[], s:[], e:[], w:[]} of a footprint wBlocks × hBlocks.
 * Entries are moved by transforming each segment's midpoint, so ordering stays W→E / N→S.
 */
export function transformEdges(edges, wBlocks, hBlocks, quarterTurns = 0, mirror = false) {
  const map = makePointMap(wBlocks, hBlocks, quarterTurns, mirror);
  const [W, H] = transformedSize(wBlocks, hBlocks, quarterTurns);
  const out = { n: [], s: [], e: [], w: [] };
  const mids = {
    n: (i) => [i + 0.5, 0], s: (i) => [i + 0.5, hBlocks],
    w: (i) => [0, i + 0.5], e: (i) => [wBlocks, i + 0.5],
  };
  for (const side of ['n', 's', 'e', 'w']) {
    (edges[side] ?? []).forEach((v, i) => {
      const [mx, mz] = mids[side](i);
      const [x, , z] = map([mx, 0, mz, 0]);
      let ns, idx;
      if (Math.abs(z) < 1e-9) { ns = 'n'; idx = Math.floor(x); }
      else if (Math.abs(z - H) < 1e-9) { ns = 's'; idx = Math.floor(x); }
      else if (Math.abs(x) < 1e-9) { ns = 'w'; idx = Math.floor(z); }
      else { ns = 'e'; idx = Math.floor(z); }
      out[ns][idx] = v;
    });
  }
  return out;
}

const mapPos = (map, p, rot) => {
  const [x, y, z, r] = map([p[0], p[1] ?? 0, p[2], rot ?? 0]);
  return { pos: [round(x), y, round(z)], rot: round(r) };
};
const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Rotate (and optionally mirror) a room template.
 * @returns {{ room, layout, edges, w, h, slots, map }}
 *   room    a copy of the room JSON with layout, edges, objects, spots, lights and spawn transformed
 *           (ready for roomBuilder.buildRoom at the slot's origin)
 *   w, h    layout size in cells after the transform
 *   slots   footprint size in blocks after the transform
 *   map     ([x, y, z, rot]) → [x', y, z', rot'] for room-local metres
 */
export function rotateRoom(room, quarterTurns = 0, mirror = false) {
  const H0 = room.layout.length, W0 = room.layout[0].length;
  const map = makePointMap(W0 * CELL_M, H0 * CELL_M, quarterTurns, mirror);
  const layout = transformLayout(room.layout, quarterTurns, mirror);
  const wb = room.slots?.[0] ?? W0 / CELLS_PER_BLOCK, hb = room.slots?.[1] ?? H0 / CELLS_PER_BLOCK;
  const edges = room.edges ? transformEdges(room.edges, wb, hb, quarterTurns, mirror) : undefined;
  const out = { ...room, layout, quarterTurns: mod4(quarterTurns), mirror: !!mirror };
  out.slots = transformedSize(wb, hb, quarterTurns);
  if (edges) out.edges = edges;
  if (room.objects) out.objects = room.objects.map((o) => ({ ...o, ...mapPos(map, o.pos, o.rot) }));
  if (room.spots) out.spots = room.spots.map((s) => ({ ...s, ...mapPos(map, s.pos, s.rot) }));
  if (room.lights) out.lights = room.lights.map((l) => ({ ...l, pos: mapPos(map, l.pos).pos }));
  if (room.spawn) out.spawn = { ...room.spawn, ...mapPos(map, room.spawn.pos, room.spawn.rot) };
  return { room: out, layout, edges, w: layout[0].length, h: layout.length, slots: out.slots, map };
}

/** All 8 (quarterTurns, mirror) pairs; h-shaped results first. */
export const ALL_TRANSFORMS = [
  [0, false], [0, true], [2, false], [2, true],
  [1, false], [1, true], [3, false], [3, true],
];
