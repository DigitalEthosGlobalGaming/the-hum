// node --test src/secrets/secrets.test.mjs
// Secrets: the trigger matcher, once-per-run + cross-run persistence (also with blocked storage),
// the physics `prop:collide` debounce, content validation, and "the spinning man" end to end
// through a fake world (spin → wheel → note; no note if it was already collected).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import { validateContent, scriptRegistry } from '../../tools/validate.mjs';
import { Events } from '../core/events.js';
import { Gameplay } from '../gameplay/gameplay.js';
import { matchWhere, matchValue, getPath, Trigger } from './matcher.js';
import { Secrets, bindSecrets } from './secrets.js';
import { STORAGE_KEY, loadFound, saveFound } from './store.js';
import { validateSecret, KNOWN_EVENTS } from './schema.js';
import { ContactDebounce } from '../physics/sim.js';
import { PhysicsSystem } from '../physics/system.js';
import { sideOf } from '../scripts/items/secret_spinning_man.js';

const { content } = loadContent();
const defs = content.objects;

// ---------------- matcher ----------------
test('matcher: paths, one-of, ranges and operators', () => {
  const chairA = { id: 'office_chair' }, chairB = { id: 'office_chair' }, box = { id: 'cardboard_box' };
  const where = { 'a.id': 'office_chair', 'b.id': 'office_chair', speed: { min: 1.1 } };
  assert.ok(matchWhere(where, { a: chairA, b: chairB, speed: 1.5 }));
  assert.ok(!matchWhere(where, { a: chairA, b: chairB, speed: 0.6 }), 'too soft');
  assert.ok(!matchWhere(where, { a: chairA, b: box, speed: 3 }), 'not two chairs');
  assert.equal(getPath({ a: { b: { c: 3 } } }, 'a.b.c'), 3);
  assert.equal(getPath({}, 'a.b.c'), undefined);
  assert.ok(matchValue('trash_bin', ['trash_bin', 'wet_floor_sign']));
  assert.ok(!matchValue('desk', ['trash_bin']));
  assert.ok(matchValue(5, { min: 1, max: 5 }) && !matchValue(6, { max: 5 }));
  assert.ok(matchValue('x', { in: ['x', 'y'] }) && !matchValue('x', { not: 'x' }));
  assert.ok(matchValue(['a', 'b'], { has: 'b' }) && matchValue(undefined, { exists: false }));
  assert.ok(!matchWhere({ $bogus: 1 }, {}), 'unknown specials never match');
});

test('matcher: env specials ($light, $torch, $room, $stage, $held, $recent)', () => {
  const env = {
    now: 100, torchOn: false, playerPos: { x: 1, y: 0, z: 1 }, stage: 3, held: 'tape_recorder',
    lightAt: (p) => (p.x > 5 ? 0.8 : 0.02),
    roomAt: (x) => (x > 5 ? { key: 'lit', json: { tags: ['office'] } } : { key: 'dark', json: { tags: ['storage', 'dead'] } }),
    recent: (ev, within) => (ev === 'power:switch' && within >= 60 ? [{ on: false, roomKey: 'dark' }, { on: true, roomKey: 'lit' }] : []),
  };
  assert.ok(matchWhere({ $light: { max: 0.08 }, $torch: false }, {}, env), 'dark at the player');
  assert.ok(!matchWhere({ $light: { max: 0.08 } }, { pos: { x: 9, y: 0, z: 0 } }, env), 'lit at the event pos');
  assert.ok(!matchWhere({ $torch: true }, {}, env));
  assert.ok(matchWhere({ $room: { tags: ['dead'] } }, {}, env));
  assert.ok(!matchWhere({ $room: { tags: ['office'] } }, {}, env));
  assert.ok(matchWhere({ $stage: { min: 3 } }, {}, env) && !matchWhere({ $stage: { min: 4 } }, {}, env));
  assert.ok(matchWhere({ $held: 'tape_recorder' }, {}, env) && !matchWhere({ $held: null }, {}, env));
  assert.ok(matchWhere({ $recent: { event: 'power:switch', where: { on: false }, within: 120, sameRoom: true } }, {}, env));
  assert.ok(!matchWhere({ $recent: { event: 'power:switch', where: { on: false }, within: 30 } }, {}, env), 'too long ago');
  const lit = { ...env, playerPos: { x: 9, y: 0, z: 0 } };
  assert.ok(!matchWhere({ $recent: { event: 'power:switch', where: { on: false }, within: 120, sameRoom: true } }, {}, lit), 'switched off in another room');
});

test('trigger: $count needs n matches inside the window; $hold needs the conditions to last', () => {
  const t = new Trigger({ event: 'prop:topple', where: { 'inst.id': 'trash_bin', $count: { n: 3, within: 30 } } });
  const bin = { inst: { id: 'trash_bin' } };
  assert.ok(!t.offer(bin, { now: 0 }));
  assert.ok(!t.offer({ inst: { id: 'desk' } }, { now: 1 }), 'non-matching events do not count');
  assert.ok(!t.offer(bin, { now: 10 }));
  assert.ok(!t.offer(bin, { now: 45 }), 'the first one fell out of the window');
  assert.ok(!t.offer(bin, { now: 50 }), 'only two inside [20, 50]');
  assert.ok(t.offer(bin, { now: 55 }), 'three within 30 s');
  assert.ok(!t.offer(bin, { now: 56 }), 'counter resets after firing');

  const h = new Trigger({ event: 'tick', where: { $torch: false, $hold: 10 } });
  assert.ok(!h.offer({}, { now: 0, torchOn: false }));
  assert.ok(!h.offer({}, { now: 6, torchOn: false }));
  assert.ok(!h.offer({}, { now: 7, torchOn: true }), 'broken: starts over');
  assert.ok(!h.offer({}, { now: 8, torchOn: false }));
  assert.ok(!h.offer({}, { now: 17.9, torchOn: false }));
  assert.ok(h.offer({}, { now: 18, torchOn: false }), 'held for 10 s');
});

// ---------------- fake game ----------------
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}
const blockedStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

function fakeGame({ physics = null } = {}) {
  const events = new Events();
  const log = [];
  for (const n of ['secret:found', 'ui:caption', 'world:noise', 'note:collected']) events.on(n, (p) => log.push([n, p]));
  const instances = [];
  const systems = [];
  let uid = 1;
  const world = {
    run: { spawnedUnique: new Set(), taken: new Set() },
    isSolidAt: () => false,
    roomAt: () => ({ key: 'roomA', depth: 1, json: { tags: [] } }),
    lightAt: () => 0.5,
    noise: (pos, loudness, source) => events.emit('world:noise', { ...pos, loudness, source }),
    addSystem: (s) => { systems.push(s); return s; },
    physics,
    objects: {
      instances,
      spawn(id, pos, rotY, meta) {
        const inst = { uid: uid++, id, def: defs[id], name: defs[id].name, root: { position: { ...pos }, rotation: { y: rotY } }, center: { ...pos }, meta, state: {} };
        if (defs[id].components?.physics) inst.body = { x: pos.x, z: pos.z, a: rotY, y: pos.y ?? 0, vx: 0, vz: 0, w: 0 };
        if (defs[id].components?.readable) inst.readable = { ...defs[id].components.readable };
        instances.push(inst);
        return inst;
      },
      remove(inst) { instances.splice(instances.indexOf(inst), 1); },
    },
  };
  const game = {
    cfg: content.config, content, seed: 7, events, world, time: 1, playing: true, paused: false,
    synth: { play: (id, o) => { log.push(['sound', id]); return { stop() {} }; } },
    player: { pos: { x: 0, y: 0, z: 3 }, yaw: 0, pitch: 0 },
    camera: { position: { x: 0, y: 1.6, z: 3 } },
    stats: { sanity: 0.5, stamina: 1, steps: 812 },
    flashlight: { on: true, battery: 1 },
    focus: null,
  };
  const gp = new Gameplay(game);
  game.gameplay = gp;
  game.inventory = gp.inventory;
  const tick = (dt, n = 1) => { for (let i = 0; i < n; i++) { game.time += dt; for (const s of systems) s.update?.(dt, {}, world); gp.update(dt); } };
  return { game, gp, events, log, world, instances, tick };
}

/** A recording stand-in for world.physics (src/physics/system.js). */
function fakePhysics() {
  const calls = [];
  return {
    calls,
    spin: (inst, o) => { calls.push(['spin', inst.uid, o.w]); return true; },
    toss: (inst, v) => { calls.push(['toss', inst.id, v]); return true; },
    breakProp: (inst, o) => { calls.push(['break', inst.uid, o.dir]); inst.state.broken = o; return true; },
  };
}

// ---------------- runtime: once + persistence ----------------
test('secrets: list() is stable and exact; a match fires once per run and is remembered across runs', () => {
  const storage = memStorage();
  const { game, gp, events, log } = fakeGame({ physics: fakePhysics() });
  const s = bindSecrets(gp, { storage });
  assert.equal(game.secrets, s);
  assert.equal(bindSecrets(gp, { storage }), s, 'binding is idempotent');
  const ids = s.list().map((e) => e.id);
  assert.deepEqual(ids, ['spinning_man', 'lights_out', 'dark_caller', 'strike'], 'ordered by "order", then id');
  for (const e of s.list()) {
    assert.deepEqual(Object.keys(e).sort(), ['found', 'hint', 'id', 'title'], 'unfound: no foundAt');
    assert.equal(e.found, false);
    assert.equal(typeof e.title, 'string');
  }
  assert.equal(s.list()[0].hint, "Some chairs don't like each other.");
  assert.deepEqual(s.count(), { found: 0, total: 4 });

  const chair = () => game.world.objects.spawn('office_chair', { x: 0, y: 0, z: 0 }, 0, { roomKey: 'roomA', spotKey: `r/${Math.random()}` });
  const [a, b] = [chair(), chair()];
  events.emit('prop:collide', { a, b, speed: 0.5, pos: { x: 0, y: 0.3, z: 0 } });
  assert.equal(s.count().found, 0, 'too soft');
  events.emit('prop:collide', { a, b, speed: 2, pos: { x: 0, y: 0.3, z: 0 } });
  assert.deepEqual(s.count(), { found: 1, total: 4 });
  const found = log.filter((e) => e[0] === 'secret:found').map((e) => e[1]);
  assert.deepEqual(found, [{ id: 'spinning_man', title: 'The spinning man', first: true }]);
  const e0 = s.list()[0];
  assert.equal(e0.found, true);
  assert.equal(typeof e0.foundAt, 'number');
  const spins = game.world.physics.calls.filter((c) => c[0] === 'spin').length;
  events.emit('prop:collide', { a, b, speed: 3, pos: { x: 0, y: 0.3, z: 0 } });
  assert.equal(game.world.physics.calls.filter((c) => c[0] === 'spin').length, spins, 'once per run: no second spin');
  assert.equal(log.filter((e) => e[0] === 'secret:found').length, 1);
  assert.equal(s.markFound('spinning_man'), false, 'already found this run');
  assert.equal(s.markFound('nope'), false, 'unknown id');
  // run state is plain JSON (saves)
  assert.ok(JSON.parse(JSON.stringify(gp.runState.secrets)).found.spinning_man);
  // persisted
  const saved = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(saved.v, 1);
  assert.ok(saved.found.spinning_man.at > 0);

  // a new run: still listed as found, but it fires again (once) and isn't "first"
  const next = fakeGame({ physics: fakePhysics() });
  const s2 = bindSecrets(next.gp, { storage });
  assert.equal(s2.list()[0].found, true, 'remembered across runs');
  assert.equal(s2.list()[0].foundAt, e0.foundAt);
  assert.equal(s2.foundThisRun('spinning_man'), false);
  const c1 = next.game.world.objects.spawn('office_chair', { x: 0, y: 0, z: 0 }, 0, {});
  const c2 = next.game.world.objects.spawn('office_chair', { x: 0.6, y: 0, z: 0 }, 0, {});
  next.events.emit('prop:collide', { a: c1, b: c2, speed: 2 });
  assert.ok(next.game.world.physics.calls.some((c) => c[0] === 'spin'), 'fires again in the new run');
  assert.deepEqual(next.log.filter((e) => e[0] === 'secret:found').map((e) => e[1].first), [false]);
});

test('secrets: blocked or broken localStorage never throws; found state still works for the run', () => {
  assert.deepEqual(loadFound(blockedStorage), {});
  assert.equal(saveFound(blockedStorage, { a: { at: 1 } }), false);
  assert.deepEqual(loadFound(null), {});
  assert.deepEqual(loadFound(memStorage({ [STORAGE_KEY]: '{not json' })), {});
  assert.deepEqual(loadFound(memStorage({ [STORAGE_KEY]: '{"v":1,"found":[1,2]}' })), {});
  const { gp } = fakeGame();
  const s = new Secrets(gp, { storage: blockedStorage });
  assert.equal(s.markFound('strike'), true);
  assert.equal(s.list().find((e) => e.id === 'strike').found, true);
  assert.deepEqual(s.count(), { found: 1, total: 4 });
  const t = new Secrets(fakeGame().gp, { storage: null });
  assert.equal(t.markFound('strike'), true, 'no storage at all is fine too');
});

test('secrets: a tick trigger with $recent + $hold (lights out) and a $count trigger (strike)', () => {
  const { game, gp, events, tick, instances } = fakeGame();
  const s = bindSecrets(gp, { storage: memStorage() });
  game.world.lightAt = () => 0.02;
  game.world.isSolidAt = (x, z) => z < -1; // a wall ahead (the player faces -z from z = 3)
  game.flashlight.on = false;
  tick(0.25, 60);
  assert.equal(s.foundThisRun('lights_out'), false, 'dark alone is not enough');
  events.emit('power:switch', { roomKey: 'roomA', on: false });
  tick(0.25, 20);
  assert.equal(s.foundThisRun('lights_out'), false, '5 s is not 10');
  tick(0.25, 24);
  assert.equal(s.foundThisRun('lights_out'), true, 'switched off, dark, torch off, 10 s');
  const w = instances.find((i) => i.id === 'dark_writing');
  assert.ok(w, 'writing spawned');
  assert.match(w.state.message, /812/, 'it knows your steps');
  assert.ok(Math.abs(w.root.position.z + 1) < 0.1 && w.root.position.y > 0.5, 'on the wall ahead');

  for (let i = 0; i < 3; i++) {
    const bin = game.world.objects.spawn('trash_bin', { x: i, y: 0, z: 0 }, 0, {});
    events.emit('prop:topple', { inst: bin, dir: '+x' });
    tick(1);
  }
  assert.equal(s.foundThisRun('strike'), true);
  assert.ok(instances.some((i) => i.id === 'coin'), 'a coin rolls out');
});

test('secrets: dark caller fires on phone:answer only in the dark, torch off, first answer', () => {
  const { game, gp, events, tick, log } = fakeGame();
  const s = bindSecrets(gp, { storage: memStorage() });
  const phone = game.world.objects.spawn('old_phone', { x: 0, y: 0, z: 0 }, 0, {});
  events.emit('phone:answer', { inst: phone, first: true });
  assert.equal(s.foundThisRun('dark_caller'), false, 'torch on, lit');
  game.flashlight.on = false;
  game.world.lightAt = () => 0.03;
  events.emit('phone:answer', { inst: phone, first: false });
  assert.equal(s.foundThisRun('dark_caller'), false, 'not the first answer');
  events.emit('phone:answer', { inst: phone, first: true });
  assert.equal(s.foundThisRun('dark_caller'), true);
  tick(1, 6);
  assert.ok(log.some((e) => e[0] === 'ui:caption' && /second voice/.test(e[1].text)));
  assert.ok(game.stats.sanity > 0.5);
});

// ---------------- the spinning man, end to end ----------------
function chairsCollide() {
  const f = fakeGame({ physics: fakePhysics() });
  const s = bindSecrets(f.gp, { storage: memStorage() });
  const a = f.game.world.objects.spawn('office_chair', { x: 0, y: 0, z: 0 }, 0, { roomKey: 'roomA', spotKey: 'r/a' });
  const b = f.game.world.objects.spawn('office_chair', { x: 0.6, y: 0, z: 0 }, 0, { roomKey: 'roomA', spotKey: 'r/b' });
  return { ...f, s, a, b };
}

test('spinning man: spin → (1.7 s) wheel pops off, chair breaks → (0.55 s) note arcs out', () => {
  const { game, events, s, a, b, tick, instances, log } = chairsCollide();
  const P = game.world.physics.calls;
  events.emit('prop:collide', { a, b, speed: 1.8, pos: { x: 0.3, y: 0.3, z: 0 } });
  assert.equal(s.foundThisRun('spinning_man'), true);
  const spins = P.filter((c) => c[0] === 'spin');
  assert.deepEqual(spins.map((c) => c[1]).sort(), [a.uid, b.uid].sort(), 'both chairs spin');
  assert.ok(spins.every((c) => Math.abs(c[2]) >= 12), 'wildly');
  assert.equal(log.filter((e) => e[0] === 'sound' && e[1] === 'chair_spin').length, 2);
  tick(0.5, 3);
  assert.equal(instances.filter((i) => i.id === 'chair_wheel').length, 0, 'not yet');
  tick(0.25);
  const wheel = instances.find((i) => i.id === 'chair_wheel');
  assert.ok(wheel, 'the wheel comes off after ~1.7 s');
  assert.ok(wheel.meta.placedKey, 'the wheel persists');
  const toss = P.find((c) => c[0] === 'toss' && c[1] === 'chair_wheel');
  assert.ok(Math.hypot(toss[2].vx, toss[2].vz) > 1.5 && toss[2].vy > 0, 'it pops out and rolls away');
  assert.ok(log.some((e) => e[0] === 'sound' && e[1] === 'wheel_clatter'));
  assert.ok(log.some((e) => e[0] === 'world:noise' && e[1].source === 'secret:wheel'), 'a clatter others hear');
  const broken = P.find((c) => c[0] === 'break');
  assert.ok(broken && [a.uid, b.uid].includes(broken[1]), 'one chair is broken');
  assert.equal(instances.filter((i) => i.id === 'note_chair_wheel').length, 0, 'the note comes a moment later');
  tick(0.3, 2);
  const note = instances.find((i) => i.id === 'note_chair_wheel');
  assert.ok(note, 'then the note pops out');
  assert.ok(note.meta.placedKey);
  const nt = P.find((c) => c[0] === 'toss' && c[1] === 'note_chair_wheel');
  assert.ok(nt[2].vy > 1.5, 'with a little arc');
  // it is the spinning man's note, collectible like any other
  assert.equal(game.gameplay.resolveReadable(note).noteId, 'frag_spinning_man');
});

test('spinning man: note already collected → the chair still spins and breaks, but no note', () => {
  const { game, events, a, b, tick, instances } = chairsCollide();
  game.gameplay.notesCollected.add('frag_spinning_man');
  events.emit('prop:collide', { a, b, speed: 2.5 });
  tick(0.25, 16);
  const P = game.world.physics.calls;
  assert.equal(P.filter((c) => c[0] === 'spin').length, 2);
  assert.ok(P.some((c) => c[0] === 'break'));
  assert.ok(instances.some((i) => i.id === 'chair_wheel'));
  assert.equal(instances.filter((i) => i.id === 'note_chair_wheel').length, 0);
});

test('spinning man: a chair against a box, or a soft bump, is not it', () => {
  const { game, events, s, a } = chairsCollide();
  const box = game.world.objects.spawn('cardboard_box', { x: 1, y: 0, z: 0 }, 0, {});
  events.emit('prop:collide', { a, b: box, speed: 3 });
  events.emit('prop:collide', { a: box, b: a, speed: 3 });
  assert.equal(s.foundThisRun('spinning_man'), false);
});

test('sideOf maps a world direction into the prop’s local side', () => {
  assert.equal(sideOf(0, 1, 0), '+x');
  assert.equal(sideOf(0, 0, -1), '-z');
  assert.equal(sideOf(Math.PI / 2, 0, 1), '-x'); // turned 90°: local +x is world (cos a, -sin a) = (0, -1)
});

// ---------------- prop:collide debounce ----------------
test('prop:collide: debounced per pair, refreshed while touching, ignores soft touches', () => {
  const d = new ContactDebounce({ gap: 0.5, minSpeed: 0.3 });
  assert.equal(d.hit(1, 2, 1.2, 10), true, 'first hard contact reports');
  assert.equal(d.hit(2, 1, 1.0, 10.1), false, 'same pair (either order) within the gap: quiet');
  assert.equal(d.hit(1, 2, 0.1, 10.4), false, 'soft grinding keeps it quiet...');
  assert.equal(d.hit(1, 2, 1.5, 10.8), false, '...and refreshes the clock');
  assert.equal(d.hit(1, 3, 1.5, 10.8), true, 'other pairs are independent');
  assert.equal(d.hit(1, 2, 1.5, 11.5), true, 'a fresh hit after the gap reports again');
  assert.equal(d.hit(4, 5, 0.2, 12), false, 'below the threshold: never');
  assert.equal(d.hit(4, 5, 0.9, 12.05), true, 'a soft touch does not swallow the hard hit after it');
});

test('prop:collide: the physics system emits { a, b, speed, pos } once per contact', () => {
  const emitted = [];
  const sys = Object.create(PhysicsSystem.prototype);
  sys.game = { time: 3, events: { emit: (n, p) => emitted.push([n, p]) } };
  sys.contacts = new ContactDebounce({ gap: 0.5, minSpeed: 0.3 });
  const a = { uid: 1, id: 'office_chair' }, b = { uid: 2, id: 'office_chair' };
  sys.bodyContact(a, b, { speed: 1.4, x: 1, z: 2 });
  sys.bodyContact(a, b, { speed: 1.4, x: 1, z: 2 });
  sys.game.time = 3.2;
  sys.bodyContact(b, a, { speed: 2, x: 1, z: 2 });
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], ['prop:collide', { a, b, speed: 1.4, pos: { x: 1, y: 0.3, z: 2 } }]);
});

// ---------------- content ----------------
test('content: secrets validate; bad scripts, events and matchers are caught', () => {
  const reg = scriptRegistry();
  assert.deepEqual(validateContent(content, { scripts: reg.ids }).errors, []);
  assert.ok(Object.keys(content.secrets).length >= 4);
  assert.ok(KNOWN_EVENTS.includes('prop:collide'));
  const bad = { ...content, secrets: { x: { id: 'x', title: 'X', once: true, trigger: { event: 'nope' }, script: 'no_such_script' } } };
  const { errors } = validateContent(bad, { scripts: reg.ids });
  assert.ok(errors.some((e) => /unknown event "nope"/.test(e)));
  assert.ok(errors.some((e) => /unknown script "no_such_script"/.test(e)));
  const issues = validateSecret({ title: 'Y', once: true, script: 'secret_strike', trigger: { event: 'prop:topple', where: { $count: { n: 0 }, $hold: 5, $wat: 1 } } }, { scripts: reg.ids });
  assert.ok(issues.some((i) => i.field === 'trigger.where.$count' && i.level === 'error'));
  assert.ok(issues.some((i) => i.field === 'trigger.where.$hold' && i.level === 'warn'));
  assert.ok(issues.some((i) => i.field === 'trigger.where.$wat'));
  // the chair note is a collectible fragment, not a spine note
  assert.equal(content.notes.frag_spinning_man.spine, undefined);
  assert.equal(content.objects.note_chair_wheel.components.readable.textId, 'frag_spinning_man');
});
