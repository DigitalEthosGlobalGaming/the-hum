// Coin + vending machine (E with a coin held, or the combine rule). The coin always goes in; then the
// machine rolls its vend pool for this coin (seeded per machine and coin number). Sometimes it eats
// the coin, sometimes the wrong thing drops. Vended items land in the tray.
// params: { eatenLines?, wrongLines? }
import { vend } from '../../containers/logic.js';
import { traySpot } from '../../containers/component.js';
import { giveOrPlace, poolCtx } from '../../containers/give.js';

const EATEN = [
  'It swallows the coin. The hum changes pitch, then nothing.',
  'Clunk. The coin is gone. Nothing comes out.',
  'It keeps the coin. Something inside counts it.',
];
const WRONG = [
  "B4 rattles down. You didn't choose anything.",
  "That's not what was in the window.",
  "Something drops. It isn't a snack.",
];

export default {
  id: 'vend_coin',
  run(ctx, params) {
    const machine = ctx.self?.root ? ctx.self : ctx.other; // the rule may live on either side
    const cfg = machine?.def?.components?.container;
    if (!cfg?.vend) return ctx.fail();
    const st = machine === ctx.self ? ctx.state.self : ctx.state.other;
    const key = ctx.world.keyOf(machine) ?? `uid:${machine.uid}`;
    const p = machine.root.position;
    const res = vend(st, cfg, { seed: ctx.seed, key, pools: ctx.content.pools ?? {}, ctx: poolCtx(ctx, p) });
    ctx.sound.play('coin_insert', { at: machine });
    ctx.world.noise(p, 7, 'vending');
    if (res.outcome === 'eaten') {
      const l = params.eatenLines ?? EATEN;
      ctx.timer.after(0.7, () => ctx.ui.caption(l[(res.coin - 1) % l.length], 3.5, 'vend'));
      return ctx.ok();
    }
    ctx.timer.after(0.9, () => {
      ctx.sound.play('vend_clunk', { at: machine });
      ctx.world.noise(p, 9, 'vending');
      res.items.forEach((id, n) => giveOrPlace(ctx, id, () => traySpot(machine, cfg), {
        from: `${key}/coin${res.coin}/${n}`, place: true, rotY: machine.root.rotation.y,
      }));
      const l = params.wrongLines ?? WRONG;
      if (res.outcome === 'wrong') ctx.ui.caption(l[(res.coin - 1) % l.length], 3.5, 'vend');
      else ctx.ui.caption('Something drops into the tray.', 2.5, 'vend');
    });
    return ctx.ok();
  },
};
