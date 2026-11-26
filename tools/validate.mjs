// Content validator. Catches content mistakes before they ship (PLAN.md §2).
//   node tools/validate.mjs        → prints errors + warnings, exits 1 on errors
// Library use: validateContent(content, { textures, scripts, sources }) → { errors, warnings }
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { loadContent, listTextures, walk, SCRIPT_DIR } from './lib/loadContent.mjs';
import { validatePhysics } from '../src/physics/schema.js';

export const CELL = 2;        // metres per layout cell (src/world/roomBuilder.js)
export const WALL_H = 3;
export const BLOCK = 8;       // cells per slot block
export const TILE_KINDS = { wall: true, pillar: true, floor: false, door: false, light: false, void: true }; // kind → solid
export const MESH_TYPES = ['box', 'plane', 'sprite', 'prefab'];
export const COMPONENT_TYPES = ['collider', 'readable', 'sound', 'light', 'interact', 'pickup', 'use', 'combine', 'door', 'hide', 'anomaly', 'physics'];
const MATERIAL_KEYS = ['wall', 'pillar', 'floor', 'ceiling', 'ceilingLight'];
const READABLE_DISPLAYS = ['notebook', 'inspect', 'surface'];
const SOUND_TRIGGERS = ['ambient', 'proximity', 'interact', 'script'];
const CONSUME = ['self', 'other', 'both', 'none', true, false];
const BUILTIN_ITEMS = ['flashlight']; // engine-provided items that combine/use may refer to
const SPECIAL_TEXT_IDS = ['spine', 'random']; // readable textIds resolved at read time (src/gameplay/notes.js)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const q = (s) => JSON.stringify(s);

/**
 * @param content  loaded content (see tools/lib/loadContent.mjs)
 * @param opts.textures  texture names (assets/textures without .png). Omit to skip texture checks.
 * @param opts.scripts   known script ids, or null/undefined if scripts don't exist yet (→ warnings)
 * @param opts.sources   sources map from loadContent, for file paths in messages
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateContent(content, { textures, scripts, sources = {} } = {}) {
  const errors = [];
  const warnings = [];
  const objects = content.objects ?? {};
  const pools = content.pools ?? {};
  const rooms = content.rooms ?? {};
  const texSet = textures ? new Set(textures) : null;
  const scriptSet = scripts ? new Set(scripts) : null;
  const scriptRefs = new Map();     // script id → [where]
  const poolRefs = new Set();       // named pools referenced from somewhere

  const where = (kind, id, field) => {
    const file = sources[kind]?.[id] ?? `content/${kind}/${id}.json`;
    return `${file} [${kind}.${id}]${field ? ' ' + field : ''}`;
  };
  const err = (w, msg) => errors.push(`${w}: ${msg}`);
  const warn = (w, msg) => warnings.push(`${w}: ${msg}`);
  const useScript = (id, w) => {
    if (typeof id !== 'string' || !id) return;
    if (!scriptRefs.has(id)) scriptRefs.set(id, []);
    scriptRefs.get(id).push(w);
  };
  const checkTexture = (name, w, { required = true } = {}) => {
    if (name == null) { if (required) err(w, 'missing texture name'); return; }
    if (typeof name !== 'string') return err(w, `texture must be a string, got ${q(name)}`);
    if (name.startsWith('proc:')) return; // procedural canvas texture, resolved at runtime
    if (texSet && !texSet.has(name)) err(w, `unknown texture ${q(name)} (not in assets/textures)`);
  };
  const idMatchesFile = (kind, id, data) => {
    const file = sources[kind]?.[id];
    if (!file) return;
    if (data?.id == null) warn(where(kind, id), 'missing "id" (using file name)');
    else if (path.basename(file, '.json') !== id) warn(where(kind, id), `id ${q(id)} doesn't match file name`);
  };

  // ---------- pools ----------
  // Validates any pool form (id string / entry array / pool object). Returns nested named pool ids.
  function checkPool(pool, w, depth = 0) {
    const nested = [];
    const sub = (f) => (/\[[a-z]+\.[\w-]+\]$/.test(w) ? `${w} ${f}` : `${w}.${f}`); // "[pools.x] f" vs "spots[0].pool.f"
    if (typeof pool === 'string') {
      poolRefs.add(pool);
      if (!pools[pool]) err(w, `unknown pool ${q(pool)}`);
      else nested.push(pool);
      return nested;
    }
    let entries, rolls;
    if (Array.isArray(pool)) entries = pool;
    else if (pool && typeof pool === 'object') { entries = pool.entries; rolls = pool.rolls; }
    else { err(w, `pool must be an id, an entry array or a pool object, got ${q(pool)}`); return nested; }
    if (rolls != null && !(Number.isInteger(rolls) && rolls >= 1)) err(sub('rolls'), `must be an integer ≥ 1, got ${q(rolls)}`);
    if (!Array.isArray(entries) || entries.length === 0) { err(w, 'pool has no entries'); return nested; }
    let total = 0;
    entries.forEach((e, i) => {
      const ew = sub(`entries[${i}]`);
      if (!e || typeof e !== 'object') return err(ew, 'entry must be an object');
      if (!isNum(e.w) || !(e.w > 0)) err(`${ew}.w`, `weight must be a number > 0, got ${q(e.w)}`);
      else total += e.w;
      const hasDef = 'def' in e;
      const hasPool = 'pool' in e;
      if (hasDef && hasPool) err(ew, 'has both "def" and "pool"; use one');
      else if (!hasDef && !hasPool) err(ew, 'needs "def" (object id, or null for nothing) or "pool"');
      if (hasDef && e.def !== null) {
        if (typeof e.def !== 'string') err(`${ew}.def`, `must be an object id or null, got ${q(e.def)}`);
        else if (!objects[e.def]) err(`${ew}.def`, `unknown object ${q(e.def)}`);
      }
      if (hasPool) {
        if (depth > 8) err(`${ew}.pool`, 'inline pool nesting deeper than 8');
        else nested.push(...checkPool(e.pool, `${ew}.pool`, depth + 1));
      }
      if (isNum(e.minDepth) && isNum(e.maxDepth) && e.minDepth > e.maxDepth) warn(ew, `minDepth ${e.minDepth} > maxDepth ${e.maxDepth}; entry can never roll`);
      if (e.zones != null && !Array.isArray(e.zones)) err(`${ew}.zones`, 'must be an array of zone ids');
      if (e.unique && !e.def) warn(ew, '"unique" only applies to entries with a def');
    });
    if (!(total > 0)) err(w, 'total weight is 0; nothing can ever be picked');
    return nested;
  }

  const poolGraph = new Map();
  for (const [id, p] of Object.entries(pools)) {
    idMatchesFile('pools', id, p);
    const nested = checkPool({ ...p, id }, where('pools', id));
    poolGraph.set(id, nested);
  }
  // Cycle detection over named pool references.
  {
    const state = new Map(); // 1 = visiting, 2 = done
    const reported = new Set();
    const visit = (id, stack) => {
      state.set(id, 1);
      stack.push(id);
      for (const n of poolGraph.get(id) ?? []) {
        if (state.get(n) === 1) {
          const cycle = [...stack.slice(stack.indexOf(n)), n];
          const key = [...cycle].slice(0, -1).sort().join(',');
          if (!reported.has(key)) { reported.add(key); err(where('pools', n), `pool cycle: ${cycle.join(' → ')}`); }
        } else if (!state.has(n)) visit(n, stack);
      }
      stack.pop();
      state.set(id, 2);
    };
    for (const id of poolGraph.keys()) if (!state.has(id)) visit(id, []);
  }

  // ---------- objects ----------
  for (const [id, o] of Object.entries(objects)) {
    const w = (f) => where('objects', id, f);
    idMatchesFile('objects', id, o);
    if (!o || typeof o !== 'object') { err(w(), 'object definition must be a JSON object'); continue; }
    if (typeof o.name !== 'string' || !o.name) warn(w('name'), 'missing display name');

    const m = o.mesh;
    if (!m || typeof m !== 'object') err(w('mesh'), 'missing mesh');
    else if (!MESH_TYPES.includes(m.type)) err(w('mesh.type'), `unknown mesh type ${q(m.type)} (known: ${MESH_TYPES.join(', ')})`);
    else {
      if (m.type === 'box' && !isVec(m.size, 3)) err(w('mesh.size'), 'box needs size [x, y, z]');
      if ((m.type === 'plane' || m.type === 'sprite') && !isVec(m.size, 2)) err(w('mesh.size'), `${m.type} needs size [w, h]`);
      if (m.type === 'prefab' && (typeof m.name !== 'string' || !m.name)) err(w('mesh.name'), 'prefab needs a name');
      if (m.type === 'sprite') checkTexture(m.texture, w('mesh.texture'));
      else if (m.texture != null) checkTexture(m.texture, w('mesh.texture'));
    }

    const comps = o.components ?? {};
    if (typeof comps !== 'object' || Array.isArray(comps)) { err(w('components'), 'must be an object of { type: {...} }'); continue; }
    for (const [type, c] of Object.entries(comps)) {
      const cw = w(`components.${type}`);
      if (!COMPONENT_TYPES.includes(type)) { err(cw, `unknown component type ${q(type)} (known: ${COMPONENT_TYPES.join(', ')})`); continue; }
      switch (type) {
        case 'collider':
          if (c?.shape != null && c.shape !== 'box') warn(`${cw}.shape`, `only "box" is supported, got ${q(c.shape)}`);
          break;
        case 'readable':
          if (!c?.text && !c?.textId) err(cw, 'needs "text" or "textId"');
          if (c?.display != null && !READABLE_DISPLAYS.includes(c.display)) warn(`${cw}.display`, `expected one of ${READABLE_DISPLAYS.join('/')}, got ${q(c.display)}`);
          if (c?.textId && !SPECIAL_TEXT_IDS.includes(c.textId)) {
            if (!content.notes?.[c.textId]) err(`${cw}.textId`, `unknown note ${q(c.textId)} (use a note id, "spine" or "random")`);
          } else if (c?.textId === 'spine' && !Object.values(content.notes ?? {}).some((n) => Number.isInteger(n?.spine))) {
            err(`${cw}.textId`, '"spine" needs at least one note with a "spine" number in content/notes');
          } else if (c?.textId === 'random' && !Object.values(content.notes ?? {}).some((n) => n && n.spine == null)) {
            err(`${cw}.textId`, '"random" needs at least one fragment (a note without "spine") in content/notes');
          }
          break;
        case 'sound':
          if (!c?.preset) err(cw, 'needs a "preset"');
          else if (content.sounds) { if (!content.sounds[c.preset]) err(`${cw}.preset`, `unknown sound preset ${q(c.preset)}`); }
          else warn(`${cw}.preset`, `can't check preset ${q(c.preset)}: no content/sounds yet`);
          if (c?.trigger != null && !SOUND_TRIGGERS.includes(c.trigger)) warn(`${cw}.trigger`, `expected one of ${SOUND_TRIGGERS.join('/')}, got ${q(c.trigger)}`);
          break;
        case 'light':
          for (const f of ['intensity', 'range']) if (c?.[f] != null && !isNum(c[f])) err(`${cw}.${f}`, 'must be a number');
          break;
        case 'interact':
        case 'use':
        case 'anomaly':
          if (type !== 'anomaly' && !c?.script) warn(cw, 'no "script"; it will do nothing');
          useScript(c?.script, cw);
          if (c?.requiresHeld && !objects[c.requiresHeld] && !BUILTIN_ITEMS.includes(c.requiresHeld)) err(`${cw}.requiresHeld`, `unknown object ${q(c.requiresHeld)}`);
          break;
        case 'combine':
          if (!Array.isArray(c)) { err(cw, 'must be an array of { with, script, consume, result? }'); break; }
          c.forEach((r, i) => {
            const rw = `${cw}[${i}]`;
            if (!r?.with) err(rw, 'needs "with"');
            else if (!objects[r.with] && !BUILTIN_ITEMS.includes(r.with)) err(`${rw}.with`, `unknown object ${q(r.with)}`);
            if (r?.result && !objects[r.result]) err(`${rw}.result`, `unknown object ${q(r.result)}`);
            if (r?.consume !== undefined && !CONSUME.includes(r.consume)) warn(`${rw}.consume`, `expected self/other/both/none, got ${q(r.consume)}`);
            if (!r?.script) warn(rw, 'no "script"; it will do nothing');
            useScript(r?.script, rw);
          });
          break;
        case 'physics':
          for (const r of validatePhysics(c, { objects, sounds: content.sounds, pools, def: o })) {
            (r.level === 'error' ? err : warn)(r.field ? `${cw}.${r.field}` : cw, r.msg);
          }
          if (typeof c?.spill === 'string') poolRefs.add(c.spill);
          break;
        case 'door':
          if (c?.keyItem && !objects[c.keyItem]) err(`${cw}.keyItem`, `unknown object ${q(c.keyItem)}`);
          break;
      }
    }
  }

  // ---------- rooms ----------
  for (const [id, r] of Object.entries(rooms)) {
    const w = (f) => where('rooms', id, f);
    idMatchesFile('rooms', id, r);
    if (!r || typeof r !== 'object') { err(w(), 'room must be a JSON object'); continue; }
    if (!r.zones || typeof r.zones !== 'object' || !Object.keys(r.zones).length) warn(w('zones'), 'no zones; the layout generator will never pick this room');
    else for (const [z, zw] of Object.entries(r.zones)) if (!(isNum(zw) && zw > 0)) err(w(`zones.${z}`), `weight must be > 0, got ${q(zw)}`);
    if (r.script != null) useScript(r.script, w('script'));

    // layout + legend
    const layout = r.layout;
    // ' ' is always void (outside a multi-slot room's footprint), matching src/world/layout.
    const legend = { ' ': 'void', ...(r.legend ?? {}) };
    if (!Array.isArray(layout) || !layout.length || !layout.every((row) => typeof row === 'string')) {
      err(w('layout'), 'must be a non-empty array of strings');
      continue;
    }
    const rows = layout.length;
    const cols = Math.max(...layout.map((s) => s.length));
    layout.forEach((row, i) => { if (row.length !== cols) err(w(`layout[${i}]`), `row is ${row.length} wide, expected ${cols}`); });
    for (const [ch, kind] of Object.entries(legend)) {
      if ([...ch].length !== 1) err(w(`legend.${ch}`), 'legend keys must be single characters');
      if (!(kind in TILE_KINDS)) err(w(`legend.${ch}`), `unknown tile kind ${q(kind)} (known: ${Object.keys(TILE_KINDS).join(', ')})`);
    }
    const missing = new Map();
    layout.forEach((row, z) => [...row].forEach((ch, x) => { if (!(ch in legend) && !missing.has(ch)) missing.set(ch, [x, z]); }));
    for (const [ch, [x, z]] of missing) err(w('layout'), `char ${q(ch)} (first at col ${x}, row ${z}) is not in the legend`);
    const usedKinds = new Set(layout.flatMap((row) => [...row].map((ch) => legend[ch])));

    // materials
    const mats = r.materials ?? {};
    for (const [k, name] of Object.entries(mats)) {
      if (!MATERIAL_KEYS.includes(k)) warn(w(`materials.${k}`), `unknown material slot (known: ${MATERIAL_KEYS.join(', ')})`);
      checkTexture(name, w(`materials.${k}`));
    }
    for (const k of ['wall', 'floor', 'ceiling']) {
      const needed = k !== 'wall' || usedKinds.has('wall') || (usedKinds.has('pillar') && !mats.pillar);
      if (needed && !mats[k]) err(w('materials'), `missing "${k}" material`);
    }

    // slots / edges
    if (r.slots != null) {
      if (!isVec(r.slots, 2)) err(w('slots'), 'must be [w, h] in 8×8-cell blocks');
      else if (r.slots[0] * BLOCK !== cols || r.slots[1] * BLOCK !== rows)
        warn(w('slots'), `slots ${q(r.slots)} = ${r.slots[0] * BLOCK}×${r.slots[1] * BLOCK} cells, but layout is ${cols}×${rows}`);
      if (r.edges && isVec(r.slots, 2)) {
        for (const [side, n] of [['n', r.slots[0]], ['s', r.slots[0]], ['e', r.slots[1]], ['w', r.slots[1]]]) {
          const e = r.edges[side];
          if (e != null && (!Array.isArray(e) || e.length !== n)) warn(w(`edges.${side}`), `expected ${n} connector(s), got ${q(e)}`);
        }
      }
    }

    // geometry helpers
    const W = cols * CELL, D = rows * CELL;
    const cellOf = (pos) => [Math.min(cols - 1, Math.floor(pos[0] / CELL)), Math.min(rows - 1, Math.floor(pos[2] / CELL))];
    const solidAt = (cx, cz) => {
      const k = legend[layout[cz]?.[cx]];
      return k == null || TILE_KINDS[k] !== false;
    };
    const inBounds = (pos) => pos[0] >= 0 && pos[0] <= W && pos[2] >= 0 && pos[2] <= D;
    const checkPos = (pos, pw, label) => {
      if (!isVec(pos, 3)) { err(`${pw}.pos`, `must be [x, y, z] numbers, got ${q(pos)}`); return null; }
      if (!inBounds(pos)) { err(`${pw}.pos`, `${q(pos)} is outside the room (0..${W}, 0..${D} m)`); return null; }
      if (pos[1] < 0 || pos[1] > WALL_H) warn(`${pw}.pos`, `y=${pos[1]} is outside floor..ceiling (0..${WALL_H} m)`);
      const [cx, cz] = cellOf(pos);
      if (solidAt(cx, cz)) warn(`${pw}.pos`, `${label} at ${q(pos)} is inside a solid cell (col ${cx}, row ${cz}: ${q(layout[cz][cx])})`);
      return [cx, cz];
    };

    // reachability: flood fill from the spawn and every open border cell
    const reach = new Set();
    {
      const seeds = [];
      if (r.spawn?.pos && isVec(r.spawn.pos, 3) && inBounds(r.spawn.pos)) seeds.push(cellOf(r.spawn.pos));
      for (let x = 0; x < cols; x++) seeds.push([x, 0], [x, rows - 1]);
      for (let z = 0; z < rows; z++) seeds.push([0, z], [cols - 1, z]);
      const stack = seeds.filter(([x, z]) => !solidAt(x, z));
      while (stack.length) {
        const [x, z] = stack.pop();
        const k = x + ',' + z;
        if (reach.has(k) || x < 0 || z < 0 || x >= cols || z >= rows || solidAt(x, z)) continue;
        reach.add(k);
        stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
      }
    }
    const canReach = reach.size > 0;
    if (canReach) {
      let enclosed = 0;
      for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) if (!solidAt(x, z) && !reach.has(x + ',' + z)) enclosed++;
      if (enclosed) warn(w('layout'), `${enclosed} walkable cell(s) can't be reached from the spawn or the room's open edges`);
    }
    const checkReach = (cell, pw, label) => {
      if (cell && canReach && !solidAt(...cell) && !reach.has(cell.join(','))) warn(`${pw}.pos`, `${label} is in an unreachable cell (col ${cell[0]}, row ${cell[1]})`);
    };

    if (r.spawn != null) {
      const sw = w('spawn');
      if (!isVec(r.spawn.pos, 3)) err(`${sw}.pos`, 'must be [x, y, z]');
      else if (!inBounds(r.spawn.pos)) err(`${sw}.pos`, `${q(r.spawn.pos)} is outside the room`);
      else { const [cx, cz] = cellOf(r.spawn.pos); if (solidAt(cx, cz)) err(`${sw}.pos`, `player spawns inside a solid cell (col ${cx}, row ${cz})`); }
    }

    (r.objects ?? []).forEach((o, i) => {
      const ow = w(`objects[${i}]`);
      if (!o?.def) err(ow, 'missing "def"');
      else if (!objects[o.def]) err(`${ow}.def`, `unknown object ${q(o.def)}`);
      if (o?.rot != null && !isNum(o.rot)) err(`${ow}.rot`, 'must be a number (degrees)');
      checkReach(checkPos(o?.pos, ow, o?.def ?? 'object'), ow, o?.def ?? 'object');
    });

    const spotIds = new Set();
    (r.spots ?? []).forEach((s, i) => {
      const sw = w(`spots[${i}]`);
      if (!s?.id) err(sw, 'missing "id"');
      else if (spotIds.has(s.id)) err(`${sw}.id`, `duplicate spot id ${q(s.id)} (spot rolls are seeded by id)`);
      else spotIds.add(s.id);
      if (s?.pool == null) err(sw, 'missing "pool"');
      else checkPool(s.pool, `${sw}.pool`);
      if (s?.rot != null && !isNum(s.rot)) err(`${sw}.rot`, 'must be a number (degrees)');
      const label = `spot ${q(s?.id)}`;
      checkReach(checkPos(s?.pos, sw, label), sw, label);
    });
  }

  // ---------- notes ----------
  const spineNums = new Map();
  for (const [id, n] of Object.entries(content.notes ?? {})) {
    const w = (f) => where('notes', id, f);
    idMatchesFile('notes', id, n);
    if (!n || typeof n !== 'object') { err(w(), 'note must be a JSON object'); continue; }
    if (SPECIAL_TEXT_IDS.includes(id)) err(w('id'), `${q(id)} is reserved for readable textIds`);
    if (typeof n.title !== 'string' || !n.title) err(w('title'), 'needs a title');
    if (typeof n.text !== 'string' || !n.text) err(w('text'), 'needs text');
    else if (n.text.length > 400) warn(w('text'), `is ${n.text.length} chars; keep notes short (1–4 sentences)`);
    if (n.spine != null) {
      if (!(Number.isInteger(n.spine) && n.spine >= 1)) err(w('spine'), `must be an integer ≥ 1, got ${q(n.spine)}`);
      else if (spineNums.has(n.spine)) err(w('spine'), `spine ${n.spine} is also used by ${spineNums.get(n.spine)}`);
      else spineNums.set(n.spine, id);
    }
  }
  if (spineNums.size) {
    const max = Math.max(...spineNums.keys());
    for (let i = 1; i <= max; i++) if (!spineNums.has(i)) warn('content/notes', `spine order has a gap: no note with spine ${i}`);
  }

  // ---------- cross-cutting ----------
  for (const id of Object.keys(pools)) if (!poolRefs.has(id)) warn(where('pools', id), 'pool is not used by any room spot or other pool');
  for (const [sid, uses] of scriptRefs) {
    if (scriptSet?.has(sid)) continue;
    if (!scriptSet) { warn(uses[0], `can't check script ${q(sid)}: no script list given`); continue; }
    err(uses[0], `unknown script ${q(sid)} (not listed in src/scripts/items/index.js)${uses.length > 1 ? `; also used by ${uses.length - 1} other(s)` : ''}`);
  }

  return { errors, warnings };
}

/** Load content from disk and validate it. Bad JSON / duplicate ids become errors. */
export function validateAll() {
  let loaded;
  try { loaded = loadContent(); }
  catch (e) { return { errors: [e.message], warnings: [] }; }
  const reg = scriptRegistry();
  const res = validateContent(loaded.content, { textures: listTextures(), scripts: reg.ids, sources: loaded.sources });
  res.errors.push(...reg.errors);
  return res;
}

/**
 * Script ids from the same list the game registers: src/scripts/items/index.js.
 * Read from disk (not imported) so --watch sees new scripts. Also checks that every file in the
 * folder is listed, every listed file exists, and ids are unique.
 * @returns {{ ids: string[], errors: string[] }}
 */
export function scriptRegistry(dir = SCRIPT_DIR) {
  const errors = [];
  const indexFile = `${dir}/index.js`;
  if (!fs.existsSync(indexFile)) return { ids: [], errors: [`src/scripts/items/index.js: missing (it lists every item script)`] };
  const src = fs.readFileSync(indexFile, 'utf8');
  const listed = [...src.matchAll(/^\s*import\s+\w+\s+from\s+['"]\.\/([\w-]+\.js)['"]/gm)].map((m) => m[1]);
  const files = walk(dir, '.js').map((f) => path.relative(dir, f).split(path.sep).join('/')).filter((f) => f !== 'index.js');
  for (const f of files) if (!listed.includes(f)) errors.push(`src/scripts/items/${f}: not listed in src/scripts/items/index.js, so the game never registers it`);
  const ids = [];
  const seen = new Map();
  for (const f of listed) {
    const file = `${dir}/${f}`;
    if (!fs.existsSync(file)) { errors.push(`src/scripts/items/index.js: imports ./${f}, which doesn't exist`); continue; }
    const m = fs.readFileSync(file, 'utf8').match(/\bid\s*:\s*['"]([\w-]+)['"]/);
    if (!m) { errors.push(`src/scripts/items/${f}: no "id: '...'" found`); continue; }
    if (seen.has(m[1])) errors.push(`src/scripts/items/${f}: duplicate script id ${q(m[1])} (also in ${seen.get(m[1])})`);
    seen.set(m[1], f);
    ids.push(m[1]);
  }
  return { ids, errors };
}

/** Print a result. Returns true when there are no errors. */
export function printResult({ errors, warnings }, log = console) {
  for (const w of warnings) log.warn(`  warn  ${w}`);
  for (const e of errors) log.error(`  ERROR ${e}`);
  const summary = `content: ${errors.length} error(s), ${warnings.length} warning(s)`;
  if (errors.length) log.error(`✖ ${summary}`);
  else log.log(`✔ ${summary}`);
  return errors.length === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ok = printResult(validateAll());
  process.exitCode = ok ? 0 : 1;
}
