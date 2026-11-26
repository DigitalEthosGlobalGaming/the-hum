// Walkie-talkie: static while it's on and in your pockets. The static swells with nearby noise
// (world:noise) and with game.dangerLevel (0..1, the Tenant sets it later). Now and then another
// wanderer gets through: a caption from content/lines/walkie_hints (seeded order per run).
// A second walkie left switched on somewhere relays what it hears near it as captions.
import { Rng, hash } from '../core/rng.js';
import { story, stateOf, runState, onReady, onUpdate, carried, caption, sound, playing } from './runtime.js';

const ID = 'walkie_talkie';
const W = { handle: null, level: 0, spike: 0, nextVoice: 25, lastRelay: new Map() };

const SOURCES = {
  footstep: 'footsteps', drawer: 'a drawer sliding', drawer_rattle: 'something rattling', vending: 'a machine clunking',
  typewriter: 'typing', camera_flash: 'a click, and a whine like a charging flash', tape_lure: 'a voice. yours, maybe',
  clatter: 'something falling over', chair: 'a chair rolling', door: 'a door', string: 'string snapping',
};
export const describeNoise = (src) => SOURCES[src] ?? (src && src !== 'unknown' ? String(src).replace(/_/g, ' ') : 'something moving');

/** On walkies you are carrying. */
const liveCarried = () => carried(ID).filter((s) => s.state?.on);

/** Next hint line for this run (seeded shuffle, walks through all before repeating). */
export function hintAt(lines, seed, n) {
  if (!lines.length) return '...';
  const order = lines.map((_, i) => i);
  const r = new Rng(hash(seed >>> 0, 'walkie'));
  for (let i = order.length - 1; i > 0; i--) { const j = r.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
  return lines[order[n % order.length]];
}

onReady((game) => {
  game.events.on('world:noise', (n) => {
    if (!n || n.source === 'walkie') return;
    const p = game.player.pos;
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < n.loudness) W.spike = Math.max(W.spike, Math.min(1, (1 - d / n.loudness) * (n.loudness / 12)));
    relay(game, n, d);
  });
});

// A switched-on walkie lying in the world relays sounds near it (that you couldn't hear yourself).
function relay(game, n, dPlayer) {
  if (!liveCarried().length || dPlayer < 9) return;
  for (const inst of game.world.objects.instances) {
    if (inst.id !== ID || !stateOf(inst)?.on) continue;
    const q = inst.root.position;
    const d = Math.hypot(n.x - q.x, n.z - q.z);
    if (d > Math.max(6, n.loudness)) continue;
    const key = inst.uid + ':' + n.source;
    if (game.time - (W.lastRelay.get(key) ?? -99) < 5) return;
    W.lastRelay.set(key, game.time);
    sound('walkie_click', { volume: 0.6 });
    W.spike = Math.max(W.spike, 0.6);
    caption(`(walkie, from where you left the other one) ...${describeNoise(n.source)}${d < 2.5 ? ', right next to it' : ''}.`, 4, 'walkie-relay');
    return;
  }
}

onUpdate((dt, game) => {
  const on = playing() && liveCarried().length > 0;
  if (!on) {
    if (W.handle) { W.handle.stop?.(0.2); W.handle = null; }
    return;
  }
  W.spike = Math.max(0, W.spike - dt * 0.6);
  const danger = Math.max(0, Math.min(1, game.dangerLevel ?? 0));
  const target = Math.min(1.4, 0.22 + W.spike * 0.7 + danger * 0.9 + (danger > 0.6 ? Math.random() * 0.3 : 0));
  W.level += (target - W.level) * Math.min(1, dt * 6);
  if (!W.handle?.playing) W.handle = sound('walkie_static', { loop: true, volume: W.level });
  else W.handle.setVolume?.(W.level, 0.08);
  // someone else, somewhere, keying their radio
  W.nextVoice -= dt;
  if (W.nextVoice <= 0) {
    const run = runState();
    const n = (run.walkieHint = (run.walkieHint ?? 0) + 1);
    const r = new Rng(hash(game.seed >>> 0, 'walkieGap', n));
    W.nextVoice = r.range(35, 80);
    const line = hintAt(game.content.lines?.walkie_hints?.lines ?? [], game.seed, n - 1);
    sound('walkie_voice', { volume: 0.8 });
    W.spike = 1;
    game.gameplay.after(0.5, () => caption(`(a voice on the walkie) "...${line}..."`, Math.max(4, Math.min(8, line.length * 0.07)), 'walkie'));
  }
});

/** Toggle a walkie (the use script). Returns the new on state. */
export function toggleWalkie(st) {
  st.on = !st.on;
  if (st.on) W.nextVoice = Math.min(W.nextVoice, 12 + ((story.time * 7) % 9)); // first voice comes soonish
  return st.on;
}
