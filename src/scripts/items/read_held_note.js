// Re-read a note you are carrying: the page it resolved to when you first read it.
export default {
  id: 'read_held_note',
  run(ctx) {
    const note = ctx.notes.of(ctx.self);
    if (!note) return ctx.fail('The writing has smeared away.');
    ctx.sound.play('paper_rustle', { volume: 0.5 });
    ctx.ui.read(note.title, note.text, 'inspect', note.id);
    return ctx.ok({ consume: false });
  },
};
