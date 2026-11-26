// Pooling helpers for environmental emitters. Pure and allocation-free in the steady state:
// the ambience system calls these a few times a second with arrays it owns.

/**
 * The k nearest candidates to (x, z) within `maxDist`, nearest first, written into `out`
 * (cleared first). Candidates need numeric `x`, `z`; `d2` is written on them as scratch.
 * Partial insertion sort: O(n·k), no allocation.
 */
export function nearestK(cands, n, x, z, k, maxDist, out) {
  out.length = 0;
  const max2 = maxDist * maxDist;
  for (let i = 0; i < n; i++) {
    const c = cands[i];
    const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (d2 > max2) continue;
    if (out.length === k && d2 >= out[k - 1].d2) continue;
    c.d2 = d2;
    let j = out.length < k ? out.length : k - 1;
    if (out.length < k) out.length++;
    while (j > 0 && out[j - 1].d2 > d2) { out[j] = out[j - 1]; j--; }
    out[j] = c;
  }
  return out;
}

/**
 * Re-assign a fixed set of slots to a wanted set of targets with as few moves as possible:
 * a slot keeps its target if it's still wanted; freed slots take the wanted targets nobody holds.
 * slots: [{ target, ... }]; wanted: [target] (identity compared). Calls onChange(slot, prevTarget)
 * for every slot whose target changed (including to null). Returns how many changed.
 */
export function assignSlots(slots, wanted, onChange) {
  let changed = 0;
  // 1. free slots whose target is no longer wanted
  for (const s of slots) {
    if (s.target != null && !wanted.includes(s.target)) {
      const prev = s.target;
      s.target = null;
      s._freed = prev;
    } else s._freed = undefined;
  }
  // 2. hand unheld wanted targets to free slots (prefer a slot that was just freed: it is already
  // fading out, so the move is hidden; then never-used ones)
  for (const t of wanted) {
    let held = false;
    for (const s of slots) if (s.target === t) { held = true; break; }
    if (held) continue;
    let pick = null;
    for (const s of slots) if (s.target == null && s._freed !== undefined) { pick = s; break; }
    if (!pick) for (const s of slots) if (s.target == null) { pick = s; break; }
    if (!pick) break;
    pick.target = t;
    const prev = pick._freed ?? null;
    pick._freed = undefined;
    changed++;
    onChange?.(pick, prev);
  }
  // 3. slots that were freed and got nothing new
  for (const s of slots) {
    if (s._freed !== undefined) {
      const prev = s._freed;
      s._freed = undefined;
      changed++;
      onChange?.(s, prev);
    }
  }
  return changed;
}

/**
 * Free-list pool of plain records. acquire() hands back a recycled record (fields reset by `reset`)
 * or a new one from `make`; release() returns it. `live` counts records in use.
 */
export class Pool {
  constructor(make, reset = null) {
    this.make = make;
    this.reset = reset;
    this.free = [];
    this.live = 0;
    this.made = 0;
  }
  acquire() {
    this.live++;
    const r = this.free.pop();
    if (r) { this.reset?.(r); return r; }
    this.made++;
    return this.make();
  }
  release(r) {
    this.live--;
    this.free.push(r);
  }
}
