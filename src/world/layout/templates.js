// Room templates: validation, pre-computed transforms, edge matching and border stamping.
import { CELLS_PER_BLOCK, CELL_M, CORE_LEGEND, SOLID_KINDS, isConnected, isSolidChar } from './grid.js';
import { PROFILES, CONNECTORS } from './connectors.js';
import { ALL_TRANSFORMS, rotateRoom } from './transform.js';
import { footprintPerimeter } from './herringbone.js';

const B = CELLS_PER_BLOCK;

/**
 * Parse one edge spec into a Set of allowed connectors.
 *   "door"        exactly door (the authored border must match its profile)
 *   "open|wide"   any of these (border stamped at layout time)
 *   "!wall"       any non-wall connector (stamped)
 *   "*"           anything (stamped)
 */
export function parseEdgeSpec(spec) {
  if (spec === '*') return { set: new Set(CONNECTORS), exact: null };
  if (spec.startsWith('!')) {
    const ban = new Set(spec.slice(1).split('|'));
    return { set: new Set(CONNECTORS.filter((c) => !ban.has(c))), exact: null };
  }
  const parts = spec.split('|');
  for (const p of parts) if (!PROFILES[p]) throw new Error(`unknown connector "${p}"`);
  return { set: new Set(parts), exact: parts.length === 1 ? parts[0] : null };
}

/** Cells (col, row) of one block side inside a layout, in W→E / N→S order. */
export function sideCells(lbx, lbz, side) {
  const out = [];
  for (let i = 0; i < B; i++) {
    if (side === 'n') out.push([lbx * B + i, lbz * B]);
    else if (side === 's') out.push([lbx * B + i, lbz * B + B - 1]);
    else if (side === 'w') out.push([lbx * B, lbz * B + i]);
    else out.push([lbx * B + B - 1, lbz * B + i]);
  }
  return out;
}

/** Local footprint blocks of a layout: blocks containing any non-space cell. */
export function layoutFootprint(layout) {
  const wb = layout[0].length / B, hb = layout.length / B;
  const out = [];
  for (let bz = 0; bz < hb; bz++) {
    for (let bx = 0; bx < wb; bx++) {
      let any = false;
      for (let r = 0; r < B && !any; r++) {
        for (let c = 0; c < B; c++) if (layout[bz * B + r][bx * B + c] !== ' ') { any = true; break; }
      }
      if (any) out.push([bx, bz]);
    }
  }
  return out;
}

/**
 * Stamp connector profiles onto every perimeter segment of a footprint.
 * @param layout     string[] (transformed, local)
 * @param footprint  [[lbx, lbz]] local blocks
 * @param connAt     (lbx, lbz, side) → connector
 * @returns string[]
 */
export function stampBorders(layout, footprint, connAt) {
  const g = layout.map((r) => r.split(''));
  for (const p of footprintPerimeter(footprint)) {
    const prof = PROFILES[connAt(p.bx, p.bz, p.side)] ?? PROFILES.open;
    sideCells(p.bx, p.bz, p.side).forEach(([c, r], i) => { g[r][c] = prof[i]; });
  }
  return g.map((r) => r.join(''));
}

function legendFor(room) {
  return { ...room.legend, ...CORE_LEGEND };
}

/**
 * Validate and pre-transform room templates.
 * @param rooms  { id: roomJson } or roomJson[]
 * @returns { singles, bigs, errors, warnings, byId }
 *   singles: [{ id, room, tags, rules, zones, variants: [{ q, mirror, orient, room, layout, edges }] }]
 *            variant.edges = { n: [{set, exact}], ... } in world orientation
 *   bigs:    [{ id, room, tags, rules, zones, variants: [{ q, mirror, room, layout, footprint, wb, hb }] }]
 */
export function prepareTemplates(rooms) {
  const list = Array.isArray(rooms) ? rooms : Object.values(rooms);
  const singles = [], bigs = [], errors = [], warnings = [];
  const byId = new Map();
  for (const room of [...list].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const err = (m) => errors.push(`${room.id}: ${m}`);
    if ((room.tags ?? []).includes('test')) continue;
    if (!room.zones || !room.layout || !room.slots) { warnings.push(`${room.id}: skipped (no zones/layout/slots)`); continue; }
    const [wb, hb] = room.slots;
    const H = room.layout.length, W = room.layout[0].length;
    if (W !== wb * B || H !== hb * B || room.layout.some((r) => r.length !== W)) {
      err(`layout must be ${wb * B}×${hb * B} cells`); continue;
    }
    for (const [ch, kind] of Object.entries(room.legend ?? {})) {
      if (!(kind in SOLID_KINDS)) err(`legend "${ch}" → unknown kind "${kind}"`);
      if (CORE_LEGEND[ch] && CORE_LEGEND[ch] !== kind) err(`legend "${ch}" must be "${CORE_LEGEND[ch]}" (reserved)`);
    }
    const legend = legendFor(room);
    const badChar = room.layout.join('').split('').find((ch) => !(ch in legend));
    if (badChar !== undefined) { err(`layout char "${badChar}" not in legend`); continue; }
    if (!isConnected(room.layout, legend)) err('walkable cells are not all connected');
    for (const [kind, arr] of [['object', room.objects ?? []], ['spot', room.spots ?? []]]) {
      for (const o of arr) {
        const c = Math.floor(o.pos[0] / CELL_M), r = Math.floor(o.pos[2] / CELL_M);
        if (c < 0 || r < 0 || c >= W || r >= H) err(`${kind} ${o.id ?? o.def} outside the layout`);
        else if (isSolidChar(room.layout[r][c], legend)) err(`${kind} ${o.id ?? o.def} at [${o.pos}] is inside a solid cell`);
      }
    }
    const base = { id: room.id, room, tags: room.tags ?? [], rules: room.rules ?? {}, zones: room.zones };

    const isSingle = (wb === 2 && hb === 1);
    if (isSingle) {
      const e = room.edges;
      if (!e || e.n?.length !== 2 || e.s?.length !== 2 || e.e?.length !== 1 || e.w?.length !== 1) {
        err('a [2,1] room needs edges {n:[a,b], s:[a,b], e:[a], w:[a]}'); continue;
      }
      let parsed;
      try {
        parsed = {};
        for (const side of ['n', 's', 'e', 'w']) parsed[side] = e[side].map(parseEdgeSpec);
      } catch (x) { err(x.message); continue; }
      // exact segments: authored border must match the connector profile
      const fp = [[0, 0], [1, 0]];
      for (const p of footprintPerimeter(fp)) {
        const idx = p.side === 'n' || p.side === 's' ? p.bx : p.bz;
        const spec = parsed[p.side][idx];
        if (!spec.exact) continue;
        const prof = PROFILES[spec.exact];
        sideCells(p.bx, p.bz, p.side).forEach(([c, r], i) => {
          if (isSolidChar(room.layout[r][c], legend) !== isSolidChar(prof[i], CORE_LEGEND)) {
            err(`edge ${p.side}[${idx}] is "${spec.exact}" but border cell (${c},${r}) doesn't match "${prof}"`);
          }
        });
      }
      const orients = room.orientations ?? ['h', 'v'];
      const variants = [];
      const seen = new Set();
      for (const [q, mirror] of ALL_TRANSFORMS) {
        const orient = q % 2 ? 'v' : 'h';
        if (!orients.includes(orient)) continue;
        if (mirror && room.mirror === false) continue;
        const t = rotateRoom(room, q, mirror);
        const sig = JSON.stringify([t.layout, t.edges, t.room.objects, t.room.spots]);
        if (seen.has(sig)) continue;
        seen.add(sig);
        const edges = {};
        for (const side of ['n', 's', 'e', 'w']) edges[side] = t.edges[side].map(parseEdgeSpec);
        const vfp = orient === 'h' ? [[0, 0], [1, 0]] : [[0, 0], [0, 1]];
        // core = every flexible segment closed, exact segments as authored
        const core = stampBorders(t.layout, vfp, (bx, bz, side) => edges[side][side === 'n' || side === 's' ? bx : bz].exact ?? 'wall');
        if (!isConnected(core, legend)) { err(`not connected with all flexible edges closed (transform ${q}${mirror ? 'm' : ''})`); break; }
        // allowed[side][i] = connectors this segment accepts AND that reach the core when stamped.
        // Profiles are one contiguous run with solid ends, so a stamped opening is connected iff
        // one of its cells touches a walkable core cell on the inside. This makes matching O(1)
        // and exact (stamped layout connected ⇔ every opening is allowed here).
        const allowed = {};
        for (const p of footprintPerimeter(vfp)) {
          const idx = p.side === 'n' || p.side === 's' ? p.bx : p.bz;
          const spec = edges[p.side][idx];
          const ok = new Set();
          for (const conn of spec.set) {
            if (conn === 'wall' || spec.exact) { ok.add(conn); continue; }
            const [dc, dr] = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[p.side];
            const reach = sideCells(p.bx, p.bz, p.side).some(([c, r], i) => PROFILES[conn][i] !== '#'
              && !isSolidChar(core[r + dr][c + dc], legend));
            if (reach) ok.add(conn);
          }
          (allowed[p.side] ??= [])[idx] = ok;
        }
        variants.push({ q, mirror, orient, room: t.room, layout: t.layout, edges, allowed, footprint: vfp });
      }
      const tpl = { ...base, kind: 'single', variants };
      singles.push(tpl);
      byId.set(room.id, tpl);
    } else {
      const fp = layoutFootprint(room.layout);
      if (fp.length < 3) { err('multi-slot room footprint must have ≥ 3 blocks'); continue; }
      for (const [bx, bz] of fp) {
        for (let r = 0; r < B; r++) for (let c = 0; c < B; c++) {
          if (room.layout[bz * B + r][bx * B + c] === ' ') err(`block ${bx},${bz} is partly void`);
        }
      }
      const variants = [];
      const seen = new Set();
      for (const [q, mirror] of ALL_TRANSFORMS) {
        if (mirror && room.mirror === false) continue;
        const t = rotateRoom(room, q, mirror);
        const sig = JSON.stringify([t.layout, t.room.objects, t.room.spots]);
        if (seen.has(sig)) continue;
        seen.add(sig);
        variants.push({ q, mirror, room: t.room, layout: t.layout, footprint: layoutFootprint(t.layout), wb: t.slots[0], hb: t.slots[1] });
      }
      const tpl = { ...base, kind: 'big', variants };
      bigs.push(tpl);
      byId.set(room.id, tpl);
    }
  }
  return { singles, bigs, errors, warnings, byId };
}

export { legendFor };
