// Places a room's fixed objects and rolls its spots, converting room-local positions to world.
import * as THREE from 'three';
import { Rng, hash } from '../core/rng.js';
import { rollPool } from './pools.js';

const DEG = Math.PI / 180;

/**
 * Local → world transform for a room placed at `origin` (world x/z of its top-left corner)
 * and turned `quarterTurns` × 90° counter-clockwise (seen from above), keeping the turned
 * footprint's top-left at `origin`. widthM/depthM = un-turned room size in metres.
 */
export function makeRoomTransform(origin, quarterTurns = 0, widthM = 0, depthM = 0) {
  const q = ((quarterTurns % 4) + 4) % 4;
  return {
    q,
    point(local) {
      const [x, y, z] = local;
      let wx, wz;
      switch (q) {
        case 0: wx = x; wz = z; break;
        case 1: wx = z; wz = widthM - x; break;          // 90° CCW
        case 2: wx = widthM - x; wz = depthM - z; break;
        case 3: wx = depthM - z; wz = x; break;
      }
      return new THREE.Vector3(origin.x + wx, y, origin.z + wz);
    },
    rot(localDeg = 0) { return localDeg * DEG + q * (Math.PI / 2); },
  };
}

/**
 * Populate one placed room.
 * @param room  room JSON
 * @param place { key, origin:{x,z}, quarterTurns, depth, zone, worldSeed }
 * @param objects ObjectSystem
 * @param pools content.pools
 * @param run   per-run state { spawnedUnique: Set, taken: Set<string> } (picked-up spot keys never respawn)
 */
export function populateRoom(room, place, objects, pools, run) {
  const widthM = room.layout[0].length * 2;
  const depthM = room.layout.length * 2;
  const xf = makeRoomTransform(place.origin, place.quarterTurns, widthM, depthM);
  const spawned = [];
  const roomSeed = hash(place.worldSeed, 'room', place.key);

  for (const [i, o] of (room.objects ?? []).entries()) {
    if (run.taken?.has(`${place.key}#${i}`)) continue; // fixed object removed for good this run
    const inst = objects.spawn(o.def, xf.point(o.pos), xf.rot(o.rot), { roomKey: place.key, fixed: i });
    if (inst) spawned.push(inst);
  }

  const ctx = { depth: place.depth ?? 0, zone: place.zone, spawnedUnique: run.spawnedUnique };
  for (const spot of room.spots ?? []) {
    const spotKey = `${place.key}/${spot.id}`;
    if (run.taken?.has(spotKey)) continue;
    // child seed per spot: adding a spot to a room never changes what other spots roll
    const rng = new Rng(hash(roomSeed, 'spot', spot.id));
    const ids = rollPool(spot.pool, pools, rng, ctx);
    ids.forEach((id, n) => {
      // multiple rolls on one spot fan out slightly so they don't overlap
      const off = n === 0 ? [0, 0] : [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)];
      const local = [spot.pos[0] + off[0], spot.pos[1], spot.pos[2] + off[1]];
      const inst = objects.spawn(id, xf.point(local), xf.rot(spot.rot ?? rng.range(0, 360)), { roomKey: place.key, spotKey });
      if (inst) spawned.push(inst);
    });
  }
  return spawned;
}
