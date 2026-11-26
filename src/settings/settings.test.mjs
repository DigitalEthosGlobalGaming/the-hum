// node --test src/settings/
// Settings: defaults, load / save / migrate, and blocked or broken storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_KEY, SETTINGS_VERSION, defaultsFrom, loadSettings, saveSettings, migrate, sanitize, toSlider, fromSlider, getStorage,
} from './settings.js';
import { installSettings } from './install.js';

class MemStorage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() {} };

const cfg = { ui: { textGrit: 0.4, textScale: 1, captions: true, textPrompts: true, reduceFlashing: false, fullscreenOnStart: true }, player: { mouseSensitivity: 0.0022 } };

test('defaults come from config.ui', () => {
  const d = defaultsFrom({ ui: { textGrit: 0.7, captions: false, fullscreenOnStart: false } });
  assert.equal(d.textGrit, 0.7);
  assert.equal(d.captions, false);
  assert.equal(d.fullscreen, false);
  assert.equal(d.calm, false);
  assert.equal(d.mouseSensitivity, 1);
});

test('round trip through storage', () => {
  const s = new MemStorage();
  const d = defaultsFrom(cfg);
  assert.equal(loadSettings(s, d).status, 'default');
  assert.ok(saveSettings(s, { ...d, calm: true, masterVolume: 0.3 }));
  const rec = JSON.parse(s.getItem(SETTINGS_KEY));
  assert.equal(rec.version, SETTINGS_VERSION);
  const back = loadSettings(s, d);
  assert.equal(back.status, 'ok');
  assert.equal(back.values.calm, true);
  assert.equal(back.values.masterVolume, 0.3);
});

test('blocked / missing / throwing storage: defaults, never throws', () => {
  const d = defaultsFrom(cfg);
  assert.deepEqual(loadSettings(null, d), { values: d, status: 'blocked' });
  assert.equal(loadSettings(throwing, d).status, 'blocked');
  assert.equal(saveSettings(throwing, d), false);
  assert.equal(saveSettings(null, d), false);
  assert.doesNotThrow(() => getStorage()); // Node: no localStorage → null (or a working one)
});

test('corrupt JSON and garbage values fall back per key', () => {
  const d = defaultsFrom(cfg);
  assert.equal(loadSettings(new MemStorage({ [SETTINGS_KEY]: '{nope' }), d).status, 'corrupt');
  assert.equal(loadSettings(new MemStorage({ [SETTINGS_KEY]: '[1,2]' }), d).status, 'corrupt');
  const rec = { version: 1, values: { masterVolume: 7, textGrit: 'x', calm: 'yes', invertY: true, mystery: 1 } };
  const { values, status } = loadSettings(new MemStorage({ [SETTINGS_KEY]: JSON.stringify(rec) }), d);
  assert.equal(status, 'ok');
  assert.equal(values.masterVolume, 1);           // clamped
  assert.equal(values.textGrit, d.textGrit);      // bad → default
  assert.equal(values.calm, false);
  assert.equal(values.invertY, true);
  assert.ok(!('mystery' in values));
});

test('migrates the unversioned v0 shape', () => {
  const d = defaultsFrom(cfg);
  const v0 = { sensitivity: 2, volume: { master: 0.5, ambience: 0.25, sfx: 0.1 }, captions: false };
  const { values, status } = migrate(v0, d);
  assert.equal(status, 'migrated');
  assert.equal(values.mouseSensitivity, 2);
  assert.equal(values.masterVolume, 0.5);
  assert.equal(values.ambienceVolume, 0.25);
  assert.equal(values.effectsVolume, 0.1);
  assert.equal(values.captions, false);
});

test('a newer record is read but flagged (and not overwritten by install)', () => {
  const d = defaultsFrom(cfg);
  const s = new MemStorage({ [SETTINGS_KEY]: JSON.stringify({ version: 99, values: { calm: true } }) });
  const r = loadSettings(s, d);
  assert.equal(r.status, 'newer');
  assert.equal(r.values.calm, true);
  const game = { cfg: structuredClone(cfg), events: null };
  const st = installSettings(game, { storage: s });
  assert.equal(st.persisted, false);
  st.set('calm', false);
  assert.equal(JSON.parse(s.getItem(SETTINGS_KEY)).version, 99);
});

test('sliders: log sensitivity, linear volume, round trips', () => {
  assert.equal(toSlider('masterVolume', 0.5), 0.5);
  assert.ok(Math.abs(fromSlider('mouseSensitivity', toSlider('mouseSensitivity', 1)) - 1) < 1e-9);
  assert.equal(fromSlider('mouseSensitivity', 0), 0.25);
  assert.equal(fromSlider('mouseSensitivity', 1), 3);
  assert.equal(sanitize({}).calm, false);
});

test('installSettings applies values, emits settings:change and works with storage blocked', () => {
  const emitted = [];
  const vols = {};
  const game = {
    cfg: structuredClone(cfg),
    input: {},
    synth: { setVolume: (b, v) => { vols[b] = v; } },
    events: { emit: (n, p) => emitted.push([n, p]) },
  };
  const st = installSettings(game, { storage: null });
  assert.equal(game.settings, st);
  assert.equal(st.status, 'blocked');
  assert.equal(st.persisted, false);
  assert.equal(game.input.sensitivity, 1);
  assert.equal(vols.master, 0.9);
  assert.equal(vols.tenant, 1);
  assert.ok(st.set('invertY', true));
  assert.equal(game.input.invertY, true);
  assert.ok(st.set('textScale', 1.3));
  assert.equal(game.cfg.ui.textScale, 1.3);
  assert.ok(st.set('effectsVolume', 0.4));
  assert.equal(vols.sfx, 0.4);
  assert.equal(st.set('calm', true), true);
  assert.equal(st.calm, true);
  assert.equal(st.set('calm', true), false);       // unchanged → no event
  assert.equal(st.set('nonsense', 1), false);
  assert.deepEqual(emitted.map(([n, p]) => [n, p.key]), [
    ['settings:change', 'invertY'], ['settings:change', 'textScale'], ['settings:change', 'effectsVolume'], ['settings:change', 'calm'],
  ]);
  assert.deepEqual(Object.keys(st).sort(), Object.keys(sanitize({})).sort()); // methods aren't enumerable
});
