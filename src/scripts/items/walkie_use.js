// Use a held walkie-talkie: switch it on (static, the occasional voice) or off.
// Drop a second one switched on somewhere and it relays what it hears there.
import { toggleWalkie } from '../../story/walkie.js';

export default {
  id: 'walkie_use',
  run(ctx) {
    const on = toggleWalkie(ctx.state.self);
    ctx.sound.play('walkie_click', { volume: 0.7 });
    const other = ctx.inventory.slots.filter((s) => s && s.id === 'walkie_talkie' && s !== ctx.self).length;
    ctx.ui.caption(on ? (other ? '(click. static. drop the other one somewhere and it will listen there)' : '(click. static.)') : '(click. off.)', 2.5, 'walkie-toggle');
    return ctx.ok({ consume: false });
  },
};
