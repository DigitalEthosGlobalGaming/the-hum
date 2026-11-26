// Distant-event director: rare, seeded sounds from far away (a thud, a door, footsteps that stop
// when you stop, a phone, a chair rolling). Pure scheduling; the ambience system plays them.
//
// game.audioDirector (this object) is the hook for the future Tenant director:
//   intensity 0..1  raise it and events come sooner and lean towards the unsettling ones
//   trigger(kind?)  queue one now ('thud' | 'door' | 'steps' | 'phone' | 'chair', or a weighted pick)
//   next            seconds (ambience clock) until the next one; last = { kind, at, pos }
import { Rng, hash } from '../core/rng.js';

export const DISTANT_KINDS = ['thud', 'door', 'steps', 'phone', 'chair'];

// [weight at intensity 0, weight at intensity 1]
const WEIGHTS = { thud: [3, 2], door: [2, 3], steps: [1, 4], phone: [1, 1.5], chair: [2, 1.5] };

export class AudioDirector {
  constructor(seed, cfg = {}) {
    this.cfg = { distantMinGap: 25, distantMaxGap: 110, distantFirst: 40, intensity: 0, ...cfg };
    this.rng = new Rng(hash(seed >>> 0, 'ambience-director'));
    this._intensity = 0;
    this.intensity = this.cfg.intensity;
    this.clock = 0;
    this.nextAt = this.cfg.distantFirst * (0.75 + 0.5 * this.rng.next());
    this.queued = null;
    this.last = null;
    this.count = 0;
  }

  get intensity() { return this._intensity; }
  set intensity(v) {
    const n = Math.min(1, Math.max(0, Number(v) || 0));
    // raising it pulls the next event closer (never pushes it away)
    if (n > this._intensity && this.nextAt != null) {
      const left = this.nextAt - this.clock;
      this.nextAt = this.clock + Math.min(left, this.gap(n));
    }
    this._intensity = n;
  }

  get next() { return Math.max(0, this.nextAt - this.clock); }

  /** Seconds to wait after an event at intensity i: mean shrinks from maxGap to minGap. */
  gap(i = this._intensity) {
    const { distantMinGap: lo, distantMaxGap: hi } = this.cfg;
    const mean = hi + (lo - hi) * i;
    return mean * (0.55 + 0.9 * this.rng.next());
  }

  /** Weighted pick, never the same kind twice running. */
  pick() {
    const i = this._intensity;
    let total = 0;
    for (const k of DISTANT_KINDS) if (k !== this.last?.kind) total += WEIGHTS[k][0] + (WEIGHTS[k][1] - WEIGHTS[k][0]) * i;
    let r = this.rng.next() * total;
    for (const k of DISTANT_KINDS) {
      if (k === this.last?.kind) continue;
      r -= WEIGHTS[k][0] + (WEIGHTS[k][1] - WEIGHTS[k][0]) * i;
      if (r <= 0) return k;
    }
    return DISTANT_KINDS.find((k) => k !== this.last?.kind);
  }

  /** Force an event as soon as possible (the next tick). */
  trigger(kind = null) { this.queued = kind && DISTANT_KINDS.includes(kind) ? kind : this.pick(); }

  /**
   * Advance the clock (only while `running`); returns the kind to play now, or null.
   * `busy` (e.g. footsteps still answering) holds events back.
   */
  tick(dt, running = true, busy = false) {
    if (!running) return null;
    this.clock += dt;
    if (busy) return null;
    let kind = null;
    if (this.queued) { kind = this.queued; this.queued = null; }
    else if (this.clock >= this.nextAt) kind = this.pick();
    if (!kind) return null;
    this.nextAt = this.clock + this.gap();
    this.last = { kind, at: this.clock, pos: null };
    this.count++;
    return kind;
  }
}
