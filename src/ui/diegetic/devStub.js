// DEV ONLY: a fake inventory matching the CONTRACTS.md shape so the pockets and the held item can
// be seen before M4 merges. Installed only when __DEV__ and game.inventory is missing.
export function installInventoryStub(game, ids = ['battery', 'almond_water', 'note_random']) {
  const defs = game.content.objects ?? {};
  const stack = (id, state = {}) => (defs[id] ? { id, def: defs[id], state } : null);
  const ev = game.events;
  const inv = {
    __stub: true,
    size: 4,
    slots: [0, 1, 2, 3].map((i) => (ids[i] ? stack(ids[i]) : null)),
    selected: 0,
    get held() { return this.slots[this.selected]; },
    changed() { ev.emit('inventory:change', { slots: this.slots, selected: this.selected }); },
    add(id, state) {
      const i = this.slots.indexOf(null);
      if (i < 0) { ev.emit('inventory:full', { id }); return false; }
      this.slots[i] = stack(id, state);
      ev.emit('item:pickup', { id, stack: this.slots[i] });
      this.changed();
      return true;
    },
    remove(i) { const s = this.slots[i]; this.slots[i] = null; this.changed(); return s; },
    find(id) { const index = this.slots.findIndex((s) => s?.id === id); return index < 0 ? null : { index, stack: this.slots[index] }; },
    select(i) { if (i === this.selected) return; this.selected = (i + 4) % 4; this.changed(); },
  };
  game.inventory = inv;
  return inv;
}

/** Drive the stub from the keys M4 will own: slot1-4, wheel, use. */
export function updateInventoryStub(game, raw) {
  const inv = game.inventory;
  if (!inv?.__stub || !game.playing) return;
  for (let i = 0; i < 4; i++) if (raw.wasPressed('slot' + (i + 1))) inv.select(i);
  if (raw.wasPressed('slotNext')) inv.select(inv.selected + 1);
  if (raw.wasPressed('slotPrev')) inv.select(inv.selected - 1);
}
