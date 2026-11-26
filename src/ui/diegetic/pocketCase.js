// The pocket case: a small battered vinyl suitcase (PS1 low-poly) that the pockets view opens in
// front of you. Pure geometry + the animated parts; the logic lives in pockets.js.
//
// Case-local frame: X right, Y up out of the lining, Z toward the player (near edge at +D/2).
// The lid hinges on the far edge; the torch is clipped across the inside of the lid.
import * as THREE from 'three';
import { box } from '../../viewmodel/viewModel.js';
import { makeVMMaterial } from '../../viewmodel/vmMaterial.js';
import { makeDecal } from '../../render/ps1.js';

export const CASE = {
  W: 0.44, D: 0.22, H: 0.048, T: 0.012, // outer width / depth / wall height / wall thickness
  LH: 0.034,                              // lid depth
  FLOOR: 0.014,                           // lining surface height
  SLOTS: 4,
};
CASE.IW = CASE.W - 2 * CASE.T;
CASE.ID = CASE.D - 2 * CASE.T;
CASE.CW = CASE.IW / CASE.SLOTS;
/** Centre x of compartment i. */
export const slotX = (i) => -CASE.IW / 2 + CASE.CW * (i + 0.5);
export const ITEM_Z = -0.008;   // item centre (z) in a compartment
export const BAND_Z = 0.05;     // the elastic band across the near end of each compartment
export const LID_OPEN = 1.92;   // radians the lid swings back

/** Repeat a mesh's texture (u by nu, v by nv) so texels stay small on big panels. */
function tile(mesh, nu, nv = nu) {
  const uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * nu, uv.getY(i) * nv);
  return mesh;
}

function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

/** A flat decal quad lying in the XZ plane (facing +Y), polygon-offset so it never z-fights. */
function flatDecal(w, d, tex, opts, repeat = [1, 1]) {
  const mat = makeDecal(makeVMMaterial(tex, opts));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
  m.frustumCulled = false;
  return tile(m, repeat[0], repeat[1]);
}

/** Four walls of an open box (outer w × d, height h), bottom at y = 0. */
function walls(group, w, d, h, t, tex, opts) {
  const make = (bw, bd, x, z, n) => group.add(at(tile(box(bw, h, bd, tex, opts), n, 1), x, h / 2, z));
  make(w, t, 0, d / 2 - t / 2, 6);
  make(w, t, 0, -d / 2 + t / 2, 6);
  make(t, d - 2 * t, -w / 2 + t / 2, 0, 3);
  make(t, d - 2 * t, w / 2 - t / 2, 0, 3);
}

export function buildCase(textures) {
  const { W, D, H, T, LH, FLOOR, IW, ID, CW } = CASE;
  const leather = textures.get('proc:leather');
  const lining = textures.get('proc:lining');
  const brass = textures.get('proc:brass');
  const stitch = textures.get('proc:stitch');
  const elastic = textures.get('proc:elastic');

  const root = new THREE.Group();
  const base = new THREE.Group();
  root.add(base);

  // ── base shell ──
  base.add(at(tile(box(W, FLOOR - 0.004, D, leather), 6, 3), 0, (FLOOR - 0.004) / 2, 0));
  walls(base, W, D, H, T, leather);
  // rim piping, a shade darker, a hair proud of the walls
  const pipe = { tint: 0x7a6656 };
  base.add(at(tile(box(W + 0.004, 0.006, 0.016, leather, pipe), 8, 1), 0, H, D / 2 - T / 2));
  base.add(at(tile(box(W + 0.004, 0.006, 0.016, leather, pipe), 8, 1), 0, H, -D / 2 + T / 2));
  for (const s of [-1, 1]) base.add(at(box(0.016, 0.006, D - 0.02, leather, pipe), s * (W / 2 - T / 2), H, 0));

  // ── lining: floor, wall facings, dividers ──
  base.add(at(tile(box(IW, 0.004, ID, lining), 5, 2.5), 0, FLOOR - 0.002, 0));
  const face = { tint: 0xa8b09a };
  base.add(at(tile(box(IW, H - FLOOR, 0.003, lining, face), 5, 0.6), 0, FLOOR + (H - FLOOR) / 2, D / 2 - T - 0.0015));
  base.add(at(tile(box(IW, H - FLOOR, 0.003, lining, face), 5, 0.6), 0, FLOOR + (H - FLOOR) / 2, -D / 2 + T + 0.0015));
  const dividers = [];
  for (let i = 1; i < CASE.SLOTS; i++) {
    const d = at(tile(box(0.006, H - FLOOR - 0.01, ID, lining, { tint: 0x8a9480 }), 0.3, 2), -IW / 2 + CW * i, FLOOR + (H - FLOOR - 0.01) / 2, 0);
    base.add(d);
    dividers.push(d);
  }
  // stitching along the lining's near and far edges (decals)
  for (const z of [ID / 2 - 0.008, -ID / 2 + 0.008]) base.add(at(flatDecal(IW - 0.01, 0.0035, stitch, {}, [12, 1]), 0, FLOOR + 0.0002, z));

  // per compartment: a worn lighter patch (shown under the item in hand) + an elastic band
  const patches = [];
  const bands = [];
  for (let i = 0; i < CASE.SLOTS; i++) {
    const p = at(flatDecal(CW - 0.014, ID - 0.03, lining, { tint: 0xd8e0b8 }, [1.2, 1.6]), slotX(i), FLOOR + 0.0002, -0.004);
    p.visible = false;
    base.add(p);
    patches.push(p);
    const band = new THREE.Group();
    band.position.set(slotX(i), FLOOR, BAND_Z);
    band.add(at(tile(box(CW - 0.008, 0.004, 0.016, elastic, {}), 3, 1), 0, 0.011, 0));
    for (const s of [-1, 1]) band.add(at(box(0.004, 0.011, 0.016, elastic, {}), s * (CW / 2 - 0.006), 0.006, 0));
    base.add(band);
    bands.push(band);
  }

  // ── brass corners ──
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    base.add(at(box(0.02, 0.022, 0.02, brass), sx * (W / 2 - 0.007), 0.011, sz * (D / 2 - 0.007)));
  }

  // ── handle on the near wall + luggage tag string ──
  const handle = new THREE.Group();
  handle.position.set(0, H * 0.45, D / 2);
  for (const s of [-1, 1]) {
    handle.add(at(box(0.016, 0.014, 0.022, brass), s * 0.055, 0, 0.011));
  }
  handle.add(at(tile(box(0.13, 0.017, 0.016, leather, { tint: 0x8a6a58 }), 3, 1), 0, 0, 0.03));
  base.add(handle);
  // luggage tag on a string from the near right corner (the card itself is drawn on the text layer)
  const tagAnchor = new THREE.Object3D();
  tagAnchor.position.set(W / 2 + 0.045, -0.012, D / 2 - 0.03);
  const from = new THREE.Vector3(W / 2 + 0.002, 0.016, D / 2 - 0.004);
  const string = box(0.0025, 0.0025, 1, null, { tint: 0xcbbf98 });
  string.scale.z = from.distanceTo(tagAnchor.position);
  string.position.copy(from).add(tagAnchor.position).multiplyScalar(0.5);
  string.lookAt(tagAnchor.position); // no parent yet, so this is base-local
  base.add(string, tagAnchor);

  // ── latches: a plate on the near wall, a hasp that flips down as the case opens ──
  const hasps = [];
  for (const s of [-1, 1]) {
    base.add(at(box(0.034, 0.024, 0.004, brass), s * 0.15, H - 0.016, D / 2 + 0.002));
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.15, H - 0.006, D / 2 + 0.006);
    pivot.add(at(box(0.024, 0.032, 0.004, brass, { tint: 0xd8c080 }), 0, 0.016, 0));
    base.add(pivot);
    hasps.push(pivot);
  }

  // ── lid (pivot on the far top edge) ──
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  root.add(lid);
  const shell = new THREE.Group();
  lid.add(shell);
  shell.position.z = D / 2;   // lid-local: spans z 0..D when closed, the hinge at z = 0
  shell.add(at(tile(box(W, 0.008, D, leather), 6, 3), 0, LH - 0.004, 0));
  const lidWalls = new THREE.Group();
  walls(lidWalls, W, D, LH - 0.008, T, leather);
  shell.add(lidWalls);
  shell.add(at(tile(box(W + 0.004, 0.006, 0.016, leather, pipe), 8, 1), 0, 0, D / 2 - T / 2));
  shell.add(at(tile(box(W + 0.004, 0.006, 0.016, leather, pipe), 8, 1), 0, 0, -D / 2 + T / 2));
  // inner lining (faces -Y when closed: toward the player once the lid swings back)
  shell.add(at(tile(box(IW, 0.003, ID, lining), 5, 2.5), 0, LH - 0.0095, 0));
  const flip = (m) => { m.rotation.x = Math.PI; return m; }; // decals facing the lining side
  for (const z of [ID / 2 - 0.008, -ID / 2 + 0.008]) shell.add(at(flip(flatDecal(IW - 0.01, 0.0035, stitch, {}, [12, 1])), 0, LH - 0.0112, z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    shell.add(at(box(0.02, 0.02, 0.02, brass), sx * (W / 2 - 0.007), LH - 0.01, sz * (D / 2 - 0.007)));
  }
  // latch catches on the lid's free edge
  for (const s of [-1, 1]) shell.add(at(box(0.028, 0.01, 0.004, brass), s * 0.15, 0.008, D / 2 + 0.002));

  // torch clip: lying sideways across the lid lining, held by two leather straps with brass studs
  const torchMount = new THREE.Group();
  torchMount.position.set(0.07, LH - 0.026, -0.005);
  shell.add(torchMount);
  const clips = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = new THREE.Group();
    c.position.set(s * 0.032, -0.0125, 0);
    c.add(at(tile(box(0.011, 0.003, 0.046, leather, { tint: 0xc09a7a }), 1, 2), 0, 0, 0));
    for (const e of [-1, 1]) c.add(at(box(0.008, 0.006, 0.008, brass), 0, 0.006, e * 0.022));
    clips.add(c);
  }
  torchMount.add(clips);

  return { root, base, lid, shell, dividers, patches, bands, hasps, torchMount, tagAnchor, handle };
}
