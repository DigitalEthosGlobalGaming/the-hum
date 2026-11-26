// Item script registry: id → { id, run(ctx, params) }. Pure (Node-importable).
// The list comes from src/scripts/items/index.js (esbuild can't glob; tools/validate.mjs checks
// that every file in the folder is listed there and that every referenced script id exists).
import scripts from './items/index.js';

export function buildRegistry(list) {
  const map = new Map();
  for (const s of list) {
    if (!s || typeof s.id !== 'string' || typeof s.run !== 'function') {
      throw new Error(`Bad item script ${JSON.stringify(s?.id)}: needs { id: string, run(ctx, params) }`);
    }
    if (map.has(s.id)) throw new Error(`Duplicate item script id "${s.id}"`);
    map.set(s.id, s);
  }
  return map;
}

export const registry = buildRegistry(scripts);
export const scriptIds = () => [...registry.keys()];
export const getScript = (id) => registry.get(id) ?? null;
