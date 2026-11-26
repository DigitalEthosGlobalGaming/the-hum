// Text layer: a 2D canvas over the game canvas, drawn in renderDiegetic() after the PS1 post pass.
// Its look is one dial, cfg.ui.textGrit (0..1, see setTextGrit in index.js), that moves several
// things together so every value stays coherent:
//   glyph resolution  canvas backing scale: device pixels at 0 → ~the low-res scene grid at 1
//                     (floored so base text stays ≥ 9 backing px tall)
//                     (CSS `image-rendering: pixelated` does the nearest-neighbour upscale)
//   dither/quantise   the scene's 4x4 Bayer + 15-bit quantise, blended in at strength = grit
//   ink               bleed (soft shadow) and a warmer, softer ink; contrast stays ≥ 4.5:1
//   jitter            per-glyph offset/rotation 0 → ~1.5 px (glyphs drawn whole, never broken)
//   paper             speckle and edge raggedness rise with grit
// Sizes are in CSS px and scale with the viewport: base ≈ 22 px at 1080p × cfg.ui.textScale.
import { Rng, hash } from '../../core/rng.js';
import { makeCanvas, paperScrap, wrapText, HAND_FONT } from './text.js';

const lerp = (a, b, t) => a + (b - a) * t;
const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
// crisp ↔ gritty endpoints. #3a2a1c on #d9cba8 is ~8:1, so contrast holds at full grit.
const INK0 = '#1b1812', INK1 = '#3a2a1c';
const PAPER0 = '#e9e0c9', PAPER1 = '#d9cba8';
const RED0 = '#6e1c18', RED1 = '#7a2a1c';
export const INK = INK0, PAPER = PAPER0, RED_INK = RED0;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export class TextLayer {
  constructor(game) {
    this.game = game;
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3,
      imageRendering: 'pixelated',
    });
    document.body.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.scraps = new Map();
    this.rects = [];
    this.dirty = true;
    this.unit = 1;      // CSS px per drawing unit (≠ 1 inside page())
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  get grit() { return Math.max(0, Math.min(1, this.game.cfg.ui?.textGrit ?? 0.4)); }

  /** Backing pixels per CSS px for the current grit. */
  targetScale() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const H = Math.max(1, window.innerHeight);
    const scene = (this.game.renderer.lowRes?.y || 240) / H;
    // floor: base text never drops below ~9 backing px tall, so full grit stays readable
    const px = Math.max(15, (22 * H) / 1080) * (this.game.cfg.ui?.textScale ?? 1);
    const floor = Math.min(dpr, Math.max(scene, 9 / px));
    // geometric: each step of grit removes the same fraction of resolution
    return dpr * Math.pow(floor / dpr, Math.pow(this.grit, 0.8));
  }

  resize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.scale = this.targetScale();
    this.canvas.width = Math.max(1, Math.round(this.W * this.scale));
    this.canvas.height = Math.max(1, Math.round(this.H * this.scale));
    this.dirty = true;
  }

  /** Base text size in CSS px: ~22 px at 1080p, scaled by the viewport and ui.textScale. */
  get px() { return Math.max(15, (22 * this.H) / 1080) * (this.game.cfg.ui?.textScale ?? 1); }
  /** CSS px per low-res scene pixel (paper edges are drawn at this grain). */
  get pp() { return Math.max(1, Math.round(this.H / (this.game.renderer.lowRes?.y || 240))); }
  get margin() { return Math.round(this.H * 0.035); }
  get ink0() { return mixHex(INK0, INK1, this.grit); }
  get red() { return mixHex(RED0, RED1, this.grit); }
  get paper() { return mixHex(PAPER0, PAPER1, this.grit); }

  begin() {
    if (Math.abs(this.targetScale() - this.scale) > 1e-3) this.resize();
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.globalAlpha = 1;
    this.rects.length = 0;
  }

  /** After all drawing: blend the drawn areas through the scene's Bayer dither + 15-bit quantise. */
  end() {
    const k = this.grit;
    if (k < 0.02 || !this.rects.length) return;
    const g = this.g, s = this.scale, cw = this.canvas.width, ch = this.canvas.height;
    for (const r of mergeRects(this.rects)) {
      const x0 = Math.max(0, Math.floor(r.x * s) - 2), y0 = Math.max(0, Math.floor(r.y * s) - 2);
      const x1 = Math.min(cw, Math.ceil((r.x + r.w) * s) + 2), y1 = Math.min(ch, Math.ceil((r.y + r.h) * s) + 2);
      if (x1 <= x0 || y1 <= y0) continue;
      const img = g.getImageData(x0, y0, x1 - x0, y1 - y0);
      const d = img.data, w = x1 - x0;
      for (let i = 0, n = d.length; i < n; i += 4) {
        const a = d[i + 3];
        if (!a) continue;
        const p = i >> 2, px = (x0 + (p % w)) & 3, py = (y0 + ((p / w) | 0)) & 3;
        const b = (BAYER[py * 4 + px] - 0.5) * 8.2; // ±half a 5-bit step, in 0..255 units
        for (let c = 0; c < 3; c++) {
          const v = d[i + c];
          const q = Math.round(Math.min(255, Math.max(0, v + b)) / 8.226) * 8.226;
          d[i + c] = v + (q - v) * k;
        }
        d[i + 3] = a + ((a > 110 ? 255 : 0) - a) * k; // crunchy, hard-edged alpha at high grit
      }
      g.putImageData(img, x0, y0);
    }
  }

  font(size, weight = 'bold') { return `${weight} ${size}px ${HAND_FONT}`; }

  /** Measure a paper tag: wraps text to maxW. Returns { lines, w, h, size, lineH, pad }. */
  measure(text, { size = 1, maxW = this.W * 0.34 } = {}) {
    const s = this.px * size;
    const lineH = Math.round(s * 1.35);
    const padX = Math.round(s * 0.65), padY = Math.round(s * 0.5);
    const lines = Array.isArray(text) ? text.flatMap((t) => wrapText(this.g, t, maxW - padX * 2, this.font(s)))
      : wrapText(this.g, text, maxW - padX * 2, this.font(s));
    this.g.font = this.font(s);
    const tw = Math.max(...lines.map((l) => this.g.measureText(l).width), s) + s * 0.15 * this.grit;
    const pp = this.pp;
    const w = Math.ceil((tw + padX * 2) / pp) * pp;
    const h = Math.ceil((padY * 2 + s * 1.05 + (lines.length - 1) * lineH) / pp) * pp;
    return { lines, w, h, size: s, lineH, padX, padY };
  }

  /**
   * Draw an opaque paper tag. (x, y) is the anchor point in CSS px; anchor [ax, ay] is where on the
   * tag that point sits (0,0 = top-left, 0.5,1 = bottom-centre). Returns { x, y, w, h }.
   */
  tag(text, x, y, { anchor = [0, 0], opacity = 1, color, ink, m = null, seed, ...mopts } = {}) {
    m ??= this.measure(text, mopts);
    const left = Math.round(x - anchor[0] * m.w), top = Math.round(y - anchor[1] * m.h);
    const g = this.g;
    g.globalAlpha = opacity;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.scrap(m.w, m.h, color ?? this.paper, seed ?? hash(m.lines.join('|'))), left, top, m.w, m.h);
    this.ink(m.lines, left + m.padX, top + m.padY + m.size * 0.95, m.size, m.lineH, seed ?? hash(m.lines[0] ?? ''), ink);
    g.globalAlpha = 1;
    const r = { x: left, y: top, w: m.w, h: m.h };
    this.rects.push(r);
    return r;
  }

  /** Low-res paper scrap image (cached), upscaled with nearest filtering at draw time. */
  scrap(w, h, color, seed) {
    const pp = this.pp, k10 = Math.round(this.grit * 10);
    const key = `${w}x${h}|${pp}|${color}|${seed % 7}|${k10}`;
    let c = this.scraps.get(key);
    if (!c) {
      const cw = Math.max(4, Math.round(w / pp)), ch = Math.max(4, Math.round(h / pp));
      let g;
      [c, g] = makeCanvas(cw, ch);
      paperScrap(g, cw, ch, seed % 7 + 1, { color, edge: Math.round(lerp(0.6, 2.6, k10 / 10)), noise: lerp(0.03, 0.22, k10 / 10) });
      this.scraps.set(key, c);
      if (this.scraps.size > 48) this.scraps.delete(this.scraps.keys().next().value);
    }
    return c;
  }

  /**
   * Handwriting. Glyphs are always drawn whole. Grit adds per-glyph offset/rotation (≤ ~1.5 CSS
   * px), a soft ink bleed and warmer ink. Seeded, so nothing shimmers between frames.
   */
  ink(lines, x, baseline, size, lineH, seed = 1, color, g = this.g) {
    const k = this.grit;
    const r = new Rng(seed);
    color ??= this.ink0;
    g.font = this.font(size);
    g.textBaseline = 'alphabetic';
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = k * 1.4 * this.scale;           // device px (shadows ignore the transform)
    const jit = (1.5 * k) / this.unit;              // in drawing units
    const space = g.measureText(' ').width;
    lines.forEach((line, i) => {
      let cx = x;
      const y = baseline + i * lineH;
      for (const word of line.split(' ')) {
        const wy = y + ((r.next() - 0.5) * 1.2) / this.unit;
        if (jit < 0.05 / this.unit) {
          g.fillText(word, cx, wy);
          cx += g.measureText(word).width + space;
          continue;
        }
        for (const ch of word) {
          g.save();
          g.translate(cx + (r.next() - 0.5) * jit, wy + (r.next() - 0.5) * jit * 1.2);
          g.rotate((r.next() - 0.5) * 0.09 * k);
          g.fillText(ch, 0, 0);
          g.restore();
          cx += g.measureText(ch).width;
        }
        cx += space;
      }
    });
    g.shadowBlur = 0;
  }

  /**
   * Draw into a page-space rectangle (pw × ph units) mapped onto three projected corners
   * (top-left, top-right, bottom-left in CSS px). fn(g) draws in page units.
   */
  page(tl, tr, bl, pw, ph, alpha, fn) {
    const g = this.g, d = this.scale;
    g.save();
    g.setTransform(d * (tr.x - tl.x) / pw, d * (tr.y - tl.y) / pw, d * (bl.x - tl.x) / ph, d * (bl.y - tl.y) / ph, d * tl.x, d * tl.y);
    g.globalAlpha = alpha;
    this.unit = Math.hypot(tr.x - tl.x, tr.y - tl.y) / pw;
    fn(g);
    this.unit = 1;
    g.restore();
    const br = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
    const xs = [tl.x, tr.x, bl.x, br.x], ys = [tl.y, tr.y, bl.y, br.y];
    const x = Math.min(...xs), y = Math.min(...ys);
    this.rects.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  }
}

/** Merge overlapping rects so no pixel gets dithered twice. */
function mergeRects(rects) {
  const out = rects.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        out.splice(j, 1);
        j = i;
      }
    }
  }
  return out;
}
