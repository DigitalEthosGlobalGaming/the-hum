// Seeded randomness we own (procedural-gen skill: never Math.random in generation,
// derive a child seed per system/position so adding one roll doesn't reshuffle the world).
// Pure functions, no DOM: shared by the game and the Node tools.

// 32-bit string/number hash (FNV-1a over the parts), stable across engines.
export function hash(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'number' ? String(p | 0) + '#' : String(p) + '|';
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  // final avalanche (murmur3 fmix32)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// sfc32 PRNG. Output sequence is pinned by tests/tools; don't change it casually.
export class Rng {
  constructor(seed) {
    const s = typeof seed === 'number' ? seed >>> 0 : hash(seed);
    this.a = 0x9e3779b9; this.b = 0x243f6a88; this.c = 0xb7e15162; this.d = s;
    for (let i = 0; i < 12; i++) this.nextU32(); // warm up
  }
  nextU32() {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }
  /** float in [0, 1) */
  next() { return this.nextU32() / 4294967296; }
  /** integer in [min, max] inclusive */
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  range(min, max) { return min + this.next() * (max - min); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** child generator for a named sub-system */
  child(...parts) { return new Rng(hash(this.d, ...parts)); }
}
