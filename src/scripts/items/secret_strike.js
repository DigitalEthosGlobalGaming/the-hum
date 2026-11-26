// Secret "Strike" (content/secrets/strike.json): three bins or wet-floor signs knocked over within
// half a minute. Somewhere far off, a polite little bell; a coin rolls out of the last one.
// params: { reward = 'coin', caption }
export default {
  id: 'secret_strike',
  run(ctx, params) {
    const inst = params.event?.inst;
    const at = inst?.root ? inst.root.position : ctx.player.pos;
    const yaw = ctx.player.yaw;
    // a little toward the player (forward is (-sin yaw, -cos yaw))
    ctx.world.spawn(params.reward ?? 'coin', { x: at.x + Math.sin(yaw) * 0.3, y: 0, z: at.z + Math.cos(yaw) * 0.3 }, yaw, { persist: true });
    ctx.sound.play('typewriter_bell', { at: 'player', volume: 0.35 });
    ctx.timer.after(0.4, () => ctx.ui.caption(params.caption ?? '(far away, one person claps. Then stops.)', 3.5, 'secret:strike'));
    return ctx.ok({ consume: false });
  },
};
