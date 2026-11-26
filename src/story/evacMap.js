// "YOU ARE HERE" evacuation maps. Each one shows the real layout of about 3 blocks around it (read
// straight from the world layout generator, so rooms that aren't built yet are on it too). About 1
// in 4 lie: they show a real piece of the building, just from somewhere else, so it looks right.
// Reading one copies it into the notebook auto-map (as "revealed" cells) and adds a map page.
import { Rng, hash } from '../core/rng.js';
import { stitchCells, CELLS_PER_BLOCK, CELL_M } from '../world/layout/index.js';
import { makePS1Material } from '../render/ps1.js';
import { story, stateOf, onInstance, canvasTex, makeCanvas } from './runtime.js';

export const REVEAL_R = 12;          // cells each side → 25×25 cells ≈ 3 blocks across
export const LIE_CHANCE = 0.25;

/** Does the map with this stable key lie this run? */
export function mapLies(seed, key) { return new Rng(hash(seed >>> 0, 'evacLie', key ?? '?')).chance(LIE_CHANCE); }

/** Where a lying map's picture is really from (cell offset, 4–9 blocks away). */
export function lieOffset(seed, key) {
  const r = new Rng(hash(seed >>> 0, 'evacLieAt', key ?? '?'));
  const B = CELLS_PER_BLOCK;
  const d = () => (r.chance(0.5) ? 1 : -1) * r.int(4, 9) * B;
  return [d(), d()];
}

/**
 * Cells [[cx, cz, v]] (v 1 floor, 2 wall) of the true layout in a (2R+1)² square around (cx, cz),
 * read from a world layout (createWorldLayout). `offset` samples somewhere else (a lie) but reports
 * the cells at the map's own coordinates.
 */
export function sampleLayout(layout, cx, cz, R = REVEAL_R, offset = [0, 0]) {
  const B = CELLS_PER_BLOCK;
  const sx = cx + offset[0], sz = cz + offset[1];
  const minBx = Math.floor((sx - R) / B), maxBx = Math.floor((sx + R) / B);
  const minBz = Math.floor((sz - R) / B), maxBz = Math.floor((sz + R) / B);
  const entries = layout.layoutRegion(minBx, minBz, maxBx, maxBz);
  const grid = stitchCells(entries, minBx, minBz, maxBx, maxBz);
  const out = [];
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const gx = sx + dx - grid.ox, gz = sz + dz - grid.oz;
    if (gx < 0 || gz < 0 || gx >= grid.w || gz >= grid.h) continue;
    const i = gz * grid.w + gx;
    if (!grid.filled[i]) continue;
    out.push([cx + dx, cz + dz, grid.walk[i] ? 1 : 2]);
  }
  return out;
}

/** The map's own cell: one step out from the wall it hangs on (its front faces local -z). */
export function mapCell(pos, rotY) {
  const fx = -Math.sin(rotY), fz = -Math.cos(rotY);
  return [Math.floor((pos.x + fx * 0.6) / CELL_M), Math.floor((pos.z + fz * 0.6) / CELL_M)];
}

/** Reveal data for a map inst: { id, cx, cz, lie, cells }. Cached on its per-run state. */
export function evacData(inst) {
  const game = story.game;
  if (!game?.world?.layout) return null;
  const key = story.gp.stableKey(inst) ?? `uid:${inst.uid}`;
  const [cx, cz] = mapCell(inst.root.position, inst.root.rotation.y);
  const lie = mapLies(game.seed, key);
  const cells = sampleLayout(game.world.layout, cx, cz, REVEAL_R, lie ? lieOffset(game.seed, key) : [0, 0]);
  return { id: `evac:${key}`, key, cx, cz, lie, cells };
}

// Each wall map shows its own (true or lying) plan, turned so "up" is the way you face when reading it.
onInstance('evac_map', (inst) => {
  const data = evacData(inst);
  const mesh = inst.root.children[0];
  if (!data || !mesh) return;
  const [c, g] = makeCanvas(64, 48);
  paintPlan(g, data, inst.root.rotation.y, stateOf(inst));
  const tex = canvasTex(c);
  mesh.material = makePS1Material(tex, { emissive: 0.12 });
  inst.evac = data;
});

function paintPlan(g, data, rotY, st) {
  g.fillStyle = '#e4e0d2'; g.fillRect(0, 0, 64, 48);
  g.fillStyle = '#a3241c'; g.fillRect(0, 0, 64, 6);                 // red header
  g.fillStyle = '#f2e8d0'; for (let x = 3; x < 40; x += 4) g.fillRect(x, 2, 3, 2);
  const at = new Map(data.cells.map(([x, z, v]) => [x + ',' + z, v]));
  // viewer faces into the wall: local +z. Screen up = that direction.
  const fx = Math.sin(rotY), fz = Math.cos(rotY);   // forward (into the wall) in world
  const rx = -fz, rz = fx;                           // viewer's right
  const S = 1.6, ox = 32, oy = 27;
  for (let v = -13; v <= 13; v++) for (let u = -19; u <= 19; u++) {
    // screen (u right, v down): world = c + right*u - forward*v
    const X = Math.round(data.cx + rx * u - fx * v), Z = Math.round(data.cz + rz * u - fz * v);
    const val = at.get(X + ',' + Z);
    if (val == null) continue;
    g.fillStyle = val === 1 ? '#f4f1e6' : '#4a5160';
    g.fillRect(Math.round(ox + u * S), Math.round(oy + v * S), 2, 2);
  }
  // exits in green, you-are-here in red
  g.fillStyle = '#2f7a3a'; g.fillRect(56, 40, 6, 6);
  g.fillStyle = '#d0281c'; g.fillRect(ox - 1, oy - 1, 3, 3);
  g.fillStyle = 'rgba(40,30,20,0.12)'; g.fillRect(0, 44, 64, 4);
  if (st?.read) { g.fillStyle = 'rgba(30,30,30,0.5)'; g.fillRect(ox + 3, oy - 4, 1, 1); } // a thumbprint smudge once read
}
