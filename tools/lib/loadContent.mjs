// Single loader for content/ and asset lists, shared by build.mjs (virtual:content,
// virtual:textures) and the Node tools (validate, pool-sim, room-preview).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONTENT_DIR = path.join(ROOT, 'content');
export const TEXTURE_DIR = path.join(ROOT, 'assets/textures');
export const SCRIPT_DIR = path.join(ROOT, 'src/scripts/items');

/** Recursively list files under dir ending in ext, sorted (deterministic bundle order). */
export function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p, ext);
    return p.endsWith(ext) ? [p] : [];
  }).sort();
}

/**
 * Load content/ exactly as the game sees it:
 *   content/<kind>/**\/*.json → content[kind][id]   (id = json.id ?? file name)
 *   content/<name>.json      → content[name]       (e.g. content/config.json → content.config)
 * Returns { content, sources, files }:
 *   sources[kind][id] = path relative to the repo root (for error messages); sources[name] for top-level files.
 *   files = absolute paths of every JSON read (for watch mode).
 * Throws on bad JSON or a duplicate id.
 */
export function loadContent(dir = CONTENT_DIR) {
  const files = walk(dir, '.json');
  const content = {};
  const sources = {};
  for (const f of files) {
    const relFile = path.relative(ROOT, f);
    const rel = path.relative(dir, f).split(path.sep);
    const kind = rel[0].replace(/\.json$/, '');
    let data;
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { throw new Error(`Bad JSON in ${relFile}: ${e.message}`); }
    if (rel.length === 1) { content[kind] = data; sources[kind] = relFile; continue; }
    content[kind] ??= {};
    sources[kind] ??= {};
    const id = data?.id ?? path.basename(f, '.json');
    if (content[kind][id]) throw new Error(`Duplicate ${kind} id "${id}" in ${relFile} (also in ${sources[kind][id]})`);
    content[kind][id] = data;
    sources[kind][id] = relFile;
  }
  return { content, sources, files };
}

/** PNG files in assets/textures (absolute paths). */
export function textureFiles(dir = TEXTURE_DIR) {
  return walk(dir, '.png');
}

/** Texture names (file names without .png) available to materials and meshes. */
export function listTextures(dir = TEXTURE_DIR) {
  return textureFiles(dir).map((f) => path.basename(f, '.png'));
}

/**
 * Item/room script ids, or null if the script folder doesn't exist yet (M4).
 * Uses `id: '...'` from each file when present, else the file name.
 */
export function listScripts(dir = SCRIPT_DIR) {
  if (!fs.existsSync(dir)) return null;
  return walk(dir, '.js').map((f) => {
    const m = fs.readFileSync(f, 'utf8').match(/\bid\s*:\s*['"]([\w-]+)['"]/);
    return m ? m[1] : path.basename(f, '.js');
  });
}
