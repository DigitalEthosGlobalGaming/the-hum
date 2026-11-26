// Prefabs and proc: textures for the container and story props (registered at load time).
// Part order matters where a runtime module swaps a part's material:
//   typewriter[4] = paper (story/typewriter.js)   flash_camera[3] = shot counter (story/camera.js)
//   id_badge[0] = card face (story/badges.js)
import { registerPrefabs } from '../objects/prefabs.js';
import { registerPainters } from '../objects/procTextures.js';

const STEEL = '#6b6e66';
const DARK = '#1c1c1a';

registerPrefabs({
  // carcass only: the drawers are built by the container component so they can slide
  filing_cabinet: [
    { size: [0.02, 1.32, 0.62], pos: [-0.22, 0.66, 0], texture: 'proc:cabinet_metal', tint: STEEL },
    { size: [0.02, 1.32, 0.62], pos: [0.22, 0.66, 0], texture: 'proc:cabinet_metal', tint: STEEL },
    { size: [0.46, 0.03, 0.62], pos: [0, 1.315, 0], texture: 'proc:cabinet_metal', tint: STEEL },
    { size: [0.46, 1.32, 0.02], pos: [0, 0.66, 0.3], texture: 'proc:cabinet_metal', tint: STEEL },
    { size: [0.46, 0.06, 0.62], pos: [0, 0.03, 0], tint: '#3a3b37' },
    { size: [0.42, 0.012, 0.6], pos: [0, 0.48, 0.005], tint: '#2c2d2a' },
    { size: [0.42, 0.012, 0.6], pos: [0, 0.9, 0.005], tint: '#2c2d2a' },
  ],
  vending_machine: [
    { size: [0.9, 1.85, 0.78], pos: [0, 0.925, 0.02], texture: 'proc:vending_body', tint: '#7a2622' },
    { size: [0.6, 1.15, 0.02], pos: [-0.1, 1.15, -0.38], texture: 'proc:vending_front', emissive: 0.42 },  // lit window
    { size: [0.18, 0.46, 0.02], pos: [0.33, 1.25, -0.38], texture: 'proc:vending_keypad', emissive: 0.22 },
    { size: [0.05, 0.09, 0.02], pos: [0.33, 0.9, -0.385], tint: '#b8b0a0' },                              // coin slot plate
    { size: [0.02, 0.05, 0.01], pos: [0.33, 0.9, -0.395], tint: DARK },
    { size: [0.6, 0.22, 0.03], pos: [-0.1, 0.3, -0.385], tint: '#0c0c0c' },                               // tray opening
    { size: [0.62, 0.03, 0.06], pos: [-0.1, 0.42, -0.4], tint: '#4a4a46' },                               // tray lip
    { size: [0.9, 0.06, 0.78], pos: [0, 0.03, 0.02], tint: '#2a1a18' },
  ],
  typewriter: [
    { size: [0.42, 0.07, 0.32], pos: [0, 0.035, 0], tint: '#2b2d2a' },
    { size: [0.4, 0.1, 0.2], pos: [0, 0.1, 0.05], rot: [-10, 0, 0], texture: 'proc:typewriter_body', tint: '#3c4a3e' },
    { size: [0.36, 0.03, 0.12], pos: [0, 0.08, -0.1], rot: [12, 0, 0], texture: 'proc:typewriter_keys' },
    { size: [0.46, 0.06, 0.07], pos: [0, 0.19, 0.1], tint: '#2a2a28' },
    { size: [0.24, 0.2, 0.004], pos: [0, 0.3, 0.12], rot: [-12, 0, 0], texture: 'proc:paper_blank' },
    { size: [0.04, 0.02, 0.02], pos: [-0.25, 0.21, 0.1], tint: '#9a9890' },                                // return lever
  ],
  walkie_talkie: [
    { size: [0.07, 0.17, 0.04], pos: [0, 0.085, 0], texture: 'proc:walkie', tint: '#3a3f38' },
    { size: [0.014, 0.12, 0.014], pos: [0.022, 0.23, 0.004], tint: DARK },
    { size: [0.018, 0.02, 0.018], pos: [-0.018, 0.18, 0.004], tint: DARK },                               // knob
    { size: [0.012, 0.012, 0.004], pos: [0.0, 0.158, -0.021], tint: '#ff3a20', emissive: 1 },             // LED
  ],
  flash_camera: [
    { size: [0.13, 0.065, 0.042], pos: [0, 0.0325, 0], texture: 'proc:flash_camera' },
    { size: [0.036, 0.036, 0.016], pos: [0.018, 0.034, -0.026], tint: '#121212' },                        // lens
    { size: [0.038, 0.02, 0.006], pos: [-0.04, 0.05, -0.022], tint: '#f4f2e8', emissive: 0.35 },          // flash window
    { size: [0.022, 0.022, 0.046], pos: [0.045, 0.048, 0], texture: 'proc:camera_counter', emissive: 0.3 }, // counter window (all faces show the digit)
    { size: [0.018, 0.01, 0.01], pos: [-0.045, 0.069, 0.0], tint: '#2a2a2a' },                            // shutter button
  ],
  coin: [
    { size: [0.024, 0.004, 0.024], pos: [0, 0.002, 0], texture: 'proc:coin' },
    { size: [0.018, 0.0045, 0.03], pos: [0, 0.002, 0], texture: 'proc:coin' },
    { size: [0.03, 0.0045, 0.018], pos: [0, 0.002, 0], texture: 'proc:coin' },
  ],
  id_badge: [
    { size: [0.056, 0.004, 0.086], pos: [0, 0.003, 0], texture: 'proc:id_badge' },
    { size: [0.014, 0.003, 0.012], pos: [0, 0.005, -0.048], tint: '#9a9a9a' },                            // clip
    { size: [0.012, 0.002, 0.2], pos: [0.01, 0.002, -0.15], rot: [0, 8, 0], tint: '#2c4c7a' },            // lanyard
  ],
  red_string: [
    { size: [0.07, 0.066, 0.07], pos: [0, 0.035, 0], texture: 'proc:red_string' },
    { size: [0.074, 0.05, 0.05], pos: [0, 0.035, 0], rot: [0, 45, 0], texture: 'proc:red_string' },
    { size: [0.004, 0.004, 0.06], pos: [0.02, 0.004, -0.06], rot: [0, 20, 0], tint: '#8a1010' },          // loose end
  ],
  red_string_end: [
    { size: [0.03, 0.018, 0.03], pos: [0, 0.009, 0], texture: 'proc:red_string' },
    { size: [0.004, 0.004, 0.08], pos: [0.01, 0.003, 0.05], rot: [0, 30, 0], tint: '#8a1010' },
  ],
  blank_tape: [
    { size: [0.1, 0.016, 0.064], pos: [0, 0.008, 0], texture: 'proc:cassette' },
  ],
});

const fill = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function speck(g, w, h, rng, a = 0.08) {
  for (let i = 0; i < w * h * 0.2; i++) fill(g, rng.chance(0.5) ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`, rng.int(0, w - 1), rng.int(0, h - 1), 1, 1);
}

registerPainters({
  cabinet_metal(g, rng) {
    fill(g, '#c9cbc4', 0, 0, 32, 32);
    speck(g, 32, 32, rng, 0.06);
    for (let i = 0; i < 4; i++) fill(g, 'rgba(70,50,30,0.18)', rng.int(0, 28), rng.int(0, 28), rng.int(2, 5), 1); // scratches
    return [32, 32];
  },
  drawer_front(g, rng) {
    fill(g, '#cfd1ca', 0, 0, 32, 32);
    speck(g, 32, 32, rng, 0.07);
    fill(g, 'rgba(0,0,0,0.25)', 0, 0, 32, 1); fill(g, 'rgba(0,0,0,0.25)', 0, 31, 32, 1);
    fill(g, 'rgba(255,255,255,0.2)', 1, 1, 30, 1);
    return [32, 32];
  },
  vending_body(g, rng) {
    fill(g, '#d9d4cc', 0, 0, 32, 64);
    speck(g, 32, 64, rng, 0.07);
    fill(g, 'rgba(0,0,0,0.2)', 0, 60, 32, 4);
    return [32, 64];
  },
  vending_front(g, rng) {
    fill(g, '#1c2a33', 0, 0, 32, 64);
    const cols = ['#c23a2a', '#e0b030', '#3a7ac0', '#40a050', '#d06a20', '#a040a0', '#e8e0d0'];
    for (let row = 0; row < 6; row++) {
      fill(g, '#5a6a72', 1, 9 + row * 9, 30, 1);                       // shelf
      for (let c = 0; c < 5; c++) {
        if (rng.chance(0.18)) continue;                                // an empty coil
        fill(g, rng.pick(cols), 2 + c * 6, 3 + row * 9, 4, 6);
        fill(g, 'rgba(255,255,255,0.3)', 2 + c * 6, 3 + row * 9, 1, 6);
      }
    }
    fill(g, 'rgba(180,220,255,0.12)', 0, 0, 32, 64);                   // glass sheen
    fill(g, 'rgba(255,255,255,0.18)', 22, 0, 3, 64);
    return [32, 64];
  },
  vending_keypad(g) {
    fill(g, '#2a2a2a', 0, 0, 16, 40);
    fill(g, '#5a9a5a', 2, 2, 12, 6);                                   // display
    fill(g, '#204020', 3, 4, 6, 2);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) fill(g, '#b8b2a2', 2 + c * 4, 12 + r * 5, 3, 3);
    fill(g, '#c03a2a', 4, 33, 8, 4);                                   // coin return
    return [16, 40];
  },
  typewriter_body(g, rng) {
    fill(g, '#4a5a4c', 0, 0, 32, 16);
    speck(g, 32, 16, rng, 0.08);
    fill(g, '#c8b880', 11, 6, 10, 2);                                  // brand plate
    return [32, 16];
  },
  typewriter_keys(g) {
    fill(g, '#202020', 0, 0, 32, 16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) fill(g, '#d8d2bf', 1 + c * 3 + (r % 2), 1 + r * 4, 2, 2);
    fill(g, '#d8d2bf', 6, 14, 18, 1);                                  // space bar
    return [32, 16];
  },
  paper_blank(g, rng) {
    fill(g, '#d8d2bf', 0, 0, 16, 16);
    speck(g, 16, 16, rng, 0.05);
    return [16, 16];
  },
  walkie(g, rng) {
    fill(g, '#3a3f38', 0, 0, 16, 32);
    speck(g, 16, 32, rng, 0.08);
    for (let y = 8; y < 18; y += 2) fill(g, '#1a1c19', 3, y, 10, 1);   // grille
    fill(g, '#7a8a6a', 4, 21, 8, 4);                                   // channel window
    fill(g, '#2a2a2a', 0, 26, 2, 5);                                   // PTT
    return [16, 32];
  },
  flash_camera(g) {
    fill(g, '#e8c020', 0, 0, 32, 16);                                  // cardboard wrap
    fill(g, '#1a1a1a', 0, 10, 32, 6);
    fill(g, '#d02020', 2, 2, 10, 4);
    fill(g, '#ffffff', 3, 3, 8, 1);
    fill(g, '#1a1a1a', 20, 3, 8, 3);
    return [32, 16];
  },
  camera_counter(g) {
    fill(g, '#141414', 0, 0, 8, 8);
    fill(g, '#e8d8a0', 3, 2, 2, 4);
    return [8, 8];
  },
  coin(g) {
    fill(g, '#b9a463', 0, 0, 8, 8);
    fill(g, '#d8c886', 1, 1, 3, 2);
    fill(g, '#8a7a40', 5, 5, 2, 2);
    return [8, 8];
  },
  id_badge(g) {
    fill(g, '#efece2', 0, 0, 12, 18);
    fill(g, '#3d5a7a', 0, 0, 12, 3);
    fill(g, '#8c97a0', 3, 4, 6, 7);
    fill(g, '#333', 2, 13, 8, 1);
    return [12, 18];
  },
  red_string(g, rng) {
    fill(g, '#8a1010', 0, 0, 16, 16);
    for (let i = 0; i < 14; i++) fill(g, rng.chance(0.5) ? '#a81a16' : '#5a0808', 0, rng.int(0, 15), 16, 1); // wound turns
    return [16, 16];
  },
  cassette(g) {
    fill(g, '#202020', 0, 0, 32, 20);
    fill(g, '#e8e0c8', 3, 2, 26, 9);                                   // label (blank)
    fill(g, '#b03030', 3, 2, 26, 1);
    fill(g, '#444', 8, 12, 4, 4); fill(g, '#444', 20, 12, 4, 4);       // reels
    fill(g, '#111', 13, 13, 6, 2);
    return [32, 20];
  },
  evac_map(g) {
    fill(g, '#e4e0d2', 0, 0, 32, 24);
    fill(g, '#a3241c', 0, 0, 32, 4);
    fill(g, '#4a5160', 4, 8, 24, 1); fill(g, '#4a5160', 4, 20, 24, 1); fill(g, '#4a5160', 4, 8, 1, 12); fill(g, '#4a5160', 27, 8, 1, 12);
    fill(g, '#d0281c', 15, 14, 2, 2);
    return [32, 24];
  },
});
