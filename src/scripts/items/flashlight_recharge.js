// Battery → torch. The torch lives in the left hand (game.flashlight, no pocket), so this runs from
// a held battery's `use` or from the battery + flashlight combine rule. params: { amount = 1 }
export default {
  id: 'flashlight_recharge',
  run(ctx, params) {
    const torch = ctx.flashlight;
    if (!torch) return ctx.fail('Nothing to put it in.');
    if (torch.battery >= 0.98) return ctx.fail('The torch is already full.');
    torch.recharge(params.amount ?? 1);
    ctx.sound.play('battery_click');
    return ctx.ok({ consume: true });
  },
};
