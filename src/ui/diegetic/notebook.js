// The notebook (held up in both hands) and the "inspect" sheet (a found paper held close).
// Page 1 is the auto-map; following pages are collected notes, paginated. The page *texture* holds
// only paper, rules and the pencil map (it goes through the PS1 pass with the hands); the writing
// is drawn crisp on the full-res text layer, mapped onto the page's projected corners.
import * as THREE from 'three';
const _c = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
import { makeVMMaterial, canvasTexture } from '../../viewmodel/vmMaterial.js';
import { box, smooth } from '../../viewmodel/viewModel.js';
import { makeCanvas, wrapText, HAND_FONT } from './text.js';
import { hash, Rng } from '../../core/rng.js';

const PW = 160, PH = 216;          // page texture size
// page units (= texture px). Line height 1.4, ~28 characters per line max.
const TEXT = { size: 9.5, lineH: 13.3, x: 17, top: 28, width: PW - 30 };
const LINES_PER_PAGE = Math.floor((PH - TEXT.top - 20) / TEXT.lineH);
const FONT = (s) => `bold ${s}px ${HAND_FONT}`;

function paperBase(g, seed, { margin = true } = {}) {
  const r = new Rng(seed);
  g.fillStyle = '#d9d1b8'; g.fillRect(0, 0, PW, PH);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
    g.fillRect(r.int(0, PW - 1), r.int(0, PH - 1), 1, 1);
  }
  g.fillStyle = 'rgba(90,110,160,0.28)';
  for (let y = TEXT.top + TEXT.size + 2.5; y < PH - 12; y += TEXT.lineH) g.fillRect(4, Math.round(y), PW - 8, 1);
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
    const page = this.pageMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.188, 0.258), this.pageMat);
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
    const p = this.sheetMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.258), this.sheetMat);
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
    const lines = wrapText(this.g, text ?? '', TEXT.width, FONT(TEXT.size));
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
    if (p.kind === 'map') this.game.diegetic?.map?.draw(g, PW, PH, this.game.player, { top: 26, bottom: PH - 16 });
    this.tex.needsUpdate = true;
    this.drawnPage = i;
  }

  /** Hold a found paper up close (readable display "inspect"). */
  inspect({ title, text }) {
    const g = this.ig;
    paperBase(g, hash('inspect', title, text), { margin: false });
    const lines = wrapText(g, text ?? '', TEXT.width + 6, FONT(TEXT.size)).slice(0, LINES_PER_PAGE);
    this.iTex.needsUpdate = true;
    this.inspecting = { title, text, lines, at: this.game.time, pos: this.game.player.pos.clone() };
  }

  /** Crisp writing on the full-res text layer (call from renderDiegetic, after the render). */
  drawText(layer, camera, wBook, wSheet) {
    if (wBook > 0.6 && this.group.visible) {
      const p = this.pages[this.page];
      const k = this.flipDir ? (this.flipT < 0.5 ? this.flipT * 2 : (1 - this.flipT) * 2) : 0;
      const alpha = Math.min(1, (wBook - 0.6) / 0.35) * Math.max(0, 1 - k * 3);
      if (alpha > 0.01 && p) {
        const [tl, tr, bl] = corners(this.pageMesh, 0.094, 0.129, camera, layer.W, layer.H);
        layer.page(tl, tr, bl, PW, PH, alpha, (g) => writePage(layer, g, {
          title: p.kind === 'map' ? 'where I have been' : (p.cont ? '(cont.) ' : '') + p.title,
          red: p.kind !== 'map',
          lines: p.lines, label: `${this.page + 1}/${this.pages.length}`, seed: hash(p.id ?? 'map', this.page),
        }));
      }
    }
    if (wSheet > 0.6 && this.inspecting && this.sheet.visible) {
      const [tl, tr, bl] = corners(this.sheetMesh, 0.095, 0.129, camera, layer.W, layer.H);
      const s = this.inspecting;
      layer.page(tl, tr, bl, PW, PH, Math.min(1, (wSheet - 0.6) / 0.35), (g) => writePage(layer, g, {
        title: s.title, lines: s.lines, seed: hash(s.text),
      }));
    }
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

/** Project a page plane's top-left / top-right / bottom-left corners to CSS px. */
function corners(mesh, hw, hh, camera, W, H) {
  mesh.updateWorldMatrix(true, false);
  _c[0].set(-hw, hh, 0); _c[1].set(hw, hh, 0); _c[2].set(-hw, -hh, 0);
  return _c.map((v) => {
    mesh.localToWorld(v).project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
  });
}

// Writing goes through layer.ink so the textGrit dial (jitter, bleed, ink colour) applies here too.
function writePage(layer, g, { title, lines, label, seed, red = true }) {
  if (title) layer.ink([title], TEXT.x, 20, 11, 13, hash(seed, 't'), red ? layer.red : undefined, g);
  if (lines?.length) layer.ink(lines, TEXT.x, TEXT.top + TEXT.size, TEXT.size, TEXT.lineH, seed, undefined, g);
  if (label) layer.ink([label], PW - 34, PH - 8, 8, 10, hash(seed, 'n'), '#4a4438', g);
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
