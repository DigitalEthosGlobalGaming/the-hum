// Footsteps by floor surface + wet footprints after puddles. A world system (world.addSystem):
//   update()          tracks the walking direction and whether the feet are in a puddle
//   onRoomPlaced()    collects the room's puddle props (content/surfaces.json "puddles")
//   onRoomDropped()   forgets them and clears the room's footprints
//   step(k)           called by main's player.onStep: plays the step, maybe drops a print,
//                     returns { surface, loudness, wet } for world.noise / player:step
// Data + format: content/surfaces.json, content/README.md. Pure helpers: ./surfaces.js, ./footprints.js.
import { surfaceConfig, surfaceAt, puddlesOf, inPuddle, stepLevels } from './surfaces.js';
import { FootprintRing, trailStrength, placePrint } from './footprints.js';

export class FootstepSystem {
  /**
   * @param game  { world, synth?, player, content, time? }
   * @param opts  { mesh?: (ring, wetCfg) → { mesh, sync(), dispose() } | null, rand?: () => 0..1, now?: () => s }
   */
  constructor(game, { mesh = null, rand = Math.random, now = null } = {}) {
    this.game = game;
    this.world = game.world;
    this.cfg = surfaceConfig(game.content?.surfaces ?? {});
    this.rand = rand;
    this.now = now ?? (() => game.time ?? 0);
    const wet = this.cfg.wet;
    this.ring = new FootprintRing(wet.maxPrints);
    this.view = mesh ? mesh(this.ring, wet) : null;
    if (this.view?.mesh) this.world.scene?.add(this.view.mesh);
    this.puddles = new Map();   // roomKey → [puddle shape]
    this.wetSteps = 0;          // prints left to drop
    this.trailIndex = 0;        // prints dropped since the last puddle
    this.inPuddle = false;
    this.splashPending = false; // entered a puddle between steps: the next step splashes
    this.side = 1;              // next foot: +1 right, -1 left
    this.dir = { x: 0, z: -1 }; // last walking direction (unit)
    this._last = null;
    this.lastSurface = this.cfg.default;
  }

  // ---------------------------------------------------------------- world system hooks
  onRoomPlaced(placed) {
    const list = puddlesOf(placed.objects, this.cfg.puddles);
    if (list.length) this.puddles.set(placed.key, list); else this.puddles.delete(placed.key);
  }

  onRoomDropped(placed) {
    this.puddles.delete(placed.key);
    this.ring.dropRoom(placed.key);
  }

  update() {
    const p = this.game.player?.pos;
    if (p) {
      if (this._last) {
        const dx = p.x - this._last.x, dz = p.z - this._last.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.02) { this.dir.x = dx / d; this.dir.z = dz / d; this._last.x = p.x; this._last.z = p.z; }
      } else this._last = { x: p.x, z: p.z };
      const was = this.inPuddle;
      this.inPuddle = this.puddleAt(p.x, p.z);
      if (this.inPuddle) {
        this.wetSteps = this.cfg.wet.steps;
        this.trailIndex = 0;
        if (!was) this.splashPending = true;
      }
    }
    this.ring.update(this.now(), this.cfg.wet.hold);
    this.view?.sync();
  }

  // ---------------------------------------------------------------- queries
  surfaceAt(x, z) { return surfaceAt(this.world, x, z, this.cfg); }

  puddleAt(x, z) {
    for (const list of this.puddles.values()) for (const pd of list) if (inPuddle(pd, x, z)) return true;
    return false;
  }

  /** 0..1: how wet the shoes still are. */
  get wetness() { return this.cfg.wet.steps ? this.wetSteps / this.cfg.wet.steps : 0; }

  // ---------------------------------------------------------------- the step
  /** A footstep with intensity k (speed / walk speed). Returns { surface, loudness, wet }. */
  step(k) {
    const p = this.game.player.pos;
    const cfg = this.cfg, wet = cfg.wet;
    // heading: the displacement since the last step (robust to frame jitter and push-outs);
    // a shuffle in place keeps the per-frame direction from update()
    if (this._lastStep) {
      const dx = p.x - this._lastStep.x, dz = p.z - this._lastStep.z, d = Math.hypot(dx, dz);
      if (d > 0.15 && d < 3) { this.dir.x = dx / d; this.dir.z = dz / d; }
      this._lastStep.x = p.x; this._lastStep.z = p.z;
    } else this._lastStep = { x: p.x, z: p.z };
    const puddle = this.inPuddle || this.puddleAt(p.x, p.z);
    const splash = puddle || this.splashPending;
    this.splashPending = false;
    if (puddle) { this.wetSteps = wet.steps; this.trailIndex = 0; }
    const surface = splash && cfg.surfaces[wet.puddleSurface] ? wet.puddleSurface : this.surfaceAt(p.x, p.z);
    const sdef = cfg.surfaces[surface] ?? cfg.surfaces[cfg.default] ?? {};
    const lv = stepLevels(k, sdef, cfg.gait, this.rand());
    this.play(sdef.preset, lv.volume);

    // wet shoes leave a print; walking over a fresh trail squelches too
    const side = this.side;
    this.side = -this.side;
    let squelch = 0;
    if (!puddle && this.wetSteps > 0) {
      const strength = trailStrength(this.trailIndex, wet.steps, wet.minStrength);
      const at = placePrint(p.x, p.z, this.dir.x, this.dir.z, side, wet.side);
      const t = this.now();
      this.ring.add({
        ...at, side, strength, born: t,
        life: wet.life * (1 + (this.rand() * 2 - 1) * (wet.lifeJitter ?? 0)),
        roomKey: this.world.roomAt?.(at.x, at.z)?.key ?? null,
      });
      squelch = Math.max(0.35, strength);
      this.trailIndex++;
      this.wetSteps--;
    } else if (!puddle) {
      const near = this.ring.wetnessNear(p.x, p.z, wet.trailRadius);
      if (near >= wet.trailMin) squelch = near * 0.6;
    }
    if (squelch > 0 && !splash) this.play(wet.squelchPreset, lv.volume * wet.squelchVolume * squelch);
    this.lastSurface = surface;
    return { surface, loudness: lv.loudness, wet: puddle || squelch > 0 };
  }

  play(id, volume) {
    const synth = this.game.synth;
    if (!synth || !id) return;
    if (synth.presets && !synth.presets[id]) { synth.footstep?.(1); return; } // missing preset: built-in thump
    synth.play(id, { volume });
  }

  debugLines() {
    const p = this.game.player?.pos;
    return [
      `surface    ${p ? this.surfaceAt(p.x, p.z) : '-'}${this.inPuddle ? ' (puddle)' : ''} · wet ${this.wetSteps} · prints ${this.ring.count}/${this.ring.capacity}`,
    ];
  }

  dispose() {
    if (this.view?.mesh) this.world.scene?.remove(this.view.mesh);
    this.view?.dispose?.();
  }
}
