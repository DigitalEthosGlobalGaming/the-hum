// M5 entry point: the diegetic kit. Hands + torch (LEDs), held item, hand prompt + paper tag,
// watch, notebook (auto-map + notes), pockets, vitals, captions.
// install() once; update() each frame; render() after the world render.
//
// Rendering: the view-model scene and the screen-space paper scene are registered as overlays on
// game.renderer (PS1Renderer.addOverlay), so main's single renderer.render() call draws them into
// the same low-res target right after the world (depth cleared) and before the dither/post pass.
import { ViewModel, damp } from '../../viewmodel/viewModel.js';
import { Flashlight } from '../../viewmodel/flashlight.js';
import { LeftArm, RightArm } from '../../viewmodel/arms.js';
import { Vitals } from '../../vitals/vitals.js';
import { Watch } from './watch.js';
import { Notebook } from './notebook.js';
import { Pockets } from './pockets.js';
import { SeenMap } from './automap.js';
import { PaperOverlay } from './paperOverlay.js';
import { installInputGate } from './inputGate.js';
import { installInventoryStub, updateInventoryStub } from './devStub.js';
import { wrapText, makeCanvas, HAND_FONT } from './text.js';

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
  const paper = new PaperOverlay(game);
  const map = new SeenMap();
  const vitals = new Vitals(game);

  S = {
    game, gate, vm, flashlight, left, right, watch, notebook, pockets, paper, map, vitals,
    w: { watch: 0, note: 0, pockets: 0, inspect: 0, reach: 0 },
    notebookOpen: false, inspect: false, pocketsOpen: false, watchUp: false,
    captions: [], surface: null, mapSeen: -1, inv: game.inventory ?? null,
    measure: makeCanvas(4, 4)[1],
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
      S.inspect = false;
      game.synth?.play?.('paper_rustle', { volume: 0.7 });
    }
  });
  ev.on('ui:caption', (p) => pushCaption(p?.text ?? '', p?.seconds ?? 3));
  ev.on('game:resize', () => { vm.resize(); paper.resize(); });

  right.onInventoryChange();
  right.swap = 0.99; // first item appears from below
  if (__DEV__) window.__humDiegetic = S;
}

function pushCaption(text, seconds = 3, system = false) {
  if (!S || !text) return;
  if (!system && S.game.cfg.ui?.captions === false) return;
  S.captions.push({ text: String(text), until: S.game.time + seconds, seconds });
  if (S.captions.length > 4) S.captions.shift();
}

export function updateDiegetic(game, dt) {
  if (!S) return;
  const { gate, vm, flashlight, left, right, watch, notebook, pockets, paper, map, vitals, w } = S;
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
  const reading = S.notebookOpen || S.inspect;
  S.pocketsOpen = playing && !reading && raw.held('pockets');
  S.watchUp = playing && !reading && !S.pocketsOpen && raw.held('watch');

  // gate other systems' input for the next frame
  gate.blocked.clear();
  if (reading) for (const a of [...MOVE, 'interact', 'use', 'drop']) gate.blocked.add(a);
  if (S.pocketsOpen) { gate.blocked.add('use'); gate.blocked.add('drop'); }
  if (vitals.exhausted) gate.blocked.add('sprint');
  gate.blockLook = S.pocketsOpen;

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
  left.update(vm, { watch: w.watch, hidden: Math.max(busy, w.pockets) });
  const pointAt = pockets.update(dt, w.pockets, raw, gate.look);
  right.pointAt.copy(pointAt);
  right.update(vm, dt, { reach: w.reach, hidden: busy, pockets: w.pockets });
  watch.update(dt, w.watch, { bpm: vitals.bpm, sanity: game.stats.sanity, light: vm.light });
  notebook.update(dt, vm, w.note, w.inspect, () => {
    const changed = S.mapSeen !== map.version || game.player.speedNow > 0.05 || Math.abs(vm.sway.vx) > 0.01;
    S.mapSeen = map.version;
    return changed;
  });

  // ── paper overlay: captions, prompt tag, surface lines, pocket tags ──
  paper.begin();
  drawCaptions(game);
  if (S.surface && game.time > S.surface.until) S.surface = null;
  if (S.surface && !reading) {
    const lines = wrapText(S.measure, S.surface.text, paper.W * 0.6, `bold ${Math.round(10 * paper.scale)}px ${HAND_FONT}`).slice(0, 4);
    const fade = Math.min(1, (S.surface.until - game.time) * 2);
    paper.draw(lines, paper.W / 2, Math.round(paper.H * 0.2), { anchor: [0.5, 0], size: 10, key: 'surf', opacity: fade, color: '#cfc6aa' });
  }
  if (ui.textPrompts !== false && game.focus && !reading && !S.pocketsOpen && w.reach > 0.3) {
    const inst = game.focus.inst;
    const key = keyLabel(game.cfg.keys?.interact?.[0] ?? 'KeyE');
    paper.draw([inst.name ?? inst.id, `${key} · ${verbFor(inst, game.inventory?.held)}`], paper.W / 2, 8, {
      anchor: [0.5, 0], size: 10, key: 'tag', opacity: Math.min(1, (w.reach - 0.3) * 2.5),
    });
  }
  if (S.notebookOpen && ui.textPrompts !== false && w.note > 0.9 && notebook.pages.length > 1) {
    paper.draw(['A ◂  ▸ D'], paper.W / 2, 3, { anchor: [0.5, 0], size: 8, key: 'flip', color: '#b9b19a' });
  }
  if (w.pockets > 0.6) { pockets.group.updateMatrixWorld(true); pockets.drawTags(paper, vm.camera, w.pockets); }
  paper.end();
}

export function renderDiegetic(game) {
  // Nothing to do: both diegetic passes are PS1Renderer overlays, already drawn inside main's
  // renderer.render() into the low-res target before the dither pass. Kept as the hook for M6
  // (CRT title / settings pages) per the contract.
}

function drawCaptions(game) {
  const { paper } = S;
  S.captions = S.captions.filter((c) => game.time < c.until);
  let y = 6;
  for (let i = S.captions.length - 1; i >= 0; i--) {
    const c = S.captions[i];
    const lines = wrapText(S.measure, c.text, paper.W * 0.42, `bold ${Math.round(9 * paper.scale)}px ${HAND_FONT}`).slice(0, 3);
    const fade = Math.min(1, (c.until - game.time) * 2, (game.time - (c.until - c.seconds)) * 6);
    const r = paper.draw(lines, 6, y, { anchor: [0, 0], size: 9, key: 'cap', opacity: fade, color: '#cbc2a4' });
    y += r.h + 2;
  }
}

function keyLabel(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Mouse0$/, 'Click');
}

/** Verb for the interaction tag, from the target's components (and what's in hand). */
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
