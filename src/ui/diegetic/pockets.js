// Pocket check (hold I): the view tips down to an open jacket with four pockets, each holding a
// small model of its item, a handwritten name tag under it, the selected one raised. While held,
// mouse X moves the pointing hand between pockets; clicking a second pocket combines it with the
// selected one via game.gameplay.combineSlots(a, b).
import * as THREE from 'three';
import { box, damp, smooth } from '../../viewmodel/viewModel.js';
import { toViewModel } from '../../viewmodel/vmMaterial.js';
import { fitInto } from '../../viewmodel/arms.js';
import { wrapText, makeCanvas, HAND_FONT } from './text.js';

const SLOT_X = [-0.235, -0.085, 0.085, 0.235];
const SLOT_Y = -0.095, SLOT_Z = -0.43;
const _v = new THREE.Vector3();

export class Pockets {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.visible = false;
    const jt = game.textures.get('proc:jacket');
    for (const s of [-1, 1]) {
      const panel = box(0.34, 0.42, 0.02, jt);
      panel.position.set(s * 0.2, -0.13, -0.47);
      panel.rotation.y = -s * 0.28;
      this.group.add(panel);
      const lapel = box(0.05, 0.42, 0.024, jt, { tint: 0xb8b0a0 });
      lapel.position.set(s * 0.045, -0.13, -0.455);
      lapel.rotation.y = -s * 0.28;
      this.group.add(lapel);
    }
    const lining = box(0.12, 0.42, 0.01, null, { tint: 0x2a1a1a });
    lining.position.set(0, -0.13, -0.5);
    this.group.add(lining);
    this.slots = SLOT_X.map((x, i) => {
      const g = new THREE.Group();
      g.position.set(x, SLOT_Y, SLOT_Z + Math.abs(x) * 0.25);
      g.rotation.y = -Math.sign(x) * 0.28;
      const pocket = box(0.115, 0.075, 0.016, game.textures.get('proc:pocket'));
      pocket.position.set(0, -0.02, 0.012);
      g.add(pocket);
      const holder = new THREE.Group();
      g.add(holder);
      this.group.add(g);
      return { g, holder, key: null, lift: 0, wob: 0, i };
    });
    this.hoverF = 0;
    this.hover = 0;
    this.wasOpen = false;
  }

  syncSlot(slot, stack) {
    const key = stack ? stack.id : null;
    if (key === slot.key) return;
    slot.key = key;
    slot.holder.clear();
    if (!stack) return;
    const def = stack.def ?? this.game.content.objects?.[stack.id];
    let mesh = null;
    try { mesh = def ? this.game.world?.objects?.buildMesh(def) : null; } catch (e) { /* fall through */ }
    if (!mesh) mesh = new THREE.Group().add(box(0.04, 0.04, 0.04, null, { tint: 0x888888 }));
    toViewModel(mesh);
    fitInto(mesh, 0.062);
    const w = new THREE.Group();
    w.add(mesh);
    w.rotation.set(0.5, 0.4, 0.15);
    slot.holder.add(w);
  }

  /**
   * w: eased open amount. input: raw input (ungated). Returns the view-space point the right
   * hand should point at.
   */
  update(dt, w, raw, rawLook) {
    const inv = this.game.inventory;
    this.group.visible = w > 0.01;
    const open = w > 0.5;
    if (open && !this.wasOpen) this.hoverF = this.hover = inv?.selected ?? 0;
    this.wasOpen = open;
    const e = smooth(w);
    this.group.position.y = -(1 - e) * 0.35;
    if (!this.group.visible || !inv) return this.slots[this.hover].g.position;

    if (open) {
      this.hoverF = Math.max(0, Math.min(3, this.hoverF + rawLook.x * 0.01));
      this.hover = Math.round(this.hoverF);
      if (raw.wasPressed('use')) this.click();
    }
    for (const s of this.slots) {
      const stack = inv.slots?.[s.i] ?? null;
      this.syncSlot(s, stack);
      const target = (s.i === inv.selected ? 0.055 : 0) + (s.i === this.hover && open ? 0.02 : 0);
      s.lift = damp(s.lift, target, 14, dt);
      s.wob = Math.max(0, s.wob - dt);
      s.holder.position.set(Math.sin(s.wob * 60) * 0.008 * (s.wob / 0.4), 0.03 + s.lift, 0);
      s.holder.rotation.x = s.i === inv.selected ? -0.35 : 0;
    }
    const hp = this.slots[this.hover].g.position;
    return _v.set(hp.x + 0.035, hp.y - 0.075, hp.z + 0.14);
  }

  click() {
    const inv = this.game.inventory;
    const a = inv.selected, b = this.hover;
    if (a === b || !inv.slots?.[a] || !inv.slots?.[b]) { this.slots[b].wob = 0.4; return; }
    if (this.game.gameplay?.combineSlots) this.game.gameplay.combineSlots(a, b);
    else this.slots[b].wob = 0.4; // nothing to combine with yet (M4 not merged)
  }

  /** Name tags under each pocket, via the screen-space paper overlay. */
  drawTags(paper, vmCamera, w) {
    if (w < 0.6 || !this.game.inventory) return;
    const inv = this.game.inventory;
    const [, m] = this._mc ?? (this._mc = makeCanvas(4, 4));
    const size = 8;
    for (const s of this.slots) {
      const stack = inv.slots?.[s.i];
      const name = stack ? (stack.def?.name ?? this.game.content.objects?.[stack.id]?.name ?? stack.id) : '(empty)';
      const lines = wrapText(m, name, 62 * paper.scale, `bold ${Math.round(size * paper.scale)}px ${HAND_FONT}`).slice(0, 2);
      _v.set(0, -0.065, 0.02);
      s.g.localToWorld(_v);
      _v.project(vmCamera);
      const x = (_v.x * 0.5 + 0.5) * paper.W, y = (_v.y * 0.5 + 0.5) * paper.H;
      const sel = s.i === inv.selected;
      paper.draw(lines, x, y, {
        anchor: [0.5, 1], size, key: 'pk',
        color: sel ? '#efe6c4' : s.i === this.hover ? '#d8cfb4' : '#b9b19a',
        opacity: Math.min(1, (w - 0.6) * 3),
      });
    }
  }
}
