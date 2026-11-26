// View-model core: its own scene + narrow-FOV camera (near 0.01), registered as an overlay on the
// PS1Renderer so it draws into the same low-res target after the world with depth cleared (it can
// never clip into walls), then gets the same dither/post. Also computes the light at the player
// so the hands sit in the world's light, and the shared sway/bob rig.
import * as THREE from 'three';
import { shared } from '../render/ps1.js';
import { vmShared, makeVMMaterial } from './vmMaterial.js';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();

export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class ViewModel {
  constructor(game) {
    this.game = game;
    const ui = game.cfg.ui ?? {};
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(ui.vmFov ?? 55, game.renderer.aspect, 0.01, 10);
    this.scene.add(this.camera);
    this.overlay = game.renderer.addOverlay(this.scene, this.camera);

    // rig state
    this.sway = { x: 0, y: 0, vx: 0, vy: 0 };
    this.lastYaw = game.player.yaw;
    this.lastPitch = game.player.pitch;
    this.bobPhase = 0;
    this.bob = { x: 0, y: 0 };
    this.breath = 0;
    this.light = 0;          // luminance of the light at the player (vitals reads it)
    this.lightColor = new THREE.Color();
  }

  resize() {
    this.camera.aspect = this.game.renderer.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Light at the eye from the nearest world lights (same falloff as the PS1 shader). */
  sampleLight(beam) {
    const cam = this.game.camera;
    const p = cam.position;
    const key = this.lightColor.setRGB(0, 0, 0);
    _dir.set(0, 0, 0);
    const n = shared.uLightCount.value;
    for (let i = 0; i < n; i++) {
      const lp = shared.uLightPos.value[i];
      _v.subVectors(lp, p);
      const d = Math.max(_v.length(), 0.001);
      let att = Math.max(0, 1 - d / shared.uLightRange.value[i]);
      att *= att;
      const c = shared.uLightColor.value[i];
      key.r += c.r * att; key.g += c.g * att; key.b += c.b * att;
      _dir.addScaledVector(_v.divideScalar(d), att * (c.r + c.g + c.b));
    }
    this.light = 0.2126 * key.r + 0.7152 * key.g + 0.0722 * key.b;
    // world → view space for the key direction
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0);
    _dir.normalize().applyQuaternion(_q.copy(cam.quaternion).invert());
    vmShared.uVMKeyDir.value.lerp(_dir, 0.2).normalize();
    // soft clamp so a lamp right overhead doesn't blow the hands out to white
    const m = Math.max(key.r, key.g, key.b);
    if (m > 0.9) key.multiplyScalar(0.9 / m);
    vmShared.uVMKeyColor.value.lerp(key, 0.25);
    vmShared.uVMAmbient.value.copy(shared.uAmbient.value).multiplyScalar(1.3);
    vmShared.uVMFlash.value = beam * 0.32;
  }

  /** Sway (lagging the look), bob (with steps), breathing. Call once per frame. */
  updateRig(dt, { stamina = 1 } = {}) {
    const pl = this.game.player;
    const dYaw = wrapAngle(pl.yaw - this.lastYaw);
    const dPitch = pl.pitch - this.lastPitch;
    this.lastYaw = pl.yaw; this.lastPitch = pl.pitch;
    const s = this.sway;
    const idt = dt > 0 ? 1 / dt : 0;
    // spring toward an offset opposite the turn rate → the hands trail the view and settle back
    const tx = Math.max(-1, Math.min(1, -dYaw * idt * 0.06));
    const ty = Math.max(-1, Math.min(1, dPitch * idt * 0.06));
    const k = 90, c = 13;
    s.vx += ((tx - s.x) * k - s.vx * c) * dt; s.x += s.vx * dt;
    s.vy += ((ty - s.y) * k - s.vy * c) * dt; s.y += s.vy * dt;

    const walk = this.game.cfg.player.walkSpeed;
    const sp = Math.min(1.6, (pl.speedNow ?? 0) / walk);
    this.bobPhase = pl.bobPhase ?? (this.bobPhase + (pl.speedNow ?? 0) * dt * 2.6);
    const tired = 1 + (1 - stamina) * 0.8;      // ragged bob when winded
    this.bob.x = Math.cos(this.bobPhase) * 0.012 * sp * tired;
    this.bob.y = -Math.abs(Math.sin(this.bobPhase)) * 0.014 * sp * tired;
    const rate = 1.3 + (1 - stamina) * 2.4;
    this.breath += dt * rate;
  }

  /** Apply sway/bob/breath to an arm group whose base pose is already set. weight: lag amount. */
  applyRig(group, weight = 1, phaseFlip = 1) {
    const s = this.sway;
    group.position.x += (s.x * 0.03 + this.bob.x * phaseFlip) * weight;
    group.position.y += (s.y * 0.025 + this.bob.y + Math.sin(this.breath) * 0.003) * weight;
    group.rotation.y += s.x * 0.12 * weight;
    group.rotation.x += s.y * 0.1 * weight;
    group.rotation.z += s.x * 0.06 * weight;
  }
}

// ── low-poly parts ──
export function box(w, h, d, tex, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeVMMaterial(tex, opts));
  m.frustumCulled = false;
  return m;
}
export function cyl(r0, r1, len, seg, tex, opts) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2); // along Z
  const m = new THREE.Mesh(g, makeVMMaterial(tex, opts));
  m.frustumCulled = false;
  return m;
}

/**
 * An arm: pivot at the wrist. Sleeve runs back (+z) and down out of frame; hand sits ahead (-z).
 * Returns { root, hand, sleeve, fingers[], thumb, wristTop } — wristTop is where a watch goes.
 */
export function makeArm(textures, side = 1) {
  const root = new THREE.Group();
  const skin = textures.get('proc:skin');
  const sleeve = box(0.075, 0.07, 0.42, textures.get('proc:sleeve'));
  sleeve.position.set(0, -0.005, 0.2);
  root.add(sleeve);
  const hand = new THREE.Group();
  root.add(hand);
  const palm = box(0.058, 0.03, 0.07, skin);
  palm.position.set(0, 0, -0.04);
  hand.add(palm);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set((i - 1.5) * 0.0145, 0.004, -0.075);
    const seg = box(0.012, 0.014, 0.04, skin, { tint: 0xf0e6dc });
    seg.position.z = -0.018;
    f.add(seg);
    hand.add(f);
    fingers.push(f);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-0.03 * side, -0.004, -0.03);
  const th = box(0.014, 0.014, 0.035, skin);
  th.position.z = -0.016;
  thumb.add(th);
  thumb.rotation.y = 0.5 * side;
  hand.add(thumb);
  const wristTop = new THREE.Group();
  wristTop.position.set(0, 0.036, 0.012);
  root.add(wristTop);
  return { root, hand, palm, sleeve, fingers, thumb, wristTop };
}

/** Curl fingers 0 (open) .. 1 (fist). */
export function curl(arm, t) {
  for (const f of arm.fingers) f.rotation.x = -t * 1.5;
  arm.thumb.rotation.x = -t * 0.6;
}
