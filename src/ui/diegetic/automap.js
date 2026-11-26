// Auto-map memory for the notebook: which layout cells the player has seen. Samples
// world.isSolidAt in a small radius around the player plus rays across the view cone (stopping at
// walls). Stored in a Map keyed "cx,cz" so it works for an unbounded, streaming world.
// draw() sketches it as wobbly pencil lines centred on the player, with an arrow.
//
// Revealed cells (evacuation maps, reveal()): copied from a wall map, not seen. Drawn fainter, with
// dashed walls and blue-grey hatching. Some maps lie; wherever a cell you have actually seen
// disagrees with a revealed one, the sketch grows a "?" there.
import { CELL } from '../../world/roomBuilder.js';
import { hash, Rng } from '../../core/rng.js';

const FLOOR = 1, WALL = 2;

export class SeenMap {
  constructor() {
    this.cells = new Map();
    this.revealed = new Map();   // "cx,cz" → { v, lie, id } from evacuation maps
    this.reveals = new Map();    // reveal id → { cx, cz, r, lie, keys: [] }
    this.timer = 0;
    this.version = 0;
  }

  mark(world, cx, cz) {
    const k = cx + ',' + cz;
    if (this.cells.has(k)) return this.cells.get(k);
    const v = world.isSolidAt((cx + 0.5) * CELL, (cz + 0.5) * CELL) ? WALL : FLOOR;
    this.cells.set(k, v);
    this.version++;
    return v;
  }

  update(dt, game) {
    this.timer -= dt;
    if (this.timer > 0 || !game.world?.isSolidAt) return;
    this.timer = 0.2;
    const world = game.world, p = game.player.pos;
    const pcx = Math.floor(p.x / CELL), pcz = Math.floor(p.z / CELL);
    // radius: always know the cells right around you
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.mark(world, pcx + dx, pcz + dz);
    // view cone: rays out to ~8 cells, stopping at the first wall
    const fov = ((game.cfg.render.fov ?? 70) * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * (game.renderer.aspect ?? 1.5));
    const rays = 31, maxD = CELL * 8, step = CELL * 0.35;
    for (let i = 0; i < rays; i++) {
      const a = game.player.yaw + (i / (rays - 1) - 0.5) * hfov * 1.05;
      const dx = -Math.sin(a), dz = -Math.cos(a);
      for (let d = step; d < maxD; d += step) {
        const x = p.x + dx * d, z = p.z + dz * d;
        if (this.mark(world, Math.floor(x / CELL), Math.floor(z / CELL)) === WALL) break;
      }
    }
  }

  /**
   * Copy cells from a wall map into memory. cells: [[cx, cz, v]] (v 1 floor, 2 wall).
   * opts: { id, cx, cz (the map's own cell), lie (the map is wrong on purpose) }. Idempotent per id.
   */
  reveal(cells, { id = 'reveal', cx = 0, cz = 0, lie = false } = {}) {
    if (this.reveals.has(id)) return this.reveals.get(id);
    const keys = [];
    let r = 0;
    for (const [x, z, v] of cells) {
      const k = x + ',' + z;
      keys.push(k);
      r = Math.max(r, Math.abs(x - cx), Math.abs(z - cz));
      if (!this.revealed.has(k) || !lie) this.revealed.set(k, { v, lie, id });
    }
    const rec = { id, cx, cz, r, lie, keys };
    this.reveals.set(id, rec);
    this.version++;
    return rec;
  }

  /** Cells where what you saw contradicts what a map told you: [[cx, cz]] (coarse, 3×3 clusters). */
  contradictions(keys = this.revealed.keys()) {
    const out = new Map();
    for (const k of keys) {
      const rv = this.revealed.get(k);
      const seen = this.cells.get(k);
      if (!rv || seen == null || seen === rv.v) continue;
      const [x, z] = k.split(',').map(Number);
      const ck = Math.floor(x / 3) + ',' + Math.floor(z / 3);
      if (!out.has(ck)) out.set(ck, [x, z]);
    }
    return [...out.values()];
  }

  /** Sketch one reveal (a notebook "map reveal" page), centred on the map, with an X for "you are here". */
  drawReveal(g, w, h, id, { top = 22, bottom = h - 14 } = {}) {
    const rec = this.reveals.get(id);
    if (!rec) return;
    const s = Math.max(3, Math.min(6, Math.floor((Math.min(w - 12, bottom - top)) / (rec.r * 2 + 1))));
    const cx0 = w / 2, cy0 = (top + bottom) / 2;
    const toX = (cx) => cx0 + (cx - rec.cx - 0.5) * s;
    const toY = (cz) => cy0 + (cz - rec.cz - 0.5) * s;
    g.save();
    g.beginPath(); g.rect(4, top, w - 8, bottom - top); g.clip();
    const own = new Set(rec.keys);
    const at = (x, z) => (own.has(x + ',' + z) ? this.revealed.get(x + ',' + z)?.v : undefined);
    this.#sketch(g, rec.keys, at, toX, toY, s, { revealed: true });
    g.restore();
    // "you are here": a red X where the map hangs
    g.strokeStyle = 'rgba(150,30,25,0.95)'; g.lineWidth = 1.4;
    const x = toX(rec.cx + 0.5), y = toY(rec.cz + 0.5);
    g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke();
    this.#questions(g, this.contradictions(rec.keys), toX, toY);
  }

  // floors (stipple or hatch) + walls (solid or dashed) for a set of cell keys
  #sketch(g, keys, at, toX, toY, s, { revealed = false } = {}) {
    for (const k of keys) {
      const [cx, cz] = k.split(',').map(Number);
      if (at(cx, cz) !== FLOOR) continue;
      const r = new Rng(hash('rv', cx, cz));
      g.fillStyle = 'rgba(60,80,120,0.28)';
      if (r.chance(0.6)) g.fillRect(Math.round(toX(cx) + r.next() * s), Math.round(toY(cz) + r.next() * s), 1, 1);
      if ((cx + cz) % 2 === 0) { g.fillRect(Math.round(toX(cx)), Math.round(toY(cz) + s - 1), Math.max(1, s - 1), 1); }
    }
    g.strokeStyle = revealed ? 'rgba(52,64,96,0.75)' : 'rgba(48,46,58,0.9)';
    g.lineWidth = 1;
    if (revealed) g.setLineDash([2, 1.5]);
    g.beginPath();
    for (const k of keys) {
      const [cx, cz] = k.split(',').map(Number);
      if (at(cx, cz) !== FLOOR) continue;
      if (at(cx, cz - 1) === WALL) { g.moveTo(toX(cx), toY(cz)); g.lineTo(toX(cx + 1), toY(cz)); }
      if (at(cx, cz + 1) === WALL) { g.moveTo(toX(cx), toY(cz + 1)); g.lineTo(toX(cx + 1), toY(cz + 1)); }
      if (at(cx - 1, cz) === WALL) { g.moveTo(toX(cx), toY(cz)); g.lineTo(toX(cx), toY(cz + 1)); }
      if (at(cx + 1, cz) === WALL) { g.moveTo(toX(cx + 1), toY(cz)); g.lineTo(toX(cx + 1), toY(cz + 1)); }
    }
    g.stroke();
    g.setLineDash([]);
  }

  #questions(g, list, toX, toY) {
    if (!list.length) return;
    g.fillStyle = 'rgba(140,28,22,0.9)';
    g.font = 'bold 9px "Segoe Print", "Comic Sans MS", cursive';
    g.textAlign = 'center';
    for (const [x, z] of list) g.fillText('?', toX(x + 0.5), toY(z + 1));
    g.textAlign = 'start';
  }

  /** Pencil sketch onto g (w×h), centred on the player, s px per cell. */
  draw(g, w, h, player, { s = 7, cx0 = w / 2, cy0 = h / 2 + 6, top = 22, bottom = h - 14 } = {}) {
    const pcx = player.pos.x / CELL, pcz = player.pos.z / CELL;
    const rx = Math.ceil(w / s / 2) + 1, rz = Math.ceil(h / s / 2) + 1;
    const fx = Math.floor(pcx), fz = Math.floor(pcz);
    const toX = (cx) => cx0 + (cx - pcx) * s;
    const toY = (cz) => cy0 + (cz - pcz) * s;
    g.save();
    g.beginPath(); g.rect(4, top, w - 8, bottom - top); g.clip();
    // copied from wall maps (only where you haven't seen for yourself)
    if (this.revealed.size) {
      const keys = [];
      for (let cz = fz - rz; cz <= fz + rz; cz++) for (let cx = fx - rx; cx <= fx + rx; cx++) {
        const k = cx + ',' + cz;
        if (this.revealed.has(k) && !this.cells.has(k)) keys.push(k);
      }
      const at = (x, z) => { const k = x + ',' + z; return this.cells.get(k) ?? this.revealed.get(k)?.v; };
      this.#sketch(g, keys, at, toX, toY, s, { revealed: true });
    }
    // floors: light pencil stipple
    for (let cz = fz - rz; cz <= fz + rz; cz++) for (let cx = fx - rx; cx <= fx + rx; cx++) {
      if (this.cells.get(cx + ',' + cz) !== FLOOR) continue;
      const r = new Rng(hash('fl', cx, cz));
      g.fillStyle = 'rgba(70,70,80,0.3)';
      for (let i = 0; i < 7; i++) g.fillRect(Math.round(toX(cx + r.next())), Math.round(toY(cz + r.next())), 1, 1);
    }
    // walls: a wobbly line on every floor edge that borders a seen wall
    g.strokeStyle = 'rgba(48,46,58,0.9)';
    g.lineWidth = 1.2;
    g.lineCap = 'round';
    g.beginPath();
    const edge = (x0, y0, x1, y1, key) => {
      const r = new Rng(hash('ed', key));
      const j = () => (r.next() - 0.5) * 1.6;
      const ax = toX(x0) + j(), ay = toY(y0) + j();
      const bx = toX(x1) + j(), by = toY(y1) + j();
      const mx = (ax + bx) / 2 + j(), my = (ay + by) / 2 + j();
      // overshoot a touch past the corners like a quick sketch
      const ox = (bx - ax) * 0.08, oy = (by - ay) * 0.08;
      g.moveTo(ax - ox, ay - oy); g.quadraticCurveTo(mx, my, bx + ox, by + oy);
    };
    for (let cz = fz - rz; cz <= fz + rz; cz++) for (let cx = fx - rx; cx <= fx + rx; cx++) {
      if (this.cells.get(cx + ',' + cz) !== FLOOR) continue;
      if (this.cells.get(cx + ',' + (cz - 1)) === WALL) edge(cx, cz, cx + 1, cz, `h${cx},${cz}`);
      if (this.cells.get(cx + ',' + (cz + 1)) === WALL) edge(cx, cz + 1, cx + 1, cz + 1, `h${cx},${cz + 1}`);
      if (this.cells.get((cx - 1) + ',' + cz) === WALL) edge(cx, cz, cx, cz + 1, `v${cx},${cz}`);
      if (this.cells.get((cx + 1) + ',' + cz) === WALL) edge(cx + 1, cz, cx + 1, cz + 1, `v${cx + 1},${cz}`);
    }
    g.stroke();
    if (this.revealed.size) {
      const near = [];
      for (let cz = fz - rz; cz <= fz + rz; cz++) for (let cx = fx - rx; cx <= fx + rx; cx++) near.push(cx + ',' + cz);
      this.#questions(g, this.contradictions(near), toX, toY);
    }
    g.restore();
    // you-are-here arrow (north = -z is up on the page)
    const a = player.yaw;
    const dx = -Math.sin(a), dy = -Math.cos(a);
    const px = -dy, py = dx;
    g.fillStyle = 'rgba(150,30,25,0.95)';
    g.beginPath();
    g.moveTo(cx0 + dx * 6, cy0 + dy * 6);
    g.lineTo(cx0 - dx * 3 + px * 3.5, cy0 - dy * 3 + py * 3.5);
    g.lineTo(cx0 - dx * 1.2, cy0 - dy * 1.2);
    g.lineTo(cx0 - dx * 3 - px * 3.5, cy0 - dy * 3 - py * 3.5);
    g.closePath();
    g.fill();
  }

  /** Save-friendly form (M6 can persist it). */
  toJSON() { return [...this.cells]; }
  fromJSON(arr) { this.cells = new Map(arr); this.version++; }
  /** Revealed cells for saves (separate so toJSON's format stays as it was). */
  revealsJSON() { return [...this.reveals.values()].map((r) => ({ ...r, cells: r.keys.map((k) => [...k.split(',').map(Number), this.revealed.get(k)?.v ?? 0]) })); }
}
