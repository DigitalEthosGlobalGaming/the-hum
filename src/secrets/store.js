// Cross-run memory of found secrets in localStorage (`the-hum.secrets.v1`). Every access is
// wrapped: private windows, blocked storage or a full quota just mean nothing is remembered.
//   { v: 1, found: { [secretId]: { at: epochMs } } }
export const STORAGE_KEY = 'the-hum.secrets.v1';

/** The browser's localStorage, or null when it's missing or access throws. */
export function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** { [id]: { at } } from storage (empty on any problem). */
export function loadFound(storage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    const found = data?.found;
    if (!found || typeof found !== 'object' || Array.isArray(found)) return {};
    const out = {};
    for (const [id, e] of Object.entries(found)) out[id] = { at: typeof e?.at === 'number' ? e.at : 0 };
    return out;
  } catch {
    return {};
  }
}

/** Write the found map. Returns false if storage refused. */
export function saveFound(storage, found) {
  try {
    if (!storage?.setItem) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, found }));
    return true;
  } catch {
    return false;
  }
}
