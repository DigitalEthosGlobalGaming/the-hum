// Disposable flash camera: a bright flash (a strong light at the player + a white pop on the post
// pass), a noise, `camera:flash { pos, dir }` for the Tenant, and a low-res photo of what the world
// camera sees, taped into the notebook. About 1 in 6 photos has something extra in it.
import * as THREE from 'three';
import { Rng, hash } from '../core/rng.js';
import { story, stateOf, runState, onInstance, onUpdate, onReady, tempLight, canvasTex, makeCanvas, carried } from './runtime.js';
import { makePS1Material } from '../render/ps1.js';
import { pixelText } from '../ui/diegetic/text.js';
import { facingWord } from './typewriterText.js';
import { addPhotoPage } from './pages.js';

export const SHOTS = 12;
export const COUNTER_PART = 3;          // the counter window box in the flash_camera prefab
export const EXTRA_CHANCE = 1 / 6;
const PW = 96, PH = 72;
const F = { pop: 0, rt: null, cam: null, buf: null };

/** What (if anything) is wrong with photo n of this run: null | 'figure' | 'writing'. Seeded. */
export function photoExtra(seed, n) {
  const r = new Rng(hash(seed >>> 0, 'photoExtra', n));
  if (!r.chance(EXTRA_CHANCE)) return null;
  return r.chance(0.55) ? 'figure' : 'writing';
}

/** Fire the flash. Returns { pos, dir }. */
export function flash(game) {
  const cam = game.camera;
  const pos = cam.position.clone();
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  tempLight(pos.clone().addScaledVector(dir, 0.4), new THREE.Color(1, 0.97, 0.9).multiplyScalar(4.5), 15, 0.22);
  F.pop = 1;
  game.world.noise(pos, 12, 'camera_flash');
  game.events.emit('camera:flash', { pos: { x: pos.x, y: pos.y, z: pos.z }, dir: { x: dir.x, y: dir.y, z: dir.z } });
  return { pos, dir };
}

/** Render the world camera into a small target and copy it to a canvas (with the flash lit). */
export function snapshot(game) {
  const r = game.renderer.renderer;
  F.rt ??= new THREE.WebGLRenderTarget(PW, PH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  F.cam ??= new THREE.PerspectiveCamera(60, PW / PH, 0.05, 40);
  F.buf ??= new Uint8Array(PW * PH * 4);
  F.cam.position.copy(game.camera.position);
  F.cam.quaternion.copy(game.camera.quaternion);
  F.cam.updateMatrixWorld(true);
  game.world.updateLights(game.camera, game.time); // include the flash light this frame
  const prev = r.getRenderTarget();
  r.setRenderTarget(F.rt);
  r.render(game.scene, F.cam);
  r.readRenderTargetPixels(F.rt, 0, 0, PW, PH, F.buf);
  r.setRenderTarget(prev);
  const [c, g] = makeCanvas(PW, PH);
  const img = g.createImageData(PW, PH);
  for (let y = 0; y < PH; y++) {
    const src = (PH - 1 - y) * PW * 4;
    img.data.set(F.buf.subarray(src, src + PW * 4), y * PW * 4);
  }
  g.putImageData(img, 0, 0);
  return [c, g];
}

/** Develop the photo: flash falloff, warm cast, grain, the extra (if any), date stamp. */
export function develop(g, { seed, n, extra, lines }) {
  const r = new Rng(hash(seed >>> 0, 'photo', n));
  // flash falloff: bright centre, dark corners
  const grad = g.createRadialGradient(PW / 2, PH / 2, 6, PW / 2, PH / 2, PW * 0.62);
  grad.addColorStop(0, 'rgba(255,248,230,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grad; g.fillRect(0, 0, PW, PH);
  if (extra === 'figure') {
    // a tall dark shape at the edge of the frame, taller than the doorways
    const left = r.chance(0.5);
    const x = left ? r.int(2, 12) : PW - r.int(14, 24);
    const top = r.int(2, 8), h = PH - top + 4, w = r.int(9, 12);
    g.fillStyle = 'rgba(6,5,6,0.88)';
    g.beginPath();
    g.ellipse(x + w / 2, top + 4, w * 0.3, 5, 0, 0, Math.PI * 2);     // head, small for the height
    g.moveTo(x + w * 0.2, top + 8);
    g.lineTo(x + w * 0.8, top + 8);
    g.lineTo(x + w, top + h);
    g.lineTo(x, top + h);
    g.closePath();
    g.fill();
    g.fillRect(x - 2, top + 12, 2, h * 0.55);                        // arms, too long
    g.fillRect(x + w, top + 12, 2, h * 0.55);
  } else if (extra === 'writing') {
    const words = lines?.length ? r.pick(lines) : 'STILL HERE';
    g.save();
    g.translate(r.int(14, 30), r.int(14, 30));
    g.rotate((r.next() - 0.5) * 0.25);
    pixelText(g, words, 0, 0, { scale: 2, color: 'rgba(90,12,10,0.85)' });
    g.restore();
  }
  // warm cast + grain
  const img = g.getImageData(0, 0, PW, PH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = (r.next() - 0.5) * 26;
    d[i] = Math.min(255, d[i] * 1.06 + 6 + k);
    d[i + 1] = Math.min(255, d[i + 1] * 1.0 + 2 + k);
    d[i + 2] = Math.min(255, d[i + 2] * 0.86 + k);
  }
  g.putImageData(img, 0, 0);
  // orange date stamp, bottom right
  const date = `'98 11 ${String(10 + (n % 20)).padStart(2, '0')}`;
  pixelText(g, date, PW - 4 * date.length - 2, PH - 8, { color: '#ff8a1c' });
}

/** Handwritten caption for photo n. */
export function photoCaption(n, extra, yaw, roomName) {
  const where = `facing ${facingWord(yaw)}${roomName ? ', ' + roomName : ''}`;
  if (extra === 'figure') return `#${n}, ${where}. There was nobody there when I took it. There was nobody there.`;
  if (extra === 'writing') return `#${n}, ${where}. That writing was not on the wall. I looked.`;
  return `#${n}, ${where}. The flash makes it look closer than it was.`;
}

/** Take a photo (the use script calls this). Returns the photo number, or 0 when unbound. */
export function takePhoto(game, roomName) {
  flash(game);
  const run = runState();
  const n = (run.photos = (run.photos ?? 0) + 1);
  const extra = photoExtra(game.seed, n);
  const [c, g] = snapshot(game);
  develop(g, { seed: game.seed, n, extra, lines: game.content.lines?.photo_writing?.lines });
  addPhotoPage({ id: `photo:${n}`, image: c, title: `photo ${n}`, caption: photoCaption(n, extra, game.player.yaw, roomName) });
  return n;
}

// ---- the shot counter on the camera body ----
function paintCounter(g, n) {
  g.fillStyle = '#141414'; g.fillRect(0, 0, 8, 8);
  pixelText(g, n > 9 ? String(n).slice(-1) : String(n), 2, 1, { color: n > 0 ? '#e8d8a0' : '#a03020' });
  if (n > 9) { g.fillStyle = '#e8d8a0'; g.fillRect(0, 1, 1, 5); } // the "1" of 10–12, squeezed in
}

/** Redraw the shared counter texture (used by the held model) for the camera in your hand. */
export function refreshHeldCounter(game) {
  const tex = game.textures.get('proc:camera_counter');
  const held = game.inventory?.held;
  const n = held?.id === 'flash_camera' ? held.state?.shots ?? SHOTS : (carried('flash_camera')[0]?.state?.shots ?? SHOTS);
  const g = tex.image.getContext('2d');
  paintCounter(g, n);
  tex.needsUpdate = true;
}

onInstance('flash_camera', (inst) => {
  const part = inst.root.children[COUNTER_PART];
  if (!part) return;
  const [c, g] = makeCanvas(8, 8);
  inst.counter = { c, g, tex: canvasTex(c), shown: -1 };
  part.material = makePS1Material(inst.counter.tex, { emissive: 0.3 });
});

onReady((game) => {
  game.events.on('inventory:change', () => refreshHeldCounter(game));
  refreshHeldCounter(game);
});

onUpdate((dt, game) => {
  if (F.pop > 0) {
    F.pop = Math.max(0, F.pop - dt * 4.5);
    if (game.renderer.postUniforms.uFlash) game.renderer.postUniforms.uFlash.value = F.pop * F.pop;
  }
  for (const inst of game.world.objects.instances) {
    if (inst.id !== 'flash_camera' || !inst.counter) continue;
    const n = stateOf(inst)?.shots ?? SHOTS;
    if (n === inst.counter.shown) continue;
    inst.counter.shown = n;
    paintCounter(inst.counter.g, n);
    inst.counter.tex.needsUpdate = true;
  }
});

export { story };
