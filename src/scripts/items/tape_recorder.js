// A cassette player: one log at a time, like the real thing.
//   use while idle    → click, then the next log plays (whisper + caption)
//   use while playing → click, the tape stops and its line is cleared
// params: { logs: string[], loop = true }
const playing = new WeakMap(); // state object → { cancel, handle } (runtime only, never saved)

export default {
  id: 'tape_recorder',
  run(ctx, params) {
    const logs = params.logs ?? [];
    const s = ctx.state.self;
    const key = 'tape:' + (ctx.self?.uid ?? 'held');
    const now = playing.get(s);
    ctx.sound.play('battery_click', { volume: 0.5 });

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
