// A note that somehow ended up in a pocket (older runs, debug stubs): using it reads it into the
// notebook and files it there, so the pocket is free again. Notes picked up in the world never
// reach the pockets (see Gameplay.fileNote); this is the fallback for a stack.
export default {
  id: 'read_held_note',
  run(ctx) {
    if (!ctx.notes.file(ctx.self)) return ctx.fail('The writing has smeared away.');
    return ctx.ok({ consume: false }); // fileNote already took it out of the pocket
  },
};
