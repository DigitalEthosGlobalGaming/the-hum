// Fuse + fuse box. The rule lives on fuse_box, so self = the box. params: { caption? }
// Sets box state { powered, poweredAt } (persisted per run) for later systems to read.
export default {
  id: 'fuse_insert',
  run(ctx, params) {
    const box = ctx.state.self;
    if (box.powered) return ctx.fail('There is already a fuse in it.');
    box.powered = true;
    box.poweredAt = ctx.time;
    ctx.sound.play('battery_click');
    ctx.timer.after(0.4, () => ctx.sound.play('fluoro_flicker_buzz', { volume: 0.8 }));
    ctx.ui.caption(params.caption ?? 'A heavy clunk. Somewhere, the hum changes key.', 4);
    ctx.stats.add('sanity', 0.05);
    return ctx.ok();
  },
};
