// Weighted spawn pools. Chance of an entry = its weight ÷ sum of eligible weights.
// Pure logic (no DOM/Three): shared by the game spawner and tools/pool-sim.mjs.
//
// Pool forms accepted anywhere a pool is expected:
//   "pool_id"                                   → content.pools[pool_id]
//   [ {def, w}, ... ]                           → inline entries
//   { id?, rolls?, entries: [ ... ] }           → full pool object
// Entry fields:
//   def: "object_id" | null (null = nothing)    pool: "other_pool_id" (nested roll)
//   w: number > 0                                minDepth, maxDepth, zones: [..], unique: true

/** Normalise any pool form into { id, rolls, entries }. */
export function resolvePool(pool, pools) {
  if (typeof pool === 'string') {
    const p = pools?.[pool];
    if (!p) throw new Error(`Unknown pool "${pool}"`);
    return { id: p.id ?? pool, rolls: p.rolls ?? 1, entries: p.entries };
  }
  if (Array.isArray(pool)) return { id: '(inline)', rolls: 1, entries: pool };
  return { id: pool.id ?? '(inline)', rolls: pool.rolls ?? 1, entries: pool.entries };
}

/** Is this entry allowed in the current context? */
export function eligible(entry, ctx = {}) {
  if (!(entry.w > 0)) return false;
  if (entry.minDepth != null && (ctx.depth ?? 0) < entry.minDepth) return false;
  if (entry.maxDepth != null && (ctx.depth ?? 0) > entry.maxDepth) return false;
  if (entry.zones && ctx.zone && !entry.zones.includes(ctx.zone)) return false;
  if (entry.unique && entry.def && ctx.spawnedUnique?.has(entry.def)) return false;
  return true;
}

/** Pick one entry by weight from an entry list. Returns the entry or null if none eligible. */
export function pickEntry(entries, rng, ctx = {}) {
  let total = 0;
  for (const e of entries) if (eligible(e, ctx)) total += e.w;
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const e of entries) {
    if (!eligible(e, ctx)) continue;
    r -= e.w;
    if (r < 0) return e;
  }
  // float edge case: return the last eligible
  for (let i = entries.length - 1; i >= 0; i--) if (eligible(entries[i], ctx)) return entries[i];
  return null;
}

/**
 * Roll a pool. Returns an array of object ids (nulls removed).
 * ctx: { depth, zone, spawnedUnique: Set } — unique defs are added to spawnedUnique.
 */
export function rollPool(pool, pools, rng, ctx = {}, _depth = 0) {
  if (_depth > 8) throw new Error('Pool nesting deeper than 8 (cycle?)');
  const p = resolvePool(pool, pools);
  const out = [];
  for (let i = 0; i < p.rolls; i++) {
    const e = pickEntry(p.entries, rng, ctx);
    if (!e) continue;
    if (e.pool) {
      out.push(...rollPool(e.pool, pools, rng, ctx, _depth + 1));
    } else if (e.def) {
      if (e.unique) (ctx.spawnedUnique ??= new Set()).add(e.def);
      out.push(e.def);
    }
  }
  return out;
}

/** Expected probability of each outcome for one roll (flattens nested pools). For pool-sim. */
export function expectedOdds(pool, pools, ctx = {}, scale = 1, out = new Map(), _depth = 0) {
  const p = resolvePool(pool, pools);
  let total = 0;
  for (const e of p.entries) if (eligible(e, ctx)) total += e.w;
  if (total <= 0) return out;
  for (const e of p.entries) {
    if (!eligible(e, ctx)) continue;
    const pr = (e.w / total) * scale;
    if (e.pool && _depth < 8) expectedOdds(e.pool, pools, ctx, pr, out, _depth + 1);
    else out.set(e.def ?? null, (out.get(e.def ?? null) ?? 0) + pr);
  }
  return out;
}
