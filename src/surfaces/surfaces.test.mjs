// node --test src/surfaces/
// Surface lookup (texture globs, room overrides, per cell), puddle shapes, gait levels, the
// footprint ring (pooling, fade, room cleanup) and the FootstepSystem with a fake world + synth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, listTextures } from '../../tools/lib/loadContent.mjs';
import {
  surfaceConfig, surfaceForTexture, surfaceOfRoomCell, surfaceAt, puddleShape, inPuddle, puddlesOf, stepLevels,
} from './surfaces.js';
import { FootprintRing, trailStrength, lifeFade, placePrint } from './footprints.js';
import { FootstepSystem } from './system.js';
import { validateSurfaces } from './schema.js';

const { content } = loadContent();
const cfg = surfaceConfig(content.surfaces);

test('surfaces.json is valid against the real content', () => {
  const res = validateSurfaces(content.surfaces, { sounds: content.sounds, objects: content.objects, textures: listTextures(), rooms: content.rooms });
  assert.deepEqual(res.filter((r) => r.level === 'error'), []);
  // every surface's preset exists
  for (const [id, s] of Object.entries(cfg.surfaces)) assert.ok(content.sounds[s.preset], `${id} → ${s.preset}`);
});

test('texture → surface: exact name, most specific glob, no match', () => {
  const tex = { 'carpet_*': 'carpet', 'pool_tiles*': 'tile', 'pool_*': 'concrete', '*wood*': 'wood', metal_structure: 'metal' };
  assert.equal(surfaceForTexture('carpet_green', tex), 'carpet');
  assert.equal(surfaceForTexture('pool_tiles_small', tex), 'tile', 'longer literal glob wins');
  assert.equal(surfaceForTexture('pool_wall', tex), 'concrete');
  assert.equal(surfaceForTexture('door_wood_light', tex), 'wood');
  assert.equal(surfaceForTexture('metal_structure', tex), 'metal');
  assert.equal(surfaceForTexture('metal_structure_bolts', tex), null);
  assert.equal(surfaceForTexture(undefined, tex), null);
  // the shipped map
  assert.equal(surfaceForTexture('carpet_green', cfg.textures), 'carpet');
  assert.equal(surfaceForTexture('pool_tiles_medium', cfg.textures), 'tile');
  assert.equal(surfaceForTexture('metal_structure_bolts', cfg.textures), 'metal');
  assert.equal(surfaceForTexture('wall_concrete_dirt', cfg.textures), 'concrete');
});

test('room cell surface: cellSurfaces > floorSurface > floor texture > default', () => {
  const room = {
    layout: ['#..', '.m.', '..g'], materials: { floor: 'pool_tiles' },
    cellSurfaces: { m: 'metal' },
  };
  assert.equal(surfaceOfRoomCell(room, 1, 1, cfg), 'metal');
  assert.equal(surfaceOfRoomCell(room, 1, 0, cfg), 'tile');
  assert.equal(surfaceOfRoomCell({ ...room, floorSurface: 'wood' }, 1, 0, cfg), 'wood');
  assert.equal(surfaceOfRoomCell({ ...room, floorSurface: 'wood' }, 1, 1, cfg), 'metal');
  assert.equal(surfaceOfRoomCell({ layout: ['.'], materials: { floor: 'nothing_known' } }, 0, 0, cfg), cfg.default);
  assert.equal(surfaceOfRoomCell(null, 0, 0, cfg), cfg.default);

  // world lookup goes through roomAt + the room origin
  const placed = { key: 'r', json: room, origin: { x: 100, z: 40 } };
  const world = { roomAt: (x, z) => (x >= 100 && z >= 40 ? placed : null) };
  assert.equal(surfaceAt(world, 100 + 2 * 1 + 0.5, 40 + 2 * 1 + 1.9, cfg), 'metal');
  assert.equal(surfaceAt(world, 101, 41, cfg), 'tile');
  assert.equal(surfaceAt(world, 0, 0, cfg), cfg.default, 'unbuilt space');
  // every shipped room resolves to a known surface everywhere
  for (const r of Object.values(content.rooms)) {
    r.layout.forEach((row, cz) => [...row].forEach((_, cx) => assert.ok(cfg.surfaces[surfaceOfRoomCell(r, cx, cz, cfg)], r.id)));
  }
});

test('puddles: rotated offset ellipse, instances by id', () => {
  const def = { size: [2, 1], offset: [1, 0], shrink: 1 };
  const p = puddleShape(def, { x: 10, z: 10 }, Math.PI / 2);
  // rotation.y = 90°: local +x → world -z
  assert.ok(Math.abs(p.x - 10) < 1e-9 && Math.abs(p.z - 9) < 1e-9, `centre ${p.x},${p.z}`);
  assert.ok(inPuddle(p, 10, 9));
  assert.ok(inPuddle(p, 10, 8.1), 'long axis now along z');
  assert.ok(!inPuddle(p, 10.8, 9), 'short axis along x');
  assert.ok(inPuddle(p, 10.8, 9, 0.4), 'margin grows it');
  const insts = [
    { id: 'decor_water_stain', root: { position: { x: 0, z: 0 }, rotation: { y: 0 } } },
    { id: 'office_chair', root: { position: { x: 5, z: 5 }, rotation: { y: 0 } } },
    { id: 'decor_leak', root: { position: { x: 5, z: 0 }, rotation: { y: 0 } } },
  ];
  const list = puddlesOf(insts, cfg.puddles);
  assert.equal(list.length, 2);
  assert.ok(Math.abs(list[1].x - 5.1) < 1e-9, 'leak floor patch offset');
});

test('gait: crouch quieter, sprint louder, surface noise scales loudness', () => {
  const carpet = cfg.surfaces.carpet, metal = cfg.surfaces.metal;
  const crouch = stepLevels(0.5, carpet, cfg.gait), walk = stepLevels(1, carpet, cfg.gait), sprint = stepLevels(1.95, carpet, cfg.gait);
  assert.ok(crouch.volume < walk.volume && walk.volume < sprint.volume);
  assert.ok(crouch.loudness < walk.loudness && walk.loudness < sprint.loudness);
  assert.equal(walk.loudness, 5, 'carpet walk stays at the old 2 + 3k');
  assert.ok(stepLevels(1, metal, cfg.gait).loudness > walk.loudness, 'metal is louder to the Tenant');
  assert.ok(stepLevels(1, metal, cfg.gait).loudness < 6.5, 'walking on metal alone does not start a hunt (tenant noise 6.5)');
  const lo = stepLevels(1, carpet, cfg.gait, 0).volume, hi = stepLevels(1, carpet, cfg.gait, 1).volume;
  assert.ok(hi > lo && hi / lo < 1.4, 'small random variation');
});

test('footprints: trail strength falls with distance, life fade holds then eases out', () => {
  assert.equal(trailStrength(0, 10, 0.2), 1);
  assert.ok(Math.abs(trailStrength(9, 10, 0.2) - 0.2) < 1e-9);
  assert.ok(trailStrength(3, 10) > trailStrength(4, 10));
  assert.equal(lifeFade(0, 40), 1);
  assert.equal(lifeFade(5, 40, 0.25), 1);
  assert.ok(lifeFade(20, 40) < 1 && lifeFade(20, 40) > lifeFade(30, 40));
  assert.equal(lifeFade(40, 40), 0);
});

test('footprints: placement alternates sides across the walking direction, toe forward', () => {
  // walking -z (yaw 0): right is +x
  const r = placePrint(0, 0, 0, -1, 1, 0.1), l = placePrint(0, 0, 0, -1, -1, 0.1);
  assert.ok(r.x > 0 && l.x < 0);
  assert.ok(Math.abs(r.rot) < 1e-9, 'facing -z = rotation 0');
  // walking +x: right is +z; rot = -90°
  const r2 = placePrint(0, 0, 1, 0, 1, 0.1);
  assert.ok(r2.z > 0);
  assert.ok(Math.abs(r2.rot + Math.PI / 2) < 1e-9);
});

test('footprint ring: capped, overwrites the oldest, fades out, room cleanup', () => {
  const ring = new FootprintRing(4);
  for (let i = 0; i < 6; i++) ring.add({ x: i, z: 0, born: i, life: 10, roomKey: i < 3 ? 'a' : 'b' });
  assert.equal(ring.count, 4, 'capped');
  assert.deepEqual(ring.slots.map((s) => s.x).sort(), [2, 3, 4, 5], 'oldest two overwritten');
  assert.equal(ring.dropRoom('a'), 1);
  assert.equal(ring.count, 3);
  ring.takeDirty();
  ring.update(9, 0.25);
  assert.ok(ring.slots.find((s) => s.x === 5).alpha > ring.slots.find((s) => s.x === 3).alpha, 'older is fainter');
  ring.update(16, 0.25);
  assert.equal(ring.count, 0, 'all faded out and freed');
  assert.ok(ring.takeDirty().length >= 3, 'freed slots marked for the mesh');
  ring.add({ x: 1, z: 1, born: 0, life: 10, strength: 0.8 });
  assert.equal(ring.wetnessNear(1.1, 1, 0.25), 0.8);
  assert.equal(ring.wetnessNear(2, 1, 0.25), 0);
});

// ---------------------------------------------------------------- the system, headless
function harness() {
  const played = [];
  const room = { key: 'r0', json: { layout: ['....', '....'], materials: { floor: 'carpet_green' }, cellSurfaces: {} }, origin: { x: 0, z: 0 } };
  const stain = { id: 'decor_water_stain', root: { position: { x: 4, z: 2 }, rotation: { y: 0 } } };
  room.objects = [stain];
  const world = { roomAt: (x, z) => (x >= 0 && x < 8 && z >= 0 && z < 4 ? room : null) };
  const game = {
    world, content, time: 0,
    player: { pos: { x: 1, z: 2 } },
    synth: { presets: content.sounds, play: (id, o) => played.push({ id, volume: o.volume }) },
  };
  const sys = new FootstepSystem(game, { rand: () => 0.5 });
  sys.onRoomPlaced(room);
  return { sys, game, played, room };
}

test('system: carpet steps, puddle splash, then a fading trail of alternating prints', () => {
  const { sys, game, played, room } = harness();
  const P = game.player.pos;
  sys.update();
  let s = sys.step(1);
  assert.equal(s.surface, 'carpet');
  assert.equal(played.at(-1).id, 'footstep_carpet');
  assert.equal(s.loudness, 5);

  // walk +x into the stain (centre x 4)
  for (const x of [2, 3, 3.6]) { P.x = x; sys.update(); }
  assert.ok(sys.inPuddle);
  s = sys.step(1);
  assert.equal(s.surface, 'puddle');
  assert.equal(played.at(-1).id, 'footstep_puddle');
  assert.equal(sys.ring.count, 0, 'no prints inside the puddle');

  // out the other side: prints, alternating, fainter each step, squelching
  const sides = [];
  for (let i = 0; i < 20; i++) {
    P.x = 5.2 + i * 0.1; // stays inside the fake room
    game.time += 0.5;
    sys.update();
    const n = played.length;
    s = sys.step(1);
    if (i < cfg.wet.steps) {
      assert.ok(played.slice(n).some((p) => p.id === cfg.wet.squelchPreset), `step ${i} squelches`);
      assert.ok(s.wet);
    }
    sides.push(sys.side);
  }
  assert.equal(sys.ring.count, cfg.wet.steps, 'one print per wet step, then dry');
  assert.equal(sys.wetSteps, 0);
  const alive = sys.ring.slots.filter((x) => x.alive).sort((a, b) => a.born - b.born);
  assert.ok(alive[0].strength > alive.at(-1).strength, 'fainter further from the puddle');
  assert.notEqual(alive[0].side, alive[1].side, 'alternating feet');
  assert.ok(alive.every((x) => Math.abs(x.rot + Math.PI / 2) < 1e-6), 'oriented along +x');
  assert.ok(alive.every((x) => x.roomKey === 'r0'));

  // time passes: they fade and are freed
  game.time += cfg.wet.life * 2;
  sys.update();
  assert.equal(sys.ring.count, 0);

  // room cleanup
  P.x = 3.8; sys.update(); sys.step(1);
  P.x = 5.5; sys.update(); sys.step(1); sys.step(1);
  assert.equal(sys.ring.count, 2);
  sys.onRoomDropped(room);
  assert.equal(sys.ring.count, 0, 'prints of a dropped room are cleared');
  assert.equal(sys.puddles.size, 0);
});

test('system: crouching on carpet is quieter than sprinting; missing preset falls back to the thump', () => {
  const { sys, played } = harness();
  sys.update();
  sys.step(0.5);
  const crouch = played.at(-1).volume;
  sys.step(1.95);
  assert.ok(played.at(-1).volume > crouch * 2);
  let thumps = 0;
  sys.game.synth = { presets: {}, play: () => assert.fail('no play'), footstep: () => thumps++ };
  sys.step(1);
  assert.equal(thumps, 1);
});
