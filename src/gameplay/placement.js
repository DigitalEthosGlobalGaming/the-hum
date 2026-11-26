// Where things go in the world: drop points and "what surface is in front of me".
// Pure maths over plain {x,y,z} + a solid(x, z) callback (world.isSolidAt), so it is Node-testable.

/**
 * Floor point about `dist` metres in front of the player that isn't inside a wall.
 * Walks back toward the player if the spot (or the path to it) is solid.
 * @param {{x,y,z}} feet  player feet position
 * @param {number} yaw    player yaw (forward = (-sin yaw, -cos yaw))
 * @param {(x:number,z:number)=>boolean} solid
 * @returns {{x,y,z}}
 */
export function dropPoint(feet, yaw, solid, dist = 0.8, margin = 0.15) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (let d = dist; d >= 0.2; d -= 0.1) {
    const x = feet.x + fx * d, z = feet.z + fz * d;
    // keep a small margin so the item doesn't clip into the wall face
    const clear = !solid(x, z) && !solid(x + fx * margin, z + fz * margin) && !pathBlocked(feet, { x, z }, solid);
    if (clear) return { x, y: feet.y, z };
  }
  return { x: feet.x, y: feet.y, z: feet.z };
}

function pathBlocked(a, b, solid) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
  for (let i = 1; i <= n; i++) if (solid(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n)) return true;
  return false;
}

/**
 * March a ray from the eye and report the first wall or floor it meets.
 * @param {{x,y,z}} eye   ray origin
 * @param {{x,y,z}} dir   unit direction
 * @param {(x,z)=>boolean} solid
 * @param {object} [o]  { maxDist = 2, floorY = 0, step = 0.05 }
 * @returns {{ surface: 'wall'|'floor', point:{x,y,z}, normal:{x,y,z}, distance } | null}
 */
export function castSurface(eye, dir, solid, { maxDist = 2, floorY = 0, step = 0.05 } = {}) {
  let prev = { ...eye };
  for (let t = step; t <= maxDist + 1e-6; t += step) {
    const p = { x: eye.x + dir.x * t, y: eye.y + dir.y * t, z: eye.z + dir.z * t };
    if (p.y <= floorY) {
      // interpolate to the exact floor crossing
      const k = dir.y !== 0 ? (floorY - eye.y) / dir.y : t;
      return { surface: 'floor', point: { x: eye.x + dir.x * k, y: floorY, z: eye.z + dir.z * k }, normal: { x: 0, y: 1, z: 0 }, distance: k };
    }
    if (solid(p.x, p.z)) {
      // bisect between the last open point and this solid one for the wall face
      let lo = prev, hi = p;
      for (let i = 0; i < 10; i++) {
        const mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
        if (solid(mid.x, mid.z)) hi = mid; else lo = mid;
      }
      // which axis did we cross? test the hit point with only x moved, then only z
      const crossX = solid(hi.x, lo.z);
      const crossZ = solid(lo.x, hi.z);
      let normal;
      if (crossX && !crossZ) normal = { x: -Math.sign(dir.x) || 1, y: 0, z: 0 };
      else if (crossZ && !crossX) normal = { x: 0, y: 0, z: -Math.sign(dir.z) || 1 };
      else normal = Math.abs(dir.x) > Math.abs(dir.z) ? { x: -Math.sign(dir.x), y: 0, z: 0 } : { x: 0, y: 0, z: -Math.sign(dir.z) };
      const distance = Math.hypot(lo.x - eye.x, lo.y - eye.y, lo.z - eye.z);
      return { surface: 'wall', point: lo, normal, distance };
    }
    prev = p;
  }
  return null;
}

/** Y rotation that turns a plane facing -z (rot 0) to face along horizontal normal n. */
export function yawFacing(n) { return Math.atan2(-n.x, -n.z); }
