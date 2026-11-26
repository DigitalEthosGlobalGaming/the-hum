// Matches + candle (rule on candle: self = the candle, other = the matches). The candle becomes a
// small permanent light; one match is used. params: { uses? } (a fresh box's count)
import { getPower } from '../../power/network.js';

export default {
  id: 'candle_light',
  run(ctx, params) {
    const power = getPower();
    if (!power || !ctx.self?.root) return ctx.fail();
    const m = ctx.state.other ?? {};
    m.uses ??= params.uses ?? 10;
    if (m.uses <= 0) return ctx.fail('The box is empty.');
    if (!power.lightCandle(ctx.self)) return ctx.fail('It is already lit.');
    ctx.sound.play('match_strike', { volume: 0.8 });
    m.uses--;
    ctx.ui.caption('A small flame. It is enough.', 2.5);
    return ctx.ok({ consume: m.uses <= 0 ? 'other' : 'none' });
  },
};
