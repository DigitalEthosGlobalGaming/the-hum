// node --test src/interaction/tape_drop.test.mjs
// Regression: G must always drop a held tape recorder. It used to drop, but a recorder dropped
// while recording kept recording "in your hand" (the red REC light at hand height and the REC
// counter kept going), so it looked like it never left. Now: idle → it just lies there; recording or
// playing back → it lies there AND starts the lure at the dropped recorder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import { Events } from '../core/events.js';
import { Gameplay } from '../gameplay/gameplay.js';
import { useHeld, dropHeld, handleInput } from './interaction.js';
import { bindStory } from '../story/runtime.js';
import { isRecording, isPlayingBack, lures, LURE_S } from '../story/tapeLure.js';

const { content } = loadContent();
const defs = content.objects;

function fakeGame() {
  const events = new Events();
  const log = [];
  for (const n of ['item:drop', 'world:noise', 'ui:caption']) events.on(n, (p) => log.push([n, p]));
  const instances = [];
  const systems = [];
  let uid = 1;
  const pressed = new Set();
  const world = {
    run: { spawnedUnique: new Set(), taken: new Set() },
    isSolidAt: () => false,
    roomAt: () => ({ key: 'roomA', depth: 1 }),
    noise: (pos, loudness, source) => events.emit('world:noise', { ...pos, loudness, source }),
    addSystem: (s) => { systems.push(s); return s; },
    objects: {
      instances,
      lights: [],
      spawn(id, pos, rotY, meta) {
        const inst = { uid: uid++, id, def: defs[id], name: defs[id].name, root: { position: { ...pos }, rotation: { y: rotY } }, center: { ...pos }, meta, state: {} };
        instances.push(inst);
        return inst;
      },
      remove(inst) { instances.splice(instances.indexOf(inst), 1); },
    },
  };
  const game = {
    cfg: content.config, content, seed: 99, events, world, time: 1, playing: true, paused: false,
    textures: { get: () => ({ image: { getContext: () => new Proxy({}, { get: () => () => {} }) }, needsUpdate: false }) },
    synth: { play: () => ({ stop() {}, setPosition() {}, setVolume() {} }) },
    player: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    camera: { position: { x: 0, y: 1.6, z: 0 } },
    stats: { sanity: 1, stamina: 1, steps: 0 },
    flashlight: { on: true, battery: 1 },
    input: { wasPressed: (a) => pressed.has(a), held: () => false },
    focus: null,
  };
  const gp = new Gameplay(game);
  game.gameplay = gp;
  game.inventory = gp.inventory;
  bindStory(gp);
  const tick = (dt) => { game.time += dt; for (const s of systems) s.update?.(dt, {}, world); gp.update(dt); };
  return { game, gp, log, tick, pressed, instances };
}

const recorders = (instances) => instances.filter((i) => i.id === 'tape_recorder');

test('tape recorder: G drops an idle recorder (through the real input path)', () => {
  const { gp, pressed, instances, log } = fakeGame();
  gp.inventory.add('tape_recorder', {}, { index: 0, select: true });
  pressed.add('drop');
  handleInput(gp);
  assert.equal(gp.inventory.held, null, 'it left the hand');
  assert.equal(recorders(instances).length, 1, 'it is on the floor');
  const drop = log.find((e) => e[0] === 'item:drop')[1];
  assert.equal(drop.inst, recorders(instances)[0], 'item:drop carries the dropped inst');
  assert.equal(lures().length, 0, 'an idle recorder is no lure');
});

test('tape recorder: dropped while RECORDING → recording stops, it is on the floor, the lure starts there', () => {
  const { gp, instances, tick, log } = fakeGame();
  gp.inventory.add('tape_recorder', { blank: true }, { index: 0, select: true });
  assert.ok(useHeld(gp));
  const st = gp.inventory.held.state;
  assert.ok(isRecording(st));
  tick(0.5);
  const before = lures().length;
  assert.ok(dropHeld(gp));
  assert.equal(gp.inventory.held, null, 'G dropped it');
  assert.equal(isRecording(st), false, 'no recording left attached to your hand');
  assert.equal(st.recorded, true, 'what it heard is kept');
  const rec = recorders(instances).find((i) => i.state === st);
  assert.ok(rec, 'the recorder lies in the world with its state');
  assert.equal(lures().length, before + 1, 'lure started');
  const lure = lures().at(-1);
  assert.deepEqual([lure.pos.x, lure.pos.z], [rec.root.position.x, rec.root.position.z], 'lure at the recorder');
  tick(1.1);
  assert.ok(log.some((e) => e[0] === 'world:noise' && e[1].source === 'tape_lure'), 'the lure makes noise');
  tick(LURE_S + 1);
  assert.equal(lures().filter((l) => l.st === st).length, 0, 'the lure ends');
});

test('tape recorder: dropped while PLAYING BACK → still a lure (as designed)', () => {
  const { gp, instances } = fakeGame();
  gp.inventory.add('tape_recorder', { blank: true, recorded: true, heard: ['footstep'] }, { index: 0, select: true });
  assert.ok(useHeld(gp));
  const st = gp.inventory.held.state;
  assert.ok(isPlayingBack(st));
  const before = lures().length;
  assert.ok(dropHeld(gp));
  assert.equal(gp.inventory.held, null);
  assert.ok(recorders(instances).some((i) => i.state === st));
  assert.equal(isPlayingBack(st), false);
  assert.equal(lures().length, before + 1);
});

test('tape recorder: playing a log does not block the drop', () => {
  const { gp, instances } = fakeGame();
  gp.inventory.add('tape_recorder', {}, { index: 0, select: true });
  assert.ok(useHeld(gp));
  assert.ok(dropHeld(gp));
  assert.equal(gp.inventory.held, null);
  assert.equal(recorders(instances).length, 1);
});
