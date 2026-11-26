// Room acoustics estimate from the cell grid around the listener. Pure (no DOM, no Web Audio):
// `isSolid(cx, cz)` answers for global 2 m cells (unbuilt space counts as solid).
//
// A flood fill (8-neighbour Dijkstra, no corner cutting) from the listener's cell out to `radius`
// metres of walking distance gives the reachable area and its shape; four straight probes give the
// local width and length. From those:
//   size       reachable cells / cells in the full disc (0 = a cupboard, 1 = open floor all round)
//   elong      0 round .. 1 a line (principal axes of the reached cells)
//   width/len  narrowest / longest open line through the listener (metres)
// → weights for the three generated impulses (small office, big hall, long corridor) and the
//   per-bus reverb send scales. Buffers are allocated once per estimator; estimate() allocates nothing.

export const CELL_M = 2;
export const ROOMS = ['small', 'hall', 'corridor']; // same order as ROOM_IMPULSES in src/audio/synth.js

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export class AcousticsEstimator {
  constructor(radiusM = 12, cell = CELL_M) {
    this.cell = cell;
    this.R = Math.max(1, Math.round(radiusM / cell)); // radius in cells
    this.D = this.R * 2 + 1;
    const n = this.D * this.D;
    this.dist = new Float32Array(n);  // walking distance in cells (Infinity = not reached)
    this.done = new Uint8Array(n);
    this.heap = new Int32Array(n * 8); // simple binary heap of indices (lazy deletion)
    this.heapKey = new Float32Array(n * 8);
    // cells within R of octile walking distance on open floor: the "fully open" reference
    let disc = 0;
    for (let z = -this.R; z <= this.R; z++) {
      for (let x = -this.R; x <= this.R; x++) {
        const a = Math.abs(x), b = Math.abs(z);
        if (Math.max(a, b) + (Math.SQRT2 - 1) * Math.min(a, b) <= this.R + 1e-9) disc++;
      }
    }
    this.discCells = disc;
    this.cx = 0; this.cz = 0; // field origin (global cell)
    this.valid = false;
    this.result = { cells: 0, size: 0, elong: 0, width: 0, length: 0, open: 0, weights: [1, 0, 0], sends: {}, cx: 0, cz: 0 };
  }

  /** Walking distance in metres from the field origin to global cell (cx, cz), or Infinity. */
  pathDistance(cx, cz) {
    if (!this.valid) return Infinity;
    const x = cx - this.cx + this.R, z = cz - this.cz + this.R;
    if (x < 0 || z < 0 || x >= this.D || z >= this.D) return Infinity;
    return this.dist[z * this.D + x] * this.cell;
  }

  /** Flood from global cell (cx, cz). Returns this.result (reused object). */
  estimate(isSolid, cx, cz) {
    const { R, D, dist, done } = this;
    this.cx = cx; this.cz = cz;
    dist.fill(Infinity);
    done.fill(0);
    const res = this.result;
    res.cx = cx; res.cz = cz;
    this.valid = true;
    if (isSolid(cx, cz)) {
      // standing in a wall cell (edge of a doorway, unbuilt): treat as a tight space
      res.cells = 1; res.size = 0; res.elong = 0; res.width = this.cell; res.length = this.cell; res.open = 0;
      return this._weigh(res);
    }
    const start = R * D + R;
    dist[start] = 0;
    let hn = 0;
    const push = (i, k) => {
      let j = hn++;
      this.heap[j] = i; this.heapKey[j] = k;
      while (j > 0) {
        const p = (j - 1) >> 1;
        if (this.heapKey[p] <= this.heapKey[j]) break;
        const ti = this.heap[p], tk = this.heapKey[p];
        this.heap[p] = this.heap[j]; this.heapKey[p] = this.heapKey[j];
        this.heap[j] = ti; this.heapKey[j] = tk;
        j = p;
      }
    };
    const pop = () => {
      const top = this.heap[0];
      hn--;
      if (hn > 0) {
        this.heap[0] = this.heap[hn]; this.heapKey[0] = this.heapKey[hn];
        let j = 0;
        for (;;) {
          const l = j * 2 + 1, r = l + 1;
          let m = j;
          if (l < hn && this.heapKey[l] < this.heapKey[m]) m = l;
          if (r < hn && this.heapKey[r] < this.heapKey[m]) m = r;
          if (m === j) break;
          const ti = this.heap[m], tk = this.heapKey[m];
          this.heap[m] = this.heap[j]; this.heapKey[m] = this.heapKey[j];
          this.heap[j] = ti; this.heapKey[j] = tk;
          j = m;
        }
      }
      return top;
    };
    // solid lookups are cached per flood in `done` bit 2 (2 = known solid, 4 = known open)
    const solidAt = (x, z) => {
      const i = z * D + x;
      if (done[i] & 2) return true;
      if (done[i] & 4) return false;
      const s = isSolid(cx + x - R, cz + z - R);
      done[i] |= s ? 2 : 4;
      return s;
    };
    push(start, 0);
    let cells = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, edge = 0;
    while (hn > 0) {
      const i = pop();
      if (done[i] & 1) continue;
      done[i] |= 1;
      const x = i % D, z = (i / D) | 0;
      const d = dist[i];
      cells++;
      const ox = x - R, oz = z - R;
      sx += ox; sz += oz; sxx += ox * ox; szz += oz * oz; sxz += ox * oz;
      if (d > R - 1) edge++;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= D || nz >= D) continue;
          if (solidAt(nx, nz)) continue;
          if (dx && dz && (solidAt(x + dx, z) || solidAt(x, z + dz))) continue; // no corner cutting
          const nd = d + (dx && dz ? Math.SQRT2 : 1);
          if (nd > R + 1e-6) continue;
          const j = nz * D + nx;
          if (nd < dist[j]) { dist[j] = nd; push(j, nd); }
        }
      }
    }
    for (let i = 0; i < dist.length; i++) if (!(done[i] & 1)) dist[i] = Infinity;
    // shape: covariance eigenvalues of the reached cells
    const mx = sx / cells, mz = sz / cells;
    const cxx = sxx / cells - mx * mx, czz = szz / cells - mz * mz, cxz = sxz / cells - mx * mz;
    const tr = cxx + czz, det = cxx * czz - cxz * cxz;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
    res.cells = cells;
    res.size = Math.min(1, cells / this.discCells);
    res.elong = l1 > 1e-6 ? 1 - Math.sqrt(l2 / l1) : 0;
    // probes along the 4 axes through the listener: narrowest and longest open lines
    const ray = (dx, dz) => {
      let n = 0;
      while (n < R && !solidAt(R + dx * (n + 1), R + dz * (n + 1))) n++;
      return n;
    };
    const a = [ray(1, 0) + ray(-1, 0), ray(0, 1) + ray(0, -1), (ray(1, 1) + ray(-1, -1)) * Math.SQRT2, (ray(1, -1) + ray(-1, 1)) * Math.SQRT2];
    res.width = (Math.min(...a) + 1) * this.cell;
    res.length = (Math.max(...a) + 1) * this.cell;
    res.open = Math.min(1, edge / Math.max(1, 2 * Math.PI * R)); // how much of the space carries on past the radius
    return this._weigh(res);
  }

  _weigh(res) {
    const size = res.size;
    // corridor: narrow (≤ ~4 m) but long, and an elongated reachable area
    const narrow = 1 - smoothstep(3.5, 7, res.width);
    const long = smoothstep(8, 16, res.length);
    const corr = narrow * long * smoothstep(0.35, 0.75, res.elong + 0.25 * narrow);
    const small = (1 - smoothstep(0.1, 0.4, size)) * (1 - corr * 0.7);
    const hall = smoothstep(0.25, 0.7, size) * (1 - corr);
    let w0 = small, w1 = hall, w2 = corr;
    const sum = w0 + w1 + w2;
    if (sum < 1e-3) { w0 = 0.5; w1 = 0.5; w2 = 0; } else { w0 /= sum; w1 /= sum; w2 /= sum; }
    res.weights[0] = w0; res.weights[1] = w1; res.weights[2] = w2;
    // how washy: big open space → lots of send, a cupboard → nearly dry
    const wet = Math.min(1, size * 0.8 + res.open * 0.3 + w2 * 0.3);
    res.wet = wet;
    res.sends.sfx = lerp(0.3, 1.7, wet);
    res.sends.tenant = lerp(0.5, 1.5, wet);
    res.sends.env = lerp(0.6, 1.3, wet);
    res.sends.ambience = lerp(0.6, 1.3, wet);
    return res;
  }
}

/** Cell of a world coordinate. */
export const cellOf = (m, cell = CELL_M) => Math.floor(m / cell);
