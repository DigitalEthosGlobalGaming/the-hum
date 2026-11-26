// THE HUM · boot + main loop (milestone 1: one test room).
import * as THREE from 'three';
import content from 'virtual:content';
import { PS1Renderer, shared, MAX_LIGHTS } from './render/ps1.js';
import { TextureBank } from './core/textures.js';
import { Input } from './core/input.js';
import { Diagnostics } from './core/diagnostics.js';
import { buildRoom } from './world/roomBuilder.js';
import { Player } from './player/player.js';
import { Synth } from './audio/synth.js';

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

  const room = buildRoom(content.rooms.m1_test_hall, textures);
  scene.add(room.group);

  const input = new Input(canvas, cfg.keys);
  const synth = new Synth();
  const player = new Player(cfg.player, camera);
  player.pos.copy(room.spawn);
  player.yaw = room.spawnYaw;
  player.onStep = (k) => synth.footstep(k);
  const diag = new Diagnostics();

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

  // Pick the nearest lights each frame and apply fluorescent flicker.
  const tmp = [];
  function updateLights(time) {
    tmp.length = 0;
    for (const L of room.lights) {
      L.d = L.pos.distanceToSquared(camera.position);
      tmp.push(L);
    }
    tmp.sort((a, b) => a.d - b.d);
    const n = Math.min(MAX_LIGHTS, tmp.length);
    for (let i = 0; i < n; i++) {
      const L = tmp[i];
      // mostly steady, with an occasional stutter seeded per fixture
      const s = Math.sin(time * 7.3 + L.seed) * Math.sin(time * 1.7 + L.seed * 0.3);
      const flick = s > 0.97 ? 0.25 : 1;
      shared.uLightPos.value[i].copy(L.pos);
      shared.uLightColor.value[i].setRGB(1.0 * flick, 0.92 * flick, 0.62 * flick);
      shared.uLightRange.value[i] = 9;
    }
    shared.uLightCount.value = n;
  }

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
      player.update(dt, input, room);
    } else {
      player.update(0, { held: () => false, lookDX: 0, lookDY: 0 }, room);
    }
    camera.getWorldDirection(fwd);
    shared.uFlashPos.value.copy(camera.position);
    shared.uFlashDir.value.copy(fwd);
    updateLights(time);
    renderer.render(scene, camera, time);
    diag.update(dt, { renderer, input, synth, player });
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
