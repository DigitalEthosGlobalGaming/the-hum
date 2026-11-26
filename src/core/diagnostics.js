// Milestone-1 smoke-test panel (non-diegetic, dev only). Toggle with F3.
// Reports what SharePoint's embedding allows: WebGL, pointer lock, audio, storage, iframe.
export class Diagnostics {
  constructor() {
    this.el = document.createElement('pre');
    Object.assign(this.el.style, {
      position: 'fixed', left: '8px', top: '8px', margin: 0, padding: '6px 8px',
      font: '12px/1.35 monospace', color: '#cfe8a8', background: 'rgba(0,0,0,0.65)',
      pointerEvents: 'none', zIndex: 10, whiteSpace: 'pre',
    });
    document.body.appendChild(this.el);
    this.visible = true;
    this.frames = 0;
    this.acc = 0;
    this.fps = 0;
    this.storage = (() => {
      try { localStorage.setItem('__hum_test', '1'); localStorage.removeItem('__hum_test'); return 'ok'; }
      catch (e) { return 'blocked (' + (e?.name || e) + ')'; }
    })();
    this.inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  }

  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? '' : 'none'; }

  update(dt, { renderer, input, synth, player, extra = [] }) {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.fps = Math.round(this.frames / this.acc);
    this.frames = 0;
    this.acc = 0;
    if (!this.visible) return;
    const gl = renderer.renderer.getContext();
    const pl = input.pointerLock;
    this.el.textContent = [
      'THE HUM · dev diagnostics (F3 hides)',
      `fps        ${this.fps}`,
      `webgl      ${gl ? (gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1') : 'none'}`,
      `low-res    ${renderer.target.width}×${renderer.target.height}`,
      `iframe     ${this.inIframe ? 'yes' : 'no'}`,
      `ptr lock   ${pl.supported ? pl.state : 'unsupported'}${pl.error ? ' (' + pl.error + ')' : ''}`,
      `look mode  ${input.mode === 'lock' ? 'pointer lock' : 'click-drag fallback'}`,
      `audio      ${synth.state}`,
      `storage    ${this.storage}`,
      `pos        ${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}`,
      ...extra,
    ].join('\n');
  }
}
