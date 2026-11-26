// What the player can see of the Tenant, and where it may stand. Pure maths over a `view`
// ({ eye:{x,y,z}, yaw, pitch, hHalf, vHalf } in radians; yaw 0 looks down -z, pitch > 0 looks up)
// and a world with isSolidAt / wallBetween. Cheap → expensive: distance, then the view cone,
// then line-of-sight rays (only for points inside the cone).
const TAU = Math.PI * 2;
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };

export const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/** Angle of the horizontal direction (dx, dz) in the yaw convention (0 = -z, + turns left). */
export const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

/**
 * Is a figure standing at (x, z), `height` tall and `halfWidth` wide, inside the view cone?
 * Writes { angle (horizontal off-centre, rad), centre (3D angle from view centre to its chest), dist }
 * into `out` and returns out.inCone.
 */
export function coneTest(view, x, z, height, halfWidth, out) {
  const dx = x - view.eye.x, dz = z - view.eye.z;
  const h = Math.hypot(dx, dz);
  out.dist = h;
  if (h < 0.35) { out.angle = 0; out.centre = 0; out.inCone = true; return true; }
  const ang = Math.abs(wrapAngle(yawOf(dx, dz) - view.yaw));
  out.angle = ang;
  const margin = Math.atan(halfWidth / h);
  // vertical: does any of its height [0, height] fall inside [pitch - vHalf, pitch + vHalf]?
  const eFeet = Math.atan2(-view.eye.y, h), eHead = Math.atan2(height - view.eye.y, h);
  const inV = eHead >= view.pitch - view.vHalf - margin && eFeet <= view.pitch + view.vHalf + margin;
  out.inCone = ang <= view.hHalf + margin && inV;
  // angle between the view direction and the direction to its chest
  const cp = Math.cos(view.pitch);
  const fx = -Math.sin(view.yaw) * cp, fy = Math.sin(view.pitch), fz = -Math.cos(view.yaw) * cp;
  const ty = height * 0.7 - view.eye.y;
  const len = Math.hypot(dx, ty, dz);
  out.centre = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fy * ty + fz * dz) / len)));
  return out.inCone;
}

/**
 * Line of sight from the eye to a figure at (x, z): its centre line or either shoulder edge.
 * Walls are full height, so this is a 2D test (props don't block).
 */
export function losTo(world, eye, x, z, halfWidth = 0.3) {
  _a.x = eye.x; _a.z = eye.z;
  _b.x = x; _b.z = z;
  if (!world.wallBetween(_a, _b)) return true;
  const dx = x - eye.x, dz = z - eye.z, l = Math.hypot(dx, dz) || 1;
  const px = (-dz / l) * halfWidth, pz = (dx / l) * halfWidth;
  _b.x = x + px; _b.z = z + pz;
  if (!world.isSolidAt(_b.x, _b.z) && !world.wallBetween(_a, _b)) return true;
  _b.x = x - px; _b.z = z - pz;
  return !world.isSolidAt(_b.x, _b.z) && !world.wallBetween(_a, _b);
}

const _cone = { inCone: false, angle: 0, centre: 0, dist: 0 };
/** Would a figure at (x, z) be visible right now (in the cone and in line of sight)? */
export function visibleAt(world, view, x, z, height = 2.4, halfWidth = 0.35) {
  if (!coneTest(view, x, z, height, halfWidth, _cone)) return false;
  return losTo(world, view.eye, x, z, halfWidth);
}

/** A spot the figure can stand on: walkable with ~0.45 m clearance on every side. */
export function standable(world, x, z, r = 0.45) {
  return !world.isSolidAt(x, z) && !world.isSolidAt(x + r, z) && !world.isSolidAt(x - r, z)
    && !world.isSolidAt(x, z + r) && !world.isSolidAt(x, z - r);
}

/**
 * A glimpse spot: the far end of a long, clear sightline from the player.
 * opts: { minD, maxD, mode: 'side' (outside the view cone) | 'behind' (in the back cone) | 'any',
 *         behindCone (rad, half-angle of the back cone), dirs, step }
 * The spot is never inside the current view cone (it must not pop in where you are looking),
 * and is always in line of sight of the eye (that is how the sightline was found).
 * Returns true and writes { x, z, d, rel } to `out`, or false.
 */
export function findGlimpseSpot(world, view, rng, opts, out) {
  const { minD = 25, maxD = 40, mode = 'side', behindCone = 0.7, dirs = 360, step = 0.5 } = opts;
  const eye = view.eye;
  let best = -1, bx = 0, bz = 0, bd = 0, brel = 0;
  const off = rng.next() * (TAU / dirs);
  for (let i = 0; i < dirs; i++) {
    const a = off + (i * TAU) / dirs;
    const rel = Math.abs(wrapAngle(a - view.yaw));
    if (mode === 'behind' && rel < Math.PI - behindCone) continue;
    if (mode === 'side' && rel < view.hHalf + 0.25) continue;
    const dx = -Math.sin(a), dz = -Math.cos(a);
    let free = 0;
    for (let d = step; d <= maxD + 1; d += step) {
      if (world.isSolidAt(eye.x + dx * d, eye.z + dz * d)) break;
      free = d;
    }
    // stand a little short of the far wall, but not past maxD
    let d = Math.min(maxD, free - 0.8);
    while (d >= minD && !standable(world, eye.x + dx * d, eye.z + dz * d)) d -= step;
    if (d < minD) continue;
    const x = eye.x + dx * d, z = eye.z + dz * d;
    if (visibleAt(world, view, x, z)) continue;
    // prefer long sightlines, with some randomness so it isn't always the same corridor
    // (and lit spots: a black figure under a working tube reads at 40 m; in the dark it would not)
    const score = d + rng.next() * 6 + (opts.light ? opts.light(x, z) * 25 : 0);
    if (score > best) { best = score; bx = x; bz = z; bd = d; brel = rel; }
  }
  if (best < 0) return false;
  out.x = bx; out.z = bz; out.d = bd; out.rel = brel;
  return true;
}
