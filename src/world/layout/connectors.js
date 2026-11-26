// Edge connectors: the WFC "sockets" on every block-width segment.
// A segment's connector is a pure function of (worldSeed, segment key, zone), so both
// neighbouring slots derive the same value without either of them existing yet.
import { hash } from '../../core/rng.js';
import { slotSegments, segmentBlocks, segmentSlots } from './herringbone.js';

// Border cells along one segment (8 cells, read W→E or N→S). Every profile is a
// palindrome, so reading direction never matters, and both ends are always solid
// (segment ends are slot corners on at least one side).
export const PROFILES = {
  wall: '########',
  door: '###DD###',
  open: '##....##',
  wide: '#......#',
};
export const CONNECTORS = Object.keys(PROFILES);

export const DEFAULT_ZONES = {
  lobby: {
    // relative weights of each connector on a segment
    connectors: { wall: 4, open: 3, door: 2, wide: 1 },
    // every slot gets at least this many non-wall connectors (see forcing rule below)
    minOpenings: 2,
    // chance that a slot is a candidate anchor for a multi-slot room
    bigRoomChance: 0.15,
    // big-room option weight multiplier inside WFC (relative to single templates)
    bigRoomWeight: 3,
    materials: {
      wall: 'wall_yellow_pattern', pillar: 'wall_yellow', floor: 'carpet_green',
      ceiling: 'ceiling_large', ceilingLight: 'ceiling_large_light_on',
    },
    fillerPools: ['lobby_floor_loot', 'lobby_clutter'],
  },
};

const U32 = 4294967296;

/** Weighted pick from {name: weight} using a 32-bit hash as the roll (keys sorted for stability). */
export function pickByHash(h, weights) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0).sort();
  let total = 0;
  for (const k of keys) total += weights[k];
  let roll = (h / U32) * total;
  for (const k of keys) {
    roll -= weights[k];
    if (roll < 0) return k;
  }
  return keys[keys.length - 1];
}

export function zoneConfig(zones, zone) {
  return zones[zone] ?? zones.lobby ?? Object.values(zones)[0];
}

/** Raw hashed connector for a segment, before the minimum-openings rule. */
export function connectorFor(segmentKey, worldSeed, zone, zones = DEFAULT_ZONES) {
  return pickByHash(hash(worldSeed, 'conn', segmentKey), zoneConfig(zones, zone).connectors);
}

/**
 * Connector field for one world: raw hashes + the deterministic forcing rule, memoised.
 *
 * Forcing rule (keeps both sides consistent): a slot S "demands" its wall segments with the
 * lowest hash(seed, 'force', key) until it would have `minOpenings` non-wall segments by raw
 * hashes alone. A segment's final connector is its raw connector, unless raw is `wall` and
 * either adjacent slot demands it; then it becomes a non-wall pick by hash(seed, 'forcepick', key).
 * Demands only depend on raw hashes (never on other demands), so evaluation is order-free,
 * and upgrading wall → opening can only raise a neighbour's count, so every slot ends up
 * with ≥ minOpenings.
 */
export class ConnectorField {
  constructor({ worldSeed, zoneAt = () => 'lobby', zones = DEFAULT_ZONES }) {
    this.worldSeed = worldSeed;
    this.zoneAt = zoneAt;
    this.zones = zones;
    this._raw = new Map();
    this._demand = new Map();
    this._final = new Map();
  }
  /** Zone that owns a segment: the zone of its north/west block. */
  segmentZone(key) {
    const [a] = segmentBlocks(key);
    return this.zoneAt(a[0], a[1]);
  }
  slotZone(slot) { return this.zoneAt(slot.bx, slot.bz); }
  raw(key) {
    let c = this._raw.get(key);
    if (c === undefined) {
      c = connectorFor(key, this.worldSeed, this.segmentZone(key), this.zones);
      this._raw.set(key, c);
    }
    return c;
  }
  /** Set of segment keys this slot forces open. */
  demands(slot) {
    let d = this._demand.get(slot.key);
    if (d) return d;
    const segs = slotSegments(slot);
    const all = [...segs.n, ...segs.s, ...segs.e, ...segs.w];
    const min = zoneConfig(this.zones, this.slotZone(slot)).minOpenings ?? 2;
    const open = all.filter((k) => this.raw(k) !== 'wall').length;
    d = new Set();
    if (open < min) {
      const walls = all.filter((k) => this.raw(k) === 'wall')
        .map((k) => ({ k, h: hash(this.worldSeed, 'force', k) }))
        .sort((a, b) => a.h - b.h || (a.k < b.k ? -1 : 1));
      for (let i = 0; i < min - open && i < walls.length; i++) d.add(walls[i].k);
    }
    this._demand.set(slot.key, d);
    return d;
  }
  /** Final connector for a segment. */
  get(key) {
    let c = this._final.get(key);
    if (c !== undefined) return c;
    c = this.raw(key);
    if (c === 'wall') {
      const [a, b] = segmentSlots(key);
      if (this.demands(a).has(key) || this.demands(b).has(key)) {
        const w = { ...zoneConfig(this.zones, this.segmentZone(key)).connectors };
        delete w.wall;
        if (!Object.values(w).some((v) => v > 0)) w.open = 1;
        c = pickByHash(hash(this.worldSeed, 'forcepick', key), w);
      }
    }
    this._final.set(key, c);
    return c;
  }
  /** World-oriented edges of a slot: {n:[], s:[], e:[], w:[]} ordered W→E / N→S. */
  slotEdges(slot) {
    const segs = slotSegments(slot);
    const out = {};
    for (const side of ['n', 's', 'e', 'w']) out[side] = segs[side].map((k) => this.get(k));
    return out;
  }
}

