// `container` component runtime: sliding drawers you can see, per-run open state, the aimed drawer
// as the hand's verb, and spawning what a compartment held (into your hand if there's room, else
// into the drawer opening / the vending tray).
//
// JSON (see content/README.md):
//   "container": {
//     "compartments": [{ "pool": "story_drawer_top", "name"?: "top drawer" }, ...],
//     "stuckChance"?: 0.5,
//     "drawers"?: { "bottom": 0.06, "height": 0.42, "width": 0.42, "depth": 0.56, "front": -0.31, "slide": 0.38 }
//   }
//   "container": { "vend": { "pool", "wrongPool"?, "eatChance"?: 0.15, "wrongChance"?: 0.15 },
//                  "tray"?: [x, y, z] }   (local point where vended items land)
// Registered into the engine's component table from here (src/story/register.js imports it).
import * as THREE from 'three';
import { components } from '../objects/components/index.js';
import { story, stateOf, onReady } from '../story/runtime.js';
import { compartmentsOf, stuckIndex, aimedCompartment } from './logic.js';

const DRAWER_DEFAULTS = { bottom: 0.06, height: 0.42, width: 0.42, depth: 0.56, front: -0.31, slide: 0.38 };
export const drawerLayout = (cfg) => ({ ...DRAWER_DEFAULTS, ...(cfg.drawers ?? {}), count: compartmentsOf(cfg).length });

components.container = {
  attach(inst, cfg, sys) {
    inst.container = { drawers: [], peek: -1 };
    if (cfg.vend) return;
    const L = drawerLayout(cfg);
    const tint = inst.def.mesh?.tint ?? '#6b6e66';
    const metal = sys.material('proc:cabinet_metal', tint);
    const front = sys.material('proc:drawer_front', tint);
    const inside = sys.material('proc:white', '#2a2a27');
    const dark = sys.material('proc:white', '#1c1c1a');
    for (let i = 0; i < L.count; i++) {
      const row = L.count - 1 - i; // 0 = top
      const g = new THREE.Group();
      const y0 = L.bottom + row * L.height;
      g.position.set(0, y0, 0);
      const h = L.height - 0.03, w = L.width, d = L.depth;
      const part = (sx, sy, sz, x, y, z, m) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
        mesh.position.set(x, y, z);
        g.add(mesh);
        return mesh;
      };
      part(w + 0.02, h, 0.02, 0, h / 2 + 0.015, L.front, front);                      // face
      part(0.12, 0.022, 0.03, 0, h * 0.72, L.front - 0.02, dark);                     // handle
      part(0.06, 0.035, 0.004, 0, h * 0.86, L.front - 0.012, sys.material('proc:white', '#d8d0b0')); // label card
      part(w - 0.02, 0.015, d - 0.02, 0, 0.03, L.front + d / 2, inside);              // floor
      part(0.012, h * 0.6, d - 0.02, -w / 2 + 0.012, h * 0.3 + 0.03, L.front + d / 2, metal); // sides
      part(0.012, h * 0.6, d - 0.02, w / 2 - 0.012, h * 0.3 + 0.03, L.front + d / 2, metal);
      part(w - 0.02, h * 0.6, 0.012, 0, h * 0.3 + 0.03, L.front + d - 0.01, metal);  // back
      inst.root.add(g);
      inst.container.drawers.push({ group: g, open: 0, y0 });
    }
  },

  update(inst, cfg, sys, dt) {
    const c = inst.container;
    if (!c?.drawers.length) return;
    const st = story.gp ? stateOf(inst) : inst.state;
    const L = drawerLayout(cfg);
    const focused = story.game?.focus?.inst === inst;
    if (focused) c.peek = aimedRow(inst, cfg);
    for (let i = 0; i < c.drawers.length; i++) {
      const d = c.drawers[i];
      let target = st?.opened?.[i] ? 1 : 0;
      if (!target && focused && c.peek === i) target = 0.05; // the aimed drawer eases out a touch
      if (d.jolt > 0) { d.jolt = Math.max(0, d.jolt - dt); target = 0.04 * Math.abs(Math.sin(d.jolt * 60)); }
      d.open += (target - d.open) * Math.min(1, dt * (target > d.open ? 7 : 10));
      d.group.position.z = -d.open * L.slide;
    }
  },
};

/** Which drawer row the player is aiming at on this container. */
export function aimedRow(inst, cfg = inst.def.components.container) {
  const game = story.game;
  if (!game) return 0;
  const cam = game.camera.position;
  const dir = game.gameplay.viewDir();
  return aimedCompartment(inst.root.position, inst.root.rotation.y, cam, dir, drawerLayout(cfg));
}

/** World point inside drawer i's opening (for items that don't fit in the pockets). */
export function drawerSpot(inst, i, cfg = inst.def.components.container, n = 0) {
  const L = drawerLayout(cfg);
  const row = i; // 0 = top
  const y = L.bottom + (L.count - 1 - row) * L.height + 0.05;
  const local = new THREE.Vector3((n % 2 ? 0.08 : -0.06), y, L.front - L.slide + 0.18 + (n > 1 ? 0.1 : 0));
  return toWorld(inst, local);
}

/** World point of a vending machine's tray. */
export function traySpot(inst, cfg = inst.def.components.container) {
  const t = cfg.tray ?? [-0.1, 0.2, -0.5];
  return toWorld(inst, new THREE.Vector3(t[0], t[1], t[2]));
}

// local → world by the inst's position + Y rotation (works on plain {position, rotation} roots too)
function toWorld(inst, v) {
  const r = inst.root, a = r.rotation?.y ?? 0, c = Math.cos(a), s = Math.sin(a);
  return { x: r.position.x + v.x * c + v.z * s, y: r.position.y + v.y, z: r.position.z - v.x * s + v.z * c };
}

/** Kick the stuck drawer's rattle animation. */
export function rattle(inst, i) {
  const d = inst.container?.drawers?.[i];
  if (d) d.jolt = 0.45;
}

// The hand's verb tag names the drawer you're aiming at ("open top drawer", "stuck").
// verbFor() reads def.components.interact.verb, so containers get a live getter on their def.
onReady((game) => {
  for (const def of Object.values(game.content.objects ?? {})) {
    const c = def.components?.container;
    const it = def.components?.interact;
    if (!c || !it || c.vend) continue;
    const fallback = it.verb ?? 'open';
    Object.defineProperty(it, 'verb', {
      configurable: true,
      enumerable: true,
      get() {
        const inst = story.game?.focus?.inst;
        if (!inst || inst.def !== def) return fallback;
        const i = aimedRow(inst, c);
        const st = stateOf(inst);
        const name = compartmentsOf(c)[i]?.name ?? 'drawer';
        if (st?.opened?.[i]) return `${name} (open)`;
        if (st?.rattles && i === stuckIndex(c, game.seed, story.gp.stableKey(inst))) return `${name} (stuck)`;
        return `open ${name}`;
      },
    });
  }
});
