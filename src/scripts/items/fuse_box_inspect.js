// Pressing E on the fuse box without a fuse in hand. params: { empty?, powered? }
import { getPower } from '../../power/network.js';

export default {
  id: 'fuse_box_inspect',
  run(ctx, params) {
    const box = ctx.state.self;
    ctx.sound.play('door_creak', { volume: 0.35 });
    let text = box.powered ? (params.powered ?? 'It hums, warm to the touch.') : (params.empty ?? 'One fuse slot is empty.');
    const p = ctx.self?.root?.position;
    const room = p ? getPower()?.roomPower(p) : null;
    if (!box.powered && room && Object.values(room.power.circuits).some((c) => !c.powered)) text += ' The lights in here are on this circuit.';
    ctx.ui.caption(text);
    return ctx.ok();
  },
};
