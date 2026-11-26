// Secret "Collect call" (content/secrets/dark_caller.json): you answered a ringing desk phone in
// the dark with your torch off. After the usual voice, a second one gets on the line; it is
// calmer, and so are you (a little sanity back).
// params: { delay = 5, lines: string[], sanity = 0.15 }
export default {
  id: 'secret_dark_caller',
  run(ctx, params) {
    const phone = params.event?.inst ?? null;
    const lines = params.lines?.length ? params.lines : ["...you're in the dark too. Good. Then it can't see either of us."];
    const line = ctx.rng.pick(lines);
    ctx.timer.after(params.delay ?? 5, () => {
      ctx.sound.play('whisper_far', { at: phone?.root ? phone : 'player', volume: 0.9 });
      ctx.ui.caption(line, 5, 'secret:phone');
      ctx.stats.add('sanity', params.sanity ?? 0.15);
    });
    return ctx.ok({ consume: false });
  },
};
