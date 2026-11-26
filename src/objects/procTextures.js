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
