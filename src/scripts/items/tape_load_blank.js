// blank_tape + tape_recorder: swap in the blank tape. The recorder records from now on (see
// tape_recorder.js); its old logs are gone with the old tape.
export default {
  id: 'tape_load_blank',
  run(ctx) {
    const rec = ctx.self?.id === 'tape_recorder' ? ctx.state.self : ctx.state.other;
    if (!rec) return ctx.fail();
    if (rec.blank && !rec.recorded) return ctx.fail('There is already a blank tape in it.');
    rec.blank = true;
    rec.recorded = false;
    rec.recording = false;
    rec.heard = [];
    ctx.sound.play('battery_click', { volume: 0.6 });
    ctx.ui.caption('You swap the tape. The red REC button is the only one that still clicks.', 3.5);
    return ctx.ok();
  },
};
