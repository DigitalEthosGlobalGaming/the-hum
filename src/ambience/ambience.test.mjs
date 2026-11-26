// node --test src/ambience/
// Environmental audio: the pure parts (acoustics from a grid, occlusion cell counting, emitter
// pooling/assignment, distant-event director, room scan) and the system inside a headless World
// with a recording fake synth.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import { AcousticsEstimator } from './acoustics.js';
import { wallCells, occlusionAmount, occlusionParams } from './occlusion.js';
import { nearestK, assignSlots, Pool } from './pool.js';
import { AudioDirector, DISTANT_KINDS } from './director.js';
import { scanRoom } from './emitters.js';
import { AmbienceSystem, dripGap } from './system.js';
import { Rng } from '../core/rng.js';
import { Events } from '../core/events.js';
import '../extensions.js';
import { World } from '../world/world.js';

const { content } = loadContent();

// grid helper: rows of '#' (solid) and '.' (open); everything outside is solid
function grid(rows) {
  return (cx, cz) => cz < 0 || cz >= rows.length || cx < 0 || cx >= rows[cz].length || rows[cz][cx] === '#';
}
const box = (w, h) => Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) => (x === 0 || z === 0 || x === w - 1 || z === h - 1 ? '#' : '.')).join(''));
const argmax = (a) => a.indexOf(Math.max(...a));

// ---------------- acoustics ----------------
test('acoustics: a cupboard is small, open floor is a hall, a long narrow run is a corridor', () => {
  const est = new AcousticsEstimator(12);
  const small = est.estimate(grid(box(5, 5)), 2, 2);
  assert.equal(small.cells, 9);
  assert.equal(argmax(small.weights), 0, `small room weights ${small.weights}`);
  assert.ok(small.sends.sfx < 0.6, 'small rooms keep footsteps dry');

  const hall = new AcousticsEstimator(12).estimate(grid(box(40, 40)), 20, 20);
  assert.equal(argmax(hall.weights), 1, `hall weights ${hall.weights}`);
  assert.ok(hall.size > 0.9 && hall.sends.sfx > 1.3, 'big halls are washy');

  const corr = new AcousticsEstimator(12).estimate(grid(box(40, 3)), 20, 1);
  assert.equal(argmax(corr.weights), 2, `corridor weights ${corr.weights} (width ${corr.width}, len ${corr.length}, elong ${corr.elong})`);
  assert.ok(corr.elong > 0.8);

  for (const r of [small, hall, corr]) assert.ok(Math.abs(r.weights.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'weights sum to 1');
});

test('acoustics: flood fill walks round walls (path distance), stays inside the radius, reuses its result', () => {
  const rows = [
    '#########',
    '#...#...#',
    '#...#...#',
    '#.......#',
    '#########',
  ];
  const est = new AcousticsEstimator(12);
  const r1 = est.estimate(grid(rows), 1, 1);
  // (5,1) is 4 cells east but the wall forces a detour down through row 3
  const straight = 4 * 2;
  assert.ok(est.pathDistance(5, 1) > straight + 1, `detour ${est.pathDistance(5, 1)}`);
  assert.equal(est.pathDistance(4, 1), Infinity, 'walls are not reached');
  assert.equal(est.pathDistance(1, 1), 0);
  const r2 = est.estimate(grid(box(5, 5)), 2, 2);
  assert.equal(r1, r2, 'same result object (no allocation per estimate)');
  // radius cap: a 60-cell open floor only counts cells within 6 cells of walking distance
  const big = new AcousticsEstimator(12).estimate(() => false, 0, 0);
  assert.ok(big.cells === est.discCells && big.size === 1, `cells ${big.cells} of ${est.discCells}`);
  // standing in a wall cell is a tight space, not a crash
  assert.equal(argmax(new AcousticsEstimator(12).estimate(() => true, 0, 0).weights), 0);
});

// ---------------- occlusion ----------------
test('occlusion: wallCells counts the solid cells crossed, not the ends', () => {
  const rows = [
    '..........',
    '....#.....',
    '....##....',
    '....###...',
  ];
  const solid = grid(rows);
  // row 0 is open end to end
  assert.equal(wallCells(solid, 1, 1, 19, 1), 0);
  // row 1 crosses one wall cell, row 3 crosses three
  assert.equal(wallCells(solid, 1, 3, 19, 3), 1);
  assert.equal(wallCells(solid, 1, 7, 19, 7), 3);
  assert.equal(wallCells(solid, 19, 7, 1, 7), 3, 'symmetric');
  assert.equal(wallCells(solid, 1, 7, 3, 7), 0, 'same / neighbouring open cell');
  assert.equal(wallCells(solid, 1, 7, 19, 7, 2, 2), 2, 'capped');
  // the end cells don't count even when solid (a source inside a pillar still sounds)
  assert.equal(wallCells(solid, 9, 3, 1, 3), 0);
  // diagonal through the staircase: (1,1) → (13,7) crosses some of the block
  const d = wallCells(solid, 1, 1, 13, 7);
  assert.ok(d >= 1 && d <= 4, `diagonal ${d}`);
  // out-of-grid space counts as solid (unbuilt rooms muffle distant events)
  assert.ok(wallCells(solid, 1, 1, 1, 30) >= 10);
});

test('occlusion: amount follows walls, softened by an open detour; params get darker and quieter', () => {
  assert.equal(occlusionAmount(0, 10, 10), 0);
  assert.equal(occlusionAmount(2, Infinity, 10), 2, 'no path known: walls count');
  assert.equal(occlusionAmount(2, 10, 10), 0, 'open path as short as the line (doorway): not occluded');
  assert.equal(occlusionAmount(2, 16, 10), 1, 'six metres of detour = one wall');
  assert.equal(occlusionAmount(1, 40, 10), 1, 'never more than the wall count');
  let prev = occlusionParams(0);
  assert.deepEqual({ ...prev }, { cutoff: 22000, gain: 1 });
  for (const a of [0.5, 1, 2, 3, 6, 20]) {
    const p = { ...occlusionParams(a) };
    assert.ok(p.cutoff <= prev.cutoff && p.gain <= prev.gain && (a > 3 || p.cutoff < prev.cutoff), `monotonic at ${a}`);
    assert.ok(p.cutoff >= 280 && p.gain >= 10 ** (-20 / 20) - 1e-9, 'floors hold');
    prev = p;
  }
  assert.ok(Math.abs(occlusionParams(1).cutoff - 1538) < 2, 'one wall ≈ 1.5 kHz');
});

// ---------------- pooling ----------------
test('nearestK: same as sorting, without allocating', () => {
  const rng = new Rng(5);
  const cands = Array.from({ length: 60 }, () => ({ x: rng.range(-30, 30), z: rng.range(-30, 30) }));
  const out = [];
  nearestK(cands, cands.length, 0, 0, 6, 20, out);
  const ref = cands.filter((c) => Math.hypot(c.x, c.z) <= 20).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 6);
  assert.deepEqual(out, ref);
  const same = out;
  nearestK(cands, 10, 0, 0, 3, 100, out);
  assert.equal(out, same, 'writes into the given array');
  assert.equal(out.length, 3);
  nearestK(cands, cands.length, 1000, 1000, 6, 5, out);
  assert.equal(out.length, 0, 'nothing in range');
});

test('assignSlots: keeps what is still wanted, moves the fewest slots', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const slots = Array.from({ length: 3 }, () => ({ target: null }));
  const moves = [];
  const onChange = (s, prev) => moves.push([s.target?.id ?? null, prev?.id ?? null]);
  assert.equal(assignSlots(slots, [a, b, c], onChange), 3);
  const before = slots.map((s) => s.target);
  moves.length = 0;
  // c drops out, d comes in: exactly one slot moves (the one that held c), a and b stay put
  assert.equal(assignSlots(slots, [b, a, d], onChange), 1);
  assert.deepEqual(moves, [['d', 'c']]);
  assert.equal(slots[0].target, before[0]);
  assert.equal(slots[1].target, before[1]);
  // more wanted than slots (callers pass at most one per slot): held targets stay, nothing overflows
  moves.length = 0;
  assert.equal(assignSlots(slots, [e, a, b, d], onChange), 0);
  assert.ok(slots.every((s) => s.target) && !slots.some((s) => s.target === e));
  // fewer wanted: spare slots go silent (target null) and report it
  moves.length = 0;
  assignSlots(slots, [a], onChange);
  assert.equal(slots.filter((s) => s.target).length, 1);
  assert.equal(moves.filter(([to]) => to === null).length, 2);
  // unchanged set: no moves
  moves.length = 0;
  assert.equal(assignSlots(slots, [a], onChange), 0);
});

test('Pool: recycles records', () => {
  const pool = new Pool(() => ({ v: 0 }), (r) => { r.v = 0; });
  const a = pool.acquire(); a.v = 9;
  const b = pool.acquire();
  pool.release(a);
  const c = pool.acquire();
  assert.equal(c, a);
  assert.equal(c.v, 0, 'reset on reuse');
  assert.equal(pool.made, 2);
  assert.equal(pool.live, 2);
  pool.release(b); pool.release(c);
  assert.equal(pool.live, 0);
});

// ---------------- director ----------------
test('director: seeded, rare, intensity brings events sooner, never the same kind twice running', () => {
  const run = (seed, intensity, secs) => {
    const d = new AudioDirector(seed, { intensity, distantFirst: 40 });
    const got = [];
    for (let t = 0; t < secs; t += 0.1) { const k = d.tick(0.1); if (k) got.push([Math.round(t), k]); }
    return got;
  };
  assert.deepEqual(run(42, 0, 1200), run(42, 0, 1200), 'deterministic per seed');
  const calm = run(42, 0, 1800).length, tense = run(42, 1, 1800).length;
  assert.ok(calm >= 10 && calm <= 40, `calm: ${calm} events in 30 min`);
  assert.ok(tense > calm * 2, `tense: ${tense} vs calm ${calm}`);
  const kinds = run(7, 0.5, 3600).map(([, k]) => k);
  for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1]);
  assert.ok(DISTANT_KINDS.every((k) => kinds.includes(k)), 'every kind shows up');

  const d = new AudioDirector(1, {});
  assert.equal(d.tick(1, false), null, 'paused: clock does not move');
  assert.equal(d.clock, 0);
  d.trigger('door');
  assert.equal(d.tick(0.1, true, true), null, 'busy holds it back');
  assert.equal(d.tick(0.1), 'door');
  const left = d.next;
  d.intensity = 1;
  assert.ok(d.next <= left, 'raising intensity never pushes the next event away');
  d.intensity = 7;
  assert.equal(d.intensity, 1, 'clamped');
  // drip gaps: mostly a slow irregular beat, some doubles, some long pauses
  const r = new Rng(3);
  const gaps = Array.from({ length: 2000 }, () => dripGap(r));
  assert.ok(gaps.some((g) => g < 0.4) && gaps.some((g) => g > 7) && gaps.every((g) => g > 0.1 && g < 17));
});

// ---------------- room scan ----------------
test('scanRoom: one leak per spot, seeded vents on open non-fixture cells', () => {
  const at = (id, x, z) => ({ id, root: { position: { x, y: 0, z } } });
  const placed = {
    key: 'h:1,0',
    objects: [at('decor_leak', 5, 5), at('decor_ceiling_stain', 5.4, 5.2), at('decor_water_stain', 12, 3), at('office_desk', 1, 1)],
    json: { materials: { ceiling: 'ceiling_large' } },
    built: { grid: { w: 8, h: 8, ox: 0, oz: 0, solid: new Uint8Array(64) }, lights: [{ cell: [1, 1] }] },
  };
  const out = [];
  const n = scanRoom(placed, 9, { ventsPerRoom: [1, 2] }, (k, x, y, z) => out.push([k, x, y, z]));
  assert.equal(n.leaks, 2);
  assert.ok(n.vents >= 1 && n.vents <= 2);
  const again = [];
  scanRoom(placed, 9, { ventsPerRoom: [1, 2] }, (k, x, y, z) => again.push([k, x, y, z]));
  assert.deepEqual(again, out, 'seeded');
  for (const [k, x, y, z] of out.filter(([k]) => k === 'vent')) {
    assert.ok(y > 2.5, 'vents are in the ceiling');
    assert.ok(!(Math.floor(x / 2) === 1 && Math.floor(z / 2) === 1), 'not on a light fixture');
  }
  placed.json.materials.ceiling = 'ceiling_medium_vent';
  const vents = [];
  scanRoom(placed, 9, {}, (k) => k === 'vent' && vents.push(k));
  assert.ok(vents.length >= 2, 'a vent ceiling has several');
});

// ---------------- the system in a headless world ----------------
function fakeSynth() {
  return {
    ctx: {}, opts: { maxVoices: 24 }, playHooks: [], voices: [], listenerPos: null, plays: [], bus: {}, acoustics: null,
    get voiceCount() { return this.voices.filter((v) => !v.stopped).length; },
    play(id, opts = {}) {
      const v = {
        id, p: { layers: [] }, pos: opts.position ? { x: opts.position.x, y: opts.position.y, z: opts.position.z } : null,
        vol: opts.volume ?? 1, playing: true, stopped: false, occFilter: opts.position ? {} : null, occ: null, delay: opts.delay ?? 0,
        setVolume(x) { this.vol = x; }, setPosition(p) { this.pos = { x: p.x, y: p.y, z: p.z }; },
        setOcclusion(cutoff, gain) { this.occ = { cutoff, gain }; }, stop() { this.stopped = true; this.playing = false; },
      };
      this.voices.push(v);
      this.plays.push(v);
      for (const fn of this.playHooks) fn(v, id, opts);
      return v;
    },
    setAcoustics(w, sends) { this.acoustics = { w: [...w], sends: { ...sends } }; },
    setBusGain(bus, g) { this.bus[bus] = g; },
    meterPeak() { return 0; },
  };
}

function makeGame(seed = 1234567) {
  const events = new Events();
  const world = new World({ content, textures: { get: () => new THREE.Texture() }, scene: new THREE.Scene(), audio: null, seed, events });
  const { pos } = world.start();
  world.power.running = true;
  const synth = fakeSynth();
  const game = { world, synth, events, seed, content, playing: true, paused: false, player: { pos }, diegetic: { reading: false } };
  const sys = new AmbienceSystem(game);
  world.addSystem(sys);
  const camera = new THREE.PerspectiveCamera();
  const ctx = { camera, time: 0, player: game.player };
  const sync = () => { camera.position.set(game.player.pos.x, 1.6, game.player.pos.z); synth.listenerPos = { x: camera.position.x, y: 1.6, z: camera.position.z }; };
  const step = (sec, dt = 0.05) => { for (let s = 0; s < sec; s += dt) { sync(); ctx.time += dt; world.update(dt, ctx); } };
  const goto = (x, z) => { game.player.pos = new THREE.Vector3(x, 0, z); sync(); world.stream(game.player.pos, { sync: true }); };
  sync();
  return { game, world, synth, sys, step, goto, pos };
}

const humOf = (synth) => synth.plays.filter((v) => v.id === 'fluoro_hum_unit');

test('system: hum emitters sit on the nearest working fixtures, pooled across movement', () => {
  const { world, synth, sys, step, goto, pos } = makeGame();
  step(0.6);
  assert.equal(humOf(synth).length, 6, 'six pooled hum loops');
  assert.equal(synth.plays.filter((v) => v.id === 'room_tone').length, 1, 'one room tone');
  const held = sys.humSlots.filter((s) => s.target);
  assert.ok(held.length >= 2, `hum emitters assigned (${held.length})`);
  const lp = synth.listenerPos;
  const working = sys.fixtures.filter((r) => AmbienceSystem.working(r))
    .map((r) => [r, Math.hypot(r.x - lp.x, r.z - lp.z)]).filter(([, d]) => d <= sys.cfg.humRange).sort((a, b) => a[1] - b[1]).slice(0, 6).map(([r]) => r);
  for (const s of held) {
    assert.notEqual(s.target.light.cond, 'dead', 'dead fixtures are silent');
    assert.ok(working.includes(s.target), 'one of the six nearest working fixtures');
    assert.deepEqual(s.h.pos, { x: s.target.x, y: s.target.y, z: s.target.z }, 'voice sits on its fixture');
    assert.ok(s.h.vol > 0, 'audible');
  }
  // the acoustics + env mix were set
  assert.ok(synth.acoustics && synth.acoustics.w.length === 3);
  assert.equal(synth.bus.env, 1);

  // walk 60 m away and back: slots re-assign, no new hum voices, records are recycled
  const madeBefore = sys.records.made;
  goto(pos.x + 60, pos.z);
  step(1);
  goto(pos.x, pos.z);
  step(1);
  assert.equal(humOf(synth).length, 6, 'no new hum voices while moving');
  assert.equal(sys.records.free.length + sys.records.live, sys.records.made, 'pool accounting');
  const inRooms = [...sys.byRoom.values()].reduce((n, l) => n + l.length, 0);
  assert.equal(sys.records.live, inRooms, 'every live record belongs to a loaded room');
  assert.ok(sys.records.made < madeBefore * 2.5, `records reused (made ${madeBefore} → ${sys.records.made})`);
  assert.equal(world.rooms.size, sys.byRoom.size, 'one record list per loaded room');
});

test('system: switching a room off kills its hum (with a sound); occlusion applies to new voices at once', () => {
  const { world, synth, sys, step, pos } = makeGame();
  step(0.6);
  const here = world.roomAt(pos.x, pos.z);
  world.power.toggleSwitch(pos); // off
  step(0.4);
  assert.ok(synth.plays.some((v) => v.id === 'hum_kill'), 'power-down sound');
  for (const s of sys.humSlots) assert.ok(!s.target || s.target.placed !== here, 'no hum from the switched-off room');
  world.power.toggleSwitch(pos); // on again
  step(0.4);
  assert.ok(synth.plays.some((v) => v.id === 'hum_surge'), 'power-up sound');
  assert.ok(sys.humSlots.some((s) => s.target?.placed === here), 'hum back in the room');

  // a sound 30 m away through unbuilt/walled space starts muffled; one right here doesn't
  const far = synth.play('far_thud', { position: { x: pos.x + 400, y: 1, z: pos.z } });
  assert.ok(far.occ && far.occ.cutoff < 2000 && far.occ.gain < 0.5, `far voice occluded at once ${JSON.stringify(far.occ)}`);
  const near = synth.play('drip', { position: { x: pos.x + 0.3, y: 0, z: pos.z } });
  assert.ok(!near.occ || near.occ.cutoff === 22000, 'nothing in the way');
});

test('system: duck while reading, fade on pause; distant events and answering footsteps', () => {
  const { game, synth, sys, step } = makeGame();
  step(0.2);
  game.diegetic.reading = true;
  step(0.1);
  assert.ok(Math.abs(synth.bus.env - 10 ** (-10 / 20)) < 1e-6, `ducked ${synth.bus.env}`);
  game.diegetic.reading = false;
  game.paused = true;
  step(0.1);
  assert.equal(synth.bus.env, sys.cfg.pausedLevel);
  game.paused = false;
  step(0.1);
  assert.equal(synth.bus.env, 1);

  game.audioDirector = sys.director;
  game.audioDirector.trigger('door');
  step(0.1);
  const door = synth.plays.find((v) => v.id === 'far_door');
  const lp = synth.listenerPos;
  const d = Math.hypot(door.pos.x - lp.x, door.pos.z - lp.z);
  assert.ok(d >= 19 && d <= 33, `far away (${d.toFixed(1)} m)`);
  assert.ok(door.occ && door.occ.gain < 1, 'and occluded');

  sys.director.trigger('steps');
  step(2.5);
  const own = synth.plays.filter((v) => v.id === 'far_step').length;
  assert.ok(own >= 2, `it takes a few steps of its own (${own})`);
  // it answers your steps ...
  for (let i = 0; i < 4; i++) { game.events.emit('player:step', { intensity: 1 }); step(0.5); }
  const answered = synth.plays.filter((v) => v.id === 'far_step').length - own;
  assert.ok(answered >= 4, `answers each step (${answered})`);
  // ... and stops when you stop (at most one late step)
  const before = synth.plays.filter((v) => v.id === 'far_step').length;
  step(15);
  assert.ok(synth.plays.filter((v) => v.id === 'far_step').length - before <= 1);
  assert.equal(sys.steps, null, 'event over');
});
