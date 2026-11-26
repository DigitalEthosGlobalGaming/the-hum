// Dev-only sound board: lists every preset with play / stop, optional random placement around the
// listener, and a live voice count. mountSoundBoard(synth, content.sounds) → { el, destroy() }.
export function mountSoundBoard(synth, presets = synth.presets) {
  const handles = new Map(); // id → [handle]
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', top: '8px', right: '8px', zIndex: 50, width: '250px', maxHeight: '70vh',
    overflow: 'auto', font: '11px/1.35 monospace', color: '#d8cf8a', background: 'rgba(10,10,6,0.88)',
    border: '1px solid #5a5530', padding: '6px 8px', userSelect: 'none',
  });
  // Keep clicks and keys inside the panel from reaching the game (pointer lock, movement).
  for (const ev of ['mousedown', 'click', 'keydown', 'keyup', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px';
  head.innerHTML = '<b>SOUND BOARD</b>';
  const count = document.createElement('span');
  count.style.opacity = '0.7';
  const toggle = button('–', () => {
    body.style.display = body.style.display === 'none' ? '' : 'none';
    toggle.textContent = body.style.display === 'none' ? '+' : '–';
  });
  head.append(count, toggle);

  const body = document.createElement('div');
  const opts = document.createElement('label');
  opts.style.cssText = 'display:block;margin:2px 0 6px;cursor:pointer';
  const around = document.createElement('input');
  around.type = 'checkbox';
  around.style.verticalAlign = 'middle';
  opts.append(around, ' random position around listener');
  body.append(opts, button('stop all', () => { synth.stopAll(0.1); handles.clear(); }));

  const list = document.createElement('div');
  list.style.marginTop = '6px';
  for (const id of Object.keys(presets).sort()) {
    const p = presets[id];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:1px 0';
    const name = document.createElement('span');
    name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    name.textContent = id;
    name.title = [p.note, `bus: ${p.bus || 'sfx'}`, p.spatial ? 'spatial' : 'head-locked', p.loop ? 'loop' : ''].filter(Boolean).join('\n');
    const tag = document.createElement('span');
    tag.style.opacity = '0.55';
    tag.textContent = (p.loop ? '∞' : '') + (p.spatial ? '◎' : '');
    row.append(
      name, tag,
      button('▶', () => play(id)),
      button('■', () => { (handles.get(id) || []).forEach((h) => h.stop()); handles.delete(id); }),
    );
    list.append(row);
  }
  body.append(list);
  el.append(head, body);
  document.body.append(el);

  function play(id) {
    if (!synth.ctx) synth.start(); // the click is a user gesture
    const p = presets[id];
    const L = synth.listenerPos || { x: 0, y: 1.6, z: 0 };
    let position;
    if (p.spatial) {
      if (around.checked) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 10;
        position = { x: L.x + Math.cos(a) * r, y: L.y, z: L.z + Math.sin(a) * r };
      } else position = { x: L.x, y: L.y, z: L.z - 2 }; // 2 m north of the listener
    }
    const h = synth.play(id, { position });
    if (h.playing) handles.set(id, [...(handles.get(id) || []).filter((x) => x.playing), h]);
  }

  function button(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:11px monospace;background:#2a2814;color:#d8cf8a;border:1px solid #5a5530;padding:0 6px;cursor:pointer';
    b.addEventListener('click', (e) => { onClick(e); b.blur(); });
    return b;
  }

  const timer = setInterval(() => { count.textContent = `${synth.voiceCount} voices`; }, 250);
  return {
    el,
    destroy() { clearInterval(timer); el.remove(); },
  };
}
