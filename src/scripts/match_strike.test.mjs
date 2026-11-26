// node --test src/scripts/match_strike.test.mjs
// Matches through the real use path (Gameplay + useHeld + the match_strike script + a real World's
// power network): light, count, sound, calm in the dark, one match at a time, candles.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadContent } from '../../tools/lib/loadContent.mjs';
import '../extensions.js'; // prefabs, as main.js does
import { World } from '../world/world.js';
import '../power/register.js';
import { Gameplay } from '../gameplay/gameplay.js';
import { useHeld } from '../interaction/interaction.js';

const { content } = loadContent();

function setup() {
  const log = [];
  const events = { emit: (n, p) => log.push([n, p]), on: () => () => {} };
  const world = new World({ content, textures: { get: () => new THREE.Texture() }, scene: new THREE.Scene(), audio: null, seed: 1234567, events: null });
  const { pos } = world.start();
  world.power.running = true;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(pos.x, 1.6, pos.z);
  const sounds = [];
  const game = {
    cfg: content.config, content, seed: 1234567, events, world, camera, time: 0,
    player: { pos, yaw: 0, pitch: 0 },
    stats: { sanity: 0.5, stamina: 1 },
    synth: { play: (id, o) => { sounds.push([id, o]); return { stop: () => sounds.push(['stop', id]) }; } },
  };
  const gp = new Gameplay(game);
  game.gameplay = gp;
  const ctx = { camera, time: 0, player: { pos } };
  const step = (sec, dt = 0.05) => { for (let s = 0; s < sec; s += dt) { ctx.time += dt; world.update(dt, ctx); timers(gp, dt); } };
  return { game, gp, world, pos, step, sounds, log };
}

// Gameplay.update is wrapped by feature modules (story, Tenant, secrets) that need a full game:
// tick only the script timers here, the way Gameplay.update does.
function timers(gp, dt) {
  const due = [];
  for (const t of gp.timers) { t.left -= dt; if (t.left <= 0 && !t.dead) { t.dead = true; due.push(t); } }
  gp.timers = gp.timers.filter((t) => !t.dead);
  for (const t of due) t.fn();
}

test('matches: a strike makes a warm flickering light that follows you, then burns out', () => {
  const { game, gp, world, pos, step, sounds } = setup();
  world.power.toggleSwitch(pos); // dark room
  step(0.3);
  const eye = { x: pos.x, y: 1.5, z: pos.z };
  const before = world.lightAt(eye);
  gp.inventory.add('matches', {}, { index: 0, select: true });
  assert.ok(useHeld(gp), 'use reaches the script');
  const L = world.power.timed.lights.find((l) => l.kind === 'match');
  assert.ok(L, 'a match light in the per-vertex light pool');
  assert.ok(L.range >= 5 && L.flicker > 0 && L.color[0] > 1, 'bright enough to read, and flickering');
  step(0.1);
  assert.ok(world.lightAt(eye) > before + 0.2, 'it lights you up');
  assert.ok(game.stats.sanity > 0.5, 'a little calmer in the dark');
  assert.deepEqual(sounds.filter((s) => s[0] !== 'stop').map((s) => s[0]).slice(0, 2), ['match_strike', 'match_burn']);
  assert.equal(gp.inventory.held.state.uses, 9, 'one match used');
  step(12.5);
  assert.equal(world.power.timed.lights.filter((l) => l.kind === 'match').length, 0, 'burnt out (~12 s)');
  assert.ok(sounds.some((s) => s[0] === 'stop' && s[1] === 'match_burn'), 'the burning sound stops');
});

test('matches: one at a time; the last one empties the box', () => {
  const { gp, world, step } = setup();
  gp.inventory.add('matches', { uses: 2 }, { index: 0, select: true });
  useHeld(gp);
  step(1);
  useHeld(gp);
  step(0.1);
  assert.equal(world.power.timed.lights.filter((l) => l.kind === 'match').length, 1, 'a fresh strike snuffs the old one');
  assert.equal(gp.inventory.held, null, 'the empty box is gone');
});

test('matches: a candle nearby takes the flame', () => {
  const { gp, world, pos, log } = setup();
  const c = world.objects.spawn('candle', new THREE.Vector3(pos.x + 0.8, 0, pos.z), 0, { roomKey: world.roomAt(pos.x, pos.z).key, placedKey: 'placed:c' });
  gp.inventory.add('matches', {}, { index: 0, select: true });
  useHeld(gp);
  assert.ok(world.power.objState(c).lit);
  assert.ok(log.some(([n, p]) => n === 'ui:caption' && /wick/.test(p.text)));
});
