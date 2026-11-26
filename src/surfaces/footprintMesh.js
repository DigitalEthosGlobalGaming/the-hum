// Wet footprints: one merged mesh (one draw call) holding every slot of a FootprintRing.
// Each print is a small flat quad with a 8×16 nearest-filtered shoe-sole mask. The material
// multiplies the floor below by a damp colour (wet carpet goes darker, it doesn't get paint on
// it), scaled by a per-vertex `aFade` (the print's alpha), and fades out with the fog. It uses
// the PS1 vertex shader (same snapping as the floor) and the shared decal depth bias.
import * as THREE from 'three';
import { makePS1Material, makeDecal } from '../render/ps1.js';

const PRINT_Y = 0.012; // just above the floor stain decals (0.01)

// Left sole, toe row first. '#' full, '+' half (worn tread), '.' none. The right foot mirrors it.
const SOLE = [
  '..+##+..',
  '.+####+.',
  '.######+',
  '+######+',
  '+##++##+',
  '.######+',
  '.+#####.',
  '..####..',
  '..+##...',
  '...##...',
  '..+##+..',
  '.+####+.',
  '.######.',
  '.##++##.',
  '.+####+.',
  '..+##+..',
];

/** RGBA bytes for the sole mask (alpha = mask; row 0 = heel, so v = 1 is the toe). */
export function soleMask() {
  const w = SOLE[0].length, h = SOLE.length;
  const data = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) {
    const row = SOLE[h - 1 - r];
    for (let c = 0; c < w; c++) {
      const a = row[c] === '#' ? 255 : row[c] === '+' ? 140 : 0;
      data.set([255, 255, 255, a], (r * w + c) * 4);
    }
  }
  return { data, w, h };
}

function soleTexture() {
  const { data, w, h } = soleMask();
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const fragmentShader = /* glsl */`
uniform sampler2D map;
uniform vec3 uWet;        // colour the floor is multiplied by at full strength
uniform float uDarkness;  // 0..1 how much of uWet applies at alpha 1
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUvP;
varying float vFogDepth;
varying float vFade;
void main() {
  float m = texture2D(map, vUvP).a * vFade * uDarkness;
  m *= 1.0 - smoothstep(uFogNear, uFogFar, vFogDepth);
  m = floor(m * 8.0 + 0.5) / 8.0;   // a few steps only: PS1 colour depth
  if (m <= 0.0) discard;
  gl_FragColor = vec4(mix(vec3(1.0), uWet, m), 1.0);
}`;

function footprintMaterial(tex, { color, darkness }) {
  const base = makePS1Material(tex); // borrow the PS1 vertex shader + shared uniforms
  const vertexShader = base.vertexShader
    .replace('void main() {', 'attribute float aFade;\nvarying float vFade;\nvoid main() {\n  vFade = aFade;');
  base.dispose();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...base.uniforms,
      uWet: { value: new THREE.Color(...color) },
      uDarkness: { value: darkness },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // result = floor colour × our colour
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  return makeDecal(mat);
}

export class FootprintMesh {
  /**
   * @param ring  FootprintRing (its capacity sets the buffer size)
   * @param opts  { size: [w, l], color: [r,g,b], darkness }
   */
  constructor(ring, { size = [0.13, 0.3], color = [0.42, 0.4, 0.33], darkness = 0.6 } = {}) {
    this.ring = ring;
    this.size = size;
    const n = ring.capacity;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 4 * 3);
    this.uv = new Float32Array(n * 4 * 2);
    this.fade = new Float32Array(n * 4);
    const nrm = new Float32Array(n * 4 * 3);
    const idx = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      for (let v = 0; v < 4; v++) nrm[(i * 4 + v) * 3 + 1] = 1;
      // corners: 0 heel-left, 1 heel-right, 2 toe-right, 3 toe-left (counter-clockwise from above)
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geometry = geo;
    this.texture = soleTexture();
    this.material = footprintMaterial(this.texture, { color, darkness });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'footprints';
    this.mesh.frustumCulled = false; // prints are spread over many rooms; one tiny draw anyway
    this.mesh.renderOrder = 1;
  }

  /** Rewrite changed slots' quads and every slot's fade. Call once per frame. */
  sync() {
    const dirty = this.ring.takeDirty();
    const [w, l] = this.size;
    for (const i of dirty) {
      const s = this.ring.slots[i];
      const o = i * 12;
      if (!s.alive) { this.pos.fill(0, o, o + 12); continue; }
      const c = Math.cos(s.rot), sn = Math.sin(s.rot);
      // local corners (x across, z along; toe at -z), rotated by rotation.y = rot
      const corners = [[-w / 2, l / 2], [w / 2, l / 2], [w / 2, -l / 2], [-w / 2, -l / 2]];
      corners.forEach(([lx, lz], k) => {
        this.pos[o + k * 3] = s.x + lx * c + lz * sn;
        this.pos[o + k * 3 + 1] = PRINT_Y;
        this.pos[o + k * 3 + 2] = s.z - lx * sn + lz * c;
      });
      // the mask is a left sole; mirror u for the right foot
      const u0 = s.side > 0 ? 1 : 0, u1 = 1 - u0;
      this.uv.set([u0, 0, u1, 0, u1, 1, u0, 1], i * 8);
    }
    for (const s of this.ring.slots) this.fade.fill(s.alive ? s.alpha : 0, s.i * 4, s.i * 4 + 4);
    const a = this.geometry.attributes;
    if (dirty.length) { a.position.needsUpdate = true; a.uv.needsUpdate = true; }
    a.aFade.needsUpdate = true;
    this.mesh.visible = this.ring.count > 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
