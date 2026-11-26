// Occlusion: how much wall sits between a sound and the listener, and what that does to it.
// Pure parts (wallCells, occlusionAmount, occlusionParams) plus the Occluder, which walks the
// synth's spatial voices round-robin a few per frame and smooths their lowpass + gain.
import { CELL_M } from './acoustics.js';

/**
 * Solid cells crossed by the straight segment a → b (metres, XZ), not counting the cells the two
 * ends sit in. Exact grid traversal (Amanatides & Woo), so a wall is counted once however the line
 * meets it. Stops counting at `cap`.
 */
export function wallCells(isSolid, ax, az, bx, bz, cell = CELL_M, cap = 16) {
  let cx = Math.floor(ax / cell), cz = Math.floor(az / cell);
  const ex = Math.floor(bx / cell), ez = Math.floor(bz / cell);
  if (cx === ex && cz === ez) return 0;
  const dx = bx - ax, dz = bz - az;
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDx = dx !== 0 ? Math.abs(cell / dx) : Infinity;
  const tDz = dz !== 0 ? Math.abs(cell / dz) : Infinity;
  let tX = dx !== 0 ? ((dx > 0 ? (cx + 1) * cell - ax : ax - cx * cell) / Math.abs(dx)) : Infinity;
  let tZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * cell - az : az - cz * cell) / Math.abs(dz)) : Infinity;
  let n = 0;
  for (let guard = 0; guard < 512; guard++) {
    if (tX < tZ) { cx += stepX; tX += tDx; } else { cz += stepZ; tZ += tDz; }
    if (cx === ex && cz === ez) break;
    if (isSolid(cx, cz) && ++n >= cap) break;
  }
  return n;
}

/**
 * Effective "walls" (fractional) for a source: the straight-line wall count, softened when the
 * flood fill shows an open path around the wall (sound bends round a doorway). `pathM` is the
 * walking distance from the listener to the source cell (Infinity if unknown), `lineM` the
 * straight distance. Every `detourPerWall` metres of detour counts as one wall.
 */
export function occlusionAmount(walls, pathM, lineM, detourPerWall = 6) {
  if (walls <= 0) return 0;
  if (!Number.isFinite(pathM)) return walls;
  const viaPath = Math.max(0, pathM - lineM) / detourPerWall;
  return Math.min(walls, viaPath);
}

/**
 * Filter settings for an amount of occlusion. cfg: { perWallDb (negative), maxDb (negative floor),
 * minCutoff Hz }. 0 → open (22 kHz, ×1); 1 wall ≈ 1.5 kHz; 3 walls ≈ 550 Hz.
 * `out` is reused when given.
 */
export function occlusionParams(amount, cfg = {}, out = { cutoff: 22000, gain: 1 }) {
  const perWallDb = cfg.perWallDb ?? -6;
  const maxDb = cfg.maxDb ?? -20;
  const minCutoff = cfg.minCutoff ?? 280;
  if (amount <= 0.02) { out.cutoff = 22000; out.gain = 1; return out; }
  out.cutoff = Math.max(minCutoff, 20000 / (1 + amount * 12));
  out.gain = 10 ** (Math.max(maxDb, perWallDb * amount) / 20);
  return out;
}

/**
 * Drives voice.setOcclusion() for the synth's spatial voices: `perFrame` voices a frame,
 * round-robin, smoothed with time constant `tau`. `applyNow(voice)` sets a voice that just started
 * at once, so a muffled far sound never starts with a bright transient.
 */
export class Occluder {
  constructor(synth, isSolid, cfg = {}, field = null) {
    this.synth = synth;
    this.isSolid = isSolid;    // (cx, cz) → bool, global cells
    this.field = field;        // AcousticsEstimator (pathDistance) or null
    this.cfg = cfg;
    this.cursor = 0;
    this.tmp = { cutoff: 22000, gain: 1 };
  }

  measure(v) {
    const L = this.synth.listenerPos;
    if (!L || !v.pos) return 0;
    const walls = wallCells(this.isSolid, L.x, L.z, v.pos.x, v.pos.z, CELL_M, this.cfg.maxWalls ?? 6);
    v._occWalls = walls; // for the debug view
    if (!walls) return 0;
    const line = Math.hypot(v.pos.x - L.x, v.pos.z - L.z);
    const path = this.field ? this.field.pathDistance(Math.floor(v.pos.x / CELL_M), Math.floor(v.pos.z / CELL_M)) : Infinity;
    return occlusionAmount(walls, path, line, this.cfg.detourPerWall ?? 6);
  }

  apply(v, tau) {
    if (!v.occFilter || v.stopped || v.disposed) return;
    const amount = this.measure(v);
    v._occAmount = amount;
    const p = occlusionParams(amount, this.cfg, this.tmp);
    const prev = v.occ;
    if (prev && Math.abs(prev.cutoff - p.cutoff) < prev.cutoff * 0.03 && Math.abs(prev.gain - p.gain) < 0.01) return;
    v.setOcclusion(p.cutoff, p.gain, tau);
  }

  applyNow(v) { this.apply(v, 0); }

  /** A few voices per call (call once a frame). */
  update() {
    const voices = this.synth.voices;
    const n = voices.length;
    if (!n) return;
    const per = Math.min(n, this.cfg.perFrame ?? 4);
    const tau = this.cfg.smooth ?? 0.12;
    let done = 0;
    for (let tries = 0; tries < n && done < per; tries++) {
      if (this.cursor >= n) this.cursor = 0;
      const v = voices[this.cursor++];
      if (!v.occFilter || v.stopped) continue;
      this.apply(v, tau);
      done++;
    }
  }
}
