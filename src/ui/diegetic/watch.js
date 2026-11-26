// Digital wristwatch on the left wrist. LCD face is a 48x32 canvas drawn with the hand-made
// pixel font + 7-segment digits: clock (in-game time from 03:00), heart rate (sanity-driven BPM),
// pedometer. Low sanity glitches the digits. ui:watchBeep flashes SAVED (or the given text) with
// the watch_beep sound. Holding the watch up for 3 s reveals the hidden seed screen.
import * as THREE from 'three';
import { makeVMMaterial, canvasTexture } from '../../viewmodel/vmMaterial.js';
import { makeDecal } from '../../render/ps1.js';
import { box } from '../../viewmodel/viewModel.js';
import { makeCanvas, pixelText, pixelWidth, segDigit, SEGMENTS } from './text.js';

const W = 48, H = 32;
const BG = '#a3b58a', INK = '#18220f', GHOST = 'rgba(24,34,15,0.09)';

export class Watch {
  constructor(game, wristTop) {
    this.game = game;
    [this.canvas, this.g] = makeCanvas(W, H);
    this.tex = canvasTexture(this.canvas);
    this.clock = 0;            // in-game seconds since 03:00
    this.beepT = 0;
    this.beepText = 'SAVED';
    this.holdT = 0;            // how long the watch has been raised
    this._redraw = 0;
    this._glitchSeed = 0;

    const g = new THREE.Group();
    const caseMesh = box(0.05, 0.012, 0.042, null, { tint: 0x2a2a2a });
    g.add(caseMesh);
    this.faceMat = makeDecal(makeVMMaterial(this.tex, { emissive: 0.35, affine: 0 })); // LCD sits on the case: depth-biased
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.028).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), this.faceMat);
    face.position.y = 0.0068;
    face.renderOrder = 1;
    face.frustumCulled = false;
    g.add(face);
    const strap = box(0.03, 0.006, 0.084, game.textures.get('proc:strap'));
    strap.position.y = -0.006;
    strap.rotation.y = Math.PI / 2; // strap wraps across the forearm
    g.add(strap);
    // face reads along the forearm: long axis across the arm
    g.rotation.y = 0;
    wristTop.add(g);
    this.group = g;

    game.events.on('ui:watchBeep', (p) => this.beep(p?.text));
  }

  beep(text) {
    this.beepText = String(text ?? 'SAVED').toUpperCase().slice(0, 10);
    this.beepT = 2.2;
    this.game.synth?.play?.('watch_beep');
  }

  /** raised: 0..1 how far the wrist is up. vit: { bpm, sanity } */
  update(dt, raised, vit) {
    const game = this.game;
    if (game.playing) this.clock += dt * (game.cfg.ui?.clockScale ?? 1);
    this.beepT = Math.max(0, this.beepT - dt);
    this.holdT = raised > 0.9 ? this.holdT + dt : 0;
    const showing = raised > 0.02 || this.beepT > 0;
    // backlight: brighter in the dark so it can always be read; SAVED pulses (fades with reduceFlashing)
    let glow = 0.35 + (1 - Math.min(1, vit.light * 2)) * 0.35;
    if (this.beepT > 0) {
      const t = 2.2 - this.beepT;
      glow += game.cfg.ui?.reduceFlashing ? 0.3 * Math.max(0, 1 - t / 2.2) : (Math.floor(t * 4) % 2 ? 0 : 0.35);
    }
    this.faceMat.uniforms.uEmissive.value = Math.min(1, glow);
    this._redraw -= dt;
    if (!showing || this._redraw > 0) return;
    this._redraw = 1 / 12;
    this.draw(vit);
  }

  draw(vit) {
    const g = this.g;
    const game = this.game;
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    // glitch amount: starts below 40 % sanity
    const gl = Math.max(0, (0.4 - vit.sanity) / 0.4);
    const glitchOn = gl > 0 && Math.random() < 0.25 + gl * 0.6;
    const rnd = () => Math.random();
    const glitch = glitchOn ? (i, ch) => (rnd() < gl * 0.35 ? '0123456789#%?*'[Math.floor(rnd() * 14)] : null) : null;

    if (this.beepT > 0) {
      const s = this.beepText.length <= 5 ? 2 : 1;
      pixelText(g, this.beepText, Math.round((W - pixelWidth(this.beepText, s)) / 2), Math.round((H - 5 * s) / 2), { scale: s, color: INK });
      this.tex.needsUpdate = true;
      return;
    }

    if (this.holdT > 3) {
      // hidden seed screen
      pixelText(g, 'SEED', 2, 2, { color: INK });
      const hex = (game.seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
      pixelText(g, hex, Math.round((W - pixelWidth(hex)) / 2), 12, { color: INK });
      pixelText(g, String(game.seed >>> 0).slice(-10), 2, 22, { color: INK });
      this.tex.needsUpdate = true;
      return;
    }

    // clock: HH:MM in 7-seg, starting 03:00
    const total = 3 * 3600 + Math.floor(this.clock);
    const hh = Math.floor(total / 3600) % 24, mm = Math.floor(total / 60) % 60, ss = total % 60;
    const digits = [Math.floor(hh / 10), hh % 10, Math.floor(mm / 10), mm % 10];
    const xs = [2, 9, 19, 26];
    for (let i = 0; i < 4; i++) {
      segDigit(g, 8, xs[i], 2, 6, 11, GHOST);                                   // unlit segments
      let segs;
      if (glitchOn && rnd() < gl * 0.5) segs = [...SEGMENTS].filter(() => rnd() < 0.5).join('');
      segDigit(g, digits[i], xs[i], 2, 6, 11, INK, segs);
    }
    if (ss % 2 === 0) { g.fillStyle = INK; g.fillRect(16, 5, 1, 1); g.fillRect(16, 9, 1, 1); }
    pixelText(g, String(ss).padStart(2, '0'), 35, 8, { color: INK, glitch });
    // heart rate + pedometer
    const bpm = Math.round(vit.bpm);
    pixelText(g, '*', 2, 17, { color: INK });
    pixelText(g, String(bpm).padStart(3, '0'), 9, 17, { color: INK, glitch });
    pixelText(g, 'BPM', 24, 17, { color: INK });
    const steps = String(game.stats?.steps ?? 0).padStart(5, '0').slice(-5);
    pixelText(g, 'ST', 2, 25, { color: INK });
    pixelText(g, steps, 13, 25, { color: INK, glitch });
    if (glitchOn && rnd() < gl) {          // a torn scanline
      const y = Math.floor(rnd() * H);
      g.drawImage(this.canvas, 0, y, W, 2, Math.round((rnd() - 0.5) * 6 * gl), y, W, 2);
    }
    this.tex.needsUpdate = true;
  }
}
