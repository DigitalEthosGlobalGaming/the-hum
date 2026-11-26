// Tiny 2D rigid-body sim on the XZ plane for props (no physics library, no Three.js).
// Bodies are circles or oriented boxes with velocity, spin and friction decay. They collide with
// solid world cells, static AABBs (desks…) and each other, and fall asleep when slow so a room
// full of props costs nothing. A body can also be briefly airborne (thrown): a simple Y velocity
// with gravity and floor bounces.
//
// Conventions match Three.js rotation.y: a body at angle `a` maps local (x, z) to world
//   x' = x·cos a + z·sin a,  z' = -x·sin a + z·cos a
// so its local +x axis is (cos a, -sin a) and local +z is (sin a, cos a). Spin `w` = da/dt.
// The velocity of a point at world offset r from the centre is v + w·(r.z, -r.x), and the
// matching 2D cross product (torque of impulse J at offset r) is cross(r, J) = r.z·J.x - r.x·J.z.

export const GRAVITY = 9.8;
const SLOP = 0.002;          // allowed penetration (m) before position correction
const CORRECT = 0.8;         // fraction of penetration fixed per step
const SLEEP_SPEED = 0.06;    // m/s
const SLEEP_SPIN = 0.12;     // rad/s
const SLEEP_TIME = 0.4;      // s below both before sleeping

const cross = (rx, rz, jx, jz) => rz * jx - rx * jz;

/**
 * Make a body. Shape: { shape:'circle', r } or { shape:'box', hx, hz }.
 * Material: mass (kg), friction (1/s exponential speed decay), stop (m/s² constant braking so
 * it really comes to rest), angFriction (1/s), restitution (0..1), straight (wheels: sideways
 * motion dies fast), grip (0..1 tangential friction in contacts; drives spin from glancing hits).
 */
export function makeBody(o = {}) {
  const b = {
    x: o.x ?? 0, z: o.z ?? 0, a: o.a ?? 0,
    vx: 0, vz: 0, w: 0,
    y: 0, vy: 0, airborne: false,
    shape: o.shape ?? 'circle',
    r: o.r ?? 0.3, hx: o.hx ?? 0.3, hz: o.hz ?? 0.3,
    mass: o.mass ?? 10,
    friction: o.friction ?? 2,
    stop: o.stop ?? 0.6,
    angFriction: o.angFriction ?? 2.5,
    restitution: o.restitution ?? 0.3,
    grip: o.grip ?? 0.3,
    straight: !!o.straight,
    sleeping: o.sleeping ?? true,
    sleepT: 0,
    moved: false,          // set once anything moved it (persist only these)
    carried: false,        // held by the player: skipped by the sim
    data: o.data ?? null,  // owner payload (the inst)
  };
  setMass(b, b.mass);
  return b;
}

export function setMass(b, mass) {
  b.mass = mass;
  b.invMass = mass > 0 ? 1 / mass : 0;
  const I = b.shape === 'circle' ? 0.5 * mass * b.r * b.r : (mass * ((2 * b.hx) ** 2 + (2 * b.hz) ** 2)) / 12;
  b.invI = I > 0 ? 1 / I : 0;
}

/** Bounding radius (for broad phase). */
export const boundR = (b) => (b.shape === 'circle' ? b.r : Math.hypot(b.hx, b.hz));

/** World AABB half extents of a body. */
export function aabbHalf(b) {
  if (b.shape === 'circle') return [b.r, b.r];
  const c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
  return [c * b.hx + s * b.hz, s * b.hx + c * b.hz];
}

export function wake(b) { b.sleeping = false; b.sleepT = 0; }
export const speedOf = (b) => Math.hypot(b.vx, b.vz);

// ------------------------------------------------------------------ narrow phase
// Every test returns a contact { nx, nz, depth, px, pz } with n pointing from B to A (moving A
// along +n separates them) and p a world contact point, or null.

function corners(b, out) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const ux = c, uz = -s, vx = s, vz = c;  // local x / z axes in world
  let i = 0;
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    out[i++] = b.x + ux * b.hx * sx + vx * b.hz * sz;
    out[i++] = b.z + uz * b.hx * sx + vz * b.hz * sz;
  }
  return out;
}

function pointInBox(b, px, pz, pad = 1e-6) {
  const dx = px - b.x, dz = pz - b.z;
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad;
}

export function circleCircle(A, B) {
  const dx = A.x - B.x, dz = A.z - B.z;
  const d2 = dx * dx + dz * dz, R = A.r + B.r;
  if (d2 >= R * R) return null;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 1, nz = d > 1e-9 ? dz / d : 0;
  return { nx, nz, depth: R - d, px: B.x + nx * B.r, pz: B.z + nz * B.r };
}

/** Circle A vs box B. `open` (optional) = which of B's faces may push: {px,nx,pz,nz} booleans (for wall cells). */
export function circleBox(A, B, open = null) {
  const c = Math.cos(B.a), s = Math.sin(B.a);
  const dx = A.x - B.x, dz = A.z - B.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;     // A centre in B's local frame
  const cx = Math.max(-B.hx, Math.min(B.hx, lx));
  const cz = Math.max(-B.hz, Math.min(B.hz, lz));
  let nlx, nlz, depth, qx = cx, qz = cz;
  const ox = lx - cx, oz = lz - cz;
  const d2 = ox * ox + oz * oz;
  if (d2 > 1e-12) {
    if (d2 >= A.r * A.r) return null;
    const d = Math.sqrt(d2);
    nlx = ox / d; nlz = oz / d; depth = A.r - d;
  } else {
    // centre inside: push out through the nearest (open) face
    const faces = [
      [B.hx - lx, 1, 0, 'px'], [lx + B.hx, -1, 0, 'nx'], [B.hz - lz, 0, 1, 'pz'], [lz + B.hz, 0, -1, 'nz'],
    ].sort((p, q) => p[0] - q[0]);
    const f = faces.find((f) => !open || open[f[3]]) ?? faces[0];
    nlx = f[1]; nlz = f[2]; depth = f[0] + A.r;
    qx = nlx ? Math.sign(nlx) * B.hx : lx; qz = nlz ? Math.sign(nlz) * B.hz : lz;
  }
  // local → world (inverse of the rotation above)
  const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c;
  return { nx, nz, depth, px: B.x + qx * c + qz * s, pz: B.z - qx * s + qz * c };
}

const _ca = new Array(8), _cb = new Array(8);

/** Box A vs box B (SAT on the four face normals). `open` as in circleBox, for B axis-aligned cells. */
export function boxBox(A, B, open = null) {
  const axes = [];
  for (const b of [A, B]) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    axes.push([c, -s], [s, c]);
  }
  const dx = A.x - B.x, dz = A.z - B.z;
  const cand = [];
  for (const [ax, az] of axes) {
    const ra = projRadius(A, ax, az), rb = projRadius(B, ax, az);
    const dist = dx * ax + dz * az;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return null;
    const sg = dist >= 0 ? 1 : -1;
    cand.push([overlap, ax * sg, az * sg]);
  }
  cand.sort((p, q) => p[0] - q[0]);
  let pick = cand[0];
  if (open) {
    const ok = cand.find(([, nx, nz]) => faceOpen(open, nx, nz));
    if (ok) pick = ok;
  }
  const [depth, nx, nz] = pick;
  // contact point: average of corners inside the other box
  corners(A, _ca); corners(B, _cb);
  let sx = 0, sz = 0, n = 0;
  for (let i = 0; i < 8; i += 2) {
    if (pointInBox(B, _ca[i], _ca[i + 1], 0.01)) { sx += _ca[i]; sz += _ca[i + 1]; n++; }
    if (pointInBox(A, _cb[i], _cb[i + 1], 0.01)) { sx += _cb[i]; sz += _cb[i + 1]; n++; }
  }
  const px = n ? sx / n : (A.x + B.x) / 2, pz = n ? sz / n : (A.z + B.z) / 2;
  return { nx, nz, depth, px, pz };
}

function projRadius(b, ax, az) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return b.hx * Math.abs(c * ax - s * az) + b.hz * Math.abs(s * ax + c * az);
}

// A wall cell face is "open" if the neighbouring cell on that side is not solid. Pushing a body
// through a closed face would snag it on the seam between two wall cells.
function faceOpen(open, nx, nz) {
  if (Math.abs(nx) >= Math.abs(nz)) return nx > 0 ? open.px : open.nx;
  return nz > 0 ? open.pz : open.nz;
}

/** Any shape pair. A and B are bodies or static boxes { shape:'box', x, z, a, hx, hz }. */
export function collide(A, B, open = null) {
  if (A.shape === 'circle') {
    if (B.shape === 'circle') return circleCircle(A, B);
    return circleBox(A, B, open);
  }
  if (B.shape === 'circle') {
    const c = circleBox(B, A);
    if (!c) return null;
    c.nx = -c.nx; c.nz = -c.nz;
    return c;
  }
  return boxBox(A, B, open);
}

// ------------------------------------------------------------------ response

/**
 * Impulse + position correction between A (dynamic) and B (dynamic, or static when invMass = 0).
 * Returns the approach speed along the normal before the impulse (0 if separating).
 */
export function resolve(A, B, c, e) {
  const invA = A.invMass, invB = B.invMass ?? 0;
  const iA = A.invI ?? 0, iB = B.invI ?? 0;
  const sum = invA + invB;
  if (sum <= 0) return 0;
  // positional correction (split by inverse mass)
  const corr = (Math.max(c.depth - SLOP, 0) * CORRECT) / sum;
  A.x += c.nx * corr * invA; A.z += c.nz * corr * invA;
  if (invB) { B.x -= c.nx * corr * invB; B.z -= c.nz * corr * invB; }

  const rax = c.px - A.x, raz = c.pz - A.z;
  const rbx = c.px - B.x, rbz = c.pz - B.z;
  const vAx = A.vx + A.w * raz, vAz = A.vz - A.w * rax;
  const vBx = (B.vx ?? 0) + (B.w ?? 0) * rbz, vBz = (B.vz ?? 0) - (B.w ?? 0) * rbx;
  const rvx = vAx - vBx, rvz = vAz - vBz;
  const vn = rvx * c.nx + rvz * c.nz;
  if (vn >= 0) return 0;
  const raN = cross(rax, raz, c.nx, c.nz), rbN = cross(rbx, rbz, c.nx, c.nz);
  const k = sum + raN * raN * iA + rbN * rbN * iB;
  const j = (-(1 + e) * vn) / k;
  applyImpulse(A, c.nx * j, c.nz * j, rax, raz);
  if (invB) applyImpulse(B, -c.nx * j, -c.nz * j, rbx, rbz);

  // tangential friction (what makes a glancing hit spin a chair)
  const tx = rvx - vn * c.nx, tz = rvz - vn * c.nz;
  const tl = Math.hypot(tx, tz);
  const mu = Math.max(A.grip ?? 0.3, B.grip ?? 0);
  if (tl > 1e-6 && mu > 0) {
    const ux = tx / tl, uz = tz / tl;
    const raT = cross(rax, raz, ux, uz), rbT = cross(rbx, rbz, ux, uz);
    const kt = sum + raT * raT * iA + rbT * rbT * iB;
    const jt = Math.min(tl / kt, mu * j);
    applyImpulse(A, -ux * jt, -uz * jt, rax, raz);
    if (invB) applyImpulse(B, ux * jt, uz * jt, rbx, rbz);
  }
  return -vn;
}

/** Apply impulse (jx, jz) at world point (px, pz) and wake the body. */
export function impulse(b, jx, jz, px, pz) {
  wake(b);
  b.moved = true;
  applyImpulse(b, jx, jz, px - b.x, pz - b.z);
}

function applyImpulse(b, jx, jz, rx, rz) {
  b.vx += jx * b.invMass;
  b.vz += jz * b.invMass;
  b.w += (b.invI ?? 0) * cross(rx, rz, jx, jz);
}

// ------------------------------------------------------------------ the step

/**
 * Advance the awake bodies by dt.
 * @param {object[]} bodies   all bodies (sleeping ones only take part as obstacles)
 * @param {number} dt
 * @param {object} env  { isSolidAt(x,z), statics: [{minX,maxX,minZ,maxZ}], cell = 2 }
 * @param {object[]} [events] filled with { type:'impact'|'land'|'sleep', body, speed, x, z, with }
 * @returns events
 */
export function step(bodies, dt, env, events = []) {
  const cell = env.cell ?? 2;
  for (const b of bodies) {
    if (b.sleeping || b.carried) continue;
    integrate(b, dt, events);
  }
  // body vs body (pairs with at least one awake participant)
  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i];
    if (A.carried) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const B = bodies[j];
      if (B.carried || (A.sleeping && B.sleeping)) continue;
      if (Math.abs(A.y - B.y) > 0.4) continue; // one is flying over / sitting on a desk
      const R = boundR(A) + boundR(B);
      if (Math.abs(A.x - B.x) > R || Math.abs(A.z - B.z) > R) continue;
      const c = collide(A, B);
      if (!c) continue;
      wake(A); wake(B);
      const e = Math.min(A.restitution, B.restitution);
      const sp = resolve(A, B, c, e);
      A.moved = B.moved = true;
      if (sp > 0) events.push({ type: 'impact', body: A, other: B, speed: sp, x: c.px, z: c.pz, nx: c.nx, nz: c.nz, with: 'body' });
    }
  }
  // world: statics and wall cells
  for (const b of bodies) {
    if (b.sleeping || b.carried) continue;
    collideStatics(b, env.statics ?? [], events);
    collideCells(b, env.isSolidAt, cell, events);
    sleepCheck(b, dt, events);
  }
  return events;
}

function integrate(b, dt, events) {
  // friction: exponential decay plus a constant brake so it actually stops
  const grounded = !b.airborne;
  if (grounded) {
    if (b.straight) {
      // wheels: velocity sideways to the body's local z axis dies fast
      const fx = Math.sin(b.a), fz = Math.cos(b.a);
      const along = b.vx * fx + b.vz * fz;
      let side = b.vx * fz - b.vz * fx;     // component along local x (cos a, -sin a)
      side *= Math.exp(-10 * dt);
      b.vx = fx * along + fz * side;
      b.vz = fz * along - fx * side;
    }
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp * Math.exp(-b.friction * dt) - b.stop * dt);
      b.vx *= ns / sp; b.vz *= ns / sp;
    }
    const aw = Math.abs(b.w);
    if (aw > 0) {
      const nw = Math.max(0, aw * Math.exp(-b.angFriction * dt) - b.stop * 2 * dt);
      b.w = Math.sign(b.w) * nw;
    }
  }
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.a += b.w * dt;
  if (b.airborne) {
    b.vy -= GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y <= 0) {
      b.y = 0;
      const impact = -b.vy;
      const hs = Math.hypot(b.vx, b.vz);
      events.push({ type: 'land', body: b, speed: Math.hypot(impact, hs * 0.5), vy: impact, x: b.x, z: b.z, with: 'floor' });
      if (impact > 1.2) {
        b.vy = impact * b.restitution * 0.6;  // bounce
        b.vx *= 0.7; b.vz *= 0.7;
        b.w += (Math.random() - 0.5) * 6;     // a tumble on landing (cosmetic)
      } else {
        b.vy = 0;
        b.airborne = false;
      }
    }
  }
}

function collideStatics(b, statics, events) {
  if (b.y > 0.5) return; // on top of / flying over desks
  const [hx, hz] = aabbHalf(b);
  for (const s of statics) {
    if (b.x + hx < s.minX || b.x - hx > s.maxX || b.z + hz < s.minZ || b.z - hz > s.maxZ) continue;
    const box = staticBox(s);
    const c = collide(b, box);
    if (!c) continue;
    const sp = resolve(b, box, c, b.restitution);
    if (sp > 0) events.push({ type: 'impact', body: b, speed: sp, x: c.px, z: c.pz, nx: c.nx, nz: c.nz, with: 'static' });
  }
}

const _sb = { shape: 'box', x: 0, z: 0, a: 0, hx: 0, hz: 0, invMass: 0, invI: 0, vx: 0, vz: 0, w: 0, grip: 0 };
function staticBox(s) {
  _sb.x = (s.minX + s.maxX) / 2; _sb.z = (s.minZ + s.maxZ) / 2;
  _sb.hx = (s.maxX - s.minX) / 2; _sb.hz = (s.maxZ - s.minZ) / 2;
  return _sb;
}

const _open = { px: true, nx: true, pz: true, nz: true };
function collideCells(b, isSolidAt, cell, events) {
  if (!isSolidAt) return;
  for (let iter = 0; iter < 2; iter++) {
    const [hx, hz] = aabbHalf(b);
    const x0 = Math.floor((b.x - hx) / cell), x1 = Math.floor((b.x + hx) / cell);
    const z0 = Math.floor((b.z - hz) / cell), z1 = Math.floor((b.z + hz) / cell);
    let hit = false;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const mx = (cx + 0.5) * cell, mz = (cz + 0.5) * cell;
        if (!isSolidAt(mx, mz)) continue;
        _sb.x = mx; _sb.z = mz; _sb.hx = _sb.hz = cell / 2;
        _open.px = !isSolidAt(mx + cell, mz); _open.nx = !isSolidAt(mx - cell, mz);
        _open.pz = !isSolidAt(mx, mz + cell); _open.nz = !isSolidAt(mx, mz - cell);
        const c = collide(b, _sb, _open);
        if (!c) continue;
        hit = true;
        const sp = resolve(b, _sb, c, b.restitution);
        if (sp > 0) events.push({ type: 'impact', body: b, speed: sp, x: c.px, z: c.pz, nx: c.nx, nz: c.nz, with: 'wall' });
      }
    }
    if (!hit) break;
  }
}

/** Push one body out of walls and static props right now (used after the player shoves it). */
export function settleBody(b, env, events = null) {
  const ev = events ?? [];
  collideStatics(b, env.statics ?? [], ev);
  collideCells(b, env.isSolidAt, env.cell ?? 2, ev);
  return ev;
}

function sleepCheck(b, dt, events) {
  if (b.airborne) { b.sleepT = 0; return; }
  if (Math.hypot(b.vx, b.vz) < SLEEP_SPEED && Math.abs(b.w) < SLEEP_SPIN) {
    b.sleepT += dt;
    if (b.sleepT >= SLEEP_TIME) {
      b.sleeping = true;
      b.vx = b.vz = b.w = 0;
      events.push({ type: 'sleep', body: b, speed: 0, x: b.x, z: b.z });
    }
  } else b.sleepT = 0;
}

// ------------------------------------------------------------------ the player

/**
 * The player (a kinematic circle of mass `pm` at p with velocity pv) walks into body b.
 * Pushes the body (impulse at the contact point, so off-centre pushes spin it) and returns how
 * far to move the player back out, or null if they don't touch. Heavy bodies give way less:
 * the overlap is split by mass, so pushing a cart slows you down.
 * @returns {{ dx, dz, speed, nx, nz } | null}  speed = player speed into the body
 */
export function pushByPlayer(b, p, pv, pm) {
  if (b.carried || b.y > 0.5) return null; // in the air or up on a desk
  const P = { shape: 'circle', x: p.x, z: p.z, r: p.r };
  const c = collide(P, b);              // n from body to player
  if (!c) return null;
  const share = pm / (pm + b.mass);     // fraction of the overlap the body absorbs
  const corr = Math.max(c.depth - SLOP, 0);
  b.x -= c.nx * corr * share;
  b.z -= c.nz * corr * share;
  // impulse: player as a body of mass pm moving at pv, no bounce
  const rbx = c.px - b.x, rbz = c.pz - b.z;
  const vbx = b.vx + b.w * rbz, vbz = b.vz - b.w * rbx;
  const rvx = pv.x - vbx, rvz = pv.z - vbz;          // player relative to body
  const vn = -(rvx * c.nx + rvz * c.nz);             // closing speed (player moving along -n)
  const into = -(pv.x * c.nx + pv.z * c.nz);
  if (corr > 0 || vn > 0) { wake(b); b.moved = true; }
  if (vn > 0) {
    const nx = -c.nx, nz = -c.nz;                    // push direction (into the body)
    const rbN = cross(rbx, rbz, nx, nz);
    const k = 1 / pm + b.invMass + rbN * rbN * b.invI;
    // a person can only shove so hard: heavy bodies top out below walking speed, and the
    // overlap split above then holds the player back to the body's pace
    const vmax = Math.max(0, into) * Math.sqrt(share);
    const vb = b.vx * nx + b.vz * nz;
    const j = Math.min(vn / k, Math.max(0, (vmax - vb) * b.mass));
    applyImpulse(b, nx * j, nz * j, rbx, rbz);
    // sliding along the body's side drags it round (casters spin)
    const vtx = rvx - (rvx * nx + rvz * nz) * nx, vtz = rvz - (rvx * nx + rvz * nz) * nz;
    const tl = Math.hypot(vtx, vtz);
    if (tl > 1e-6 && b.grip > 0) {
      const ux = vtx / tl, uz = vtz / tl;
      const rbT = cross(rbx, rbz, ux, uz);
      const kt = 1 / pm + b.invMass + rbT * rbT * b.invI;
      const jt = Math.min(tl / kt, b.grip * j);
      applyImpulse(b, ux * jt, uz * jt, rbx, rbz);
    }
  }
  return { dx: c.nx * corr * (1 - share), dz: c.nz * corr * (1 - share), speed: Math.max(0, into), nx: -c.nx, nz: -c.nz, px: c.px, pz: c.pz };
}
