// A cassette player: one log at a time, like the real thing.
//   use while idle    → click, then the next log plays (whisper + caption)
//   use while playing → click, the tape stops and its line is cleared
// With a blank tape in it (blank_tape + tape_recorder, see tape_load_blank) it records instead:
//   first use         → records 10 s (red light, ● REC); use again stops early
//   later uses        → play the recording back / stop it. Drop it while it plays → a 20 s lure
//                       (looping noise events at that spot, src/story/tapeLure.js). Dropping it
//                       while it records ends the recording and leaves it playing back as a lure.
// G always drops it (interaction.dropHeld); nothing here intercepts the drop.
// params: { logs: string[], loop = true }
import { isRecording, startRecording, stopRecording, togglePlayback } from '../../story/tapeLure.js';

const playing = new WeakMap(); // state object → { cancel, handle } (runtime only, never saved)

export default {
  id: 'tape_recorder',
  run(ctx, params) {
    const s = ctx.state.self;
    ctx.sound.play('battery_click', { volume: 0.5 });

    if (s.blank) { // record mode
      if (isRecording(s)) { stopRecording(s); return ctx.ok({ consume: false }); }
      if (!s.recorded) {
        startRecording(s);
        ctx.sound.play('tape_rec_beep', { volume: 0.6 });
        return ctx.ok({ consume: false });
      }
      togglePlayback(s);
      return ctx.ok({ consume: false });
    }

    const logs = params.logs ?? [];
    const key = 'tape:' + (ctx.self?.uid ?? 'held');
    const now = playing.get(s);

    if (now) { // stop button
      now.cancel?.();
      now.handle?.stop?.(0.15);
      playing.delete(s);
      ctx.ui.clearCaption(key);
      return ctx.ok({ consume: false });
    }

    s.track ??= 0;
    if (s.track >= logs.length && !(params.loop ?? true)) return ctx.fail('Just hiss now.');
    const line = logs.length ? logs[s.track % logs.length] : '...';
    s.track++;
    const seconds = Math.max(4, Math.min(9, 2 + line.length * 0.06));
    const entry = {};
    playing.set(s, entry);
    entry.cancel = ctx.timer.after(0.35, () => {
      entry.handle = ctx.sound.play('whisper_far', { volume: 0.9 });
      ctx.ui.caption(`"${line}"`, seconds, key);
      entry.cancel = ctx.timer.after(seconds, () => playing.delete(s)); // tape finished
    });
    return ctx.ok({ consume: false });
  },
};
