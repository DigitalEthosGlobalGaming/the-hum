// node --test src/power/
// Power network: the pure light-state model, timed effects, and the network running inside a real
// World (headless: fake textures, no renderer).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import {
  rollFixture, fixtureOutput, resolveRoom, toggleCircuits, powerCircuits, circuitOf, darkness, DEFAULTS, roomRecord,
} from './lightModel.js';
import { TimedEffects } from './timed.js';
import '../extensions.js'; // register feature prefabs/painters (decor, physics, power) like main.js does
import { World } from '../world/world.js';
import './register.js'; // prefabs (as src/extensions.js does in the game)

const { content } = loadContent();

// ---------------- model ----------------
test('rollFixture: seeded, designed kinds win, start area stays bright', () => {
  const o = { seed: 7, roomKey: 'h:4,0', idx: 3, x: 80, z: 10, depth: 9 };
  assert.equal(rollFixture(o), rollFixture(o));
  assert.equal(rollFixture({ ...o, fixture: 'dead' }), 'dead');
  assert.equal(rollFixture({ ...o, fixture: 'flicker' }), 'flicker');
  assert.equal(rollFixture({ ...o, depth: 0.5 }), 'on');
  assert.equal(rollFixture({ ...o, room: { power: { dead: 1 } } }), 'dead');
  // across many fixtures: mostly on, some dead, some flicker; dead clusters in patches
  const counts = { on: 0, flicker: 0, dead: 0 };
  let deadInPatch = 0, inPatch = 0;
  for (let i = 0; i < 4000; i++) {
    const x = (i % 80) * 6, z = Math.floor(i / 80) * 6;
    const c = rollFixture({ seed: 11, roomKey: 'r' + i, idx: 0, x, z, depth: 9 });
    counts[c]++;
    if (darkness(11, x, z) > DEFAULTS.patchThreshold) { inPatch++; if (c === 'dead') deadInPatch++; }
  }
  assert.ok(counts.on > counts.dead && counts.dead > 100 && counts.flicker > 100, JSON.stringify(counts));
  assert.ok(inPatch > 0 && deadInPatch / inPatch > 0.5, 'dead patches are mostly dead');
});

test('fixtureOutput: dead / unpowered / switched off give nothing, stutter settles', () => {
  const on = { powered: true, on: true };
  assert.equal(fixtureOutput({ cond: 'dead', seed: 1 }, on, 3), 0);
  assert.equal(fixtureOutput({ cond: 'on', seed: 1 }, { powered: false, on: true }, 3), 0);
  assert.equal(fixtureOutput({ cond: 'on', seed: 1 }, { powered: true, on: false }, 3), 0);
  let lit = 0;
  for (let t = 0; t < 10; t += 0.05) lit += fixtureOutput({ cond: 'on', seed: 1 }, on, t) === 1 ? 1 : 0;
  assert.ok(lit > 180, 'a healthy tube is nearly always on');
  let fl = 0;
  for (let t = 0; t < 10; t += 0.05) fl += fixtureOutput({ cond: 'flicker', seed: 1 }, on, t) < 0.5 ? 1 : 0;
  assert.ok(fl > 10, 'a failing tube drops out');
  const fx = { cond: 'on', seed: 2, stutterFrom: 1, stutterUntil: 2 };
  assert.equal(fixtureOutput(fx, on, 0.5), 0, 'waits for its turn');
  const vals = new Set();
  for (let t = 1; t < 2; t += 0.02) vals.add(fixtureOutput(fx, on, t));
  assert.ok(vals.has(0) && vals.has(1), 'stutters between dark and lit');
  assert.equal(fixtureOutput(fx, on, 2.5) > 0, true);
});

test('resolveRoom: circuits per block, unpowered fuse rooms, saved overrides, revive', () => {
  const fixtures = [
    { idx: 0, cell: [2, 2], fixture: 'light', x: 0, z: 0 },
    { idx: 1, cell: [10, 3], fixture: 'dead', x: 0, z: 0 },
  ];
  const o = { seed: 1, roomKey: 'k', depth: 9, unpowered: true };
  const r = resolveRoom(fixtures, o, {});
  assert.deepEqual(Object.keys(r.circuits).sort(), [circuitOf(2, 2), circuitOf(10, 3)].sort());
  assert.ok(Object.values(r.circuits).every((c) => !c.powered && c.on));
  assert.equal(r.conds[1], 'dead');
  assert.ok(Object.values(resolveRoom(fixtures, { ...o, depth: 1 }, {}).circuits).every((c) => c.powered), 'start area is never unpowered');

  const rec = {};
  powerCircuits(r.circuits, rec);
  assert.equal(toggleCircuits(r.circuits, rec), false);
  rec.revive = true;
  const again = resolveRoom(fixtures, o, rec);
  assert.ok(Object.values(again.circuits).every((c) => c.powered && !c.on), 'record restores power + switch');
  assert.equal(again.conds[1], 'on', 'revive turns dead tubes on');
  assert.equal(rec.revive, undefined);
  assert.equal(rec.fixtures[1], 'on');
  assert.equal(toggleCircuits(again.circuits, rec), true);
});

// ---------------- timed effects ----------------
test('timed effects: pause-aware clock, expiry, auras', () => {
  const store = {};
  const t = new TimedEffects(store);
  const L = t.addLight({ pos: { x: 0, y: 1, z: 0 }, color: [0, 1, 0], range: 4, duration: 5 });
  const A = t.addAura({ id: 'mb:1', pos: { x: 10, y: 0, z: 0 }, radius: 5, duration: 30 });
  t.tick(100, false);
  assert.equal(t.clock, 0, 'paused: no time passes');
  assert.equal(t.lights.length, 1);
  t.tick(4, true);
  assert.equal(t.left(L), 1);
  assert.ok(t.auraAt({ x: 13, z: 0 }, 'calm'));
  assert.equal(t.auraAt({ x: 16, z: 0 }, 'calm'), null);
  const gone = t.tick(1.5, true);
  assert.deepEqual(gone.map((g) => g.id), [L.id]);
  t.addAura({ id: 'mb:1', pos: { x: 0, y: 0, z: 0 }, radius: 5, duration: 30 });
  assert.equal(t.auras.length, 1, 'rewinding replaces');
  assert.ok(store.auras.length === 1 && store.clock === 5.5, 'state lives in the store (world.run.power)');
  void A;
});

// ---------------- network inside a World ----------------
const fakeTextures = { get: () => new THREE.Texture() };
function makeWorld(seed = 'power-test') {
  const world = new World({ content, textures: fakeTextures, scene: new THREE.Scene(), audio: null, seed: typeof seed === 'number' ? seed : 1234567, events: null });
  const { pos } = world.start();
  world.power.running = true;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(pos.x, 1.6, pos.z);
  const ctx = { camera, time: 0, player: { pos } };
  const step = (sec, dt = 0.05) => { for (let s = 0; s < sec; s += dt) { ctx.time += dt; world.update(dt, ctx); } };
  const goto = (x, z) => {
    ctx.player.pos = new THREE.Vector3(x, 0, z);
    camera.position.set(x, 1.6, z);
    world.stream(ctx.player.pos, { sync: true });
  };
  return { world, pos, ctx, step, goto };
}

const deadRooms = (world) => [...world.rooms.values()].filter((r) => r.built.lights.some((l) => l.cond === 'dead'));

test('network: start room is lit, lightAt reacts to the switch, state persists across streaming', () => {
  const { world, pos, step } = makeWorld();
  step(0.5);
  const here = world.roomAt(pos.x, pos.z);
  assert.ok(here.built.lights.filter((l) => l.cond !== 'dead').length >= 2, 'spawn room has working lights');
  const fx = here.built.lights.find((l) => l.cond === 'on');
  const under = { x: fx.pos.x, y: 1.5, z: fx.pos.z };
  assert.ok(world.lightAt(under) > 0.3, `lit under a tube (${world.lightAt(under)})`);
  assert.equal(world.power.toggleSwitch(fx.pos), false);
  step(0.2);
  assert.ok(world.lightAt(under) < world.power.cfg.darkReveal + 0.2, 'room goes dark (neighbours may leak a little)');
  for (const l of here.built.lights) assert.equal(l.out, 0);
  assert.equal(here.built.fixtureGeo.attributes.aLit.array[here.built.lights[0].vStart], 0, 'ceiling texture follows');
  // stream it out and back in: the switch is still off
  world.dropRoom(here.key);
  const again = world.placeEntry(here.entry);
  assert.ok(Object.values(again.power.circuits).every((c) => !c.on));
  assert.equal(world.power.toggleSwitch(fx.pos), true);
});

test('network: dark patches exist; dead fixtures get an interactable; a spare tube fixes one', () => {
  const { world, step, goto } = makeWorld();
  goto(200, 120);
  step(0.1);
  const all = [...world.rooms.values()].flatMap((r) => r.built.lights);
  const dead = all.filter((l) => l.cond === 'dead');
  assert.ok(dead.length > 0 && dead.length < all.length, `${dead.length}/${all.length} dead`);
  const room = deadRooms(world)[0];
  const l = room.built.lights.find((x) => x.cond === 'dead');
  const inst = room.power.fixtureInsts.get(l.idx);
  assert.equal(inst?.id, 'light_fixture');
  assert.ok(Math.abs(inst.root.position.x - l.pos.x) < 1e-6 && inst.root.position.y > 2.9);
  assert.ok(world.power.installTube(inst));
  assert.equal(l.cond, 'on');
  assert.equal(room.power.fixtureInsts.has(l.idx), false, 'interactable removed');
  assert.ok(!world.objects.instances.includes(inst));
  assert.equal(roomRecord(world.run, room.key).fixtures[l.idx], 'on', 'persisted per run');
  step(world.power.cfg.stutterSeconds * 1.5);
  assert.ok(l.out > 0);
});

test('network: a fuse revives the room and its neighbours (even unbuilt ones)', () => {
  const { world, step, goto } = makeWorld();
  goto(200, 120);
  const room = deadRooms(world)[0];
  const nbrs = world.power.neighbourKeys(room);
  assert.ok(nbrs.length >= 2);
  const anchor = room.built.lights[0].pos;
  const res = world.power.fuseInserted(anchor);
  assert.equal(res.roomKey, room.key);
  assert.ok(room.built.lights.every((l) => l.cond !== 'dead'));
  for (const k of nbrs) {
    const p = world.rooms.get(k);
    if (p) assert.ok(p.built.lights.every((l) => l.cond !== 'dead'), `neighbour ${k} revived`);
    else assert.equal(world.run.power.rooms[k].revive, true);
  }
  // the stutter takes about a second, then the tubes hold
  const outs = new Set();
  for (let i = 0; i < 30; i++) { step(0.05); outs.add(room.built.lights[0].out > 0); }
  assert.ok(outs.has(true));
  step(2);
  assert.ok(room.built.lights.filter((l) => l.cond === 'on').every((l) => l.out > 0 || l.out === 0.25));
});

test('network: glow markers and matches are timed lights; the music box keeps a calm aura', () => {
  const { world, pos, ctx, step } = makeWorld();
  world.power.toggleSwitch(pos); // darkness, so the small lights matter
  step(0.3);
  const eye = { x: pos.x, y: 1.5, z: pos.z };
  const before = world.lightAt(eye);
  world.power.strikeMatch(pos, { duration: 10 });
  step(0.1);
  assert.ok(world.lightAt(eye) > before, 'a match lights you up');
  step(11);
  assert.equal(world.power.timed.lights.length, 0, 'the match burns out');

  // glow marker: placed, persists in world.run.placed, expires on the power clock
  world.run.placed ??= new Map();
  const state = { expiresAt: world.power.expiresIn(5) };
  const inst = world.objects.spawn('glow_marker', new THREE.Vector3(pos.x, 0, pos.z), 0, { roomKey: world.roomAt(pos.x, pos.z).key, placedKey: 'placed:t' });
  inst.state = state;
  world.run.placed.set('placed:t', { id: 'glow_marker', pos: [pos.x, 0, pos.z], rotY: 0, state, roomKey: inst.meta.roomKey });
  assert.ok(world.objects.lights.includes(inst.light));
  world.power.running = false;
  step(10);
  assert.ok(world.objects.instances.includes(inst), 'paused: it keeps glowing');
  world.power.running = true;
  step(6);
  assert.ok(!world.objects.instances.includes(inst), 'expired');
  assert.ok(!world.run.placed.has('placed:t'));

  // music box carried: aura follows the player and ends after 30 s
  const box = {};
  const a = world.power.windMusicBox(box, null, pos, { duration: 30, radius: 5 });
  assert.equal(world.auras.length, 1);
  assert.ok(world.auraAt(pos, 'calm'));
  ctx.player.pos = new THREE.Vector3(pos.x + 3, 0, pos.z);
  step(0.1);
  assert.ok(Math.abs(a.pos.x - (pos.x + 3)) < 1e-6, 'follows the player');
  step(31);
  assert.equal(world.auras.length, 0);
});
