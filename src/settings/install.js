// game.settings: the live, persisted player settings (see settings.js for the stored format).
//   game.settings.<key>             current value (plain data; the Tenant reads game.settings.calm)
//   game.settings.set(key, value)   coerce + apply + emit 'settings:change' { key, value, settings } + save
//   game.settings.status            'ok' | 'default' | 'migrated' | 'newer' | 'corrupt' | 'blocked'
//   game.settings.persisted         false when storage is blocked (the game runs on defaults)
// Applying is done here for everything that has a plain home (input, synth, cfg.ui); the diegetic
// UI listens to settings:change to refresh the text layer (textGrit / textScale).
import { defaultsFrom, loadSettings, saveSettings, getStorage, coerce, SPEC } from './settings.js';

export function installSettings(game, { storage = getStorage() } = {}) {
  const defaults = defaultsFrom(game.cfg);
  const { values, status } = loadSettings(storage, defaults);
  let timer = null;
  const canSave = !!storage && status !== 'newer';

  const settings = { ...values };
  Object.defineProperties(settings, {
    status: { value: status, enumerable: false },
    persisted: { get: () => canSave, enumerable: false },
    defaults: { value: Object.freeze({ ...defaults }), enumerable: false },
    set: {
      enumerable: false,
      value(key, v) {
        if (!(key in SPEC)) return false;
        const c = coerce(key, v);
        if (c === undefined || c === settings[key]) return false;
        settings[key] = c;
        apply(key, c);
        game.events?.emit('settings:change', { key, value: c, settings });
        scheduleSave();
        return true;
      },
    },
    save: { enumerable: false, value: () => (canSave ? saveSettings(storage, settings) : false) },
  });

  function scheduleSave() {
    if (!canSave) return;
    if (typeof setTimeout === 'undefined') { saveSettings(storage, settings); return; }
    clearTimeout(timer);
    timer = setTimeout(() => saveSettings(storage, settings), 250); // slider drags write once
  }

  function apply(key, v) {
    const ui = (game.cfg.ui ??= {});
    const synth = game.synth;
    switch (key) {
      case 'mouseSensitivity': if (game.input) game.input.sensitivity = v; break;
      case 'invertY': if (game.input) game.input.invertY = v; break;
      case 'masterVolume': synth?.setVolume?.('master', v); break;
      case 'ambienceVolume': synth?.setVolume?.('ambience', v); break;
      case 'effectsVolume':
        synth?.setVolume?.('sfx', v);
        synth?.setVolume?.('tenant', Math.min(1, v * 1.25)); // the Tenant rides the effects slider (1 at the 0.8 default)
        break;
      case 'textScale': ui.textScale = v; break;
      case 'textGrit': ui.textGrit = v; break;
      case 'captions': ui.captions = v; break;
      case 'textPrompts': ui.textPrompts = v; break;
      case 'reduceFlashing': ui.reduceFlashing = v; break;
      case 'fullscreen': ui.fullscreenOnStart = v; break; // main enters/leaves fullscreen inside the input event
      default: break; // calm: read by the Tenant
    }
  }

  for (const [k, v] of Object.entries(settings)) apply(k, v);
  game.settings = settings;
  return settings;
}
