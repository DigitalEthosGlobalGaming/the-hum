// node --test src/story/story.test.mjs
// Pure logic of the container + story props: container rolls and persistence, the typewriter's
// live sentence, red string path compression, wanderer identities, walkie hints, evac map sampling
// and the notebook map's reveal / "?" contradictions. Plus the container scripts through a fake game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import { validateContent, scriptRegistry } from '../../tools/validate.mjs';
import { compartmentsOf, stuckIndex, openCompartment, vend, aimedCompartment } from '../containers/logic.js';
import { liveLine, pickLine, withArticle, facingWord, wrapMono } from './typewriterText.js';
import { compressPath, pathLength, payOut } from './stringPath.js';
import { wandererFor } from './wanderers.js';
import { hintAt } from './walkie.js';
import { sampleLayout, mapLies, lieOffset, mapCell } from './evacMap.js';
import { photoExtra, photoCaption } from './camera.js';
import { SeenMap } from '../ui/diegetic/automap.js';
import { createWorldLayout, stitchCells } from '../world/layout/index.js';
import { Rng } from '../core/rng.js';
import { Gameplay } from '../gameplay/gameplay.js';
import { interact, useHeld, combineSlots } from '../interaction/interaction.js';

const { content } = loadContent();
const defs = content.objects;
const pools = content.pools;
const cabinet = defs.filing_cabinet.components.container;
const machine = defs.vending_machine.components.container;

// ---------------- containers ----------------
test('containers: content validates and every new script is registered', () => {
  const reg = scriptRegistry();
  const { errors } = validateContent(content, { scripts: reg.ids });
  assert.deepEqual(errors, []);
  assert.deepEqual(reg.errors, []);
  for (const id of ['container_open', 'vend_coin', 'typewriter_type', 'badge_read', 'evac_map_read', 'walkie_use', 'camera_flash', 'string_use', 'string_end_take', 'tape_load_blank']) {
    assert.ok(reg.ids.includes(id), id);
  }
});

test('containers: a compartment rolls once per run, seeded by the stable key', () => {
  assert.equal(compartmentsOf(cabinet).length, 3);
  assert.equal(compartmentsOf(cabinet)[0].name, 'top drawer');
  const key = 'h:0,0#4';
  const stuck = stuckIndex(cabinet, 7, key);
  const i = stuck === 0 ? 1 : 0;
  const a = {}, b = {};
  const r1 = openCompartment(a, cabinet, i, { seed: 7, key, pools });
  const r2 = openCompartment(b, cabinet, i, { seed: 7, key, pools });
  assert.equal(r1.status, 'opened');
  assert.deepEqual(r1.items, r2.items, 'same run, same cabinet, same drawer → same contents');
  assert.deepEqual(openCompartment(a, cabinet, i, { seed: 7, key, pools }), { status: 'already', items: [] }, 'opened state persists');
  assert.deepEqual(a.rolled[i], r1.items);
  // the state is plain data: a copy (a save, or the room streaming back) is still opened
  const copy = JSON.parse(JSON.stringify(a));
  assert.equal(openCompartment(copy, cabinet, i, { seed: 7, key, pools }).status, 'already');
  // across many cabinets the rolls differ (it isn't one fixed answer)
  const seen = new Set();
  for (let k = 0; k < 60; k++) {
    const st = {};
    const kk = `room${k}#0`;
    const j = stuckIndex(cabinet, 7, kk) === 2 ? 1 : 2;
    seen.add(JSON.stringify(openCompartment(st, cabinet, j, { seed: 7, key: kk, pools }).items));
  }
  assert.ok(seen.size >= 4, `varied bottom-drawer contents (${seen.size})`);
});

test('containers: at most one stuck drawer, about half the cabinets have one, it stays stuck', () => {
  let withStuck = 0;
  for (let k = 0; k < 400; k++) {
    const s = stuckIndex(cabinet, 99, `c${k}`);
    assert.ok(s >= -1 && s <= 2);
    assert.equal(s, stuckIndex(cabinet, 99, `c${k}`), 'deterministic');
    if (s >= 0) withStuck++;
  }
  assert.ok(withStuck > 150 && withStuck < 250, `~50% (${withStuck}/400)`);
  let key = 'x';
  for (let k = 0; stuckIndex(cabinet, 5, key) < 0; k++) key = `x${k}`;
  const s = stuckIndex(cabinet, 5, key), st = {};
  assert.equal(openCompartment(st, cabinet, s, { seed: 5, key, pools }).status, 'stuck');
  assert.equal(openCompartment(st, cabinet, s, { seed: 5, key, pools }).status, 'stuck');
  assert.equal(st.rattles, 2);
  assert.equal(stuckIndex({ compartments: [{ pool: 'story_drawer_top' }] }, 5, key), -1, 'a single drawer never jams');
});

test('containers: vending — per-coin seeded rolls, eats some coins, drops the wrong thing sometimes', () => {
  const counts = { item: 0, wrong: 0, eaten: 0 };
  const vendIds = new Set(pools.story_vend.entries.map((e) => e.def));
  const wrongIds = new Set(pools.story_vend_wrong.entries.map((e) => e.def));
  const st = {};
  for (let n = 0; n < 600; n++) {
    const r = vend(st, machine, { seed: 3, key: 'vm', pools, ctx: { depth: 5 } });
    counts[r.outcome]++;
    if (r.outcome === 'item') assert.ok(vendIds.has(r.items[0]));
    if (r.outcome === 'wrong') assert.ok(wrongIds.has(r.items[0]));
    if (r.outcome === 'eaten') assert.deepEqual(r.items, []);
  }
  assert.equal(st.coins, 600);
  assert.ok(counts.eaten > 50 && counts.eaten < 140, JSON.stringify(counts));
  assert.ok(counts.wrong > 50 && counts.wrong < 140, JSON.stringify(counts));
  // same machine + same coin number → same result
  const a = vend({ coins: 4 }, machine, { seed: 3, key: 'vm', pools });
  const b = vend({ coins: 4 }, machine, { seed: 3, key: 'vm', pools });
  assert.deepEqual(a, b);
});

test('containers: aiming at a drawer picks its row (and works when the cabinet is turned)', () => {
  const L = { bottom: 0.06, height: 0.42, count: 3, front: -0.31 };
  const eye = { x: 0, y: 1.6, z: -1.5 };
  const at = (y, rot = 0, pos = { x: 0, y: 0, z: 0 }) => {
    // aim from 1.2 m in front of the (turned) cabinet at height y on its face
    const c = Math.cos(rot), s = Math.sin(rot);
    const fwd = { x: -s, z: -c };           // the cabinet's front direction (local -z)
    const e = { x: pos.x + fwd.x * 1.5, y: 1.6, z: pos.z + fwd.z * 1.5 };
    const tgt = { x: pos.x + fwd.x * 0.31, y, z: pos.z + fwd.z * 0.31 };
    const d = { x: tgt.x - e.x, y: tgt.y - e.y, z: tgt.z - e.z };
    const n = Math.hypot(d.x, d.y, d.z);
    return aimedCompartment(pos, rot, e, { x: d.x / n, y: d.y / n, z: d.z / n }, L);
  };
  void eye;
  assert.equal(at(1.15), 0, 'top');
  assert.equal(at(0.7), 1, 'middle');
  assert.equal(at(0.2), 2, 'bottom');
  assert.equal(at(2.5), 0, 'above clamps to the top');
  assert.equal(at(0.2, Math.PI / 2, { x: 4, y: 0, z: -2 }), 2, 'turned 90°');
  assert.equal(at(1.15, Math.PI, { x: -3, y: 0, z: 6 }), 0, 'turned 180°');
});

// ---------------- container scripts through a fake game ----------------
function fakeGame() {
  const log = [];
  const events = { emit: (n, p) => log.push([n, p]), on: () => () => {}, of: (n) => log.filter((e) => e[0] === n).map((e) => e[1]) };
  const instances = [];
  let uid = 1;
  const world = {
    run: { spawnedUnique: new Set(), taken: new Set() },
    isSolidAt: () => false,
    roomAt: () => ({ key: 'roomA', depth: 3 }),
    noise: (pos, loudness, source) => events.emit('world:noise', { ...pos, loudness, source }),
    objects: {
      instances,
      spawn(id, pos, rotY, meta) {
        const inst = { uid: uid++, id, def: defs[id], name: defs[id].name, root: { position: { ...pos }, rotation: { y: rotY } }, center: { ...pos }, meta, state: {} };
        instances.push(inst);
        return inst;
      },
      remove(inst) { instances.splice(instances.indexOf(inst), 1); },
    },
  };
  const game = {
    cfg: content.config, content, seed: 1234, events, world, time: 10,
    synth: { play: () => ({ stop() {} }) },
    player: { pos: { x: 0, y: 0, z: 1.5 }, yaw: 0, pitch: -0.4 },
    camera: { position: { x: 0, y: 1.6, z: 1.5 } },
    stats: { sanity: 1, stamina: 1, steps: 40 },
    flashlight: { on: true, battery: 1 },
    focus: null,
  };
  const gp = new Gameplay(game);
  game.gameplay = gp;
  game.inventory = gp.inventory;
  return { game, gp, events, world };
}

test('container_open: E opens the aimed drawer once, items go to the hand, state survives streaming', () => {
  const { game, gp, events, world } = fakeGame();
  // cabinet at the origin facing -z; the player stands at z=-1.5 (in front) looking at the top drawer
  const cab = world.objects.spawn('filing_cabinet', { x: 0, y: 0, z: 0 }, 0, { roomKey: 'roomA', fixed: 3 });
  game.player.pos = { x: 0, y: 0, z: -1.5 };
  game.camera.position = { x: 0, y: 1.6, z: -1.5 };
  game.player.yaw = Math.PI;          // facing +z, toward the cabinet front
  game.player.pitch = -0.35;
  const key = gp.stableKey(cab);
  assert.equal(key, 'roomA#3');
  const stuck = stuckIndex(cabinet, game.seed, key);
  const aimed = aimedCompartment(cab.root.position, 0, game.camera.position, gp.viewDir(), { bottom: 0.06, height: 0.42, count: 3, front: -0.31 });
  assert.ok(interact(gp, cab));
  const st = gp.stateOf(cab);
  if (aimed === stuck) {
    assert.equal(st.rattles, 1);
    assert.ok(events.of('ui:caption').length);
    return;
  }
  assert.equal(st.opened[aimed], true);
  const items = st.rolled[aimed];
  const held = gp.inventory.slots.filter(Boolean).map((s) => s.id);
  assert.deepEqual(held, items, 'contents go straight into the pockets');
  assert.ok(events.of('world:noise').some((n) => n.source === 'drawer'));
  // the room streams out and back in: a new inst, same stable key → still open
  world.objects.remove(cab);
  const again = world.objects.spawn('filing_cabinet', { x: 0, y: 0, z: 0 }, 0, { roomKey: 'roomA', fixed: 3 });
  assert.equal(gp.stateOf(again).opened[aimed], true);
  interact(gp, again);
  assert.equal(gp.inventory.slots.filter(Boolean).length, items.length, 'nothing new from an opened drawer');
});

test('vend_coin: E with a coin held feeds it in (coin consumed), a vended item lands in the tray', () => {
  const { game, gp, world } = fakeGame();
  const vm = world.objects.spawn('vending_machine', { x: 0, y: 0, z: 0 }, 0, { roomKey: 'roomA', fixed: 1 });
  let got = 0;
  for (let n = 0; n < 12; n++) {
    gp.inventory.add('coin', {}, { index: 0, select: true });
    assert.equal(gp.inventory.held.id, 'coin');
    assert.ok(interact(gp, vm));
    assert.equal(gp.inventory.find('coin'), null, 'coin consumed');
    gp.update(1.0); // the clunk timer
  }
  got = world.objects.instances.filter((i) => i !== vm).length;
  assert.equal(gp.stateOf(vm).coins, 12);
  assert.ok(got >= 6 && got <= 12, `most coins vend something (${got}/12)`);
  const tray = world.objects.instances.find((i) => i !== vm);
  assert.ok(tray.root.position.z < 0 && tray.root.position.y > 0.1, 'in the tray at the front');
  assert.ok(tray.meta.placedKey, 'persisted');
  // without a coin: a knock and a hint
  gp.inventory.remove(0);
  assert.equal(interact(gp, vm), false);
});

test('tape recorder: blank tape gives record mode; logs still play without one', () => {
  const { gp, events } = fakeGame();
  gp.inventory.add('tape_recorder', {}, { index: 0, select: true });
  assert.ok(useHeld(gp));
  gp.update(0.5);
  assert.ok(events.of('ui:caption').some((c) => c.text.startsWith('"')), 'a log line plays');
  gp.inventory.add('blank_tape', {}, { index: 1 });
  assert.ok(combineSlots(gp, 1, 0));
  assert.equal(gp.inventory.find('blank_tape'), null, 'blank tape used up');
  assert.equal(gp.inventory.slots[0].state.blank, true);
});

// ---------------- typewriter ----------------
test('typewriter: the live sentence is built from live state', () => {
  const rng = { next: () => 0.99 }; // > 0.75 → just the signature clause
  assert.equal(liveLine({ near: 'Typewriter', held: 'AA battery' }, rng), 'you are standing by the typewriter. you are holding an aa battery.');
  assert.equal(liveLine({ near: 'typewriter', held: 'Battery' }, rng), 'you are standing by the typewriter. you are holding a battery.');
  assert.equal(liveLine({ near: 'typewriter', held: null }, rng), 'you are standing by the typewriter. your hands are empty.');
  const r = new Rng(1);
  for (let i = 0; i < 40; i++) {
    const s = liveLine({ near: 'typewriter', held: 'Stick of chalk', torchOn: false, steps: 512, yaw: Math.PI / 2, minutes: 7.6, sanity: 0.2, photos: 1 }, r);
    assert.match(s, /^you are standing by the typewriter\. you are holding a stick of chalk\./);
    assert.equal(s, s.toLowerCase());
    assert.doesNotMatch(s, /undefined|NaN/);
  }
  assert.equal(withArticle('Almond water'), 'an almond water');
  assert.equal(facingWord(0), 'north');
  assert.equal(facingWord(Math.PI / 2), 'west');
  assert.equal(facingWord(-Math.PI / 2), 'east');
  assert.equal(facingWord(Math.PI), 'south');
});

test('typewriter: story lines advance in order, about 1 in 5 presses is live', () => {
  const story = content.lines.typewriter_story.lines;
  let idx = 0, live = 0;
  const r = new Rng(42);
  const typed = [];
  for (let i = 0; i < 400; i++) {
    const p = pickLine(story, idx, { near: 'typewriter', held: null }, r);
    if (p.live) live++;
    else if (p.advance) { assert.equal(p.text, story[idx]); typed.push(p.text); idx++; }
    else assert.equal(p.text, story.at(-1), 'past the end it repeats the last line');
  }
  assert.deepEqual(typed, story);
  assert.ok(live > 50 && live < 110, `~20% live (${live}/400)`);
  assert.deepEqual(wrapMono('aaa bbb cccccccccccccccccccc', 10), ['aaa bbb', 'cccccccccc', 'cccccccccc']);
});

// ---------------- red string ----------------
test('red string: path compression keeps corners and drops straight runs', () => {
  const straight = Array.from({ length: 50 }, (_, i) => [i * 0.3, 0.001 * Math.sin(i)]);
  assert.equal(compressPath(straight).length, 2);
  const L = [];
  for (let i = 0; i <= 20; i++) L.push([i * 0.5, 0]);
  for (let i = 1; i <= 20; i++) L.push([10, i * 0.5]);
  const c = compressPath(L);
  assert.deepEqual(c, [[0, 0], [10, 0], [10, 10]]);
  assert.ok(Math.abs(pathLength(c) - pathLength(L)) < 1e-9);
  // wiggly walking path: shorter list, never more than tol off, ends kept
  const r = new Rng(9);
  const walk = [[0, 0]];
  for (let i = 0; i < 400; i++) { const [x, z] = walk.at(-1); walk.push([x + 0.35 + r.range(-0.02, 0.02), z + Math.sin(i / 25) * 0.3]); }
  const w = compressPath(walk, 0.08);
  assert.ok(w.length < walk.length / 3, `${w.length} of ${walk.length}`);
  assert.deepEqual(w[0], walk[0]);
  assert.deepEqual(w.at(-1), walk.at(-1));
});

test('red string: pays out behind you, stops at the end of the ball', () => {
  const t = { pts: [[0, 0]], len: 0 }, spool = { left: 10 };
  for (let x = 0.1; x < 30; x += 0.1) payOut(t, spool, [x, 0]);
  assert.equal(spool.left, 0);
  assert.ok(Math.abs(t.len - 10) < 1e-6, `len ${t.len}`);
  assert.ok(Math.abs(pathLength(t.pts) - 10) < 0.05, 'the line is 10 m long');
  assert.ok(t.pts.length < 30, `compressed as it goes (${t.pts.length} points)`);
  assert.equal(payOut(t, spool, [40, 0]).taut, true);
  const big = { pts: [[0, 0]], len: 0 }, ball = { left: 150 };
  for (let i = 0; i < 3000; i++) payOut(big, ball, [Math.cos(i / 40) * i * 0.05, Math.sin(i / 40) * i * 0.05]);
  assert.ok(big.len <= 150 + 1e-9 && ball.left >= 0);
});

// ---------------- badges / walkie / camera ----------------
test('badges: a seed is always the same wanderer, different seeds differ', () => {
  const a = wandererFor(77, content.lines), b = wandererFor(77, content.lines);
  assert.deepEqual(a, b);
  assert.ok(content.lines.wanderer_first.lines.includes(a.name.split(' ')[0]));
  assert.match(a.number, /^\d{4}$/);
  const names = new Set(Array.from({ length: 40 }, (_, i) => wandererFor(i, content.lines).name));
  assert.ok(names.size > 30);
});

test('walkie: hints walk through every line before repeating (seeded per run)', () => {
  const lines = content.lines.walkie_hints.lines;
  const seen = new Set(lines.map((_, i) => hintAt(lines, 5, i)));
  assert.equal(seen.size, lines.length);
  assert.equal(hintAt(lines, 5, lines.length), hintAt(lines, 5, 0));
  assert.notDeepEqual(lines.map((_, i) => hintAt(lines, 5, i)), lines.map((_, i) => hintAt(lines, 6, i)));
});

test('camera: about 1 in 6 photos has something extra, captions say so', () => {
  let extra = 0;
  for (let n = 1; n <= 600; n++) if (photoExtra(11, n)) extra++;
  assert.ok(extra > 70 && extra < 140, `${extra}/600`);
  assert.match(photoCaption(3, 'figure', 0, 'office'), /^#3, facing north, office\. There was nobody/);
});

// ---------------- evacuation maps + notebook reveal ----------------
test('evac map: samples the true layout around it; a quarter of the maps lie', () => {
  const layout = createWorldLayout({ worldSeed: 'demo', rooms: content.rooms, zoneAt: () => 'lobby' });
  const cells = sampleLayout(layout, 10, 6, 12);
  assert.equal(cells.length, 25 * 25);
  const grid = stitchCells(layout.layoutRegion(-1, -1, 2, 2), -1, -1, 2, 2);
  for (const [cx, cz, v] of cells) {
    const i = (cz - grid.oz) * grid.w + (cx - grid.ox);
    assert.equal(v, grid.walk[i] ? 1 : 2, `cell ${cx},${cz}`);
  }
  assert.ok(cells.some((c) => c[2] === 1) && cells.some((c) => c[2] === 2));
  let lies = 0;
  for (let k = 0; k < 400; k++) if (mapLies(8, `m${k}`)) lies++;
  assert.ok(lies > 70 && lies < 130, `${lies}/400`);
  const off = lieOffset(8, 'm1');
  assert.ok(Math.abs(off[0]) >= 32 && Math.abs(off[1]) >= 32, 'a lie comes from at least 4 blocks away');
  const lie = sampleLayout(layout, 10, 6, 12, off);
  assert.equal(lie.length, cells.length);
  assert.deepEqual(lie.map((c) => [c[0], c[1]]), cells.map((c) => [c[0], c[1]]), 'reported at the map\'s own cells');
  assert.notDeepEqual(lie.map((c) => c[2]), cells.map((c) => c[2]));
  assert.deepEqual(mapCell({ x: 5, z: 4.05 }, 0), [2, 1], 'one step out from the wall');
});

test('notebook map: revealed cells are remembered; seen cells that disagree become "?"', () => {
  const m = new SeenMap();
  const cells = [];
  for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) cells.push([x, z, x === 3 ? 2 : 1]);
  const v0 = m.version;
  m.reveal(cells, { id: 'evac:a', cx: 2, cz: 2, lie: true });
  assert.ok(m.version > v0);
  assert.equal(m.revealed.size, 36);
  assert.equal(m.reveal(cells, { id: 'evac:a' }).keys.length, 36, 'idempotent per map');
  assert.deepEqual(m.contradictions(), []);
  m.cells.set('3,1', 1);          // you walked through the "wall" it drew
  m.cells.set('0,0', 1);          // agrees
  assert.deepEqual(m.contradictions(), [[3, 1]]);
  assert.equal(m.revealsJSON()[0].cells.length, 36);
});
