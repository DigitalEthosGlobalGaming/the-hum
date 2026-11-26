// Wet footprints: the pure bookkeeping (no Three.js). A fixed ring of slots; the oldest print is
// overwritten when it's full, prints of a room that streams out are cleared, and each print's
// opacity is strength (fainter the further from the puddle) × a slow fade over its life.
// Drawing lives in ./footprintMesh.js; the per-step logic in ./system.js.

/** Strength of the i-th print after leaving a puddle (i = 0 the first), of `steps` total. */
export function trailStrength(i, steps, minStrength = 0.2) {
  if (steps <= 1) return 1;
  const t = Math.min(1, Math.max(0, i / (steps - 1)));
  return 1 - (1 - minStrength) * t;
}

/**
 * Opacity multiplier for a print of age `age` s with lifetime `life`: full for the first `hold`
 * fraction, then eases out to 0 at `life`.
 */
export function lifeFade(age, life, hold = 0.25) {
  if (age <= 0) return 1;
  if (age >= life) return 0;
  const t = age / life;
  if (t <= hold) return 1;
  const u = (t - hold) / (1 - hold);
  return (1 - u) * (1 - u * 0.5); // slightly faster at the end than the start
}

/**
 * Where a print goes: `side` -1 = left foot, +1 = right. `dirX, dirZ` = unit walking direction.
 * Returns { x, z, rot } with rot = rotation.y so the print's local -z points along the walk.
 */
export function placePrint(x, z, dirX, dirZ, side, sideOffset = 0.1) {
  // the player's right when walking along (dirX, dirZ) is (-dirZ, dirX)
  // (forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw); see src/player/player.js)
  const rx = -dirZ, rz = dirX;
  return {
    x: x + rx * side * sideOffset,
    z: z + rz * side * sideOffset,
    rot: Math.atan2(-dirX, -dirZ),
  };
}

export class FootprintRing {
  /** @param capacity max prints alive at once */
  constructor(capacity = 64) {
    this.capacity = Math.max(1, capacity | 0);
    this.slots = Array.from({ length: this.capacity }, (_, i) => ({
      i, alive: false, x: 0, z: 0, rot: 0, side: 1, strength: 0, born: 0, life: 1, roomKey: null, alpha: 0,
    }));
    this.next = 0;          // ring cursor: the slot the next print takes
    this.count = 0;         // alive prints
    this.dirty = new Set(); // slot indices whose geometry changed since the last takeDirty()
  }

  /** Add a print; returns its slot (the oldest one is reused when full). */
  add({ x, z, rot = 0, side = 1, strength = 1, born = 0, life = 45, roomKey = null }) {
    const s = this.slots[this.next];
    this.next = (this.next + 1) % this.capacity;
    if (!s.alive) this.count++;
    Object.assign(s, { alive: true, x, z, rot, side, strength, born, life, roomKey, alpha: strength });
    this.dirty.add(s.i);
    return s;
  }

  kill(s) {
    if (!s.alive) return;
    s.alive = false;
    s.alpha = 0;
    s.roomKey = null;
    this.count--;
    this.dirty.add(s.i);
  }

  /** Clear every print that belongs to `roomKey` (its room streamed out). Returns how many. */
  dropRoom(roomKey) {
    let n = 0;
    for (const s of this.slots) if (s.alive && s.roomKey === roomKey) { this.kill(s); n++; }
    return n;
  }

  clear() { for (const s of this.slots) this.kill(s); }

  /**
   * Recompute every alive print's alpha at time `now` and free the ones that faded out.
   * `hold` = lifeFade's hold fraction. Returns the number alive.
   */
  update(now, hold = 0.25) {
    for (const s of this.slots) {
      if (!s.alive) continue;
      const a = s.strength * lifeFade(now - s.born, s.life, hold);
      if (a <= 0.004) { this.kill(s); continue; }
      s.alpha = a;
    }
    return this.count;
  }

  /** Strongest alive print within `radius` of (x, z) → its alpha, or 0. */
  wetnessNear(x, z, radius) {
    let best = 0;
    const r2 = radius * radius;
    for (const s of this.slots) {
      if (!s.alive || s.alpha <= best) continue;
      const dx = s.x - x, dz = s.z - z;
      if (dx * dx + dz * dz <= r2) best = s.alpha;
    }
    return best;
  }

  /** Slot indices changed since the last call (positions to rewrite). */
  takeDirty() {
    const d = [...this.dirty];
    this.dirty.clear();
    return d;
  }
}
