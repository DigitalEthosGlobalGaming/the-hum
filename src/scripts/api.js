// The `ctx` handed to item scripts: a small, safe API over the engine (PLAN.md §4.4).
// Scripts never touch `game` directly. Everything here goes through the Gameplay runtime `gp`
// (src/gameplay/gameplay.js), which owns persistence, timers and events.
//
// A script's run(ctx, params) returns ctx.ok({ consume? }) or ctx.fail(message).
// Returning nothing counts as ok() with the component's default consume.
import { Rng, hash } from '../core/rng.js';
import { getScript } from './registry.js';
import { yawFacing } from '../gameplay/placement.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Run a script by id.
 * @param gp  Gameplay runtime
 * @param {string} id  script id
 * @param {object} o  { self, other?, params?, verb? } — self/other are world insts or ItemStacks
 * @returns {{ ok: boolean, consume?: any, message?: string }}
 */
export function runScript(gp, id, o = {}) {
  const script = getScript(id);
  if (!script) {
    console.warn(`[scripts] unknown script "${id}"`);
    return { ok: false, message: `unknown script ${id}` };
  }
  const ctx = makeCtx(gp, { ...o, scriptId: id });
  let res;
  try {
    res = script.run(ctx, ctx.params);
  } catch (e) {
    console.error(`[scripts] ${id} threw`, e);
    return { ok: false, message: String(e?.message ?? e) };
  }
  return res && typeof res === 'object' && 'ok' in res ? res : { ok: true };
}

/** Build the ctx object for one script call. Exported for tests and future room/anomaly scripts. */
export function makeCtx(gp, { self = null, other = null, params = {}, scriptId = '?', verb = null } = {}) {
  const game = gp.game;
  const uid = self?.uid ?? self?.id ?? 0; // world inst uid, or the item id for pocket items
  const callNo = gp.nextCall(uid);

  const ctx = {
    scriptId,
    verb,                    // 'interact' | 'use' | 'combine'
    self,                    // world inst or ItemStack ({ id, def, state })
    other,                   // the partner in a combine
    params: params ?? {},
    get time() { return game.time; },

    player: {
      get pos() { const p = game.player.pos; return { x: p.x, y: p.y, z: p.z }; },
      get eye() { const c = game.camera.position; return { x: c.x, y: c.y, z: c.z }; },
      get yaw() { return game.player.yaw; },
      get pitch() { return game.player.pitch; },
      forward: () => gp.viewDir(),
    },

    inventory: {
      get held() { return gp.inventory.held; },
      get slots() { return gp.inventory.slots; },
      get selected() { return gp.inventory.selected; },
      add: (id, state, opts) => gp.inventory.add(id, state, opts),
      remove: (index) => gp.inventory.remove(index),
      find: (id) => gp.inventory.find(id),
      has: (id) => !!gp.inventory.find(id),
      select: (i) => gp.inventory.select(i),
      changed: () => gp.inventory.changed(),
    },

    world: {
      /** Spawn an object. opts.persist keeps it across room streaming (world.run.placed). */
      spawn: (id, pos, rotY = 0, opts = {}) => gp.spawn(id, pos, rotY, opts),
      remove: (inst) => gp.removeInst(inst),
      findById: (id) => gp.instances().filter((i) => i.id === id),
      findByTag: (tag) => gp.instances().filter((i) => i.def.tags?.includes(tag)),
      /** Instances within `radius` metres of `pos` (default: the player), nearest first. */
      nearby: (radius = 4, pos = null) => gp.nearby(pos ?? game.player.pos, radius),
      /** First wall / floor along the view ray: { surface, point, normal, distance } | null */
      castFromEye: (maxDist = 2) => gp.castFromEye(maxDist),
      dropPoint: () => gp.dropPoint(),
      isSolidAt: (x, z) => game.world.isSolidAt(x, z),
      roomAt: (x, z) => game.world.roomAt(x, z),
      yawFacing,
    },

    sound: {
      /** opts: { at: inst | 'player' | {x,y,z}, volume, loop }. Default position: self if it's in the world. */
      play: (preset, opts = {}) => gp.playSound(preset, opts, self),
      /** Stop an object's own `sound` component (e.g. a ringing phone) and keep it from re-firing. */
      stopObject: (inst) => gp.stopObjectSound(inst),
    },

    ui: {
      caption: (text, seconds, key) => gp.caption(text, seconds, key),
      clearCaption: (key) => gp.clearCaption(key),
      watchBeep: (text) => game.events.emit('ui:watchBeep', text != null ? { text } : {}),
      read: (title, text, display = 'inspect', noteId) =>
        game.events.emit('readable:open', { title, text, display, ...(noteId ? { noteId } : {}) }),
    },

    stats: {
      add(name, n) {
        if (name !== 'sanity' && name !== 'stamina') return;
        game.stats[name] = clamp01((game.stats[name] ?? 0) + n);
      },
      get: (name) => game.stats[name],
    },

    flashlight: game.flashlight,

    notes: {
      /** The note a readable inst / note stack resolved to, or null. */
      of: (target) => gp.noteOf(target),
      collected: (id) => gp.notesCollected.has(id),
    },

    rng: new Rng(hash(game.seed >>> 0, 'script', scriptId, uid, callNo)),

    state: {
      self: gp.stateOf(self),     // per-instance (persists per run for world objects, travels with items)
      other: gp.stateOf(other),
      run: gp.runState,           // per-run scratch shared by every script
    },

    timer: {
      /** Call fn after `sec` seconds of play time (paused while not playing). Returns a cancel fn. */
      after: (sec, fn) => gp.after(sec, fn),
    },

    ok: (opts = {}) => ({ ok: true, ...opts }),
    fail(message) {
      if (message) gp.caption(message);
      return { ok: false, message };
    },
  };
  return ctx;
}
