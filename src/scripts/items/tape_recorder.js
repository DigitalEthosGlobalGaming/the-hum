// Play the next voice log on the tape. params: { logs: string[], loop = true }
export default {
  id: 'tape_recorder',
  run(ctx, params) {
    const logs = params.logs ?? [];
    const s = ctx.state.self;
    s.track ??= 0;
    if (s.track >= logs.length && !(params.loop ?? true)) return ctx.fail('Just hiss now.');
    const line = logs.length ? logs[s.track % logs.length] : '...';
    s.track++;
    ctx.sound.play('battery_click', { volume: 0.5 });
    ctx.timer.after(0.35, () => {
      ctx.sound.play('whisper_far', { volume: 0.9 });
      ctx.ui.caption(`"${line}"`, 5);
    });
    return ctx.ok({ consume: false });
  },
};
