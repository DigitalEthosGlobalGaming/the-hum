// The secrets trigger matcher. Pure: the runtime hands it the event payload and an `env` of
// read-only accessors, so Node tests drive it with plain objects.
//
// where = { "<path>": test, "$special": ..., ... }   (every entry must pass)
//   path   dotted path into the payload: "id", "a.id", "inst.id", "speed", "on"
//   test   a value (equal), an array (one of), or { min, max, in, not, has, exists }
// Specials (env):
//   $light  { min?, max? }   world light 0..1 at the event position (else the player)
//   $torch  true|false       torch on / off
//   $room   { tags?: [...], key? }  the room at the event position (tags: any of)
//   $stage  { min?, max? }   story stage (spine notes collected, or game.stage if set)
//   $held   id | [ids] | null  what's in your hand (null: nothing)
//   $recent { event, within, where?, sameRoom? }  that event happened in the last `within` s
//                            (matching `where`; sameRoom: in the room you're in now)
// Stateful (handled by Trigger, not matchWhere):
//   $count  { n, within }    the rest must match n times within `within` s
//   $hold   seconds          (tick triggers) the rest must stay true this long

const OPS = ['min', 'max', 'in', 'not', 'has', 'exists'];

export function getPath(obj, path) {
  let v = obj;
  for (const k of String(path).split('.')) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

const isOpObj = (t) => t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t).some((k) => OPS.includes(k));

/** Does value v pass test t? */
export function matchValue(v, t) {
  if (Array.isArray(t)) return t.some((x) => matchValue(v, x));
  if (isOpObj(t)) {
    if (t.exists != null && (v != null) !== !!t.exists) return false;
    if (t.min != null && !(typeof v === 'number' && v >= t.min)) return false;
    if (t.max != null && !(typeof v === 'number' && v <= t.max)) return false;
    if (t.in != null && !(Array.isArray(t.in) && t.in.includes(v))) return false;
    if (t.not !== undefined && (Array.isArray(t.not) ? t.not.includes(v) : v === t.not)) return false;
    if (t.has != null && !(Array.isArray(v) && v.includes(t.has))) return false;
    return true;
  }
  return v === t;
}

/** A world point for a payload: pos, {x,z}, an inst (inst / a / stack-less), else null. */
export function payloadPos(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.pos && typeof p.pos.x === 'number') return p.pos;
  if (typeof p.x === 'number' && typeof p.z === 'number') return { x: p.x, y: p.y ?? 0, z: p.z };
  for (const k of ['inst', 'a', 'self']) {
    const r = p[k]?.root?.position;
    if (r) return { x: r.x, y: r.y ?? 0, z: r.z };
  }
  return null;
}

/**
 * Check every stateless entry of `where` against `payload`.
 * env = { now, lightAt(pos), torchOn, playerPos, roomAt(x,z) → {key, json}, stage, held (id|null),
 *         recent(event, within) → payloads[] }
 */
export function matchWhere(where = {}, payload = {}, env = {}) {
  const here = () => payloadPos(payload) ?? env.playerPos ?? null;
  for (const [k, t] of Object.entries(where)) {
    if (k === '$count' || k === '$hold') continue;
    if (k === '$light') {
      const p = here();
      const l = p && env.lightAt ? env.lightAt(p) : 1;
      if (!matchValue(l, t)) return false;
    } else if (k === '$torch') {
      if (!!env.torchOn !== !!t) return false;
    } else if (k === '$room') {
      const p = here();
      const room = p && env.roomAt ? env.roomAt(p.x, p.z) : null;
      if (t?.key != null && room?.key !== t.key) return false;
      if (t?.tags) {
        const tags = room?.json?.tags ?? room?.tags ?? [];
        if (!t.tags.some((x) => tags.includes(x))) return false;
      }
    } else if (k === '$stage') {
      if (!matchValue(env.stage ?? 0, t)) return false;
    } else if (k === '$held') {
      const h = env.held ?? null;
      if (t === null ? h !== null : !matchValue(h, t)) return false;
    } else if (k === '$recent') {
      if (!recentMatch(t, env)) return false;
    } else if (k.startsWith('$')) {
      return false; // unknown special: never matches (validate warns)
    } else if (!matchValue(getPath(payload, k), t)) return false;
  }
  return true;
}

function recentMatch(t, env) {
  const list = env.recent?.(t.event, t.within) ?? [];
  let roomKey;
  if (t.sameRoom) {
    const p = env.playerPos;
    roomKey = p && env.roomAt ? env.roomAt(p.x, p.z)?.key ?? null : null;
    if (roomKey == null) return false;
  }
  return list.some((e) => {
    if (t.where && !matchWhere(t.where, e, { ...env, recent: null })) return false;
    if (t.sameRoom) {
      const k = e.roomKey ?? (() => { const p = payloadPos(e); return p && env.roomAt ? env.roomAt(p.x, p.z)?.key : null; })();
      if (k !== roomKey) return false;
    }
    return true;
  });
}

/** One secret's trigger: matchWhere plus the stateful $count / $hold. */
export class Trigger {
  constructor(trigger = {}) {
    this.event = trigger.event;
    this.where = trigger.where ?? {};
    this.times = [];   // $count: match times inside the window
    this.since = null; // $hold: when the conditions started holding
  }

  /** Offer one event (or tick). True when the secret should fire now. */
  offer(payload, env) {
    const w = this.where;
    const now = env.now ?? 0;
    if (!matchWhere(w, payload, env)) { this.since = null; return false; }
    if (w.$hold != null) {
      if (this.since == null) this.since = now;
      if (now - this.since < w.$hold) return false;
      this.since = null;
    }
    if (w.$count) {
      const { n = 1, within = 10 } = w.$count;
      this.times = this.times.filter((t) => now - t <= within && t <= now);
      this.times.push(now);
      if (this.times.length < n) return false;
      this.times = [];
    }
    return true;
  }

  reset() { this.times = []; this.since = null; }
}
