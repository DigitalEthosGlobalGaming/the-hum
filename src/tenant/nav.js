// Grid navigation for the Tenant over the world's 2 m cells (world.isSolidAt at cell centres).
// Unbuilt space is solid, so searches stay inside built rooms. A* (8-way, no corner cutting,
// octile heuristic) and a bounded Dijkstra flood for "which cells are N metres of walking away".
// Everything is preallocated typed arrays inside a square window centred on the search, reset by
// a generation stamp: no allocations per search.
export const NAV_CELL = 2;
const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class GridNav {
  /**
   * @param solid (x, z) => bool   world.isSolidAt
   * @param o { size: window cells per side, maxExpand: node budget per search, maxPath }
   */
  constructor(solid, { size = 64, maxExpand = 3000, maxPath = 256 } = {}) {
    this.solid = solid;
    this.size = size;
    this.maxExpand = maxExpand;
    const n = size * size;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);    // == gen: g/came valid
    this.closed = new Uint32Array(n);   // == gen: closed
    this.walkStamp = new Uint32Array(n);
    this.walkVal = new Uint8Array(n);
    this.heap = new Int32Array(n);
    this.heapF = new Float32Array(n);
    this.heapN = 0;
    this.gen = 0;
    this.ox = 0; this.oz = 0;
    // results
    this.pathX = new Float32Array(maxPath);
    this.pathZ = new Float32Array(maxPath);
    this.pathLen = 0;
    this.reach = new Int32Array(n);     // flood result: window indices
    this.reachN = 0;
    this.expanded = 0;
  }

  static cellOf(v) { return Math.floor(v / NAV_CELL); }

  _begin(cx, cz) {
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) { this.stamp.fill(0); this.closed.fill(0); this.walkStamp.fill(0); this.gen = 1; }
    const h = this.size >> 1;
    this.ox = cx - h; this.oz = cz - h;
    this.heapN = 0;
    this.expanded = 0;
  }

  _idx(cx, cz) {
    const x = cx - this.ox, z = cz - this.oz;
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return -1;
    return z * this.size + x;
  }

  /** Walkable cell (window index i, world cell cx, cz), cached for this search. */
  _walk(i, cx, cz) {
    if (this.walkStamp[i] !== this.gen) {
      this.walkStamp[i] = this.gen;
      this.walkVal[i] = this.solid(cx * NAV_CELL + 1, cz * NAV_CELL + 1) ? 0 : 1;
    }
    return this.walkVal[i] === 1;
  }

  walkable(x, z) { return !this.solid(Math.floor(x / NAV_CELL) * NAV_CELL + 1, Math.floor(z / NAV_CELL) * NAV_CELL + 1); }

  _push(i, f) {
    let k = this.heapN++;
    const H = this.heap, F = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= f) break;
      H[k] = H[p]; F[k] = F[p]; k = p;
    }
    H[k] = i; F[k] = f;
  }

  _pop() {
    const H = this.heap, F = this.heapF;
    const top = H[0];
    const n = --this.heapN;
    if (n > 0) {
      const i = H[n], f = F[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= f) break;
        H[k] = H[c]; F[k] = F[c]; k = c;
      }
      H[k] = i; F[k] = f;
    }
    return top;
  }

  /**
   * A* from world point a to world point b. On success fills pathX/pathZ with cell-centre
   * waypoints (excluding the start cell; the last one is b itself) and returns the count;
   * returns -1 when there is no path inside the window / budget.
   */
  findPath(ax, az, bx, bz) {
    const acx = Math.floor(ax / NAV_CELL), acz = Math.floor(az / NAV_CELL);
    const bcx = Math.floor(bx / NAV_CELL), bcz = Math.floor(bz / NAV_CELL);
    this._begin((acx + bcx) >> 1, (acz + bcz) >> 1);
    const start = this._idx(acx, acz), goal = this._idx(bcx, bcz);
    this.pathLen = 0;
    if (start < 0 || goal < 0) return -1;
    if (!this._walk(goal, bcx, bcz)) return -1;
    if (start === goal) { this.pathX[0] = bx; this.pathZ[0] = bz; this.pathLen = 1; return 1; }
    const S = this.size;
    this.g[start] = 0; this.came[start] = -1; this.stamp[start] = this.gen;
    this._push(start, octile(acx, acz, bcx, bcz));
    while (this.heapN > 0) {
      const cur = this._pop();
      if (this.closed[cur] === this.gen) continue;
      this.closed[cur] = this.gen;
      if (cur === goal) return this._build(start, goal, bx, bz);
      if (++this.expanded > this.maxExpand) return -1;
      const cx = (cur % S) + this.ox, cz = ((cur / S) | 0) + this.oz;
      const gc = this.g[cur];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], nz = cz + DZ[k];
        const ni = this._idx(nx, nz);
        if (ni < 0 || this.closed[ni] === this.gen || !this._walk(ni, nx, nz)) continue;
        let cost = 1;
        if (k >= 4) {
          // diagonal only when both orthogonal neighbours are open (no corner cutting)
          const ai = this._idx(cx + DX[k], cz), bi = this._idx(cx, cz + DZ[k]);
          if (ai < 0 || bi < 0 || !this._walk(ai, cx + DX[k], cz) || !this._walk(bi, cx, cz + DZ[k])) continue;
          cost = SQRT2;
        }
        const ng = gc + cost;
        if (this.stamp[ni] === this.gen && this.g[ni] <= ng) continue;
        this.stamp[ni] = this.gen; this.g[ni] = ng; this.came[ni] = cur;
        this._push(ni, ng + octile(nx, nz, bcx, bcz));
      }
    }
    return -1;
  }

  _build(start, goal, bx, bz) {
    const S = this.size;
    let n = 0;
    for (let i = goal; i !== start && i >= 0; i = this.came[i]) n++;
    const len = Math.min(n, this.pathX.length);
    let k = n - 1;
    for (let i = goal; i !== start && i >= 0; i = this.came[i], k--) {
      if (k >= len) continue; // overlong path: keep the first maxPath steps
      this.pathX[k] = ((i % S) + this.ox) * NAV_CELL + NAV_CELL / 2;
      this.pathZ[k] = (((i / S) | 0) + this.oz) * NAV_CELL + NAV_CELL / 2;
    }
    if (len === n) { this.pathX[len - 1] = bx; this.pathZ[len - 1] = bz; }
    this.pathLen = len;
    return len;
  }

  /**
   * Dijkstra flood of walkable cells from world point a out to maxDist metres of walking.
   * Results: reach[0..reachN) window indices, walking distance (m) in g[i]; use cellX/cellZ.
   */
  flood(ax, az, maxDist) {
    const acx = Math.floor(ax / NAV_CELL), acz = Math.floor(az / NAV_CELL);
    this._begin(acx, acz);
    this.reachN = 0;
    const start = this._idx(acx, acz);
    if (start < 0 || !this._walk(start, acx, acz)) return 0;
    const S = this.size, lim = maxDist / NAV_CELL;
    this.g[start] = 0; this.stamp[start] = this.gen;
    this._push(start, 0);
    while (this.heapN > 0) {
      const cur = this._pop();
      if (this.closed[cur] === this.gen) continue;
      this.closed[cur] = this.gen;
      this.reach[this.reachN++] = cur;
      if (++this.expanded > this.maxExpand) break;
      const cx = (cur % S) + this.ox, cz = ((cur / S) | 0) + this.oz;
      const gc = this.g[cur];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], nz = cz + DZ[k];
        const ni = this._idx(nx, nz);
        if (ni < 0 || this.closed[ni] === this.gen || !this._walk(ni, nx, nz)) continue;
        let cost = 1;
        if (k >= 4) {
          const ai = this._idx(cx + DX[k], cz), bi = this._idx(cx, cz + DZ[k]);
          if (ai < 0 || bi < 0 || !this._walk(ai, cx + DX[k], cz) || !this._walk(bi, cx, cz + DZ[k])) continue;
          cost = SQRT2;
        }
        const ng = gc + cost;
        if (ng > lim || (this.stamp[ni] === this.gen && this.g[ni] <= ng)) continue;
        this.stamp[ni] = this.gen; this.g[ni] = ng;
        this._push(ni, ng);
      }
    }
    // g in metres for callers
    for (let k = 0; k < this.reachN; k++) this.g[this.reach[k]] *= NAV_CELL;
    return this.reachN;
  }

  /** World x/z of the centre of window index i (valid until the next search). */
  cellX(i) { return ((i % this.size) + this.ox) * NAV_CELL + NAV_CELL / 2; }
  cellZ(i) { return (((i / this.size) | 0) + this.oz) * NAV_CELL + NAV_CELL / 2; }
}

function octile(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
}
