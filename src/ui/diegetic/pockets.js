// Pocket check (hold Q): the view tips down to an open jacket with four pockets, each holding a
// small model of its item, a handwritten name tag under it, the selected one raised. While held,
// mouse X moves the pointing hand between pockets; clicking a second pocket combines it with the
// selected one via game.gameplay.combineSlots(a, b).
import * as THREE from 'three';
import { box, damp, smooth } from '../../viewmodel/viewModel.js';
import { toViewModel } from '../../viewmodel/vmMaterial.js';
import { fitInto } from '../../viewmodel/arms.js';

const SLOT_X = [-0.235, -0.085, 0.085, 0.235];
const TORCH_X = -0.16, TORCH_Y = 0.02; // breast-strap loop above the left pockets while the jacket is open
const SLOT_Y = -0.035, SLOT_Z = -0.43;
const _v = new THREE.Vector3();

/** Repeat a mesh's texture n times (keeps texels small on big panels). */
function tile(mesh, n) {
  const uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * n, uv.getY(i) * n);
  return mesh;
}

export class Pockets {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.visible = false;
    const jt = game.textures.get('proc:jacket');
    for (const s of [-1, 1]) {
      const panel = tile(box(0.34, 0.42, 0.02, jt), 4);
      panel.position.set(s * 0.2, -0.13, -0.47);
      panel.rotation.y = -s * 0.28;
      this.group.add(panel);
      const lapel = tile(box(0.05, 0.42, 0.024, jt, { tint: 0xb8b0a0 }), 3);
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
    // torch slot (hover -1): a strap loop on the left panel holding a copy of the torch
    const tg = new THREE.Group();
    tg.position.set(TORCH_X, TORCH_Y, SLOT_Z + Math.abs(TORCH_X) * 0.25);
    tg.rotation.y = 0.28;
    const loop = box(0.04, 0.012, 0.012, null, { tint: 0x5a4a36 }); // thin leather strap round the torch
    loop.position.set(0, -0.005, 0.016);
    tg.add(loop);
    const th = new THREE.Group();
    tg.add(th);
    this.group.add(tg);
    this.torchSlot = { g: tg, holder: th, lift: 0 };
    this.hoverF = 0;
    this.hover = 0;
    this.wasOpen = false;
  }

  /** Copy the left-hand torch (LED state as of opening) into the strap loop. */
  syncTorch(torch) {
    const h = this.torchSlot.holder;
    h.clear();
    if (!torch) return;
    const copy = torch.clone(true);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
    fitInto(copy, 0.12);
    const w = new THREE.Group();
    w.add(copy);
    w.rotation.set(-1.45, 0, 0.12); // standing upright in the loop between the left pockets, lens up
    h.add(w);
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
  update(dt, w, raw, rawLook, torch) {
    const inv = this.game.inventory;
    this.group.visible = w > 0.01;
    const open = w > 0.5;
    if (w > 0.01 && !this.torchSynced) { this.syncTorch(torch); this.torchSynced = true; }
    if (w <= 0.01) this.torchSynced = false;
    if (open && !this.wasOpen) this.hoverF = this.hover = inv?.selected ?? 0;
    this.wasOpen = open;
    const e = smooth(w);
    this.group.position.y = -(1 - e) * 0.35;
    if (!this.group.visible || !inv) return _v.set(0, -0.3, -0.3);

    if (open) {
      // -1 = the torch in the left hand (battery + flashlight combine), 0..3 = pockets
      this.hoverF = Math.max(-1, Math.min(3, this.hoverF + rawLook.x * 0.01));
      if (raw.wasPressed('left')) this.hoverF = Math.max(-1, Math.round(this.hoverF) - 1);
      if (raw.wasPressed('right')) this.hoverF = Math.min(3, Math.round(this.hoverF) + 1);
      this.hover = Math.round(this.hoverF);
      if (raw.wasPressed('use')) this.click();
    }
    for (const s of this.slots) {
      const stack = inv.slots?.[s.i] ?? null;
      this.syncSlot(s, stack);
      const target = (s.i === inv.selected ? 0.03 : 0) + (s.i === this.hover && open ? 0.02 : 0);
      s.lift = damp(s.lift, target, 14, dt);
      s.wob = Math.max(0, s.wob - dt);
      s.holder.position.set(Math.sin(s.wob * 60) * 0.008 * (s.wob / 0.4), 0.008 + s.lift, 0); // half tucked behind the pocket front
      s.holder.rotation.x = s.i === inv.selected ? -0.35 : 0;
    }
    const ts = this.torchSlot;
    ts.lift = damp(ts.lift, this.hover < 0 && open ? 0.03 : 0, 14, dt);
    ts.holder.position.y = 0.01 + ts.lift;
    if (this.hover < 0) {
      const tp = ts.g.position;
      return _v.set(tp.x + 0.035, tp.y - 0.075, tp.z + 0.14);
    }
    const hp = this.slots[Math.max(0, this.hover)].g.position;
    return _v.set(hp.x + 0.035, hp.y - 0.075, hp.z + 0.14);
  }

  click() {
    const inv = this.game.inventory;
    const a = inv.selected;
    const b = this.hover < 0 ? 'flashlight' : this.hover;
    const nudge = () => { if (this.hover >= 0) this.slots[this.hover].wob = 0.4; };
    if (a === b || !inv.slots?.[a] || (b !== 'flashlight' && !inv.slots?.[b])) return nudge();
    // gameplay.combineSlots returns false when the two don't combine: wiggle the target
    if (!this.game.gameplay?.combineSlots?.(a, b)) nudge();
  }

  /** Name tags under each pocket, on the full-res text layer (call after the render). */
  drawTags(layer, vmCamera, w, torch) {
    if (w < 0.6 || !this.game.inventory) return;
    const inv = this.game.inventory;
    const opacity = Math.min(1, (w - 0.6) * 3);
    const toScreen = () => ({ x: (_v.x * 0.5 + 0.5) * layer.W, y: (0.5 - _v.y * 0.5) * layer.H });
    // tag width: a bit less than the spacing between pockets on screen
    _v.set(SLOT_X[0], SLOT_Y, SLOT_Z).project(vmCamera); const a = toScreen();
    _v.set(SLOT_X[1], SLOT_Y, SLOT_Z).project(vmCamera); const b = toScreen();
    const maxW = Math.max(90, Math.abs(b.x - a.x) * 0.92);
    {
      _v.set(0, -0.065, 0.02);
      this.torchSlot.g.localToWorld(_v).project(vmCamera);
      const t = toScreen();
      layer.tag(null, t.x, t.y, {
        m: layer.measure('torch', { size: 0.95, maxW }), anchor: [0.5, 0], opacity,
        color: this.hover < 0 ? '#e9e0c9' : '#cfc6ae',
      });
    }
    for (const s of this.slots) {
      const stack = inv.slots?.[s.i];
      const name = stack ? (stack.def?.name ?? this.game.content.objects?.[stack.id]?.name ?? stack.id) : '(empty)';
      _v.set(0, -0.065, 0.02);
      s.g.localToWorld(_v).project(vmCamera);
      const p = toScreen();
      const sel = s.i === inv.selected;
      const m = layer.measure(name, { size: 0.95, maxW });
      m.lines = m.lines.slice(0, 2);
      layer.tag(null, p.x, p.y, {
        m, anchor: [0.5, 0], opacity,
        color: sel ? '#f3ead2' : s.i === this.hover ? '#e9e0c9' : '#cfc6ae',
      });
    }
  }
}
