// M5 entry point: the diegetic kit. Hands + torch (LEDs), held item, hand prompt + paper tag,
// watch, notebook (auto-map + notes), pockets, vitals, captions.
// install() once; update() each frame; render() after the world render.
//
// Rendering: the view-model scene is registered as an overlay on game.renderer
// (PS1Renderer.addOverlay), so main's single renderer.render() call draws it into the same low-res
// target right after the world (depth cleared) and before the dither/post pass. All *text* (tags,
// captions, notebook writing, pocket labels) is drawn afterwards by renderDiegetic() on a
// full-resolution 2D canvas layer, so it is never dithered or quantised.
import { ViewModel, damp } from '../../viewmodel/viewModel.js';
import { Flashlight } from '../../viewmodel/flashlight.js';
import { LeftArm, RightArm } from '../../viewmodel/arms.js';
import { Vitals } from '../../vitals/vitals.js';
import { Watch } from './watch.js';
import { Notebook } from './notebook.js';
import { Pockets } from './pockets.js';
import { SeenMap } from './automap.js';
import { TextLayer } from './textLayer.js';
import { installInputGate } from './inputGate.js';
import { installInventoryStub, updateInventoryStub } from './devStub.js';

const MOVE = ['forward', 'back', 'left', 'right', 'sprint'];
let S = null;

export function installDiegetic(game) {
  const ui = game.cfg.ui ?? {};
  const gate = installInputGate(game.input);
  if (__DEV__ && !game.inventory) installInventoryStub(game);

  const vm = new ViewModel(game);
  const flashlight = new Flashlight(game);
  game.flashlight = flashlight;
  const left = new LeftArm(game.textures, flashlight);
  const right = new RightArm(game);
  const watch = new Watch(game, left.arm.wristTop);
  const notebook = new Notebook(game);
  const pockets = new Pockets(game);
  vm.scene.add(left.root, right.root, notebook.group, notebook.sheet, pockets.group);
  const text = new TextLayer(game);
  const map = new SeenMap();
  const vitals = new Vitals(game);

  S = {
    game, gate, vm, flashlight, left, right, watch, notebook, pockets, text, map, vitals,
    w: { watch: 0, note: 0, pockets: 0, inspect: 0, reach: 0 },
    notebookOpen: false, inspect: false, pocketsOpen: false, watchUp: false,
    captions: [], surface: null, mapSeen: -1, inv: game.inventory ?? null,
    reading: false,
  };

  // Public read-only state other systems may check (see CONTRACTS.md, "game.diegetic").
  game.diegetic = {
    map, notebook, vitals,
    get notebookOpen() { return S.notebookOpen; },
    get pocketsOpen() { return S.pocketsOpen; },
    get inspecting() { return S.inspect; },
    get reading() { return S.notebookOpen || S.inspect; },
    get bpm() { return vitals.bpm; },
  };

  const ev = game.events;
  ev.on('inventory:change', () => right.onInventoryChange());
  ev.on('inventory:full', () => right.onFull());
  ev.on('item:use', () => right.onUse());
  ev.on('item:pickup', () => right.onPickup());
  ev.on('note:collected', (p) => {
    notebook.addNote(p ?? {});
    pushCaption(`(copied into notebook: ${p?.title ?? 'note'})`, 2.5, true);
  });
  ev.on('readable:open', (p = {}) => {
    const display = p.display ?? 'notebook';
    if (display === 'inspect') {
      notebook.inspect(p);
      S.inspect = true;
      S.notebookOpen = false;
      game.synth?.play?.('paper_rustle', { volume: 0.7 });
    } else if (display === 'surface') {
      const text = p.text ?? p.title ?? '';
      S.surface = { text, until: game.time + Math.max(3, text.length * 0.07) };
    } else {
      const idx = notebook.addNote(p);
      notebook.open(idx);
      S.notebookOpen = true;
      S.inspect = false; // (M4 plays paper_rustle itself for notebook reads)
    }
  });
  ev.on('ui:caption', (p) => pushCaption(p?.text ?? '', p?.seconds ?? 3));
  ev.on('game:resize', () => { vm.resize(); text.resize(); });

  right.onInventoryChange();
  right.swap = 0.99; // first item appears from below
  if (__DEV__) { window.__humDiegetic = S; mountGritSlider(game); }
}

function pushCaption(text, seconds = 3, system = false) {
  if (!S || !text) return;
  if (!system && S.game.cfg.ui?.captions === false) return;
  const now = S.game.time;
  S.captions.push({ text: String(text), until: now + seconds, seconds, born: now });
  // at most 3 visible: the oldest of the rest fades out quickly instead of vanishing
  const live = S.captions.filter((c) => !c.leaving);
  for (let i = 0; i < live.length - 3; i++) { live[i].leaving = true; live[i].until = Math.min(live[i].until, now + 0.35); }
}

export function updateDiegetic(game, dt) {
  if (!S) return;
  const { gate, vm, flashlight, left, right, watch, notebook, pockets, map, vitals, w } = S;
  const raw = gate.raw;
  const playing = game.playing;
  const ui = game.cfg.ui ?? {};

  // M4 may install game.inventory after us; resync the hand when the object changes.
  if (game.inventory !== S.inv) { S.inv = game.inventory; right.onInventoryChange(); }
  if (__DEV__) updateInventoryStub(game, raw);

  // ── modes ──
  if (playing && raw.wasPressed('notebook')) {
    if (S.inspect) S.inspect = false;
    else S.notebookOpen = !S.notebookOpen;
    game.synth?.play?.('paper_rustle', { volume: 0.5 });
  }
  if (S.notebookOpen) {
    if (raw.wasPressed('left')) notebook.flip(-1);
    if (raw.wasPressed('right')) notebook.flip(1);
    if (raw.wasPressed('pause')) S.notebookOpen = false;
  }
  if (S.inspect && notebook.inspecting && game.time - notebook.inspecting.at > 0.3) {
    const dismiss = ['interact', 'use', 'pause', ...MOVE].some((a) => raw.wasPressed(a));
    if (dismiss) S.inspect = false;
  }
  const reading = (S.reading = S.notebookOpen || S.inspect);
  S.pocketsOpen = playing && !reading && raw.held('pockets');
  S.watchUp = playing && !reading && !S.pocketsOpen && raw.held('watch');

  // gate other systems' input for the next frame
  gate.blocked.clear();
  if (reading) for (const a of [...MOVE, 'interact', 'use', 'drop']) gate.blocked.add(a);
  if (S.pocketsOpen) for (const a of ['use', 'drop', 'left', 'right']) gate.blocked.add(a); // A/D move the pocket cursor
  if (vitals.exhausted) gate.blocked.add('sprint');
  gate.blockLook = S.pocketsOpen;
  if (game.gameplay) game.gameplay.inputBlocked = reading || S.pocketsOpen; // M4 ignores slot/E/use/drop

  // ── eased weights ──
  const glance = watch.beepT > 0 && !reading && !S.pocketsOpen ? 0.8 : 0;
  w.watch = damp(w.watch, Math.max(S.watchUp ? 1 : 0, glance), 9, dt);
  w.note = damp(w.note, S.notebookOpen ? 1 : 0, 8, dt);
  w.inspect = damp(w.inspect, S.inspect ? 1 : 0, 9, dt);
  w.pockets = damp(w.pockets, S.pocketsOpen ? 1 : 0, 9, dt);
  w.reach = damp(w.reach, game.focus && !reading && !S.pocketsOpen ? 1 : 0, 7, dt);

  // ── simulation ──
  flashlight.update(dt, game);
  vm.updateRig(dt, { stamina: game.stats.stamina });
  vm.sampleLight(flashlight.beam);
  vitals.update(dt, { light: vm.light, beam: flashlight.beam });
  map.update(dt, game);

  // camera: tip down to look at the jacket / glance at the wrist; winded breathing heave
  const cam = game.camera;
  const lookDown = (ui.pocketLookDown ?? 0.6) * w.pockets + 0.1 * w.watch;
  const st = game.stats.stamina;
  cam.rotation.x = Math.max(-1.45, cam.rotation.x - lookDown + Math.sin(vm.breath) * 0.008 * (1 - st));

  // ── view-model ──
  const busy = Math.max(w.note, w.inspect);
  left.update(vm, { watch: w.watch, hidden: busy, pockets: w.pockets });
  const pointAt = pockets.update(dt, w.pockets, raw, gate.look, left.torch);
  right.pointAt.copy(pointAt);
  right.update(vm, dt, { reach: w.reach, hidden: busy, pockets: w.pockets });
  watch.update(dt, w.watch, { bpm: vitals.bpm, sanity: game.stats.sanity, light: vm.light });
  notebook.update(dt, vm, w.note, w.inspect, () => {
    const changed = S.mapSeen !== map.version || game.player.speedNow > 0.05 || Math.abs(vm.sway.vx) > 0.01;
    S.mapSeen = map.version;
    return changed;
  });

  if (S.surface && game.time > S.surface.until) S.surface = null;
  S.captions = S.captions.filter((c) => game.time < c.until);
}

// After the world + view-model render and the PS1 post pass: crisp text on the full-res layer.
export function renderDiegetic(game) {
  if (!S) return;
  const { text, w, notebook, pockets, vm, left } = S;
  const ui = game.cfg.ui ?? {};
  const prompts = ui.textPrompts !== false;
  const tagShown = prompts && game.focus && !S.reading && !S.pocketsOpen && w.reach > 0.3;
  const anything = S.captions.length || S.surface || tagShown || w.note > 0.6 || w.inspect > 0.6 || w.pockets > 0.6;
  if (!anything && !text.dirty) return;
  text.begin();
  text.dirty = !!anything;

  const { W, H, margin: M } = text;
  const colW = Math.max(160, W * 0.34);          // centre column: verb tag + surface strip
  // reserve the tag's height (2 lines) so the surface strip never jumps or overlaps it
  const tagH = text.measure(['Mg', 'Mg'], { maxW: colW }).h;

  // notebook / inspected paper writing (projected onto the page in the view-model)
  if (w.note > 0.6 || w.inspect > 0.6) notebook.drawText(text, vm.camera, w.note, w.inspect);
  if (S.notebookOpen && prompts && w.note > 0.9 && notebook.pages.length > 1) {
    const kl = (a, d) => keyLabel(game.cfg.keys?.[a]?.[0] ?? d);
    text.tag(`${kl('left', 'KeyA')} ←  page  → ${kl('right', 'KeyD')}`, W / 2, H - M, { anchor: [0.5, 1], size: 0.8 });
  }

  // pocket name tags
  if (w.pockets > 0.6) { pockets.group.updateMatrixWorld(true); pockets.drawTags(text, vm.camera, w.pockets, left.torch); }

  // verb tag, bottom centre
  if (tagShown) {
    const inst = game.focus.inst;
    const key = keyLabel(game.cfg.keys?.interact?.[0] ?? 'KeyE');
    const verb = game.gameplay?.verbFor ? game.gameplay.verbFor(inst)?.verb : verbFor(inst, game.inventory?.held);
    if (verb) {
      text.tag([inst.name ?? inst.id, `${key} · ${verb.toLowerCase()}`], W / 2, H - M, {
        anchor: [0.5, 1], maxW: colW, opacity: Math.min(1, (w.reach - 0.3) * 2.5),
      });
    }
  }

  // surface writing: opaque strip in the centre column, above the (reserved) tag slot
  if (S.surface && !S.reading) {
    const fade = Math.min(1, (S.surface.until - game.time) * 3);
    const m = text.measure(S.surface.text, { maxW: colW });
    m.lines = m.lines.slice(0, 4);
    text.tag(null, W / 2, H - M - tagH - Math.round(M * 0.5), { m, anchor: [0.5, 1], opacity: fade, seed: 3 });
  }

  // captions: bottom-left column, newest at the bottom, stacking up; never into the centre column
  const capW = Math.max(150, W / 2 - colW / 2 - M * 2);
  let y = H - M;
  for (let i = S.captions.length - 1; i >= 0; i--) {
    const c = S.captions[i];
    const fade = Math.max(0, Math.min(1, (c.until - game.time) * 3, (game.time - c.born) * 6));
    const m = text.measure(c.text, { maxW: capW, size: 0.92 });
    m.lines = m.lines.slice(0, 3);
    const r = text.tag(null, M, y, { m, anchor: [0, 1], opacity: fade, seed: i + 11 });
    y = r.y - Math.round(M * 0.3);
  }
  text.end(); // grit: Bayer dither + 15-bit quantise over what was drawn
}

/**
 * Text look dial, 0 (crisp) .. 1 (full PS1 crunch). Live: no reload. The M6 notebook settings
 * page should call this too. Writes cfg.ui.textGrit.
 */
export function setTextGrit(v) {
  if (!S) return;
  const ui = (S.game.cfg.ui ??= {});
  ui.textGrit = Math.max(0, Math.min(1, Number(v) || 0));
  S.text.dirty = true;
}

// DEV: a small range slider (bottom-right) to dial the text look in live.
function mountGritSlider(game) {
  const box = document.createElement('label');
  Object.assign(box.style, {
    position: 'fixed', right: '8px', bottom: '8px', zIndex: 20, font: '11px monospace', color: '#d8cf8a',
    background: 'rgba(0,0,0,0.65)', padding: '4px 8px', display: 'flex', gap: '6px', alignItems: 'center',
  });
  const input = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.01 });
  input.value = game.cfg.ui?.textGrit ?? 0.4;
  const out = document.createElement('span');
  const sync = () => { setTextGrit(input.value); out.textContent = Number(input.value).toFixed(2); };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => e.stopPropagation());
  box.append('text grit', input, out);
  document.body.appendChild(box);
  sync();
}

function keyLabel(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Mouse0$/, 'Click');
}

/** Fallback verb (when M4's gameplay.verbFor is missing), from components and what's in hand. */
export function verbFor(inst, held) {
  const c = inst.def?.components ?? {};
  if (held) {
    const mine = held.def?.components?.combine ?? [];
    const theirs = c.combine ?? [];
    if (mine.some((r) => r.with === inst.id) || theirs.some((r) => r.with === held.id)) {
      return `use ${(held.def?.name ?? held.id).toLowerCase()}`;
    }
  }
  if (c.readable) return 'read';
  if (c.pickup) return 'pick up';
  if (c.door) return 'open';
  if (c.hide) return 'hide';
  if (c.interact) return c.interact.verb ?? 'use';
  if (c.use) return c.use.verb ?? 'use';
  return 'look';
}
