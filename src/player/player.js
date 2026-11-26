// First-person controller: grid collision (circle vs solid cells), sprint, crouch, head bob.
import * as THREE from 'three';
import { CELL } from '../world/roomBuilder.js';

export class Player {
  constructor(cfg, camera) {
    this.cfg = cfg;
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eye = cfg.eyeHeight;
    this.bobPhase = 0;
    this.speedNow = 0;
    this.onStep = null; // callback(surface) for footsteps
    this._lastStepSign = 1;
  }

  update(dt, input, world) {
    const c = this.cfg;
    this.yaw -= input.lookDX * c.mouseSensitivity;
    this.pitch -= input.lookDY * c.mouseSensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    let fx = 0, fz = 0;
    if (input.held('forward')) fz -= 1;
    if (input.held('back')) fz += 1;
    if (input.held('left')) fx -= 1;
    if (input.held('right')) fx += 1;
    const len = Math.hypot(fx, fz);
    const crouch = input.held('crouch');
    const sprint = input.held('sprint') && !crouch && fz < 0;
    const target = len ? (crouch ? c.crouchSpeed : sprint ? c.sprintSpeed : c.walkSpeed) : 0;
    // exponential smoothing toward target speed (frame-rate independent)
    this.speedNow += (target - this.speedNow) * (1 - Math.exp(-12 * dt));

    if (len) { fx /= len; fz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const mx = (fx * cos + fz * sin) * this.speedNow * dt;
    const mz = (-fx * sin + fz * cos) * this.speedNow * dt;
    this.move(mx, mz, world);

    // crouch height + head bob
    const eyeTarget = crouch ? c.crouchHeight : c.eyeHeight;
    this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-10 * dt));
    this.bobPhase += this.speedNow * dt * 2.6;
    const bobAmp = c.bobAmount * Math.min(1, this.speedNow / c.walkSpeed);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmp;
    const bobX = Math.cos(this.bobPhase) * bobAmp * 0.5;

    // footstep at each bob trough
    const sign = Math.sign(Math.sin(this.bobPhase));
    if (sign !== this._lastStepSign && this.speedNow > 0.5) this.onStep?.(this.speedNow / c.walkSpeed);
    this._lastStepSign = sign;

    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * bobX, this.eye + bobY, this.pos.z - Math.sin(this.yaw) * bobX);
    this.camera.rotation.set(this.pitch, this.yaw, Math.cos(this.bobPhase) * bobAmp * 0.15, 'YXZ');
  }

  // Move then push out of any overlapping solid cell (slides along walls).
  move(dx, dz, world) {
    const r = this.cfg.radius;
    this.pos.x += dx;
    this.pos.z += dz;
    for (let iter = 0; iter < 2; iter++) {
      const minX = Math.floor((this.pos.x - r) / CELL) * CELL;
      const minZ = Math.floor((this.pos.z - r) / CELL) * CELL;
      for (let x = minX; x <= this.pos.x + r; x += CELL) {
        for (let z = minZ; z <= this.pos.z + r; z += CELL) {
          if (!world.isSolidAt(x + CELL / 2, z + CELL / 2)) continue;
          const px = Math.max(x, Math.min(this.pos.x, x + CELL));
          const pz = Math.max(z, Math.min(this.pos.z, z + CELL));
          const ddx = this.pos.x - px, ddz = this.pos.z - pz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2) || 0.0001;
          this.pos.x = px + (ddx / d) * r;
          this.pos.z = pz + (ddz / d) * r;
        }
      }
    }
  }
}
