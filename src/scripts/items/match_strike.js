// Strike a match: params.seconds (default 10) of tiny warm light around you. Lights any candle
// within params.radius (default 1.8 m). The box holds params.uses (default 10).
import { getPower } from '../../power/network.js';

export default {
  id: 'match_strike',
  run(ctx, params) {
    const power = getPower();
    if (!power) return ctx.fail();
    const s = ctx.state.self;
    s.uses ??= params.uses ?? 10;
    if (s.uses <= 0) return ctx.fail('The box is empty.');
    const res = power.strikeMatch(ctx.player.pos, { duration: params.seconds ?? 10, radius: params.radius ?? 1.8 });
    ctx.sound.play('match_strike', { volume: 0.8 });
    s.uses--;
    if (res.candles.length) ctx.ui.caption('The wick takes the flame.', 2.5);
    else if (s.uses <= 0) ctx.ui.caption('Your last match.', 2.5);
    else if (s.uses <= 3) ctx.ui.caption(`${s.uses} matches left.`, 2);
    return ctx.ok({ consume: s.uses <= 0 });
  },
};
