// THE HUM · boot + main loop (milestone 2: test room populated from content JSON).
import * as THREE from 'three';
import content from 'virtual:content';
import { PS1Renderer, shared, highlightUniforms } from './render/ps1.js';
import { TextureBank } from './core/textures.js';
import { Input } from './core/input.js';
import { Diagnostics } from './core/diagnostics.js';
import { World } from './world/world.js';
import { hash } from './core/rng.js';
import { Player } from './player/player.js';
import { Synth } from './audio/synth.js';
import { mountSoundBoard } from './audio/soundBoard.js';

const cfg = content.config;
const canvas = document.getElementById('game');

async function boot() {
  const renderer = new PS1Renderer(canvas, { height: cfg.render.height });
  shared.uFogNear.value = cfg.render.fogNear;
  shared.uFogFar.value = cfg.render.fogFar;
  shared.uAffine.value = cfg.render.affine;
  shared.uAffineNear.value = cfg.render.affineNear;
  shared.uAffineFar.value = cfg.render.affineFar;
  const scene = new THREE.Scene();
  scene.background = shared.uFogColor.value;
  const camera = new THREE.PerspectiveCamera(cfg.render.fov, renderer.aspect, 0.05, 60);

  const textures = new TextureBank();
  await textures.preload();

  // Run seed: ?seed=<anything> in the URL, else random. (The VHS-label seed UI comes in M6.)
  const seedParam = new URLSearchParams(location.search).get('seed');
  const seed = seedParam ? hash(seedParam) : (Math.random() * 2 ** 32) >>> 0;

  const input = new Input(canvas, cfg.keys);
  const synth = new Synth();
  synth.loadPresets(content.sounds);
  const world = new World({ content, textures, scene, audio: synth, seed });
  const placed = world.addRoom('m1_test_hall', { x: 0, z: 0 });
  const room = placed.built;
  const player = new Player(cfg.player, camera);
  player.pos.copy(room.spawn);
  player.yaw = room.spawnYaw;
  player.onStep = (k) => synth.footstep(k);
  const diag = new Diagnostics();
  if (__DEV__) mountSoundBoard(synth, content.sounds);
  if (__DEV__) window.__hum = { player, world, camera, synth, content }; // console poking in dev builds only

  // Placeholder title card (replaced by the CRT title in milestone 6).
  const title = document.createElement('div');
  title.innerHTML = '<div style="font:bold 42px monospace;letter-spacing:12px">THE HUM</div>'
    + '<div style="font:14px monospace;margin-top:14px;opacity:.7">click to enter</div>';
  Object.assign(title.style, {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', color: '#d8cf8a', background: 'rgba(0,0,0,0.82)', cursor: 'pointer', zIndex: 5,
  });
  document.body.appendChild(title);
  let playing = false;
  title.addEventListener('mousedown', () => {
    synth.start();
    input.requestLock();
    title.remove();
    playing = true;
  });

  addEventListener('resize', () => {
    renderer.resize();
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
  });

  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    if (input.wasPressed('debug')) diag.toggle();
    if (playing) {
      if (input.wasPressed('flashlight')) {
        shared.uFlashOn.value = shared.uFlashOn.value ? 0 : 1;
        synth.click();
      }
      player.update(dt, input, world);
    } else {
      player.update(0, { held: () => false, lookDX: 0, lookDY: 0 }, world);
    }
    camera.getWorldDirection(fwd);
    shared.uFlashPos.value.copy(camera.position);
    shared.uFlashDir.value.copy(fwd);
    synth.setListener(camera.position, fwd, camera.up);
    world.update(dt, { camera, time });
    const look = playing ? world.updateFocus(camera) : null;
    highlightUniforms.uStrength.value = 0.32 + 0.12 * Math.sin(time * 4); // slow pulse
    renderer.render(scene, camera, time);
    diag.update(dt, { renderer, input, synth, player, extra: [
      `seed       ${seed}`,
      `objects    ${world.objects.instances.length} (${world.colliders.length} solid, ${world.objects.lights.length} lit)`,
      `looking at ${look ? look.inst.name + (look.inst.readable?.text ? ' — "' + look.inst.readable.text + '"' : '') : '-'}`,
    ] });
    input.endFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="position:fixed;inset:0;margin:0;padding:16px;color:#f88;background:#000;font:13px monospace;white-space:pre-wrap">THE HUM failed to start:\n${String(err?.stack || err)}</pre>`);
});
