// Typewriter runtime: a per-instance paper texture, and the letter-by-letter typing animation
// (key clack per letter, a surface strip that grows as it types, a bell at the end).
// The script (src/scripts/items/typewriter_type.js) decides WHAT to type; this shows it.
import { story, stateOf, onInstance, onUpdate, canvasTex, makeCanvas, sound } from './runtime.js';
import { makePS1Material } from '../render/ps1.js';
import { pixelText } from '../ui/diegetic/text.js';
import { wrapMono } from './typewriterText.js';

export const PAPER_PART = 4;         // index of the paper box in the typewriter prefab
const PW = 64, PH = 64, COLS = 15, ROWS = 9;
const jobs = new Map();              // state object → { inst, text, i, t }

/** Is this typewriter (by its state) mid-line? */
export const isTyping = (st) => jobs.has(st);

/** Start typing `text` onto the typewriter's paper. state.paper keeps the finished lines. */
export function startTyping(inst, st, text) {
  st.paper ??= [];
  if (!story.game) { st.paper.push(text); return; } // headless: just record it
  jobs.set(st, { inst, st, text, i: 0, t: 0.25 });
}

onInstance('typewriter', (inst) => {
  const paper = inst.root.children[PAPER_PART];
  if (!paper) return;
  const [c, g] = makeCanvas(PW, PH);
  const tex = canvasTex(c);
  paper.material = makePS1Material(tex, { emissive: 0.08 });
  inst.paper = { c, g, tex };
  const st = stateOf(inst);
  const job = jobs.get(st);
  if (job) job.inst = inst; // its room streamed back in mid-line
  drawPaper(inst, st, job ? job.text.slice(0, job.i) : '');
});

function drawPaper(inst, st, partial) {
  const p = inst.paper;
  if (!p) return;
  const { g } = p;
  g.fillStyle = '#d8d2bf'; g.fillRect(0, 0, PW, PH);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 60; i++) g.fillRect((i * 37) % PW, (i * 53) % PH, 1, 1);
  const lines = [];
  for (const t of st?.paper ?? []) lines.push(...wrapMono(clean(t), COLS), '');
  if (partial) lines.push(...wrapMono(clean(partial), COLS));
  const shown = lines.slice(-ROWS);
  shown.forEach((l, i) => pixelText(g, l, 2, 3 + i * 7, { color: i === shown.length - 1 && partial ? '#151515' : '#3a3833' }));
  p.tex.needsUpdate = true;
}

// the pixel font has A-Z 0-9 and a little punctuation
const clean = (s) => String(s).toUpperCase().replace(/[,;]/g, '.').replace(/[’'"]/g, '').replace(/[^A-Z0-9:.\-/?!% ]/g, ' ');

onUpdate((dt, game) => {
  if (!jobs.size || !game.playing || game.paused) return;
  for (const [st, j] of jobs) {
    j.t -= dt;
    if (j.t > 0) continue;
    const ch = j.text[j.i] ?? '';
    j.i++;
    j.t = ch === ' ' ? 0.05 : ch === '.' ? 0.28 : 0.06 + ((j.i * 7919) % 5) * 0.012;
    const near = j.inst.root.parent && game.player.pos.distanceTo(j.inst.root.position) < 4.5;
    if (ch && ch !== ' ') sound('typewriter_clack', { at: j.inst, volume: 0.8 });
    if (j.i % 12 === 0) game.world.noise(j.inst.root.position, 6, 'typewriter');
    const partial = j.text.slice(0, j.i);
    drawPaper(j.inst, st, partial);
    if (near) game.events.emit('readable:open', { inst: j.inst, title: j.inst.name, text: partial, display: 'surface' });
    if (j.i >= j.text.length) {
      st.paper.push(j.text);
      if (st.paper.length > 8) st.paper.shift();
      jobs.delete(st);
      drawPaper(j.inst, st, '');
      game.gameplay.after(0.25, () => sound('typewriter_bell', { at: j.inst, volume: 0.7 }));
    }
  }
});
