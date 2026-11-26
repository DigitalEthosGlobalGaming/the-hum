// Human key labels + the Controls page list, generated from config.keys. Pure (Node-testable).

const NAMED = {
  Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Space: 'Space', Backspace: 'Backspace',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Meta', MetaRight: 'Meta', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse0: 'left click', Mouse1: 'middle click', Mouse2: 'right click', Mouse3: 'mouse 4', Mouse4: 'mouse 5',
  WheelUp: 'wheel up', WheelDown: 'wheel down',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};

/** KeyboardEvent.code (or our Mouse/Wheel codes) → a short label a person would write down. */
export function keyLabel(code) {
  if (!code) return '?';
  if (NAMED[code]) return NAMED[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'num ' + m[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

/** Labels for a list of codes, deduped (ShiftLeft + ShiftRight → "Shift"). */
export function keyLabels(codes = []) {
  return [...new Set(codes.map(keyLabel))];
}

// What the Controls page lists, in order. `group` actions are written together (W A S D).
export const CONTROL_ROWS = [
  { label: 'move', group: ['forward', 'left', 'back', 'right'] },
  { label: 'sprint', action: 'sprint' },
  { label: 'crouch', action: 'crouch' },
  { label: 'interact', action: 'interact' },
  { label: 'use', action: 'use' },
  { label: 'drop', action: 'drop' },
  { label: 'throw', action: 'throw' },
  { label: 'pick pocket', group: ['slot1', 'slot2', 'slot3', 'slot4'], also: ['slotNext'] },
  { label: 'pockets', action: 'pockets', hint: 'hold' },
  { label: 'watch', action: 'watch', hint: 'hold' },
  { label: 'notebook', action: 'notebook' },
  { label: 'pause', action: 'pause' },
  { label: 'flashlight', action: 'flashlight' },
  { label: 'fullscreen', action: 'fullscreen' },
];

/**
 * → [{ label, keys }] with `keys` a written string ("W A S D / ↑ ← ↓ →", "left click / R").
 * Rows whose actions are not bound are left out.
 */
export function controlsList(keys = {}) {
  const out = [];
  for (const row of CONTROL_ROWS) {
    let text = '';
    if (row.group) {
      const firsts = row.group.map((a) => keys[a]?.[0]).filter(Boolean);
      if (!firsts.length) continue;
      const seconds = row.group.map((a) => keys[a]?.[1]).filter(Boolean);
      text = firsts.map(keyLabel).join(' ');
      if (seconds.length === row.group.length) {
        text += ' / ' + (seconds.every((c) => c.startsWith('Arrow')) ? 'arrows' : seconds.map(keyLabel).join(' '));
      }
      for (const a of row.also ?? []) if (keys[a]?.length) text += ' / ' + (a.startsWith('slot') ? 'wheel' : keyLabels(keys[a]).join(' / '));
      if (row.group[0] === 'slot1' && firsts.length === 4 && firsts.every((c, i) => c === `Digit${i + 1}`)) {
        text = '1-4' + text.slice(firsts.map(keyLabel).join(' ').length);
      }
    } else {
      const codes = keys[row.action];
      if (!codes?.length) continue;
      text = keyLabels(codes).join(' / ');
    }
    if (row.hint) text += ` (${row.hint})`;
    out.push({ label: row.label, keys: text });
  }
  return out;
}
