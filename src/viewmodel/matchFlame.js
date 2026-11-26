// A lit match pinched in the right hand while a struck match burns (match_strike tags its timed
// light `kind: 'match'`). Purely visual: the light itself is the power network's timed light, which
// already lights the hands through ViewModel.sampleLight. The flame flickers, shrinks as the match
// gutters out over its last seconds, and the stick chars down from the head.
import * as THREE from 'three';
import { getPower } from '../power/network.js';
import { box } from './viewModel.js';

const STICK = 0.05;

export class MatchFlame {
  constructor() {
    this.root = new THREE.Group();
    this.root.position.set(-0.012, 0.055, -0.085);
    this.root.rotation.set(-0.35, 0, 0.25);
    this.stick = box(0.0035, STICK, 0.0035, null, { tint: 0xcaa46a });
    this.stick.position.y = STICK / 2;
    this.char = box(0.004, 0.012, 0.004, null, { tint: 0x2a1c12 });
    this.head = box(0.006, 0.008, 0.006, null, { tint: 0x5a1a10 });
    this.flame = new THREE.Group();
    const outer = flamePlanes(0.011, 0.024, 0xff8a2a, 0.9);
    const inner = flamePlanes(0.0055, 0.012, 0xffe7a0, 1);
    inner.position.y = -0.003;
    this.flame.add(outer, inner);
    this.root.add(this.stick, this.char, this.head, this.flame);
    this.root.visible = false;
    this.t = 0;
  }

  /** The burning match light, or null. */
  static current() {
    const power = getPower();
    if (!power) return null;
    const L = power.timed.lights.find((l) => l.kind === 'match' && l.until > power.clock);
    return L ? { L, left: L.until - power.clock, total: Math.max(0.1, L.until - (L.start ?? L.until - 10)) } : null;
  }

  update(dt, { hidden = false } = {}) {
    const m = MatchFlame.current();
    this.root.visible = !!m && !hidden;
    if (!m) return;
    this.t += dt;
    const burnt = 1 - m.left / m.total;                      // 0 fresh .. 1 out
    const gutter = Math.min(1, m.left / 1.5);                // last 1.5 s: the flame dies
    const n = 0.8 + 0.2 * Math.sin(this.t * 31) * Math.sin(this.t * 13.7 + 1.3);
    const h = Math.max(0.05, gutter * n * (burnt < 0.04 ? 1.6 - burnt * 15 : 1)); // a flare on the strike
    // the char creeps down the stick; head and flame ride the top
    const top = STICK;
    const charLen = 0.006 + burnt * STICK * 0.55;
    this.char.scale.y = charLen / 0.012;
    this.char.position.y = top - charLen / 2;
    this.head.position.y = top;
    this.flame.position.y = top + 0.009 * h;
    this.flame.scale.set(0.85 + 0.15 * n, h, 0.85 + 0.15 * n);
    this.flame.rotation.y = this.t * 0.7;
    this.flame.rotation.z = Math.sin(this.t * 5.1) * 0.12;
  }
}

/** Two crossed, unlit (emissive), double-sided quads: reads as a flame from any angle. */
function flamePlanes(w, h, tint, emissive) {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const m = box(w, h, 0.0001, null, { tint, emissive, side: THREE.DoubleSide });
    m.rotation.y = i * Math.PI / 2;
    g.add(m);
  }
  return g;
}
