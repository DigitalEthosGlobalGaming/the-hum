// THE HUM · boot + main loop.
// Systems share one `game` object (see src/CONTRACTS.md). M4 gameplay and M5 diegetic UI plug in
// through their install/update hooks so this file stays small.
import './extensions.js'; // feature modules register prefabs/textures first
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
import { installSettings } from './settings/install.js';
import { installFootsteps } from './surfaces/index.js';

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
  const synth = new Synth({ hum: false }); // the hum is positional now: src/ambience (one emitter per nearby tube)
  synth.loadPresets(content.sounds);
  const world = new World({ content, textures, scene, audio: synth, seed, events });
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
  const footsteps = installFootsteps(game); // src/surfaces: floor-surface steps, puddles, wet footprints
  player.onStep = (k) => {
    game.stats.steps++;
    const step = footsteps.step(k); // plays the surface's step (or splash/squelch), maybe leaves a print
    events.emit('player:step', { intensity: k, surface: step.surface, wet: step.wet });
    world.noise(player.pos, step.loudness, 'footstep'); // carpet walk ~5 m, sprint ~8 m; louder on metal
  };

  installSettings(game);       // game.settings (persisted); applied to input / synth / cfg.ui
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

  // ---- fullscreen + pause/resume -------------------------------------------------------------
  // Esc makes the browser drop pointer lock (and fullscreen). We pause: the notebook opens at its
  // Settings page (the diegetic UI listens for game:pause). Its "back to it" line calls
  // game.resume() from inside the click / key event, which restores the lock, then fullscreen.
  // Whether we want fullscreen is the persisted `fullscreen` setting.
  const wantFullscreen = () => game.settings?.fullscreen !== false;
  let fsToggling = false; // true while *we* change fullscreen, so it doesn't count as "Esc"
  const fs = {
    get on() { return !!document.fullscreenElement; },
    enter() {
      const el = document.documentElement;
      if (!el.requestFullscreen || fs.on) return;
      fsToggling = true;
      el.requestFullscreen({ navigationUI: 'hide' })
        .catch((e) => { fs.error = e?.name || String(e); }) // e.g. an iframe without allow="fullscreen"
        .finally(() => setTimeout(() => { fsToggling = false; }, 300));
    },
    exit() {
      if (!fs.on) return;
      fsToggling = true;
      document.exitFullscreen().catch(() => {}).finally(() => setTimeout(() => { fsToggling = false; }, 300));
    },
  };
  game.fullscreen = fs;

  let resumedAt = -1;
  game.pausedAt = -Infinity;
  function pause() {
    if (!game.playing) return;
    game.playing = false;
    game.paused = true;
    game.pausedAt = performance.now();
    events.emit('ui:captionClear', { key: 'relock' });
    events.emit('game:pause', {});  // → the notebook opens at Settings, cursor free
  }
  /**
   * Call only from inside a real input event (click / keydown): it re-captures the pointer.
   * From an Esc keydown the browser usually refuses (Esc is not a user gesture, and there is a ~1 s
   * cooldown after the player left the lock with Esc): the game still resumes, a caption asks for a
   * click, and that click captures the mouse (and goes back to fullscreen if the setting is on).
   */
  function resume() {
    if (!game.paused) return;
    input.requestLock();            // capture first: requestFullscreen consumes the click
    if (wantFullscreen()) fs.enter();
    game.paused = false;
    game.playing = true;
    resumedAt = performance.now();
    events.emit('game:resume', {});
  }
  game.pause = pause;
  game.resume = resume;

  title.addEventListener('mousedown', () => {
    synth.start();
    input.requestLock();            // capture first: requestFullscreen consumes the click
    if (wantFullscreen()) fs.enter();
    title.remove();
    game.playing = true;
    events.emit('game:start', {});
  });

  // Playing with a loose cursor (a re-lock the browser refused, or Esc closed the open notebook):
  // say so; a click on the canvas captures again (src/core/input.js) and restores fullscreen.
  const relockHint = () => {
    if (game.playing && !input.locked && input.mode === 'lock') {
      events.emit('ui:caption', { text: '(click to take hold of the mouse again)', seconds: 6, key: 'relock' });
    }
  };
  canvas.addEventListener('mousedown', () => {
    if (game.playing && !input.locked && !input.captureSuspended && wantFullscreen() && !fs.on) fs.enter();
  });

  // Esc while the notebook is open unpaused (Tab / M, e.g. the map) only closes it. The browser
  // drops pointer lock (and fullscreen) on that same Esc; that must not pause on top of it.
  let bookEscAt = -Infinity;
  function escClosedBook() {
    const menu = game.diegetic?.menu;
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false; // alt-tab: pause
    if (menu?.open && !game.paused) { menu.close(); bookEscAt = performance.now(); }
    const t = Math.max(bookEscAt, menu?.escClosedAt ?? -Infinity); // the menu's own Esc keydown may come first
    if (performance.now() - t < 600) { setTimeout(relockHint, 0); return true; }
    return false;
  }

  // Losing pointer lock while playing = the player pressed Esc (or alt-tabbed): pause.
  document.addEventListener('pointerlockchange', () => {
    if (input.locked) { events.emit('ui:captionClear', { key: 'relock' }); return; }
    if (input.mode === 'lock' && game.playing && !fsToggling && !escClosedBook()) pause();
  });
  // A refused re-lock (see resume()): keep playing and ask for a click instead of bouncing back
  // into the pause menu, so Esc · Esc gets out of the menu.
  document.addEventListener('pointerlockerror', () => {
    if (game.playing && input.mode === 'lock' && performance.now() - resumedAt < 1500) relockHint();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!fs.on && !fsToggling && game.playing && !escClosedBook()) pause();
    // entering fullscreen can drop or block the lock: ask again (allowed while fullscreen)
    if (fs.on && game.playing && !input.locked) input.requestLock();
  });
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (cfg.keys.fullscreen?.includes(e.code)) {
      e.preventDefault();
      const on = !fs.on;
      game.settings?.set('fullscreen', on);
      if (on) fs.enter(); else fs.exit();
    } else if (cfg.keys.pause?.includes(e.code) && game.playing && !input.locked) {
      // No lock to lose (click-drag fallback, or playing on after a refused re-lock): Esc pauses
      // directly. (With the notebook open unpaused, its key handler takes Esc first and closes it.)
      pause();
    }
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
    const realTime = clock.elapsedTime;
    if (!game.paused) game.time += dt; // play time: frozen while paused
    const time = game.time;
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
    highlightUniforms.uStrength.value = 0.32 + 0.12 * Math.sin(realTime * 4); // slow pulse
    renderer.render(scene, camera, realTime); // grain keeps moving while paused
    renderDiegetic(game);
    const look = game.focus;
    diag.update(dt, { renderer, input, synth, player, extra: [
      `seed       ${seed}`,
      `fullscreen ${fs.on ? 'on' : 'off'}${fs.error ? ' (' + fs.error + ')' : ''}${game.paused ? ' · PAUSED' : ''}`,
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
