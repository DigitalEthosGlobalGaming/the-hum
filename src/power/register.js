// Power feature: prefabs and proc: textures for the light & power props (imported for side effects
// from src/extensions.js). The network itself is created by the world (world.power).
import { registerPrefabs } from '../objects/prefabs.js';
import { registerPainters } from '../objects/procTextures.js';

const CREAM = '#d8d0b8';

registerPrefabs({
  // children order matters: the network turns child [1] (the toggle)
  light_switch: [
    { size: [0.12, 0.17, 0.014], pos: [0, 0.085, 0], tint: CREAM },
    { size: [0.03, 0.06, 0.03], pos: [0, 0.085, -0.014], tint: '#fbf6e6' },
    { size: [0.14, 0.19, 0.006], pos: [0, 0.085, 0.006], tint: '#3a352c' }, // grimy outline on the wall
  ],
  // the last child is the flame (shown while lit)
  candle: [
    { size: [0.06, 0.1, 0.06], pos: [0, 0.05, 0], tint: '#e6dcc0' },
    { size: [0.075, 0.012, 0.075], pos: [0, 0.006, 0], tint: '#8a7a5a' },
    { size: [0.008, 0.02, 0.008], pos: [0, 0.11, 0], tint: '#222222' },
    { size: [0.024, 0.045, 0.024], pos: [0, 0.14, 0], tint: '#ffcc66', emissive: 1 },
  ],
  glow_marker: [
    { size: [0.022, 0.022, 0.16], pos: [0, 0.011, 0], tint: '#86ff6e', emissive: 1 },
    { size: [0.026, 0.026, 0.02], pos: [0, 0.013, 0.085], tint: '#2a4a2a' },
  ],
  music_box: [
    { size: [0.16, 0.08, 0.11], pos: [0, 0.04, 0], texture: 'proc:music_box' },
    { size: [0.165, 0.015, 0.115], pos: [0, 0.087, 0], tint: '#5a3a22' },
    { size: [0.01, 0.01, 0.04], pos: [0.085, 0.045, 0], rot: [0, 90, 0], tint: '#b8a060' },
    { size: [0.01, 0.035, 0.01], pos: [0.1, 0.06, 0], tint: '#b8a060' },
  ],
});

registerPainters({
  // fully transparent: the PS1 shader discards it, so only the highlight outline shows
  clear(g) { g.clearRect(0, 0, 4, 4); return [4, 4]; },

  tube_box(g, rng) {
    g.fillStyle = '#c9c2a8'; g.fillRect(0, 0, 16, 64);
    g.fillStyle = '#2f5a8a'; g.fillRect(0, 6, 16, 10);
    g.fillStyle = '#e8e2cc'; g.fillRect(3, 9, 10, 3);
    g.fillStyle = '#2f5a8a'; g.fillRect(0, 48, 16, 4);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.03, 0.1)})`; g.fillRect(rng.int(0, 15), rng.int(0, 63), 1, 1); }
    return [16, 64];
  },

  glow_pack(g) {
    g.fillStyle = '#1e3a24'; g.fillRect(0, 0, 32, 16);
    g.fillStyle = '#86ff6e';
    for (let i = 0; i < 3; i++) g.fillRect(4 + i * 9, 3, 4, 10);
    g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, 32, 2);
    return [32, 16];
  },

  matchbox(g) {
    g.fillStyle = '#a8321e'; g.fillRect(0, 0, 32, 16);
    g.fillStyle = '#e9d7a8'; g.fillRect(6, 4, 20, 8);
    g.fillStyle = '#1a1a1a'; g.fillRect(9, 7, 14, 2);
    g.fillStyle = '#4a3a2a'; g.fillRect(0, 14, 32, 2); // striker
    return [32, 16];
  },

  music_box(g, rng) {
    g.fillStyle = '#6e4a2c'; g.fillRect(0, 0, 32, 16);
    for (let y = 0; y < 16; y += 3) { g.fillStyle = 'rgba(30,15,5,0.25)'; g.fillRect(0, y + rng.int(0, 1), 32, 1); }
    g.fillStyle = '#c8a860'; g.fillRect(12, 5, 8, 6);
    g.fillStyle = '#e6d6a0'; g.fillRect(14, 7, 4, 2);
    return [32, 16];
  },

  // the dark_writing default (the network swaps in a per-message glow texture at runtime)
  glow_writing(g) {
    g.fillStyle = '#9dff8a';
    g.fillRect(4, 14, 56, 4); g.fillRect(48, 8, 4, 16); g.fillRect(52, 12, 4, 8);
    return [64, 32];
  },
});
