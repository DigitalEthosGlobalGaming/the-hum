// Physics feature module (imported for side effects from src/extensions.js):
// prop models, their procedural textures, and the factory that creates the physics system the
// first time gameplay needs it (src/physics/hooks.js → world.physics).
import { registerPrefabs } from '../objects/prefabs.js';
import { registerPainters } from '../objects/procTextures.js';
import { setPhysicsFactory } from './hooks.js';
import { PhysicsSystem } from './system.js';

setPhysicsFactory((gp) => new PhysicsSystem(gp));

const METAL = '#2a2a2a';
const STEEL = '#8a8c8e';
const PLASTIC = '#4a4f55';

registerPrefabs({
  // Rolls along its length (local z). Yellow mop bucket at the front, bin caddy at the back.
  janitor_cart: [
    { size: [0.5, 0.06, 1.0], pos: [0, 0.15, 0], tint: PLASTIC },                        // base tray
    { size: [0.06, 0.1, 0.06], pos: [-0.2, 0.05, -0.42], tint: METAL },                  // casters
    { size: [0.06, 0.1, 0.06], pos: [0.2, 0.05, -0.42], tint: METAL },
    { size: [0.06, 0.1, 0.06], pos: [-0.2, 0.05, 0.42], tint: METAL },
    { size: [0.06, 0.1, 0.06], pos: [0.2, 0.05, 0.42], tint: METAL },
    { size: [0.4, 0.32, 0.42], pos: [0, 0.34, -0.26], tint: '#c9a816', texture: 'proc:mop_bucket' }, // bucket
    { size: [0.3, 0.12, 0.1], pos: [0, 0.56, -0.4], tint: '#3a3a30' },                    // wringer
    { size: [0.44, 0.6, 0.38], pos: [0, 0.48, 0.25], tint: '#2b2e33' },                   // caddy + bag
    { size: [0.46, 0.04, 0.4], pos: [0, 0.79, 0.25], tint: PLASTIC },                     // caddy lid
    { size: [0.04, 0.85, 0.04], pos: [-0.2, 0.6, 0.47], tint: STEEL },                    // handle frame
    { size: [0.04, 0.85, 0.04], pos: [0.2, 0.6, 0.47], tint: STEEL },
    { size: [0.44, 0.04, 0.04], pos: [0, 1.02, 0.47], tint: STEEL },
    { size: [0.03, 1.15, 0.03], pos: [0.14, 0.78, -0.2], rot: [8, 0, -10], tint: '#8a7a5a' }, // mop handle
  ],
  // Two-shelf AV trolley with a CRT television strapped on top (decoration for now).
  av_cart: [
    { size: [0.7, 0.03, 0.5], pos: [0, 0.84, 0], tint: '#3b3d40' },                       // top shelf
    { size: [0.7, 0.03, 0.5], pos: [0, 0.45, 0], tint: '#3b3d40' },                       // middle shelf
    { size: [0.7, 0.03, 0.5], pos: [0, 0.13, 0], tint: '#3b3d40' },                       // bottom shelf
    { size: [0.03, 0.8, 0.03], pos: [-0.33, 0.47, -0.23], tint: STEEL },                  // posts
    { size: [0.03, 0.8, 0.03], pos: [0.33, 0.47, -0.23], tint: STEEL },
    { size: [0.03, 0.8, 0.03], pos: [-0.33, 0.47, 0.23], tint: STEEL },
    { size: [0.03, 0.8, 0.03], pos: [0.33, 0.47, 0.23], tint: STEEL },
    { size: [0.05, 0.08, 0.05], pos: [-0.31, 0.04, -0.21], tint: METAL },                 // casters
    { size: [0.05, 0.08, 0.05], pos: [0.31, 0.04, -0.21], tint: METAL },
    { size: [0.05, 0.08, 0.05], pos: [-0.31, 0.04, 0.21], tint: METAL },
    { size: [0.05, 0.08, 0.05], pos: [0.31, 0.04, 0.21], tint: METAL },
    { size: [0.42, 0.08, 0.3], pos: [0, 0.505, 0.02], tint: '#1c1c1e', texture: 'proc:vcr' }, // VCR
    { size: [0.52, 0.42, 0.44], pos: [0, 1.065, 0.03], tint: '#b9b2a0' },                 // CRT body
    { size: [0.36, 0.26, 0.14], pos: [0, 1.06, 0.3], tint: '#a9a290' },                   // CRT back bulge
    { size: [0.4, 0.3, 0.012], pos: [0, 1.08, -0.196], texture: 'proc:crt_screen', emissive: 0.35 }, // screen
  ],
  // Office swing-top bin: an octagon from two boxes, a rim and a black liner.
  trash_bin: [
    { size: [0.32, 0.5, 0.32], pos: [0, 0.25, 0], texture: 'proc:trash_bin', tint: '#6d726e' },
    { size: [0.32, 0.5, 0.32], pos: [0, 0.25, 0], rot: [0, 45, 0], texture: 'proc:trash_bin', tint: '#6d726e' },
    { size: [0.35, 0.03, 0.35], pos: [0, 0.505, 0], tint: '#4c504d' },
    { size: [0.35, 0.03, 0.35], pos: [0, 0.505, 0], rot: [0, 45, 0], tint: '#4c504d' },
    { size: [0.27, 0.02, 0.27], pos: [0, 0.515, 0], tint: '#141414' },
  ],
  glass_bottle: [
    { size: [0.075, 0.17, 0.075], pos: [0, 0.085, 0], texture: 'proc:glass_bottle' },
    { size: [0.05, 0.03, 0.05], pos: [0, 0.185, 0], tint: '#2c5a34' },                    // shoulder
    { size: [0.028, 0.08, 0.028], pos: [0, 0.24, 0], tint: '#2c5a34' },                   // neck
  ],
});

function speckle(g, w, h, rng, alpha = 0.08) {
  for (let i = 0; i < w * h * 0.25; i++) {
    g.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(rng.int(0, w - 1), rng.int(0, h - 1), 1, 1);
  }
}

registerPainters({
  soda_can(g, rng) {
    g.fillStyle = '#9a1f1f'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = '#e8e2d4'; g.fillRect(0, 12, 16, 6);           // white band
    g.fillStyle = '#9a1f1f'; g.fillRect(2, 14, 12, 2);
    g.fillStyle = '#bfc2c4'; g.fillRect(0, 0, 16, 2); g.fillRect(0, 30, 16, 2); // lid + base
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(3, 3, 1, 26);
    speckle(g, 16, 32, rng, 0.05);
    return [16, 32];
  },
  glass_bottle(g, rng) {
    g.fillStyle = '#2f6a3a'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = 'rgba(200,255,210,0.35)'; g.fillRect(3, 2, 2, 28);
    g.fillStyle = '#d8cfb0'; g.fillRect(0, 12, 16, 10);          // faded label
    g.fillStyle = '#6a4a2a'; g.fillRect(3, 15, 10, 1); g.fillRect(5, 18, 6, 1);
    speckle(g, 16, 32, rng, 0.06);
    return [16, 32];
  },
  broken_glass(g, rng) {
    g.clearRect(0, 0, 32, 32);
    for (let i = 0; i < 26; i++) {
      const x = 16 + Math.round(rng.range(-13, 13) * rng.range(0.3, 1));
      const y = 16 + Math.round(rng.range(-13, 13) * rng.range(0.3, 1));
      const s = rng.int(1, 3);
      g.fillStyle = rng.chance(0.3) ? 'rgba(220,255,225,0.95)' : 'rgba(60,130,75,0.95)';
      g.fillRect(x, y, s, rng.int(1, 2));
    }
    g.fillStyle = 'rgba(90,60,30,0.6)'; g.fillRect(rng.int(10, 18), rng.int(10, 18), 4, 2); // label scrap
    return [32, 32];
  },
  trash_bin(g, rng) {
    g.fillStyle = '#777b78'; g.fillRect(0, 0, 16, 32);
    for (let y = 2; y < 30; y += 4) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, 16, 1); }
    g.fillStyle = 'rgba(70,50,20,0.3)'; g.fillRect(rng.int(1, 10), rng.int(16, 26), 5, 3); // grime
    speckle(g, 16, 32, rng, 0.07);
    return [16, 32];
  },
  mop_bucket(g, rng) {
    g.fillStyle = '#c9a816'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#1a1a1a'; g.fillRect(6, 10, 20, 8);
    g.fillStyle = '#c9a816'; g.fillRect(8, 12, 3, 4); g.fillRect(13, 12, 3, 4); g.fillRect(18, 12, 6, 2);
    speckle(g, 32, 32, rng, 0.06);
    return [32, 32];
  },
  crt_screen(g, rng) {
    g.fillStyle = '#10140f'; g.fillRect(0, 0, 32, 24);
    for (let i = 0; i < 140; i++) {                                // dead-channel snow
      const v = rng.int(40, 140);
      g.fillStyle = `rgb(${v},${v + 8},${v})`;
      g.fillRect(rng.int(1, 30), rng.int(1, 22), 1, 1);
    }
    for (let y = 1; y < 24; y += 2) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, 32, 1); }
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 32, 1); g.fillRect(0, 23, 32, 1); g.fillRect(0, 0, 1, 24); g.fillRect(31, 0, 1, 24);
    return [32, 24];
  },
  vcr(g) {
    g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, 32, 8);
    g.fillStyle = '#050505'; g.fillRect(3, 2, 14, 3);              // tape slot
    g.fillStyle = '#3aff6a'; g.fillRect(22, 3, 6, 2);              // 12:00 blinking forever
    return [32, 8];
  },
});
