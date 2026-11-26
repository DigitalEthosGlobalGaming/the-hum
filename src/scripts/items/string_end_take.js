// E on a cut thread end: tie it back onto the ball you carry, and it keeps paying out from here.
import { threadById, reattach } from '../../story/redString.js';

export default {
  id: 'string_end_take',
  run(ctx) {
    const t = threadById(ctx.state.self.threadId);
    if (!t) return ctx.fail('Just a knot of red string. It goes nowhere now.');
    const ball = ctx.inventory.slots.find((s) => s && s.id === 'red_string');
    if (!ball) return ctx.fail('The frayed end of the red string. You need the ball to tie it on.');
    if (ball.state?.threadId) return ctx.fail('You are already trailing a thread.');
    reattach(ball.state ??= {}, t);
    ball.state.tautWarned = false;
    ctx.sound.play('paper_rustle', { volume: 0.4 });
    ctx.ui.caption('You tie the end back onto the ball.', 2.5, 'string');
    return ctx.ok({ consume: true });
  },
};
