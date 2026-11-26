#!/usr/bin/env node
// Seed sweep for the world layout (herringbone slots + hashed connectors + WFC).
//
//   node tools/wfc-sweep.mjs                  500 seeds, 12×12-block region
//   node tools/wfc-sweep.mjs --seeds 2000 --size 16
//   node tools/wfc-sweep.mjs --map 42         print the stitched ASCII map of seed 42
//   node tools/wfc-sweep.mjs --rooms a,b      only use these templates (exercise filler / coverage)
//   node tools/wfc-sweep.mjs --update-golden  rewrite tools/fixtures/wfc-golden.json
//
// Fails (exit 1) on: template validation errors, unknown object/pool refs, any seam whose
// border cells disagree, uncovered cells, a seed with < 98 % of walkable cells reachable
// from the centre, non-determinism (same seed twice, or a different request order),
// or a golden digest that changed (cross-process / cross-version determinism).
import fs from 'node:fs';
import path from 'node:path';
import { hash } from '../src/core/rng.js';
import {
  createWorldLayout, prepareTemplates, stitchCells, findSeamMismatches, reachability, slotSegments, segmentSlots,
  CELLS_PER_BLOCK as B,
} from '../src/world/layout/index.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GOLDEN = path.join(ROOT, 'tools/fixtures/wfc-golden.json');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const SEEDS = Number(arg('seeds', 500));
const START = Number(arg('start', 1));
const SIZE = Number(arg('size', 12));
const MARGIN = Number(arg('margin', 4)); // big rooms span 3 blocks; pockets that only connect outside the margin are boundary artefacts
const MIN_REACH = Number(arg('min-reach', 0.98));
const MAP = arg('map', null);
const UPDATE_GOLDEN = argv.includes('--update-golden');
const GOLDEN_SEEDS = 20;

function readJsonTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, readJsonTree(p));
    else if (e.name.endsWith('.json')) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      out[j.id ?? path.basename(e.name, '.json')] = j;
    }
  }
  return out;
}

let rooms = readJsonTree(path.join(ROOT, 'content/rooms'));
const ONLY = arg('rooms', null);
if (ONLY) rooms = Object.fromEntries(ONLY.split(',').map((id) => [id, rooms[id]]).filter(([, r]) => r));
const objects = readJsonTree(path.join(ROOT, 'content/objects'));
const pools = readJsonTree(path.join(ROOT, 'content/pools'));
const failures = [];
const fail = (m) => failures.push(m);

// ── content checks ───────────────────────────────────────────────────────────
const templates = prepareTemplates(rooms);
templates.errors.forEach((e) => fail(`template: ${e}`));
for (const t of [...templates.singles, ...templates.bigs]) {
  for (const o of t.room.objects ?? []) if (!objects[o.def]) fail(`template ${t.id}: unknown object "${o.def}"`);
  for (const s of t.room.spots ?? []) {
    if (typeof s.pool === 'string' && !pools[s.pool]) fail(`template ${t.id}: unknown pool "${s.pool}"`);
  }
}
for (const z of Object.values(createWorldLayout({ worldSeed: 0, templates }).zones)) {
  for (const p of z.fillerPools ?? []) if (!pools[p]) fail(`zone filler pool "${p}" not found`);
}

// ── sweep ────────────────────────────────────────────────────────────────────
const half = SIZE >> 1;
const inner = { minBx: -half, minBz: -half, maxBx: SIZE - half - 1, maxBz: SIZE - half - 1 };
const outer = { minBx: inner.minBx - MARGIN, minBz: inner.minBz - MARGIN, maxBx: inner.maxBx + MARGIN, maxBz: inner.maxBz + MARGIN };
const sub = {
  x0: MARGIN * B, z0: MARGIN * B,
  x1: (MARGIN + SIZE) * B - 1, z1: (MARGIN + SIZE) * B - 1,
};

const summary = (e) => [e.slotKey, e.roomId, e.quarterTurns, e.mirror ? 1 : 0, e.bigRoom?.key ?? '', e.filler ? e.filler.join('') : '', e.edges ? Object.values(e.edges).join() : ''].join('|');
const digest = (entries) => hash(entries.map(summary).join('\n')).toString(16).padStart(8, '0');

function layoutSeed(seed) {
  const world = createWorldLayout({ worldSeed: seed, templates });
  const entries = world.layoutRegion(outer.minBx, outer.minBz, outer.maxBx, outer.maxBz);
  return { world, entries };
}

if (MAP !== null) {
  const { entries } = layoutSeed(Number(MAP));
  const g = stitchCells(entries, inner.minBx, inner.minBz, inner.maxBx, inner.maxBz);
  for (let z = 0; z < g.h; z++) {
    let row = '';
    for (let x = 0; x < g.w; x++) {
      const e = entries[g.owner[z * g.w + x]];
      row += g.walk[z * g.w + x] ? (e?.filler ? ',' : e?.bigRoom ? ':' : '.') : '█';
    }
    console.log(row);
  }
  console.log('legend: . template floor   : big room floor   , filler floor   █ solid');
  process.exit(0);
}

const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : null;
const newGolden = { note: 'digests of the inner region per seed; regenerate with --update-golden', size: SIZE, margin: MARGIN, digests: {} };
const agg = { slots: 0, single: 0, big: 0, filler: 0, contradictions: 0, backtracks: 0, relaxedPatches: 0, failedPatches: 0, patches: 0, ms: 0 };
const fillerCombos = new Map(), usage = new Map();
const reaches = [];
const ruleBreaks = { inPatch: 0, acrossPatches: 0 };
let mismatchTotal = 0, uncovered = 0, innerSlots = 0, innerFiller = 0, innerBig = 0;
const t0 = Date.now();

for (let seed = START; seed < START + SEEDS; seed++) {
  const { world, entries } = layoutSeed(seed);
  for (const k of Object.keys(agg)) agg[k] += world.stats[k];

  const grid = stitchCells(entries, outer.minBx, outer.minBz, outer.maxBx, outer.maxBz);
  const holes = grid.filled.reduce((n, v) => n + (v ? 0 : 1), 0);
  if (holes) { uncovered += holes; fail(`seed ${seed}: ${holes} cells not covered by any room`); }
  const mm = findSeamMismatches(grid, entries);
  mismatchTotal += mm.length;
  if (mm.length) fail(`seed ${seed}: ${mm.length} seam mismatches, e.g. ${JSON.stringify(mm[0])}`);
  const r = reachability(grid, sub);
  reaches.push(r.ratio);
  if (r.ratio < MIN_REACH) fail(`seed ${seed}: only ${(r.ratio * 100).toFixed(2)} % reachable`);

  const innerEntries = world.layoutRegion(inner.minBx, inner.minBz, inner.maxBx, inner.maxBz);
  const byKey = new Map(entries.map((e) => [e.slotKey, e]));
  for (const e of innerEntries) {
    const ta = templates.byId.get(e.roomId);
    if (!ta?.rules?.notNextTo?.length) continue;
    for (const k of Object.values(slotSegments(e)).flat()) {
      const o = byKey.get(segmentSlots(k).find((s) => s.key !== e.slotKey).key);
      const tb = o && templates.byId.get(o.roomId);
      if (!tb || (e.bigRoom && e.bigRoom.key === o.bigRoom?.key)) continue;
      if (!ta.rules.notNextTo.some((t) => tb.tags.includes(t))) continue;
      const same = String(world.patchOfBlock(e.bx, e.bz)) === String(world.patchOfBlock(o.bx, o.bz));
      if (same && e.solve === 'strict') { ruleBreaks.inPatch++; fail(`seed ${seed}: ${e.roomId} at ${e.slotKey} next to ${o.roomId} inside one patch`); }
      else ruleBreaks.acrossPatches++;
    }
  }
  for (const e of innerEntries) {
    innerSlots++;
    const id = e.roomId ?? '(filler)';
    usage.set(id, (usage.get(id) ?? 0) + 1);
    if (e.bigRoom) innerBig++;
    if (e.filler) {
      innerFiller++;
      const k = `${e.orient} n=${e.edges.n} s=${e.edges.s} e=${e.edges.e} w=${e.edges.w}`;
      fillerCombos.set(k, (fillerCombos.get(k) ?? 0) + 1);
    }
  }
  const d = digest(innerEntries);
  if (seed - START < GOLDEN_SEEDS) {
    newGolden.digests[seed] = d;
    // determinism: fresh world, same seed
    const again = createWorldLayout({ worldSeed: seed, templates });
    if (digest(again.layoutRegion(inner.minBx, inner.minBz, inner.maxBx, inner.maxBz)) !== d) fail(`seed ${seed}: not deterministic`);
    // order independence: request quadrants in reverse order on a fresh world, compare per slot
    const w2 = createWorldLayout({ worldSeed: seed, templates });
    const mx = (inner.minBx + inner.maxBx) >> 1, mz = (inner.minBz + inner.maxBz) >> 1;
    const quads = [
      [mx + 1, mz + 1, inner.maxBx, inner.maxBz], [inner.minBx, mz + 1, mx, inner.maxBz],
      [mx + 1, inner.minBz, inner.maxBx, mz], [inner.minBx, inner.minBz, mx, mz],
    ];
    const bySlot = new Map();
    for (const q of quads) for (const e of w2.layoutRegion(...q)) bySlot.set(e.slotKey, summary(e));
    for (const e of innerEntries) if (bySlot.get(e.slotKey) !== summary(e)) { fail(`seed ${seed}: order-dependent result at ${e.slotKey}`); break; }
    if (golden && !ONLY && !UPDATE_GOLDEN && golden.size === SIZE && golden.margin === MARGIN && golden.digests[seed] && golden.digests[seed] !== d) {
      fail(`seed ${seed}: digest ${d} != golden ${golden.digests[seed]} (layout changed; rerun with --update-golden if intended)`);
    }
  }
}
const wall = Date.now() - t0;

// ── report ───────────────────────────────────────────────────────────────────
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(2) : '0.00') + ' %';
reaches.sort((a, b) => a - b);
const mean = reaches.reduce((a, b) => a + b, 0) / reaches.length;
console.log(`WFC sweep: ${SEEDS} seeds (${START}..${START + SEEDS - 1}), ${SIZE}×${SIZE}-block region (+${MARGIN} margin)`);
console.log(`templates: ${templates.singles.length} single-slot, ${templates.bigs.length} multi-slot` + (templates.warnings.length ? `; warnings: ${templates.warnings.join('; ')}` : ''));
console.log(`reachable walkable cells: mean ${pct(mean, 1)}, min ${pct(reaches[0], 1)}, p1 ${pct(reaches[Math.floor(reaches.length * 0.01)], 1)}`);
console.log(`seam mismatches: ${mismatchTotal}   uncovered cells: ${uncovered}`);
console.log(`inner slots: ${innerSlots}   template ${pct(innerSlots - innerFiller - innerBig, innerSlots)}   multi-slot ${pct(innerBig, innerSlots)}   filler ${pct(innerFiller, innerSlots)}`);
console.log(`WFC (all solved slots, incl. patch overhang): ${agg.slots} slots in ${agg.patches} patches; contradictions ${agg.contradictions}, backtracks ${agg.backtracks}, relaxed-rule fallbacks ${agg.relaxedPatches} patches, hard fallbacks ${agg.failedPatches}`);
console.log(`adjacency-rule breaks: ${ruleBreaks.inPatch} inside a patch (must be 0), ${ruleBreaks.acrossPatches} across patch borders (not enforced)`);
console.log(`time: ${(agg.ms / agg.slots).toFixed(3)} ms per slot (solve + build), ${(wall / SEEDS).toFixed(1)} ms per seed overall`);
console.log('room usage (inner region):');
for (const [id, n] of [...usage].sort((a, b) => b[1] - a[1])) console.log(`  ${id.padEnd(24)} ${String(n).padStart(6)}  ${pct(n, innerSlots)}`);
if (fillerCombos.size) {
  console.log('edge combos that fell back to filler most often:');
  for (const [k, n] of [...fillerCombos].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(5)}  ${k}`);
}
if (UPDATE_GOLDEN && !ONLY) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(newGolden, null, 2) + '\n');
  console.log(`golden digests written to ${path.relative(ROOT, GOLDEN)}`);
} else if (!golden) {
  console.log('(no golden fixture yet; run with --update-golden to pin digests)');
}
if (failures.length) {
  console.log(`\nFAIL: ${failures.length} problem(s)`);
  for (const f of failures.slice(0, 20)) console.log('  - ' + f);
  process.exit(1);
}
console.log('\nPASS');
