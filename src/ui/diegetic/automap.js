// Auto-map memory for the notebook: which layout cells the player has seen. Samples
// world.isSolidAt in a small radius around the player plus rays across the view cone (stopping at
// walls). Stored in a Map keyed "cx,cz" so it works for an unbounded, streaming world.
// draw() sketches it as wobbly pencil lines centred on the player, with an arrow.
import { CELL } from '../../world/roomBuilder.js';
import { hash, Rng } from '../../core/rng.js';

const FLOOR = 1, WALL = 2;

export class SeenMap {
  constructor() {
    this.cells = new Map();
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

  /** Pencil sketch onto g (w×h), centred on the player, s px per cell. */
  draw(g, w, h, player, { s = 7, cx0 = w / 2, cy0 = h / 2 + 6, top = 22, bottom = h - 14 } = {}) {
    const pcx = player.pos.x / CELL, pcz = player.pos.z / CELL;
    const rx = Math.ceil(w / s / 2) + 1, rz = Math.ceil(h / s / 2) + 1;
    const fx = Math.floor(pcx), fz = Math.floor(pcz);
    const toX = (cx) => cx0 + (cx - pcx) * s;
    const toY = (cz) => cy0 + (cz - pcz) * s;
    g.save();
    g.beginPath(); g.rect(4, top, w - 8, bottom - top); g.clip();
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
}
