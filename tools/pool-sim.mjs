// Roll a spawn pool many times and compare the actual odds with the expected ones.
//   node tools/pool-sim.mjs <pool_id|all> [--n 100000] [--depth D] [--zone Z] [--seed S]
// Uses the game's own rollPool + seeded Rng, so what you see is what the spawner does.
import { loadContent } from './lib/loadContent.mjs';
import { rollPool, expectedOdds, resolvePool } from '../src/spawn/pools.js';
import { Rng } from '../src/core/rng.js';

const USAGE = 'usage: node tools/pool-sim.mjs <pool_id|all> [--n 100000] [--depth D] [--zone Z] [--seed S]';

function parseArgs(argv) {
  const opts = { n: 100000, depth: undefined, zone: undefined, seed: 'pool-sim', pool: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.split('=')[0];
    const val = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else if (name === '--n') opts.n = Number(val());
    else if (name === '--depth') opts.depth = Number(val());
    else if (name === '--zone') opts.zone = val();
    else if (name === '--seed') { const v = val(); opts.seed = /^\d+$/.test(v) ? Number(v) : v; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.pool = a;
  }
  if (!opts.pool) throw new Error('missing pool id');
  if (!(Number.isInteger(opts.n) && opts.n > 0)) throw new Error('--n must be a positive integer');
  if (opts.depth !== undefined && !Number.isFinite(opts.depth)) throw new Error('--depth must be a number');
  return opts;
}

const pct = (x) => (x * 100).toFixed(3) + '%';
const signed = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(3) + '%';

/** Simulate one pool. Returns rows sorted by expected odds. */
export function simulate(poolId, pools, { n, depth, zone, seed }) {
  const ctx = { depth, zone };
  const expected = expectedOdds(poolId, pools, ctx);
  const rolls = resolvePool(poolId, pools).rolls;
  const rng = new Rng(seed);
  const counts = new Map();
  let items = 0;
  for (let i = 0; i < n; i++) {
    // Fresh per-trial run state, so "unique" entries behave like one spot in a new run.
    const out = rollPool(poolId, pools, rng, { ...ctx, spawnedUnique: new Set() });
    for (const id of out) counts.set(id, (counts.get(id) ?? 0) + 1);
    items += out.length;
  }
  // Odds are per roll. Every roll that yields no item counts as (nothing).
  const totalRolls = n * rolls;
  counts.set(null, Math.max(0, totalRolls - items));
  const keys = new Set([...expected.keys(), ...counts.keys()]);
  const rows = [...keys].map((k) => {
    const exp = expected.get(k) ?? 0;
    const act = (counts.get(k) ?? 0) / totalRolls;
    return { outcome: k ?? '(nothing)', expected: exp, actual: act, diff: act - exp };
  }).filter((r) => r.expected > 0 || r.actual > 0);
  rows.sort((a, b) => b.expected - a.expected || String(a.outcome).localeCompare(b.outcome));
  return { rows, rolls };
}

function printTable(title, rows) {
  const head = ['outcome', 'expected', 'actual', 'diff'];
  const body = rows.map((r) => [r.outcome, pct(r.expected), pct(r.actual), signed(r.diff)]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(title);
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const b of body) console.log(line(b));
  console.log();
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
  const { content } = loadContent();
  const pools = content.pools ?? {};
  const ids = opts.pool === 'all' ? Object.keys(pools).sort() : [opts.pool];
  if (opts.pool !== 'all' && !pools[opts.pool]) {
    console.error(`unknown pool "${opts.pool}". Known: ${Object.keys(pools).sort().join(', ') || '(none)'}`);
    process.exit(1);
  }
  const ctxDesc = [`n=${opts.n}`, `seed=${opts.seed}`, opts.depth !== undefined && `depth=${opts.depth}`, opts.zone && `zone=${opts.zone}`].filter(Boolean).join(' ');
  for (const id of ids) {
    const { rows, rolls } = simulate(id, pools, opts);
    printTable(`pool ${id} (${ctxDesc}${rolls > 1 ? `, ${rolls} rolls each, odds per roll` : ''})`, rows);
  }
}

main();
