// Player settings: the pure part (no DOM, no game). Defaults, ranges, versioned load/save/migrate.
// Stored in localStorage under SETTINGS_KEY as { version, values }. Every storage access is wrapped:
// private windows, blocked site data and sandboxed iframes throw, and the game must still run.
//
// Each spec entry: { type: 'number'|'bool', min?, max?, log? } — `log` sliders move the value
// geometrically (sensitivity feels even across the travel). Sliders are 0..1 positions;
// toSlider/fromSlider convert.

export const SETTINGS_KEY = 'the-hum.settings.v1';
export const SETTINGS_VERSION = 1;

export const SPEC = Object.freeze({
  mouseSensitivity: { type: 'number', min: 0.25, max: 3, log: true, def: 1 },   // × config.player.mouseSensitivity
  invertY: { type: 'bool', def: false },
  masterVolume: { type: 'number', min: 0, max: 1, def: 0.9 },                    // synth.setVolume (gain = slider²)
  ambienceVolume: { type: 'number', min: 0, max: 1, def: 0.8 },
  effectsVolume: { type: 'number', min: 0, max: 1, def: 0.8 },
  textScale: { type: 'number', min: 0.8, max: 1.5, def: 1 },                     // cfg.ui.textScale
  textGrit: { type: 'number', min: 0, max: 1, def: 0.4 },                        // cfg.ui.textGrit
  captions: { type: 'bool', def: true },
  textPrompts: { type: 'bool', def: true },
  reduceFlashing: { type: 'bool', def: false },
  calm: { type: 'bool', def: false },                                            // the Tenant keeps its distance
  fullscreen: { type: 'bool', def: true },                                       // want fullscreen when playing
});

/** Defaults, taking the shipped config.ui values where they exist. */
export function defaultsFrom(cfg = {}) {
  const ui = cfg.ui ?? {};
  const d = {};
  for (const [k, s] of Object.entries(SPEC)) d[k] = s.def;
  if (typeof ui.textScale === 'number') d.textScale = ui.textScale;
  if (typeof ui.textGrit === 'number') d.textGrit = ui.textGrit;
  if (typeof ui.captions === 'boolean') d.captions = ui.captions;
  if (typeof ui.textPrompts === 'boolean') d.textPrompts = ui.textPrompts;
  if (typeof ui.reduceFlashing === 'boolean') d.reduceFlashing = ui.reduceFlashing;
  if (typeof ui.fullscreenOnStart === 'boolean') d.fullscreen = ui.fullscreenOnStart;
  return sanitize(d, null);
}

/** Coerce one value to its spec (clamped number / bool); undefined if it can't be. */
export function coerce(key, v) {
  const s = SPEC[key];
  if (!s) return undefined;
  if (s.type === 'bool') return typeof v === 'boolean' ? v : v === 1 || v === 0 ? !!v : undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(s.max, Math.max(s.min, n));
}

/** Known keys only, each coerced; missing / bad ones fall back to `defaults` (or the spec default). */
export function sanitize(obj, defaults = null) {
  const out = {};
  for (const [k, s] of Object.entries(SPEC)) {
    const v = obj && typeof obj === 'object' ? coerce(k, obj[k]) : undefined;
    out[k] = v ?? defaults?.[k] ?? s.def;
  }
  return out;
}

export function toSlider(key, v) {
  const s = SPEC[key];
  if (!s || s.type !== 'number') return 0;
  if (s.log) return Math.log(v / s.min) / Math.log(s.max / s.min);
  return (v - s.min) / (s.max - s.min);
}
export function fromSlider(key, t) {
  const s = SPEC[key];
  t = Math.min(1, Math.max(0, t));
  if (s.log) return s.min * Math.pow(s.max / s.min, t);
  return s.min + (s.max - s.min) * t;
}

// Step-by-step migrations: MIGRATIONS[n] turns a version-n record into version n+1.
// v0 = the unversioned flat object an early dev build wrote ({ sensitivity, volume: {…}, … }).
const MIGRATIONS = {
  0: (raw) => {
    const v = { ...raw };
    if ('sensitivity' in v) v.mouseSensitivity = v.sensitivity;
    if (v.volume && typeof v.volume === 'object') {
      v.masterVolume = v.volume.master; v.ambienceVolume = v.volume.ambience; v.effectsVolume = v.volume.sfx;
    }
    return { version: 1, values: v };
  },
};

/**
 * Parsed storage record → { values, status }. status: 'ok' | 'migrated' | 'newer' | 'corrupt'.
 * A newer record (a later build wrote it) is read best-effort but flagged so it isn't overwritten.
 */
export function migrate(rec, defaults) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { values: { ...defaults }, status: 'corrupt' };
  let version = Number.isInteger(rec.version) ? rec.version : 0;
  if (version > SETTINGS_VERSION) return { values: sanitize(rec.values, defaults), status: 'newer' };
  let cur = rec;
  let migrated = false;
  while (version < SETTINGS_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { values: { ...defaults }, status: 'corrupt' };
    cur = step(cur);
    version = cur.version;
    migrated = true;
  }
  return { values: sanitize(cur.values, defaults), status: migrated ? 'migrated' : 'ok' };
}

/** localStorage if it works, else null. */
export function getStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const k = '__the-hum-probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/**
 * → { values, status } where status adds 'default' (nothing stored) and 'blocked' (storage threw /
 * is missing). Never throws.
 */
export function loadSettings(storage, defaults = defaultsFrom()) {
  if (!storage) return { values: { ...defaults }, status: 'blocked' };
  let text;
  try { text = storage.getItem(SETTINGS_KEY); } catch { return { values: { ...defaults }, status: 'blocked' }; }
  if (text == null) return { values: { ...defaults }, status: 'default' };
  let rec;
  try { rec = JSON.parse(text); } catch { return { values: { ...defaults }, status: 'corrupt' }; }
  return migrate(rec, defaults);
}

/** Write { version, values }. Returns true on success; never throws. */
export function saveSettings(storage, values) {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, values: sanitize(values) }));
    return true;
  } catch {
    return false;
  }
}
