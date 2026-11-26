// World layout: herringbone slots → hashed connectors → WFC over fixed patches → rooms.
// Pure JS (no DOM, no Three.js). Deterministic and order-independent: a slot's result depends
// only on (worldSeed, rooms, zones, zoneAt) and the fixed patch that owns it, never on which
// region was requested first.
import { hash, Rng } from '../../core/rng.js';
import { CELLS_PER_BLOCK, isConnected, isSolidChar, floodFill } from './grid.js';
import {
  slotAtBlock, slotBlocks, slotsInBlockRect, blockSideSegment, footprintPerimeter,
} from './herringbone.js';
import { ConnectorField, DEFAULT_ZONES, zoneConfig } from './connectors.js';
import { prepareTemplates, stampBorders, legendFor } from './templates.js';
import { generateFillerRoom } from './filler.js';
import { solveWfc } from './wfc.js';

const B = CELLS_PER_BLOCK;
const U32 = 4294967296;
const SIDES = ['n', 's', 'e', 'w'];


/**
 * Create a world layout. Keep one per run and reuse it so patches are cached.
 * @param o.worldSeed  number|string
 * @param o.rooms      { id: roomJson } (content.rooms) or roomJson[]
 * @param o.zoneAt     (bx, bz) → zone id (default 'lobby')
 * @param o.zones      zone configs (default DEFAULT_ZONES); see connectors.js
 * @param o.patchSize  WFC patch size in blocks (default 8)
 * @param o.maxPatches LRU size of the patch cache (default 256)
 */
export function createWorldLayout(o) {
  const worldSeed = o.worldSeed;
  const zones = o.zones ?? DEFAULT_ZONES;
  const zoneAt = o.zoneAt ?? (() => 'lobby');
  const P = o.patchSize ?? 8;
  const maxPatches = o.maxPatches ?? 256;
  const templates = o.templates ?? prepareTemplates(o.rooms);
  const field = new ConnectorField({ worldSeed, zoneAt, zones });
  const patches = new Map();
  const stats = { slots: 0, single: 0, big: 0, filler: 0, contradictions: 0, backtracks: 0, relaxedPatches: 0, failedPatches: 0, patches: 0, ms: 0 };

  const patchOfBlock = (bx, bz) => [Math.floor(bx / P), Math.floor(bz / P)];
  const inPatch = (slot, px, pz) => {
    const [x, z] = patchOfBlock(slot.bx, slot.bz);
    return x === px && z === pz;
  };

  // ── per-slot single-template candidates ────────────────────────────────────
  function singleOptions(slot, edges, zone) {
    const out = [];
    for (const tpl of templates.singles) {
      const w = tpl.zones[zone] ?? 0;
      if (w <= 0) continue;
      const matches = [];
      outer: for (const v of tpl.variants) {
        if (v.orient !== slot.orient) continue;
        for (const s of SIDES) {
          const e = edges[s], a = v.allowed[s];
          for (let i = 0; i < e.length; i++) if (!a[i].has(e[i])) continue outer;
        }
        matches.push(v);
      }
      for (const v of matches) out.push({ kind: 'single', tpl, variant: v, weight: w / matches.length });
    }
    return out;
  }

  // ── multi-slot placements anchored at a slot (hash predicate) ──────────────
  function bigPlacements(anchor, zone, px, pz) {
    const zc = zoneConfig(zones, zone);
    if (!templates.bigs.length || !(zc.bigRoomChance > 0)) return [];
    if (hash(worldSeed, 'bigAnchor', anchor.key) / U32 >= zc.bigRoomChance) return [];
    const out = [];
    const seen = new Set();
    for (const tpl of templates.bigs) {
      const w = tpl.zones[zone] ?? 0;
      if (w <= 0) continue;
      const found = [];
      tpl.variants.forEach((v, vi) => {
        for (const f of v.footprint) {
          const ox = anchor.bx - f[0], oz = anchor.bz - f[1];
          const id = `${tpl.id}|${vi}|${ox},${oz}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const blocks = v.footprint.map(([x, z]) => [x + ox, z + oz]);
          const bset = new Set(blocks.map(([x, z]) => `${x},${z}`));
          const claimed = new Map();
          let ok = true;
          for (const [x, z] of blocks) {
            const s = slotAtBlock(x, z);
            if (claimed.has(s.key)) continue;
            if (!slotBlocks(s).every(([a, b]) => bset.has(`${a},${b}`))) { ok = false; break; }
            if (!inPatch(s, px, pz) || zoneAt(s.bx, s.bz) !== zone) { ok = false; break; }
            claimed.set(s.key, s);
          }
          if (!ok) continue;
          const slots = [...claimed.values()].sort((a, b) => a.bz - b.bz || a.bx - b.bx);
          if (slots[0].key !== anchor.key) continue; // each placement is owned by its first slot
          const per = footprintPerimeter(blocks);
          if (per.filter((p) => field.get(p.key) !== 'wall').length < 2) continue;
          const layout = stampBorders(v.layout, v.footprint, (lbx, lbz, side) => field.get(blockSideSegment(lbx + ox, lbz + oz, side)));
          if (!isConnected(layout, legendFor(v.room))) continue;
          found.push({ tpl, variant: v, ox, oz, slots: slots.map((s) => s.key), layout, key: `big:${anchor.key}:${tpl.id}:${vi}:${ox},${oz}` });
        }
      });
      for (const p of found) p.weight = (w * (zc.bigRoomWeight ?? 1)) / found.length;
      out.push(...found);
    }
    return out;
  }

  const clash = (ta, tb) => {
    if (!ta || !tb) return false;
    const na = ta.rules?.notNextTo ?? [], nb = tb.rules?.notNextTo ?? [];
    return na.some((t) => tb.tags.includes(t)) || nb.some((t) => ta.tags.includes(t));
  };

  // ── solve one patch ────────────────────────────────────────────────────────
  function solvePatch(px, pz) {
    const t0 = now();
    const slots = [];
    for (let bz = pz * P; bz < pz * P + P; bz++) {
      for (let bx = px * P; bx < px * P + P; bx++) {
        const s = slotAtBlock(bx, bz);
        if (s.bx === bx && s.bz === bz) slots.push(s);
      }
    }
    const index = new Map(slots.map((s, i) => [s.key, i]));
    const info = slots.map((slot) => {
      const zone = zoneAt(slot.bx, slot.bz);
      const edges = field.slotEdges(slot);
      return { slot, zone, edges, values: singleOptions(slot, edges, zone) };
    });
    // big placements add a "part of P" value to each claimed slot
    const placements = [];
    info.forEach((it) => {
      for (const p of bigPlacements(it.slot, it.zone, px, pz)) {
        placements.push(p);
        for (const k of p.slots) info[index.get(k)].values.push({ kind: 'big', placement: p, tpl: p.tpl, weight: p.weight });
      }
    });
    for (const it of info) {
      if (!it.values.some((v) => v.kind === 'single')) it.values.push({ kind: 'filler', tpl: null, weight: 1 });
    }
    // neighbours: segment-adjacent slots in this patch, plus slots sharing a placement
    const nset = slots.map(() => new Set());
    const segAdj = new Set();
    slots.forEach((s, i) => {
      for (const [bx, bz] of slotBlocks(s)) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t = slotAtBlock(bx + dx, bz + dz);
          const j = index.get(t.key);
          if (j === undefined || j === i) continue;
          nset[i].add(j); nset[j].add(i);
          segAdj.add(i * 4096 + j); segAdj.add(j * 4096 + i);
        }
      }
    });
    for (const p of placements) {
      const ids = p.slots.map((k) => index.get(k));
      for (const a of ids) for (const b of ids) if (a !== b) nset[a].add(b);
    }
    const neighbours = nset.map((s) => [...s].sort((a, b) => a - b));
    const compatFor = (strict) => (i, a, j, b) => {
      const va = info[i].values[a], vb = info[j].values[b];
      if (va.kind === 'big' && va.placement.slots.includes(slots[j].key)) return vb.placement === va.placement;
      if (vb.kind === 'big' && vb.placement.slots.includes(slots[i].key)) return va.placement === vb.placement;
      if (strict && segAdj.has(i * 4096 + j) && clash(va.tpl, vb.tpl)) return false;
      return true;
    };
    // pairs that can never conflict get an all-ones support mask without calling compat
    const hasRules = info.map((it) => it.values.some((v) => v.tpl?.rules?.notNextTo?.length));
    const linked = (i, j) => info[i].values.some((v) => v.kind === 'big' && v.placement.slots.includes(slots[j].key));
    const constrainedFor = (strict) => (i, j) => linked(i, j) || linked(j, i)
      || (strict && segAdj.has(i * 4096 + j) && (hasRules[i] || hasRules[j]));
    const cls = (v) => (v.kind === 'big' ? `b:${v.placement.key}` : v.kind === 'filler' ? 'f' : `t:${v.tpl.id}`);
    const mkVars = () => info.map((it) => ({
      weights: it.values.map((v) => v.weight), classes: it.values.map(cls), rng: new Rng(hash(worldSeed, 'wfc', it.slot.key)),
    }));
    let res = solveWfc({ vars: mkVars(), neighbours, compat: compatFor(true), constrained: constrainedFor(true) });
    let mode = 'strict';
    stats.contradictions += res.contradictions;
    stats.backtracks += res.backtracks;
    if (!res.ok) {
      mode = 'relaxed'; // fallback 1: drop adjacency rules (connectors still exact)
      stats.relaxedPatches++;
      res = solveWfc({ vars: mkVars(), neighbours, compat: compatFor(false), constrained: constrainedFor(false) });
    }
    let choice = res.choice;
    if (!res.ok) {
      mode = 'failed'; // fallback 2 (should never happen): no big rooms, first single or filler
      stats.failedPatches++;
      choice = info.map((it) => it.values.findIndex((v) => v.kind !== 'big'));
    }

    const results = new Map();
    const bigRooms = new Map();
    info.forEach((it, i) => {
      const v = it.values[choice[i]];
      results.set(it.slot.key, buildEntry(it, v, bigRooms, mode));
    });
    stats.patches++;
    stats.ms += now() - t0;
    return { key: `${px},${pz}`, results, mode, contradictions: res.contradictions };
  }

  function buildEntry(it, v, bigRooms, mode) {
    const { slot, zone, edges } = it;
    const zc = zoneConfig(zones, zone);
    const seed = hash(worldSeed, 'room', slot.key);
    const base = { slotKey: slot.key, bx: slot.bx, bz: slot.bz, orient: slot.orient, zone, edges, seed, solve: mode };
    stats.slots++;
    if (v.kind === 'single') {
      stats.single++;
      const layout = stampBorders(v.variant.layout, v.variant.footprint, (bx, bz, side) => edges[side][side === 'n' || side === 's' ? bx : bz]);
      const room = { ...v.variant.room, layout, legend: legendFor(v.variant.room), materials: v.variant.room.materials ?? zc.materials };
      return { ...base, roomId: v.tpl.id, quarterTurns: v.variant.q, mirror: v.variant.mirror, origin: [slot.bx, slot.bz], size: [room.layout[0].length, room.layout.length], room };
    }
    if (v.kind === 'big') {
      stats.big++;
      const p = v.placement;
      let room = bigRooms.get(p.key);
      if (!room) {
        room = { ...p.variant.room, layout: p.layout, legend: legendFor(p.variant.room), materials: p.variant.room.materials ?? zc.materials };
        bigRooms.set(p.key, room);
      }
      return {
        ...base, roomId: p.tpl.id, quarterTurns: p.variant.q, mirror: p.variant.mirror,
        origin: [p.ox, p.oz], size: [room.layout[0].length, room.layout.length], room,
        bigRoom: { key: p.key, slots: p.slots, primary: p.slots[0] === slot.key },
      };
    }
    stats.filler++;
    const f = generateFillerRoom(edges, new Rng(hash(worldSeed, 'filler', slot.key)), { pools: zc.fillerPools });
    const room = {
      id: `filler:${slot.key}`, zones: { [zone]: 1 }, tags: ['filler'], slots: slot.orient === 'h' ? [2, 1] : [1, 2],
      layout: f.layout, legend: f.legend, materials: zc.materials, objects: [], spots: f.spots,
    };
    return { ...base, roomId: null, filler: f.layout, quarterTurns: 0, mirror: false, origin: [slot.bx, slot.bz], size: [room.layout[0].length, room.layout.length], room };
  }

  function getPatch(px, pz) {
    const k = `${px},${pz}`;
    let p = patches.get(k);
    if (p) { patches.delete(k); patches.set(k, p); return p; } // LRU touch
    p = solvePatch(px, pz);
    patches.set(k, p);
    while (patches.size > maxPatches) patches.delete(patches.keys().next().value);
    return p;
  }

  /** Layout entry for the slot owning block (bx, bz). */
  function slotResult(slot) {
    const [px, pz] = patchOfBlock(slot.bx, slot.bz);
    return getPatch(px, pz).results.get(slot.key);
  }

  /** Entries for every slot touching the inclusive block rectangle (sorted by bz, bx). */
  function layoutRegion(minBx, minBz, maxBx, maxBz) {
    return slotsInBlockRect(minBx, minBz, maxBx, maxBz).map(slotResult);
  }

  return { worldSeed, zones, zoneAt, field, templates, stats, patchSize: P, slotResult, layoutRegion, patchOfBlock, getPatch };
}

/**
 * One-shot convenience entry point.
 * layoutRegion({ worldSeed, rooms, zoneAt, minBx, minBz, maxBx, maxBz, zones?, world? }) → entries
 * Pass `world` (from createWorldLayout) to reuse its patch cache when streaming.
 */
export function layoutRegion(o) {
  const world = o.world ?? createWorldLayout(o);
  return world.layoutRegion(o.minBx, o.minBz, o.maxBx, o.maxBz);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Stitch entries into one walkable grid covering the inclusive block rectangle.
 * Void cells (' ') of big-room footprints never overwrite neighbours.
 * @returns { w, h, ox, oz, walk: Uint8Array, filled: Uint8Array, owner: Int32Array (entry index) }
 *   ox/oz = cell coordinate of grid column/row 0 (block × 8).
 */
export function stitchCells(entries, minBx, minBz, maxBx, maxBz) {
  const ox = minBx * B, oz = minBz * B;
  const w = (maxBx - minBx + 1) * B, h = (maxBz - minBz + 1) * B;
  const walk = new Uint8Array(w * h), filled = new Uint8Array(w * h);
  const owner = new Int32Array(w * h).fill(-1);
  const done = new Set();
  entries.forEach((e, ei) => {
    const id = e.bigRoom ? e.bigRoom.key : e.slotKey;
    if (done.has(id)) return;
    done.add(id);
    const rows = e.room.layout, legend = e.room.legend;
    const cx0 = e.origin[0] * B - ox, cz0 = e.origin[1] * B - oz;
    for (let r = 0; r < rows.length; r++) {
      const z = cz0 + r;
      if (z < 0 || z >= h) continue;
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === ' ') continue;
        const x = cx0 + c;
        if (x < 0 || x >= w) continue;
        const i = z * w + x;
        walk[i] = isSolidChar(ch, legend) ? 0 : 1;
        filled[i] = 1;
        owner[i] = ei;
      }
    }
  });
  return { w, h, ox, oz, walk, filled, owner };
}

/**
 * Seam check: for every segment between two different rooms inside the grid, the border
 * cells on both sides must agree cell by cell (walkable ↔ walkable). Returns mismatches.
 */
export function findSeamMismatches(grid, entries) {
  const out = [];
  const seen = new Set();
  const roomOf = (e) => (e.bigRoom ? e.bigRoom.key : e.slotKey);
  const bx0 = grid.ox / B, bz0 = grid.oz / B, bw = grid.w / B, bh = grid.h / B;
  for (const e of entries) {
    for (const [bx, bz] of slotBlocks(e)) {
      for (const side of SIDES) {
        const key = blockSideSegment(bx, bz, side);
        if (seen.has(key)) continue;
        seen.add(key);
        const [dx, dz] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[side];
        const nbx = bx + dx, nbz = bz + dz;
        const inGrid = (x, z) => x >= bx0 && z >= bz0 && x < bx0 + bw && z < bz0 + bh;
        if (!inGrid(bx, bz) || !inGrid(nbx, nbz)) continue;
        const ia = grid.owner[((bz - bz0) * B) * grid.w + (bx - bx0) * B];
        const ib = grid.owner[((nbz - bz0) * B) * grid.w + (nbx - bx0) * B];
        if (ia < 0 || ib < 0 || roomOf(entries[ia]) === roomOf(entries[ib])) continue;
        for (let i = 0; i < B; i++) {
          let ca, cb; // [col, row] in grid
          const lx = (bx - bx0) * B, lz = (bz - bz0) * B;
          if (side === 'n') { ca = [lx + i, lz]; cb = [lx + i, lz - 1]; }
          else if (side === 's') { ca = [lx + i, lz + B - 1]; cb = [lx + i, lz + B]; }
          else if (side === 'w') { ca = [lx, lz + i]; cb = [lx - 1, lz + i]; }
          else { ca = [lx + B - 1, lz + i]; cb = [lx + B, lz + i]; }
          const wa = grid.walk[ca[1] * grid.w + ca[0]], wb = grid.walk[cb[1] * grid.w + cb[0]];
          if (wa !== wb) { out.push({ segment: key, a: entries[ia].slotKey, b: entries[ib].slotKey, index: i }); break; }
        }
      }
    }
  }
  return out;
}

/** Fraction of walkable cells in the grid sub-rectangle reachable from the walkable cell nearest its centre. */
export function reachability(grid, sub = { x0: 0, z0: 0, x1: grid.w - 1, z1: grid.h - 1 }) {
  const cx = (sub.x0 + sub.x1) >> 1, cz = (sub.z0 + sub.z1) >> 1;
  let start = -1, bestD = Infinity;
  for (let z = sub.z0; z <= sub.z1; z++) for (let x = sub.x0; x <= sub.x1; x++) {
    const i = z * grid.w + x;
    if (!grid.walk[i]) continue;
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    if (d < bestD) { bestD = d; start = i; }
  }
  const { seen } = floodFill(grid.w, grid.h, grid.walk, start);
  let total = 0, reached = 0;
  for (let z = sub.z0; z <= sub.z1; z++) for (let x = sub.x0; x <= sub.x1; x++) {
    const i = z * grid.w + x;
    if (!grid.walk[i]) continue;
    total++;
    if (seen[i]) reached++;
  }
  return { total, reached, ratio: total ? reached / total : 0 };
}

