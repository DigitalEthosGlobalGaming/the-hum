// The Tenant's body: a tall (≈2.4 m), thin, stooped low-poly figure built from boxes, with long
// arms and a featureless head carrying a faint pale face. PS1 material (vertex snap, affine UVs,
// dither) like everything else, tinted so dark it never reads as lit. Its fog starts later than
// the world's so a far glimpse still reads as a silhouette at the end of a corridor.
// It has no animation: it is never seen moving. Only its head tilt changes between appearances.
import * as THREE from 'three';
import { makePS1Material, shared } from '../render/ps1.js';
import { registerPainters } from '../objects/procTextures.js';

registerPainters({
  // mottled, dull: the tint makes it near black, this only keeps it from looking like a hole
  tenant_skin(g, rng) {
    g.fillStyle = '#6a665e'; g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 260; i++) {
      const v = rng.int(70, 120);
      g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.5)`;
      g.fillRect(rng.int(0, 31), rng.int(0, 31), 1, rng.int(1, 3));
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 6; i++) g.fillRect(rng.int(0, 31), 0, 1, 32); // long creases
    return [32, 32];
  },
  // a pale, smooth face with nothing quite where it should be: two soft hollows set too low and
  // too far apart, a faint vertical seam. No eyes, no mouth, nothing wet.
  tenant_face(g, rng) {
    g.fillStyle = '#151412'; g.fillRect(0, 0, 32, 40);
    g.fillStyle = '#c9c2b0';
    g.beginPath(); g.ellipse(16, 19, 12, 17, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 140; i++) {
      g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
      g.fillRect(rng.int(5, 27), rng.int(3, 36), 1, 1);
    }
    const hollow = (x, y) => {
      const grd = g.createRadialGradient(x, y, 0.5, x, y, 5);
      grd.addColorStop(0, 'rgba(40,36,30,0.75)');
      grd.addColorStop(1, 'rgba(40,36,30,0)');
      g.fillStyle = grd; g.fillRect(x - 6, y - 6, 12, 12);
    };
    hollow(9, 22); hollow(23, 23);
    g.fillStyle = 'rgba(60,55,48,0.25)'; g.fillRect(16, 6, 1, 28);   // seam
    g.fillStyle = 'rgba(60,55,48,0.18)'; g.fillRect(10, 31, 12, 1);  // where a mouth isn't
    return [32, 40];
  },
});

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Build the figure. Returns { root, head, materials }. Local +z is its front; feet at y = 0. */
export function buildTenant(textures) {
  const body = makePS1Material(textures.get('proc:tenant_skin'), { tint: 0x1d1b18 });
  const face = makePS1Material(textures.get('proc:tenant_face'), { tint: 0xb4ae9e, emissive: 0.45 });
  const far = shared.uFogFar.value;
  for (const m of [body, face]) {
    // own fog range (the world's fog swallows everything past ~22 m)
    m.uniforms.uFogNear = { value: far * 0.9 };
    m.uniforms.uFogFar = { value: far * 2.6 };
  }
  const root = new THREE.Group();
  root.name = 'tenant';
  box(0.11, 1.26, 0.11, body, -0.1, 0.63, 0, root);
  box(0.11, 1.26, 0.11, body, 0.1, 0.63, 0, root);
  box(0.3, 0.16, 0.16, body, 0, 1.3, 0, root);

  const upper = new THREE.Group();
  upper.position.y = 1.36;
  upper.rotation.x = 0.24; // stoop
  root.add(upper);
  box(0.28, 0.62, 0.15, body, 0, 0.31, 0, upper);
  box(0.42, 0.13, 0.17, body, 0, 0.56, 0, upper);
  const neck = box(0.07, 0.2, 0.07, body, 0, 0.7, 0.03, upper);
  neck.rotation.x = 0.3;

  const head = new THREE.Group();
  head.position.set(0, 0.79, 0.08);
  head.rotation.set(0.28, 0, 0.12);
  upper.add(head);
  box(0.19, 0.28, 0.2, body, 0, 0.14, 0, head);
  box(0.15, 0.21, 0.012, face, 0, 0.13, 0.102, head);

  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(side * 0.23, 0.54, 0);
    sh.rotation.set(-0.2, 0, side * 0.07);
    upper.add(sh);
    box(0.065, 0.64, 0.065, body, 0, -0.32, 0, sh);
    const el = new THREE.Group();
    el.position.y = -0.64;
    el.rotation.x = -0.14;
    sh.add(el);
    box(0.055, 0.62, 0.055, body, 0, -0.31, 0, el);
    box(0.085, 0.2, 0.03, body, 0, -0.71, 0, el);
    for (let f = -1; f <= 1; f++) box(0.014, 0.16, 0.014, body, f * 0.026, -0.88, 0, el);
  }
  root.visible = false;
  return { root, head, materials: [body, face] };
}

/** Yaw (0 = facing -z) → the figure's rotation.y (its front is local +z). */
export const figureRotation = (yaw) => yaw + Math.PI;
