// Strike a match: a short-lived warm, flickering light that follows you (a timed light in the
// power network's per-vertex light pool), a strike + burning sound, a lit match in the right hand
// (src/viewmodel/matchFlame.js shows it while the light lives), a little calm if it was dark, and
// any candle within params.radius takes the flame. The box holds params.uses matches; one per strike.
// params: { uses = 10, seconds = 12, radius = 2, range = 6, color = [r,g,b], flicker = 0.35,
//           sanity = 0.04 (only when struck in the dark), darkBelow = 0.18, noise = 2 }
import { getPower } from '../../power/network.js';

let burning = null; // the burn loop of the match in hand (one at a time)

export default {
  id: 'match_strike',
  run(ctx, params) {
    const power = getPower();
    if (!power) return ctx.fail();
    const s = ctx.state.self;
    s.uses ??= params.uses ?? 10;
    if (s.uses <= 0) return ctx.fail('The box is empty.');
    const pos = ctx.player.pos;
    // was it dark before the flame? (vitals uses the same 0.18 threshold)
    const dark = ctx.world.lightAt({ x: pos.x, y: pos.y + 1.2, z: pos.z }) < (params.darkBelow ?? 0.18);
    // one match at a time: a fresh strike snuffs the one still burning
    for (const L of power.timed.lights) if (L.kind === 'match') L.until = Math.min(L.until, power.clock);
    burning?.stop?.(0.1);

    const seconds = params.seconds ?? 12;
    const res = power.strikeMatch(pos, { duration: seconds, radius: params.radius ?? 2 });
    // brighter and wider than the network's default so it reads through the per-vertex lighting
    Object.assign(res.light, {
      kind: 'match',
      range: params.range ?? 6,
      color: [...(params.color ?? [1.7, 1.05, 0.45])],
      flicker: params.flicker ?? 0.35,
      pos: { x: pos.x, y: pos.y + 1.2, z: pos.z },
    });
    ctx.sound.play('match_strike', { volume: 0.9 });
    const h = ctx.sound.play('match_burn', { volume: 0.5, loop: true });
    burning = h;
    ctx.timer.after(seconds, () => { h?.stop?.(0.6); if (burning === h) burning = null; });
    ctx.world.noise(pos, params.noise ?? 2, 'match');
    if (dark) ctx.stats.add('sanity', params.sanity ?? 0.04);

    s.uses--;
    if (res.candles.length) ctx.ui.caption('The wick takes the flame.', 2.5, 'match');
    else if (s.uses <= 0) ctx.ui.caption('Your last match.', 2.5, 'match');
    else ctx.ui.caption(`${s.uses} match${s.uses === 1 ? '' : 'es'} left.`, 2, 'match');
    return ctx.ok({ consume: s.uses <= 0 });
  },
};
