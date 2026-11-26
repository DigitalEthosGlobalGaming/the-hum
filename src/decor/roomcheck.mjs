// Room dressing checker for the art pass (docs/LEVEL_DIRECTION.md). Node only, not bundled.
// Checks every collider (fixed objects and anything solid a spot can roll) against border
// openings + their 2-cell aprons, walk connectivity at 0.1 m with the player's 0.3 m radius, spot sanity,
// and wall mounts (flush props WALL_FLUSH off a wall, wall-hung props WALL_INSET off, never on a wall
// that can be stamped open). Physics bodies use the larger of their mesh bounds and body radius.
//   node src/decor/roomcheck.mjs [room_id ...]      (run from the repo root; exit 1 on errors)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const { prefabs } = await import(path.join(ROOT, 'src/objects/prefabs.js'));
const { decorPrefabs, WALL_INSET, WALL_FLUSH } = await import(path.join(ROOT, 'src/decor/prefabs.js'));
// feature prefabs (carts, bins, cabinets, vending machine, switches…) register themselves on import
for (const m of ['src/physics/register.js', 'src/power/register.js', 'src/story/prefabs.js']) await import(path.join(ROOT, m));
const { PROFILES } = await import(path.join(ROOT, 'src/world/layout/connectors.js'));
const { parseEdgeSpec } = await import(path.join(ROOT, 'src/world/layout/templates.js'));
Object.assign(prefabs, decorPrefabs);

const readTree = (dir) => {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, readTree(p));
    else if (e.name.endsWith('.json')) { const j = JSON.parse(fs.readFileSync(p, 'utf8')); out[j.id] = j; }
  }
  return out;
};
const rooms = readTree(path.join(ROOT, 'content/rooms'));
const objects = readTree(path.join(ROOT, 'content/objects'));
const pools = readTree(path.join(ROOT, 'content/pools'));
const DEG = Math.PI / 180, R = 0.3, STEP = 0.1;

function rotPoint([x, y, z], [rx, ry, rz]) { // Three.js Euler 'XYZ': v' = Rx·Ry·Rz·v
  let c = Math.cos(rz * DEG), s = Math.sin(rz * DEG); [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(ry * DEG); s = Math.sin(ry * DEG); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rx * DEG); s = Math.sin(rx * DEG); [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}
const localBounds = new Map();
function boundsOf(defId) {
  if (localBounds.has(defId)) return localBounds.get(defId);
  const d = objects[defId], m = d.mesh;
  let b = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  if (m.type === 'box') b = { minX: -m.size[0] / 2, maxX: m.size[0] / 2, minZ: -m.size[2] / 2, maxZ: m.size[2] / 2 };
  else if (m.type === 'prefab') {
    b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of prefabs[m.name] ?? []) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const [x, , z] = rotPoint([sx * p.size[0] / 2, sy * p.size[1] / 2, sz * p.size[2] / 2], p.rot ?? [0, 0, 0]);
        b.minX = Math.min(b.minX, x + p.pos[0]); b.maxX = Math.max(b.maxX, x + p.pos[0]);
        b.minZ = Math.min(b.minZ, z + p.pos[2]); b.maxZ = Math.max(b.maxZ, z + p.pos[2]);
      }
    }
  }
  const ph = d.components?.physics;
  if (ph && ph.mode !== 'static' && ph.shape === 'circle' && ph.radius) { // a rolling body's footprint
    b = { minX: Math.min(b.minX, -ph.radius), maxX: Math.max(b.maxX, ph.radius), minZ: Math.min(b.minZ, -ph.radius), maxZ: Math.max(b.maxZ, ph.radius) };
  }
  if (!Number.isFinite(b.minX)) throw new Error(`no footprint for ${defId} (unknown prefab ${m.name}?)`);
  localBounds.set(defId, b);
  return b;
}
// How a prop meets the wall: 'flush' = back on the origin, 'inset' = back WALL_INSET behind it.
const WALL_MOUNT = {
  light_switch: 'flush', evac_map: 'flush', dark_writing: 'flush', dark_arrow: 'flush', wall_scrawl: 'flush',
  fuse_box: 'inset', decor_whiteboard: 'inset', decor_cork_board: 'inset', decor_wall_clock: 'inset', decor_door_to_nowhere: 'inset',
};
const solidDef = (id) => { const c = objects[id]?.components?.collider; return !!c && c.solid !== false; };
function worldAABB(defId, pos, rot = 0) {
  const b = boundsOf(defId), t = rot * DEG, c = Math.cos(t), s = Math.sin(t);
  const xs = [], zs = [];
  for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) { xs.push(pos[0] + x * c + z * s); zs.push(pos[2] - x * s + z * c); }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
function poolDefs(pool, depth = 0) {
  if (depth > 8) return [];
  const p = typeof pool === 'string' ? pools[pool] : Array.isArray(pool) ? { entries: pool } : pool;
  return (p?.entries ?? []).flatMap((e) => e.pool ? poolDefs(e.pool, depth + 1) : e.def ? [e.def] : []);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(rooms).filter((id) => !(rooms[id].tags ?? []).includes('test')).sort();
let errorsTotal = 0;
for (const id of ids) {
  const room = rooms[id];
  const legend = { ' ': 'void', ...room.legend };
  const L = room.layout, H = L.length, W = L[0].length;
  const solidKind = (k) => k === 'wall' || k === 'pillar' || k === 'void';
  const errors = [], warns = [];
  // footprint blocks
  const fp = new Set();
  for (let bz = 0; bz < H / 8; bz++) for (let bx = 0; bx < W / 8; bx++) {
    let any = false;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (L[bz * 8 + r][bx * 8 + c] !== ' ') any = true;
    if (any) fp.add(bx + ',' + bz);
  }
  const single = W === 16 && H === 8;
  const edgeSpec = (side, idx) => single ? parseEdgeSpec(room.edges[side][idx]).set : new Set(['wall', 'door', 'open', 'wide']);
  // border cells: flexible → closed in the core; record openings + aprons
  const core = L.map((r) => r.split('').map((ch) => solidKind(legend[ch])));
  const apron = new Set(), openings = [];
  const dirs = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] };
  for (const key of fp) {
    const [bx, bz] = key.split(',').map(Number);
    for (const side of ['n', 's', 'w', 'e']) {
      const nb = { n: [bx, bz - 1], s: [bx, bz + 1], w: [bx - 1, bz], e: [bx + 1, bz] }[side];
      if (fp.has(nb.join(','))) continue;
      const idx = side === 'n' || side === 's' ? bx : bz;
      const set = edgeSpec(side, idx);
      const cells = [];
      for (let i = 0; i < 8; i++) {
        if (side === 'n') cells.push([bx * 8 + i, bz * 8]);
        if (side === 's') cells.push([bx * 8 + i, bz * 8 + 7]);
        if (side === 'w') cells.push([bx * 8, bz * 8 + i]);
        if (side === 'e') cells.push([bx * 8 + 7, bz * 8 + i]);
      }
      const exact = set.size === 1;
      cells.forEach(([c, r], i) => {
        const open = [...set].some((conn) => conn !== 'wall' && PROFILES[conn][i] !== '#');
        if (!exact) core[r][c] = true; // flexible: closed in the core
        if (!open) return;
        const [dc, dr] = dirs[side];
        openings.push([c, r]);
        for (let k = 1; k <= 2; k++) if (!core[r + dr * k]?.[c + dc * k]) apron.add(`${c + dc * k},${r + dr * k}`);
      });
    }
  }
  // colliders: fixed objects + solid things a spot can roll
  const boxes = [];
  for (const o of room.objects ?? []) {
    if (!objects[o.def]) { errors.push(`unknown object ${o.def}`); continue; }
    if (solidDef(o.def)) boxes.push({ label: `${o.def}@${o.pos}`, ...worldAABB(o.def, o.pos, o.rot ?? 0) });
  }
  for (const s of room.spots ?? []) {
    const solids = [...new Set(poolDefs(s.pool))].filter(solidDef);
    for (const d of solids) {
      if (s.rot != null) boxes.push({ label: `spot ${s.id}:${d}`, spot: true, ...worldAABB(d, s.pos, s.rot) });
      else {
        const b = boundsOf(d); const r = Math.max(Math.hypot(b.minX, b.minZ), Math.hypot(b.maxX, b.maxZ), Math.hypot(b.minX, b.maxZ), Math.hypot(b.maxX, b.minZ));
        boxes.push({ label: `spot ${s.id}:${d}`, spot: true, minX: s.pos[0] - r, maxX: s.pos[0] + r, minZ: s.pos[2] - r, maxZ: s.pos[2] + r });
      }
    }
  }
  const overlapCell = (b, c, r, tol = 0) => b.maxX > c * 2 + tol && b.minX < c * 2 + 2 - tol && b.maxZ > r * 2 + tol && b.minZ < r * 2 + 2 - tol;
  for (const b of boxes) {
    for (const a of apron) { const [c, r] = a.split(',').map(Number); if (overlapCell(b, c, r, 0.01)) { errors.push(`${b.label} blocks the apron of an opening at cell ${a}`); break; } }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (solidKind(legend[L[r][c]]) && overlapCell(b, c, r, 0.03)) warns.push(`${b.label} pokes into solid cell ${c},${r}`);
    }
    if (b.minX < 0 || b.minZ < 0 || b.maxX > W * 2 || b.maxZ > H * 2) errors.push(`${b.label} outside room`);
  }
  // fine walk grid
  const gw = Math.round(W * 2 / STEP), gh = Math.round(H * 2 / STEP);
  const free = new Uint8Array(gw * gh);
  const fixedBoxes = boxes; // treat spot solids as present (worst case)
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = (i + 0.5) * STEP, z = (j + 0.5) * STEP;
    const c = Math.floor(x / 2), r = Math.floor(z / 2);
    if (core[r][c]) continue;
    let ok = true;
    for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1 && ok; dc++) {
      const cc = c + dc, rr = r + dr;
      const solid = cc < 0 || rr < 0 || cc >= W || rr >= H ? false : core[rr][cc];
      if (!solid) continue;
      const px = Math.max(cc * 2, Math.min(x, cc * 2 + 2)), pz = Math.max(rr * 2, Math.min(z, rr * 2 + 2));
      if (Math.hypot(x - px, z - pz) < R) ok = false;
    }
    for (const b of fixedBoxes) {
      if (!ok) break;
      const px = Math.max(b.minX, Math.min(x, b.maxX)), pz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if (Math.hypot(x - px, z - pz) < R) ok = false;
    }
    if (ok) free[j * gw + i] = 1;
  }
  const comp = new Int32Array(gw * gh).fill(-1);
  const sizes = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!free[s] || comp[s] >= 0) continue;
    const id2 = sizes.length; let n = 0; const st = [s]; comp[s] = id2;
    while (st.length) {
      const p = st.pop(); n++;
      const i = p % gw, j = (p - i) / gw;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
        const q = jj * gw + ii; if (free[q] && comp[q] < 0) { comp[q] = id2; st.push(q); }
      }
    }
    sizes.push(n);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const cellStats = (c, r) => {
    let inMain = 0, other = 0;
    const per = 2 / STEP;
    for (let j = r * per; j < (r + 1) * per; j++) for (let i = c * per; i < (c + 1) * per; i++) {
      const q = j * gw + i; if (!free[q]) continue; if (comp[q] === main) inMain++; else other++;
    }
    return { inMain, other };
  };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (core[r][c]) continue;
    const { inMain, other } = cellStats(c, r);
    if (other > 15) errors.push(`cell ${c},${r}: ${other} walkable points cut off from the rest`);
    if (inMain === 0 && other === 0) warns.push(`cell ${c},${r} fully occupied by props`);
  }
  for (const a of apron) {
    const [c, r] = a.split(',').map(Number);
    if (cellStats(c, r).inMain < 40) errors.push(`apron cell ${a} not reachable`);
  }
  // wall mounts: distance from the origin back to the wall face, and that wall must never open
  const openSet = new Set(openings.map(([c, r]) => `${c},${r}`));
  const checkMount = (label, defs, pos, rot) => {
    const kinds = [...new Set(defs.map((d) => WALL_MOUNT[d]).filter(Boolean))];
    if (!kinds.length) return;
    if (kinds.length > 1) { errors.push(`${label} mixes flush and inset wall props (${defs.join(', ')})`); return; }
    if (rot == null) { errors.push(`${label} holds wall props but has no rot`); return; }
    const t = rot * DEG, bx = Math.sin(t), bz = Math.cos(t);
    let d = null, cell = null;
    for (let k = 0; k <= 60; k++) {
      const x = pos[0] + bx * k * 0.005, z = pos[2] + bz * k * 0.005;
      const c = Math.floor(x / 2), r = Math.floor(z / 2);
      if (r >= 0 && r < H && c >= 0 && c < W && solidKind(legend[L[r][c]])) { d = k * 0.005; cell = [c, r]; break; }
    }
    const want = kinds[0] === 'flush' ? WALL_FLUSH : WALL_INSET;
    if (d == null) errors.push(`${label}: no wall behind it (rot ${rot})`);
    else if (Math.abs(d - want) > 0.02) errors.push(`${label}: ${d.toFixed(3)} m off the wall, ${kinds[0]} props want ${want}`);
    else if (openSet.has(cell.join(','))) errors.push(`${label} hangs on wall cell ${cell} that can be stamped open`);
  };
  for (const o of room.objects ?? []) checkMount(`${o.def}@${o.pos}`, [o.def], o.pos, o.rot);
  for (const s of room.spots ?? []) checkMount(`spot ${s.id}`, [...new Set(poolDefs(s.pool))], s.pos, s.rot);
  // spots
  for (const s of room.spots ?? []) {
    const fixed = boxes.filter((b) => !b.spot);
    const inside = fixed.filter((b) => s.pos[0] > b.minX && s.pos[0] < b.maxX && s.pos[2] > b.minZ && s.pos[2] < b.maxZ);
    if (s.pos[1] < 0.3 && inside.length && !/^ceil/.test(s.id)) warns.push(`floor spot ${s.id} is inside ${inside[0].label}`);
    const onWall = poolDefs(s.pool).some((d) => WALL_MOUNT[d]);
    if (s.pos[1] >= 0.3 && !inside.length && !onWall) warns.push(`raised spot ${s.id} (y ${s.pos[1]}) floats: no prop under it`);
  }
  // spot ids unique / overlapping spots
  const sp = room.spots ?? [];
  for (let i = 0; i < sp.length; i++) for (let k = i + 1; k < sp.length; k++) {
    if (Math.hypot(sp[i].pos[0] - sp[k].pos[0], sp[i].pos[2] - sp[k].pos[2]) < 0.25 && Math.abs(sp[i].pos[1] - sp[k].pos[1]) < 0.2) warns.push(`spots ${sp[i].id} and ${sp[k].id} overlap`);
  }
  errorsTotal += errors.length;
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ${id}  (${(room.objects ?? []).length} objects, ${sp.length} spots, ${apron.size} apron cells)`);
  for (const e of errors) console.log('   ERROR ' + e);
  for (const w of [...new Set(warns)]) console.log('   warn  ' + w);
}
process.exitCode = errorsTotal ? 1 : 0;
