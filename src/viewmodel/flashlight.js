// The torch in the left hand. Replaces main's minimal game.flashlight with the same fields
// ({ on, battery, toggle(), recharge(amount) }) plus the model: knurled body, lens, 3 battery LEDs.
// Battery drains while on; below 25 % the beam dims and stutters (or fades smoothly with
// ui.reduceFlashing). LEDs go out at 66 / 33 / 5 %. Emits flashlight:change.
import * as THREE from 'three';
import { shared } from '../render/ps1.js';
import { cyl, box } from './viewModel.js';

const LED_AT = [0.05, 0.33, 0.66]; // LED i stays lit while battery > LED_AT[i]

export class Flashlight {
  constructor(game) {
    this.game = game;
    const old = game.flashlight ?? {};
    this.on = old.on ?? true;
    this.battery = old.battery ?? 1;
    this.beam = 0;             // what the shader gets this frame (0..1)
    this.leds = 0;
    this._flick = 0;
    this._noise = 0;
    this.model = this.buildModel(game.textures);
    this.updateLeds(true);
  }

  get cfg() { return this.game.cfg; }

  toggle() {
    this.on = !this.on;
    this.game.synth?.play?.('flashlight_click');
    this.updateLeds(true);
    this.emit();
  }

  recharge(amount = 1) {
    this.battery = Math.min(1, this.battery + amount);
    this.updateLeds(true);
    this.emit();
  }

  emit() { this.game.events.emit('flashlight:change', { on: this.on, battery: this.battery }); }

  buildModel(textures) {
    const g = new THREE.Group();
    const body = cyl(0.019, 0.019, 0.17, 8, textures.get('proc:torch'));
    body.position.z = -0.04;
    g.add(body);
    const head = cyl(0.021, 0.03, 0.05, 8, textures.get('proc:torch'), { tint: 0xbfc3c8 });
    head.position.z = -0.15;
    g.add(head);
    this.lensMat = null;
    const lens = cyl(0.025, 0.025, 0.004, 8, null, { tint: 0xfff0c8, emissive: 1 });
    lens.position.z = -0.176;
    this.lensMat = lens.material;
    g.add(lens);
    const tail = cyl(0.017, 0.019, 0.02, 8, null, { tint: 0x222222 });
    tail.position.z = 0.055;
    g.add(tail);
    // switch + LED strip on top, toward the rear so the hand doesn't cover it
    const sw = box(0.012, 0.006, 0.016, null, { tint: 0x111111 });
    sw.position.set(0, 0.02, -0.112);
    g.add(sw);
    const strip = box(0.012, 0.004, 0.052, null, { tint: 0x0d0d0d });
    strip.position.set(0, 0.0195, -0.075);
    g.add(strip);
    this.ledMats = [];
    for (let i = 0; i < 3; i++) {
      const led = box(0.007, 0.005, 0.008, null, { tint: 0x203020, emissive: 0 });
      led.position.set(0, 0.022, -0.06 - i * 0.015); // ahead of the fist; rear → front: low → high
      this.ledMats.push(led.material);
      g.add(led);
    }
    return g;
  }

  updateLeds(force = false) {
    const lit = this.on ? LED_AT.filter((t) => this.battery > t).length : 0;
    if (!force && lit === this.leds) return;
    const crossed = lit !== this.leds;
    this.leds = lit;
    for (let i = 0; i < 3; i++) {
      const m = this.ledMats[i];
      const on = i < lit;
      m.uniforms.uEmissive.value = on ? 1 : 0;
      m.uniforms.uTint.value.set(on ? (lit === 1 ? 0xff7a2a : 0x6cff6c) : 0x1c2a1c);
    }
    if (crossed && !force) this.emit();
  }

  update(dt, game) {
    const ui = this.cfg.ui ?? {};
    const vit = this.cfg.vitals ?? {};
    if (this.on && this.battery > 0 && game.playing) {
      this.battery = Math.max(0, this.battery - dt / (vit.batterySeconds ?? 360));
    }
    this.updateLeds();
    let beam = this.on && this.battery > 0 ? 0.25 + this.battery * 0.75 : 0;
    if (beam > 0 && this.battery < 0.25) {
      const low = 1 - this.battery / 0.25;      // 0 at 25 % → 1 when empty
      beam *= 1 - low * 0.55;                    // dims
      if (ui.reduceFlashing) {
        beam *= 0.8 + 0.2 * Math.sin(game.time * 1.6); // slow breathing fade, no strobe
      } else {
        // stutter: random short dropouts, more often as it dies
        this._flick -= dt;
        if (this._flick <= 0) {
          this._flick = 0.05 + Math.random() * (1.6 - low * 1.3);
          this._noise = Math.random() < 0.35 + low * 0.4 ? 0.15 + Math.random() * 0.5 : 1;
        }
        beam *= this._noise;
        this._noise = Math.min(1, this._noise + dt * 6);
      }
    }
    this.beam = beam;
    shared.uFlashOn.value = beam; // overrides main's simple feed (runs after it, before render)
    this.lensMat.uniforms.uEmissive.value = beam > 0 ? 0.5 + beam * 0.5 : 0;
    this.lensMat.uniforms.uTint.value.setScalar(beam > 0 ? 1 : 0.25);
    // last LED blinks when nearly flat (steady with reduceFlashing)
    if (this.leds === 1 && this.battery < 0.15 && !ui.reduceFlashing) {
      this.ledMats[0].uniforms.uEmissive.value = Math.sin(game.time * 5) > 0 ? 1 : 0.15;
    }
  }
}
