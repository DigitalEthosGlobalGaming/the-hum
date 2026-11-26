// Left arm (torch + watch) and right arm (held item, reach, swap/shake/use/grab motions).
// Each arm blends between named poses by weights the diegetic controller eases each frame.
import * as THREE from 'three';
import { makeArm, curl, box, damp, smooth } from './viewModel.js';
import { toViewModel } from './vmMaterial.js';

const P = (x, y, z, rx = 0, ry = 0, rz = 0) => ({ p: new THREE.Vector3(x, y, z), r: new THREE.Vector3(rx, ry, rz) });
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();

function blend(base, layers) {
  _p.copy(base.p); _r.copy(base.r);
  for (const [pose, w] of layers) {
    if (w <= 0) continue;
    _p.lerp(pose.p, w); _r.lerp(pose.r, w);
  }
}

export class LeftArm {
  constructor(textures, flashlight) {
    this.arm = makeArm(textures, -1);
    this.root = this.arm.root;
    this.root.rotation.order = 'YXZ';
    // torch grip: hide the forward fingers, wrap strips around the torch body instead
    for (const f of this.arm.fingers) f.visible = false;
    this.arm.palm.position.set(0, -0.02, -0.035);
    const skin = textures.get('proc:skin');
    for (let i = 0; i < 4; i++) {
      const wrap = box(0.052, 0.012, 0.0125, skin, { tint: 0xf0e6dc });
      wrap.position.set(0.004, 0.006 - Math.abs(i - 1.5) * 0.002, -0.012 - i * 0.0145);
      wrap.rotation.z = -0.35;
      this.arm.hand.add(wrap);
    }
    this.arm.thumb.position.set(0.026, 0.016, -0.03);
    this.arm.thumb.rotation.set(0, -0.2, 0);
    this.torch = flashlight.model;
    this.torch.position.set(0, 0.012, -0.02);
    this.arm.hand.add(this.torch);
    this.poses = {
      idle: P(-0.16, -0.15, -0.36, 0.04, -0.14, 0.08),
      watch: P(0.0, -0.07, -0.23, 0.22, -1.35, -1.2),
      pockets: P(-0.2, -0.62, -0.34, 0.04, -0.14, 0.08), // drops out of view; the torch shows clipped in the case lid instead
    };
  }

  /** w: { watch, hidden } eased 0..1 */
  update(vm, w) {
    blend(this.poses.idle, [[this.poses.watch, smooth(w.watch)], [this.poses.pockets, smooth(w.pockets ?? 0)]]);
    _p.y -= smooth(w.hidden) * 0.42;
    this.root.position.copy(_p);
    this.root.rotation.set(_r.x, _r.y, _r.z);
    vm.applyRig(this.root, 1.25 * (1 - w.watch * 0.6), -1);
  }
}

export class RightArm {
  constructor(game) {
    this.game = game;
    this.arm = makeArm(game.textures, 1);
    this.root = this.arm.root;
    this.root.rotation.order = 'YXZ';
    this.mount = new THREE.Group();
    this.mount.position.set(0, 0.03, -0.065);
    this.arm.hand.add(this.mount);
    this.poses = {
      idle: P(0.17, -0.165, -0.38, 0.06, 0.16, -0.06),
      reach: P(0.13, -0.135, -0.47, 0.18, 0.06, -0.02),
      point: P(0, 0, 0, 0.3, 0.25, 0.1), // pockets: index finger at the pocket case (pockets.js places the wrist)
    };
    this.shownKey = null;    // stack identity currently in the hand
    this.item = null;
    this.swap = 0;           // 0 = up, 1 = fully lowered
    this.swapDir = 0;        // +1 lowering, -1 raising
    this.pending = undefined;
    this.shakeT = 0; this.useT = 0; this.grabT = 0;
    this.curl = 0.55;
    this.pointAt = new THREE.Vector3();
  }

  /** inventory:change → lower, swap, raise (only if the held stack really changed). */
  onInventoryChange() {
    const inv = this.game.inventory;
    const held = inv?.held ?? null;
    const same = (held?.id ?? null) === (this.shownKey?.id ?? null) && inv?.selected === this.shownSel;
    if (same && this.swapDir === 0) { this.shownKey = held; return; }
    this.shownSel = inv?.selected;
    this.pending = held;
    this.swapDir = 1;
  }
  onFull() { this.shakeT = 0.45; }
  onUse() { this.useT = 0.32; }
  onPickup() { this.grabT = 0.5; }

  setItem(stack) {
    if (this.item) { this.mount.remove(this.item); this.item = null; }
    this.shownKey = stack;
    if (!stack) return;
    const def = stack.def ?? this.game.content.objects?.[stack.id];
    let mesh;
    try {
      mesh = def && this.game.world?.objects?.buildMesh ? this.game.world.objects.buildMesh(def) : null;
    } catch (e) { console.warn('[diegetic] held item mesh failed', e); }
    if (!mesh) mesh = new THREE.Group().add(box(0.05, 0.05, 0.05, null, { tint: 0x888888 }));
    toViewModel(mesh);
    fitInto(mesh, this.game.cfg.ui?.heldSize ?? 0.085);
    const wrap = new THREE.Group();
    wrap.add(mesh);
    wrap.rotation.set(0.15, -0.5, 0.1);
    this.item = wrap;
    this.mount.add(wrap);
  }

  /** w: { reach, hidden, pockets } eased 0..1; pointAt: view-space target in pockets mode. */
  update(vm, dt, w) {
    // swap state machine
    if (this.swapDir > 0) {
      this.swap = Math.min(1, this.swap + dt / 0.16);
      if (this.swap >= 1) { this.setItem(this.pending ?? null); this.pending = undefined; this.swapDir = -1; }
    } else if (this.swapDir < 0) {
      this.swap = Math.max(0, this.swap - dt / 0.22);
      if (this.swap <= 0) this.swapDir = 0;
    }
    const pk = smooth(w.pockets);
    blend(this.poses.idle, [[this.poses.reach, smooth(w.reach) * (1 - pk)]]);
    if (pk > 0) {
      _p.lerp(this.pointAt, pk); // toward the hovered pocket
      _r.lerp(this.poses.point.r, pk);
    }
    _p.y -= smooth(this.swap) * 0.3 + smooth(w.hidden) * 0.42;

    // one-shot motions (additive)
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeT / 0.45;
      _p.x += Math.sin(this.shakeT * 70) * 0.012 * k;
      _r.z += Math.sin(this.shakeT * 70) * 0.18 * k;
    }
    if (this.useT > 0) {
      this.useT = Math.max(0, this.useT - dt);
      const b = Math.sin((1 - this.useT / 0.32) * Math.PI);
      _p.z -= b * 0.05; _p.y += b * 0.025; _r.x += b * 0.35;
    }
    let curlT = 0.55;
    if (this.grabT > 0) {
      this.grabT = Math.max(0, this.grabT - dt);
      const t = 1 - this.grabT / 0.5;
      const b = Math.sin(Math.min(1, t * 1.15) * Math.PI);
      _p.x -= b * 0.09; _p.y += b * 0.03; _p.z -= b * 0.14; _r.x += b * 0.3;
      curlT = t < 0.45 ? 0.55 - (t / 0.45) * 0.55 : Math.min(1, (t - 0.45) * 4) * 0.8; // open, then snatch
    }
    if (pk > 0) curlT = curlT * (1 - pk) + 0.25 * pk;
    this.curl = damp(this.curl, curlT, 18, dt);
    curl(this.arm, this.curl);
    // pointing: index finger straight while the others curl
    if (pk > 0) this.arm.fingers[0].rotation.x *= 1 - pk;
    if (this.item) this.item.visible = pk < 0.5;

    this.root.position.copy(_p);
    this.root.rotation.set(_r.x, _r.y, _r.z);
    vm.applyRig(this.root, 1 - pk * 0.8, 1);
  }
}

/** Scale + centre a mesh so its largest dimension is `size` and it sits on the origin. */
export function fitInto(mesh, size) {
  const b = new THREE.Box3().setFromObject(mesh);
  const s = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const k = size / Math.max(s.x, s.y, s.z, 1e-4);
  mesh.scale.setScalar(k);
  mesh.position.copy(c).multiplyScalar(-k);
  return k;
}
