// Tiny procedural canvas textures for props ("proc:<name>" in object JSON).
// Drawn at PS1 sizes (16–64 px), nearest-filtered. Seeded so they look the same every run.
import * as THREE from 'three';
import { Rng } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function speckle(g, w, h, rng, alpha = 0.08) {
  for (let i = 0; i < w * h * 0.25; i++) {
    g.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(rng.int(0, w - 1), rng.int(0, h - 1), 1, 1);
  }
}

const painters = {
  white(g) { g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4); return [4, 4]; },

  paper(g, rng) {
    g.fillStyle = '#d9d2bd'; g.fillRect(0, 0, 32, 40);
    speckle(g, 32, 40, rng, 0.06);
    g.fillStyle = 'rgba(40,40,70,0.75)';
    for (let y = 6; y < 36; y += 4) {
      let x = 4;
      while (x < 28) { const len = rng.int(2, 6); g.fillRect(x, y, Math.min(len, 28 - x), 1); x += len + rng.int(1, 2); }
    }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, rng.int(12, 26), 32, 1); // fold
    return [32, 40];
  },

  battery(g) {
    g.fillStyle = '#1d1d1d'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = '#c28a1e'; g.fillRect(0, 0, 16, 12);
    g.fillStyle = '#e9e2cf'; g.fillRect(3, 16, 10, 2);
    g.fillStyle = '#888'; g.fillRect(6, 0, 4, 2);
    return [16, 32];
  },

  bottle(g, rng) {
    g.fillStyle = '#b8c7c2'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(3, 4, 2, 24);
    g.fillStyle = '#e8dfc4'; g.fillRect(0, 12, 16, 9);           // label
    g.fillStyle = '#7a5a2a'; g.fillRect(3, 15, 10, 1); g.fillRect(4, 17, 8, 1);
    g.fillStyle = '#3a6a8a'; g.fillRect(0, 0, 16, 3);            // cap
    speckle(g, 16, 32, rng, 0.05);
    return [16, 32];
  },

  cardboard(g, rng) {
    g.fillStyle = '#a07a4c'; g.fillRect(0, 0, 32, 32);
    speckle(g, 32, 32, rng, 0.1);
    g.fillStyle = '#c9b37a'; g.fillRect(0, 14, 32, 4);            // tape
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(rng.int(4, 20), rng.int(20, 26), 6, 3);
    return [32, 32];
  },

  scrawl(g, rng) {
    g.clearRect(0, 0, 64, 32);
    g.fillStyle = 'rgba(70,20,15,0.85)';
    // jittery block letters, never legible as real text up close: it's read via the readable component
    for (let row = 0; row < 3; row++) {
      let x = 2 + rng.int(0, 3);
      const y = 4 + row * 9;
      while (x < 60) {
        const w = rng.int(2, 4), h = rng.int(4, 6);
        g.fillRect(x, y + rng.int(-1, 1), 1, h);
        if (rng.chance(0.7)) g.fillRect(x, y + rng.int(0, 2), w, 1);
        if (rng.chance(0.5)) g.fillRect(x + w - 1, y, 1, h);
        x += w + rng.int(1, 3) + (rng.chance(0.15) ? 3 : 0);
      }
    }
    return [64, 32];
  },
  // ── M5 view-model (hands, torch, jacket, notebook) ──
  skin(g, rng) {
    g.fillStyle = '#b48a6c'; g.fillRect(0, 0, 16, 16);
    speckle(g, 16, 16, rng, 0.07);
    g.fillStyle = 'rgba(90,50,40,0.25)'; g.fillRect(0, 5, 16, 1); g.fillRect(0, 11, 16, 1); // knuckle creases
    return [16, 16];
  },

  sleeve(g, rng) {
    g.fillStyle = '#545b66'; g.fillRect(0, 0, 32, 32);
    speckle(g, 32, 32, rng, 0.12);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 3; y < 32; y += 7) g.fillRect(0, y + rng.int(0, 1), 32, 1);      // fabric folds
    g.fillStyle = '#3a3f47'; g.fillRect(0, 28, 32, 4);                              // cuff
    return [32, 32];
  },

  torch(g, rng) {
    g.fillStyle = '#3a3c3e'; g.fillRect(0, 0, 16, 32);
    for (let y = 2; y < 30; y += 2) { g.fillStyle = y % 4 ? '#2a2b2d' : '#46484a'; g.fillRect(0, y, 16, 1); } // knurling
    g.fillStyle = '#6a6c6e'; g.fillRect(0, 0, 16, 2);
    speckle(g, 16, 32, rng, 0.08);
    return [16, 32];
  },

  strap(g, rng) {
    g.fillStyle = '#151515'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#262626'; for (let y = 1; y < 16; y += 3) g.fillRect(1, y, 14, 1);
    speckle(g, 16, 16, rng, 0.06);
    return [16, 16];
  },

  jacket(g, rng) {
    g.fillStyle = '#34312b'; g.fillRect(0, 0, 32, 32);
    speckle(g, 32, 32, rng, 0.14);
    g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 2; x < 32; x += 6) g.fillRect(x + rng.int(0, 1), 0, 1, 32);
    return [32, 32];
  },

  pocket(g, rng) {
    g.fillStyle = '#1b1915'; g.fillRect(0, 0, 32, 16);
    g.fillStyle = '#4a453b'; g.fillRect(0, 0, 32, 2);                               // stitched lip
    g.fillStyle = '#8a8070'; for (let x = 1; x < 32; x += 3) g.fillRect(x, 3, 1, 1);  // stitches
    speckle(g, 32, 16, rng, 0.1);
    return [32, 16];
  },

  cover(g, rng) {
    g.fillStyle = '#4b2f22'; g.fillRect(0, 0, 32, 32);
    speckle(g, 32, 32, rng, 0.12);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, 3, 32);                      // spine
    g.fillStyle = 'rgba(255,230,190,0.12)'; g.fillRect(5, 5, 22, 1); g.fillRect(5, 26, 22, 1);
    return [32, 32];
  },

  // ---- M4 items ----
  paper_spine(g, rng) {
    // a folded page: warmer paper, denser handwriting, a page number in the corner
    g.fillStyle = '#e2d6b4'; g.fillRect(0, 0, 32, 40);
    speckle(g, 32, 40, rng, 0.07);
    g.fillStyle = 'rgba(30,30,50,0.85)';
    for (let y = 5; y < 34; y += 3) {
      let x = 3;
      while (x < 29) { const len = rng.int(1, 5); g.fillRect(x, y, Math.min(len, 29 - x), 1); x += len + 1; }
    }
    g.fillStyle = 'rgba(120,30,20,0.8)'; g.fillRect(25, 35, 4, 3);   // page number smudge
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(15, 0, 1, 40);       // fold
    return [32, 40];
  },

  chalk(g, rng) {
    g.fillStyle = '#ecebe4'; g.fillRect(0, 0, 8, 16);
    speckle(g, 8, 16, rng, 0.12);
    g.fillStyle = '#c9c7bd'; g.fillRect(0, 0, 8, 2);
    return [8, 16];
  },

  chalk_mark(g, rng) {
    // a rough arrow + tally, drawn by a shaky hand; transparent background
    g.clearRect(0, 0, 40, 30);
    g.fillStyle = 'rgba(236,234,226,0.9)';
    const jit = () => rng.int(-1, 1);
    for (let x = 4; x < 30; x++) g.fillRect(x, 14 + (x % 7 === 0 ? jit() : 0), 1, 2); // shaft
    for (let i = 0; i < 8; i++) { g.fillRect(30 - i + jit(), 14 - i, 2, 1); g.fillRect(30 - i + jit(), 15 + i, 2, 1); } // head
    for (let t = 0; t < 3; t++) g.fillRect(6 + t * 4, 21 + jit(), 1, 6);                // tally
    return [40, 30];
  },

  chalk_arrow(g, rng) {
    // floor arrow pointing "up" the texture (= the way the player faced)
    g.clearRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(236,234,226,0.85)';
    for (let y = 8; y < 28; y++) g.fillRect(15 + (y % 6 === 0 ? rng.int(-1, 1) : 0), y, 2, 1);
    for (let i = 0; i < 9; i++) { g.fillRect(15 - i, 4 + i, 2, 1); g.fillRect(15 + i, 4 + i, 2, 1); }
    return [32, 32];
  },

  tape_recorder(g, rng) {
    g.fillStyle = '#2c2a28'; g.fillRect(0, 0, 32, 24);
    g.fillStyle = '#5b5750'; g.fillRect(2, 2, 28, 11);                 // cassette window
    g.fillStyle = '#9a8f78'; g.fillRect(4, 4, 24, 7);
    g.fillStyle = '#1a1a1a'; g.fillRect(8, 6, 4, 4); g.fillRect(20, 6, 4, 4); // reels
    g.fillStyle = '#777'; for (let i = 0; i < 4; i++) g.fillRect(3 + i * 7, 16, 5, 4); // keys
    g.fillStyle = '#b02020'; g.fillRect(3, 16, 5, 4);                   // record key
    speckle(g, 32, 24, rng, 0.06);
    return [32, 24];
  },

  fuse(g) {
    g.fillStyle = '#e6e0d0'; g.fillRect(0, 0, 8, 16);
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 8, 3); g.fillRect(0, 13, 8, 3); // metal caps
    g.fillStyle = '#7a2a1a'; g.fillRect(2, 7, 4, 2);                          // rating band
    return [8, 16];
  },

  fuse_box(g, rng) {
    g.fillStyle = '#8e8a7c'; g.fillRect(0, 0, 32, 64);
    speckle(g, 32, 64, rng, 0.08);
    g.fillStyle = '#5e5b52'; g.fillRect(2, 2, 28, 60);                   // door seam
    g.fillStyle = '#9c9888'; g.fillRect(3, 3, 26, 58);
    g.fillStyle = '#d8c23a'; g.fillRect(9, 8, 14, 9);                    // warning label
    g.fillStyle = '#1a1a1a'; g.fillRect(15, 9, 2, 5); g.fillRect(15, 15, 2, 1);
    g.fillStyle = '#3a3a3a'; g.fillRect(25, 30, 2, 8);                   // handle
    g.fillStyle = 'rgba(80,50,20,0.35)'; g.fillRect(rng.int(4, 20), rng.int(40, 56), 6, 4); // rust
    return [32, 64];
  },
};

export function makeProcTexture(name) {
  const painter = painters[name];
  if (!painter) throw new Error(`Unknown procedural texture "proc:${name}"`);
  const [c, g] = canvas(64, 64);
  const [w, h] = painter(g, new Rng('proc:' + name));
  // crop to the painted size
  const [out, og] = canvas(w, h);
  og.drawImage(c, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export const procTextureNames = Object.keys(painters);
