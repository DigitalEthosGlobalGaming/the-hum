// node --test src/world/layout/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Rng } from '../../core/rng.js';
import {
  slotAtBlock, slotsInBlockRect, slotBlocks, slotSegments, segmentSlots, ConnectorField,
  rotateRoom, transformLayout, prepareTemplates, generateFillerRoom, solveWfc, createWorldLayout,
  stitchCells, findSeamMismatches, reachability, isConnected, PROFILES, CORE_LEGEND, CELL_M,
  footprintPerimeter,
} from './index.js';
import { sideCells } from './templates.js';
import { isSolidChar } from './grid.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const rooms = {};
for (const f of fs.readdirSync(path.join(ROOT, 'content/rooms/lobby'))) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/rooms/lobby', f), 'utf8'));
  rooms[j.id] = j;
}

test('herringbone: every block belongs to exactly one slot, slots never overlap', () => {
  const owner = new Map();
  const slots = slotsInBlockRect(-37, -29, 41, 33);
  for (const s of slots) {
    for (const [bx, bz] of slotBlocks(s)) {
      const k = `${bx},${bz}`;
      assert.ok(!owner.has(k), `block ${k} claimed by ${owner.get(k)} and ${s.key}`);
      owner.set(k, s.key);
      assert.equal(slotAtBlock(bx, bz).key, s.key, `slotAtBlock(${k}) disagrees`);
    }
  }
  for (let bz = -29; bz <= 33; bz++) for (let bx = -37; bx <= 41; bx++) {
    assert.ok(owner.has(`${bx},${bz}`), `block ${bx},${bz} uncovered`);
  }
  // slots are 2×1 or 1×2 and both orientations appear equally
  const h = slots.filter((s) => s.orient === 'h').length;
  assert.ok(Math.abs(h / slots.length - 0.5) < 0.05);
});

test('herringbone: segments are shared by exactly the two slots that touch them', () => {
  for (const s of slotsInBlockRect(-6, -6, 6, 6)) {
    const segs = slotSegments(s);
    const n = s.orient === 'h' ? [2, 2, 1, 1] : [1, 1, 2, 2];
    assert.deepEqual(['n', 's', 'e', 'w'].map((k) => segs[k].length), n);
    for (const key of Object.values(segs).flat()) {
      const [a, b] = segmentSlots(key);
      assert.notEqual(a.key, b.key);
      assert.ok(a.key === s.key || b.key === s.key);
      const other = a.key === s.key ? b : a;
      assert.ok(Object.values(slotSegments(other)).flat().includes(key));
    }
  }
});

test('connectors: order-independent, symmetric and every slot has >= 2 openings', () => {
  const f1 = new ConnectorField({ worldSeed: 99 });
  const f2 = new ConnectorField({ worldSeed: 99 });
  const slots = slotsInBlockRect(-20, -20, 20, 20);
  const forward = slots.map((s) => f1.slotEdges(s));
  const backward = [...slots].reverse().map((s) => f2.slotEdges(s)).reverse();
  assert.deepEqual(forward, backward);
  slots.forEach((s, i) => {
    const open = Object.values(forward[i]).flat().filter((c) => c !== 'wall').length;
    assert.ok(open >= 2, `${s.key} has ${open} openings`);
  });
});

test('rotateRoom: four quarter turns and double mirror are identity; positions follow cells', () => {
  const room = rooms.lobby_office;
  for (let q = 0; q < 4; q++) {
    const t = rotateRoom(room, q, q % 2 === 1);
    // every object / spot still sits on a walkable cell of the transformed layout
    for (const o of [...t.room.objects, ...t.room.spots]) {
      const c = Math.floor(o.pos[0] / CELL_M), r = Math.floor(o.pos[2] / CELL_M);
      assert.ok(!isSolidChar(t.layout[r][c], { ...room.legend, ...CORE_LEGEND }), `${o.def ?? o.id} solid after q=${q}`);
    }
  }
  let L = room.layout;
  for (let i = 0; i < 4; i++) L = transformLayout(L, 1);
  assert.deepEqual(L, room.layout);
  assert.deepEqual(transformLayout(transformLayout(room.layout, 0, true), 0, true), room.layout);
  const t = rotateRoom(room, 1);
  assert.equal(t.w, 8); assert.equal(t.h, 16);
  // map: rot 0 (facing north) after one clockwise turn faces east (= -90° = 270°)
  assert.equal(t.map([0, 0, 0, 0])[3], 270);
  // edges: old west becomes new north (one segment), old north → new east (two segments)
  assert.deepEqual(t.edges.n, room.edges.w);
  assert.deepEqual(t.edges.e, room.edges.n);
});

test('templates: validation passes and exact edges survive every transform', () => {
  const t = prepareTemplates(rooms);
  assert.deepEqual(t.errors, []);
  assert.ok(t.singles.length >= 12);
  for (const tpl of t.singles) {
    for (const v of tpl.variants) {
      for (const p of footprintPerimeter(v.footprint)) {
        const idx = p.side === 'n' || p.side === 's' ? p.bx : p.bz;
        const spec = v.edges[p.side][idx];
        if (!spec.exact) continue;
        const prof = PROFILES[spec.exact];
        sideCells(p.bx, p.bz, p.side).forEach(([c, r], i) => {
          assert.equal(isSolidChar(v.layout[r][c], CORE_LEGEND), isSolidChar(prof[i], CORE_LEGEND),
            `${tpl.id} q${v.q}${v.mirror ? 'm' : ''} ${p.side}[${idx}] cell ${i}`);
        });
      }
    }
  }
});

test('filler: borders match the edges and everything is connected (many seeds, both orientations)', () => {
  const field = new ConnectorField({ worldSeed: 7 });
  let n = 0;
  for (const s of slotsInBlockRect(-15, -15, 15, 15)) {
    const edges = field.slotEdges(s);
    const f = generateFillerRoom(edges, new Rng(n++), { pools: ['lobby_floor_loot'] });
    assert.equal(f.layout.length, s.orient === 'h' ? 8 : 16);
    assert.ok(isConnected(f.layout, f.legend), `${s.key} not connected`);
    const fp = slotBlocks(s).map(([bx, bz]) => [bx - s.bx, bz - s.bz]);
    for (const p of footprintPerimeter(fp)) {
      const conn = edges[p.side][p.side === 'n' || p.side === 's' ? p.bx : p.bz];
      sideCells(p.bx, p.bz, p.side).forEach(([c, r], i) => {
        assert.equal(isSolidChar(f.layout[r][c], f.legend), isSolidChar(PROFILES[conn][i], CORE_LEGEND));
      });
    }
  }
});

test('wfc: backtracks through a contradiction with a bounded undo stack', () => {
  // 3 vars in a triangle, each {0,1}; neighbours must differ → impossible (odd cycle) → fails.
  const tri = solveWfc({
    vars: [0, 1, 2].map((i) => ({ weights: [1, 1], rng: new Rng(i) })),
    neighbours: [[1, 2], [0, 2], [0, 1]],
    compat: (i, a, j, b) => a !== b,
    maxBacktracks: 8,
  });
  assert.equal(tri.ok, false);
  assert.ok(tri.backtracks > 0);
  // X prefers 0 (weight 100). X = 0 squeezes the all-different triangle A, B, C into {0, 1}:
  // arc consistency cannot see that, so the solver must observe, hit the contradiction,
  // undo back to X and take X = 1.
  const X = 3;
  const r = solveWfc({
    vars: [
      { weights: [1, 1, 1], rng: new Rng(1) }, { weights: [1, 1, 1], rng: new Rng(2) },
      { weights: [1, 1, 1], rng: new Rng(3) }, { weights: [100, 1], rng: new Rng(4) },
    ],
    neighbours: [[1, 2, X], [0, 2, X], [0, 1, X], [0, 1, 2]],
    compat: (i, a, j, b) => {
      if (i === X) return a === 1 || b < 2;
      if (j === X) return b === 1 || a < 2;
      return a !== b;
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.choice[X], 1);
  assert.ok(r.backtracks > 0, 'expected the solver to backtrack');
  assert.equal(new Set(r.choice.slice(0, 3)).size, 3);
});

test('layout: deterministic, order-independent and seams always line up', () => {
  const templates = prepareTemplates(rooms);
  for (const seed of [1, 2, 'abc']) {
    const a = createWorldLayout({ worldSeed: seed, templates }).layoutRegion(-10, -10, 9, 9);
    const w = createWorldLayout({ worldSeed: seed, templates });
    const parts = [[0, 0, 9, 9], [-10, 0, -1, 9], [0, -10, 9, -1], [-10, -10, -1, -1]].flatMap((r) => w.layoutRegion(...r));
    const by = new Map(parts.map((e) => [e.slotKey, e]));
    for (const e of a) {
      const b = by.get(e.slotKey);
      assert.equal(b.roomId, e.roomId);
      assert.equal(b.quarterTurns, e.quarterTurns);
      assert.deepEqual(b.room.layout, e.room.layout);
    }
    const g = stitchCells(a, -10, -10, 9, 9);
    assert.deepEqual(findSeamMismatches(g, a), []);
  }
});

test('layout: with only restrictive templates, filler takes over and the world stays connected', () => {
  const few = { lobby_dead_end_alcove: rooms.lobby_dead_end_alcove, lobby_long_corridor: rooms.lobby_long_corridor };
  const w = createWorldLayout({ worldSeed: 5, rooms: few });
  const e = w.layoutRegion(-10, -10, 9, 9);
  assert.ok(w.stats.filler > w.stats.single);
  const g = stitchCells(e, -10, -10, 9, 9);
  assert.deepEqual(findSeamMismatches(g, e), []);
  assert.ok(reachability(g, { x0: 32, z0: 32, x1: 127, z1: 127 }).ratio > 0.98);
  // dead ends never sit next to each other inside a patch (adjacency rule)
  const byKey = new Map(e.map((x) => [x.slotKey, x]));
  for (const x of e) {
    if (x.roomId !== 'lobby_dead_end_alcove' || x.solve !== 'strict') continue;
    for (const k of Object.values(slotSegments(x)).flat()) {
      const other = segmentSlots(k).find((s) => s.key !== x.slotKey);
      const o = byKey.get(other.key);
      if (!o) continue;
      const samePatch = String(w.patchOfBlock(o.bx, o.bz)) === String(w.patchOfBlock(x.bx, x.bz));
      if (samePatch) assert.notEqual(o.roomId, 'lobby_dead_end_alcove');
    }
  }
});
