// ID badges: each is an earlier wanderer (seeded name, role, number, tiny face). Picking one up or
// reading it adds a "wanderer" page to the notebook and records it in ctx.state.run.badges
// (a Set of badge ids; future keycard doors read it, and runState.badgeInfo[id].clearance).
import { hash } from '../core/rng.js';
import { story, stateOf, runState, onInstance, onReady, canvasTex, makeCanvas } from './runtime.js';
import { makePS1Material } from '../render/ps1.js';
import { wandererFor, wandererText, drawFace } from './wanderers.js';
import { addWandererPage } from './pages.js';

export const CARD_PART = 0; // the card box in the id_badge prefab

/** Make sure a badge (world inst state or item stack state) has a seed; returns its wanderer. */
export function badgeIdentity(state, fallbackKey, seed, lines) {
  state.seed ??= hash(seed >>> 0, 'badge', fallbackKey ?? 'loose');
  return wandererFor(state.seed, lines);
}

/** Record a badge in the run and add its notebook page. */
export function collectBadge(w, run, { open = false } = {}) {
  run.badges ??= new Set();
  run.badgeInfo ??= {};
  run.badges.add(w.id);
  run.badgeInfo[w.id] = { name: w.name, role: w.role, clearance: w.clearance };
  return addWandererPage(w, wandererText(w), { open });
}

onInstance('id_badge', (inst, game) => {
  const st = stateOf(inst);
  const w = badgeIdentity(st, story.gp.stableKey(inst) ?? `uid:${inst.uid}`, game.seed, game.content.lines);
  const card = inst.root.children[CARD_PART];
  if (!card) return;
  const [c, g] = makeCanvas(24, 36);
  g.fillStyle = '#efece2'; g.fillRect(0, 0, 24, 36);
  g.fillStyle = '#3d5a7a'; g.fillRect(0, 0, 24, 5);
  drawFace(g, 4, 7, 16, 18, w.face);
  g.fillStyle = '#333'; g.fillRect(3, 28, 18, 1); g.fillRect(3, 31, 12, 1);
  g.fillStyle = '#b02a20'; g.fillRect(18, 30, 4, 4);
  card.material = makePS1Material(canvasTex(c));
});

onReady((game) => {
  game.events.on('item:pickup', ({ id, stack } = {}) => {
    if (id !== 'id_badge' || !stack) return;
    const w = badgeIdentity(stack.state ??= {}, `stack:${runState().badgeLoose = (runState().badgeLoose ?? 0) + 1}`, game.seed, game.content.lines);
    collectBadge(w, runState());
  });
});
