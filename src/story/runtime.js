// Story runtime: the live link between the story / container props and the running game.
//
// Feature modules can't see `game` at import time (src/extensions.js runs before main builds it), so
// src/story/register.js binds this runtime on the first gameplay frame (bindStory(gp)). After that:
//   - onReady(fn(game))           runs once, at bind (event subscriptions, scene objects)
//   - onUpdate(fn(dt, game, ctx)) runs every frame as a world system (world.addSystem)
//   - onInstance(id, fn(inst, game)) runs once for every instance of an object id the world spawns
//     (including rooms streaming back in), e.g. to give it a per-instance canvas texture
// Nothing here touches the DOM at import, so scripts that import story modules stay Node-testable.
// story.game is null until bound (and always null in Node tests): every caller must tolerate that.
import * as THREE from 'three';

export const story = { game: null, gp: null, time: 0 };

const readyFns = [];
const updateFns = [];
const instFns = new Map();
const temps = []; // temporary lights { L, left }

export function onReady(fn) { readyFns.push(fn); if (story.game) fn(story.game); }
export function onUpdate(fn) { updateFns.push(fn); }
export function onInstance(id, fn) {
  if (!instFns.has(id)) instFns.set(id, []);
  instFns.get(id).push(fn);
}

/** Bind to the live game (idempotent). Called by register.js from the first Gameplay.update. */
export function bindStory(gp) {
  if (story.gp === gp) return;
  story.gp = gp;
  const game = (story.game = gp.game);
  game.dangerLevel ??= 0; // 0..1, the Tenant (M6) sets it; the walkie-talkie static reads it
  game.world.addSystem({ update: (dt, ctx) => tick(dt, ctx) });
  for (const fn of readyFns) {
    try { fn(game); } catch (e) { console.error('[story] ready hook failed', e); }
  }
}

function tick(dt, ctx) {
  const game = story.game;
  if (!game) return;
  story.time = game.time;
  for (const inst of game.world.objects.instances) {
    if (inst._story) continue;
    inst._story = true;
    for (const fn of instFns.get(inst.id) ?? []) {
      try { fn(inst, game); } catch (e) { console.error(`[story] ${inst.id} setup failed`, e); }
    }
  }
  for (let i = temps.length - 1; i >= 0; i--) {
    const t = temps[i];
    t.left -= dt;
    if (t.fade) t.L.color.copy(t.base).multiplyScalar(Math.max(0, t.left / t.total));
    if (t.left <= 0) {
      const lights = game.world.objects.lights;
      const k = lights.indexOf(t.L);
      if (k >= 0) lights.splice(k, 1);
      temps.splice(i, 1);
    }
  }
  for (const fn of updateFns) {
    try { fn(dt, game, ctx); } catch (e) { console.error('[story] update failed', e); }
  }
}

// ---- small helpers over the bound game (all no-ops when unbound) ----

/** Persistent per-run state of a world inst or an item stack. */
export const stateOf = (t) => (t ? story.gp?.stateOf(t) ?? (t.state ??= {}) : null);
/** Per-run scratch shared by scripts (world.run.scriptState). */
export const runState = () => story.gp?.runState ?? (story._fallbackRun ??= {});
export const playing = () => !!story.game?.playing && !story.game?.paused;

export function caption(text, seconds, key) { story.gp?.caption(text, seconds, key); }

/** opts: { at: inst | {x,y,z}, volume, loop } (no `at` = in your hands). */
export function sound(preset, opts = {}) {
  return story.gp?.playSound(preset, opts, null) ?? null;
}

/**
 * A short-lived point light in the shared light pool (the nearest 12 lights reach the shaders).
 * @returns the light record (its `pos` may be moved while it lives)
 */
export function tempLight(pos, color, range, seconds, { fade = true } = {}) {
  const game = story.game;
  if (!game) return null;
  const L = { pos: new THREE.Vector3(pos.x, pos.y, pos.z), color: new THREE.Color(color), range, flicker: 0, seed: 0, temp: true };
  const base = L.color.clone();
  game.world.objects.lights.push(L);
  temps.push({ L, left: seconds, total: seconds, base, fade });
  return L;
}

/** Inventory slots (deduped) currently holding an item id. */
export function carried(id) {
  const inv = story.game?.inventory;
  if (!inv) return [];
  return [...new Set(inv.slots.filter((s) => s && s.id === id))];
}

/** Nearest-filtered canvas texture for a per-instance surface. */
export function canvasTex(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}
