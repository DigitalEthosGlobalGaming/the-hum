// The notebook (held open in both hands, a two-page spread) and the "inspect" sheet (a found paper
// held close). The notebook is also the hub menu: its sections (settings, controls, map, notes,
// photos, wanderers, secrets) are reached with paper index tabs along the top edge; the menu logic
// and the ink live in menu.js. Page *textures* hold only paper, rules and pictures (the pencil map,
// taped photos, badges); they go through the PS1 pass with the hands. All writing is drawn crisp on
// the full-res text layer, mapped onto each page's projected corners.
//
// Entries (this.pages, kept for compatibility: story/pages.js checks `pages.some(p => p.id === id)`):
//   'map'       the auto-map (always entry 0)
//   'note'      addNote({ noteId, title, text })
//   through addPage({ kind, id, title, caption, ... }):
//   'photo'     { image: canvas, caption }        a flash-camera photo taped in, handwritten caption
//   'wanderer'  { face, name, role, text }        an ID badge copied in (face drawn by story/wanderers)
//   'mapReveal' { revealId, caption }             an evacuation map sketched from the wall
//   'learned'   { text }                          a short line the player has worked out (Notes, top)
//   'secret'    { title, text }                   an oddity (Secrets section)
//   anything else goes to Notes.
import * as THREE from 'three';
import { makeVMMaterial, canvasTexture } from '../../viewmodel/vmMaterial.js';
import { box, smooth } from '../../viewmodel/viewModel.js';
import { makeCanvas, wrapText, HAND_FONT } from './text.js';
import { hash, Rng } from '../../core/rng.js';
import { drawFace } from '../../story/wanderers.js';
import { SECTIONS } from './hub.js';
import { Menu } from './menu.js';

const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

export const PW = 160, PH = 216;          // page texture size = page units
// page units. Line height 1.4, ~28 characters per line max.
export const TEXT = { size: 9.5, lineH: 13.3, x: 17, top: 28, width: PW - 30, bottom: 178 };
export const FONT = (s) => `bold ${s}px ${HAND_FONT}`;
const LINES_PER_PAGE = Math.floor((PH - TEXT.top - 20) / TEXT.lineH);

const PAGE_W = 0.188, PAGE_H = 0.258;    // metres
const GUTTER = 0.004;                    // spine to page edge
const TAB_W = 0.054, TAB_STEP = 0.0575, TAB_H = 0.03;
const TAB_TINT = [0xbdb7a4, 0xcdbd8c, 0xa7bf9e, 0xd9cf9f, 0xc8a9a4, 0xa9b6cc, 0xb6a6c6];
const FLIP_TIME = 0.42;

export function paperBase(g, seed, { margin = true, ruled = true } = {}) {
  const r = new Rng(seed);
  g.fillStyle = '#d9d1b8'; g.fillRect(0, 0, PW, PH);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
    g.fillRect(r.int(0, PW - 1), r.int(0, PH - 1), 1, 1);
  }
  if (ruled) {
    g.fillStyle = 'rgba(90,110,160,0.28)';
    for (let y = TEXT.top + TEXT.size + 2.5; y < PH - 12; y += TEXT.lineH) g.fillRect(4, Math.round(y), PW - 8, 1);
  }
  if (margin) { g.fillStyle = 'rgba(170,60,60,0.3)'; g.fillRect(12, 0, 1, PH); }
  // grubby thumb smudge + corner wear
  g.fillStyle = 'rgba(60,45,30,0.06)';
  g.beginPath(); g.arc(r.int(20, PW - 20), PH - r.int(12, 30), r.int(8, 14), 0, Math.PI * 2); g.fill();
}

export class Notebook {
  constructor(game) {
    this.game = game;
    this.pages = [{ kind: 'map', id: 'map' }];
    this.version = 0;                     // bumps whenever an entry is added
    // four page canvases: the two open pages + both faces of the turning leaf
    this.slots = {};
    for (const k of ['L', 'R', 'F', 'B']) {
      const [canvas, g] = makeCanvas(PW, PH);
      this.slots[k] = { canvas, g, tex: canvasTexture(canvas, true), key: null };
    }
    this.g = this.slots.L.g;              // measuring context (wrapText)
    this.mapTimer = 0;
    this.flipping = null;                 // { dir, t, to: [L, R] }
    this.inkT = 1;                        // ink fades back in after a turn
    this.group = this.buildBook(game.textures);
    // inspect sheet
    [this.iCanvas, this.ig] = makeCanvas(PW, PH);
    this.iTex = canvasTexture(this.iCanvas, true);
    this.sheet = this.buildSheet(game.textures);
    this.inspecting = null;
    this.menu = new Menu(game, this);
  }

  buildBook(textures) {
    const g = new THREE.Group();
    const cover = box(PAGE_W * 2 + 0.03, PAGE_H + 0.018, 0.01, textures.get('proc:cover'));
    cover.position.z = -0.006;
    g.add(cover);
    for (const s of [-1, 1]) {           // page stacks
      const stack = box(PAGE_W + 0.002, PAGE_H + 0.004, 0.006, null, { tint: 0xc9c0a5 });
      stack.position.set(s * (GUTTER + PAGE_W / 2), 0, 0);
      g.add(stack);
    }
    const spine = box(0.006, PAGE_H, 0.004, null, { tint: 0x6f6650 });
    spine.position.z = 0.002;
    g.add(spine);
    const mat = (k, side = THREE.DoubleSide) => makeVMMaterial(this.slots[k].tex, { emissive: 0.18, affine: 0, side });
    const plane = () => new THREE.PlaneGeometry(PAGE_W, PAGE_H);
    this.pageL = new THREE.Mesh(plane(), mat('L'));
    this.pageR = new THREE.Mesh(plane(), mat('R'));
    this.pageL.position.set(-(GUTTER + PAGE_W / 2), 0, 0.0035);
    this.pageR.position.set(GUTTER + PAGE_W / 2, 0, 0.0035);
    // the leaf that turns: front = a right-hand page, back = the left-hand page behind it
    this.leaf = new THREE.Group();
    this.leaf.position.z = 0.0048;
    const front = new THREE.Mesh(plane(), mat('F', THREE.FrontSide));
    front.position.x = GUTTER + PAGE_W / 2;
    const back = new THREE.Mesh(plane(), mat('B', THREE.FrontSide));
    back.position.x = GUTTER + PAGE_W / 2;
    back.rotation.y = Math.PI;
    this.leaf.add(front, back);
    this.leaf.visible = false;
    for (const m of [this.pageL, this.pageR, front, back]) m.frustumCulled = false;
    g.add(this.pageL, this.pageR, this.leaf);
    // paper index tabs poking up from between the pages; the current one stands taller
    this.tabs = SECTIONS.map((s, i) => {
      const t = box(TAB_W, TAB_H, 0.002, null, { tint: TAB_TINT[i % TAB_TINT.length], emissive: 0.2 });
      t.position.set(-((SECTIONS.length - 1) * TAB_STEP) / 2 + i * TAB_STEP, PAGE_H / 2 + 0.004, 0.0005);
      g.add(t);
      return t;
    });
    addHands(g, textures, PAGE_W + GUTTER + 0.008, 0.12);
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

  /** Add a note (deduped by noteId). Returns its entry index. */
  addNote({ noteId, title, text }) {
    const id = noteId ?? `${title}|${text}`;
    const found = this.pages.findIndex((p) => p.id === id);
    if (found >= 0) return found;
    this.pages.push({ kind: 'note', id, title: title ?? '', text: text ?? '' });
    this.version++;
    return this.pages.length - 1;
  }

  /**
   * Add a page entry (see the header for kinds). Deduped by `page.id`. `page.caption` is wrapped
   * into handwritten lines under the picture. Returns the entry index.
   */
  addPage(page) {
    const id = page.id ?? `${page.kind}:${this.pages.length}`;
    const found = this.pages.findIndex((p) => p.id === id);
    if (found >= 0) return found;
    const top = PAGE_TOP[page.kind] ?? TEXT.top;
    const max = Math.max(1, Math.floor((TEXT.bottom - top - TEXT.size) / TEXT.lineH) + 1);
    const lines = wrapText(this.g, page.caption ?? '', TEXT.width, FONT(TEXT.size)).slice(0, max);
    this.pages.push({ ...page, id, title: page.title ?? '', lines, top });
    this.version++;
    return this.pages.length - 1;
  }

  /** Open the notebook at an entry (its section and page). */
  open(index) { this.menu.openEntry(index); }
  flip(dir) { return this.menu.flip(dir); }

  /** Paint a page description into a slot's texture (only when it changed). */
  paint(slot, desc, force = false) {
    const s = this.slots[slot];
    if (!force && s.key === desc.key) return;
    const g = s.g;
    const e = desc.entry;
    const kind = desc.kind;
    paperBase(g, hash('page', desc.key), { margin: !['map', 'photo', 'wanderer', 'reveal', 'blank'].includes(kind) });
    if (kind === 'map') this.game.diegetic?.map?.draw(g, PW, PH, this.game.player, { top: 26, bottom: TEXT.bottom });
    else if (kind === 'photo') drawPhoto(g, e, hash('photo', e.id));
    else if (kind === 'wanderer') drawBadge(g, e);
    else if (kind === 'reveal') this.game.diegetic?.map?.drawReveal?.(g, PW, PH, e.revealId, { top: 26, bottom: e.top - 6 });
    s.tex.needsUpdate = true;
    s.key = desc.key;
  }

  /** Turn the leaf: dir > 0 forward (right page over to the left). from/to: [descL, descR]. */
  startFlip(dir, from, to) {
    if (this.flipping) this.endFlip();
    if (dir > 0) {
      this.paint('F', from[1]); this.paint('B', to[0]);
      this.paint('L', from[0]); this.paint('R', to[1]);
    } else {
      this.paint('B', from[0]); this.paint('F', to[1]);
      this.paint('L', to[0]); this.paint('R', from[1]);
    }
    this.flipping = { dir, t: 0, to };
    this.leaf.visible = true;
    this.leaf.rotation.y = dir > 0 ? 0 : -Math.PI;
    this.inkT = 0;
    this.game.synth?.play?.('paper_rustle', { volume: 0.6 });
  }

  endFlip() {
    const f = this.flipping;
    this.flipping = null;
    this.leaf.visible = false;
    this.paint('L', f.to[0]); this.paint('R', f.to[1]);
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
      const alpha = Math.min(1, (wBook - 0.6) / 0.35);
      const [dL, dR] = this.menu.current();
      const geo = this.menu.geo;
      geo.L = projectRect(this.pageL, -PAGE_W / 2, PAGE_H / 2, PAGE_W / 2, -PAGE_H / 2, 0, camera, layer.W, layer.H);
      geo.R = projectRect(this.pageR, -PAGE_W / 2, PAGE_H / 2, PAGE_W / 2, -PAGE_H / 2, 0, camera, layer.W, layer.H);
      this.menu.regions.length = 0;
      const ink = alpha * smooth(Math.min(1, this.inkT));
      if (ink > 0.01) {
        layer.page(geo.L[0], geo.L[1], geo.L[2], PW, PH, ink, (g) => this.menu.ink(layer, g, dL, 'L'));
        layer.page(geo.R[0], geo.R[1], geo.R[2], PW, PH, ink, (g) => this.menu.ink(layer, g, dR, 'R'));
      }
      // tab labels: on the part of each tab that shows above the pages. The text layer is drawn
      // after the 3D render, so while a page turns the labels (and the current tab's underline)
      // are clipped out of the turning leaf's silhouette: the leaf passes in front of the tabs.
      const occluder = this.flipping ? this.leafOutline(camera, layer.W, layer.H) : null;
      const lg = layer.g;
      if (occluder) {
        lg.save();
        lg.beginPath();
        lg.rect(-1, -1, layer.W + 2, layer.H + 2);
        occluder.forEach((p, k) => (k ? lg.lineTo(p.x, p.y) : lg.moveTo(p.x, p.y)));
        lg.closePath();
        lg.clip('evenodd');
      }
      geo.tabs = this.tabs.map((t, i) => {
        const top = TAB_H / 2, bottom = PAGE_H / 2 - t.position.y + 0.001;
        const c = projectRect(t, -TAB_W / 2, top, TAB_W / 2, bottom, 0.0011, camera, layer.W, layer.H);
        const tw = 60, th = Math.max(8, (60 * (top - bottom)) / TAB_W);
        layer.page(c[0], c[1], c[2], tw, th, alpha, (g) => this.menu.inkTab(layer, g, i, tw, th));
        return c;
      });
      if (occluder) lg.restore();
    }
    if (wSheet > 0.6 && this.inspecting && this.sheet.visible) {
      const [tl, tr, bl] = projectRect(this.sheetMesh, -0.095, 0.129, 0.095, -0.129, 0, camera, layer.W, layer.H);
      const s = this.inspecting;
      layer.page(tl, tr, bl, PW, PH, Math.min(1, (wSheet - 0.6) / 0.35), (g) => writePage(layer, g, {
        title: s.title, lines: s.lines, seed: hash(s.text),
      }));
    }
  }

  /** The turning leaf's screen outline [tl, tr, br, bl] in CSS px (it is one quad, both faces). */
  leafOutline(camera, W, H) {
    const m = this.leaf.children[0];
    m.updateWorldMatrix(true, false);
    const hw = PAGE_W / 2, hh = PAGE_H / 2;
    return [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([x, y]) => {
      const v = _v[0].set(x, y, 0);
      m.localToWorld(v).project(camera);
      return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
    });
  }

  /** wBook / wSheet: eased visibility 0..1. */
  update(dt, vm, wBook, wSheet, mapVersionChanged) {
    const f = this.flipping;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLIP_TIME);
      const k = smooth(f.t);
      this.leaf.rotation.y = f.dir > 0 ? -Math.PI * k : -Math.PI * (1 - k);
      this.leaf.position.z = 0.0048 + Math.sin(Math.PI * k) * 0.012; // lifts off the stack mid-turn
      if (f.t >= 1) this.endFlip();
    } else {
      this.inkT = Math.min(1, this.inkT + dt / 0.18);
    }
    if (wBook > 0.01 && !this.flipping) {
      const [dL, dR] = this.menu.current();
      this.mapTimer -= dt;
      const mapShown = dL.kind === 'map' || dR.kind === 'map' || dL.kind === 'reveal' || dR.kind === 'reveal';
      const refresh = mapShown && this.mapTimer <= 0 && mapVersionChanged();
      if (refresh) this.mapTimer = 0.25;
      this.paint('L', dL, refresh && (dL.kind === 'map' || dL.kind === 'reveal'));
      this.paint('R', dR, refresh && (dR.kind === 'map' || dR.kind === 'reveal'));
    }
    // tabs: the current section's stands taller
    const cur = this.menu.section;
    this.tabs.forEach((t, i) => {
      const target = PAGE_H / 2 + (i === cur ? 0.012 : 0.004);
      t.position.y += (target - t.position.y) * Math.min(1, dt * 14);
    });
    // aspect fit: keep the whole spread (and the hands) on screen on narrow windows
    const cam = vm.camera;
    const halfW = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect;
    const z = Math.max(0.37, 0.25 / Math.max(0.1, halfW));
    pose(this.group, vm, wBook, -z, -0.022);
    pose(this.sheet, vm, wSheet, -0.29, 0);
  }
}

/** Project a local rect (x0,y0 top-left .. x1,y1 bottom-right, at z) → [tl, tr, bl] in CSS px. */
function projectRect(obj, x0, y0, x1, y1, z, camera, W, H) {
  obj.updateWorldMatrix(true, false);
  _v[0].set(x0, y0, z); _v[1].set(x1, y0, z); _v[2].set(x0, y1, z);
  return _v.map((v) => {
    obj.localToWorld(v).project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
  });
}

// Writing goes through layer.ink so the textGrit dial (jitter, bleed, ink colour) applies here too.
export function writePage(layer, g, { title, lines, label, seed, red = true, top = TEXT.top }) {
  if (title) layer.ink([title], TEXT.x, 20, 11, 13, hash(seed, 't'), red ? layer.red : undefined, g);
  if (lines?.length) layer.ink(lines, TEXT.x, top + TEXT.size, TEXT.size, TEXT.lineH, seed, undefined, g);
  if (label) layer.ink([label], PW / 2 - 8, PH - 12, 8, 10, hash(seed, 'n'), '#4a4438', g);
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

function pose(g, vm, w, z, y0) {
  g.visible = w > 0.01;
  if (!g.visible) return;
  const e = smooth(w);
  g.position.set(0, -0.012 + y0 - (1 - e) * 0.42, z);
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
