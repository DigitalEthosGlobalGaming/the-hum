// The Tenant in the running game: binds threat → stage, the AI, the director and the body to
// `game`, and does the presentation (footsteps, sting, heartbeat, sanity drain, VHS distortion,
// light stutter, captions, the caught sequence, the dev overlay). Bound on the first gameplay frame
// by register.js (extension modules can't see `game` at import), then runs as a world system.
//
// game.tenant = { stage, storyStage, threat, state, tension, distort, calm, ai, director,
//                 setStage(n), spawnGlimpse(), stalk(), forceHunt(), catchMe(), hold, debugLines() }
import * as THREE from 'three';
import { Rng, hash } from '../core/rng.js';
import { TenantAI, ST } from './ai.js';
import { Director } from './director.js';
import { ThreatTracker, STAGE_NAMES } from './threat.js';
import { applyCaught, wakeBlock } from './caught.js';
import { buildTenant, figureRotation } from './entity.js';
import { standable } from './perception.js';
import { BLOCK_M } from '../world/layout/index.js';

const DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const DEG = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const PRESENCE_DEFAULTS = {
  sanityDrain: [0.004, 0.01, 0.014, 0.018], // per s while it is in view (per stage), ×(0.5..1.5) by distance
  heartbeatNear: 18,        // m: heartbeat while it is in view this close
  flickerRadius: 9,         // m around it: tubes stutter
  flickerEvery: [0.5, 1.6], // s between stutters
  distortRange: 10,         // m: post-pass uDistort rises inside this while it is in view
  distortMax: 0.55,
  stepCaption: 16,          // m: footstep captions only this close
  stingVolume: [0.35, 0.5, 0.65, 0.8],
};

let T = null;

/** Bind (idempotent). Called from register.js inside the first Gameplay.update. */
export function bindTenant(gp) {
  if (T?.gp === gp) return T;
  T = new Tenant(gp);
  return T;
}

class Tenant {
  constructor(gp) {
    this.gp = gp;
    const game = (this.game = gp.game);
    const tc = (this.cfg = game.cfg.tenant ?? {});
    this.presence = { ...PRESENCE_DEFAULTS, ...(tc.presence ?? {}) };
    const rs = gp.runState;
    this.run = rs.tenant ??= { unlocked: {}, fuses: 0, caught: 0 };
    this.tracker = new ThreatTracker(tc, this.run.unlocked);
    const seed = hash(game.seed >>> 0, 'tenant');
    this.rng = new Rng(seed);
    const world = game.world;
    this.ai = new TenantAI({ world, cfg: tc, rng: new Rng(hash(seed, 'ai')), fx: this.fxHooks() });
    this.director = new Director(tc.director ?? {}, new Rng(hash(seed, 'director')));
    this.stage = 0; this.storyStage = 0; this.threat = 0;
    this.distort = 0; this.pulse = 0;
    this.view = { eye: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, hHalf: 0.9, vHalf: 0.6 };
    this.pollT = 0;
    this.flickerT = 0;
    this.beatT = 0;
    this.stepCapT = 0;
    this.blink = -1;          // s into a glitch-blink, -1 = none
    this.seq = null;          // the caught sequence
    this.ended = false;
    this.baseIntensity = game.cfg.audio?.intensity ?? 0;

    const body = buildTenant(game.textures);
    this.body = body;
    game.scene.add(body.root);

    game.dangerLevel ??= 0;
    const ev = game.events;
    const repoll = () => { this.pollT = 0; };
    ev.on('note:collected', repoll);
    ev.on('item:pickup', repoll);
    ev.on('readable:open', repoll);
    ev.on('power:fuse', () => { this.run.fuses++; repoll(); });
    ev.on('camera:flash', (p) => { repoll(); if (p?.pos && p?.dir) this.ai.flash(p.pos, p.dir); });
    ev.on('world:noise', (n) => this.ai.hear(n));
    ev.on('settings:change', (p) => { if (p?.key === 'calm') this.poll(); }); // Calm is read live

    game.tenant = this.api();
    world.addSystem({ update: (dt, ctx) => this.update(dt, ctx) });
    this.debug = installDebug(this);
    this.poll(true);
  }

  get calm() { return !!(this.cfg.calm || this.game.settings?.calm); }

  // ------------------------------------------------------------------ threat → stage

  inputs() {
    const game = this.game, rs = this.gp.runState;
    let spine = 0;
    for (const id of this.gp.notesCollected) if (game.content.notes?.[id]?.spine) spine++;
    return {
      spine,
      badges: rs.badges?.size ?? 0,
      fuses: this.run.fuses,
      evacMaps: game.diegetic?.map?.reveals?.size ?? 0,
      photos: rs.photos ?? 0,
    };
  }

  poll(first = false) {
    const prev = this.stage;
    const r = this.tracker.update(this.inputs(), { calm: this.calm });
    this.threat = r.threat;
    this.storyStage = r.storyStage;
    this.stage = r.stage;
    this.game.world.storyStage = r.storyStage; // spawner ctx.stage: minStage pool entries
    for (const u of r.unlocks) this.unlock(u);
    // Calm switched on (or a dev stage drop) mid-encounter: it backs off at once
    if (this.stage < 2 && (this.ai.state === ST.STALK || this.ai.state === ST.HUNT)) this.ai.queue(ST.LOSE, 'calm', true);
    if (r.changed && !first) {
      this.game.events.emit('tenant:stage', { stage: r.stage, storyStage: r.storyStage, threat: r.threat, prev });
      if (r.stage > prev) this.game.audioDirector?.trigger?.('steps');
    }
  }

  unlock(u) {
    const nb = this.game.diegetic?.notebook;
    if (nb?.addPage) {
      nb.addPage({ kind: 'learned', id: u.id, text: u.caption }); // Notes → "what I've learned"
      this.game.synth?.play?.('paper_rustle', { volume: 0.4 });
      this.gp.caption('(you write something about it in the notebook)', 3.5, 'tenant:unlock');
    } else this.gp.caption(u.caption, 5, 'tenant:unlock');
  }

  // ------------------------------------------------------------------ per frame

  update(dt, ctx) {
    const game = this.game;
    if (this.debug) this.debug.update(dt);
    if (game.paused || this.ended) return; // pause freezes everything, the caught sequence included
    if (this.seq) {
      this.updateSequence(dt);
      if (this.seq && this.seq.t < 2.7) game.player.pos.set(this.seq.pos.x, this.seq.pos.y, this.seq.pos.z); // held in place (then at the wake spot)
      this.applyDistort(dt);
      return;
    }
    if (!game.playing) { this.applyDistort(dt); return; }
    this.pollT -= dt;
    if (this.pollT <= 0) { this.pollT = 1; this.poll(); }

    const cam = ctx.camera ?? game.camera, pl = game.player, v = this.view;
    v.eye.x = cam.position.x; v.eye.y = cam.position.y - pl.pos.y; v.eye.z = cam.position.z;
    v.yaw = pl.yaw; v.pitch = pl.pitch;
    v.vHalf = (cam.fov * DEG) / 2;
    v.hHalf = Math.atan(Math.tan(v.vHalf) * cam.aspect) + 4 * DEG; // a little margin past the screen edge
    const ai = this.ai;
    ai.update(dt, { view: v, px: pl.pos.x, pz: pl.pos.z, stage: this.stage, canCatch: this.stage >= 2 && !this.calm && !this.seq, playing: true });
    if (ai.alerted) { ai.alerted = false; this.director.alert(); }
    const cmd = this.seq ? null : this.director.update(dt, ai, this.stage);
    if (cmd === 'glimpse' || (cmd === 'stalk' && this.stage < 2)) ai.spawnGlimpse(v, this.stage);
    else if (cmd === 'stalk') { if (!ai.spawnStalk(v, pl.pos.x, pl.pos.z)) ai.spawnGlimpse(v, this.stage); }
    else if (cmd === 'hunt') ai.forceHunt(v, pl.pos.x, pl.pos.z);

    this.syncBody(dt);
    this.presenceFx(dt);
    game.dangerLevel = this.director.tension;
    const ad = game.audioDirector;
    if (ad) {
      const want = Math.max(this.baseIntensity, this.director.tension);
      if (Math.abs(ad.intensity - want) > 0.02) ad.intensity = want;
    }
    this.applyDistort(dt);
  }

  syncBody(dt) {
    const ai = this.ai, root = this.body.root;
    root.position.set(ai.x, 0, ai.z);
    root.rotation.y = figureRotation(ai.yaw);
    if (this.blink >= 0) {
      // glitch-blink out: on/off a few times over ~0.35 s, then gone (it never moves)
      this.blink += dt;
      const k = Math.floor(this.blink / 0.045);
      root.visible = this.blink < 0.35 && (k === 1 || k === 3 || k === 6);
      if (this.blink >= 0.35) this.blink = -1;
    } else root.visible = ai.present;
  }

  presenceFx(dt) {
    const game = this.game, ai = this.ai, bb = ai.bb, P = this.presence, st = game.stats;
    if (!ai.present) { this.beatT = 0; return; }
    const s = this.stage;
    if (bb.seen) {
      const near = clamp01(1 - bb.dist / 30);
      st.sanity = Math.max(0, st.sanity - P.sanityDrain[Math.min(3, s)] * (0.5 + near) * dt);
      // heartbeat while it's in view (vitals has its own below half sanity)
      this.beatT -= dt;
      if (bb.dist < P.heartbeatNear && st.sanity >= 0.5 && this.beatT <= 0) {
        this.beatT = 0.42 + 0.3 * clamp01(bb.dist / P.heartbeatNear);
        game.synth?.play?.('heartbeat', { volume: 0.3 + 0.4 * near });
      }
    }
    // tubes near it stutter (stage 1+, always while hunting)
    this.flickerT -= dt;
    if ((s >= 1 || ai.state === ST.HUNT) && this.flickerT <= 0) {
      const [a, b] = P.flickerEvery;
      this.flickerT = (a + (b - a) * this.rng.next()) * (ai.state === ST.HUNT ? 0.5 : 1);
      this.stutterNear(ai.x, ai.z, P.flickerRadius, ai.state === ST.HUNT ? 0.9 : 0.5);
    }
    this.stepCapT -= dt;
  }

  /** Make working tubes within `radius` of (x, z) stutter for `len` s (power network stutter). */
  stutterNear(x, z, radius, len) {
    const world = this.game.world, power = world.power;
    if (!power) return;
    const clock = power.clock;
    for (const placed of world.rooms.values()) {
      if (!placed.power) continue;
      const lights = placed.built.lights;
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        if (L.cond === 'dead') continue;
        const d = Math.hypot(L.pos.x - x, L.pos.z - z);
        if (d > radius || this.rng.next() > 1 - d / radius * 0.5) continue;
        L.stutterFrom = clock + this.rng.next() * 0.15;
        L.stutterUntil = L.stutterFrom + len * (0.6 + 0.8 * this.rng.next());
      }
    }
  }

  applyDistort(dt) {
    const ai = this.ai, P = this.presence;
    let target = 0;
    if (ai.present && ai.bb.seen) target = P.distortMax * clamp01(1 - ai.bb.dist / P.distortRange);
    if (ai.state === ST.HUNT && ai.present) target = Math.max(target, 0.12);
    target *= this.game.cfg.ui?.vhsStrength ?? 1;
    this.pulse = Math.max(0, this.pulse - dt * 2.5);
    const want = Math.max(target, this.pulse, this.seq?.distort ?? 0);
    this.distort += (want - this.distort) * (1 - Math.exp(-(want > this.distort ? 10 : 2.5) * dt));
  }

  caption(text, seconds = 3, key = 'tenant') { this.gp.caption(text, seconds, key); }

  // ------------------------------------------------------------------ AI → presentation

  fxHooks() {
    return {
      appear: () => {
        this.blink = -1;
        const h = this.body.head;
        h.rotation.z = (this.rng.next() - 0.5) * 0.5;
        h.rotation.x = 0.15 + this.rng.next() * 0.3;
      },
      vanish: (ai, kind, seen) => {
        if (seen) { this.blink = 0; this.pulse = Math.max(this.pulse, 0.3); }
      },
      firstSight: () => {
        const vol = this.presence.stingVolume[Math.min(3, this.stage)];
        this.game.synth?.play?.('sting_low', { volume: vol });
        this.caption('[a low drone swells]', 2.5);
      },
      step: (ai) => {
        if (ai.bb.seen) return; // never heard while you are looking at it
        const synth = this.game.synth;
        synth?.play?.('tenant_step', { position: { x: ai.x, y: 0.1, z: ai.z }, volume: ai.state === ST.HUNT ? 1 : 0.75 });
        if (this.stepCapT <= 0 && ai.bb.dist < this.presence.stepCaption && !ai.bb.inCone) {
          this.stepCapT = 6;
          this.caption(ai.bb.dist < 6 ? '[something heavy steps behind you]' : '[heavy footsteps, somewhere close]', 2.5);
        }
      },
      huntStart: (ai) => {
        this.pulse = Math.max(this.pulse, 0.25);
        this.stutterNear(ai.x, ai.z, this.presence.flickerRadius * 1.5, 1.2);
        this.caption('[the footsteps quicken]', 2.5);
      },
      lure: (ai, n) => {
        // you hear it go toward the sound: a few steps along the way (sound only)
        const synth = this.game.synth;
        if (!synth?.play) return;
        for (let i = 1; i <= 3; i++) {
          const k = i / 4;
          synth.play('tenant_step', { position: { x: ai.x + (n.x - ai.x) * k, y: 0.1, z: ai.z + (n.z - ai.z) * k }, volume: 0.6, delay: i * 0.45 });
        }
        this.caption('[something turns toward the noise]', 2.5);
      },
      flashed: (ai, froze) => {
        this.pulse = Math.max(this.pulse, 0.45);
        if (froze) this.caption('[it holds still in the white]', 2.5);
      },
      caught: () => this.startCaught(),
    };
  }

  // ------------------------------------------------------------------ caught

  startCaught() {
    const game = this.game, pl = game.player;
    this.seq = { t: 0, applied: false, distort: 1, pos: { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z }, yaw: pl.yaw }; // (the player is held at pos until the teleport)
    game.synth?.play?.('sting_low', { volume: 1 });
    game.synth?.play?.('vhs_tear', { volume: 0.9 });
    game.events.emit('tenant:caught', { pos: this.seq.pos, stage: this.stage });
    this.run.caught++;
  }

  fade(alpha) {
    if (typeof document === 'undefined') return;
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      Object.assign(this.fadeEl.style, { position: 'fixed', inset: 0, background: '#000', opacity: 0, pointerEvents: 'none', zIndex: 4 });
      document.body.appendChild(this.fadeEl);
    }
    this.fadeEl.style.opacity = String(alpha);
  }

  updateSequence(dt) {
    const q = this.seq, reduce = !!this.game.cfg.ui?.reduceFlashing;
    q.t += dt;
    const t = q.t;
    if (t < 1.5) {
      // the tape tears: wobble spikes, then the picture drops out
      q.distort = reduce ? 0.7 : 0.65 + 0.35 * (Math.floor(t * 14) % 3 === 0 ? 1 : this.rng.next());
      this.fade(clamp01((t - 1.0) / 0.5));
    } else if (!q.applied) {
      q.applied = true;
      this.fade(1);
      const res = this.consequences(q);
      q.result = res;
      if (res.ended) { this.endRun(); return; }
    } else if (t < 2.7) {
      q.distort = 0.5;
    } else if (t < 4) {
      const k = (t - 2.7) / 1.3;
      this.fade(1 - k);
      q.distort = 0.5 * (1 - k) + 0.15;
    } else {
      this.fade(0);
      this.seq = null;
      this.pulse = 0.3;
      this.caption('[you wake somewhere else. Your pockets feel lighter.]', 4, 'tenant:wake');
      this.director.quiet();
    }
  }

  consequences(q) {
    const game = this.game, gp = this.gp, world = game.world;
    const res = applyCaught({
      inventory: game.inventory, stats: game.stats, map: game.diegetic?.map, rng: this.rng, pos: q.pos,
      dropAt: (stack) => {
        const p = gp.dropPoint();
        gp.spawn(stack.id, p, q.yaw, { persist: true, state: stack.state });
        game.events.emit('item:drop', { id: stack.id, stack });
      },
    }, this.cfg.caught ?? {});
    if (res.ended) return res;
    const spot = this.wakeSpot(q.pos);
    game.player.pos.set(spot.x, 0, spot.z);
    q.pos = { x: spot.x, y: 0, z: spot.z };
    game.player.yaw = this.rng.next() * Math.PI * 2;
    world.stream(game.player.pos, { sync: true });
    game.events.emit('tenant:wake', { pos: { x: spot.x, z: spot.z }, ...res });
    return res;
  }

  /** A lit, walkable spot 6–15 blocks away (streamed in first). */
  wakeSpot(from) {
    const world = this.game.world;
    const bx0 = Math.floor(from.x / BLOCK_M), bz0 = Math.floor(from.z / BLOCK_M);
    const blocks = this.cfg.caught?.wakeBlocks ?? [6, 15];
    let fallback = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const wb = wakeBlock(bx0, bz0, this.rng, blocks);
      const centre = new THREE.Vector3(wb.bx * BLOCK_M + BLOCK_M / 2, 0, wb.bz * BLOCK_M + BLOCK_M / 2);
      world.stream(centre, { sync: true });
      const lit = this.litSpotNear(centre, BLOCK_M * 1.5);
      if (lit) return lit;
      fallback ??= world.findSpawn(wb.bx, wb.bz);
    }
    return fallback;
  }

  litSpotNear(c, radius) {
    const world = this.game.world;
    const p = { x: 0, y: 1.5, z: 0 };
    let best = null, bestL = 0.3;
    for (const placed of world.rooms.values()) {
      for (const L of placed.built.lights) {
        if ((L.out ?? 0) < 0.5 || Math.hypot(L.pos.x - c.x, L.pos.z - c.z) > radius) continue;
        if (!standable(world, L.pos.x, L.pos.z, 0.6)) continue;
        p.x = L.pos.x; p.z = L.pos.z;
        const l = world.lightAt(p);
        if (l > bestL) { bestL = l; best = { x: L.pos.x, z: L.pos.z }; }
      }
    }
    return best;
  }

  endRun() {
    const game = this.game;
    this.ended = true;
    this.seq = null;
    game.playing = false;
    game.events.emit('run:end', { reason: 'caught' });
    if (typeof document === 'undefined') return;
    document.exitPointerLock?.();
    // placeholder until the CRT title (M6): the tape ejects, click for a new tape
    const card = document.createElement('div');
    card.innerHTML = '<div style="font:bold 30px monospace;letter-spacing:10px">THE TAPE EJECTS</div>'
      + '<div style="font:14px monospace;margin-top:18px;opacity:.75">it caught you with nothing left</div>'
      + '<div style="font:13px monospace;margin-top:30px;opacity:.6">click to put in a new tape</div>';
    Object.assign(card.style, {
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', color: '#d8cf8a', background: '#000', cursor: 'pointer', zIndex: 7,
    });
    card.addEventListener('mousedown', () => {
      const u = new URL(location.href);
      u.searchParams.set('seed', ((Math.random() * 2 ** 32) >>> 0).toString(36));
      location.href = u.toString();
    });
    document.body.appendChild(card);
    this.fade(0);
  }

  // ------------------------------------------------------------------ dev + debug

  api() {
    const self = this;
    return {
      get stage() { return self.stage; },
      get storyStage() { return self.storyStage; },
      get threat() { return self.threat; },
      get state() { return self.ai.state; },
      get tension() { return self.director.tension; },
      get distort() { return self.distort; },
      get calm() { return self.calm; },
      get hold() { return self.ai.hold; },
      set hold(v) { self.ai.hold = !!v; },
      ai: self.ai,
      director: self.director,
      debugLines: () => self.debugLines(),
      /** Dev: force the story stage (null = back to the real threat). */
      setStage(n) { self.tracker.override = n == null ? null : Math.max(0, Math.min(3, n | 0)); self.poll(); return self.stage; },
      spawnGlimpse() { self.ai.change(ST.DORMANT, 'dev'); return self.ai.spawnGlimpse(self.view, self.stage); },
      stalk() { self.ai.change(ST.DORMANT, 'dev'); const p = self.game.player.pos; return self.ai.spawnStalk(self.view, p.x, p.z); },
      forceHunt() {
        if (self.calm) return false;
        if (self.stage < 2) { self.tracker.override = 2; self.poll(); }
        const p = self.game.player.pos;
        return self.ai.forceHunt(self.view, p.x, p.z);
      },
      catchMe() { if (self.seq) return; self.ai.present = false; self.ai.change(ST.DORMANT, 'caught'); self.startCaught(); },
    };
  }

  debugLines() {
    const ai = this.ai, bb = ai.bb, d = this.director;
    const f = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : '-');
    return [
      `TENANT  stage ${this.stage} ${STAGE_NAMES[this.stage]}${this.calm ? ' (CALM cap)' : ''} · story ${this.storyStage} · threat ${f(this.threat)}`,
      `state   ${ai.state} ${f(ai.stateTime, 1)} s${ai.frozen ? ' · FROZEN' : ''}${ai.hold ? ' · HOLD' : ''} · goal ${ai.goalKind}`,
      `body    ${ai.present ? `at ${f(ai.x, 1)}, ${f(ai.z, 1)} · ${f(bb.dist, 1)} m` : 'absent'} · ${bb.seen ? 'SEEN' : bb.inCone ? 'in cone, blocked' : 'unseen'}${ai.moving ? ' · moving' : ''}`,
      `meters  stare ${f(ai.stare, 1)} · lost ${f(ai.lostFor, 1)} · look ${f(ai.lookT, 1)} · light ${f(ai.lightSafe, 1)} · left ${f(ai.left, 0)} s`,
      `player  lit ${bb.playerLit ? 'yes' : 'no'} · calm ${bb.playerCalm ? 'yes' : 'no'} · LOS ${bb.losToPlayer ? 'yes' : 'no'} · path ${ai.pathI}/${ai.pathN}`,
      `director ${d.phase} · next ${f(Math.max(0, d.wait), 0)} s · quiet ${f(d.minQuiet, 0)} s · tension ${f(d.tension)} → danger ${f(this.game.dangerLevel)}`,
      `fx      distort ${f(this.distort)} · sanity ${f(this.game.stats.sanity)} · caught ${this.run.caught}×`,
      ...ai.log.slice(-4).map((e) => `  ${f(e.t, 1)}s ${e.from ?? '-'} → ${e.to} (${e.reason})`),
    ];
  }
}

/** Dev-only F8 (keys.tenantDebug) overlay (a plain <pre>; nothing in release builds or Node). */
function installDebug(tenant) {
  if (!DEV || typeof document === 'undefined') return null;
  const codes = tenant.game.cfg.keys?.tenantDebug ?? ['F8'];
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', right: '8px', top: '44px', margin: 0, padding: '6px 8px', zIndex: 40,
    font: '11px/1.35 monospace', color: '#f0d0c0', background: 'rgba(0,0,0,0.72)',
    pointerEvents: 'none', display: 'none', whiteSpace: 'pre',
  });
  document.body.appendChild(el);
  let on = false, acc = 0;
  addEventListener('keydown', (e) => {
    if (!codes.includes(e.code) || e.repeat) return;
    e.preventDefault();
    on = !on;
    el.style.display = on ? 'block' : 'none';
    acc = 1;
  });
  return {
    el,
    get on() { return on; },
    show(v = true) { on = v; el.style.display = on ? 'block' : 'none'; acc = 1; },
    update(dt) {
      if (!on) return;
      acc += dt;
      if (acc < 0.2) return;
      acc = 0;
      el.textContent = tenant.debugLines().join('\n');
    },
  };
}
