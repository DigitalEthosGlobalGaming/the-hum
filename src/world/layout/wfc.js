// Small generic WFC solver over variables with bitmask domains (simple tiled model).
//
// - Each variable i has a list of values with weights; its domain is a bitset over them.
// - Binary constraints come from compat(i, a, j, b) between declared neighbours.
//   Support masks are precomputed: allowed(j) = OR of support[i→j][a] over a in D(i),
//   then D(j) &= allowed and j is re-queued if it changed (arc consistency, AC-3 style).
// - Observe the undecided variable with the lowest weighted Shannon entropy
//   (ties within EPS → lowest index), pick a value by weight with that variable's own Rng.
// - Contradiction → bounded undo stack (each frame stores only the domains it changed),
//   ban the failed value and continue. Past the budget the caller falls back.

const EPS = 1e-9;

const words = (n) => Math.max(1, Math.ceil(n / 32));
const has = (bs, a) => (bs[a >>> 5] >>> (a & 31)) & 1;
const set1 = (bs, a) => { bs[a >>> 5] |= 1 << (a & 31); };
const clr1 = (bs, a) => { bs[a >>> 5] &= ~(1 << (a & 31)); };
function popcount(bs) {
  let n = 0;
  for (let k = 0; k < bs.length; k++) {
    let v = bs[k];
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}
function firstBit(bs) {
  for (let k = 0; k < bs.length; k++) if (bs[k]) return k * 32 + (31 - Math.clz32(bs[k] & -bs[k]));
  return -1;
}

/**
 * @param vars        [{ weights: number[], rng: Rng, classes?: string[] }] one per variable;
 *                    optional classes[a] groups values that compat treats identically (speed only)
 * @param neighbours  number[][] adjacency (symmetric)
 * @param compat      (i, a, j, b) → boolean  (must be symmetric: compat(i,a,j,b) === compat(j,b,i,a))
 * @param constrained (i, j) → boolean, optional: false means every pair is compatible (skips compat calls)
 * @param maxBacktracks  undo budget before giving up
 * @returns { ok, choice: number[], contradictions, backtracks }
 */
export function solveWfc({ vars, neighbours, compat, constrained = () => true, maxBacktracks = 64 }) {
  const n = vars.length;
  const dom = vars.map((v) => {
    const bs = new Uint32Array(words(v.weights.length));
    v.weights.forEach((w, a) => { if (w > 0) set1(bs, a); });
    return bs;
  });
  // classMasks[j]: class key → { rep: one value index, mask: all values of that class }
  const classMasks = vars.map((v) => {
    if (!v.classes) return null;
    const m = new Map();
    v.classes.forEach((c, b) => {
      let e = m.get(c);
      if (!e) m.set(c, (e = { rep: b, mask: new Uint32Array(words(v.weights.length)) }));
      set1(e.mask, b);
    });
    return m;
  });
  // support[i][k][a] = bitset over values of neighbours[i][k] compatible with value a of i
  const support = vars.map((v, i) => neighbours[i].map((j) => {
    const nb = vars[j].weights.length;
    if (!constrained(i, j)) {
      const all = new Uint32Array(words(nb));
      for (let b = 0; b < nb; b++) set1(all, b);
      return v.weights.map(() => all);
    }
    // values with the same class key behave identically, so compat runs once per class pair
    const ci = v.classes, cj = classMasks[j];
    const byClass = new Map();
    return v.weights.map((_, a) => {
      const key = ci ? ci[a] : a;
      let bs = byClass.get(key);
      if (bs) return bs;
      bs = new Uint32Array(words(nb));
      if (cj) {
        for (const [, { rep, mask }] of cj) {
          if (compat(i, a, j, rep)) for (let w = 0; w < bs.length; w++) bs[w] |= mask[w];
        }
      } else {
        for (let b = 0; b < nb; b++) if (compat(i, a, j, b)) set1(bs, b);
      }
      byClass.set(key, bs);
      return bs;
    });
  }));

  const stack = [];
  let contradictions = 0, backtracks = 0;
  const record = (i) => {
    const f = stack[stack.length - 1];
    if (f && !f.diffs.has(i)) f.diffs.set(i, dom[i].slice());
  };

  function propagate(start) {
    const queue = [...start];
    const queued = new Uint8Array(n);
    for (const i of queue) queued[i] = 1;
    while (queue.length) {
      const i = queue.shift();
      queued[i] = 0;
      const nb = neighbours[i];
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k];
        const allowed = new Uint32Array(dom[j].length);
        const sup = support[i][k];
        const di = dom[i];
        for (let a = 0; a < sup.length; a++) {
          if (!has(di, a)) continue;
          const s = sup[a];
          for (let w = 0; w < allowed.length; w++) allowed[w] |= s[w];
        }
        let changed = false, empty = true;
        const dj = dom[j];
        for (let w = 0; w < dj.length; w++) {
          const nv = (dj[w] & allowed[w]) >>> 0;
          if (nv !== dj[w]) { if (!changed) { record(j); changed = true; } dj[w] = nv; }
          if (nv) empty = false;
        }
        if (empty) return false;
        if (changed && !queued[j]) { queued[j] = 1; queue.push(j); }
      }
    }
    return true;
  }

  function entropy(i) {
    const ws = vars[i].weights;
    let sw = 0, swl = 0;
    for (let a = 0; a < ws.length; a++) {
      if (!has(dom[i], a)) continue;
      sw += ws[a];
      swl += ws[a] * Math.log(ws[a]);
    }
    return Math.log(sw) - swl / sw;
  }

  function pick(i) {
    const ws = vars[i].weights;
    let total = 0;
    for (let a = 0; a < ws.length; a++) if (has(dom[i], a)) total += ws[a];
    let roll = vars[i].rng.next() * total;
    let last = -1;
    for (let a = 0; a < ws.length; a++) {
      if (!has(dom[i], a)) continue;
      last = a;
      roll -= ws[a];
      if (roll < 0) return a;
    }
    return last;
  }

  const fail = () => ({ ok: false, choice: null, contradictions, backtracks });

  if (!propagate([...Array(n).keys()])) { contradictions++; return fail(); }
  for (;;) {
    let best = -1, bestH = Infinity;
    for (let i = 0; i < n; i++) {
      if (popcount(dom[i]) < 2) continue;
      const h = entropy(i);
      if (h < bestH - EPS) { bestH = h; best = i; }
    }
    if (best < 0) break;
    const value = pick(best);
    stack.push({ v: best, value, diffs: new Map() });
    record(best);
    dom[best].fill(0);
    set1(dom[best], value);
    let ok = propagate([best]);
    while (!ok) {
      contradictions++;
      if (++backtracks > maxBacktracks) return fail();
      const f = stack.pop();
      if (!f) return fail();
      for (const [i, old] of f.diffs) dom[i] = old;
      record(f.v); // the ban belongs to the parent frame (or is permanent at the root)
      clr1(dom[f.v], f.value);
      ok = popcount(dom[f.v]) > 0 && propagate([f.v]);
    }
  }
  return { ok: true, choice: dom.map(firstBit), contradictions, backtracks };
}
