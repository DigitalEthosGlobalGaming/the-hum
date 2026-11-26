// Dev-only F7 overlay: active emitters, acoustics weights, occlusion per voice, env bus, peak meter.
// A plain <pre> of its own (no UI-module dependency); nothing happens in release builds or Node.
const DEV = typeof __DEV__ !== 'undefined' && __DEV__;

export function installDebug(sys) {
  if (!DEV || typeof document === 'undefined') return null;
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', left: '8px', bottom: '8px', margin: 0, padding: '6px 8px', zIndex: 40,
    font: '11px/1.35 monospace', color: '#cfe8c0', background: 'rgba(0,0,0,0.72)',
    pointerEvents: 'none', display: 'none', whiteSpace: 'pre', maxWidth: '60vw', overflow: 'hidden',
  });
  document.body.appendChild(el);
  let on = false, acc = 0;
  const onKey = (e) => {
    if (e.code !== 'F7' || e.repeat) return;
    e.preventDefault();
    on = !on;
    el.style.display = on ? 'block' : 'none';
    acc = 1;
  };
  addEventListener('keydown', onKey);
  return {
    el,
    get on() { return on; },
    update(dt) {
      if (!on) return;
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      el.textContent = sys.debugLines().join('\n');
    },
    remove() { removeEventListener('keydown', onKey); el.remove(); },
  };
}
