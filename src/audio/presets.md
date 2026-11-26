# Sound presets

Sounds are data. Each `content/sounds/<id>.json` is a recipe of oscillators and noise that
`src/audio/presets.js` builds into a Web Audio graph on every play. There are no audio files.

```js
synth.loadPresets(content.sounds);
const h = synth.play('phone_ring', { position: { x, y, z } });
h.stop(0.5);
```

Check presets with `node tools/sound-check.mjs` (validates, renders each one offline, and
reports level, length, brightness and per-play variation). Add `--wav <dir>` to write WAVs you can
listen to.

## Preset

| key | default | meaning |
|---|---|---|
| `id` | file name | must match the file name |
| `note` | | free text, shown as a tooltip on the dev sound board |
| `bus` | `"sfx"` | `ambience` \| `sfx` \| `tenant` \| `env`, so the settings sliders apply to it. `env` (environment: hum, room tone, drips, vents, distant events) feeds the ambience bus and is ducked / paused by src/ambience |
| `volume` | `1` | preset gain (0–2), multiplied by `play(..., { volume })` |
| `spatial` | `false` | if true and `play()` gets a `position`, the sound goes through a PannerNode (HRTF if available) |
| `refDistance` / `maxDistance` / `rolloff` | `1` / `30` / `1` | inverse distance model, in metres |
| `reverb` | `0` | send (0–1) to the shared procedural reverb. The send falls off more gently than the direct sound, so far sources sound wetter |
| `loop` | `false` | ambient loop; see **Loops** |
| `repeat` | | retrigger the **whole preset**: `{ count, interval, jitter? }` |
| `vary` | | per-play random ranges applied to **every layer the same way** (keeps layers coherent) |
| `layers` | required | 1–12 layers, mixed together |

## Layer

A layer has exactly one source: `"osc": "sine" | "square" | "saw" | "triangle"` with `freq` (Hz),
or `"noise": "white" | "pink" | "brown"` with `rate` (playback rate, default 1. Below 1 is darker).

| key | default | meaning |
|---|---|---|
| `freq` / `rate` | | base pitch (osc Hz / noise playback rate) |
| `detune` | `0` | cents |
| `gain` | `1` | peak level of this layer (0–2) |
| `start` | `0` | seconds after the trigger |
| `env` | `{a:.005,d:.2,s:0,sus:0,r:.05,curve:"exp"}` | gain envelope, see below |
| `pitchEnv` | | `{ from?: 1, to, time, delay?: 0, curve?: "exp" }`, **ratios** of the base pitch (`to: 0.5` = an octave down) |
| `filter` | | `{ type, freq, q?: 0.707, gain?, env? }`, a biquad. `env` = `{ from?: freq, to, time, delay?, curve? }` in **Hz** |
| `lfo` | | one LFO or an array: `{ target, wave?: "sine", rate, depth }` |
| `repeat` | | retrigger **this layer**: `{ count, interval, jitter? }` |
| `vary` | | per-trigger random ranges for this layer only |
| `note` | | free text |

**Envelope** `env`: linear attack `a` to the layer `gain`, decay over `d` to sustain level `s`
(0–1 × gain), hold for `sus` seconds, release over `r`. If `s` is 0 the sound ends after the
decay (a percussive hit: `{a, d}` is enough). With `curve: "exp"` (default), decay and release are
exponential, so `d` is roughly the time to silence. `"lin"` gives straight ramps, which suit swells.

**Filter** `type`: `lowpass` `highpass` `bandpass` `notch` `peaking` `lowshelf` `highshelf` `allpass`.
`q` is classic linear Q for every type (0.707 = flat). The interpreter converts it for Web Audio,
whose lowpass and highpass Q is in dB. `gain` (dB) is for peaking and shelf filters.

**LFO** `target`:
- `gain`: tremolo. `depth` 0–1 (1 = fully on/off). Depths on one layer must sum to 1 or less.
- `pitch`: vibrato, `depth` in cents.
- `filter`: filter wobble, `depth` in cents (1200 = ±1 octave). The layer needs a `filter`.

`wave`: `sine` `square` `saw` `triangle`, or `noise`: smooth random wandering with `rate`
random points per second. Use `noise` for anything organic (air, creaks, whispers).

**Vary** (preset- or layer-level), each a ± range rolled on every trigger:
`pitch` (semitones), `filter` (octaves, scales the filter `freq` and its `env`), `gain` (dB),
`time` (seconds of random extra delay, 0..time). Preset-level rolls once per preset trigger and is
shared by all layers. Layer-level rolls separately for each layer and each repeat.

**Repeat** `{ count, interval, jitter }`: triggers at `k × interval ± jitter` (`jitter` ≤
interval/2). Each repeat re-rolls the layer's `vary` and noise offset, so repeats differ. Nesting
works: `phone_ring` uses a layer repeat for the double burst and a preset repeat for the cycles.

## Loops

`"loop": true`, or `play(id, { loop: true })`, plays until `handle.stop()`:
- With a preset `repeat`, the whole preset retriggers forever.
- Otherwise layers with an `s > 0` envelope sustain (attack, then hold), and layers with a
  `repeat` retrigger forever.
- A one-shot preset forced to loop through `play()` restarts every (its duration) seconds.

`stop()` with no argument fades over the longest layer `r` (loops) or 50 ms (one-shots).

## Limits

These are checked by `validatePreset()` (on `loadPresets`, where bad presets are skipped with a
warning) and by `tools/sound-check.mjs`.

- Unknown keys are errors, which catches typos.
- A one-shot must last 12 s or less (`presetDuration()`).
- Osc `freq` is 10–20000 Hz, noise `rate` 0.05–8, filter `freq` 10–22000 Hz, `q` 0.05–40.
- `repeat.count` is 1–64.

## Engine notes

- Voices are capped (32 by default; `config.audio.maxVoices`). A new play steals the **oldest non-looping** voice with a 30 ms
  fade. Loops are never stolen. If only loops are playing, the new one-shot is dropped.
- An unknown preset id logs one `console.warn` and returns a dead handle (`playing: false`, with
  no-op methods). So does `play()` before `synth.start()`.
- Reverb: three ConvolverNodes with generated impulses (`ROOM_IMPULSES` in synth.js: small office
  0.45 s with early reflections, big hall 2.9 s, corridor 1.5 s with a flutter echo), crossfaded by
  `synth.setAcoustics(weights, sendScales, fade)` from the listener's surroundings (src/ambience).
  Each bus has a send gain that follows its slider (muting a bus also mutes its tail) and a send
  scale set by the acoustics, so footsteps are tight in small rooms and washy in halls.
- Positioned spatial voices run `out → occlusion lowpass → occlusion gain → panner`; it starts
  transparent and `voice.setOcclusion(cutoffHz, gain, tau)` muffles it. The reverb send is taken after
  the lowpass, so an occluded sound fills the room dark. `play(id, { occlude: false })` skips it.
- `synth.playHooks` (fn(voice, id, opts)) run after every play; src/ambience uses them to occlude new
  voices at once and to duck the env bus under stings.
- Master goes through a memoryless soft-clip WaveShaper. It is linear up to about -3 dBFS and
  rounds off above that. It is a safety net, not a mix tool, and it has no attack or release, so
  it can't pump. (Chrome's DynamicsCompressor dulled short clicks by 6-13 dB even well below its
  threshold, so it isn't used.) Presets should peak well below it: `sound-check` fails anything
  over -3 dBFS at the default sliders.
