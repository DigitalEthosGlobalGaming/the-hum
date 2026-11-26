// E on a dead ceiling fixture with empty hands. params: { text? }
export default {
  id: 'fixture_inspect',
  run(ctx, params) {
    ctx.ui.caption(params.text ?? 'The tube is dead, grey at both ends. A spare would fit.', 3);
    return ctx.ok();
  },
};
