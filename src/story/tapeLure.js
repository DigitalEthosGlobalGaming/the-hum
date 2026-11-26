// Tape recorder with a blank tape: record 10 s (a red light while it records), play it back, and drop
// it while it's playing (or recording) to leave a lure: looping noise events at that spot for 20 s.
// Recorder state: { blank, recording, recorded, heard: [noise sources] }.
import { story, onReady, onUpdate, tempLight, caption, sound, playing } from './runtime.js';
import { describeNoise } from './walkie.js';

export const RECORD_S = 10;
export const LURE_S = 20;
export const LURE_LOUDNESS = 14;

const R = { rec: null, play: new Map(), lures: [] }; // rec: { st, left, light }; play: state → { handle, left }

export const isRecording = (st) => R.rec?.st === st;
export const isPlayingBack = (st) => R.play.has(st);

export function startRecording(st) {
  st.recording = true;
  st.heard = [];
  R.rec = { st, left: RECORD_S, light: null, shown: -1 };
}

export function stopRecording(st, { quiet = false } = {}) {
  if (R.rec?.st !== st) return;
  st.recording = false;
  st.recorded = true;
  if (R.rec.light) R.rec.light.range = 0;
  R.rec = null;
  if (quiet) return;
  sound('battery_click', { volume: 0.4 });
  caption(`(recorded: ${heardText(st)})`, 3, 'tape-rec');
}

export function heardText(st) {
  const h = [...new Set(st.heard ?? [])].slice(0, 3).map(describeNoise);
  return h.length ? h.join(', ') : 'hiss, and your own breathing';
}

/** Toggle playback of the recording while held. Returns true if it's now playing. */
export function togglePlayback(st) {
  const p = R.play.get(st);
  if (p) { p.handle?.stop?.(0.15); R.play.delete(st); story.gp?.clearCaption('tape-play'); return false; }
  R.play.set(st, { handle: sound('tape_lure', { loop: true, volume: 0.5 }), left: RECORD_S });
  caption(`(the tape plays back: ${heardText(st)})`, 4, 'tape-play');
  return true;
}

onReady((game) => {
  game.events.on('world:noise', (n) => {
    const r = R.rec;
    if (!r || !n || n.source === 'tape_lure') return;
    const p = game.player.pos;
    if (Math.hypot(n.x - p.x, n.z - p.z) < Math.max(4, n.loudness)) r.st.heard.push(n.source);
  });
  // Dropping always works (interaction.dropHeld). If the recorder was recording or playing back,
  // it keeps going on the floor as a lure; nothing it does stays attached to your hand.
  game.events.on('item:drop', ({ id, stack, inst } = {}) => {
    if (id !== 'tape_recorder' || !stack?.state) return;
    const r = inst?.root?.position;
    recorderDropped(stack.state, r ? { x: r.x, y: r.y, z: r.z } : game.gameplay.dropPoint());
  });
});

/**
 * A recorder with state `st` was just dropped at `pos`. Recording → the recording stops (keeping
 * what it heard) and plays back on the floor as a lure; playing back → it carries on as a lure.
 * Idle recorders just lie there. Returns the lure, or null.
 */
export function recorderDropped(st, pos) {
  const wasRecording = R.rec?.st === st;
  if (wasRecording) stopRecording(st, { quiet: true });
  const p = R.play.get(st);
  if (!p && !wasRecording) return null;
  if (p) { p.handle?.stop?.(0.1); R.play.delete(st); }
  story.gp?.clearCaption('tape-play');
  story.gp?.clearCaption('tape-rec');
  const lure = { st, pos: { x: pos.x, y: pos.y ?? 0, z: pos.z }, left: LURE_S, tick: 0, handle: sound('tape_lure', { at: pos, loop: true, volume: 1 }) };
  R.lures.push(lure);
  caption(wasRecording ? '(you set it down. It clicks over and plays back what it heard.)' : '(you leave it playing on the floor)', 2.5, 'tape-lure');
  return lure;
}

/** Does a dropped recorder with this state still lie in the world (or in a streamed-out room)? */
function stillPlaced(game, st) {
  for (const e of game.world.run.placed?.values() ?? []) if (e.state === st) return true;
  return false;
}

onUpdate((dt, game) => {
  if (!playing()) return;
  // the red light lives in your hand: if the recorder left the pockets some other way, stop
  if (R.rec && !game.inventory?.slots?.some((s) => s?.state === R.rec.st)) stopRecording(R.rec.st);
  const r = R.rec;
  if (r) {
    r.left -= dt;
    const eye = game.camera.position;
    const blink = Math.floor(r.left * 2) % 2 === 0;
    if (!r.light || r.light.range === 0) r.light = tempLight(eye, '#ff2010', 2.2, r.left + 0.1, { fade: false });
    if (r.light) {
      r.light.pos.set(eye.x, eye.y - 0.4, eye.z);
      r.light.color.setRGB(blink ? 1.2 : 0.4, 0.06, 0.03);
    }
    const sec = Math.ceil(r.left);
    if (sec !== r.shown) { r.shown = sec; caption(`● REC  0:${String(RECORD_S - sec).padStart(2, '0')}`, 1.5, 'tape-rec'); }
    if (r.left <= 0) stopRecording(r.st);
  }
  for (const [st, p] of R.play) {
    p.left -= dt;
    if (p.left <= 0) { p.handle?.stop?.(0.2); R.play.delete(st); sound('battery_click', { volume: 0.35 }); }
  }
  for (let i = R.lures.length - 1; i >= 0; i--) {
    const L = R.lures[i];
    L.left -= dt;
    L.tick -= dt;
    const gone = !stillPlaced(game, L.st);
    if (L.tick <= 0 && !gone) { L.tick = 1; game.world.noise(L.pos, LURE_LOUDNESS, 'tape_lure'); }
    if (L.left <= 0 || gone) {
      L.handle?.stop?.(0.3);
      if (!gone) sound('battery_click', { at: L.pos, volume: 0.5 });
      R.lures.splice(i, 1);
    }
  }
});

export const lures = () => R.lures;
