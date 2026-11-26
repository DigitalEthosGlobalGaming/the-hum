// Secrets content format + validation. Pure (no DOM, no Three.js): shared by the game and
// tools/validate.mjs.
//
//   content/secrets/<id>.json
//   { id, title, hint?, order?, once: true, trigger: { event, where: {...} }, script, params? }
//
// The matcher (`where`) is documented in content/README.md and implemented in ./matcher.js.

/** Events a secret may trigger on. `tick` is the secrets runtime's own 4×/s poll (for $hold). */
export const KNOWN_EVENTS = [
  'tick',
  'prop:collide', 'prop:topple', 'prop:carry', 'prop:shatter',
  'item:pickup', 'item:drop', 'item:use', 'item:throw', 'item:combine',
  'readable:open', 'note:collected',
  'power:switch', 'power:fuse', 'power:tube',
  'light:candle', 'light:timed', 'aura:start',
  'camera:flash', 'world:noise', 'flashlight:change',
  'phone:answer',
];

/** Special `where` keys (everything else is a dotted path into the event payload). */
export const SPECIAL_KEYS = ['$light', '$torch', '$room', '$stage', '$held', '$recent', '$count', '$hold'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Check one secret definition. Returns [{ level: 'error'|'warn', field, msg }].
 * @param ctx { scripts?: string[] (known script ids), notes?, objects? }
 */
export function validateSecret(s, ctx = {}) {
  const out = [];
  const err = (field, msg) => out.push({ level: 'error', field, msg });
  const warn = (field, msg) => out.push({ level: 'warn', field, msg });
  if (!isObj(s)) { err('', 'must be a JSON object'); return out; }
  if (typeof s.title !== 'string' || !s.title) err('title', 'needs a title (shown once found)');
  if (s.hint != null && typeof s.hint !== 'string') err('hint', 'must be a string');
  if (s.order != null && !isNum(s.order)) err('order', 'must be a number');
  if (s.once !== true) warn('once', 'secrets fire once per run; set "once": true');
  if (typeof s.script !== 'string' || !s.script) err('script', 'needs a script id (src/scripts/items)');
  else if (ctx.scripts && !ctx.scripts.includes(s.script)) err('script', `unknown script ${JSON.stringify(s.script)} (not listed in src/scripts/items/index.js)`);
  if (s.params != null && !isObj(s.params)) err('params', 'must be an object');
  const t = s.trigger;
  if (!isObj(t)) { err('trigger', 'needs { event, where? }'); return out; }
  if (!KNOWN_EVENTS.includes(t.event)) err('trigger.event', `unknown event ${JSON.stringify(t.event)} (known: ${KNOWN_EVENTS.join(', ')})`);
  if (t.where != null && !isObj(t.where)) { err('trigger.where', 'must be an object'); return out; }
  checkWhere(t.where ?? {}, 'trigger.where', { err, warn, event: t.event });
  if (s.params?.note && ctx.notes && !ctx.notes[s.params.note]) err('params.note', `unknown note ${JSON.stringify(s.params.note)}`);
  for (const f of ['noteObject', 'wheel', 'reward', 'writing']) {
    if (typeof s.params?.[f] === 'string' && ctx.objects && !ctx.objects[s.params[f]]) err(`params.${f}`, `unknown object ${JSON.stringify(s.params[f])}`);
  }
  return out;
}

function checkWhere(where, path, { err, warn, event }) {
  for (const [k, v] of Object.entries(where)) {
    const f = `${path}.${k}`;
    if (!k.startsWith('$')) continue;
    if (!SPECIAL_KEYS.includes(k)) { warn(f, `unknown matcher key (known: ${SPECIAL_KEYS.join(', ')})`); continue; }
    if (k === '$hold') {
      if (!isNum(v) || v <= 0) err(f, 'must be seconds > 0');
      else if (event !== 'tick') warn(f, '$hold only makes sense on "tick" triggers');
    }
    if (k === '$count' && !(isObj(v) && Number.isInteger(v.n) && v.n >= 1 && isNum(v.within) && v.within > 0)) err(f, 'must be { n: integer ≥ 1, within: seconds > 0 }');
    if (k === '$torch' && typeof v !== 'boolean') err(f, 'must be true or false');
    if (k === '$held' && !(typeof v === 'string' || Array.isArray(v) || v === null)) err(f, 'must be an item id, an array of ids, or null (empty hand)');
    if (k === '$recent') {
      if (!isObj(v) || !KNOWN_EVENTS.includes(v.event)) err(f, `needs { event (known), within, where?, sameRoom? }`);
      else {
        if (!isNum(v.within) || v.within <= 0) err(`${f}.within`, 'must be seconds > 0');
        if (v.where != null) checkWhere(v.where, `${f}.where`, { err, warn, event: v.event });
      }
    }
  }
}
