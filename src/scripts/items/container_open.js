// E on a container. Filing cabinet: opens the drawer you're aiming at (rolled once per run, seeded
// by the cabinet's stable key); one drawer may be stuck. Vending machine without a coin: a knock.
// params: { emptyLine?, stuckLines?, noCoinLine? }
import { openCompartment, compartmentsOf, aimedCompartment } from '../../containers/logic.js';
import { drawerSpot, rattle, drawerLayout } from '../../containers/component.js';
import { giveOrPlace, poolCtx } from '../../containers/give.js';

const STUCK = [
  "It's stuck. Something inside shifts.",
  "The drawer won't give. It rattles like it's full.",
  'Stuck. You hear paper slide inside.',
];

export default {
  id: 'container_open',
  run(ctx, params) {
    const inst = ctx.self;
    const cfg = inst?.def?.components?.container;
    if (!cfg) return ctx.fail();
    if (cfg.vend) {
      ctx.sound.play('drawer_stuck', { volume: 0.35 });
      return ctx.fail(params.noCoinLine ?? 'The glass is cold. It wants a coin.');
    }
    const p = inst.root.position;
    const i = aimedCompartment(p, inst.root.rotation.y, ctx.player.eye, ctx.player.forward(), drawerLayout(cfg));
    const key = ctx.world.keyOf(inst) ?? `uid:${inst.uid}`;
    const res = openCompartment(ctx.state.self, cfg, i, { seed: ctx.seed, key, pools: ctx.content.pools ?? {}, ctx: poolCtx(ctx, p) });
    const name = compartmentsOf(cfg)[i]?.name ?? 'drawer';
    if (res.status === 'stuck') {
      rattle(inst, i);
      ctx.sound.play('drawer_stuck');
      ctx.world.noise(p, 6, 'drawer_rattle');
      const lines = params.stuckLines ?? STUCK;
      ctx.ui.caption(lines[(ctx.state.self.rattles - 1) % lines.length], 3, 'container');
      return ctx.ok();
    }
    if (res.status === 'already') return ctx.fail(`The ${name} is already open.`);
    if (res.status !== 'opened') return ctx.fail();
    ctx.sound.play('drawer_slide');
    ctx.world.noise(p, 4, 'drawer');
    if (!res.items.length) {
      ctx.ui.caption(params.emptyLine ?? `The ${name} is empty. Dust, a paperclip.`, 3, 'container');
      return ctx.ok();
    }
    res.items.forEach((id, n) => giveOrPlace(ctx, id, () => drawerSpot(inst, i, cfg, n), {
      from: `${key}/${i}/${n}`, rotY: inst.root.rotation.y,
    }));
    return ctx.ok();
  },
};
