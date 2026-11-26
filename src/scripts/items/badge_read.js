// Use a held ID badge: read it. Opens its "wanderer" page in the notebook (adding it if needed) and
// records the badge in ctx.state.run.badges.
import { badgeIdentity, collectBadge } from '../../story/badges.js';
import { wandererText } from '../../story/wanderers.js';

export default {
  id: 'badge_read',
  run(ctx) {
    const st = ctx.state.self;
    const w = badgeIdentity(st, `stack:${ctx.self?.slot ?? 0}`, ctx.seed, ctx.content.lines);
    ctx.sound.play('paper_rustle', { volume: 0.5 });
    const page = collectBadge(w, ctx.state.run, { open: true });
    if (page == null) ctx.ui.read(w.name, wandererText(w), 'inspect'); // no notebook (tests / headless)
    return ctx.ok({ consume: false });
  },
};
