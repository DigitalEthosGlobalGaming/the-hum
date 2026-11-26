// Text for the diegetic kit, all drawn on canvases (no web fonts):
//  - a hand-made 3x5 pixel font + 7-segment digits for the watch LCD
//  - the handwriting font stack + word wrapping (drawn crisp by textLayer.js)
//  - paper scraps (torn edges, speckle) used by tags, captions and notebook pages
import { Rng } from '../../core/rng.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// ── 3x5 pixel font (rows top→bottom, 3 bits each) ──
const G = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  ':': '000010000010000', '-': '000000111000000', '.': '000000000000010', '/': '001001010100100',
  '*': '101111111010000', '?': '111001011000010', '!': '010010010000010', '%': '101001010100101',
  '#': '101111101111101', '+': '000010111010000', ' ': '000000000000000',
};

/** Draw 3x5 pixel text. scale = integer pixel size. Returns the end x. glitch(i) → char override. */
export function pixelText(g, text, x, y, { scale = 1, color = '#000', glitch = null } = {}) {
  g.fillStyle = color;
  let cx = x;
  const s = String(text).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const ch = glitch?.(i, s[i]) ?? s[i];
    const bits = G[ch] ?? G['?'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (bits[r * 3 + c] === '1') g.fillRect(cx + c * scale, y + r * scale, scale, scale);
    }
    cx += 4 * scale;
  }
  return cx;
}
export const pixelWidth = (text, scale = 1) => String(text).length * 4 * scale - scale;

// ── 7-segment digits (LCD clock) ──
//  segments: a top, b top-right, c bottom-right, d bottom, e bottom-left, f top-left, g middle
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
/** One digit, w×h box (h odd). segs may be passed directly for glitching. */
export function segDigit(g, d, x, y, w, h, color, segs = SEG[d] ?? '') {
  g.fillStyle = color;
  const m = (h - 1) / 2;
  for (const s of segs) {
    if (s === 'a') g.fillRect(x + 1, y, w - 2, 1);
    if (s === 'g') g.fillRect(x + 1, y + m, w - 2, 1);
    if (s === 'd') g.fillRect(x + 1, y + h - 1, w - 2, 1);
    if (s === 'f') g.fillRect(x, y + 1, 1, m - 1);
    if (s === 'b') g.fillRect(x + w - 1, y + 1, 1, m - 1);
    if (s === 'e') g.fillRect(x, y + m + 1, 1, m - 1);
    if (s === 'c') g.fillRect(x + w - 1, y + m + 1, 1, m - 1);
  }
}
export const SEGMENTS = 'abcdefg';

// ── handwriting ──
export const HAND_FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Patrick Hand", cursive';

/** Wrap text to lines that fit maxW at the given font. Honours explicit newlines. */
export function wrapText(g, text, maxW, font) {
  g.font = font;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const t = line ? line + ' ' + word : word;
      if (line && g.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

/** Paper scrap: torn ragged edges, speckle, faint ruled line. Leaves outside transparent. */
export function paperScrap(g, w, h, seed, { color = '#d8cfb4', ruled = false, edge = 2, noise = 0.08 } = {}) {
  const rng = new Rng(seed);
  g.clearRect(0, 0, w, h);
  g.fillStyle = color;
  // ragged rectangle: per-column / per-row bite depths
  for (let x = 0; x < w; x++) {
    const top = rng.int(0, edge), bot = rng.int(0, edge);
    g.fillRect(x, top, 1, h - top - bot);
  }
  for (let y = 0; y < h; y++) {
    const l = rng.int(0, edge), r = rng.int(0, edge);
    g.clearRect(0, y, l, 1); g.clearRect(w - r, y, r, 1);
  }
  for (let i = 0; i < w * h * noise; i++) {
    g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)';
    g.fillRect(rng.int(edge, w - edge - 1), rng.int(edge, h - edge - 1), 1, 1);
  }
  if (ruled) {
    g.fillStyle = 'rgba(90,110,150,0.25)';
    for (let y = 12; y < h - 4; y += 12) g.fillRect(edge + 1, y, w - edge * 2 - 2, 1);
  }
}
