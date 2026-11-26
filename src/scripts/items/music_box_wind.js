// Music box. E on the floor: wind it (it plays where it stands), or, while it plays, take it with
// you. Use while held: wind it in your hands. For params.seconds (30) it plays a tinny melody and
// keeps a calm aura of params.radius (5 m): sanity doesn't drain there and the Tenant stays out.
import { getPower } from '../../power/network.js';

export default {
  id: 'music_box_wind',
  run(ctx, params) {
    const power = getPower();
    if (!power) return ctx.fail();
    const s = ctx.state.self;
    const inWorld = !!ctx.self?.root;
    const playing = (s.playUntil ?? 0) > power.clock;
    if (inWorld && playing) {
      // pick it up still playing (the aura follows you)
      if (!ctx.inventory.add(ctx.self.id, { ...s })) return ctx.fail('Your pockets are full.');
      ctx.world.remove(ctx.self);
      return ctx.ok();
    }
    if (!inWorld && playing) return ctx.fail('It is still playing.');
    ctx.sound.play('music_box_wind', { volume: 0.7 });
    power.windMusicBox(s, inWorld ? ctx.self : null, ctx.player.pos, { duration: params.seconds ?? 30, radius: params.radius ?? 5 });
    ctx.ui.caption(params.caption ?? 'You wind the key. A thin little tune.', 2.5);
    return ctx.ok({ consume: false });
  },
};
