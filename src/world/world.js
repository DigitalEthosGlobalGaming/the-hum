// The world: an endless herringbone/WFC layout streamed in around the player as rooms,
// plus their objects, lights and colliders.
//   layout (src/world/layout)  → which room sits in every slot (pure, deterministic)
//   roomBuilder                → meshes + cell grid for one room
//   spawner                    → fixed objects + rolled spots
import * as THREE from 'three';
import { buildRoom } from './roomBuilder.js';
import { createWorldLayout, slotAtBlock, BLOCK_M } from './layout/index.js';
import { ObjectSystem } from '../objects/objectSystem.js';
import { populateRoom } from '../spawn/spawner.js';
import { shared, MAX_LIGHTS } from '../render/ps1.js';
import { hash } from '../core/rng.js';

const CEILING_COLOR = new THREE.Color(1.0, 0.92, 0.62);

export class World {
  constructor({ content, textures, scene, audio, seed }) {
    this.content = content;
    this.textures = textures;
    this.scene = scene;
    this.seed = seed;
    const s = content.config?.world ?? {};
    this.loadRadius = s.loadRadius ?? 3;       // blocks around the player to have built
    this.unloadRadius = s.unloadRadius ?? 5;   // blocks beyond which rooms are dropped
    this.buildsPerFrame = s.buildsPerFrame ?? 2;
    this.layout = createWorldLayout({ worldSeed: seed, rooms: content.rooms ?? {}, zoneAt: () => 'lobby' });
    if (this.layout.templates.errors.length) console.warn('[world] room template errors:\n' + this.layout.templates.errors.join('\n'));
    this.rooms = new Map();        // roomKey → placed room
    this.bySlot = new Map();       // slotKey → placed room (big rooms appear under every slot they claim)
    this.queue = [];               // layout entries waiting to be built
    this.queued = new Set();
    this.objects = new ObjectSystem({ defs: content.objects ?? {}, textures, scene, audio });
    this.run = { spawnedUnique: new Set(), taken: new Set() };
    this._lightTmp = [];
    this._lastBlock = null;
    this.stats = { built: 0, dropped: 0, buildMs: 0 };
  }

  static roomKeyOf(entry) { return entry.bigRoom?.key ?? entry.slotKey; }

  // ---------------------------------------------------------------- streaming

  /** Build the area around the origin synchronously and pick a spawn point. */
  start() {
    this.stream(new THREE.Vector3(8, 0, 8), { sync: true });
    // start somewhere lit: the nearest single room with at least two working lights
    const lit = [...this.rooms.values()]
      .filter((r) => !r.entry.bigRoom && r.built.lights.length >= 2)
      .sort((a, b) => dist2(a.entry, 0, 0) - dist2(b.entry, 0, 0))[0];
    const e = lit?.entry;
    const pos = e ? this.findSpawn(e.bx + (e.orient === 'h' ? 0.5 : 0), e.bz + (e.orient === 'v' ? 0.5 : 0)) : this.findSpawn(0, 0);
    this.stream(pos, { sync: true });
    // face the longest open line of sight (yaw 0 = -z, positive turns left)
    let yaw = 0, best = -1;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, dx = -Math.sin(a), dz = -Math.cos(a);
      let d = 0;
      while (d < 30 && !this.isSolidAt(pos.x + dx * d, pos.z + dz * d)) d += 0.5;
      if (d > best) { best = d; yaw = a; }
    }
    return { pos, yaw };
  }

  /** Nearest walkable cell centre to the middle of block (bx, bz). */
  findSpawn(bx, bz) {
    const cx = bx * BLOCK_M + BLOCK_M / 2, cz = bz * BLOCK_M + BLOCK_M / 2;
    for (let r = 0; r < 24; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx * 2, z = cz + dz * 2;
          if (!this.isSolidAt(x, z) && !this.isSolidAt(x + 0.7, z) && !this.isSolidAt(x - 0.7, z)
            && !this.isSolidAt(x, z + 0.7) && !this.isSolidAt(x, z - 0.7)) return new THREE.Vector3(x, 0, z);
        }
      }
    }
    return new THREE.Vector3(cx, 0, cz);
  }

  /** Queue rooms near `pos`, drop far ones, build a few per frame. */
  stream(pos, { sync = false } = {}) {
    const bx = Math.floor(pos.x / BLOCK_M), bz = Math.floor(pos.z / BLOCK_M);
    const key = bx + ',' + bz;
    if (key !== this._lastBlock) {
      this._lastBlock = key;
      const R = this.loadRadius;
      const entries = this.layout.layoutRegion(bx - R, bz - R, bx + R, bz + R);
      // nearest first, so the room you're walking into is built before distant ones
      entries.sort((a, b) => dist2(a, bx, bz) - dist2(b, bx, bz));
      for (const e of entries) {
        const k = World.roomKeyOf(e);
        if (this.rooms.has(k) || this.queued.has(k)) continue;
        this.queued.add(k);
        this.queue.push(e);
      }
      this.queue.sort((a, b) => dist2(a, bx, bz) - dist2(b, bx, bz));
      for (const [k, placed] of this.rooms) {
        if (dist2(placed.entry, bx, bz) > this.unloadRadius * this.unloadRadius) this.dropRoom(k);
      }
    }
    const n = sync ? Infinity : this.buildsPerFrame;
    for (let i = 0; i < n && this.queue.length; i++) {
      const e = this.queue.shift();
      this.queued.delete(World.roomKeyOf(e));
      if (dist2(e, bx, bz) > this.unloadRadius * this.unloadRadius) continue; // walked away before it built
      this.placeEntry(e);
    }
  }

  placeEntry(entry) {
    const t0 = performance.now();
    const key = World.roomKeyOf(entry);
    const origin = { x: entry.origin[0] * BLOCK_M, z: entry.origin[1] * BLOCK_M };
    const built = buildRoom(entry.room, this.textures, origin);
    this.scene.add(built.group);
    const salt = hash(this.seed, 'lights', key) % 997;
    for (const L of built.lights) { L.color = CEILING_COLOR; L.range = 11; L.flicker = 0.03; L.seed += salt; }
    const depth = Math.hypot(entry.bx, entry.bz);
    const placed = { key, entry, json: entry.room, built, origin, depth };
    placed.objects = populateRoom(entry.room, {
      key, origin, quarterTurns: 0, depth, zone: entry.zone, worldSeed: this.seed,
    }, this.objects, this.content.pools ?? {}, this.run);
    // things the player left here (drops, chalk marks) come back with the room
    const alive = new Set(this.objects.instances.map((i) => i.meta.placedKey).filter(Boolean));
    for (const [placedKey, e] of this.run.placed ?? []) {
      if (e.roomKey !== key || alive.has(placedKey)) continue;
      const inst = this.objects.spawn(e.id, new THREE.Vector3(...e.pos), e.rotY, { roomKey: key, placedKey });
      if (inst) { inst.state = e.state; placed.objects.push(inst); }
    }
    this.rooms.set(key, placed);
    for (const sk of entry.bigRoom?.slots ?? [entry.slotKey]) this.bySlot.set(sk, placed);
    this.stats.built++;
    this.stats.buildMs = performance.now() - t0;
    return placed;
  }

  dropRoom(key) {
    const placed = this.rooms.get(key);
    if (!placed) return;
    this.scene.remove(placed.built.group);
    placed.built.group.traverse((o) => o.geometry?.dispose());
    // everything that belongs to this room, including things gameplay dropped/placed here
    for (const inst of [...this.objects.instances]) {
      if (inst.meta.roomKey === key || placed.objects.includes(inst)) this.objects.remove(inst);
    }
    for (const sk of placed.entry.bigRoom?.slots ?? [placed.entry.slotKey]) {
      if (this.bySlot.get(sk) === placed) this.bySlot.delete(sk);
    }
    this.rooms.delete(key);
    this.stats.dropped++;
  }

  // ---------------------------------------------------------------- queries

  roomAt(x, z) {
    const slot = slotAtBlock(Math.floor(x / BLOCK_M), Math.floor(z / BLOCK_M));
    return this.bySlot.get(slot.key) ?? null;
  }

  /** Cell walls only (props aren't included). Unbuilt space counts as solid. */
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

  debugLines(playerPos) {
    const here = playerPos ? this.roomAt(playerPos.x, playerPos.z) : null;
    return [
      `rooms      ${this.rooms.size} built, ${this.queue.length} queued (last ${this.stats.buildMs.toFixed(1)} ms)`,
      `room       ${here ? (here.entry.roomId ?? 'filler') + ' · ' + here.entry.slotKey + (here.entry.bigRoom ? ' (big)' : '') : '-'}`,
      `depth      ${here ? here.depth.toFixed(1) : '-'} blocks`,
      `objects    ${this.objects.instances.length} (${this.colliders.length} solid, ${this.objects.lights.length} lit)`,
    ];
  }

  // ---------------------------------------------------------------- per frame

  update(dt, ctx) {
    if (ctx.player) this.stream(ctx.player.pos);
    this.objects.update(dt, ctx);
    this.updateLights(ctx.camera, ctx.time);
  }

  // Nearest lights to the camera go into the shared shader uniforms, with flicker.
  updateLights(camera, time) {
    const all = this._lightTmp;
    all.length = 0;
    const cx = camera.position.x, cz = camera.position.z;
    for (const r of this.rooms.values()) {
      for (const L of r.built.lights) {
        const dx = L.pos.x - cx, dz = L.pos.z - cz;
        L.d = dx * dx + dz * dz;
        if (L.d < 900) all.push(L); // within 30 m
      }
    }
    for (const L of this.objects.lights) { L.d = L.pos.distanceToSquared(camera.position); all.push(L); }
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

// squared block distance from (bx, bz) to an entry's slot (uses the slot's centre block)
function dist2(e, bx, bz) {
  const ex = e.bx + (e.orient === 'h' ? 0.5 : 0), ez = e.bz + (e.orient === 'v' ? 0.5 : 0);
  return (ex - bx) ** 2 + (ez - bz) ** 2;
}
