// The world: placed rooms + their objects, lights and colliders.
// M2 places rooms explicitly; M3 adds herringbone/WFC streaming on top of addRoom().
import * as THREE from 'three';
import { buildRoom, CELL } from './roomBuilder.js';
import { ObjectSystem } from '../objects/objectSystem.js';
import { populateRoom } from '../spawn/spawner.js';
import { shared, MAX_LIGHTS } from '../render/ps1.js';

const CEILING_COLOR = new THREE.Color(1.0, 0.92, 0.62);

export class World {
  constructor({ content, textures, scene, audio, seed }) {
    this.content = content;
    this.textures = textures;
    this.scene = scene;
    this.seed = seed;
    this.rooms = [];
    this.objects = new ObjectSystem({ defs: content.objects ?? {}, textures, scene, audio });
    this.run = { spawnedUnique: new Set(), taken: new Set() };
    this._lightTmp = [];
  }

  /** Place a room by id with its top-left corner at origin {x, z} (metres). */
  addRoom(roomId, origin = { x: 0, z: 0 }, opts = {}) {
    const json = this.content.rooms?.[roomId];
    if (!json) throw new Error(`Unknown room "${roomId}"`);
    const built = buildRoom(json, this.textures, origin);
    this.scene.add(built.group);
    const key = opts.key ?? `${roomId}@${origin.x},${origin.z}`;
    const placed = { key, json, built, origin };
    for (const L of built.lights) { L.color = CEILING_COLOR; L.range = 9; L.flicker = 0.03; }
    placed.objects = populateRoom(json, {
      key, origin, quarterTurns: 0, depth: opts.depth ?? 0, zone: opts.zone ?? 'lobby', worldSeed: this.seed,
    }, this.objects, this.content.pools ?? {}, this.run);
    this.rooms.push(placed);
    return placed;
  }

  roomAt(x, z) {
    for (const r of this.rooms) {
      const g = r.built.grid;
      if (x >= g.ox && z >= g.oz && x < g.ox + g.w * CELL && z < g.oz + g.h * CELL) return r;
    }
    return null;
  }

  isSolidAt(x, z) {
    const r = this.roomAt(x, z);
    return r ? r.built.isSolidAt(x, z) : true;
  }

  get colliders() { return this.objects.colliders; }

  /** Does a wall cell sit between two points? (coarse 0.25 m march, ignores props) */
  wallBetween(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const n = Math.ceil(Math.hypot(dx, dz) / 0.25);
    for (let i = 1; i < n; i++) {
      if (this.isSolidAt(a.x + (dx * i) / n, a.z + (dz * i) / n)) return true;
    }
    return false;
  }

  /** Aimed-at interactable, highlighted. Returns { inst, distance } or null. */
  updateFocus(camera) {
    const hit = this.objects.pickInteractable(camera, { occluded: (a, b) => this.wallBetween(a, b) });
    this.objects.setHighlight(hit?.inst ?? null);
    return hit;
  }

  update(dt, ctx) {
    this.objects.update(dt, ctx);
    this.updateLights(ctx.camera, ctx.time);
  }

  // Nearest lights to the camera go into the shared shader uniforms, with flicker.
  updateLights(camera, time) {
    const all = this._lightTmp;
    all.length = 0;
    for (const r of this.rooms) for (const L of r.built.lights) all.push(L);
    for (const L of this.objects.lights) all.push(L);
    for (const L of all) L.d = L.pos.distanceToSquared(camera.position);
    all.sort((a, b) => a.d - b.d);
    const n = Math.min(MAX_LIGHTS, all.length);
    for (let i = 0; i < n; i++) {
      const L = all[i];
      // fluorescent stutter: mostly steady, occasional drop seeded per fixture
      const s = Math.sin(time * 7.3 + L.seed) * Math.sin(time * 1.7 + L.seed * 0.3);
      const flick = s > 1 - L.flicker ? 0.25 : 1;
      shared.uLightPos.value[i].copy(L.pos);
      shared.uLightColor.value[i].copy(L.color).multiplyScalar(flick);
      shared.uLightRange.value[i] = L.range;
    }
    shared.uLightCount.value = n;
  }
}
