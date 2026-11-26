// Secret "Lights out" (content/secrets/lights_out.json): you switched a room's lights off and
// stood in it, torch off, in the dark. Writing glows up on the nearest wall in front of you, and it
// knows how far you've walked. (Dark writing only shows while its spot is dark; see src/power.)
// params: { writing = 'dark_writing', lines: [glow text with {steps}], read: [surface text with {steps}] }
const fill = (s, steps) => String(s).replaceAll('{steps}', String(steps));

/** Nearest wall from p within `max` m, trying straight ahead first, then the other sides. */
function wallAhead(ctx, p, yaw, max = 6) {
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const fx = -Math.sin(yaw + turn), fz = -Math.cos(yaw + turn);
    for (let d = 0.3; d <= max; d += 0.05) {
      if (ctx.world.isSolidAt(p.x + fx * d, p.z + fz * d)) return { x: p.x + fx * (d - 0.04), z: p.z + fz * (d - 0.04), fx, fz };
    }
  }
  return null;
}

export default {
  id: 'secret_lights_out',
  run(ctx, params) {
    const p = ctx.player.pos;
    const steps = Math.round(ctx.stats.get('steps') ?? 0);
    const lines = params.lines?.length ? params.lines : ['{steps} STEPS. NONE HOME'];
    const glow = fill(ctx.rng.pick(lines), steps);
    const w = wallAhead(ctx, p, ctx.player.yaw);
    if (w) {
      const rot = ctx.world.yawFacing({ x: -w.fx, y: 0, z: -w.fz });
      ctx.world.spawn(params.writing ?? 'dark_writing', { x: w.x, y: 1.1, z: w.z }, rot, { persist: true, state: { message: glow } });
    }
    ctx.sound.play('sting_low', { volume: 0.5 });
    ctx.world.noise(p, 2, 'secret:dark');
    const read = params.read?.length ? fill(ctx.rng.pick(params.read), steps) : glow;
    ctx.timer.after(1.2, () => ctx.ui.read('Writing', read, 'surface'));
    return ctx.ok({ consume: false });
  },
};
