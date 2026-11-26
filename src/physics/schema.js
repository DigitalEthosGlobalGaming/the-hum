// The `physics` component: fields, defaults and validation. Pure (no Three.js), shared by the
// game and tools/validate.mjs.
//
//   "physics": {
//     "mode": "static" | "push" | "carry" | "throw",
//     "shape": "box" | "circle", "radius"?: m,
//     "mass": kg, "friction": 1/s, "stop": m/s², "restitution": 0..1,
//     "spin": 0..1, "straight": bool,
//     "topple": m/s | null, "spill": poolId, "shatter": { "speed", "into", "noise"? },
//     "noise": m, "throwSpeed": m/s,
//     "sound": { "roll", "impact", "topple", "land", "break" }
//   }
//
// Modes build on each other: every non-static mode is a dynamic body on the floor that the
// player can push. `carry` adds E to pick it up into a held-in-front pose; `throw` (with a
// `pickup` component) lets the pocket item be thrown with the throw key.

export const MODES = ['static', 'push', 'carry', 'throw'];
export const SHAPES = ['box', 'circle'];
export const SOUND_KEYS = ['roll', 'impact', 'topple', 'land', 'break'];
const FIELDS = ['mode', 'shape', 'radius', 'mass', 'friction', 'stop', 'restitution', 'spin', 'straight',
  'topple', 'spill', 'shatter', 'noise', 'throwSpeed', 'sound'];

const BY_MODE = {
  static: { mass: 0 },
  push: { mass: 15, friction: 2.5, stop: 1.0 },
  carry: { mass: 5, friction: 4, stop: 2.0 },
  throw: { mass: 0.4, friction: 1.2, stop: 0.6 },
};

/** Fill in defaults. Returns a new object; never mutates the JSON. */
export function physicsConfig(c = {}) {
  const mode = MODES.includes(c.mode) ? c.mode : 'push';
  const d = BY_MODE[mode];
  const spin = clamp01(c.spin ?? 0.2);
  return {
    mode,
    dynamic: mode !== 'static',
    canCarry: mode === 'carry',
    canThrow: mode === 'throw' || mode === 'carry',
    shape: SHAPES.includes(c.shape) ? c.shape : 'box',
    radius: c.radius ?? null,
    mass: c.mass ?? d.mass,
    friction: c.friction ?? d.friction ?? 2,
    stop: c.stop ?? d.stop ?? 1,
    restitution: c.restitution ?? 0.3,
    spin,
    grip: 0.08 + spin * 0.6,                  // tangential contact friction → spin from glancing pushes
    angFriction: 4.5 - spin * 3.5,            // casters keep spinning; boxes stop turning quickly
    straight: !!c.straight,
    topple: c.topple ?? null,
    spill: c.spill ?? null,
    shatter: c.shatter ?? null,
    noise: c.noise ?? 6,
    throwSpeed: c.throwSpeed ?? (mode === 'throw' ? 8 : 4.5),
    sound: { ...(c.sound ?? {}) },
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Check a physics component. Returns [{ level: 'error'|'warn', field, msg }].
 * @param ctx { objects, sounds, pools, def } (any may be missing; checks are skipped)
 */
export function validatePhysics(c, ctx = {}) {
  const out = [];
  const err = (field, msg) => out.push({ level: 'error', field, msg });
  const warn = (field, msg) => out.push({ level: 'warn', field, msg });
  if (!c || typeof c !== 'object' || Array.isArray(c)) { err('', 'must be an object'); return out; }
  for (const k of Object.keys(c)) if (!FIELDS.includes(k)) warn(k, `unknown field (known: ${FIELDS.join(', ')})`);
  if (!MODES.includes(c.mode)) err('mode', `expected one of ${MODES.join('/')}, got ${JSON.stringify(c.mode)}`);
  if (c.shape != null && !SHAPES.includes(c.shape)) err('shape', `expected box/circle, got ${JSON.stringify(c.shape)}`);
  for (const f of ['radius', 'mass', 'friction', 'stop', 'restitution', 'spin', 'noise', 'throwSpeed']) {
    if (c[f] != null && (!isNum(c[f]) || c[f] < 0)) err(f, 'must be a number ≥ 0');
  }
  if (c.mode !== 'static' && c.mass != null && c.mass <= 0) err('mass', 'dynamic bodies need mass > 0');
  if (c.restitution > 1) warn('restitution', 'above 1 adds energy on every bounce');
  if (c.topple != null && !(isNum(c.topple) && c.topple > 0)) err('topple', 'must be an impact speed in m/s (> 0)');
  if (c.spill != null) {
    if (c.topple == null) warn('spill', 'only happens when it topples; set "topple"');
    if (ctx.pools && typeof c.spill === 'string' && !ctx.pools[c.spill]) err('spill', `unknown pool ${JSON.stringify(c.spill)}`);
  }
  if (c.shatter != null) {
    if (!isNum(c.shatter.speed)) err('shatter.speed', 'needs a landing speed in m/s');
    if (c.shatter.into && ctx.objects && !ctx.objects[c.shatter.into]) err('shatter.into', `unknown object ${JSON.stringify(c.shatter.into)}`);
  }
  if (c.sound != null) {
    if (typeof c.sound !== 'object') err('sound', 'must be { roll?, impact?, topple?, land?, break? }');
    else for (const [k, id] of Object.entries(c.sound)) {
      if (!SOUND_KEYS.includes(k)) warn(`sound.${k}`, `unknown sound slot (known: ${SOUND_KEYS.join(', ')})`);
      else if (ctx.sounds && !ctx.sounds[id]) err(`sound.${k}`, `unknown sound preset ${JSON.stringify(id)}`);
    }
  }
  if (c.mode === 'throw' && ctx.def && !ctx.def.components?.pickup) warn('mode', '"throw" items need a "pickup" component to reach your pockets');
  return out;
}
