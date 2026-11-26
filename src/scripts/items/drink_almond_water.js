// Almond water: calms you down. params: { sanity = 0.25, caption? }
export default {
  id: 'drink_almond_water',
  run(ctx, params) {
    ctx.stats.add('sanity', params.sanity ?? 0.25);
    ctx.sound.play('bottle_drink');
    if (params.caption) ctx.ui.caption(params.caption);
    return ctx.ok({ consume: true });
  },
};
