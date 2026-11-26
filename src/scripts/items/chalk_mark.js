// Draw a chalk mark on the wall or floor in front of you (player-made wayfinding, persists).
// params: { mark = "chalk_mark", floorMark = "chalk_mark_floor", uses = 12, reach = 2 }
export default {
  id: 'chalk_mark',
  run(ctx, params) {
    const hit = ctx.world.castFromEye(params.reach ?? 2);
    if (!hit) return ctx.fail('Nothing close enough to draw on.');
    const s = ctx.state.self;
    s.uses ??= params.uses ?? 12;
    if (hit.surface === 'wall') {
      const h = 0.3; // mark plane height; a plane's origin is its bottom edge
      const pos = {
        x: hit.point.x + hit.normal.x * 0.012,
        y: Math.max(0.05, hit.point.y - h / 2),
        z: hit.point.z + hit.normal.z * 0.012,
      };
      ctx.world.spawn(params.mark ?? 'chalk_mark', pos, ctx.world.yawFacing(hit.normal), { persist: true });
    } else {
      // floor arrows point the way you were facing
      ctx.world.spawn(params.floorMark ?? 'chalk_mark_floor', hit.point, ctx.player.yaw, { persist: true });
    }
    ctx.sound.play('paper_rustle', { volume: 0.6 });
    s.uses--;
    if (s.uses <= 0) ctx.ui.caption('The chalk crumbles to nothing.');
    return ctx.ok({ consume: s.uses <= 0 });
  },
};
