// Secret "The spinning man" (content/secrets/spinning_man.json), fired by prop:collide between two
// office chairs. Both chairs spin wildly, then a caster wheel snaps off one of them (it slumps,
// broken for the rest of the run) and rolls away; then, if the player hasn't collected it yet,
// a folded note pops out of the wheel housing and arcs onto the floor.
// params: { event: { a, b, speed, pos }, spin = 16, spinSeconds = 2.4, wheelDelay = 1.7,
//           noteDelay = 0.55, wheel = 'chair_wheel', note, noteObject }

/** Where a body is (its centre), else the mesh root. */
const centre = (inst) => (inst.body ? { x: inst.body.x, y: 0, z: inst.body.z } : { x: inst.root.position.x, y: 0, z: inst.root.position.z });

/** The body-local side ('+x'…) that world direction (fx, fz) points to, for a prop turned `a`. */
export function sideOf(a, fx, fz) {
  const c = Math.cos(a), s = Math.sin(a);
  const lx = fx * c - fz * s, lz = fx * s + fz * c;
  return Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? '+x' : '-x') : (lz > 0 ? '+z' : '-z');
}

export default {
  id: 'secret_spinning_man',
  run(ctx, params) {
    const ev = params.event ?? {};
    const a = ev.a, b = ev.b;
    if (!a?.root || !b?.root) return ctx.fail();
    const w = params.spin ?? 16;
    const seconds = params.spinSeconds ?? 2.4;
    ctx.physics.spin(a, { w, seconds, wobble: 0.4 });
    ctx.physics.spin(b, { w: -w * 0.9, seconds: seconds * 0.9, wobble: 0.4 });
    ctx.sound.play('chair_spin', { at: a, volume: 0.9 });
    ctx.sound.play('chair_spin', { at: b, volume: 0.8 });
    ctx.world.noise(centre(a), 7, 'secret:chairs');

    const victim = ctx.rng.chance(0.5) ? a : b;
    ctx.timer.after(params.wheelDelay ?? 1.7, () => {
      const c = centre(victim);
      const ang = ctx.rng.range(0, Math.PI * 2);
      const fx = Math.cos(ang), fz = Math.sin(ang);
      const wheel = ctx.world.spawn(params.wheel ?? 'chair_wheel', { x: c.x + fx * 0.3, y: 0.08, z: c.z + fz * 0.3 }, ang, { persist: true });
      if (wheel) ctx.physics.toss(wheel, { vx: fx * 2.6, vz: fz * 2.6, vy: 1.4, w: 14 });
      ctx.sound.play('wheel_clatter', { at: wheel ?? c, volume: 1 });
      ctx.world.noise(c, 9, 'secret:wheel');
      const yaw = victim.body?.a ?? victim.root.rotation?.y ?? 0;
      ctx.physics.breakProp(victim, { dir: sideOf(yaw, fx, fz), angle: 0.17 });
      ctx.ui.caption('(a caster snaps off and skitters away. The chair sags.)', 3, 'secret:chair');

      const noteId = params.note;
      if (!noteId || ctx.notes.collected(noteId)) return;
      ctx.timer.after(params.noteDelay ?? 0.55, () => {
        if (ctx.notes.collected(noteId)) return;
        // out of the wheel housing, toward where the player stands
        const p = ctx.player.pos;
        let dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        const note = ctx.world.spawn(params.noteObject ?? 'note_chair_wheel', { x: c.x + dx * 0.15, y: 0.12, z: c.z + dz * 0.15 }, ang + 1.3, { persist: true });
        if (!note) return;
        ctx.physics.toss(note, { vx: dx * 1.1 - dz * 0.3, vy: 2.4, vz: dz * 1.1 + dx * 0.3, w: 6 });
        ctx.sound.play('paper_rustle', { at: note, volume: 0.7 });
        ctx.ui.caption('(something papery pops out of the wheel housing)', 3, 'secret:chair');
      });
    });
    return ctx.ok({ consume: false });
  },
};
