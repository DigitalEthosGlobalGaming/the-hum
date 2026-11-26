// Tenant threat + story stages (PLAN §6.1). Pure: no DOM, no Three.js, Node-testable.
//
// threat = spine notes collected (0..12) + small bumps from story actions (ID badges read, fuses
// inserted, evacuation maps copied, photos taken), the bumps capped at `bumpCap` so they can nudge
// a stage early but never replace the notes.
//
//   stage 0 · Rumour    threat < stages[1]   far glimpses only
//   stage 1 · Noticed   ≥ stages[1]          closer glimpses, behind you, lights flicker
//   stage 2 · Followed  ≥ stages[2]          stalks, short hunts; light + flash work on it
//   stage 3 · Hunted    ≥ stages[3]          tension director: calm → stalk → hunt
//
// The story stage only ever rises during a run. Calm mode caps the *behaviour* stage at 1 (the
// Tenant never hunts); the story stage still rises so pools and notebook lines keep up.

export const STAGE_NAMES = ['Rumour', 'Noticed', 'Followed', 'Hunted'];

export const THREAT_DEFAULTS = {
  calm: false,
  stages: [0, 3, 6, 9],
  bumps: { badge: 0.25, fuse: 0.35, evacMap: 0.25, photo: 0.15 },
  bumpCap: 1.5,
};

/** Notebook lines written when a stage is first reached: the rules, learned diegetically. */
export const UNLOCKS = [
  [],
  [{ id: 'tenant:sound', title: 'It', caption: 'It follows sounds. A thrown can, a tape left playing: it goes to the noise, not to me.' }],
  [
    { id: 'tenant:light', title: 'It', caption: "It doesn't like the light. It won't come under a working tube, or near the music box while it plays." },
    { id: 'tenant:flash', title: 'It', caption: 'The flash stops it. It holds still in the white, then it is somewhere else.' },
  ],
  [{ id: 'tenant:hunt', title: 'It', caption: "It isn't watching any more. It is looking. Keep the lights on. Don't run unless you have to." }],
];

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Threat from story progress. inputs: { spine, badges, fuses, evacMaps, photos } (counts). */
export function threatFrom(inputs = {}, cfg = THREAT_DEFAULTS) {
  const b = { ...THREAT_DEFAULTS.bumps, ...(cfg.bumps ?? {}) };
  const bump = num(inputs.badges) * b.badge + num(inputs.fuses) * b.fuse
    + num(inputs.evacMaps) * b.evacMap + num(inputs.photos) * b.photo;
  return num(inputs.spine) + Math.min(cfg.bumpCap ?? THREAT_DEFAULTS.bumpCap, bump);
}

/** Story stage 0..3 for a threat value. */
export function stageFor(threat, cfg = THREAT_DEFAULTS) {
  const th = cfg.stages ?? THREAT_DEFAULTS.stages;
  let s = 0;
  for (let i = 1; i < th.length && i <= 3; i++) if (threat >= th[i] - 1e-9) s = i;
  return s;
}

/** Behaviour stage: Calm mode caps it at 1. */
export const behaviourStage = (story, calm) => (calm ? Math.min(1, story) : story);

/**
 * Tracks threat → stage over a run. `unlocked` is the run-state object it writes to
 * ({ [stage]: true }), so unlocks persist with the run.
 */
export class ThreatTracker {
  constructor(cfg = THREAT_DEFAULTS, unlocked = {}) {
    this.cfg = { ...THREAT_DEFAULTS, ...cfg };
    this.unlocked = unlocked;
    this.threat = 0;
    this.storyStage = 0;
    this.stage = 0;
    this.override = null;   // dev: force a story stage
  }

  /**
   * inputs: counts (see threatFrom). opts: { calm }.
   * Returns { changed, stage, storyStage, threat, unlocks: [lines newly unlocked] }.
   */
  update(inputs, { calm = false } = {}) {
    this.threat = threatFrom(inputs, this.cfg);
    const reached = this.override ?? Math.max(this.storyStage, stageFor(this.threat, this.cfg));
    const before = this.stage;
    this.storyStage = Math.max(0, Math.min(3, reached));
    this.stage = behaviourStage(this.storyStage, calm || !!this.cfg.calm);
    const unlocks = [];
    for (let s = 1; s <= this.storyStage; s++) {
      if (this.unlocked[s]) continue;
      this.unlocked[s] = true;
      unlocks.push(...UNLOCKS[s]);
    }
    return { changed: this.stage !== before, stage: this.stage, storyStage: this.storyStage, threat: this.threat, unlocks };
  }
}
