// The notebook (held up in both hands) and the "inspect" sheet (a found paper held close).
// Page 1 is the auto-map; following pages are collected notes, paginated. Pages are canvas
// textures in jittered, thresholded handwriting.
import * as THREE from 'three';
import { makeVMMaterial, canvasTexture } from '../../viewmodel/vmMaterial.js';
import { box, smooth } from '../../viewmodel/viewModel.js';
import { makeCanvas, inkLines, wrapText, HAND_FONT } from './text.js';
import { hash, Rng } from '../../core/rng.js';

const PW = 160, PH = 216;          // page texture size
const TEXT = { size: 11, lineH: 13, x: 16, top: 30, width: PW - 26 };
const LINES_PER_PAGE = Math.floor((PH - TEXT.top - 18) / TEXT.lineH);

function paperBase(g, seed, { margin = true } = {}) {
  const r = new Rng(seed);
  g.fillStyle = '#d9d1b8'; g.fillRect(0, 0, PW, PH);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
    g.fillRect(r.int(0, PW - 1), r.int(0, PH - 1), 1, 1);
  }
  g.fillStyle = 'rgba(90,110,160,0.28)';
  for (let y = TEXT.top + TEXT.lineH - 2; y < PH - 10; y += TEXT.lineH) g.fillRect(4, y, PW - 8, 1);
  if (margin) { g.fillStyle = 'rgba(170,60,60,0.3)'; g.fillRect(12, 0, 1, PH); }
  // grubby thumb smudge + corner wear
  g.fillStyle = 'rgba(60,45,30,0.06)';
  g.beginPath(); g.arc(r.int(20, PW - 20), PH - r.int(12, 30), r.int(8, 14), 0, Math.PI * 2); g.fill();
}

export class Notebook {
  constructor(game) {
    this.game = game;
    this.pages = [{ kind: 'map' }];
    this.page = 0;
    this.flipT = 0; this.flipDir = 0; this._swapped = false;
    this.mapTimer = 0;
    this.drawnPage = -1;
    [this.canvas, this.g] = makeCanvas(PW, PH);
    this.tex = canvasTexture(this.canvas, true);
    this.group = this.buildBook(game.textures);
    // inspect sheet
    [this.iCanvas, this.ig] = makeCanvas(PW, PH);
    this.iTex = canvasTexture(this.iCanvas, true);
    this.sheet = this.buildSheet(game.textures);
    this.inspecting = null;
  }

  buildBook(textures) {
    const g = new THREE.Group();
    const cover = box(0.205, 0.275, 0.01, textures.get('proc:cover'));
    cover.position.z = -0.006;
    g.add(cover);
    // page stack edge
    const stack = box(0.19, 0.262, 0.006, null, { tint: 0xc9c0a5 });
    stack.position.set(0.004, 0, 0.0);
    g.add(stack);
    this.pivot = new THREE.Group();
    this.pivot.position.set(-0.093, 0, 0.0035);
    g.add(this.pivot);
    this.pageMat = makeVMMaterial(this.tex, { emissive: 0.18, affine: 0, side: THREE.DoubleSide });
    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.188, 0.258), this.pageMat);
    page.position.x = 0.094;
    page.frustumCulled = false;
    this.pivot.add(page);
    addHands(g, textures, 0.105, 0.12);
    g.visible = false;
    return g;
  }

  buildSheet(textures) {
    const g = new THREE.Group();
    this.sheetMat = makeVMMaterial(this.iTex, { emissive: 0.18, affine: 0, side: THREE.DoubleSide });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.258), this.sheetMat);
    p.frustumCulled = false;
    g.add(p);
    addHands(g, textures, 0.093, 0.118);
    g.visible = false;
    return g;
  }

  /** Add a note's pages (deduped). Returns the index of its first page. */
  addNote({ noteId, title, text }) {
    const id = noteId ?? `${title}|${text}`;
    const found = this.pages.findIndex((p) => p.id === id);
    if (found >= 0) return found;
    const lines = wrapText(this.g, text ?? '', TEXT.width, `bold ${TEXT.size}px ${HAND_FONT}`);
    const first = this.pages.length;
    const per = LINES_PER_PAGE - 1; // first line of each page is the title
    for (let i = 0; i < Math.max(1, lines.length); i += per) {
      this.pages.push({ kind: 'note', id, title: title ?? '', lines: lines.slice(i, i + per), cont: i > 0 });
    }
    this.drawnPage = -1;
    return first;
  }

  open(page = this.page) { this.page = Math.max(0, Math.min(this.pages.length - 1, page)); this.drawnPage = -1; }

  flip(dir) {
    const next = this.page + dir;
    if (next < 0 || next >= this.pages.length || this.flipDir) return false;
    this.flipDir = dir; this.flipT = 0; this._swapped = false;
    this.game.synth?.play?.('paper_rustle', { volume: 0.6 });
    return true;
  }

  drawPage(i) {
    const g = this.g;
    const p = this.pages[i];
    paperBase(g, hash('page', i, p.id ?? 'map'), { margin: p.kind !== 'map' });
    if (p.kind === 'map') {
      inkLines(g, ['where I have been'], 16, 6, { size: 11, seed: 7, color: [40, 38, 60] });
      this.game.diegetic?.map?.draw(g, PW, PH, this.game.player, { top: 26, bottom: PH - 16 });
    } else {
      const title = (p.cont ? '(cont.) ' : '') + p.title;
      inkLines(g, [title], TEXT.x, 8, { size: 12, seed: hash(p.id, 't'), color: [110, 30, 28] });
      inkLines(g, p.lines, TEXT.x, TEXT.top + 1, { size: TEXT.size, lineH: TEXT.lineH, seed: hash(p.id, i) });
    }
    // page number, bottom corner
    inkLines(g, [`${i + 1}/${this.pages.length}`], PW - 30, PH - 15, { size: 9, seed: i, color: [80, 76, 90] });
    this.tex.needsUpdate = true;
    this.drawnPage = i;
  }

  /** Hold a found paper up close (readable display "inspect"). */
  inspect({ title, text }) {
    const g = this.ig;
    paperBase(g, hash('inspect', title, text), { margin: false });
    inkLines(g, [title ?? ''], 10, 8, { size: 12, seed: hash(title), color: [110, 30, 28] });
    const lines = wrapText(g, text ?? '', PW - 20, `bold 11px ${HAND_FONT}`).slice(0, LINES_PER_PAGE);
    inkLines(g, lines, 10, TEXT.top + 1, { size: 11, lineH: TEXT.lineH, seed: hash(text) });
    this.iTex.needsUpdate = true;
    this.inspecting = { title, text, at: this.game.time, pos: this.game.player.pos.clone() };
  }

  /** wBook / wSheet: eased visibility 0..1. */
  update(dt, vm, wBook, wSheet, mapVersionChanged) {
    // flip animation: page swings around the spine, swaps texture at the halfway point
    if (this.flipDir) {
      this.flipT = Math.min(1, this.flipT + dt / 0.32);
      if (this.flipT >= 0.5 && !this._swapped) { this.page += this.flipDir; this._swapped = true; this.drawnPage = -1; }
      const k = this.flipT < 0.5 ? this.flipT * 2 : (1 - this.flipT) * 2;
      this.pivot.rotation.y = -smooth(k) * 1.45 * (this.flipDir > 0 ? 1 : -1) * 0.9;
      if (this.flipT >= 1) { this.flipDir = 0; this.pivot.rotation.y = 0; }
    }
    if (wBook > 0.01) {
      this.mapTimer -= dt;
      const isMap = this.pages[this.page]?.kind === 'map';
      if (this.drawnPage !== this.page || (isMap && this.mapTimer <= 0 && mapVersionChanged())) {
        this.drawPage(this.page);
        this.mapTimer = 0.25;
      }
    }
    pose(this.group, vm, wBook, -0.33);
    pose(this.sheet, vm, wSheet, -0.29);
  }
}

function pose(g, vm, w, z) {
  g.visible = w > 0.01;
  if (!g.visible) return;
  const e = smooth(w);
  g.position.set(0, -0.012 - (1 - e) * 0.42, z);
  g.rotation.set(-0.1 - (1 - e) * 0.9, 0, (1 - e) * 0.2);
  vm.applyRig(g, 0.35, 1);
}

function addHands(g, textures, hx, hy) {
  const skin = textures.get('proc:skin');
  const sleeveTex = textures.get('proc:sleeve');
  for (const s of [-1, 1]) {
    const thumb = box(0.018, 0.045, 0.014, skin);
    thumb.position.set(s * (hx - 0.012), -hy + 0.035, 0.009);
    thumb.rotation.z = s * 0.35;
    g.add(thumb);
    const hand = box(0.055, 0.05, 0.03, skin);
    hand.position.set(s * (hx + 0.006), -hy + 0.01, -0.006);
    hand.rotation.z = s * 0.3;
    g.add(hand);
    const sleeve = box(0.075, 0.2, 0.07, sleeveTex);
    sleeve.position.set(s * (hx + 0.045), -hy - 0.1, 0.0);
    sleeve.rotation.z = s * 0.5;
    g.add(sleeve);
  }
}
