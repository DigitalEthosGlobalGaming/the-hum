// The four pockets (PLAN.md §5.1). Pure logic: no DOM, no Three, so Node tests can drive it.
// API is fixed by src/CONTRACTS.md. Every change emits `inventory:change { slots, selected }`.
//
// ItemStack = { id, def, state: {} }. An item whose def has `components.pickup.size: 2` takes two
// neighbouring slots: the SAME stack object sits in both, and `stack.slot` is its first index.
export class Inventory {
  /**
   * @param {object} opts
   * @param {number} opts.size     number of slots (cfg.inventory.slots)
   * @param {object} opts.defs     content.objects (id → def)
   * @param {{emit:Function}} [opts.events]
   */
  constructor({ size = 4, defs = {}, events = null } = {}) {
    this.size = size;
    this.defs = defs;
    this.events = events;
    this.slots = new Array(size).fill(null);
    this.selected = 0;
  }

  get held() { return this.slots[this.selected] ?? null; }

  /** Pocket slots an item takes (1 or 2). */
  sizeOf(id) {
    const s = this.defs[id]?.components?.pickup?.size;
    return s === 2 ? 2 : 1;
  }

  /** First index where an item of this id fits, preferring `prefer` (e.g. the selected slot), or -1. */
  freeIndexFor(id, prefer = null) {
    const n = this.sizeOf(id);
    const fits = (i) => i >= 0 && i + n <= this.size && this.slots.slice(i, i + n).every((s) => s === null);
    if (prefer != null && fits(prefer)) return prefer;
    for (let i = 0; i < this.size; i++) if (fits(i)) return i;
    return -1;
  }

  canAdd(id) { return this.freeIndexFor(id) >= 0; }

  /**
   * Put an item in the first free slot (or `opts.index` if it fits there).
   * @returns {boolean} false when there's no room (caller emits inventory:full)
   */
  add(id, state = {}, opts = {}) {
    const def = this.defs[id];
    if (!def) return false;
    const i = this.freeIndexFor(id, opts.index ?? null);
    if (i < 0) return false;
    const stack = { id, def, state: state ?? {}, slot: i };
    for (let k = 0; k < this.sizeOf(id); k++) this.slots[i + k] = stack;
    if (opts.select) this.selected = i;
    this.changed();
    return true;
  }

  /** Take the stack out of a slot (both halves for size-2 items). */
  remove(index) {
    const stack = this.slots[index];
    if (!stack) return null;
    for (let i = 0; i < this.size; i++) if (this.slots[i] === stack) this.slots[i] = null;
    this.changed();
    return stack;
  }

  /** First stack with this id. */
  find(id) {
    for (let i = 0; i < this.size; i++) {
      const stack = this.slots[i];
      if (stack && stack.id === id) return { index: i, stack };
    }
    return null;
  }

  /** Index of a stack object, or -1. */
  indexOf(stack) { return stack ? this.slots.indexOf(stack) : -1; }

  select(index) {
    const i = ((index % this.size) + this.size) % this.size;
    if (i === this.selected) return;
    this.selected = i;
    this.changed();
  }

  /** Step the selection by ±1 with wrap-around, skipping the second half of a 2-slot item. */
  step(dir) {
    const cur = this.slots[this.selected];
    let i = this.selected;
    for (let n = 0; n < this.size; n++) {
      i = (((i + dir) % this.size) + this.size) % this.size;
      const s = this.slots[i];
      if (s && (s === cur || s.slot !== i)) continue; // same item, or the second half of a 2-slot item
      break;
    }
    this.select(i);
  }

  /** Call after mutating a stack's state in place so listeners can refresh. */
  changed() {
    this.events?.emit('inventory:change', { slots: this.slots, selected: this.selected });
  }

  /** Plain snapshot for saves (M8): [{ id, state, slot }] + selected. */
  serialize() {
    const seen = new Set();
    const items = [];
    for (const s of this.slots) if (s && !seen.has(s)) { seen.add(s); items.push({ id: s.id, state: s.state, slot: s.slot }); }
    return { selected: this.selected, items };
  }
}
