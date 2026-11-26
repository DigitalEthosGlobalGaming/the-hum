// node --test src/ui/diegetic/escape.test.mjs
// Esc in the notebook hub (menu.onKeyDown) and the pointer-lock failure bookkeeping (core/input.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Menu } from './menu.js';
import { Input } from '../../core/input.js';
import { loadContent } from '../../../tools/lib/loadContent.mjs';

const { content } = loadContent();

function setup({ paused = false } = {}) {
  const calls = [];
  const game = {
    cfg: content.config, content, seed: 1, playing: !paused, paused,
    pausedAt: -Infinity, input: { locked: !paused }, stats: {}, synth: null,
    resume() { calls.push('resume'); this.paused = false; this.playing = true; },
  };
  const nb = { pages: [{ kind: 'map', id: 'map' }], version: 0, startFlip: () => calls.push('flip'), g: null };
  const menu = new Menu(game, nb);
  const key = (code) => menu.onKeyDown({ code, repeat: false });
  return { game, menu, calls, key };
}

test('Esc with the notebook open unpaused (the map) closes it and records when', () => {
  const { menu, key, calls } = setup();
  menu.show('map');
  assert.ok(menu.open);
  assert.equal(key('Escape'), true);
  assert.equal(menu.open, false);
  assert.ok(Number.isFinite(menu.escClosedAt), 'main uses this so the lost lock does not pause on top');
  assert.deepEqual(calls, []);
});

test('Esc while paused resumes (toggle); the Esc that paused is not counted twice', () => {
  const { game, menu, key, calls } = setup({ paused: true });
  menu.show('settings');
  game.pausedAt = performance.now();          // the same Esc echoing right after the pause
  key('Escape');
  assert.deepEqual(calls, [], 'too soon: ignored');
  game.pausedAt = performance.now() - 1000;
  key('Escape');
  assert.deepEqual(calls, ['resume']);
});

test('Esc while paused first lets go of a held slider / cancels "new tape", then resumes', () => {
  const { game, menu, key, calls } = setup({ paused: true });
  menu.show('settings');
  menu.held = true;
  key('Escape');
  assert.equal(menu.held, false);
  assert.deepEqual(calls, []);
  key('Escape');
  assert.deepEqual(calls, ['resume']);
  assert.equal(game.paused, false);
});

test('pointer lock: refusals without a gesture / in the cooldown do not force the drag fallback', () => {
  const inp = Object.create(Input.prototype);
  Object.assign(inp, { pointerLock: { state: 'idle', error: '' }, failures: 0, mode: 'lock', _req: null });
  const forgiven = { forgiven: true, failed: false };
  inp.lockFailed('NotAllowedError', forgiven);
  inp.lockFailed('pointerlockerror event', forgiven); // same request reported twice
  assert.equal(inp.mode, 'lock');
  assert.equal(inp.failures, 0);
  const real = { forgiven: false, failed: false };
  inp.lockFailed('NotAllowedError', real);
  inp.lockFailed('pointerlockerror event', real);
  assert.equal(inp.failures, 1, 'one request counts once');
  assert.equal(inp.mode, 'lock');
  inp.lockFailed('NotAllowedError', { forgiven: false, failed: false });
  assert.equal(inp.mode, 'drag', 'two real failures (e.g. a sandboxed iframe) → click-drag look');
});
