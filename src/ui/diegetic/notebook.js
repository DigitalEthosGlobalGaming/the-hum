// The notebook (held up in both hands) and the "inspect" sheet (a found paper held close).
// Page 1 is the auto-map; following pages are collected notes, paginated. The page *texture* holds
// only paper, rules and the pencil map (it goes through the PS1 pass with the hands); the writing
// is drawn crisp on the full-res text layer, mapped onto the page's projected corners.
//
// Page kinds: 'map' (page 1, the auto-map), 'note' (addNote), and through addPage():
//   'photo'     { image: canvas, caption }        a flash-camera photo taped in, handwritten caption
//   'wanderer'  { face, name, role, text }        an ID badge copied in (face drawn by story/wanderers)
//   'mapReveal' { revealId, caption }             an evacuation map sketched from the wall
// Images go into the page texture (so they get the PS1 treatment with the hands); captions are ink.
import * as THREE from 'three';
const _c = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
import { makeVMMaterial, canvasTexture } from '../../viewmodel/vmMaterial.js';
import { box, smooth } from '../../viewmodel/viewModel.js';
import { makeCanvas, wrapText, HAND_FONT } from './text.js';
import { hash, Rng } from '../../core/rng.js';
import { drawFace } from '../../story/wanderers.js';

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

  /**
   * Add a picture page (photo / wanderer / mapReveal; see the header). Deduped by `page.id`.
   * `page.caption` is wrapped into handwritten lines under the picture. Returns the page index.
   */
  addPage(page) {
    const id = page.id ?? `${page.kind}:${this.pages.length}`;
    const found = this.pages.findIndex((p) => p.id === id);
    if (found >= 0) return found;
    const top = PAGE_TOP[page.kind] ?? TEXT.top;
    const max = Math.max(1, Math.floor((PH - top - TEXT.size - 12) / TEXT.lineH) + 1);
    const lines = wrapText(this.g, page.caption ?? '', TEXT.width, FONT(TEXT.size)).slice(0, max);
    this.pages.push({ ...page, id, title: page.title ?? '', lines, top });
    this.drawnPage = -1;
    return this.pages.length - 1;
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
    else if (p.kind === 'photo') drawPhoto(g, p, hash('photo', p.id));
    else if (p.kind === 'wanderer') drawBadge(g, p);
    else if (p.kind === 'mapReveal') this.game.diegetic?.map?.drawReveal?.(g, PW, PH, p.revealId, { top: 26, bottom: p.top - 6 });
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
          lines: p.lines, label: `${this.page + 1}/${this.pages.length}`, seed: hash(p.id ?? 'map', this.page), top: p.top,
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
      const kind = this.pages[this.page]?.kind;
      const isMap = kind === 'map' || kind === 'mapReveal'; // reveal pages grow "?" as you learn more
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
function writePage(layer, g, { title, lines, label, seed, red = true, top = TEXT.top }) {
  if (title) layer.ink([title], TEXT.x, 20, 11, 13, hash(seed, 't'), red ? layer.red : undefined, g);
  if (lines?.length) layer.ink(lines, TEXT.x, top + TEXT.size, TEXT.size, TEXT.lineH, seed, undefined, g);
  if (label) layer.ink([label], PW - 34, PH - 8, 8, 10, hash(seed, 'n'), '#4a4438', g);
}

// Where the handwriting starts on picture pages (page units).
const PAGE_TOP = { photo: 140, wanderer: 128, mapReveal: 150 };

/** A photo taped in at a slight angle, white border, two strips of yellowed tape. */
function drawPhoto(g, p, seed) {
  const r = new Rng(seed);
  const img = p.image;
  const w = 124, h = img ? Math.round((124 * img.height) / img.width) : 93;
  g.save();
  g.translate(PW / 2, 30 + h / 2 + 4);
  g.rotate((r.next() - 0.5) * 0.08);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-w / 2 - 3, -h / 2 - 2, w + 8, h + 8);   // shadow
  g.fillStyle = '#ece8dc'; g.fillRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8);             // border
  if (img) { g.imageSmoothingEnabled = false; g.drawImage(img, -w / 2, -h / 2, w, h); }
  else { g.fillStyle = '#111'; g.fillRect(-w / 2, -h / 2, w, h); }
  g.fillStyle = 'rgba(214,200,140,0.6)';
  g.save(); g.translate(-w / 2 + 6, -h / 2 - 3); g.rotate(-0.5); g.fillRect(-10, -3, 22, 7); g.restore();
  g.save(); g.translate(w / 2 - 6, h / 2 + 3); g.rotate(-0.5); g.fillRect(-10, -3, 22, 7); g.restore();
  g.restore();
}

/** The badge card: photo, number strip, clip hole. Name and role are written as ink. */
function drawBadge(g, p) {
  const x = 44, y = 28, w = 72, h = 92;
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 3, y + 3, w, h);
  g.fillStyle = '#f1efe6'; g.fillRect(x, y, w, h);
  g.fillStyle = '#3d5a7a'; g.fillRect(x, y, w, 12);                       // header band
  g.fillStyle = '#e8e2c8'; g.fillRect(x + 4, y + 3, 26, 3); g.fillRect(x + 4, y + 7, 16, 2);
  g.fillStyle = '#d8d4c8'; g.fillRect(x + w / 2 - 7, y + 2, 14, 4);      // clip slot
  g.fillStyle = '#2a2a2a'; g.fillRect(x + w / 2 - 5, y + 3, 10, 2);
  if (p.face) drawFace(g, x + 14, y + 16, 44, 50, p.face);
  g.fillStyle = '#333'; g.fillRect(x + 8, y + 72, w - 16, 2); g.fillRect(x + 8, y + 77, w - 30, 2);
  g.fillStyle = '#b02a20'; g.fillRect(x + w - 18, y + 76, 10, 10);       // clearance square
  g.fillStyle = '#111';                                                   // barcode
  for (let i = 0; i < 22; i++) if ((p.number?.charCodeAt(i % 4) ?? 3) * (i + 3) % 3) g.fillRect(x + 8 + i * 2, y + 82, 1, 6);
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
