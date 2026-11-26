// Fuse + fuse box. The rule lives on fuse_box, so self = the box. params: { caption? }
// Sets box state { powered, poweredAt } (persisted per run) and tells the power network: the room's
// circuits come on and every dead tube in the room and its neighbours stutters back to life.
import { getPower } from '../../power/network.js';

export default {
  id: 'fuse_insert',
  run(ctx, params) {
    const box = ctx.state.self;
    if (box.powered) return ctx.fail('There is already a fuse in it.');
    box.powered = true;
    box.poweredAt = ctx.time;
    ctx.sound.play('battery_click');
    const p = ctx.self?.root?.position;
    const res = p ? getPower()?.fuseInserted(p) : null;
    if (!res) ctx.timer.after(0.4, () => ctx.sound.play('fluoro_flicker_buzz', { volume: 0.8 }));
    ctx.ui.caption(params.caption ?? (res?.revived
      ? 'A heavy clunk. One by one, the dead tubes stutter on.'
      : 'A heavy clunk. Somewhere, the hum changes key.'), 4);
    ctx.stats.add('sanity', 0.05);
    return ctx.ok();
  },
};
