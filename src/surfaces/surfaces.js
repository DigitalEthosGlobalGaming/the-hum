// Floor surfaces: which surface is under a point, and which props are puddles.
// Pure (no Three.js, no DOM): shared by the game, the node tests and tools/validate.mjs.
// Data: content/surfaces.json (format in content/README.md, "surfaces.json").
//
// Lookup order for a point (x, z):
//   1. the room's `cellSurfaces[<layout char at that cell>]` (per-cell override in the room JSON)
//   2. the room's `floorSurface` (whole-room override)
//   3. the room's floor texture (`materials.floor`) through the `textures` map
//   4. `default`

export const CELL = 2; // metres per layout cell (src/world/roomBuilder.js)

export const SURFACE_DEFAULTS = {
  default: 'carpet',
  textures: {},
  surfaces: { carpet: { preset: 'footstep_carpet', volume: 1, noise: 1 } },
  gait: { crouch: 0.55, walk: 1, sprint: 1.4, jitter: 0.12, noiseBase: 2, noisePerIntensity: 3 },
  puddles: {},
  wet: {
    puddleSurface: 'puddle', steps: 14, maxPrints: 64, life: 45, lifeJitter: 0.15, hold: 0.25,
    minStrength: 0.2, darkness: 0.6, color: [0.42, 0.4, 0.33], size: [0.13, 0.3], side: 0.1,
    squelchPreset: 'footstep_squelch', squelchVolume: 0.8, trailRadius: 0.25, trailMin: 0.3,
  },
};

/** content.surfaces merged over the defaults (shallow per section). */
export function surfaceConfig(data = {}) {
  const d = SURFACE_DEFAULTS;
  return {
    default: data.default ?? d.default,
    textures: { ...d.textures, ...(data.textures ?? {}) },
    surfaces: { ...d.surfaces, ...(data.surfaces ?? {}) },
    gait: { ...d.gait, ...(data.gait ?? {}) },
    puddles: { ...d.puddles, ...(data.puddles ?? {}) },
    wet: { ...d.wet, ...(data.wet ?? {}) },
  };
}

const globCache = new Map();
/** "carpet_*" → /^carpet_.*$/ (only `*` is special). */
export function globToRegExp(glob) {
  let re = globCache.get(glob);
  if (!re) {
    re = new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    globCache.set(glob, re);
  }
  return re;
}

/**
 * Surface for a floor texture name: an exact key wins, else the most specific matching glob
 * (most literal characters), else null.
 */
export function surfaceForTexture(name, textures) {
  if (!name || !textures) return null;
  if (Object.hasOwn(textures, name) && !name.includes('*')) return textures[name];
  let best = null, bestLen = -1;
  for (const [glob, surface] of Object.entries(textures)) {
    if (!glob.includes('*')) continue;
    const lit = glob.replace(/\*/g, '').length;
    if (lit > bestLen && globToRegExp(glob).test(name)) { best = surface; bestLen = lit; }
  }
  return best;
}

/** Surface of a cell in a room JSON (rules 1–4 above). `cx, cz` are room-local cells. */
export function surfaceOfRoomCell(json, cx, cz, cfg) {
  if (json) {
    const ch = json.layout?.[cz]?.[cx];
    if (ch != null && json.cellSurfaces && Object.hasOwn(json.cellSurfaces, ch)) return json.cellSurfaces[ch];
    if (json.floorSurface) return json.floorSurface;
    const s = surfaceForTexture(json.materials?.floor, cfg.textures);
    if (s) return s;
  }
  return cfg.default;
}

/**
 * Surface under a world point. `world` needs `roomAt(x, z)` → placed `{ json, origin: {x, z} }`.
 */
export function surfaceAt(world, x, z, cfg) {
  const placed = world?.roomAt?.(x, z);
  if (!placed) return cfg.default;
  const ox = placed.origin?.x ?? placed.built?.grid?.ox ?? 0;
  const oz = placed.origin?.z ?? placed.built?.grid?.oz ?? 0;
  return surfaceOfRoomCell(placed.json, Math.floor((x - ox) / CELL), Math.floor((z - oz) / CELL), cfg);
}

// ------------------------------------------------------------------ puddles

/**
 * A puddle footprint on the floor for one instance (an ellipse), or null if `id` isn't a puddle.
 * `pos` = the instance root position, `rotY` its rotation (radians, Three.js convention),
 * `def` = { size: [w, d], offset?: [x, z] (local), shrink?: 0..1 }.
 */
export function puddleShape(def, pos, rotY = 0) {
  if (!def) return null;
  const [w, d] = def.size ?? [1, 1];
  const [lx, lz] = def.offset ?? [0, 0];
  const c = Math.cos(rotY), s = Math.sin(rotY);
  // Three.js rotation.y: x' = x cos + z sin, z' = -x sin + z cos
  const k = def.shrink ?? 1;
  return { x: pos.x + lx * c + lz * s, z: pos.z - lx * s + lz * c, rx: (w / 2) * k, rz: (d / 2) * k, rot: rotY };
}

/** Is (x, z) inside the puddle ellipse (grown by `margin` m)? */
export function inPuddle(p, x, z, margin = 0) {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  // world → local (inverse of puddleShape's rotation)
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const a = p.rx + margin, b = p.rz + margin;
  return (lx * lx) / (a * a) + (lz * lz) / (b * b) <= 1;
}

/** Puddle shapes for a list of object instances ({ id, root: { position, rotation } }). */
export function puddlesOf(instances, puddleDefs) {
  const out = [];
  for (const inst of instances ?? []) {
    const def = puddleDefs?.[inst.id];
    const p = def && (inst.root?.position ?? inst.pos);
    if (!p) continue;
    out.push(puddleShape(def, p, inst.root?.rotation?.y ?? inst.rotY ?? 0));
  }
  return out;
}

// ------------------------------------------------------------------ gait

/**
 * Footstep volume and Tenant loudness for a step. `k` = speed / walk speed (crouch ≈ 0.5,
 * walk 1, sprint ≈ 2). `surface` = { volume?, noise? }. `rand` 0..1 for the volume jitter.
 */
export function stepLevels(k, surface, gait, rand = 0.5) {
  let g;
  if (k <= 0.5) g = gait.crouch;
  else if (k <= 1) g = gait.crouch + (gait.walk - gait.crouch) * ((k - 0.5) / 0.5);
  else g = gait.walk + (gait.sprint - gait.walk) * Math.min(1, (k - 1) / 0.95);
  const jitter = 1 + (rand * 2 - 1) * (gait.jitter ?? 0);
  return {
    volume: (surface?.volume ?? 1) * g * jitter,
    loudness: (gait.noiseBase + gait.noisePerIntensity * k) * (surface?.noise ?? 1),
  };
}
