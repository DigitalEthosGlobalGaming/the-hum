// Pressing E on the fuse box without a fuse in hand. params: { empty?, powered? }
export default {
  id: 'fuse_box_inspect',
  run(ctx, params) {
    const box = ctx.state.self;
    ctx.sound.play('door_creak', { volume: 0.35 });
    ctx.ui.caption(box.powered ? (params.powered ?? 'It hums, warm to the touch.') : (params.empty ?? 'One fuse slot is empty.'));
    return ctx.ok();
  },
};
