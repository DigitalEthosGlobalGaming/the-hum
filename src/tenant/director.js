// Tension director: decides *when* the Tenant shows up and keeps a smoothed tension meter that
// drives game.dangerLevel and game.audioDirector.intensity. Pure (no DOM / Three).
//
//   stage 0-1  a glimpse every `gap[stage]` seconds (random in range)
//   stage 2    encounters every gap[2] s: a stalk (`stalkChance`) or a glimpse. After a hunt there
//              is a guaranteed quiet of `afterHunt` s
//   stage 3    phases cycle calm → stalk → hunt: calm `calm3` s (after a hunt at least `afterHunt`),
//              then a stalk for `stalk3` s, and if it is still stalking when that runs out the
//              director forces a hunt (the AI's own triggers can start one sooner)
import { ST } from './ai.js';

export const DIRECTOR_DEFAULTS = {
  gap: [[120, 300], [60, 150], [45, 100], [40, 80]],
  firstGap: 0.4,          // the first encounter of a run comes sooner (× gap)
  stalkChance: 0.65,
  afterHunt: [40, 60],
  calm3: [30, 50],
  stalk3: [25, 50],
  alertGap: 8,            // a loud noise while it is away (stage ≥ 2) brings it within this many s
  rise: 2.0,              // tension smoothing rates (1/s)
  fall: 0.2,
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Director {
  constructor(cfg = {}, rng) {
    this.cfg = { ...DIRECTOR_DEFAULTS, ...cfg };
    this.rng = rng;
    this.phase = 'quiet';     // quiet | encounter | calm | stalk | hunt
    this.wait = -1;           // s until the next encounter (-1 = not scheduled yet)
    this.phaseLeft = 0;
    this.tension = 0;
    this.target = 0;
    this.hunted = false;      // a hunt happened in the current encounter
    this.minQuiet = 0;        // guaranteed quiet left (after hunts / being caught)
    this.lastStage = -1;
  }

  range([a, b]) { return a + (b - a) * this.rng.next(); }
  gapFor(stage) { return this.range(this.cfg.gap[Math.min(3, stage)]); }

  /** Force a quiet spell (after being caught). */
  quiet(sec = this.range(this.cfg.afterHunt)) {
    this.minQuiet = Math.max(this.minQuiet, sec);
    this.wait = Math.max(this.wait, sec);
    this.phase = 'calm';
  }

  /** A loud noise while the Tenant is away. */
  alert() { if (this.minQuiet <= 0 && this.wait > this.cfg.alertGap) this.wait = this.cfg.alertGap; }

  /**
   * Per frame. Returns a command for the AI ('glimpse' | 'stalk' | 'hunt') or null.
   * @param ai  TenantAI (reads state, present, bb.dist, bb.seen)
   */
  update(dt, ai, stage) {
    let cmd = null;
    if (this.wait < 0 || stage !== this.lastStage) {
      // first schedule, or the stage changed: re-plan (never later than what was planned)
      const first = this.wait < 0;
      const g = this.gapFor(stage) * (first ? this.cfg.firstGap : 1);
      this.wait = first ? g : Math.min(this.wait, g);
      if (stage >= 3 && this.phase !== 'hunt' && this.phase !== 'stalk') this.phase = 'calm';
      this.lastStage = stage;
    }
    this.minQuiet = Math.max(0, this.minQuiet - dt);
    const dormant = ai.state === ST.DORMANT;

    if (dormant) {
      if (this.phase === 'encounter' || this.phase === 'stalk' || this.phase === 'hunt') {
        // an encounter just ended
        const after = this.hunted ? this.range(this.cfg.afterHunt) : 0;
        if (this.hunted) this.minQuiet = Math.max(this.minQuiet, after);
        this.wait = stage >= 3 ? Math.max(after, this.range(this.cfg.calm3)) : Math.max(after, this.gapFor(stage));
        this.phase = stage >= 3 ? 'calm' : 'quiet';
        this.hunted = false;
      }
      this.wait -= dt;
      if (this.wait <= 0 && this.minQuiet <= 0) {
        this.wait = 10; // retry soon if the spawn fails (no spot)
        if (stage >= 3) { cmd = 'stalk'; this.phaseLeft = this.range(this.cfg.stalk3); }
        else if (stage === 2) cmd = this.rng.next() < this.cfg.stalkChance ? 'stalk' : 'glimpse';
        else cmd = 'glimpse';
      }
    } else {
      if (ai.state === ST.HUNT) { this.phase = 'hunt'; this.hunted = true; }
      else if (this.phase !== 'hunt') this.phase = stage >= 3 && ai.state === ST.STALK ? 'stalk' : 'encounter';
      if (stage >= 3 && this.phase === 'stalk' && ai.state === ST.STALK) {
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) { cmd = 'hunt'; this.phaseLeft = 1e9; }
      }
    }

    this.target = tensionFor(ai, stage);
    const rate = this.target > this.tension ? this.cfg.rise : this.cfg.fall;
    this.tension += (this.target - this.tension) * (1 - Math.exp(-rate * dt));
    return cmd;
  }
}

/** Target tension 0..1 for what the Tenant is doing right now. */
export function tensionFor(ai, stage) {
  if (!ai.present) return stage >= 3 ? 0.06 : 0;
  const d = ai.bb.dist;
  const near = (r) => clamp01(1 - d / r);
  switch (ai.state) {
    case ST.GLIMPSE: return 0.12 + (stage >= 1 ? 0.18 : 0) + (ai.bb.seen ? 0.12 : 0);
    case ST.STALK: return 0.4 + 0.35 * near(25);
    case ST.HUNT: return 0.8 + 0.2 * near(15);
    case ST.LOSE: return 0.3;
    default: return 0;
  }
}
