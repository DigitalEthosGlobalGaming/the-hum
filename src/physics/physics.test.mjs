// node --test src/physics/
// The pure parts of the physics feature: the 2D step (collision response, friction, sleeping,
// player pushing, landing), the component schema, and the persistence key logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, step, collide, circleBox, boxBox, pushByPlayer, settleBody, speedOf, aabbHalf, impulse } from './sim.js';
import { physicsConfig, validatePhysics } from './schema.js';
import { stableKeyOf, savePose, loadPose, rekeyPose } from './persist.js';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import { validateContent } from '../../tools/validate.mjs';

// A 2 m cell grid: everything at x < 0 or x >= 10 or z < 0 or z >= 10 is wall (a 10×10 m room).
const room = (x, z) => x < 0 || x >= 10 || z < 0 || z >= 10;
const env = (statics = []) => ({ isSolidAt: room, statics, cell: 2 });

function run(bodies, seconds, e = env(), dt = 1 / 60) {
  const events = [];
  for (let t = 0; t < seconds; t += dt) step(bodies, dt, e, events);
  return events;
}

const chair = (o = {}) => makeBody({ shape: 'circle', r: 0.3, mass: 12, friction: 0.9, stop: 0.25, restitution: 0.45, grip: 0.6, angFriction: 1.5, sleeping: false, ...o });
const box = (o = {}) => makeBody({ shape: 'box', hx: 0.3, hz: 0.25, mass: 4, friction: 5, stop: 2.5, restitution: 0.15, sleeping: false, ...o });

// ---------------- narrow phase ----------------
test('collide: circle/circle, circle/box, box/box give a separating normal from B to A', () => {
  const a = makeBody({ shape: 'circle', r: 0.5, x: 0.8, z: 0 });
  const b = makeBody({ shape: 'circle', r: 0.5, x: 0, z: 0 });
  const c = collide(a, b);
  assert.ok(c && Math.abs(c.depth - 0.2) < 1e-9);
  assert.ok(c.nx > 0.99, 'normal points from b to a');

  const wall = { shape: 'box', x: 0, z: 0, a: 0, hx: 1, hz: 1 };
  const ball = makeBody({ shape: 'circle', r: 0.3, x: 1.2, z: 0.1 });
  const cb = circleBox(ball, wall);
  assert.ok(cb.nx > 0.99 && Math.abs(cb.depth - 0.1) < 1e-9);

  const bx = makeBody({ shape: 'box', hx: 0.5, hz: 0.5, x: 1.4, z: 0, a: 0 });
  const bb = boxBox(bx, wall);
  assert.ok(bb && bb.nx > 0.99 && Math.abs(bb.depth - 0.1) < 1e-9);
  // rotated 45°: the corner pokes in less
  bx.a = Math.PI / 4; bx.x = 1.6;
  const r = boxBox(bx, wall);
  assert.ok(r && r.nx > 0.99 && r.depth > 0 && r.depth < 0.15);
  assert.equal(collide(makeBody({ shape: 'box', hx: 0.2, hz: 0.2, x: 3, z: 3 }), wall), null);
});

test('collide: a closed wall face never pushes (no snagging on the seam between two wall cells)', () => {
  // body overlapping the top-left corner of a cell whose left neighbour is also wall
  const cell = { shape: 'box', x: 1, z: 1, a: 0, hx: 1, hz: 1 };
  const b = makeBody({ shape: 'box', hx: 0.3, hz: 0.3, x: 0.1, z: -0.25, a: 0 });
  const open = { px: false, nx: false, pz: true, nz: true };
  const c = boxBox(b, cell, open);
  assert.ok(c.nz < -0.99, 'pushed out along -z (the open face), not sideways into the seam');
});

// ---------------- step: friction, walls, bodies ----------------
test('a pushed chair coasts, slows down and stops (friction decay + brake)', () => {
  const c = chair({ x: 5, z: 5 });
  c.vx = 1.5;
  run([c], 0.5);
  const mid = speedOf(c);
  assert.ok(mid > 0.3 && mid < 1.5, `still coasting after 0.5 s (${mid})`);
  const ev = run([c], 5);
  assert.equal(speedOf(c), 0);
  assert.ok(c.sleeping, 'fell asleep once slow');
  assert.ok(ev.some((e) => e.type === 'sleep' && e.body === c));
  assert.ok(c.x > 6 && c.x < 8.5, `rolled a sensible distance (${c.x.toFixed(2)})`);
});

test('bodies bounce softly off walls and never end up inside them', () => {
  const c = chair({ x: 8, z: 5 });
  c.vx = 4;
  const ev = run([c], 1.2);
  assert.ok(c.x + c.r <= 10.01, `stays in the room (x=${c.x})`);
  const hit = ev.find((e) => e.type === 'impact' && e.with === 'wall');
  assert.ok(hit && hit.speed > 2, 'reports the wall impact with its speed');
  assert.ok(c.vx <= 0, 'bounced back');
  const b = box({ x: 2, z: 1, a: 0.4 });
  b.vz = -3; b.vx = -1;
  run([b], 2);
  const [hx, hz] = aabbHalf(b);
  assert.ok(b.x - hx >= -0.01 && b.z - hz >= -0.01, 'box pushed out of the corner');
});

test('glancing hits spin a chair; head-on impulses through the centre do not', () => {
  const a = chair({ x: 5, z: 5 });
  impulse(a, 12, 0, a.x - 0.3, a.z);           // through the centre
  assert.equal(a.w, 0);
  const b = chair({ x: 5, z: 5 });
  impulse(b, 12, 0, b.x, b.z + 0.25);          // off-centre
  assert.ok(Math.abs(b.w) > 1, 'off-centre push spins it');
});

test('two bodies collide: momentum moves to the one that was hit, and it wakes up', () => {
  const a = chair({ x: 3, z: 5 });
  const b = chair({ x: 4, z: 5, sleeping: true });
  a.vx = 2;
  const ev = run([a, b], 0.6);
  assert.ok(!b.sleeping || b.moved, 'hit body woke');
  assert.ok(b.x > 4.1, 'hit body moved away');
  assert.ok(a.vx < 1, 'hitter slowed');
  assert.ok(ev.some((e) => e.type === 'impact' && e.with === 'body'));
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.58, 'no deep overlap left');
});

test('static props block bodies like walls', () => {
  const desk = { minX: 6, maxX: 7.4, minZ: 4, maxZ: 6 };
  const c = chair({ x: 4.5, z: 5 });
  c.vx = 3;
  run([c], 1, env([desk]));
  assert.ok(c.x + c.r <= desk.minX + 0.01, `stopped by the desk (x=${c.x})`);
});

test('sleeping bodies cost nothing: they are not integrated or collided', () => {
  const s = box({ x: 5, z: 5, sleeping: true });
  s.vx = 5; // stale velocity must not move a sleeper
  let solidCalls = 0;
  const e = { isSolidAt: (x, z) => { solidCalls++; return room(x, z); }, statics: [], cell: 2 };
  run([s], 1, e);
  assert.equal(s.x, 5);
  assert.equal(solidCalls, 0, 'no wall queries for a sleeping body');
});

test('wheels ("straight") keep a cart rolling along its length', () => {
  const cart = makeBody({ shape: 'box', hx: 0.25, hz: 0.5, mass: 55, friction: 0.8, stop: 0.35, straight: true, sleeping: false, x: 5, z: 5, a: 0 });
  cart.vx = 1; cart.vz = 1;  // half sideways (local x), half along (local z)
  run([cart], 0.4);
  assert.ok(Math.abs(cart.vx) < 0.1, 'sideways motion died');
  assert.ok(cart.vz > 0.5, 'rolling along its length kept going');
});

test('thrown bodies arc, bounce on the floor and land as ground bodies', () => {
  const can = makeBody({ shape: 'circle', r: 0.035, mass: 0.3, restitution: 0.45, sleeping: false, x: 2, z: 5 });
  can.y = 1.3; can.vy = 1.5; can.vx = 6; can.airborne = true;
  const ev = run([can], 3);
  const lands = ev.filter((e) => e.type === 'land');
  assert.ok(lands.length >= 2, 'bounced at least once');
  assert.ok(lands[0].speed > 3, 'first landing is the hard one');
  assert.equal(can.airborne, false);
  assert.equal(can.y, 0);
  assert.ok(can.x > 4 && can.x <= 10, 'flew forward and stayed in the room');
});

// ---------------- the player ----------------
test('the player pushes a body instead of being blocked; heavy bodies give way less', () => {
  const light = chair({ x: 5, z: 5, sleeping: true });
  const heavy = makeBody({ shape: 'box', hx: 0.25, hz: 0.5, mass: 55, x: 5, z: 5, sleeping: true });
  const res = [];
  for (const b of [light, heavy]) {
    const p = { x: 5 - (b.shape === 'circle' ? b.r : b.hx) - 0.3 + 0.05, z: 5, r: 0.3 }; // 5 cm overlap
    const out = pushByPlayer(b, p, { x: 2.2, z: 0 }, 45);
    assert.ok(out, 'touching');
    assert.ok(!b.sleeping && b.moved, 'woke and marked moved');
    assert.ok(b.vx > 0, 'got velocity along the push');
    res.push({ moved: b.x - 5, back: -out.dx, v: b.vx });
  }
  assert.ok(res[0].moved > res[1].moved, 'light body absorbs more of the overlap');
  assert.ok(res[0].back < res[1].back, 'heavy body pushes the player back more');
  assert.ok(res[0].v > res[1].v, 'light body moves off faster');
});

test('pushing off-centre spins a box; a body stuck against a wall settles back out', () => {
  const b = box({ x: 5, z: 5, sleeping: true });
  pushByPlayer(b, { x: 5 - 0.3 - 0.3 + 0.04, z: 5.2, r: 0.3 }, { x: 2, z: 0 }, 45);
  assert.ok(Math.abs(b.w) > 0.2, 'spins from the off-centre push');
  const w = box({ x: 9.9, z: 5 });
  settleBody(w, env());
  assert.ok(w.x + 0.3 <= 10.01, 'pushed out of the wall');
  assert.equal(pushByPlayer(box({ x: 1, z: 1 }), { x: 5, z: 5, r: 0.3 }, { x: 1, z: 0 }, 45), null, 'not touching');
  const up = box({ x: 5, z: 5 }); up.y = 0.76; // on a desk
  assert.equal(pushByPlayer(up, { x: 4.5, z: 5, r: 0.3 }, { x: 1, z: 0 }, 45), null, 'things on desks are out of reach of your legs');
});

// ---------------- schema ----------------
test('schema: defaults per mode, and validation catches mistakes', () => {
  const p = physicsConfig({ mode: 'push' });
  assert.ok(p.dynamic && !p.canCarry && p.mass > 0);
  assert.equal(physicsConfig({ mode: 'static' }).dynamic, false);
  assert.ok(physicsConfig({ mode: 'carry' }).canCarry);
  assert.ok(physicsConfig({ mode: 'throw' }).canThrow);
  assert.ok(physicsConfig({ mode: 'push', spin: 1 }).grip > physicsConfig({ mode: 'push', spin: 0 }).grip);
  const bad = validatePhysics({ mode: 'roll', mass: -1, sound: { roll: 'nope' }, topple: 'yes' }, { sounds: {} });
  const fields = bad.filter((r) => r.level === 'error').map((r) => r.field);
  for (const f of ['mode', 'mass', 'sound.roll', 'topple']) assert.ok(fields.includes(f), `flags ${f}`);
  assert.deepEqual(validatePhysics({ mode: 'push', mass: 10 }, { sounds: {} }), []);
});

test('content: every physics prop validates; chairs roll, carts roll straight, bottles shatter', () => {
  const { content } = loadContent();
  const { errors } = validateContent(content, {});
  assert.deepEqual(errors.filter((e) => e.includes('physics')), []);
  const P = (id) => physicsConfig(content.objects[id].components.physics);
  assert.equal(P('office_chair').mode, 'push');
  assert.ok(P('office_chair').spin > 0.5 && content.objects.office_chair.components.physics.sound.roll);
  assert.ok(P('cardboard_box').canCarry);
  assert.ok(P('wet_floor_sign').topple);
  assert.ok(P('janitor_cart').straight && P('janitor_cart').mass > P('office_chair').mass * 3);
  assert.ok(P('trash_bin').topple && content.pools[P('trash_bin').spill]);
  assert.equal(P('glass_bottle').shatter.into, 'broken_glass');
  assert.equal(P('soda_can').mode, 'throw');
  assert.ok(content.config.keys.throw.includes('Mouse2') && content.config.keys.throw.includes('KeyT'));
});

// ---------------- persistence ----------------
test('persistence keys follow gameplay.stableKey; only moved bodies are saved', () => {
  assert.equal(stableKeyOf({ id: 'office_chair', meta: { roomKey: 'r1', spotKey: 'r1/s2' } }), 'r1/s2:office_chair');
  assert.equal(stableKeyOf({ id: 'office_chair', meta: { roomKey: 'r1', fixed: 3 } }), 'r1#3');
  assert.equal(stableKeyOf({ id: 'soda_can', meta: { roomKey: 'r1', placedKey: 'placed:7', spotKey: 'x' } }), 'placed:7');
  assert.equal(stableKeyOf({ id: 'x', meta: {} }), null);

  const map = new Map();
  const b = makeBody({ x: 1, z: 2 });
  assert.equal(savePose(map, 'r1#3', b, { x: 1, z: 2, a: 0 }), false, 'untouched bodies are not saved');
  b.moved = true;
  assert.ok(savePose(map, 'r1#3', b, { x: 1.23456, z: 2, a: 0.5, toppled: '+z' }));
  assert.deepEqual(loadPose(map, 'r1#3'), { x: 1.235, z: 2, a: 0.5, toppled: '+z' });
  assert.equal(loadPose(map, 'r1#4'), null);
  assert.equal(savePose(map, null, b, { x: 0, z: 0, a: 0 }), false, 'no key, nothing saved');
  assert.ok(rekeyPose(map, 'r1#3', 'placed:9'));
  assert.equal(loadPose(map, 'r1#3'), null);
  assert.equal(loadPose(map, 'placed:9').x, 1.235);
});
