// PS1-style rendering: low-res target, vertex snapping, affine UVs,
// per-vertex point lights, per-fragment flashlight, 15-bit colour + Bayer dither.
import * as THREE from 'three';

export const MAX_LIGHTS = 12;

// One shared uniform set: every PS1 material references these same objects,
// so updating them once per frame updates every material.
export const shared = {
  uSnap: { value: new THREE.Vector2(320, 240) },
  uAmbient: { value: new THREE.Color(0.10, 0.09, 0.07) },
  uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
  uLightColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
  uLightRange: { value: new Array(MAX_LIGHTS).fill(1) },
  uLightCount: { value: 0 },
  uFogColor: { value: new THREE.Color(0.06, 0.055, 0.035) },
  uFogNear: { value: 4 },
  uFogFar: { value: 22 },
  uFlashPos: { value: new THREE.Vector3() },
  uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
  uFlashOn: { value: 1 },
  uFlashCos: { value: Math.cos(THREE.MathUtils.degToRad(24)) },
  uFlashRange: { value: 14 },
  uAffine: { value: 0.7 }, // 0 = perspective-correct, 1 = full PS1 warp
  uAffineNear: { value: 1.0 }, // warp fades in between these view depths (m),
  uAffineFar: { value: 4.0 },  // so walls you're standing beside don't smear
};

const vertexShader = /* glsl */`
#define MAX_LIGHTS ${MAX_LIGHTS}
uniform vec2 uSnap;
uniform vec3 uAmbient;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform float uLightRange[MAX_LIGHTS];
uniform int uLightCount;
uniform float uEmissive;
#ifdef USE_LIT
attribute float aLit;   // per-vertex fixture output 0..1 (power network: on / flicker / dead)
varying float vLit;
#endif
varying vec2 vUvA;      // uv * w, divided per-fragment → affine interpolation
varying float vW;
varying vec2 vUvP;      // perspective-correct uv
varying vec3 vLight;
varying float vFogDepth;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 light = uAmbient;
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    vec3 d = uLightPos[i] - wp.xyz;
    float dist = max(length(d), 0.001);
    float att = clamp(1.0 - dist / uLightRange[i], 0.0, 1.0);
    att *= att;
    float ndl = max(dot(n, d / dist), 0.0) * 0.6 + 0.4;
    light += uLightColor[i] * att * ndl;
  }
#ifdef USE_LIT
  vLit = aLit;
  vLight = mix(light, vec3(1.0), uEmissive * aLit);
#else
  vLight = mix(light, vec3(1.0), uEmissive);
#endif
  vec4 vp = viewMatrix * wp;
  vFogDepth = -vp.z;
  vec4 cp = projectionMatrix * vp;
  if (cp.w > 0.05) {               // snap only in front of the camera (avoids near-plane explosions)
    vec2 grid = uSnap * 0.5;
    cp.xy = floor(cp.xy / cp.w * grid + 0.5) / grid * cp.w;
  }
  gl_Position = cp;
  vUvP = uv;
  vUvA = uv * cp.w;
  vW = cp.w;
  vWorldPos = wp.xyz;
  vNormal = n;
}`;

const fragmentShader = /* glsl */`
uniform sampler2D map;
#ifdef USE_LIT
uniform sampler2D mapOff;   // texture for a dark fixture
varying float vLit;
#endif
uniform vec3 uTint;
uniform float uEmissive;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform float uFlashOn;
uniform float uFlashCos;
uniform float uFlashRange;
uniform float uAffine;
uniform float uAffineNear;
uniform float uAffineFar;
varying vec2 vUvA;
varying float vW;
varying vec2 vUvP;
varying vec3 vLight;
varying float vFogDepth;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec2 uv = mix(vUvP, vUvA / vW, uAffine * smoothstep(uAffineNear, uAffineFar, vFogDepth));
  vec4 tex = texture2D(map, uv);
  float emis = uEmissive;
#ifdef USE_LIT
  tex = mix(texture2D(mapOff, uv), tex, clamp(vLit * 4.0, 0.0, 1.0));
  emis *= vLit;
#endif
  if (tex.a < 0.5) discard;
  vec3 light = vLight;
  // Flashlight is per-fragment so the beam reads clearly on big low-poly faces.
  vec3 d = vWorldPos - uFlashPos;
  float dist = max(length(d), 0.001);
  vec3 dir = d / dist;
  float cone = smoothstep(uFlashCos, uFlashCos + 0.06, dot(dir, uFlashDir));
  float att = clamp(1.0 - dist / uFlashRange, 0.0, 1.0);
  float ndl = max(dot(normalize(vNormal), -dir), 0.0) * 0.6 + 0.4;
  light += vec3(1.0, 0.93, 0.78) * cone * att * att * ndl * uFlashOn * 1.5 * (1.0 - emis);
  vec3 col = tex.rgb * uTint * light;
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
}`;

/**
 * offMap: makes a light-fixture material. The geometry then needs a float `aLit` attribute
 * (0 = dark, 1 = fully lit): the texture blends offMap → texture and emissive scales with it,
 * so every fixture in a room shares one material and one draw call (src/power owns aLit).
 */
export function makePS1Material(texture, { tint = 0xffffff, emissive = 0, offMap = null } = {}) {
  const uniforms = {
    ...shared,
    map: { value: texture },
    uTint: { value: new THREE.Color(tint) },
    uEmissive: { value: emissive },
  };
  if (offMap) uniforms.mapOff = { value: offMap };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: offMap ? { USE_LIT: '' } : {},
    vertexShader,
    fragmentShader,
  });
}

// Highlight overlay for the object the player is looking at. Uses the *same* vertex shader as
// the PS1 material, so snapped vertices line up exactly and depth `<=` passes on the object's own
// surface. Additive: a soft pulsing glow plus a brighter rim so the silhouette pops in the dark.
const highlightFrag = /* glsl */`
uniform sampler2D map;
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUvP;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  if (texture2D(map, vUvP).a < 0.5) discard;
  vec3 v = normalize(cameraPosition - vWorldPos);
  float rim = 1.0 - abs(dot(normalize(vNormal), v));
  gl_FragColor = vec4(uColor * uStrength * (0.35 + rim * rim * 1.4), 1.0);
}`;

export function makeHighlightMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      map: { value: texture },
      uEmissive: { value: 0 },
      uColor: highlightUniforms.uColor,
      uStrength: highlightUniforms.uStrength,
    },
    vertexShader,
    fragmentShader: highlightFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide,
  });
}

// Thin outline shell for the highlighted object: drawn back-faces-only on a slightly scaled copy,
// so a 1–2 low-res-pixel rim shows around the silhouette. Same vertex shader → same snapping.
const outlineFrag = /* glsl */`
uniform vec3 uColor;
uniform float uStrength;
void main() { gl_FragColor = vec4(uColor * (0.55 + uStrength), 1.0); }`;

export function makeOutlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uEmissive: { value: 0 }, uColor: highlightUniforms.uColor, uStrength: highlightUniforms.uStrength },
    vertexShader,
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
  });
}

// Shared so one update per frame pulses every highlight material.
export const highlightUniforms = {
  uColor: { value: new THREE.Color(1.0, 0.86, 0.55) },
  uStrength: { value: 0 },
};

// Post pass: sample the low-res target per low-res pixel, quantise to 15-bit with
// a 4x4 Bayer dither, add a little grain. Draws to the full-size canvas.
const postVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const postFrag = /* glsl */`
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrain;
uniform float uDistort;   // 0..1 low-sanity VHS wobble + chroma split (meta UI, M5 vitals)
varying vec2 vUv;
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  if (uDistort > 0.001) {
    // slow VHS line wobble plus a soft tracking band rolling down the screen (smooth, no strobe)
    float band = 1.0 - smoothstep(0.0, 0.06, abs(fract(uv.y * 0.6 + uTime * 0.05) - 0.5));
    uv.x += uDistort * (sin(uv.y * 38.0 + uTime * 2.1) * 0.0025 + sin(uv.y * 5.0 - uTime * 0.9) * 0.004
          + band * 0.012 * sin(uTime * 3.0 + uv.y * 90.0));
  }
  vec2 px = floor(uv * uRes);
  vec3 c = texture2D(tScene, (px + 0.5) / uRes).rgb;
  if (uDistort > 0.001) {
    float off = floor(uDistort * 2.0 + 0.5);   // 0..2 low-res pixels of chroma split
    c.r = texture2D(tScene, (px + vec2(off, 0.0) + 0.5) / uRes).r;
    c.b = texture2D(tScene, (px - vec2(off, 0.0) + 0.5) / uRes).b;
  }
  c += (hash(px + fract(uTime) * 91.7) - 0.5) * uGrain;
  c += (bayer4(px) - 0.5) / 31.0;
  c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5) / 31.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export class PS1Renderer {
  constructor(canvas, { height = 240 } = {}) {
    this.canvas = canvas;
    this.height = height;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    this.post = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: this.target.texture },
          uRes: { value: new THREE.Vector2() },
          uTime: { value: 0 },
          uGrain: { value: 0.035 },
          uDistort: { value: 0 },
        },
        vertexShader: postVert,
        fragmentShader: postFrag,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.post.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.post);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // Overlay passes (M5 view-model, paper tags): drawn into the same low-res target after the
    // world, each with a fresh depth buffer so they never clip into walls, then dithered with it.
    this.overlays = [];
    this.postUniforms = this.post.material.uniforms; // uGrain, uDistort… for meta effects
    this.resize();
  }

  /** Register an overlay `{ scene, camera, visible? }` drawn on top of the world each render. Returns a remover. */
  addOverlay(scene, camera) {
    const o = { scene, camera, visible: true };
    this.overlays.push(o);
    return Object.assign(o, { remove: () => { const i = this.overlays.indexOf(o); if (i >= 0) this.overlays.splice(i, 1); } });
  }

  /** Low-res target size in pixels (overlay cameras that work in screen pixels use this). */
  get lowRes() { return this.post.material.uniforms.uRes.value; }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const lh = this.height;
    const lw = Math.max(1, Math.round(lh * (w / h)));
    this.target.setSize(lw, lh);
    this.post.material.uniforms.uRes.value.set(lw, lh);
    shared.uSnap.value.set(lw, lh);
    this.aspect = w / h;
  }

  // overlays: optional extra list for this call; registered overlays (addOverlay) always draw.
  render(scene, camera, time, overlays = null) {
    this.post.material.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    const list = overlays ? this.overlays.concat(overlays) : this.overlays;
    if (list.length) {
      const r = this.renderer;
      r.autoClear = false;
      for (const o of list) {
        if (o.visible === false) continue;
        r.clearDepth();
        r.render(o.scene, o.camera);
      }
      r.autoClear = true;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
