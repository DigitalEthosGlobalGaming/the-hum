// E on a typewriter: it types the next line of the story onto its paper, letter by letter. About 1 in
// 5 presses it types what you are doing right now instead (built from live state).
// The story is shared by every typewriter in the run (ctx.state.run.typewriterLine).
// params: { lines = "typewriter_story" (content/lines id), liveChance = 0.2 }
import { pickLine } from '../../story/typewriterText.js';
import { startTyping, isTyping } from '../../story/typewriter.js';

export default {
  id: 'typewriter_type',
  run(ctx, params) {
    const st = ctx.state.self;
    if (isTyping(st)) return ctx.fail('The keys are still moving.');
    const story = ctx.content.lines?.[params.lines ?? 'typewriter_story']?.lines ?? [];
    const run = ctx.state.run;
    run.typewriterLine ??= 0;
    const held = ctx.inventory.held;
    const facts = {
      near: ctx.self?.name ?? 'typewriter',
      held: held ? held.def?.name ?? held.id : null,
      torchOn: ctx.flashlight?.on,
      battery: ctx.flashlight?.battery,
      sanity: ctx.stats.get('sanity'),
      steps: ctx.stats.get('steps'),
      yaw: ctx.player.yaw,
      minutes: ctx.time / 60,
      photos: run.photos ?? 0,
    };
    const pick = pickLine(story, run.typewriterLine, facts, ctx.rng, params.liveChance ?? 0.2);
    if (pick.advance) run.typewriterLine++;
    startTyping(ctx.self, st, pick.text);
    return ctx.ok();
  },
};
