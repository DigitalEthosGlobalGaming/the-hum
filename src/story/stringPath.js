// Red string path maths. Pure (Node-testable). A path is [[x, z], ...] in metres.

export const pathLength = (pts) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
};

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  if (L2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/**
 * Ramer–Douglas–Peucker: drop points within `tol` metres of the simplified line. Keeps the ends.
 * Iterative (no recursion limit on long threads).
 */
export function compressPath(pts, tol = 0.08) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i], pts[a], pts[b]);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Pay out string toward the player at p = [x, z].
 * thread: { pts, len }; spool: { left } (metres left on the ball).
 * Adds a point once you are `step` metres from the last one, never past what's left.
 * Compresses the settled part of the path every `every` points (the newest few stay raw).
 * @returns {{ added: boolean, taut: boolean }}
 */
export function payOut(thread, spool, p, { step = 0.35, every = 48, tol = 0.08 } = {}) {
  const last = thread.pts[thread.pts.length - 1];
  if (!last) { thread.pts.push([p[0], p[1]]); return { added: true, taut: false }; }
  const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
  if (d < step) return { added: false, taut: false };
  if (spool.left <= 0) return { added: false, taut: true };
  let q = [p[0], p[1]], used = d;
  if (d > spool.left) { // only as far as the ball reaches
    const k = spool.left / d;
    q = [last[0] + (p[0] - last[0]) * k, last[1] + (p[1] - last[1]) * k];
    used = spool.left;
  }
  thread.pts.push(q);
  thread.len = (thread.len ?? 0) + used;
  spool.left = Math.max(0, spool.left - used);
  if (thread.pts.length % every === 0) {
    const tail = thread.pts.slice(-4);
    thread.pts = compressPath(thread.pts.slice(0, -3), tol).concat(tail.slice(1));
  }
  return { added: true, taut: spool.left <= 0 };
}
