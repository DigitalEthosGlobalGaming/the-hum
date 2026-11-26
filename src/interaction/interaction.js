// Interaction verbs (PLAN.md §5): E = interact with the focused object, Mouse0/R = use the held
// item, G = drop it, 1–4 / wheel = select a pocket. Presentation is M5's: we only emit events.
//
// E priority on the focused inst:
//   a) combine: held item ↔ target (rules on either side)   b) interact component
//   c) readable                                              d) pickup
import { findCombine, consumeSides } from './combine.js';
import { runScript } from '../scripts/api.js';
import { physicsOf } from '../physics/hooks.js';

const BUILTIN = { flashlight: { id: 'flashlight', name: 'flashlight' } }; // engine items with no pocket

/** Per-frame input → verbs. Call only while playing. */
export function handleInput(gp) {
  const { input } = gp.game;
  const physics = physicsOf(gp); // (creates the physics system on first use)
  if (gp.inputBlocked || gp.game.paused) return;
  const inv = gp.inventory;
  for (let k = 1; k <= inv.size; k++) if (input.wasPressed(`slot${k}`)) inv.select(k - 1);
  if (input.wasPressed('slotNext')) inv.step(1);
  if (input.wasPressed('slotPrev')) inv.step(-1);
  if (physics?.handleInput(gp)) return; // a held-in-front prop owns E / G / use; throw key throws
  if (input.wasPressed('interact')) interact(gp, gp.game.focus?.inst ?? null);
  if (input.wasPressed('use')) useHeld(gp);
  if (input.wasPressed('drop')) dropHeld(gp);
}

/** What pressing E on `inst` would do: { verb, kind } | null. For M5's verb tag on the hand. */
export function verbFor(gp, inst) {
  const physics = physicsOf(gp);
  if (physics?.carried) return physics.verbFor(inst); // E · put down while your hands are full
  if (!inst) return null;
  const held = gp.inventory.held;
  const comps = inst.def.components ?? {};
  if (held && findCombine(held.id, held.def, inst.id, inst.def)) return { verb: 'use ' + (held.def.name ?? held.id), kind: 'combine' };
  if (comps.interact) return { verb: comps.interact.verb ?? 'use', kind: 'interact' };
  if (inst.readable) return { verb: 'read', kind: 'readable' };
  if (comps.pickup) return { verb: 'take', kind: 'pickup' };
  return physics?.verbFor(inst) ?? null; // E · carry / E · push (physics props)
}

/** E on a world instance. Returns true if something happened. */
export function interact(gp, inst) {
  const physics = physicsOf(gp);
  if (physics?.carried) return physics.interact(inst);
  if (!inst) return false;
  const inv = gp.inventory;
  const held = inv.held;
  const comps = inst.def.components ?? {};
  if (held) {
    const match = findCombine(held.id, held.def, inst.id, inst.def);
    if (match) return combine(gp, { stack: held }, { inst }, match);
  }
  if (comps.interact) return doInteract(gp, inst, comps.interact);
  if (inst.readable) return doRead(gp, inst);
  if (comps.pickup) return pickup(gp, inst);
  return physics?.interact(inst) ?? false; // carry / push (physics props)
}

function doInteract(gp, inst, c) {
  const st = gp.stateOf(inst);
  const now = gp.game.time;
  if (c.once && st.usedOnce) return false;
  if (c.cooldown && st.lastUsed != null && now - st.lastUsed >= 0 && now - st.lastUsed < c.cooldown) return false;
  if (!c.script) return false;
  const res = runScript(gp, c.script, { self: inst, params: c.params, verb: 'interact' });
  if (!res.ok) return false;
  st.lastUsed = now;
  if (c.once) {
    st.usedOnce = true;
    const comps = inst.def.components;
    if (!comps.readable && !comps.pickup && !comps.combine) inst.interactive = false; // nothing left to do here
  }
  if (res.consume === true) gp.removeInst(inst);
  return true;
}

function doRead(gp, inst) {
  const r = gp.resolveReadable(inst);
  if (!r) return false;
  const { events } = gp.game;
  if (r.display === 'notebook') gp.playSound('paper_rustle', { volume: 0.5 }, inst);
  events.emit('readable:open', { inst, title: r.title, text: r.text, display: r.display, ...(r.noteId ? { noteId: r.noteId } : {}) });
  if (r.display === 'notebook') {
    if (r.noteId && !gp.notesCollected.has(r.noteId)) {
      gp.notesCollected.add(r.noteId);
      events.emit('note:collected', { noteId: r.noteId, title: r.title, text: r.text });
    }
    if (inst.def.components?.pickup) pickup(gp, inst);
  }
  return true;
}

/** Put a world instance in the pockets. Emits item:pickup, or inventory:full. */
export function pickup(gp, inst) {
  const inv = gp.inventory;
  const index = inv.freeIndexFor(inst.id, inv.selected); // empty hand → it goes straight into it
  if (index < 0) {
    gp.game.events.emit('inventory:full', { id: inst.id });
    return false;
  }
  const state = { ...gp.stateOf(inst) };
  delete state.lastUsed; delete state.usedOnce;
  inv.add(inst.id, state, { index });
  const stack = inv.slots[index];
  gp.removeInst(inst);
  gp.game.events.emit('item:pickup', { id: stack.id, stack });
  return true;
}

/** Use the held item (its `use` component). Emits item:use on success. */
export function useHeld(gp) {
  const inv = gp.inventory;
  const held = inv.held;
  if (!held) return false;
  const u = held.def.components?.use;
  if (!u?.script) return false;
  if (u.requiresHeld && !hasItem(gp, u.requiresHeld)) {
    const name = gp.game.content.objects?.[u.requiresHeld]?.name ?? u.requiresHeld;
    gp.caption(`You need the ${name.toLowerCase()} for that.`);
    return false;
  }
  const res = runScript(gp, u.script, { self: held, params: u.params, verb: 'use' });
  if (!res.ok) return false;
  const consume = res.consume ?? u.consume;
  if (consume && consume !== 'none') {
    const i = inv.indexOf(held);
    if (i >= 0) inv.remove(i);
  } else if (inv.indexOf(held) >= 0) inv.changed(); // its state may have changed
  gp.game.events.emit('item:use', { id: held.id, stack: held });
  return true;
}

function hasItem(gp, id) {
  if (BUILTIN[id]) return id === 'flashlight' ? !!gp.game.flashlight : true;
  return !!gp.inventory.find(id);
}

/** Drop the held item about 0.8 m in front, on the floor, keeping its state. Emits item:drop. */
export function dropHeld(gp) {
  const inv = gp.inventory;
  const held = inv.held;
  if (!held) return false;
  const p = gp.dropPoint();
  inv.remove(inv.indexOf(held));
  gp.spawn(held.id, p, gp.game.player.yaw, { persist: true, state: held.state });
  gp.game.events.emit('item:drop', { id: held.id, stack: held });
  return true;
}

/**
 * Item + item from the pockets view (M5 calls game.gameplay.combineSlots(a, b)).
 * `b` may also be "flashlight" (the always-held torch, which has no pocket).
 * @returns {boolean} true if a rule matched and its script succeeded
 */
export function combineSlots(gp, a, b) {
  const inv = gp.inventory;
  const A = inv.slots[a];
  if (!A) return false;
  let partner;
  if (typeof b === 'string' && BUILTIN[b]) partner = { builtin: BUILTIN[b] };
  else {
    const B = inv.slots[b];
    if (!B || B === A) return false;
    partner = { stack: B };
  }
  const bId = partner.builtin?.id ?? partner.stack.id;
  const match = findCombine(A.id, A.def, bId, partner.stack?.def ?? null);
  if (!match) { gp.caption("Those don't go together."); return false; }
  return combine(gp, { stack: A }, partner, match);
}

// A party is { stack } (pocket item), { inst } (world object) or { builtin } (the flashlight).
const partyId = (p) => p.stack?.id ?? p.inst?.id ?? p.builtin?.id;
const partyTarget = (p) => p.stack ?? p.inst ?? null;

function combine(gp, A, B, { rule, owner }) {
  const inv = gp.inventory;
  const self = owner === 'a' ? A : B;
  const other = owner === 'a' ? B : A;
  const res = runScript(gp, rule.script, {
    self: partyTarget(self), other: partyTarget(other), params: rule.params, verb: 'combine',
  });
  if (!res.ok) return false;
  const sides = consumeSides(res.consume ?? rule.consume, owner);
  let freed = null;
  for (const [p, gone] of [[A, sides.a], [B, sides.b]]) {
    if (!gone) continue;
    if (p.stack) { const i = inv.indexOf(p.stack); if (i >= 0) { freed ??= i; inv.remove(i); } }
    else if (p.inst) gp.removeInst(p.inst);
  }
  if (rule.result) {
    // into your hand: the slot that just emptied, else the selected one, else anywhere
    const index = inv.freeIndexFor(rule.result, freed ?? inv.selected);
    if (index >= 0) inv.add(rule.result, {}, { index, select: true });
    else {
      gp.spawn(rule.result, gp.dropPoint(), gp.game.player.yaw, { persist: true });
      gp.game.events.emit('inventory:full', { id: rule.result });
    }
  } else {
    inv.changed(); // states may have changed
  }
  gp.game.events.emit('item:combine', { a: partyId(A), b: partyId(B), ...(rule.result ? { result: rule.result } : {}) });
  return true;
}
