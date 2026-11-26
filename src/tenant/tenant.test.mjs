// node --test src/tenant/
// The Tenant: threat → stage (+ Calm cap), minStage pool gating, the FSM (hysteresis, minimum
// state time), the core "never moves while seen" rule in scripted runs, glimpse placement,
// distractions (lure, flash), the director's stage-3 cycle and the cost of being caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import { validateContent } from '../../tools/validate.mjs';
import { eligible, expectedOdds, rollPool } from '../spawn/pools.js';
import { Rng } from '../core/rng.js';
import { threatFrom, stageFor, ThreatTracker, behaviourStage, UNLOCKS } from './threat.js';
import { TenantAI, ST } from './ai.js';
import { Director } from './director.js';
import { GridNav } from './nav.js';
import { findGlimpseSpot, visibleAt, standable, coneTest } from './perception.js';
import { applyCaught, pickDropSlot, smudgeMap, wakeBlock } from './caught.js';
import { SeenMap } from '../ui/diegetic/automap.js';

const { content } = loadContent();
const TC = content.config.tenant;

// ---------------------------------------------------------------- fake world
// rows of '#' (wall) and '.' (floor), one char per 2 m cell; outside the rows is solid
function fakeWorld(rows, { light = () => 0, aura = () => null } = {}) {
  const solid = (x, z) => {
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    return cz < 0 || cz >= rows.length || cx < 0 || cx >= rows[cz].length || rows[cz][cx] === '#';
  };
  return {
    isSolidAt: solid,
    wallBetween(a, b) {
      const dx = b.x - a.x, dz = b.z - a.z, n = Math.ceil(Math.hypot(dx, dz) / 0.25);
      for (let i = 1; i < n; i++) if (solid(a.x + (dx * i) / n, a.z + (dz * i) / n)) return true;
      return false;
    },
    lightAt: light,
    auraAt: aura,
  };
}
const room = (w, h) => Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) => (x === 0 || z === 0 || x === w - 1 || z === h - 1 ? '#' : '.')).join(''));
// a long east-west corridor, 1 cell wide (z cell 1), 40 cells long (80 m)
const corridor = (len = 40) => ['#'.repeat(len + 2), '#' + '.'.repeat(len) + '#', '#'.repeat(len + 2)];

const view = (x, z, yaw, pitch = 0) => ({ eye: { x, y: 1.6, z }, yaw, pitch, hHalf: 0.95, vHalf: 0.61 });
const EAST = -Math.PI / 2; // yaw looking down +x
const WEST = Math.PI / 2;

function makeAI(world, cfg = TC, seed = 7) {
  const fx = { calls: [] };
  const rec = (name) => (...a) => fx.calls.push(name);
  Object.assign(fx, { appear: rec('appear'), vanish: rec('vanish'), firstSight: rec('firstSight'), step: rec('step'), huntStart: rec('huntStart'), lose: rec('lose'), lure: rec('lure'), flashed: rec('flashed'), caught: rec('caught') });
  const ai = new TenantAI({ world, cfg, rng: new Rng(seed), fx });
  return { ai, fx };
}
function run(ai, sec, ctx, dt = 1 / 30, each = null) {
  for (let t = 0; t < sec; t += dt) { ai.update(dt, ctx); each?.(); }
}

// ---------------------------------------------------------------- threat → stage
test('threat: spine notes map to stages 0-2/3-5/6-8/9-12, bumps are small and capped', () => {
  const cfg = TC;
  const st = (n) => stageFor(threatFrom({ spine: n }, cfg), cfg);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(st), [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
  assert.equal(threatFrom({ spine: 2, badges: 1 }, cfg), 2.25);
  assert.equal(stageFor(threatFrom({ spine: 2, badges: 2, fuses: 1, evacMaps: 1 }, cfg), cfg), 1, 'story actions can tip a stage early');
  assert.equal(threatFrom({ spine: 0, badges: 40, photos: 99 }, cfg), cfg.bumpCap, 'bumps never replace the notes');
  assert.equal(stageFor(threatFrom({ badges: 40, photos: 99, fuses: 9 }, cfg), cfg), 0);
});

test('threat: the tracker only rises, unlocks each stage once, and Calm caps behaviour at stage 1', () => {
  const unlocked = {};
  const tr = new ThreatTracker(TC, unlocked);
  let r = tr.update({ spine: 4 });
  assert.equal(r.stage, 1);
  assert.deepEqual(r.unlocks.map((u) => u.id), ['tenant:sound']);
  r = tr.update({ spine: 7 });
  assert.equal(r.stage, 2);
  assert.deepEqual(r.unlocks.map((u) => u.id), UNLOCKS[2].map((u) => u.id));
  assert.ok(r.unlocks.some((u) => /flash stops it/i.test(u.caption)) && r.unlocks.some((u) => /like the light/i.test(u.caption)));
  r = tr.update({ spine: 1 });
  assert.equal(r.stage, 2, 'stages never go back down');
  assert.equal(r.unlocks.length, 0, 'no repeats');
  assert.deepEqual(Object.keys(unlocked), ['1', '2'], 'flags live in the run-state object');

  const calm = new ThreatTracker(TC, {});
  r = calm.update({ spine: 12 }, { calm: true });
  assert.equal(r.storyStage, 3, 'the story still moves on');
  assert.equal(r.stage, 1, 'Calm: behaviour capped at 1 (it never hunts)');
  assert.equal(new ThreatTracker({ ...TC, calm: true }, {}).update({ spine: 12 }).stage, 1, 'config.tenant.calm too');
  assert.equal(behaviourStage(3, false), 3);
});

// ---------------------------------------------------------------- minStage
test('pools: minStage gates entries on ctx.stage; stage 0 odds are unchanged', () => {
  const e = { def: 'flash_camera', w: 1, minStage: 2 };
  assert.equal(eligible(e, {}), false, 'no stage in ctx = stage 0');
  assert.equal(eligible(e, { stage: 1 }), false);
  assert.equal(eligible(e, { stage: 2 }), true);
  assert.equal(eligible(e, { stage: 3 }), true);

  const pools = content.pools;
  const odds = (id, stage) => expectedOdds(id, pools, { depth: 5, zone: 'lobby', stage, spawnedUnique: new Set() });
  // stage 0: identical to the pool with every minStage entry removed (rooms keep their old odds)
  for (const id of ['room_floor_litter', 'room_corner_loot', 'room_storage_shelf']) {
    const stripped = { ...pools, [id]: { ...pools[id], entries: pools[id].entries.filter((x) => x.minStage == null) } };
    const a = odds(id, 0), b = expectedOdds(id, stripped, { depth: 5, zone: 'lobby', stage: 0, spawnedUnique: new Set() });
    for (const [k, v] of b) assert.ok(Math.abs((a.get(k) ?? 0) - v) < 1e-12, `${id}: ${k} unchanged at stage 0`);
  }
  // stage 1: throwables and blank tapes become more common
  for (const id of ['soda_can', 'glass_bottle', 'blank_tape']) assert.ok((odds('room_floor_litter', 1).get(id) ?? 0) > (odds('room_floor_litter', 0).get(id) ?? 0), `${id} rises at stage 1`);
  // stage 2: light items rise and the flash camera appears
  for (const id of ['music_box', 'glow_stick', 'spare_tube']) assert.ok((odds('room_storage_shelf', 2).get(id) ?? 0) > (odds('room_storage_shelf', 1).get(id) ?? 0), `${id} rises at stage 2`);
  assert.equal(odds('room_camp', 1).get('flash_camera') ?? 0, 0, 'no camera in room pools before stage 2');
  assert.ok(odds('room_camp', 2).get('flash_camera') > 0);
  // and the roller agrees
  const rng = new Rng(3);
  let cams = 0;
  for (let i = 0; i < 3000; i++) cams += rollPool('room_camp', pools, rng, { depth: 5, zone: 'lobby', stage: 1 }).filter((x) => x === 'flash_camera').length;
  assert.equal(cams, 0);
});

test('validate: minStage must be a stage 0..3', () => {
  const bad = { ...content, pools: { ...content.pools, bad_stage: { id: 'bad_stage', entries: [{ def: 'soda_can', w: 1, minStage: 7 }] } } };
  const { errors } = validateContent(bad, {});
  assert.ok(errors.some((e) => /minStage/.test(e)), errors.join('\n'));
  const { errors: ok } = validateContent(content, {});
  assert.ok(!ok.some((e) => /minStage/.test(e)));
});

// ---------------------------------------------------------------- nav
test('nav: A* routes around walls, refuses walls / unreachable goals', () => {
  const w = fakeWorld([
    '##########',
    '#........#',
    '#.######.#',
    '#.#....#.#',
    '#.#.##.#.#',
    '#...##...#',
    '##########',
  ]);
  const nav = new GridNav(w.isSolidAt);
  const n = nav.findPath(3, 3, 7, 7); // (1,1) → (3,3) cell... into the pocket via the left side
  assert.ok(n > 0, 'found a path');
  for (let i = 0; i < n; i++) assert.ok(!w.isSolidAt(nav.pathX[i], nav.pathZ[i]), 'waypoints are walkable');
  assert.equal(nav.pathX[n - 1], 7); assert.equal(nav.pathZ[n - 1], 7);
  assert.equal(nav.findPath(3, 3, 5, 5), -1, 'goal inside a wall');
  const sealed = fakeWorld(['#####', '#.#.#', '#####']);
  assert.equal(new GridNav(sealed.isSolidAt).findPath(3, 3, 7, 3), -1, 'sealed off');
});

// ---------------------------------------------------------------- glimpse placement
test('glimpse: picks the far end of a long sightline, out of view, in line of sight', () => {
  const w = fakeWorld(corridor(40));
  // standing at the west end of the corridor facing the north wall: the corridor runs off to the side
  const v = view(3, 3, 0);
  const out = {};
  for (let seed = 1; seed < 20; seed++) {
    assert.ok(findGlimpseSpot(w, v, new Rng(seed), { minD: 25, maxD: 40, mode: 'side' }, out), `seed ${seed}`);
    assert.ok(out.d >= 25 && out.d <= 40, `distance ${out.d}`);
    assert.ok(out.d > 36, 'at the far end of the sightline (within maxD)');
    assert.ok(!w.wallBetween(v.eye, out), 'line of sight');
    assert.ok(standable(w, out.x, out.z), 'walkable');
    assert.ok(!visibleAt(w, v, out.x, out.z), 'not where you are looking (no pop-in)');
  }
  // facing down the corridor, 'side' mode won't put it in front of you
  assert.equal(findGlimpseSpot(w, view(3, 3, EAST), new Rng(1), { minD: 25, maxD: 40, mode: 'side' }, out), false);
  // facing away from it, 'behind' finds it in the back cone
  assert.ok(findGlimpseSpot(w, view(3, 3, WEST), new Rng(1), { minD: 15, maxD: 25, mode: 'behind', behindCone: 0.7 }, out));
  assert.ok(out.x > 15, 'behind you, down the corridor');
  // a small room has no long sightline
  assert.equal(findGlimpseSpot(fakeWorld(room(8, 8)), view(7, 7, 0), new Rng(1), { minD: 25, maxD: 40 }, out), false);
});

test('glimpse: stage 0 never approaches and blinks out on a direct look (0.6 s) or when you get close', () => {
  const w = fakeWorld(corridor(40));
  const { ai, fx } = makeAI(w);
  const v = view(3, 3, 0);
  const ctx = { view: v, px: 3, pz: 3, stage: 0, playing: true };
  assert.ok(ai.spawnGlimpse(v, 0));
  assert.equal(ai.state, ST.GLIMPSE);
  const x0 = ai.x, z0 = ai.z;
  run(ai, 20, ctx); // unseen for 20 s: it just stands there
  assert.equal(ai.state, ST.GLIMPSE);
  assert.deepEqual([ai.x, ai.z], [x0, z0], 'never approaches');
  // turn to look straight at it
  v.yaw = Math.atan2(-(ai.x - 3), -(ai.z - 3));
  run(ai, 0.4, ctx);
  assert.equal(ai.state, ST.GLIMPSE, 'not before ~0.6 s of looking');
  assert.ok(fx.calls.includes('firstSight'));
  run(ai, 0.4, ctx);
  assert.equal(ai.state, ST.DORMANT, 'gone after a direct look');
  assert.equal(ai.present, false);
  assert.ok(fx.calls.includes('vanish'));

  // closing in: gone within 15 m (look away so the look timer isn't the reason)
  const b = makeAI(w).ai;
  const c2 = { ...ctx, view: view(3, 3, 0) };
  assert.ok(b.spawnGlimpse(c2.view, 0));
  for (let x = 3; x < b.x && b.state === ST.GLIMPSE; x += 0.2) { c2.px = x; c2.view.eye.x = x; b.update(1 / 30, c2); }
  assert.equal(b.state, ST.DORMANT);
  assert.ok(Math.abs(b.x - c2.px) <= 15.2, 'vanished as you closed to 15 m');
});

// ---------------------------------------------------------------- FSM: hysteresis + minimum state time
test('fsm: minimum state time holds queued transitions; forced ones skip it', () => {
  const w = fakeWorld(room(20, 20));
  const { ai } = makeAI(w);
  const ctx = { view: view(5, 5, WEST), px: 5, pz: 5, stage: 2, playing: true };
  ai.place(30, 30, null);
  ai.change(ST.STALK, 'test');
  ai.queue(ST.LOSE, 'test');
  ai.update(0.1, ctx);
  assert.equal(ai.state, ST.STALK, 'too soon');
  run(ai, 0.45, ctx);
  assert.equal(ai.state, ST.LOSE, 'applied after the minimum time');
  ai.change(ST.STALK, 'test');
  ai.queue(ST.DORMANT, 'forced', true);
  ai.update(0.01, ctx);
  assert.equal(ai.state, ST.DORMANT, 'forced');
  // the first state went through change() (enter ran): the log starts with it
  assert.equal(ai.log[0].to, ST.DORMANT);
  assert.equal(ai.log[0].reason, 'start');
});

test('fsm: the stare meter fills inside 12 m, holds in the 12-14 m band, drains beyond; 3 s → hunt', () => {
  const w = fakeWorld(corridor(40));
  const { ai, fx } = makeAI(w);
  const v = view(3, 3, EAST);
  const ctx = { view: v, px: 3, pz: 3, stage: 2, playing: true };
  ai.place(3 + 13, 3, v);           // 13 m away, in view
  ai.change(ST.STALK, 'test');
  ai.stare = 1;
  run(ai, 2, ctx);
  assert.ok(Math.abs(ai.stare - 1) < 1e-9, `holds in the band (${ai.stare})`);
  ai.x = 3 + 11;                     // 11 m: fills
  run(ai, 1.5, ctx);
  assert.ok(ai.stare > 2.4 && ai.state === ST.STALK, `filling (${ai.stare})`);
  run(ai, 0.6, ctx);
  assert.equal(ai.state, ST.HUNT, 'stared at for 3 s → hunt');
  assert.ok(fx.calls.includes('huntStart'));

  // the hunt's lost-sight meter: needs ~6 s without line of sight, regaining it drains it
  const b = makeAI(fakeWorld(['##########', '#........#', '#.######.#', '#........#', '##########'])).ai;
  const c = { view: view(3, 3, 0), px: 3, pz: 3, stage: 2, playing: true, canCatch: false };
  b.place(15, 7, null); b.change(ST.HUNT, 'test');
  b.lostFor = 5.5; b.bb.losToPlayer = true;
  b.x = 11; b.z = 7; // around the wall from you, no line of sight
  run(b, 0.3, c);
  assert.equal(b.state, ST.HUNT, `not yet (${b.lostFor})`);
  run(b, 0.4, c);
  assert.equal(b.state, ST.LOSE, 'lost you after ~6 s out of sight');
});

// ---------------------------------------------------------------- the core rule
test('never moves while seen: a scripted hunt with the player turning around', () => {
  const w = fakeWorld(corridor(40));
  const { ai } = makeAI(w);
  const v = view(3, 3, EAST);
  const ctx = { view: v, px: 3, pz: 3, stage: 2, playing: true, canCatch: false };
  ai.forceHunt(v, 3, 3);
  ai.place(30, 3, v);
  ai.goalKind = 'player';
  ai.change(ST.HUNT, 'test');
  ai.left = 1e9;
  // look at it for 3 s: not a centimetre
  const x0 = ai.x;
  run(ai, 3, ctx);
  assert.equal(ai.x, x0, 'frozen while seen');
  // turn your back: it comes
  v.yaw = WEST;
  run(ai, 1.5, ctx);
  assert.ok(ai.x < x0 - 3, `moved while unseen (${x0} → ${ai.x})`);
  // turn back: frozen again
  v.yaw = EAST;
  ai.update(1 / 30, ctx);
  const x1 = ai.x;
  run(ai, 2, ctx);
  assert.equal(ai.x, x1, 'frozen again the moment you look');

  // stress: the player turns and walks about; check every frame independently
  const b = makeAI(fakeWorld(room(24, 16)), TC, 11).ai;
  const vb = view(10, 10, 0);
  const cb = { view: vb, px: 10, pz: 10, stage: 3, playing: true, canCatch: false };
  b.place(40, 26, vb); b.goalKind = 'player'; b.change(ST.HUNT, 'test'); b.left = 1e9; b.lostFor = -1e9;
  let moves = 0;
  for (let f = 0; f < 30 * 40; f++) {
    const t = f / 30;
    vb.yaw = t * 0.9 + Math.sin(t * 2.3) * 1.2;
    cb.px = vb.eye.x = 18 + Math.sin(t * 0.4) * 8;
    cb.pz = vb.eye.z = 16 + Math.cos(t * 0.3) * 6;
    const seenBefore = visibleAt(b.world, vb, b.x, b.z, 2.4, 0.35);
    const bx = b.x, bz = b.z;
    b.update(1 / 30, cb);
    const moved = bx !== b.x || bz !== b.z;
    if (moved) moves++;
    assert.ok(!(seenBefore && moved), `moved while seen at frame ${f}`);
    if (moved) assert.ok(!visibleAt(b.world, vb, b.x, b.z, 2.4, 0.35), `stepped into view at frame ${f}`);
  }
  assert.ok(moves > 30, `it did hunt (${moves} moving frames)`);
});

test('caught: only while unseen, only when allowed (stage ≥ 2, not Calm)', () => {
  const w = fakeWorld(corridor(40));
  const setup = (canCatch, yaw) => {
    const { ai, fx } = makeAI(w);
    const v = view(3, 3, yaw);
    ai.place(9, 3, null); ai.goalKind = 'player'; ai.change(ST.HUNT, 'test'); ai.left = 1e9;
    run(ai, 4, { view: v, px: 3, pz: 3, stage: 2, playing: true, canCatch });
    return { ai, fx };
  };
  const back = setup(true, EAST + Math.PI);
  assert.ok(back.fx.calls.includes('caught'), 'reached you from behind');
  assert.equal(back.ai.state, ST.DORMANT);
  assert.ok(!setup(false, EAST + Math.PI).fx.calls.includes('caught'), 'not in Calm / below stage 2');
  const watched = setup(true, EAST);
  assert.ok(!watched.fx.calls.includes('caught'), 'not while you watch it');
  assert.ok(watched.ai.x > 8.9, 'and it never moved');
});

// ---------------------------------------------------------------- distractions
test('distractions: a lure pulls a stalker to the noise; a loud noise of yours starts a hunt', () => {
  const w = fakeWorld(corridor(40));
  const { ai, fx } = makeAI(w);
  const v = view(3, 3, WEST);
  const ctx = { view: v, px: 3, pz: 3, stage: 2, playing: true };
  ai.place(20, 3, null); ai.change(ST.STALK, 'test');
  run(ai, 0.6, ctx);
  ai.hear({ x: 40, y: 0, z: 3, loudness: 25, source: 'tape_lure' });
  run(ai, 0.6, ctx);
  assert.equal(ai.state, ST.HUNT);
  assert.equal(ai.goalKind, 'lure');
  assert.ok(fx.calls.includes('lure'));
  run(ai, 8, ctx);
  assert.ok(ai.x > 30 || ai.state !== ST.HUNT, `went to the noise, away from you (x ${ai.x})`);

  // too far to hear: ignored (hearing radius = loudness)
  const b = makeAI(w).ai;
  b.place(20, 3, null); b.change(ST.STALK, 'test');
  run(b, 0.6, ctx);
  b.hear({ x: 60, y: 0, z: 3, loudness: 10, source: 'impact:soda_can' });
  run(b, 0.2, ctx);
  assert.equal(b.state, ST.STALK);
  // your own sprinting (8 m) within earshot: hunt you
  b.hear({ x: 3, y: 0, z: 3, loudness: 8, source: 'footstep' });
  run(b, 0.6, { ...ctx, px: 3, pz: 3 });
  assert.equal(b.state, ST.STALK, '17 m away: sprint steps not heard');
  b.x = 8;
  b.hear({ x: 3, y: 0, z: 3, loudness: 8, source: 'footstep' });
  run(b, 0.2, ctx);
  assert.equal(b.state, ST.HUNT);
  assert.equal(b.goalKind, 'player');

  // stage 1: a lure makes a glimpse leave (once unseen); it never hunts
  const g = makeAI(w).ai;
  const vg = view(3, 3, 0);
  g.spawnGlimpse(vg, 1);
  g.hear({ x: 70, y: 0, z: 3, loudness: 60, source: 'tape_lure' });
  run(g, 1, { view: vg, px: 3, pz: 3, stage: 1, playing: true });
  assert.equal(g.state, ST.DORMANT);
});

test('distractions: the flash freezes it for 3 s at stage 2, then it retreats', () => {
  const w = fakeWorld(corridor(40));
  const { ai, fx } = makeAI(w);
  const v = view(3, 3, WEST); // back turned: it would be moving
  const ctx = { view: v, px: 3, pz: 3, stage: 2, playing: true, canCatch: true };
  ai.place(14, 3, null); ai.goalKind = 'player'; ai.change(ST.HUNT, 'test'); ai.left = 1e9;
  run(ai, 0.6, ctx);
  assert.ok(ai.flash({ x: 3, y: 1.6, z: 3 }, { x: 1, y: 0, z: 0 }), 'aimed at it');
  const x0 = ai.x;
  run(ai, 2.8, ctx);
  assert.equal(ai.x, x0, 'frozen even unseen');
  assert.ok(fx.calls.includes('flashed'));
  run(ai, 0.5, ctx);
  assert.ok(ai.state === ST.LOSE || ai.state === ST.DORMANT, `retreats (${ai.state})`);
  // aimed away: nothing
  const b = makeAI(w).ai;
  b.place(14, 3, null); b.change(ST.STALK, 'test'); b.stage = 2;
  assert.equal(b.flash({ x: 3, y: 1.6, z: 3 }, { x: -1, y: 0, z: 0 }), false);
});

test('light and calm auras end a hunt from stage 2 (with a hold time)', () => {
  let lit = 0;
  const w = fakeWorld(corridor(40), { light: () => lit });
  const { ai } = makeAI(w);
  const v = view(3, 3, EAST);
  const ctx = { view: v, px: 3, pz: 3, stage: 2, playing: true };
  ai.place(20, 3, v); ai.goalKind = 'player'; ai.change(ST.HUNT, 'test'); ai.left = 1e9;
  run(ai, 2, ctx);
  assert.equal(ai.state, ST.HUNT);
  lit = 0.7; // under a working tube
  run(ai, 0.6, ctx);
  assert.equal(ai.state, ST.HUNT, 'not on a single flicker');
  run(ai, 1, ctx);
  assert.equal(ai.state, ST.LOSE, 'gave up in the light');
});

// ---------------------------------------------------------------- director
test('director: stage 3 cycles calm → stalk → forced hunt → guaranteed quiet', () => {
  const d = new Director(TC.director, new Rng(5));
  const ai = { state: ST.DORMANT, present: false, bb: { dist: 20, seen: false } };
  let cmd = null, t = 0;
  while (!cmd && t < 200) { cmd = d.update(0.1, ai, 3); t += 0.1; }
  assert.equal(cmd, 'stalk');
  assert.ok(t >= TC.director.calm3[0] * TC.director.firstGap - 0.2, `calm first (${t.toFixed(1)} s)`);
  ai.state = ST.STALK; ai.present = true;
  cmd = null; t = 0;
  while (!cmd && t < 200) { cmd = d.update(0.1, ai, 3); t += 0.1; }
  assert.equal(cmd, 'hunt');
  assert.ok(t >= TC.director.stalk3[0] - 0.2 && t <= TC.director.stalk3[1] + 0.2, `stalk phase ${t.toFixed(1)} s`);
  ai.state = ST.HUNT; ai.bb.dist = 4;
  for (let i = 0; i < 30; i++) d.update(0.1, ai, 3);
  assert.ok(d.tension > 0.8, `hunt tension ${d.tension}`);
  ai.state = ST.DORMANT; ai.present = false;
  cmd = null; t = 0;
  while (!cmd && t < 300) { cmd = d.update(0.1, ai, 3); t += 0.1; }
  assert.ok(t >= TC.director.afterHunt[0] - 0.2, `quiet after the hunt (${t.toFixed(1)} s)`);
  assert.ok(d.tension < 0.1, 'tension fell off');
  // stage 0: glimpses only, minutes apart
  const d0 = new Director(TC.director, new Rng(9));
  const idle = { state: ST.DORMANT, present: false, bb: { dist: 99, seen: false } };
  d0.update(0.1, idle, 0); // first one comes sooner (firstGap)
  d0.wait = 0.05;
  assert.equal(d0.update(0.1, idle, 0), 'glimpse');
  idle.state = ST.GLIMPSE; idle.present = true; d0.update(0.1, idle, 0);
  idle.state = ST.DORMANT; idle.present = false; d0.update(0.1, idle, 0);
  assert.ok(d0.wait >= TC.director.gap[0][0] - 1, `next glimpse in ${d0.wait.toFixed(0)} s`);
});

// ---------------------------------------------------------------- caught
test('caught: sanity −0.35, one pocket item dropped at the spot, 40% of the map forgotten', () => {
  const stacks = [{ id: 'battery' }, null, { id: 'music_box' }, null];
  const big = { id: 'av_tape' };
  const inventory = { slots: [stacks[0], big, big, stacks[2]], remove(i) { const s = this.slots[i]; for (let k = 0; k < 4; k++) if (this.slots[k] === s) this.slots[k] = null; return s; } };
  const map = new SeenMap();
  for (let i = 0; i < 400; i++) map.cells.set(`${i % 20},${(i / 20) | 0}`, 1);
  const stats = { sanity: 0.8 };
  const drops = [];
  const res = applyCaught({ inventory, stats, map, rng: new Rng(4), pos: { x: 5, y: 0, z: 6 }, dropAt: (s, p) => drops.push([s.id, p]) }, TC.caught);
  assert.equal(res.ended, false);
  assert.ok(Math.abs(stats.sanity - 0.45) < 1e-9);
  assert.equal(drops.length, 1);
  assert.deepEqual(drops[0][1], { x: 5, y: 0, z: 6 }, 'dropped where you were caught');
  assert.equal(inventory.slots.filter(Boolean).length, drops[0][0] === 'av_tape' ? 2 : 3, 'exactly one item left your pockets');
  assert.ok(res.forgotten > 120 && res.forgotten < 200, `forgot ${res.forgotten} of 400`);
  assert.equal(map.cells.size, 400 - res.forgotten);
  // the map's own save format round-trips through the smudge
  assert.equal(smudgeMap(map, 0, new Rng(1)), 0);
  // an empty pocket set is fine
  assert.equal(pickDropSlot({ slots: [null, null] }, new Rng(1)), -1);
});

test('caught: below 0.1 sanity the run ends instead (nothing else happens)', () => {
  const inventory = { slots: [{ id: 'battery' }], remove() { throw new Error('should not drop'); } };
  const map = new SeenMap();
  map.cells.set('1,1', 1);
  const stats = { sanity: 0.08 };
  const res = applyCaught({ inventory, stats, map, rng: new Rng(1), pos: { x: 0, y: 0, z: 0 } }, TC.caught);
  assert.equal(res.ended, true);
  assert.equal(stats.sanity, 0.08);
  assert.equal(map.cells.size, 1);
});

test('caught: wake-up block is 6-15 blocks away', () => {
  const rng = new Rng(2);
  for (let i = 0; i < 200; i++) {
    const b = wakeBlock(3, -4, rng, TC.caught.wakeBlocks);
    const d = Math.hypot(b.bx - 3, b.bz + 4);
    assert.ok(d >= 6 - 1 && d <= 15 + 1, `${d}`);
  }
});

test('perception: the cone test respects pitch (looking at the floor/ceiling) and width', () => {
  const out = {};
  assert.equal(coneTest(view(0, 0, 0), 0, -10, 2.4, 0.35, out), true);
  assert.equal(coneTest(view(0, 0, Math.PI), 0, -10, 2.4, 0.35, out), false, 'behind');
  assert.equal(coneTest(view(0, 0, 0, 1.4), 0, -10, 2.4, 0.35, out), false, 'looking straight up');
  assert.equal(coneTest(view(0, 0, 0, -1.4), 0, -1, 2.4, 0.35, out), true, 'at your feet while looking down');
});
