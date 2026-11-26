// Wall light switch: E toggles the room's lights (all its circuits, or params.circuit).
// params: { circuit? }
import { getPower } from '../../power/network.js';

export default {
  id: 'light_switch',
  run(ctx, params) {
    const power = getPower();
    const p = ctx.self?.root?.position;
    if (!power || !p) return ctx.fail();
    const on = power.toggleSwitch(p, params.circuit ?? null);
    ctx.sound.play('switch_click', { volume: 0.7 });
    if (on != null) ctx.state.self.on = on; // null: a switch to nothing, it just clicks
    return ctx.ok();
  },
};
