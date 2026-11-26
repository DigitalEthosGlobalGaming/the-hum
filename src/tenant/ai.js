// The Tenant's brain: perception → FSM → path → movement. Pure (no DOM / Three): it talks to the
// world through isSolidAt / wallBetween / lightAt / auraAt, and to presentation through `fx`
// callbacks, so node tests drive it with a fake world.
//
//   Dormant → Glimpse                (stage 0+: appears at the end of a sightline, never approaches)
//   Dormant → Stalk → Hunt → Lose    (stage 2+: follows out of view; hunts on loud noise / staring)
//   any present state → Lose → Dormant
//
// THE CORE RULE: it never moves while it is inside the player's view cone and in line of sight.
// Every step re-checks both where it stands and where it would step to (a step can't carry it
// into view either), every frame, so there is no stale-perception window.
//
// FSM hygiene (game-ai skill): the first state goes through change(); transitions requested
// from update are queued and applied after it; each state has a minimum time; every trigger has
// separate enter/exit thresholds or a meter that fills and drains (stare, lost-sight, light).
import { GridNav } from './nav.js';
import { coneTest, losTo, visibleAt, standable, findGlimpseSpot, yawOf, wrapAngle } from './perception.js';

export const ST = { DORMANT: 'Dormant', GLIMPSE: 'Glimpse', STALK: 'Stalk', HUNT: 'Hunt', LOSE: 'Lose' };

const DEG = Math.PI / 180;

export const AI_DEFAULTS = {
  height: 2.4,
  halfWidth: 0.35,
  minStateTime: 0.5,
  stride: 1.15,               // m between its footsteps
  hearScale: 1,               // hearing radius = noise loudness × this
  glimpse: {
    distance: [[25, 40], [15, 25], [15, 25], [15, 25]],  // per stage, m
    behindChance: [0, 0.4, 0.4, 0.4],
    behindCone: 40,           // deg half-angle of the back cone
    lookCone: 9,              // deg: "looking right at it"
    lookSeconds: 0.6,         // that long → it blinks out
    vanishNear: [15, 8, 8, 8],
    seenMax: [0, 1.6, 1.6, 1.6], // s in view before it blinks out anyway (0 = no limit)
    timeout: 45,              // unseen this long → gone
  },
  stalk: {
    spawn: [14, 24],          // m of walking from the player
    speed: 2.8,
    far: 16,                  // approach when further than this...
    near: [10, 5],            // ...until closer than this (creeps from [0] to [1] over the stalk)
    creep: 0.06,              // m/s the hold distance shrinks
    duration: [[0, 0], [0, 0], [40, 80], [0, 0]], // [0,0] = until the director decides
    giveUp: 45,               // further than this (m) → it loses interest
  },
  hunt: {
    speed: [3.6, 3.6, 3.6, 4.1],
    duration: [[12, 18], [12, 18], [10, 18], [20, 35]],
    noise: 6.5,               // loudness that starts a hunt (sprint footsteps ≈ 8, walk ≈ 5)
    stare: 3,                 // s of being stared at...
    stareNear: 12,            // ...within this (m) starts a hunt; the meter drains beyond stareFar
    stareFar: 14,
    loseLos: 6,               // s without line of sight → it loses you
    light: 0.5,               // world.lightAt above this is "strong light" (stage ≥ 2)
    lightHold: 1,             // s in strong light before it gives up
    repath: 0.5,
    linger: 3,                // s it stays at a lure
    catchRadius: 1,
  },
  flash: { range: 14, cone: 18, freeze: 3 },
};

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over ?? {})) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}
export const mergeCfg = merge;

const at = (arr, stage) => arr[Math.max(0, Math.min(arr.length - 1, stage))];
const _p = { x: 0, y: 0, z: 0 };
const _q = { x: 0, y: 0, z: 0 };
const _spot = { x: 0, z: 0, d: 0, rel: 0 };
const _cone = { inCone: false, angle: 0, centre: 0, dist: 0 };

export class TenantAI {
  /**
   * @param o { world, cfg, rng, fx, nav? }
   *   world: isSolidAt(x,z), wallBetween(a,b), lightAt?(pos), auraAt?(pos, kind)
   *   fx: optional callbacks { appear, vanish(ai, kind, seen), firstSight, step, huntStart, lose, lure(ai, noise), flashed(ai, froze), caught, change(ai, from, to, reason) }
   */
  constructor({ world, cfg = {}, rng, fx = {}, nav = null }) {
    this.world = world;
    this.cfg = merge(AI_DEFAULTS, cfg);
    this.rng = rng;
    this.fx = fx;
    this.nav = nav ?? new GridNav((x, z) => world.isSolidAt(x, z));
    this.x = 0; this.z = 0; this.yaw = 0;
    this.present = false;
    this.moving = false;
    this.time = 0;
    this.stage = 0;
    this.canCatch = false;
    this.hold = false;          // dev: glimpses don't vanish (screenshots)
    this.view = null;
    this.px = 0; this.pz = 0;
    this.bb = { dist: 99, inCone: false, seen: false, centered: false, seenT: 0, losToPlayer: false, playerLit: false, playerCalm: false };
    this.sighted = false;       // seen at least once this encounter
    this.lookT = 0; this.stare = 0; this.lostFor = 0; this.lightSafe = 0;
    this.frozenUntil = -1; this.fleeAfterFreeze = false;
    this.goalKind = 'player'; this.goalX = 0; this.goalZ = 0;
    this.lastX = 0; this.lastZ = 0;
    this.left = 0;              // s left in this stalk / hunt
    this.near = 10; this.approaching = true;
    this.lingerT = 0; this.leaving = false; this.behind = false;
    this.strideAcc = 0;
    this.pathX = new Float32Array(256); this.pathZ = new Float32Array(256);
    this.pathN = 0; this.pathI = 0; this.repathT = 0; this.pathGX = 1e9; this.pathGZ = 1e9; this.pathFails = 0;
    this.losT = 0; this.senseT = 0;
    this.noise = { pending: false, x: 0, z: 0, loudness: 0, source: '' };
    this.alerted = false;       // a loud noise was made while it was away (director reads + clears)
    this.log = [];              // recent transitions { t, from, to, reason }
    this.state = null;
    this.stateTime = 0;
    this.qState = null; this.qReason = ''; this.qForce = false;
    this.lightScore = (x, z) => { _p.x = x; _p.y = 2.2; _p.z = z; return this.world.lightAt(_p) ?? 0; };
    this.change(ST.DORMANT, 'start');
  }

  get frozen() { return this.time < this.frozenUntil; }

  // ------------------------------------------------------------------ FSM plumbing

  /** Request a transition; applied after update() (forced ones skip the minimum state time). */
  queue(state, reason = '', force = false) {
    if (this.qState && this.qForce && !force) return;
    this.qState = state; this.qReason = reason; this.qForce = force;
  }

  change(to, reason = '') {
    const from = this.state;
    if (from) this.exit(from);
    this.state = to;
    this.stateTime = 0;
    if (this.log.length >= 12) this.log.shift();
    this.log.push({ t: this.time, from, to, reason });
    this.enter(to);
    this.fx.change?.(this, from, to, reason);
  }

  enter(s) {
    const c = this.cfg;
    switch (s) {
      case ST.DORMANT:
        this.present = false; this.moving = false; this.sighted = false;
        this.stare = 0; this.lookT = 0; this.leaving = false; this.fleeAfterFreeze = false;
        this.bb.seen = false; this.bb.inCone = false; this.bb.centered = false; this.bb.seenT = 0;
        break;
      case ST.GLIMPSE:
        this.lookT = 0; this.leaving = false;
        break;
      case ST.STALK: {
        this.approaching = true; this.near = c.stalk.near[0]; this.stare = 0;
        const d = at(c.stalk.duration, this.stage);
        this.left = d[1] > 0 ? this.range(d) : Infinity;
        this.pathN = 0; this.repathT = 0;
        break;
      }
      case ST.HUNT:
        this.left = this.range(at(c.hunt.duration, this.stage));
        this.lostFor = 0; this.lightSafe = 0; this.lingerT = 0; this.pathFails = 0;
        this.pathN = 0; this.repathT = 0;
        if (this.goalKind === 'player') { this.lastX = this.px; this.lastZ = this.pz; }
        this.fx.huntStart?.(this);
        break;
      case ST.LOSE:
        this.moving = false;
        this.fx.lose?.(this);
        break;
    }
  }

  exit(s) {
    if (s === ST.HUNT) this.goalKind = 'player'; // (a stalk hands its goal to the hunt it starts)
    this.pathN = 0;
  }

  range([a, b]) { return a + (b - a) * this.rng.next(); }

  // ------------------------------------------------------------------ inputs

  /** A world:noise. Buffered (loudest per frame) and handled inside update(). */
  hear(n) {
    if (this.noise.pending && n.loudness <= this.noise.loudness) return;
    this.noise.pending = true;
    this.noise.x = n.x; this.noise.z = n.z; this.noise.loudness = n.loudness; this.noise.source = n.source ?? '';
  }

  /**
   * camera:flash { pos, dir }. Aimed at it within range: at stage ≥ 2 it freezes for `freeze` s
   * and then retreats; below that a glimpse just blinks out. Returns true if it was hit.
   */
  flash(pos, dir) {
    if (!this.present) return false;
    const f = this.cfg.flash;
    const dx = this.x - pos.x, dz = this.z - pos.z, dy = this.cfg.height * 0.7 - (pos.y ?? 1.6);
    const d = Math.hypot(dx, dz);
    if (d > f.range) return false;
    const len = Math.hypot(dx, dy, dz) || 1, dl = Math.hypot(dir.x, dir.y ?? 0, dir.z) || 1;
    const cos = (dx * dir.x + dy * (dir.y ?? 0) + dz * dir.z) / (len * dl);
    if (cos < Math.cos(f.cone * DEG) && d > 1.5) return false;
    if (!losTo(this.world, pos, this.x, this.z, this.cfg.halfWidth)) return false;
    if (this.stage >= 2) {
      this.frozenUntil = this.time + f.freeze;
      this.fleeAfterFreeze = true;
      this.moving = false;
      this.fx.flashed?.(this, true);
    } else {
      this.fx.flashed?.(this, false);
      this.vanish('flash');
    }
    return true;
  }

  // ------------------------------------------------------------------ commands (director / dev)

  /** Appear at the far end of a sightline. Returns false if there is no spot right now. */
  spawnGlimpse(view, stage = this.stage) {
    if (this.state !== ST.DORMANT) return false;
    const g = this.cfg.glimpse;
    const [minD, maxD] = at(g.distance, stage);
    let mode = this.rng.next() < at(g.behindChance, stage) ? 'behind' : 'side';
    const opts = { minD, maxD, mode, behindCone: g.behindCone * DEG, light: this.world.lightAt ? this.lightScore : null };
    let ok = findGlimpseSpot(this.world, view, this.rng, opts, _spot);
    if (!ok && mode === 'behind') { mode = opts.mode = 'side'; ok = findGlimpseSpot(this.world, view, this.rng, opts, _spot); }
    if (!ok) { opts.minD = minD * 0.75; ok = findGlimpseSpot(this.world, view, this.rng, opts, _spot); }
    if (!ok) return false;
    this.view = view;
    this.place(_spot.x, _spot.z, view);
    this.behind = mode === 'behind';
    this.change(ST.GLIMPSE, this.behind ? 'behind' : 'sightline');
    this.fx.appear?.(this);
    return true;
  }

  /** Appear somewhere out of view, a walk away from the player, and start stalking. */
  spawnStalk(view, px, pz) {
    if (this.state !== ST.DORMANT) return false;
    if (!this.findStalkSpot(view, px, pz)) return false;
    this.view = view;
    this.place(_spot.x, _spot.z, view);
    this.change(ST.STALK, 'director');
    this.fx.appear?.(this);
    return true;
  }

  /** Start a hunt now (director at stage 3, or dev). Spawns out of view first if absent. */
  forceHunt(view, px, pz) {
    this.px = px; this.pz = pz;
    if (!this.present && !this.spawnStalk(view, px, pz)) return false;
    this.goalKind = 'player';
    if (this.state !== ST.HUNT) this.change(ST.HUNT, 'forced');
    return true;
  }

  findStalkSpot(view, px, pz) {
    const [lo, hi] = this.cfg.stalk.spawn;
    const nav = this.nav;
    const n = nav.flood(px, pz, hi + 4);
    let best = -1;
    for (let k = 0; k < n; k++) {
      const i = nav.reach[k];
      const g = nav.g[i];
      if (g < lo || g > hi) continue;
      const x = nav.cellX(i), z = nav.cellZ(i);
      if (!standable(this.world, x, z) || visibleAt(this.world, view, x, z, this.cfg.height, this.cfg.halfWidth)) continue;
      const rel = Math.abs(wrapAngle(yawOf(x - px, z - pz) - view.yaw));
      const score = rel + this.rng.next() * 1.2; // behind you, give or take
      if (score > best) { best = score; _spot.x = x; _spot.z = z; }
    }
    return best >= 0;
  }

  place(x, z, view) {
    this.x = x; this.z = z;
    this.yaw = view ? yawOf(view.eye.x - x, view.eye.z - z) : this.yaw;
    this.present = true; this.sighted = false; this.strideAcc = 0;
    this.bb.seen = false; this.bb.seenT = 0;
  }

  /** Disappear (blink while seen, or simply gone when unseen). */
  vanish(kind) {
    if (!this.present) return;
    this.fx.vanish?.(this, kind, this.bb.seen);
    this.present = false;
    this.queue(ST.DORMANT, kind, true);
  }

  // ------------------------------------------------------------------ per frame

  /**
   * ctx: { view, px, pz, stage, canCatch, playing }
   *   view = { eye:{x,y,z}, yaw, pitch, hHalf, vHalf } (radians)
   */
  update(dt, ctx) {
    if (ctx.playing === false) return;
    this.time += dt;
    this.stateTime += dt;
    this.view = ctx.view;
    this.px = ctx.px; this.pz = ctx.pz;
    this.stage = ctx.stage ?? this.stage;
    this.canCatch = !!ctx.canCatch;
    this.perceive(dt);
    this.processNoise();
    if (this.fleeAfterFreeze && !this.frozen && this.present) {
      this.fleeAfterFreeze = false;
      this.queue(ST.LOSE, 'flash', true);
    }
    if (!this.frozen) {
      switch (this.state) {
        case ST.GLIMPSE: this.updateGlimpse(dt); break;
        case ST.STALK: this.updateStalk(dt); break;
        case ST.HUNT: this.updateHunt(dt); break;
        case ST.LOSE: this.updateLose(dt); break;
      }
    } else this.moving = false;
    if (this.qState && (this.qForce || this.stateTime >= this.cfg.minStateTime)) {
      const s = this.qState, r = this.qReason;
      this.qState = null; this.qForce = false;
      if (s !== this.state || s === ST.DORMANT) this.change(s, r);
    }
  }

  perceive(dt) {
    const bb = this.bb, view = this.view, c = this.cfg;
    if (!this.present || !view) { bb.seen = false; bb.inCone = false; bb.centered = false; bb.seenT = 0; return; }
    bb.dist = Math.hypot(this.px - this.x, this.pz - this.z);
    // cheap → expensive: cone first, rays only inside it (every frame: no stale window)
    bb.inCone = coneTest(view, this.x, this.z, c.height, c.halfWidth, _cone);
    bb.seen = bb.inCone && losTo(this.world, view.eye, this.x, this.z, c.halfWidth);
    bb.centered = bb.seen && _cone.centre < c.glimpse.lookCone * DEG;
    bb.seenT = bb.seen ? bb.seenT + dt : 0;
    if (bb.seen && !this.sighted) { this.sighted = true; this.fx.firstSight?.(this); }
    // its own line of sight to you (5 Hz)
    this.losT -= dt;
    if (bb.seen) { bb.losToPlayer = true; this.losT = 0.2; }
    else if (this.losT <= 0) {
      this.losT = 0.2;
      _p.x = this.x; _p.z = this.z; _q.x = this.px; _q.z = this.pz;
      bb.losToPlayer = bb.dist < 40 && !this.world.wallBetween(_p, _q);
    }
    // light / calm around the player (4 Hz; only matters from stage 2)
    this.senseT -= dt;
    if (this.senseT <= 0 && this.stage >= 2) {
      this.senseT = 0.25;
      _p.x = this.px; _p.y = 1.5; _p.z = this.pz;
      bb.playerLit = (this.world.lightAt?.(_p) ?? 0) > c.hunt.light;
      _p.y = 0;
      bb.playerCalm = !!this.world.auraAt?.(_p, 'calm');
    }
  }

  processNoise() {
    const n = this.noise;
    if (!n.pending) return;
    n.pending = false;
    if (this.frozen) return; // the flash's own bang doesn't count
    const own = n.source === 'footstep' || Math.hypot(n.x - this.px, n.z - this.pz) < 3;
    const loud = n.loudness >= this.cfg.hunt.noise;
    if (!this.present) { if (this.stage >= 2 && loud) this.alerted = true; return; }
    if (Math.hypot(n.x - this.x, n.z - this.z) > n.loudness * this.cfg.hearScale) return;
    if (this.state === ST.GLIMPSE) {
      if (!own && this.stage >= 1) { this.leaving = true; this.fx.lure?.(this, n); }
      return;
    }
    if (this.stage < 2) return;
    if (own) {
      if (this.state === ST.HUNT && this.goalKind === 'player') { this.lastX = n.x; this.lastZ = n.z; }
      else if (this.state === ST.STALK && loud) { this.goalKind = 'player'; this.queue(ST.HUNT, 'noise'); }
    } else if (this.state === ST.STALK || this.state === ST.HUNT) {
      this.goalKind = 'lure'; this.goalX = n.x; this.goalZ = n.z; this.lingerT = 0; this.repathT = 0;
      this.fx.lure?.(this, n);
      if (this.state === ST.STALK) this.queue(ST.HUNT, 'lure');
    }
  }

  updateGlimpse(dt) {
    const g = this.cfg.glimpse, bb = this.bb, s = this.stage;
    this.moving = false;
    this.lookT = bb.centered ? this.lookT + dt : Math.max(0, this.lookT - dt);
    if (this.hold) return;
    const seenMax = at(g.seenMax, s);
    if (this.lookT >= g.lookSeconds) this.vanish('look');
    else if (bb.dist < at(g.vanishNear, s)) this.vanish('near');
    else if (seenMax > 0 && bb.seenT >= seenMax) this.vanish('seen');
    else if (this.leaving && !bb.seen) this.vanish('lure');
    else if (this.stateTime > g.timeout && !bb.seen) this.vanish('timeout');
  }

  updateStalk(dt) {
    const c = this.cfg, st = c.stalk, h = c.hunt, bb = this.bb, d = bb.dist;
    this.left -= dt;
    this.near = Math.max(st.near[1], this.near - st.creep * dt);
    // stare meter: fills while you look at it up close, holds in the band, drains beyond it
    if (bb.seen && d < h.stareNear) this.stare += dt;
    else if (!bb.seen || d > h.stareFar) this.stare = Math.max(0, this.stare - 0.5 * dt);
    if (this.stare >= h.stare) { this.goalKind = 'player'; this.queue(ST.HUNT, 'stare'); }
    if (this.left <= 0 || d > st.giveUp) this.queue(ST.LOSE, this.left <= 0 ? 'bored' : 'far');
    // keep its distance: approach beyond `far`, hold inside `near` (hysteresis band between)
    if (d > st.far) this.approaching = true;
    else if (d < this.near) this.approaching = false;
    if (this.approaching && !(this.stage >= 2 && bb.playerCalm)) this.follow(this.px, this.pz, st.speed, dt);
    else { this.moving = false; if (!bb.seen) this.faceTo(this.px, this.pz); }
  }

  updateHunt(dt) {
    const c = this.cfg, h = c.hunt, bb = this.bb;
    const speed = at(h.speed, this.stage);
    this.left -= dt;
    if (this.goalKind === 'player') {
      if (bb.losToPlayer) { this.lastX = this.px; this.lastZ = this.pz; this.lostFor = Math.max(0, this.lostFor - 2 * dt); }
      else this.lostFor += dt;
      if (this.stage >= 2) {
        this.lightSafe = bb.playerLit ? this.lightSafe + dt : Math.max(0, this.lightSafe - dt);
        if (bb.playerCalm) this.queue(ST.LOSE, 'calm');
        else if (this.lightSafe >= h.lightHold) this.queue(ST.LOSE, 'light');
      }
      if (this.lostFor >= h.loseLos) this.queue(ST.LOSE, 'lost');
      if (this.pathFails >= 3 && !bb.losToPlayer) this.queue(ST.LOSE, 'nopath');
      this.follow(this.lastX, this.lastZ, speed, dt);
      if (bb.dist < h.catchRadius && !bb.seen && this.canCatch && !this.qForce) {
        this.fx.caught?.(this);
        this.present = false;
        this.queue(ST.DORMANT, 'caught', true);
        return;
      }
    } else {
      const arrived = this.follow(this.goalX, this.goalZ, speed, dt) || Math.hypot(this.goalX - this.x, this.goalZ - this.z) < 1.5;
      if (arrived) { this.lingerT += dt; this.moving = false; }
      if (this.lingerT >= h.linger || this.pathFails >= 3) this.queue(ST.LOSE, 'lure');
    }
    if (this.left <= 0) this.queue(ST.LOSE, 'timeout');
  }

  updateLose() {
    this.moving = false;
    // gone the moment you aren't looking (never while you are)
    if (this.stateTime >= this.cfg.minStateTime && !this.bb.seen) this.vanish('gone');
  }

  // ------------------------------------------------------------------ movement

  faceTo(x, z) { this.yaw = yawOf(x - this.x, z - this.z); }

  /** One step straight toward (tx, tz). Returns true if it is there. Never while seen. */
  moveToward(tx, tz, speed, dt) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) { this.moving = false; return true; }
    if (!this.present || this.bb.seen || this.frozen) { this.moving = false; return false; }
    const s = Math.min(d, speed * dt);
    const nx = this.x + (dx / d) * s, nz = this.z + (dz / d) * s;
    // the step must not carry it into view either
    if (this.view && visibleAt(this.world, this.view, nx, nz, this.cfg.height, this.cfg.halfWidth)) { this.moving = false; return false; }
    if (this.stage >= 2 && this.world.auraAt) {
      _p.x = nx; _p.y = 0; _p.z = nz;
      if (this.world.auraAt(_p, 'calm')) { this.moving = false; return false; }
    }
    this.x = nx; this.z = nz;
    this.yaw = yawOf(dx, dz);
    this.moving = true;
    this.strideAcc += s;
    if (this.strideAcc >= this.cfg.stride) { this.strideAcc = 0; this.fx.step?.(this); }
    return s >= d - 1e-6;
  }

  /** Follow an A* path to (gx, gz), repathing at low frequency. Returns true on arrival. */
  follow(gx, gz, speed, dt) {
    this.repathT -= dt;
    if (this.repathT <= 0 || Math.hypot(gx - this.pathGX, gz - this.pathGZ) > 2 || (this.pathN > 0 && this.pathI >= this.pathN)) {
      this.repathT = this.cfg.hunt.repath;
      this.pathGX = gx; this.pathGZ = gz;
      const n = this.nav.findPath(this.x, this.z, gx, gz);
      if (n < 0) { this.pathN = 0; this.pathFails++; }
      else {
        for (let i = 0; i < n; i++) { this.pathX[i] = this.nav.pathX[i]; this.pathZ[i] = this.nav.pathZ[i]; }
        this.pathN = n; this.pathI = 0; this.pathFails = 0;
      }
    }
    if (this.pathN === 0) {
      // no path (goal in a wall / unbuilt): go straight if nothing is in the way
      _p.x = this.x; _p.z = this.z; _q.x = gx; _q.z = gz;
      if (Math.hypot(gx - this.x, gz - this.z) < 6 && !this.world.wallBetween(_p, _q)) return this.moveToward(gx, gz, speed, dt);
      this.moving = false;
      return false;
    }
    const wx = this.pathX[this.pathI], wz = this.pathZ[this.pathI];
    const there = this.moveToward(wx, wz, speed, dt);
    if (there) {
      this.pathI++;
      if (this.pathI >= this.pathN) return true;
    }
    return false;
  }
}
