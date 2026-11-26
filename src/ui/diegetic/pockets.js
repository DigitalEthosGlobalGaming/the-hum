// Pocket case (Q toggles; Esc closes): a small battered suitcase opens in front of you, latches
// flip, the lid swings back. The four pockets are compartments in the worn lining, each holding the
// item's real model under an elastic band; the torch is clipped sideways across the inside of the
// lid. A pointing hand follows a cursor (mouse) or steps between items (A/D, ←/→, wheel; wraps).
// E takes the pointed-at item in hand; click uses the item in hand with it
// (game.gameplay.combineSlots(a, b)). The name is written on a luggage tag hanging off the handle.
// Geometry: pocketCase.js.
import * as THREE from 'three';
import { damp, smooth } from '../../viewmodel/viewModel.js';
import { toViewModel } from '../../viewmodel/vmMaterial.js';
import { fitInto } from '../../viewmodel/arms.js';
import { buildCase, CASE, slotX, ITEM_Z, LID_OPEN } from './pocketCase.js';
import { keyLabel } from './keys.js';

// where the case sits in view space (the view-model camera looks down -Z)
const POSE = { y: -0.15, z: -0.56, tilt: 1.0, scale: 0.88 };
const HIDDEN = { y: -0.52, z: -0.42, tilt: 0.35 };
const OPEN_S = 0.6, CLOSE_S = 0.32;           // seconds for the open / close animation
const TORCH_ID = -1;                          // hover index of the torch
const LID_ZONE = -CASE.D / 2 + 0.004;         // cursor z beyond this (toward the hinge) = the torch
const CUR = { minX: -CASE.W / 2 + 0.03, maxX: CASE.W / 2 - 0.03, minZ: -CASE.D / 2 - 0.16, maxZ: CASE.D / 2 - 0.03 };
const MOUSE = 0.00042;                        // case metres per mouse count
const TORCH_CUR = { x: 0.07, z: -CASE.D / 2 - 0.09 };

const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ctr = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOutBack = (x) => { x = clamp(x, 0, 1); const c = 1.4; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };

export class Pockets {
  constructor(game) {
    this.game = game;
    this.c = buildCase(game.textures);
    this.group = this.c.root;
    this.group.visible = false;
    this.group.scale.setScalar(POSE.scale);
    this.slots = [];
    for (let i = 0; i < CASE.SLOTS; i++) {
      const holder = new THREE.Group();
      holder.position.set(slotX(i), CASE.FLOOR, ITEM_Z);
      this.c.base.add(holder);
      this.slots.push({ i, holder, key: undefined, lift: 0, wob: 0, span: 1 });
    }
    this.torchHolder = new THREE.Group();
    this.c.torchMount.add(this.torchHolder);
    this.torchLift = 0;
    this.t = 0;            // open animation 0 (shut, out of view) .. 1 (open)
    this.isOpen = false;
    this.hover = 0;
    this.cur = { x: slotX(0), z: ITEM_Z };
    this.tip = new THREE.Vector3(0.1, -0.3, -0.3);
    this.wrist = new THREE.Vector3(0.03, -0.035, 0.1); // wrist relative to the fingertip (arms.js 'point' pose)
    this.tipLift = 0.045; this.tipNear = 0.075; // fingertip: above the lining, at the item's near end
    this.torchSynced = false;
  }

  /** 0..1 how far the case is out and open (for fades). */
  get amount() { return this.t; }
  /** True once the lid is back and the cursor works. */
  get ready() { return this.isOpen && this.t > 0.85; }

  /** Copy the left-hand torch (LED state as of opening) into the lid clips, lying sideways. */
  syncTorch(torch) {
    const h = this.torchHolder;
    h.clear();
    if (!torch) return;
    const copy = torch.clone(true);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, Math.PI); // LED strip toward the viewer (the lid lining is behind it)
    copy.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
    const w = new THREE.Group();
    w.add(copy);
    fitInto(w, 0.1);
    const outer = new THREE.Group();
    outer.add(w);
    outer.rotation.y = Math.PI / 2;  // lens to the left, along the hinge
    h.add(outer);
  }

  /** Rebuild a compartment's model when its stack changes. Two-slot items span two compartments. */
  syncSlot(slot, stack) {
    const inv = this.game.inventory;
    const i = slot.i;
    const second = stack && i > 0 && inv.slots[i - 1] === stack;
    const span = stack && !second && inv.slots[i + 1] === stack ? 2 : 1;
    const key = second ? 'half' : stack ? `${stack.id}|${span}` : null;
    if (key === slot.key && stack === slot.stack) return;
    slot.key = key; slot.stack = stack; slot.span = span;
    slot.holder.clear();
    slot.holder.position.x = span === 2 ? (slotX(i) + slotX(i + 1)) / 2 : slotX(i);
    if (!stack || second) return;
    const def = stack.def ?? this.game.content.objects?.[stack.id];
    let mesh = null;
    try { mesh = def ? this.game.world?.objects?.buildMesh(def) : null; } catch (e) { /* fall through */ }
    if (!mesh) mesh = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04)));
    toViewModel(mesh);
    // laid flat in the lining: thinnest side down, long side along the compartment, a little askew
    const inner = new THREE.Group();
    inner.add(mesh);
    mesh.updateMatrixWorld(true);
    _box.setFromObject(mesh).getSize(_size);
    const thin = Math.min(_size.x, _size.y, _size.z);
    if (_size.z === thin) inner.rotation.x = -Math.PI / 2;     // on its back (front faces up)
    else if (_size.x === thin) inner.rotation.z = Math.PI / 2; // on its side
    inner.updateMatrixWorld(true);
    _box.setFromObject(inner).getSize(_size);
    const turn = new THREE.Group();
    turn.add(inner);
    if (span === 1 ? _size.x > _size.z * 1.15 : _size.z > _size.x * 1.15) turn.rotation.y = Math.PI / 2;
    const outer = new THREE.Group();
    outer.add(turn);
    outer.rotation.y = ((i * 37) % 7 - 3) * 0.05;
    outer.updateMatrixWorld(true);
    _box.setFromObject(outer);
    _box.getSize(_size); _box.getCenter(_ctr);
    const k = Math.min((CASE.CW * span - 0.022) / Math.max(_size.x, 1e-4), 0.13 / Math.max(_size.z, 1e-4), 0.06 / Math.max(_size.y, 1e-4));
    outer.scale.setScalar(k);
    outer.position.set(-_ctr.x * k, -_box.min.y * k + 0.001, -_ctr.z * k);
    slot.holder.add(outer);
  }

  /** First index of each item in the pockets, left to right (second halves skipped). */
  itemStarts() {
    const s = this.game.inventory?.slots ?? [];
    const out = [];
    for (let i = 0; i < CASE.SLOTS; i++) if (s[i] && s[i - 1] !== s[i]) out.push(i);
    return out;
  }

  /** Normalise a compartment index to the first index of the item in it. */
  startOf(i) {
    const s = this.game.inventory?.slots ?? [];
    return i > 0 && s[i] && s[i - 1] === s[i] ? i - 1 : i;
  }

  moveCursorTo(h) {
    if (h === TORCH_ID) { this.cur.x = TORCH_CUR.x; this.cur.z = TORCH_CUR.z; return; }
    const span = this.slots[h].span;
    this.cur.x = span === 2 ? (slotX(h) + slotX(h + 1)) / 2 : slotX(h);
    this.cur.z = ITEM_Z;
  }

  /** Step the pointer between items (torch first), wrapping. */
  step(dir) {
    const order = [TORCH_ID, ...this.itemStarts()];
    const n = order.length;
    const idx = order.indexOf(this.hover);
    if (idx >= 0) this.hover = order[(((idx + dir) % n) + n) % n];
    else { // on an empty compartment: the nearest item that way
      const ahead = order.filter((h) => (dir > 0 ? h > this.hover : h < this.hover));
      this.hover = ahead.length ? ahead[dir > 0 ? 0 : ahead.length - 1] : order[dir > 0 ? 0 : n - 1];
    }
    this.moveCursorTo(this.hover);
  }

  hoverFromCursor() {
    if (this.cur.z < LID_ZONE) return TORCH_ID;
    const i = clamp(Math.floor((this.cur.x + CASE.IW / 2) / CASE.CW), 0, CASE.SLOTS - 1);
    return this.startOf(i);
  }

  /**
   * Call every frame. open: whether the case should be out. raw: ungated input; look: mouse delta
   * (gate.look); torch: the left-hand torch model. Returns the view-space point the right hand's
   * wrist should go to.
   */
  update(dt, { open, raw, look, torch }) {
    const inv = this.game.inventory;
    const was = this.t;
    if (open && !this.isOpen) { // just opened: start at the item in hand
      this.hover = inv?.slots?.[inv.selected] ? this.startOf(inv.selected) : TORCH_ID;
      this.moveCursorTo(this.hover);
      this.game.synth?.play?.('paper_rustle', { volume: 0.25 });
    }
    this.isOpen = open;
    this.t = clamp(this.t + (open ? dt / OPEN_S : -dt / CLOSE_S), 0, 1);
    if (open && was < 0.3 && this.t >= 0.3) this.game.synth?.play?.('switch_click', { volume: 0.5 });
    this.group.visible = this.t > 0.001;
    if (!this.group.visible) { this.torchSynced = false; return _v.set(0.17, -0.6, -0.38); }
    if (!this.torchSynced) { this.syncTorch(torch); this.torchSynced = true; }

    // ── open / close animation: rise, latches flip, lid swings back ──
    const c = this.c;
    const rise = smooth(this.t / 0.4);
    const g = this.group;
    g.position.set(0, HIDDEN.y + (POSE.y - HIDDEN.y) * rise, HIDDEN.z + (POSE.z - HIDDEN.z) * rise);
    g.rotation.set(HIDDEN.tilt + (POSE.tilt - HIDDEN.tilt) * rise, 0, 0);
    const hasp = smooth((this.t - 0.28) / 0.14);
    for (const h of c.hasps) h.rotation.x = hasp * 2.7;
    c.lid.rotation.x = -LID_OPEN * (open ? easeOutBack((this.t - 0.4) / 0.6) : smooth((this.t - 0.4) / 0.6));

    if (!inv) return _v.set(0.17, -0.6, -0.38);
    for (const s of this.slots) this.syncSlot(s, inv.slots?.[s.i] ?? null);
    for (let i = 0; i < CASE.SLOTS - 1; i++) c.dividers[i].visible = this.slots[i].span !== 2;

    // ── cursor ──
    if (this.ready) {
      const before = this.hover;
      this.cur.x = clamp(this.cur.x + look.x * MOUSE, CUR.minX, CUR.maxX);
      this.cur.z = clamp(this.cur.z + look.y * MOUSE, CUR.minZ, CUR.maxZ);
      if (look.x || look.y) this.hover = this.hoverFromCursor();
      if (raw.wasPressed('left') || raw.wasPressed('slotPrev')) this.step(-1);
      if (raw.wasPressed('right') || raw.wasPressed('slotNext')) this.step(1);
      if (this.hover !== before) this.game.synth?.play?.('paper_rustle', { volume: 0.12 });
      if (raw.wasPressed('interact')) this.take();
      else if (raw.wasPressed('use')) this.click();
    }

    // ── items: hovered lifts and rocks, the one in hand sits on a worn patch ──
    const time = this.game.time ?? 0;
    const ready = this.ready;
    for (const s of this.slots) {
      const sel = this.startOf(inv.selected) === s.i && !!inv.slots?.[inv.selected];
      const hov = ready && s.i === this.hover;
      s.lift = damp(s.lift, hov ? 0.032 : sel ? 0.006 : 0, 14, dt);
      s.wob = Math.max(0, s.wob - dt);
      const h = s.holder;
      h.position.y = CASE.FLOOR + s.lift;
      h.rotation.set(-s.lift * 6, Math.sin(s.wob * 60) * 0.25 * (s.wob / 0.4), hov ? Math.sin(time * 2.3) * 0.06 : 0);
    }
    const selStart = inv.slots?.[inv.selected] ? this.startOf(inv.selected) : -9;
    c.patches.forEach((p, i) => { p.visible = i === selStart || (i === selStart + 1 && this.slots[selStart].span === 2); });
    this.torchLift = damp(this.torchLift, ready && this.hover === TORCH_ID ? 1 : 0, 14, dt);
    this.torchHolder.position.set(0, -0.014 * this.torchLift, 0);
    this.torchHolder.scale.setScalar(1 + 0.12 * this.torchLift);
    this.torchHolder.rotation.x = Math.sin(time * 2.3) * 0.05 * this.torchLift;

    // ── pointing hand: fingertip just above the cursor (or the torch) ──
    g.updateMatrixWorld(true);
    // (for the torch, the finger stops at the hinge and points up at it: reaching into the lid
    // would put the whole sleeve across the case)
    const z = this.hover === TORCH_ID ? -CASE.D / 2 + 0.035 : this.cur.z + this.tipNear;
    _v.set(this.cur.x, CASE.FLOOR + this.tipLift, z);
    c.base.localToWorld(_v);
    const k = this.tip.lengthSq() ? 1 - Math.exp(-18 * dt) : 1;
    this.tip.lerp(_v, k);
    return _v.copy(this.tip).add(this.wrist);
  }

  /** E: take the pointed-at item in hand. */
  take() {
    const inv = this.game.inventory;
    if (this.hover === TORCH_ID || !inv.slots?.[this.hover]) return this.nudge();
    if (inv.selected !== this.hover) inv.select(this.hover);
  }

  /** Click: use the item in hand with the pointed-at one (an empty hand just takes it). */
  click() {
    const inv = this.game.inventory;
    const a = inv.selected;
    const b = this.hover === TORCH_ID ? 'flashlight' : this.hover;
    if (!inv.slots?.[a]) return b === 'flashlight' ? this.nudge() : this.take();
    if (b !== 'flashlight' && (!inv.slots?.[b] || inv.slots[b] === inv.slots[a])) return this.nudge();
    // gameplay.combineSlots returns false when the two don't combine: wiggle the target
    if (!this.game.gameplay?.combineSlots?.(a, b)) this.nudge();
  }

  nudge() {
    if (this.hover >= 0) this.slots[this.hover].wob = 0.4;
    else this.torchLift = 0.2;
  }

  /** The luggage tag (hovered item's name) + a key hint line, on the text layer. Call after the render. */
  drawTags(layer, vmCamera) {
    if (!this.ready || !this.game.inventory) return;
    const inv = this.game.inventory;
    const ui = this.game.cfg.ui ?? {};
    const keys = this.game.cfg.keys ?? {};
    const kl = (a, d) => keyLabel(keys[a]?.[0] ?? d);
    const opacity = clamp((this.t - 0.85) * 8, 0, 1);
    const nameOf = (st) => (st ? (st.def?.name ?? this.game.content.objects?.[st.id]?.name ?? st.id) : null);
    const held = nameOf(inv.slots?.[inv.selected]);
    const lines = [];
    if (this.hover === TORCH_ID) {
      lines.push('torch');
      if (held) lines.push(`${kl('use', 'Mouse0')} · use ${held} on it`);
    } else {
      const st = inv.slots?.[this.hover];
      if (!st) lines.push('(empty)');
      else if (st === inv.slots?.[inv.selected]) lines.push(nameOf(st), 'in hand');
      else {
        lines.push(nameOf(st));
        if (held) lines.push(`${kl('use', 'Mouse0')} · use with ${held}`);
        lines.push(`${kl('interact', 'KeyE')} · take in hand`);
      }
    }
    // hangs off the case's near right corner on a string: the tag's top-left corner at the string's end
    this.c.tagAnchor.getWorldPosition(_v).project(vmCamera);
    const x = (_v.x * 0.5 + 0.5) * layer.W, y = (0.5 - _v.y * 0.5) * layer.H;
    const m = layer.measure(lines, { size: 0.9, maxW: Math.max(150, layer.W * 0.26) });
    m.lines = m.lines.slice(0, 4);
    layer.tag(null, Math.min(x, layer.W - m.w - 4), Math.min(y, layer.H - m.h - 4), { m, anchor: [0.08, 0], opacity, color: '#cdb487', seed: 7 });

    if (ui.textPrompts !== false) {
      const close = `${kl('pockets', 'KeyQ')} · close`;
      layer.tag(`${kl('left', 'KeyA')} ← → ${kl('right', 'KeyD')} · choose    ${close}`, layer.W / 2, layer.H - layer.margin * 0.4, {
        anchor: [0.5, 1], size: 0.72, opacity,
      });
    }
  }
}
