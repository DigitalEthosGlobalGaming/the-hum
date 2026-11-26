// THE HUM · boot + main loop.
// Systems share one `game` object (see src/CONTRACTS.md). M4 gameplay and M5 diegetic UI plug in
// through their install/update hooks so this file stays small.
import * as THREE from 'three';
import content from 'virtual:content';
import { PS1Renderer, shared, highlightUniforms } from './render/ps1.js';
import { TextureBank } from './core/textures.js';
import { Input } from './core/input.js';
import { Events } from './core/events.js';
import { Diagnostics } from './core/diagnostics.js';
import { World } from './world/world.js';
import { hash } from './core/rng.js';
import { Player } from './player/player.js';
import { Synth } from './audio/synth.js';
import { mountSoundBoard } from './audio/soundBoard.js';
import { installGameplay, updateGameplay } from './gameplay/index.js';
import { installDiegetic, updateDiegetic, renderDiegetic } from './ui/diegetic/index.js';

const cfg = content.config;
const canvas = document.getElementById('game');

async function boot() {
  const renderer = new PS1Renderer(canvas, { height: cfg.render.height });
  shared.uFogNear.value = cfg.render.fogNear;
  shared.uFogFar.value = cfg.render.fogFar;
  shared.uAffine.value = cfg.render.affine;
  shared.uAffineNear.value = cfg.render.affineNear;
  shared.uAffineFar.value = cfg.render.affineFar;
  if (cfg.render.ambient) shared.uAmbient.value.setRGB(...cfg.render.ambient);
  const scene = new THREE.Scene();
  scene.background = shared.uFogColor.value;
  const camera = new THREE.PerspectiveCamera(cfg.render.fov, renderer.aspect, 0.05, 60);

  const textures = new TextureBank();
  await textures.preload();

  // Run seed: ?seed=<anything> in the URL, else random. (The VHS-label seed UI comes in M6.)
  const seedParam = new URLSearchParams(location.search).get('seed');
  const seed = seedParam ? hash(seedParam) : (Math.random() * 2 ** 32) >>> 0;

  const events = new Events();
  const input = new Input(canvas, cfg.keys);
  const synth = new Synth();
  synth.loadPresets(content.sounds);
  const world = new World({ content, textures, scene, audio: synth, seed });
  const spawn = world.start();
  const player = new Player(cfg.player, camera);
  player.pos.copy(spawn.pos);
  player.yaw = spawn.yaw;

  const game = {
    cfg, content, seed, canvas, renderer, scene, camera, textures, input, events, synth, world, player,
    playing: false,
    time: 0,
    focus: null,                 // { inst, distance } the aimed-at interactable, or null
    stats: { sanity: 1, stamina: 1, steps: 0 },
    // Minimal flashlight; M5 replaces this with the held torch + LEDs (same fields).
    flashlight: {
      on: true, battery: 1,
      toggle() { this.on = !this.on; synth.click(); },
      recharge(amount = 1) { this.battery = Math.min(1, this.battery + amount); },
    },
  };
  player.onStep = (k) => { game.stats.steps++; synth.footstep(k); events.emit('player:step', { intensity: k }); };

  installGameplay(game);
  installDiegetic(game);

  const diag = new Diagnostics();
  if (__DEV__) mountSoundBoard(synth, content.sounds);
  if (__DEV__) window.__hum = game; // console poking in dev builds only

  // Placeholder title card (replaced by the CRT title in milestone 6).
  const title = document.createElement('div');
  title.innerHTML = '<div style="font:bold 42px monospace;letter-spacing:12px">THE HUM</div>'
    + '<div style="font:14px monospace;margin-top:14px;opacity:.7">click to enter</div>';
  Object.assign(title.style, {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', color: '#d8cf8a', background: 'rgba(0,0,0,0.82)', cursor: 'pointer', zIndex: 5,
  });
  document.body.appendChild(title);
  title.addEventListener('mousedown', () => {
    synth.start();
    input.requestLock();
    title.remove();
    game.playing = true;
    events.emit('game:start', {});
  });

  addEventListener('resize', () => {
    renderer.resize();
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    events.emit('game:resize', {});
  });

  const idleInput = { held: () => false, wasPressed: () => false, lookDX: 0, lookDY: 0 };
  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = (game.time = clock.elapsedTime);
    if (input.wasPressed('debug')) diag.toggle();
    if (game.playing) {
      if (input.wasPressed('flashlight')) game.flashlight.toggle();
      player.update(dt, input, world);
    } else {
      player.update(0, idleInput, world);
    }
    camera.getWorldDirection(fwd);
    shared.uFlashPos.value.copy(camera.position);
    shared.uFlashDir.value.copy(fwd);
    shared.uFlashOn.value = game.flashlight.on ? Math.min(1, 0.25 + game.flashlight.battery * 0.75) : 0;
    synth.setListener(camera.position, fwd, camera.up);
    world.update(dt, { camera, time, player });
    game.focus = game.playing ? world.updateFocus(camera) : null;
    if (game.playing) updateGameplay(game, dt);
    updateDiegetic(game, dt);
    highlightUniforms.uStrength.value = 0.32 + 0.12 * Math.sin(time * 4); // slow pulse
    renderer.render(scene, camera, time);
    renderDiegetic(game);
    const look = game.focus;
    diag.update(dt, { renderer, input, synth, player, extra: [
      `seed       ${seed}`,
      ...world.debugLines(player.pos),
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
