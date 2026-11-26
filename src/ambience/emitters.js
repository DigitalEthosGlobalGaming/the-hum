// Which environmental emitters a placed room has. Pure: reads the placed room (objects, grid,
// json, lights) and calls emit(kind, x, y, z) for each one, so the caller can fill pooled records.
//   leak  a decor_leak / ceiling stain / water stain: drips onto the floor below it
//   vent  ceiling vents: cells of a room whose ceiling texture is a vent one, else a seeded few
import { Rng, hash } from '../core/rng.js';

export const LEAK_IDS = ['decor_leak', 'decor_ceiling_stain', 'decor_water_stain'];
const CELL = 2;
const VENT_Y = 2.85;

/**
 * @param placed  { key, objects?, json?, built: { grid: { w, h, solid, ox, oz }, lights } }
 * @param seed    world seed
 * @param cfg     { ventsPerRoom: [min, max], ventCellsPer?: 48 }
 */
export function scanRoom(placed, seed, cfg, emit) {
  // leaks: one emitter per spot (a ceiling stain and the damp patch under it are one leak)
  let nLeaks = 0;
  const lx = [], lz = [];
  for (const inst of placed.objects ?? []) {
    if (!LEAK_IDS.includes(inst.id)) continue;
    const p = inst.root?.position ?? inst.pos;
    if (!p) continue;
    let dup = false;
    for (let i = 0; i < lx.length; i++) if (Math.abs(lx[i] - p.x) < 1.2 && Math.abs(lz[i] - p.z) < 1.2) { dup = true; break; }
    if (dup) continue;
    lx.push(p.x); lz.push(p.z);
    emit('leak', p.x, 0.05, p.z);
    nLeaks++;
  }

  // vents
  const g = placed.built?.grid;
  let nVents = 0;
  if (g) {
    const rng = new Rng(hash(seed >>> 0, 'ambience-vents', placed.key));
    const lightCells = new Set((placed.built.lights ?? []).map((l) => l.cell[0] + ',' + l.cell[1]));
    const open = [];
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      if (!g.solid[cz * g.w + cx] && !lightCells.has(cx + ',' + cz)) open.push(cx, cz);
    }
    const cells = open.length / 2;
    if (cells) {
      const ceiling = String(placed.json?.materials?.ceiling ?? '');
      const [lo, hi] = cfg.ventsPerRoom ?? [0, 2];
      // a vent-textured ceiling is full of them: one emitter per ~ventCellsPer cells (at least 2)
      const want = /vent/.test(ceiling)
        ? Math.max(2, Math.round(cells / (cfg.ventCellsPer ?? 48)))
        : Math.min(hi, lo + Math.floor(rng.next() * (hi - lo + 1)) + (cells > 120 ? 1 : 0));
      for (let i = 0; i < want; i++) {
        const k = Math.floor(rng.next() * cells) * 2;
        emit('vent', g.ox + open[k] * CELL + CELL / 2, VENT_Y, g.oz + open[k + 1] * CELL + CELL / 2);
        nVents++;
      }
    }
  }
  return { leaks: nLeaks, vents: nVents };
}
