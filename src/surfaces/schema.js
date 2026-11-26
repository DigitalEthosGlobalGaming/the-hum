// content/surfaces.json + the room fields `floorSurface` / `cellSurfaces`: validation.
// Pure: used by tools/validate.mjs. Format: content/README.md "surfaces.json".
import { surfaceForTexture, globToRegExp, SURFACE_DEFAULTS } from './surfaces.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const q = (s) => JSON.stringify(s);

const SECTIONS = ['note', 'default', 'textures', 'surfaces', 'gait', 'puddles', 'wet'];
const SURFACE_KEYS = ['preset', 'volume', 'noise', 'note'];
const PUDDLE_KEYS = ['size', 'offset', 'shrink', 'note'];

/**
 * @param data  content.surfaces (may be undefined: the game then uses SURFACE_DEFAULTS)
 * @param ctx   { sounds?, objects?, textures?: string[], rooms? }
 * @returns [{ level: 'error'|'warn', field, msg }]
 */
export function validateSurfaces(data, { sounds, objects, textures, rooms } = {}) {
  const out = [];
  const err = (field, msg) => out.push({ level: 'error', field, msg });
  const warn = (field, msg) => out.push({ level: 'warn', field, msg });
  if (data == null) { warn('', 'no content/surfaces.json: every floor sounds like carpet'); return out; }
  if (!isObj(data)) { err('', 'must be a JSON object'); return out; }
  for (const k of Object.keys(data)) if (!SECTIONS.includes(k)) err(k, `unknown key (known: ${SECTIONS.join(', ')})`);

  const surfaces = data.surfaces ?? {};
  const known = new Set(Object.keys(surfaces));
  if (!isObj(surfaces) || !known.size) err('surfaces', 'needs at least one surface');
  for (const [id, s] of Object.entries(isObj(surfaces) ? surfaces : {})) {
    const f = `surfaces.${id}`;
    if (!isObj(s)) { err(f, 'must be an object { preset, volume?, noise? }'); continue; }
    for (const k of Object.keys(s)) if (!SURFACE_KEYS.includes(k)) err(`${f}.${k}`, `unknown key (known: ${SURFACE_KEYS.join(', ')})`);
    if (typeof s.preset !== 'string' || !s.preset) err(`${f}.preset`, 'needs a sound preset id');
    else if (sounds && !sounds[s.preset]) err(`${f}.preset`, `unknown sound preset ${q(s.preset)}`);
    if (s.volume != null && !(isNum(s.volume) && s.volume >= 0 && s.volume <= 2)) err(`${f}.volume`, 'must be 0..2');
    if (s.noise != null && !(isNum(s.noise) && s.noise > 0 && s.noise <= 2)) err(`${f}.noise`, 'must be > 0 and ≤ 2 (× footstep loudness)');
  }
  const def = data.default ?? SURFACE_DEFAULTS.default;
  if (!known.has(def)) err('default', `${q(def)} is not a surface in "surfaces"`);

  // texture map
  const texMap = data.textures ?? {};
  if (!isObj(texMap)) err('textures', 'must be an object { "<texture or glob>": surface }');
  else {
    for (const [glob, s] of Object.entries(texMap)) {
      if (!known.has(s)) err(`textures.${glob}`, `unknown surface ${q(s)}`);
      if (textures) {
        const hit = glob.includes('*') ? textures.some((t) => globToRegExp(glob).test(t)) : textures.includes(glob);
        if (!hit) warn(`textures.${glob}`, 'matches no texture in assets/textures');
      }
    }
  }

  // gait
  const g = data.gait ?? {};
  for (const k of ['crouch', 'walk', 'sprint']) if (g[k] != null && !(isNum(g[k]) && g[k] >= 0 && g[k] <= 2)) err(`gait.${k}`, 'must be 0..2');
  if (g.jitter != null && !(isNum(g.jitter) && g.jitter >= 0 && g.jitter < 0.5)) err('gait.jitter', 'must be 0..0.5');
  for (const k of ['noiseBase', 'noisePerIntensity']) if (g[k] != null && !(isNum(g[k]) && g[k] >= 0)) err(`gait.${k}`, 'must be ≥ 0 (metres)');

  // puddles
  for (const [id, p] of Object.entries(data.puddles ?? {})) {
    const f = `puddles.${id}`;
    if (objects && !objects[id]) err(f, `unknown object ${q(id)}`);
    if (!isObj(p)) { err(f, 'must be an object { size: [w, d], offset?, shrink? }'); continue; }
    for (const k of Object.keys(p)) if (!PUDDLE_KEYS.includes(k)) err(`${f}.${k}`, `unknown key (known: ${PUDDLE_KEYS.join(', ')})`);
    if (!isVec(p.size, 2) || p.size.some((v) => v <= 0)) err(`${f}.size`, 'needs [width, depth] in metres, > 0');
    if (p.offset != null && !isVec(p.offset, 2)) err(`${f}.offset`, 'must be [x, z] (local metres)');
    if (p.shrink != null && !(isNum(p.shrink) && p.shrink > 0 && p.shrink <= 1.5)) err(`${f}.shrink`, 'must be > 0 and ≤ 1.5');
  }

  // wet trail
  const w = data.wet ?? {};
  if (!isObj(w)) err('wet', 'must be an object');
  else {
    if (w.puddleSurface != null && !known.has(w.puddleSurface)) err('wet.puddleSurface', `unknown surface ${q(w.puddleSurface)}`);
    if (w.squelchPreset != null && sounds && !sounds[w.squelchPreset]) err('wet.squelchPreset', `unknown sound preset ${q(w.squelchPreset)}`);
    if (w.steps != null && !(Number.isInteger(w.steps) && w.steps >= 0 && w.steps <= 64)) err('wet.steps', 'must be an integer 0..64');
    if (w.maxPrints != null && !(Number.isInteger(w.maxPrints) && w.maxPrints >= 1 && w.maxPrints <= 256)) err('wet.maxPrints', 'must be an integer 1..256 (one draw call; keep it small)');
    if (w.life != null && !(isNum(w.life) && w.life > 0 && w.life <= 600)) err('wet.life', 'must be 0..600 s');
    for (const k of ['hold', 'minStrength', 'darkness', 'lifeJitter', 'squelchVolume', 'trailMin']) {
      if (w[k] != null && !(isNum(w[k]) && w[k] >= 0 && w[k] <= 1)) err(`wet.${k}`, 'must be 0..1');
    }
    if (w.color != null && !(isVec(w.color, 3) && w.color.every((c) => c >= 0 && c <= 1))) err('wet.color', 'must be [r, g, b] 0..1');
    if (w.size != null && !(isVec(w.size, 2) && w.size.every((v) => v > 0 && v < 1))) err('wet.size', 'must be [width, length] in metres (< 1)');
    for (const k of ['side', 'trailRadius']) if (w[k] != null && !(isNum(w[k]) && w[k] >= 0 && w[k] < 1)) err(`wet.${k}`, 'must be 0..1 m');
  }

  // rooms: overrides must name surfaces; floor textures should map to something
  for (const [rid, r] of Object.entries(rooms ?? {})) {
    if (!isObj(r)) continue;
    const f = `rooms.${rid}`;
    if (r.floorSurface != null && !known.has(r.floorSurface)) err(`${f}.floorSurface`, `unknown surface ${q(r.floorSurface)}`);
    if (r.cellSurfaces != null) {
      if (!isObj(r.cellSurfaces)) err(`${f}.cellSurfaces`, 'must be an object { "<layout char>": surface }');
      else for (const [ch, s] of Object.entries(r.cellSurfaces)) {
        if ([...ch].length !== 1) err(`${f}.cellSurfaces.${ch}`, 'keys are single layout characters');
        if (!known.has(s)) err(`${f}.cellSurfaces.${ch}`, `unknown surface ${q(s)}`);
      }
    }
    const floor = r.materials?.floor;
    if (floor && r.floorSurface == null && isObj(texMap) && !surfaceForTexture(floor, texMap)) {
      warn(`${f}.materials.floor`, `texture ${q(floor)} has no entry in surfaces.json "textures" (sounds like ${q(def)})`);
    }
  }
  return out;
}
