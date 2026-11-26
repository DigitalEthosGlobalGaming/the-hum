// Full-resolution text layer: a 2D canvas over the game canvas, drawn in renderDiegetic() — after
// the PS1 post pass — so glyphs never go through the low-res target, the dither or the 15-bit
// quantise. The paper scraps behind the text are still drawn chunky (one paper "pixel" = one
// low-res scene pixel) so they sit in the PS1 look, but the ink is crisp vector text.
//
// Sizes are in CSS px and scale with the viewport: base ≈ 22 px at 1080p × cfg.ui.textScale.
import { Rng, hash } from '../../core/rng.js';
import { makeCanvas, paperScrap, wrapText, HAND_FONT } from './text.js';

export const INK = '#1b1812';
export const PAPER = '#e9e0c9';
export const RED_INK = '#6e1c18';

export class TextLayer {
  constructor(game) {
    this.game = game;
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3,
    });
    document.body.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.scraps = new Map();
    this.dirty = true;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.dirty = true;
  }

  /** Base text size in CSS px: ~22 px at 1080p, scaled by the viewport and ui.textScale. */
  get px() { return Math.max(15, (22 * this.H) / 1080) * (this.game.cfg.ui?.textScale ?? 1); }
  /** CSS px per low-res scene pixel (paper edges are drawn at this grain). */
  get pp() { return Math.max(1, Math.round(this.H / (this.game.renderer.lowRes?.y || 240))); }
  get margin() { return Math.round(this.H * 0.035); }

  begin() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
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
    const tw = Math.max(...lines.map((l) => this.g.measureText(l).width), s);
    const pp = this.pp;
    const w = Math.ceil((tw + padX * 2) / pp) * pp;
    const h = Math.ceil((padY * 2 + s * 1.05 + (lines.length - 1) * lineH) / pp) * pp;
    return { lines, w, h, size: s, lineH, padX, padY };
  }

  /**
   * Draw an opaque paper tag. (x, y) is the anchor point in CSS px; anchor [ax, ay] is where on the
   * tag that point sits (0,0 = top-left, 0.5,1 = bottom-centre). Returns { x, y, w, h }.
   */
  tag(text, x, y, { anchor = [0, 0], opacity = 1, color = PAPER, ink = INK, m = null, seed, ...mopts } = {}) {
    m ??= this.measure(text, mopts);
    const left = Math.round(x - anchor[0] * m.w), top = Math.round(y - anchor[1] * m.h);
    const g = this.g;
    g.globalAlpha = opacity;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.scrap(m.w, m.h, color, seed ?? hash(m.lines.join('|'))), left, top, m.w, m.h);
    this.ink(m.lines, left + m.padX, top + m.padY + m.size * 0.95, m.size, m.lineH, seed ?? hash(m.lines[0] ?? ''), ink);
    g.globalAlpha = 1;
    return { x: left, y: top, w: m.w, h: m.h };
  }

  /** Low-res paper scrap image (cached), upscaled with nearest filtering at draw time. */
  scrap(w, h, color, seed) {
    const pp = this.pp;
    const k = `${w}x${h}|${pp}|${color}|${seed % 7}`;
    let c = this.scraps.get(k);
    if (!c) {
      const cw = Math.max(4, Math.round(w / pp)), ch = Math.max(4, Math.round(h / pp));
      let g;
      [c, g] = makeCanvas(cw, ch);
      paperScrap(g, cw, ch, seed % 7 + 1, { color, edge: 1 });
      this.scraps.set(k, c);
      if (this.scraps.size > 40) this.scraps.delete(this.scraps.keys().next().value);
    }
    return c;
  }

  /**
   * Solid ink handwriting. Each word gets a tiny seeded baseline offset (≤ 0.6 px) and nothing
   * else: letters are drawn whole, never eroded, and don't shimmer between frames.
   */
  ink(lines, x, baseline, size, lineH, seed = 1, color = INK, g = this.g) {
    const r = new Rng(seed);
    g.font = this.font(size);
    g.textBaseline = 'alphabetic';
    g.fillStyle = color;
    const space = g.measureText(' ').width;
    lines.forEach((line, i) => {
      let cx = x;
      const y = baseline + i * lineH;
      for (const word of line.split(' ')) {
        g.fillText(word, cx, y + (r.next() - 0.5) * 1.2);
        cx += g.measureText(word).width + space;
      }
    });
  }

  /**
   * Draw into a page-space rectangle (pw × ph units) mapped onto three projected corners
   * (top-left, top-right, bottom-left in CSS px). fn(g) draws in page units.
   */
  page(tl, tr, bl, pw, ph, alpha, fn) {
    const g = this.g, d = this.dpr;
    g.save();
    g.setTransform(d * (tr.x - tl.x) / pw, d * (tr.y - tl.y) / pw, d * (bl.x - tl.x) / ph, d * (bl.y - tl.y) / ph, d * tl.x, d * tl.y);
    g.globalAlpha = alpha;
    fn(g);
    g.restore();
  }
}
