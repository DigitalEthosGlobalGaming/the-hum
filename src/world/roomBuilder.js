// Room JSON → merged meshes (one per material), solid-cell grid and light list.
// Cell = 2 m × 2 m. Positions in room JSON are local metres from the room's origin corner.
import * as THREE from 'three';
import { makePS1Material } from '../render/ps1.js';

export const CELL = 2;
export const WALL_H = 3;
// Tessellation: ~0.5 m sub-quads.
const SUB_FLOOR = 4;
const SUB_WALL_U = 4;
const SUB_WALL_V = 6;

// Materials are shared by every room (streaming builds and drops rooms constantly).
const materialCache = new Map();

// Built-in tile kinds a legend symbol can map to.
const KINDS = {
  wall:   { solid: true },
  pillar: { solid: true },
  floor:  { solid: false },
  door:   { solid: false },
  light:  { solid: false, light: true },
  void:   { solid: true, invisible: true },
};

// Accumulates quads per material key, then emits one BufferGeometry per key.
// Each quad is tessellated into su × sv sub-quads (bilinear over corners a b c d, uv 0..1).
// Smaller triangles keep PS1 affine warping and per-vertex lighting from going extreme up close.
class QuadBatch {
  constructor() { this.groups = new Map(); }
  quad(key, a, b, c, d, n, su = 1, sv = 1) {
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { pos: [], nrm: [], uv: [], idx: [] }));
    const base = g.pos.length / 3;
    for (let j = 0; j <= sv; j++) {
      const v = j / sv;
      for (let i = 0; i <= su; i++) {
        const u = i / su;
        // bottom edge a→b, top edge d→c
        for (let k = 0; k < 3; k++) {
          const bot = a[k] + (b[k] - a[k]) * u;
          const top = d[k] + (c[k] - d[k]) * u;
          g.pos.push(bot + (top - bot) * v);
        }
        g.nrm.push(n[0], n[1], n[2]);
        g.uv.push(u, v);
      }
    }
    const row = su + 1;
    for (let j = 0; j < sv; j++) {
      for (let i = 0; i < su; i++) {
        const p = base + j * row + i;
        g.idx.push(p, p + 1, p + row + 1, p, p + row + 1, p + row);
      }
    }
  }
  build() {
    const out = [];
    for (const [key, g] of this.groups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setIndex(g.idx);
      geo.computeBoundingSphere();
      out.push({ key, geo });
    }
    return out;
  }
}

/**
 * @param room  parsed room JSON
 * @param textures  TextureBank (get(name) → THREE.Texture)
 * @param origin  world offset {x, z} in metres
 */
export function buildRoom(room, textures, origin = { x: 0, z: 0 }) {
  const rows = room.layout;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const legend = room.legend;
  const mats = room.materials;
  const kindAt = (cx, cz) => {
    if (cz < 0 || cz >= h || cx < 0 || cx >= w) return 'void';
    const ch = rows[cz][cx] ?? ' ';
    const k = legend[ch];
    if (!k) throw new Error(`Room "${room.id}": no legend entry for "${ch}" at ${cx},${cz}`);
    return k;
  };

  const batch = new QuadBatch();
  const solid = new Uint8Array(w * h);
  const lights = [];
  const ox = origin.x, oz = origin.z;

  for (let cz = 0; cz < h; cz++) {
    for (let cx = 0; cx < w; cx++) {
      const kind = kindAt(cx, cz);
      const k = KINDS[kind];
      if (!k) throw new Error(`Room "${room.id}": unknown tile kind "${kind}"`);
      solid[cz * w + cx] = k.solid ? 1 : 0;
      if (k.solid) continue;

      const x0 = ox + cx * CELL, x1 = x0 + CELL;
      const z0 = oz + cz * CELL, z1 = z0 + CELL;
      // floor (faces up) and ceiling (faces down)
      batch.quad('floor', [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], SUB_FLOOR, SUB_FLOOR);
      const ceilKey = k.light ? 'ceilingLight' : 'ceiling';
      batch.quad(ceilKey, [x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], [0, -1, 0], SUB_FLOOR, SUB_FLOOR);
      if (k.light) {
        lights.push({ pos: new THREE.Vector3(x0 + CELL / 2, WALL_H - 0.3, z0 + CELL / 2), seed: cx * 31 + cz * 17 });
      }

      // walls on each side that borders a solid cell, facing into this cell
      const sides = [
        { dx: 0, dz: -1, a: [x1, 0, z0], b: [x0, 0, z0], n: [0, 0, 1] },  // north
        { dx: 0, dz: 1,  a: [x0, 0, z1], b: [x1, 0, z1], n: [0, 0, -1] }, // south
        { dx: -1, dz: 0, a: [x0, 0, z0], b: [x0, 0, z1], n: [1, 0, 0] },  // west
        { dx: 1, dz: 0,  a: [x1, 0, z1], b: [x1, 0, z0], n: [-1, 0, 0] }, // east
      ];
      for (const s of sides) {
        const nk = kindAt(cx + s.dx, cz + s.dz);
        // 'void' (outside the layout, or outside a multi-slot room's footprint) belongs to the
        // neighbouring room: an opening on the border continues there, so don't seal it.
        if (!KINDS[nk].solid || nk === 'void') continue;
        const key = nk === 'pillar' ? 'pillar' : 'wall';
        // Counter-clockwise as seen from inside the cell (b → a), so the front face points at the player.
        batch.quad(key,
          [s.b[0], 0, s.b[2]], [s.a[0], 0, s.a[2]],
          [s.a[0], WALL_H, s.a[2]], [s.b[0], WALL_H, s.b[2]], s.n, SUB_WALL_U, SUB_WALL_V);
      }
    }
  }

  const group = new THREE.Group();
  group.name = `room:${room.id}`;
  for (const { key, geo } of batch.build()) {
    const texName = key === 'ceilingLight' ? (mats.ceilingLight ?? 'ceiling_large_light_on')
      : key === 'pillar' ? (mats.pillar ?? mats.wall) : mats[key];
    const emissive = key === 'ceilingLight' ? 1 : 0;
    const matKey = texName + '|' + emissive;
    let mat = materialCache.get(matKey);
    if (!mat) materialCache.set(matKey, (mat = makePS1Material(textures.get(texName), { emissive })));
    group.add(new THREE.Mesh(geo, mat));
  }

  return {
    group, lights,
    grid: { w, h, solid, ox, oz },
    isSolidAt(x, z) {
      const cx = Math.floor((x - ox) / CELL), cz = Math.floor((z - oz) / CELL);
      if (cx < 0 || cz < 0 || cx >= w || cz >= h) return true;
      return solid[cz * w + cx] === 1;
    },
    spawn: room.spawn
      ? new THREE.Vector3(ox + room.spawn.pos[0], 0, oz + room.spawn.pos[2])
      : new THREE.Vector3(ox + CELL * 1.5, 0, oz + CELL * 1.5),
    spawnYaw: THREE.MathUtils.degToRad(room.spawn?.rot ?? 0),
  };
}
