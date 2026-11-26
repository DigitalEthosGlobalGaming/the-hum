// Crack a glow stick and drop it: a green light marker for params.seconds (default 300) of play.
// The pack holds params.uses (default 3). The marker persists with its room (world.run.placed).
import { getPower } from '../../power/network.js';

export default {
  id: 'glow_stick_crack',
  run(ctx, params) {
    const power = getPower();
    const s = ctx.state.self;
    s.uses ??= params.uses ?? 3;
    const p = ctx.world.dropPoint();
    const expiresAt = power ? power.expiresIn(params.seconds ?? 300) : null;
    ctx.world.spawn(params.marker ?? 'glow_marker', p, ctx.rng.range(0, Math.PI * 2), { persist: true, state: { expiresAt } });
    ctx.sound.play('glowstick_crack', { volume: 0.8 });
    power?.world.noise(p, params.noise ?? 3, 'glow_stick');
    s.uses--;
    if (s.uses <= 0) ctx.ui.caption('That was the last one.', 2.5);
    return ctx.ok({ consume: s.uses <= 0 });
  },
};
