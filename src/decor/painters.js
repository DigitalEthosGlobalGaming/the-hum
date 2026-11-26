// Procedural PS1-size textures for the set-dressing props ("proc:decor_*").
// Each painter draws into a 64×64 canvas and returns the [w, h] it used. Seeded by name, so they
// look the same every run. Alpha < 0.5 is cut out by the PS1 material, so decals use hard,
// dithered edges instead of soft gradients.

function speckle(g, w, h, rng, alpha = 0.08, density = 0.25) {
  for (let i = 0; i < w * h * density; i++) {
    g.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(rng.int(0, w - 1), rng.int(0, h - 1), 1, 1);
  }
}

/** Irregular blob: per-pixel test against a wobbly ellipse, with a darker tide-mark ring. */
function blob(g, rng, w, h, { fill, ring, inner = null, wobble = 0.22 }) {
  const cx = w / 2, cy = h / 2, rx = w / 2 - 1, ry = h / 2 - 1;
  const k = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const a = Math.atan2(dy, dx);
      const edge = 1 - wobble * (0.2 + 0.45 * Math.sin(a * 3 + k[0]) * Math.sin(a * 5 + k[1]) + 0.25 * Math.sin(a * 7 + k[2]));
      const d = Math.hypot(dx, dy) / edge;
      if (d > 1) continue;
      // dither the outer band so the cut-out edge looks ragged rather than vector-clean
      if (d > 0.9 && ((x + y) & 1)) continue;
      g.fillStyle = d > 0.78 ? ring : (inner && d < 0.35 ? inner : fill);
      g.fillRect(x, y, 1, 1);
    }
  }
}

export const decorPainters = {
  decor_water_stain(g, rng) {
    blob(g, rng, 64, 48, { fill: 'rgba(52,44,22,0.9)', ring: 'rgba(36,30,14,1)', inner: 'rgba(60,52,28,0.9)' });
    speckle(g, 64, 48, rng, 0.06, 0.1);
    return [64, 48];
  },

  decor_ceiling_stain(g, rng) {
    blob(g, rng, 64, 48, { fill: 'rgba(140,110,60,0.9)', ring: 'rgba(96,70,34,1)', inner: 'rgba(120,92,48,0.9)', wobble: 0.3 });
    return [64, 48];
  },

  decor_fabric(g, rng) {
    g.fillStyle = '#7a7e86'; g.fillRect(0, 0, 32, 32);
    for (let y = 0; y < 32; y += 2) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, y, 32, 1); }
    speckle(g, 32, 32, rng, 0.1, 0.4);
    g.fillStyle = 'rgba(40,30,10,0.18)'; g.fillRect(rng.int(4, 20), rng.int(18, 26), 7, 4); // a stain nobody cleaned
    return [32, 32];
  },

  decor_whiteboard(g, rng) {
    g.fillStyle = '#e6e6de'; g.fillRect(0, 0, 64, 40);
    speckle(g, 64, 40, rng, 0.04, 0.15);
    // ghosts of erased meetings
    g.fillStyle = 'rgba(60,70,120,0.16)';
    for (let i = 0; i < 6; i++) g.fillRect(rng.int(2, 40), rng.int(3, 34), rng.int(10, 22), 2);
    // the one diagram nobody erased: boxes and arrows that go nowhere
    g.fillStyle = 'rgba(30,40,110,0.75)';
    const boxAt = (x, y) => { g.fillRect(x, y, 10, 1); g.fillRect(x, y + 6, 10, 1); g.fillRect(x, y, 1, 7); g.fillRect(x + 9, y, 1, 7); };
    boxAt(6, 8); boxAt(26, 8); boxAt(16, 24);
    g.fillRect(16, 11, 10, 1); g.fillRect(31, 15, 1, 9); g.fillRect(21, 24, 10, 1);
    g.fillStyle = 'rgba(140,30,30,0.8)';
    g.fillRect(46, 6, 1, 26); g.fillRect(50, 6, 1, 26); g.fillRect(54, 6, 1, 26); g.fillRect(58, 6, 1, 26); // tallies…
    g.fillRect(44, 18, 17, 1);                                                                              // …struck through
    return [64, 40];
  },

  decor_cork(g, rng) {
    g.fillStyle = '#9a7448'; g.fillRect(0, 0, 48, 36);
    speckle(g, 48, 36, rng, 0.14, 0.5);
    const sheets = [[4, 4, 10, 13], [17, 3, 9, 12], [30, 6, 12, 9], [6, 20, 11, 12], [21, 19, 9, 13], [34, 19, 10, 12]];
    for (const [x, y, w, h] of sheets) {
      if (rng.chance(0.2)) continue; // a torn-off gap
      g.fillStyle = rng.chance(0.3) ? '#e2d48a' : '#ddd6c2'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(40,40,70,0.6)';
      for (let ly = y + 3; ly < y + h - 1; ly += 2) g.fillRect(x + 1, ly, rng.int(3, w - 2), 1);
      g.fillStyle = rng.chance(0.5) ? '#b02020' : '#2050a0'; g.fillRect(x + (w >> 1), y, 1, 1); // pin
    }
    return [48, 36];
  },

  decor_clock(g) {
    g.fillStyle = '#e4e0d0'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#1a1a1a';
    // 13 hour marks around the face
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2;
      g.fillRect(Math.round(16 + Math.sin(a) * 12), Math.round(16 - Math.cos(a) * 12), 2, 2);
    }
    for (let i = 0; i < 9; i++) g.fillRect(16, 16 - i, 1, 1);        // hour hand: straight up
    for (let i = 0; i < 11; i++) g.fillRect(16, 16 + i, 1, 1);       // minute hand: straight down
    g.fillStyle = '#a02020'; g.fillRect(15, 15, 3, 3);
    return [32, 32];
  },

  decor_plaid(g, rng) {
    g.fillStyle = '#6b3a30'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(30,40,30,0.55)';
    for (let i = 0; i < 32; i += 8) { g.fillRect(i, 0, 3, 32); g.fillRect(0, i, 32, 3); }
    g.fillStyle = 'rgba(220,190,120,0.35)';
    for (let i = 4; i < 32; i += 8) { g.fillRect(i, 0, 1, 32); g.fillRect(0, i, 32, 1); }
    speckle(g, 32, 32, rng, 0.1, 0.3);
    return [32, 32];
  },
};
