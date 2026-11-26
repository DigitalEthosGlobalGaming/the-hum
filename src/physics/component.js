// The `physics` component: gives an instance a 2D body (src/physics/sim.js) sized from its mesh.
// The physics system (src/physics/system.js) steps the bodies and moves the meshes; this file
// only creates and removes them. Static mode keeps today's behaviour (a solid AABB, if the object
// has a collider) and creates no body.
import * as THREE from 'three';
import { makeBody, setMass } from './sim.js';
import { physicsConfig } from './schema.js';

const box = new THREE.Box3();

/** Local-space bounds of an instance's mesh (as if it stood at the origin, unrotated). */
export function localBounds(root) {
  const p = root.position.clone(), r = root.rotation.y;
  root.position.set(0, 0, 0);
  root.rotation.y = 0;
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const out = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, maxY: box.max.y };
  root.position.copy(p);
  root.rotation.y = r;
  root.updateMatrixWorld(true);
  return out;
}

/** Fit a body's shape and centre offset to the mesh bounds (also after it toppled). */
export function fitBody(body, inst) {
  const b = localBounds(inst.root);
  const P = inst.physics;
  body.ox = (b.minX + b.maxX) / 2;
  body.oz = (b.minZ + b.maxZ) / 2;
  body.hx = Math.max(0.03, (b.maxX - b.minX) / 2);
  body.hz = Math.max(0.03, (b.maxZ - b.minZ) / 2);
  body.r = P.radius ?? Math.max(body.hx, body.hz) * 0.92;
  body.height = b.maxY;
  // world centre = root position + rotated offset
  const c = Math.cos(inst.root.rotation.y), s = Math.sin(inst.root.rotation.y);
  body.x = inst.root.position.x + body.ox * c + body.oz * s;
  body.z = inst.root.position.z - body.ox * s + body.oz * c;
  body.a = inst.root.rotation.y;
}

export const physicsComponent = {
  attach(inst, cfg, sys) {
    const P = (inst.physics = physicsConfig(cfg));
    if (!P.dynamic) return;
    const body = makeBody({
      shape: P.shape, mass: P.mass, friction: P.friction, stop: P.stop, restitution: P.restitution,
      grip: P.grip, angFriction: P.angFriction, straight: P.straight, data: inst,
    });
    fitBody(body, inst);
    setMass(body, P.mass); // inertia depends on the size, known only now
    body.y = inst.root.position.y;
    // (a can spawned on a desk keeps that height as its resting level until it's thrown)
    inst.body = body;
    // a dynamic body always has a collider (pick, highlight and player collision use it)
    if (!inst.collider) {
      inst.collider = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, inst };
      inst._ownCollider = true;
      sys.colliders.push(inst.collider);
    }
    inst.collider.body = body;
    inst.interactive = inst.interactive || P.canCarry; // push-only props become aimable when touched
    (sys.bodies ??= new Set()).add(inst);
    syncCollider(inst);
  },
  detach(inst, cfg, sys) {
    if (!inst.body) return;
    sys.bodies?.delete(inst);
    inst.body.removed = true;
    if (inst._ownCollider) {
      const i = sys.colliders.indexOf(inst.collider);
      if (i >= 0) sys.colliders.splice(i, 1);
    }
  },
};

/** Keep inst.collider (AABB) and inst.center in step with the body. */
export function syncCollider(inst) {
  const b = inst.body, c = inst.collider;
  if (!b || !c) return;
  let hx, hz;
  if (b.shape === 'circle') hx = hz = b.r;
  else {
    const co = Math.abs(Math.cos(b.a)), si = Math.abs(Math.sin(b.a));
    hx = co * b.hx + si * b.hz; hz = si * b.hx + co * b.hz;
  }
  c.minX = b.x - hx; c.maxX = b.x + hx; c.minZ = b.z - hz; c.maxZ = b.z + hz;
  inst.center?.set?.(b.x, b.y + (b.height ?? 0.5) / 2, b.z);
}
