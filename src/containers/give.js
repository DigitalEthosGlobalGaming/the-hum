// Hand a rolled item to the player: into the pockets if there's room, else into the world at `spot()`.
// Every item gets `state.seed` derived from where it came from, so items with a per-item identity
// (ID badges) stay the same for that drawer / coin in this run.
import { hash } from '../core/rng.js';

/** Pool context for container rolls (depth-gated entries work like room spots). */
export function poolCtx(ctx, pos) {
  return { depth: ctx.world.depthAt(pos.x, pos.z), zone: 'lobby' };
}

/**
 * @param ctx   script ctx
 * @param id    object id
 * @param spot  () => {x,y,z} world point used when the pockets are full (or opts.place)
 * @param opts  { from: string (seed source), place?: bool (always place in the world), rotY? }
 * @returns 'hand' | 'world'
 */
export function giveOrPlace(ctx, id, spot, opts = {}) {
  const state = { seed: hash(ctx.seed, 'item', opts.from ?? id) };
  const name = (ctx.content.objects?.[id]?.name ?? id).toLowerCase();
  if (!opts.place) {
    const sel = ctx.inventory.selected;
    const index = ctx.inventory.freeIndexFor(id, sel);
    if (index >= 0) {
      ctx.inventory.add(id, state, { index, select: index === sel });
      ctx.emit('item:pickup', { id, stack: ctx.inventory.slots[index] });
      ctx.ui.caption(`You take the ${name}.`, 2.5);
      return 'hand';
    }
  }
  const p = spot();
  ctx.world.spawn(id, { x: p.x, y: p.y, z: p.z }, opts.rotY ?? 0, { persist: true, state });
  if (!opts.place) ctx.ui.caption(`A ${name}. Your pockets are full.`, 2.5);
  return 'world';
}
