// node --test src/gameplay/
// Pure M4 logic: inventory, combine resolution, notes, pools, script registry, and the verbs
// driven through a fake game (no DOM, no Three).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import { validateContent, scriptRegistry } from '../../tools/validate.mjs';
import { Inventory } from '../inventory/inventory.js';
import { findCombine, consumeSides } from '../interaction/combine.js';
import { splitNotes, nextSpine, randomFragment, resolveNote } from './notes.js';
import { dropPoint, castSurface, yawFacing } from './placement.js';
import { rollPool, expectedOdds } from '../spawn/pools.js';
import { Rng } from '../core/rng.js';
import { registry, buildRegistry, scriptIds } from '../scripts/registry.js';
import { Gameplay } from './gameplay.js';
import { interact, useHeld, dropHeld, combineSlots, verbFor } from '../interaction/interaction.js';

const { content } = loadContent();
const defs = content.objects;

function recorder() {
  const log = [];
  return { log, emit: (name, payload) => log.push([name, payload]), on: () => () => {}, of: (n) => log.filter((e) => e[0] === n).map((e) => e[1]) };
}

// ---------------- inventory ----------------
test('inventory: add / find / remove / full', () => {
  const ev = recorder();
  const inv = new Inventory({ size: 4, defs, events: ev });
  assert.equal(inv.held, null);
  assert.ok(inv.add('battery'));
  assert.equal(inv.held.id, 'battery');
  assert.ok(inv.add('almond_water', { sips: 2 }));
  assert.deepEqual(inv.find('almond_water').index, 1);
  assert.equal(inv.find('almond_water').stack.state.sips, 2);
  assert.ok(inv.add('chalk'));
  assert.ok(inv.add('fuse'));
  assert.equal(inv.add('tape_recorder'), false, 'fifth item does not fit');
  assert.equal(inv.remove(1).id, 'almond_water');
  assert.equal(inv.slots[1], null);
  assert.equal(inv.remove(1), null);
  assert.equal(inv.add('nope'), false, 'unknown ids are refused');
  assert.equal(ev.of('inventory:change').length, 5, '4 adds + 1 remove');
  const last = ev.of('inventory:change').at(-1);
  assert.equal(last.slots, inv.slots);
  assert.equal(last.selected, 0);
});

test('inventory: select + wrapping step', () => {
  const ev = recorder();
  const inv = new Inventory({ size: 4, defs, events: ev });
  inv.select(2); assert.equal(inv.selected, 2);
  inv.step(1); inv.step(1); assert.equal(inv.selected, 0, 'wraps forward');
  inv.step(-1); assert.equal(inv.selected, 3, 'wraps backward');
  const n = ev.of('inventory:change').length;
  inv.select(3); assert.equal(ev.of('inventory:change').length, n, 'no event when nothing changes');
});

test('inventory: size-2 items take two neighbouring slots', () => {
  const big = { ...defs, crowbar: { id: 'crowbar', components: { pickup: { size: 2 } } } };
  const inv = new Inventory({ size: 4, defs: big });
  inv.add('battery');                       // slot 0
  assert.ok(inv.add('crowbar'));            // slots 1+2
  assert.equal(inv.slots[1], inv.slots[2]);
  assert.equal(inv.slots[1].slot, 1);
  assert.equal(inv.add('crowbar'), false, 'only one slot left');
  inv.select(0); inv.step(1); assert.equal(inv.selected, 1);
  inv.step(1); assert.equal(inv.selected, 3, 'skips the second half');
  inv.step(-1); assert.equal(inv.selected, 1, 'backwards lands on the first half');
  inv.remove(2);
  assert.deepEqual(inv.slots.map((s) => s?.id ?? null), ['battery', null, null, null]);
  inv.add('chalk', {}, { index: 2 });
  assert.equal(inv.add('crowbar'), false, 'no two free neighbours (1 and 3 are split)');
  assert.equal(inv.serialize().items.length, 2);
});

// ---------------- combine ----------------
test('combine: both directions + consume sides', () => {
  // the rule lives on fuse_box; holding the fuse still matches
  const m = findCombine('fuse', defs.fuse, 'fuse_box', defs.fuse_box);
  assert.equal(m.owner, 'b');
  assert.equal(m.rule.script, 'fuse_insert');
  assert.deepEqual(consumeSides(m.rule.consume, m.owner), { a: true, b: false }, '"other" = the fuse');
  const m2 = findCombine('fuse_box', defs.fuse_box, 'fuse', defs.fuse);
  assert.equal(m2.owner, 'a');
  assert.deepEqual(consumeSides(m2.rule.consume, m2.owner), { a: false, b: true });
  const b = findCombine('battery', defs.battery, 'flashlight', null);
  assert.equal(b.owner, 'a');
  assert.deepEqual(consumeSides('self', 'a'), { a: true, b: false });
  assert.deepEqual(consumeSides('both', 'b'), { a: true, b: true });
  assert.deepEqual(consumeSides(undefined, 'a'), { a: false, b: false });
  assert.deepEqual(consumeSides(true, 'b'), { a: false, b: true });
  assert.equal(findCombine('chalk', defs.chalk, 'fuse_box', defs.fuse_box), null);
});

// ---------------- notes ----------------
test('notes: 12 spine notes in order + fragments', () => {
  const { spine, fragments } = splitNotes(content.notes);
  assert.equal(spine.length, 12);
  assert.deepEqual(spine.map((n) => n.spine), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(fragments.length >= 10);
  const read = new Set();
  for (let i = 1; i <= 12; i++) {
    const n = resolveNote('spine', content.notes, read, 123);
    assert.equal(n.spine, i);
    read.add(n.id);
  }
  assert.equal(nextSpine(content.notes, read), null);
  assert.equal(resolveNote('spine', content.notes, read, 5).spine, undefined, 'falls back to a fragment');
});

test('notes: random fragment is seeded and prefers unread', () => {
  const read = new Set();
  const a = randomFragment(content.notes, read, 42);
  assert.equal(randomFragment(content.notes, read, 42).id, a.id, 'same seed, same note');
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const n = resolveNote('random', content.notes, seen, 1000 + i);
    assert.ok(!seen.has(n.id), 'unread first');
    seen.add(n.id);
  }
  assert.ok(resolveNote('random', content.notes, seen, 7), 'still returns something when all are read');
  assert.equal(resolveNote('spine_03', content.notes, seen, 7).title, content.notes.spine_03.title);
});

// ---------------- pools ----------------
test('pools: spine pages only from depth 1, more likely deeper; new items appear in lobby loot', () => {
  const pools = content.pools;
  const at = (d) => expectedOdds('spine_notes', pools, { depth: d }).get('note_spine') ?? 0;
  assert.equal(at(0), 0);
  assert.ok(at(1) > 0 && at(5) > at(1) && at(12) > at(5));
  const loot = expectedOdds('lobby_floor_loot', pools, { depth: 0 });
  for (const id of ['chalk', 'fuse']) assert.ok(loot.get(id) > 0, id);
  // tapes live where someone sat (level direction): desks, beside chairs, camps
  const placed = ['room_desk_top', 'room_beside_chair', 'room_camp'].some((p) => (expectedOdds(p, pools, { depth: 0 }).get('tape_recorder') ?? 0) > 0);
  assert.ok(placed, 'tape_recorder appears on desks / beside chairs / at camps');
  assert.ok(!loot.has('note_spine'));
  const rng = new Rng(9);
  let spine = 0;
  for (let i = 0; i < 2000; i++) spine += rollPool('desk_top', pools, rng, { depth: 10, zone: 'lobby' }).filter((x) => x === 'note_spine').length;
  assert.ok(spine > 0);
  assert.ok(expectedOdds('room_wall_panel', pools, {}).get('fuse_box') > 0, 'fuse boxes hang on wall spots');
});

// ---------------- script registry + validator ----------------
test('registry: every referenced script exists; validator uses the same list', () => {
  const reg = scriptRegistry();
  assert.deepEqual(reg.errors, []);
  assert.deepEqual([...reg.ids].sort(), scriptIds().sort());
  for (const s of registry.values()) assert.equal(typeof s.run, 'function');
  assert.throws(() => buildRegistry([{ id: 'x', run() {} }, { id: 'x', run() {} }]), /Duplicate/);
  const res = validateContent(content, { scripts: reg.ids });
  assert.deepEqual(res.errors, []);
  const bad = structuredClone(content);
  bad.objects.chalk.components.use.script = 'no_such_script';
  bad.objects.note_spine.components.readable.textId = 'nope';
  const r2 = validateContent(bad, { scripts: reg.ids });
  assert.ok(r2.errors.some((e) => /unknown script "no_such_script"/.test(e)), 'unknown script is an error');
  assert.ok(r2.errors.some((e) => /unknown note "nope"/.test(e)));
});

// ---------------- placement ----------------
test('placement: drop point avoids walls; cast finds wall face and floor', () => {
  const solid = (x, z) => z < 0; // wall everything north of z=0
  const p = dropPoint({ x: 0, y: 0, z: 0.5 }, 0, solid); // facing -z, wall 0.5 m ahead
  assert.ok(p.z > 0.1 && p.z <= 0.5, `stays out of the wall (z=${p.z})`);
  const free = dropPoint({ x: 0, y: 0, z: 5 }, 0, solid);
  assert.ok(Math.abs(free.z - 4.2) < 1e-9);
  const hit = castSurface({ x: 0, y: 1.6, z: 1 }, { x: 0, y: 0, z: -1 }, solid);
  assert.equal(hit.surface, 'wall');
  assert.ok(Math.abs(hit.point.z) < 0.01);
  assert.deepEqual(hit.normal, { x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(yawFacing(hit.normal) - Math.PI) < 1e-9 || Math.abs(yawFacing(hit.normal) + Math.PI) < 1e-9);
  const d = Math.SQRT1_2;
  const fl = castSurface({ x: 0, y: 1.6, z: 5 }, { x: 0, y: -d, z: -d }, solid, { maxDist: 3 });
  assert.equal(fl.surface, 'floor');
  assert.ok(Math.abs(fl.point.z - 3.4) < 1e-6);
});

// ---------------- verbs through a fake game ----------------
function fakeGame() {
  const events = recorder();
  const instances = [];
  let uid = 1;
  const sounds = [];
  const world = {
    run: { spawnedUnique: new Set(), taken: new Set() },
    isSolidAt: (x, z) => z < -3,
    roomAt: () => ({ key: 'roomA' }),
    objects: {
      instances,
      spawn(id, pos, rotY, meta) {
        const def = defs[id];
        const inst = { uid: uid++, id, def, name: def.name, root: { position: { ...pos } }, center: { ...pos }, meta, state: {} };
        if (def.components?.readable) {
          const c = def.components.readable;
          inst.readable = { text: c.text ?? null, textId: c.textId ?? null, display: c.display ?? 'inspect' };
        }
        if (def.components?.sound) inst.sound = { fired: true, handle: { stopped: false, stop() { this.stopped = true; } } };
        instances.push(inst);
        return inst;
      },
      remove(inst) { instances.splice(instances.indexOf(inst), 1); },
    },
  };
  const game = {
    cfg: content.config, content, seed: 77, events, world, time: 10,
    synth: { play: (id, o) => { sounds.push(id); return { stop() {} }; } },
    player: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    camera: { position: { x: 0, y: 1.6, z: 0 } },
    stats: { sanity: 0.5, stamina: 1 },
    flashlight: { on: true, battery: 0.2, recharge(a = 1) { this.battery = Math.min(1, this.battery + a); } },
    focus: null,
  };
  const gp = new Gameplay(game);
  game.gameplay = gp;
  game.inventory = gp.inventory;
  return { game, gp, events, world, sounds };
}

test('verbs: pickup takes the spot, use consumes, full pockets emit inventory:full', () => {
  const { game, gp, events, world, sounds } = fakeGame();
  const bottle = world.objects.spawn('almond_water', { x: 0, y: 0, z: -1 }, 0, { roomKey: 'roomA', spotKey: 'roomA/s1' });
  assert.deepEqual(verbFor(gp, bottle), { verb: 'take', kind: 'pickup' });
  assert.ok(interact(gp, bottle));
  assert.ok(world.run.taken.has('roomA/s1'));
  assert.equal(world.objects.instances.length, 0);
  assert.equal(events.of('item:pickup')[0].id, 'almond_water');
  assert.equal(gp.inventory.held.id, 'almond_water', 'empty hand → straight into it');
  assert.ok(useHeld(gp));
  assert.equal(game.stats.sanity, 0.75);
  assert.ok(sounds.includes('bottle_drink'));
  assert.equal(gp.inventory.held, null, 'consumed');
  assert.equal(events.of('item:use').length, 1);
  for (const id of ['chalk', 'fuse', 'tape_recorder', 'battery']) gp.inventory.add(id);
  const extra = world.objects.spawn('battery', { x: 0, y: 0, z: -1 }, 0, { roomKey: 'roomA', spotKey: 'roomA/s2' });
  assert.equal(interact(gp, extra), false);
  assert.deepEqual(events.of('inventory:full')[0], { id: 'battery' });
  assert.equal(world.objects.instances.length, 1, 'stays in the world');
});

test('verbs: battery recharges the torch (use and combineSlots with the flashlight)', () => {
  const { game, gp, events } = fakeGame();
  gp.inventory.add('battery');
  assert.ok(useHeld(gp));
  assert.equal(game.flashlight.battery, 1);
  assert.equal(gp.inventory.held, null);
  gp.inventory.add('battery');
  assert.equal(useHeld(gp), false, 'already full → fail caption, not consumed');
  assert.ok(events.of('ui:caption').length >= 1);
  assert.equal(gp.inventory.held.id, 'battery');
  game.flashlight.battery = 0.1;
  assert.ok(combineSlots(gp, 0, 'flashlight'));
  assert.equal(game.flashlight.battery, 1);
  assert.equal(gp.inventory.slots[0], null);
  assert.deepEqual(events.of('item:combine').at(-1), { a: 'battery', b: 'flashlight' });
});

test('verbs: fuse + fuse box combine (rule on the box) beats its interact', () => {
  const { gp, events, world } = fakeGame();
  const box = world.objects.spawn('fuse_box', { x: 1, y: 0, z: -1 }, 0, { roomKey: 'roomA', fixed: 3 });
  assert.ok(interact(gp, box));                       // no fuse: inspect caption
  assert.match(events.of('ui:caption').at(-1).text, /empty/);
  gp.inventory.add('fuse');
  assert.equal(verbFor(gp, box).kind, 'combine');
  assert.ok(interact(gp, box));
  assert.equal(box.state.powered, true);
  assert.equal(gp.inventory.held, null, 'fuse consumed ("other")');
  assert.ok(world.objects.instances.includes(box), 'box stays');
  assert.deepEqual(events.of('item:combine').at(-1), { a: 'fuse', b: 'fuse_box' });
  // state persists per run: a re-streamed box remembers
  world.objects.remove(box);
  const again = world.objects.spawn('fuse_box', { x: 1, y: 0, z: -1 }, 0, { roomKey: 'roomA', fixed: 3 });
  assert.equal(gp.stateOf(again).powered, true);
});

test('verbs: phone answer stops the ring, then the whisper comes on a timer', () => {
  const { gp, events, world, sounds } = fakeGame();
  const phone = world.objects.spawn('old_phone', { x: 0, y: 0.7, z: -1 }, 0, { roomKey: 'roomA', fixed: 0 });
  assert.equal(verbFor(gp, phone).verb, 'answer');
  assert.ok(interact(gp, phone));
  assert.equal(phone.sound.handle.stopped, true);
  assert.ok(!sounds.includes('whisper_far'));
  gp.update(1);
  assert.ok(sounds.includes('whisper_far'));
  assert.ok(events.of('ui:caption').length === 1);
});

test('verbs: notebook notes resolve, collect once, and go in the pocket', () => {
  const { gp, events, world } = fakeGame();
  const n1 = world.objects.spawn('note_spine', { x: 0, y: 0, z: -1 }, 0, { roomKey: 'roomA', spotKey: 'roomA/n1' });
  assert.ok(interact(gp, n1));
  const open = events.of('readable:open')[0];
  assert.equal(open.display, 'notebook');
  assert.equal(open.noteId, 'spine_01');
  assert.deepEqual(events.of('note:collected')[0], { noteId: 'spine_01', title: open.title, text: open.text });
  assert.equal(gp.inventory.held.id, 'note_spine');
  assert.equal(gp.inventory.held.state.noteId, 'spine_01', 'the carried page remembers its text');
  assert.ok(useHeld(gp), 're-read from the pocket');
  assert.equal(events.of('readable:open').at(-1).noteId, 'spine_01');
  assert.equal(events.of('note:collected').length, 1, 'no second collect');
  const n2 = world.objects.spawn('note_spine', { x: 0, y: 0, z: -1 }, 0, { roomKey: 'roomB', spotKey: 'roomB/n1' });
  interact(gp, n2);
  assert.equal(events.of('note:collected')[1].noteId, 'spine_02');
  const scrawl = world.objects.spawn('wall_scrawl', { x: 0, y: 1, z: -2 }, 0, { roomKey: 'roomA', fixed: 1 });
  interact(gp, scrawl);
  assert.equal(events.of('readable:open').at(-1).display, 'surface');
  assert.ok(world.objects.instances.includes(scrawl));
});

test('verbs: drop places the held item in front, keeps state, persists via world.run.placed', () => {
  const { gp, events, world } = fakeGame();
  gp.inventory.add('tape_recorder', { track: 2 });
  assert.ok(dropHeld(gp));
  const inst = world.objects.instances[0];
  assert.equal(inst.id, 'tape_recorder');
  assert.ok(Math.abs(inst.root.position.z + 0.8) < 1e-9);
  assert.equal(inst.state.track, 2);
  assert.equal(world.run.placed.size, 1);
  assert.equal(events.of('item:drop')[0].id, 'tape_recorder');
  interact(gp, inst); // pick it back up
  assert.equal(world.run.placed.size, 0);
  assert.equal(gp.inventory.held.state.track, 2);
});

test('verbs: chalk draws a persisted mark on the wall in front and wears down', () => {
  const { game, gp, world } = fakeGame();
  game.camera.position.z = -2;            // wall at z = -3
  gp.inventory.add('chalk', { uses: 2 });
  assert.ok(useHeld(gp));
  const mark = world.objects.instances.find((i) => i.id === 'chalk_mark');
  assert.ok(mark && Math.abs(mark.root.position.z + 3) < 0.05);
  assert.equal(world.run.placed.size, 1);
  assert.ok(useHeld(gp));
  assert.equal(gp.inventory.held, null, 'used up');
  game.player.pitch = -1.2;
  game.camera.position.z = 5;
  gp.inventory.add('chalk');
  assert.ok(useHeld(gp));
  assert.ok(world.objects.instances.some((i) => i.id === 'chalk_mark_floor'));
});

test('verbs: interact once / cooldown and the ctx rng is deterministic', () => {
  const { gp, world } = fakeGame();
  const phone = world.objects.spawn('old_phone', { x: 0, y: 0.7, z: -1 }, 0, { roomKey: 'roomA', fixed: 0 });
  phone.def = { ...phone.def, components: { ...phone.def.components, interact: { ...phone.def.components.interact, cooldown: 5 } } };
  assert.ok(interact(gp, phone));
  assert.equal(interact(gp, phone), false, 'cooling down');
  gp.game.time += 6;
  assert.ok(interact(gp, phone));
  phone.def.components.interact.once = true;
  phone.state.usedOnce = true;
  assert.equal(interact(gp, phone), false);
  const a = fakeGame(), b = fakeGame();
  const pa = a.world.objects.spawn('old_phone', { x: 0, y: 0, z: -1 }, 0, {});
  const pb = b.world.objects.spawn('old_phone', { x: 0, y: 0, z: -1 }, 0, {});
  interact(a.gp, pa); interact(b.gp, pb); a.gp.update(1); b.gp.update(1);
  assert.equal(a.events.of('ui:caption')[0].text, b.events.of('ui:caption')[0].text);
});
