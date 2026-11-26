// Pick up the ringing desk phone. params: { lines?: string[], deadLine? }
// The first answer stops the ring and something breathes on the line; later answers are dead air.
export default {
  id: 'phone_answer',
  run(ctx, params) {
    const s = ctx.state.self;
    ctx.sound.stopObject(ctx.self);
    ctx.sound.play('paper_rustle', { volume: 0.4 });
    if (s.answered) {
      ctx.ui.caption(params.deadLine ?? 'Dial tone. Then not even that.');
      return ctx.ok();
    }
    s.answered = true;
    const lines = params.lines?.length ? params.lines : ['...is the light still on where you are?'];
    const line = ctx.rng.pick(lines);
    ctx.timer.after(0.6, () => {
      ctx.sound.play('whisper_far', { volume: 0.8 });
      ctx.ui.caption(line, 4);
    });
    return ctx.ok();
  },
};
