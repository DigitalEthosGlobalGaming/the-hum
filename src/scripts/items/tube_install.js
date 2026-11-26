// Spare fluorescent tube into a dead ceiling fixture.
//  combine: the rule lives on light_fixture (self = the fixture inst, other = the tube).
//  use:     looking up at a dead fixture within reach (params.reach, default 2.6 m from the eye).
import { getPower } from '../../power/network.js';

function aimedFixture(ctx, reach) {
  const eye = ctx.player.eye, f = ctx.player.forward();
  let best = null, bestDot = 0.93;
  for (const inst of ctx.world.findById('light_fixture')) {
    const c = inst.center ?? inst.root.position;
    const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > reach) continue;
    const dot = (dx * f.x + dy * f.y + dz * f.z) / d;
    if (dot > bestDot) { bestDot = dot; best = inst; }
  }
  return best;
}

export default {
  id: 'tube_install',
  run(ctx, params) {
    const power = getPower();
    if (!power) return ctx.fail();
    const target = ctx.verb === 'combine' ? ctx.self : aimedFixture(ctx, params.reach ?? 2.6);
    if (!target || target.id !== 'light_fixture') return ctx.fail('Look up at a dead fixture to fit it.');
    if (!power.installTube(target)) return ctx.fail('That one is working.');
    ctx.sound.play('battery_click', { at: target });
    ctx.ui.caption(params.caption ?? 'You twist the tube into the pins. It ticks, stutters, holds.', 3);
    ctx.stats.add('sanity', 0.03);
    return ctx.ok({ consume: ctx.verb === 'combine' ? 'other' : true });
  },
};
