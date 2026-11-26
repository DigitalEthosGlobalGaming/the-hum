// E on a "YOU ARE HERE" evacuation map: copy about 3 blocks of layout into the notebook auto-map
// (pencil cells marked as copied) and add a map page. About 1 in 4 maps lie (seeded per map per
// run); the notebook only finds out later, as "?" where what you saw disagrees.
// params: { caption?, lieCaption? }
import { evacData } from '../../story/evacMap.js';
import { addMapRevealPage } from '../../story/pages.js';

export default {
  id: 'evac_map_read',
  run(ctx, params) {
    const st = ctx.state.self;
    ctx.sound.play('paper_rustle', { volume: 0.6 });
    const data = ctx.self.evac ?? evacData(ctx.self);
    if (!data) return ctx.fail('The plan is too faded to follow.');
    const first = !st.read;
    st.read = true;
    // the caption never says whether it lies: the player has to find out
    const caption = params.caption ?? 'Copied off the wall plan. Exits in green. I drew them in pencil.';
    addMapRevealPage(data, caption, { open: true });
    if (first) ctx.ui.caption('(you sketch the plan into your notebook)', 2.5, 'evac');
    return ctx.ok();
  },
};
