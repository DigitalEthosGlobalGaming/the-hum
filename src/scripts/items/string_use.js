// Use the ball of red string: tie it off where you stand (it pays out behind you as you walk), or,
// while it's trailing, cut it. The cut end stays on the floor as a knot (red_string_end).
import { tieOff, cut, BALL_M } from '../../story/redString.js';

export default {
  id: 'string_use',
  run(ctx) {
    const s = ctx.state.self;
    s.left ??= BALL_M;
    const p = ctx.player.pos;
    if (!s.threadId) {
      if (s.left <= 0.5) return ctx.fail('There is no string left on the ball.');
      tieOff(s, p);
      s.tautWarned = false;
      ctx.sound.play('paper_rustle', { volume: 0.4 });
      ctx.ui.caption(`You knot the end around a pipe at ankle height. ${Math.round(s.left)} m on the ball.`, 3.5, 'string');
      return ctx.ok({ consume: false });
    }
    const t = cut(s);
    ctx.sound.play('string_snap', { volume: 0.7 });
    ctx.world.noise(p, 3, 'string');
    const end = t?.pts?.[t.pts.length - 1] ?? [p.x, p.z];
    if (t) ctx.world.spawn('red_string_end', { x: end[0], y: 0, z: end[1] }, ctx.player.yaw, { persist: true, state: { threadId: t.id } });
    ctx.ui.caption(`You bite through the string. ${Math.round(t?.len ?? 0)} m of it runs back the way you came.`, 3.5, 'string');
    return ctx.ok({ consume: false });
  },
};
