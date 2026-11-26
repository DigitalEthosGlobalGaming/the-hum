// View-model material: the same PS1 treatment as the world (vertex snap to the low-res grid,
// affine UV warp, per-vertex light, 15-bit dither in the shared post pass) but lit by a single
// CPU-computed "light at the player" instead of world-space point lights, because the view-model
// lives in its own camera space. The view-model updates these uniforms once per frame.
import * as THREE from 'three';
import { shared } from '../render/ps1.js';

export const vmShared = {
  uVMAmbient: { value: new THREE.Color(0.12, 0.11, 0.09) },  // world ambient + soft fill
  uVMKeyColor: { value: new THREE.Color(0.5, 0.48, 0.4) },    // summed nearby light colour
  uVMKeyDir: { value: new THREE.Vector3(0.2, 0.9, 0.3).normalize() }, // view-space dir toward the light
  uVMFlash: { value: 0 },                                     // torch spill on the hands/items
};

const vert = /* glsl */`
uniform vec2 uSnap;
uniform vec3 uVMAmbient;
uniform vec3 uVMKeyColor;
uniform vec3 uVMKeyDir;
uniform float uVMFlash;
uniform float uEmissive;
varying vec2 vUvA;
varying float vW;
varying vec2 vUvP;
varying vec3 vLight;
void main() {
  vec4 vp = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  float ndl = max(dot(n, uVMKeyDir), 0.0);
  // torch spill: faces turned toward the eye catch a little warm bounce
  float spill = max(dot(n, normalize(vec3(0.0, 0.2, 1.0))), 0.0) * 0.6 + 0.4;
  vec3 light = uVMAmbient + uVMKeyColor * (ndl * 0.75 + 0.25) + vec3(1.0, 0.93, 0.78) * uVMFlash * spill;
  vLight = mix(light, vec3(1.0), uEmissive);
  vec4 cp = projectionMatrix * vp;
  if (cp.w > 0.005) {
    vec2 grid = uSnap * 0.5;
    cp.xy = floor(cp.xy / cp.w * grid + 0.5) / grid * cp.w;
  }
  gl_Position = cp;
  vUvP = uv;
  vUvA = uv * cp.w;
  vW = cp.w;
}`;

const frag = /* glsl */`
uniform sampler2D map;
uniform vec3 uTint;
uniform float uAffineVM;
varying vec2 vUvA;
varying float vW;
varying vec2 vUvP;
varying vec3 vLight;
void main() {
  vec2 uv = mix(vUvP, vUvA / vW, uAffineVM);
  vec4 tex = texture2D(map, uv);
  if (tex.a < 0.5) discard;
  gl_FragColor = vec4(tex.rgb * uTint * vLight, 1.0);
}`;

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

/** PS1 material for view-model meshes. affine: 0..1 warp (kept small, the hands are close). */
export function makeVMMaterial(texture = white, { tint = 0xffffff, emissive = 0, affine = 0.25, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSnap: shared.uSnap,
      ...vmShared,
      map: { value: texture || white },
      uTint: { value: new THREE.Color(tint) },
      uEmissive: { value: emissive },
      uAffineVM: { value: affine },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side,
  });
}

/** Swap every world PS1 material in a built mesh (objectSystem.buildMesh) for a view-model one. */
const swapCache = new Map();
export function toViewModel(root) {
  root.traverse((m) => {
    if (!m.isMesh) return;
    const src = m.material;
    let vm = swapCache.get(src);
    if (!vm) {
      const u = src.uniforms ?? {};
      vm = makeVMMaterial(u.map?.value, {
        tint: u.uTint?.value ?? 0xffffff, emissive: u.uEmissive?.value ?? 0, side: src.side,
      });
      swapCache.set(src, vm);
    }
    m.material = vm;
    m.frustumCulled = false;
  });
  return root;
}

/** Nearest-filtered CanvasTexture (PS1 look). linear=true for small handwriting that must stay legible. */
export function canvasTexture(canvas, linear = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
