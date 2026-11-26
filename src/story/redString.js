// Ball of red string. Use ties it off where you stand; while you carry the ball a red line pays out
// along the floor behind you (150 m on a ball). Use again cuts it: the thread stays, its end becomes
// a knot you can E to tie back on. Drop the ball and the thread just ends there until you pick it up.
// Threads live in the run state (ctx.state.run.threads), so they persist for the run.
//   thread = { id, pts: [[x, z], ...], len, open }   spool state = { left, threadId }
import * as THREE from 'three';
import { story, runState, onReady, onUpdate, carried, caption, sound, playing } from './runtime.js';
import { payOut } from './stringPath.js';
import { shared } from '../render/ps1.js';

export const BALL_M = 150;
const MAX_PTS = 4096;
const lines = new Map(); // thread id → { line, geo, n }

export function threads() { return (runState().threads ??= []); }
export const threadById = (id) => threads().find((t) => t.id === id) ?? null;

/** Tie a new thread at `p` for this spool. */
export function tieOff(spool, p) {
  spool.left ??= BALL_M;
  const run = runState();
  const t = { id: `thread:${(run.threadSeq = (run.threadSeq ?? 0) + 1)}`, pts: [[p.x, p.z]], len: 0, open: true };
  threads().push(t);
  spool.threadId = t.id;
  return t;
}

/** Cut the spool's thread where it is. Returns the thread. */
export function cut(spool) {
  const t = threadById(spool.threadId);
  spool.threadId = null;
  if (t) t.open = false;
  return t;
}

/** Tie a spool back onto an existing thread end. */
export function reattach(spool, t) {
  spool.left ??= BALL_M;
  t.open = true;
  spool.threadId = t.id;
}

// ---- rendering: one line strip per thread, unlit red that fades into the fog and lights up in the beam
const vert = /* glsl */`
varying vec3 vWorld; varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 vp = viewMatrix * wp;
  vDepth = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;
const frag = /* glsl */`
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform vec3 uFlashPos; uniform vec3 uFlashDir; uniform float uFlashOn; uniform float uFlashCos; uniform float uFlashRange;
varying vec3 vWorld; varying float vDepth;
void main() {
  vec3 d = vWorld - uFlashPos;
  float dist = max(length(d), 0.001);
  float cone = smoothstep(uFlashCos, uFlashCos + 0.06, dot(d / dist, uFlashDir));
  float att = clamp(1.0 - dist / uFlashRange, 0.0, 1.0);
  vec3 col = vec3(0.42, 0.03, 0.03) + vec3(0.55, 0.06, 0.04) * cone * att * uFlashOn;
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
}`;
let material = null;

function lineFor(t, scene) {
  let L = lines.get(t.id);
  if (L) return L;
  material ??= new THREE.ShaderMaterial({ uniforms: { ...shared }, vertexShader: vert, fragmentShader: frag });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.Line(geo, material);
  line.frustumCulled = false;
  scene.add(line);
  L = { line, geo, n: -1, tip: null };
  lines.set(t.id, L);
  return L;
}

function writeLine(L, t, tip) {
  const pos = L.geo.attributes.position;
  const pts = t.pts.length > MAX_PTS - 1 ? t.pts.slice(-(MAX_PTS - 1)) : t.pts;
  for (let i = 0; i < pts.length; i++) {
    // a little sag and wander so it reads as string lying on carpet
    const w = Math.sin(i * 2.3) * 0.015;
    pos.setXYZ(i, pts[i][0] + w, 0.012, pts[i][1] - w);
  }
  let n = pts.length;
  if (tip) { pos.setXYZ(n, tip.x, 0.25, tip.z); n++; } // the live end rises toward your hand
  pos.needsUpdate = true;
  L.geo.setDrawRange(0, n);
  L.n = t.pts.length;
}

onReady((game) => {
  game.events.on('item:drop', ({ id, stack } = {}) => {
    if (id !== 'red_string' || !stack?.state?.threadId) return;
    const t = threadById(stack.state.threadId);
    const p = game.gameplay.dropPoint(); // where dropHeld just put the ball
    if (t) payOut(t, stack.state, [p.x, p.z], { step: 0.05 });
    caption('The ball rolls a little. The thread stays tied to it.', 3, 'string');
  });
});

onUpdate((dt, game) => {
  const p = game.player.pos;
  const spool = carried('red_string')[0]?.state ?? null;
  const active = spool?.threadId ? threadById(spool.threadId) : null;
  if (active && playing()) {
    const r = payOut(active, spool, [p.x, p.z]);
    if (r.taut && !spool.tautWarned) {
      spool.tautWarned = true;
      sound('string_snap', { volume: 0.4 });
      caption('The string pulls taut. The ball is empty.', 3, 'string');
    }
  }
  for (const t of threads()) {
    const L = lineFor(t, game.scene);
    const live = t === active;
    if (L.n !== t.pts.length || live || L.wasLive) writeLine(L, t, live ? p : null);
    L.wasLive = live;
  }
});

export { story };
