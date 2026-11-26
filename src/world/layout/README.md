# World layout core (`src/world/layout/`)

Headless and pure: ES modules with no DOM and no Three.js. They run in Node (tools, tests) and in the browser.
It turns `(worldSeed, rooms, zoneAt)` into a room for every herringbone slot of an infinite world.
The result is deterministic and order-independent: a slot's room never depends on which region was requested first.

```
herringbone.js  slots + edge segments (pure maths)
connectors.js   hashed connectors per segment + the ≥2-openings rule
transform.js    rotateRoom / mirror for layouts, edges and local positions
templates.js    room validation, pre-transformed variants, edge specs, border stamping
filler.js       procedural room for any edge set
wfc.js          generic bitmask WFC solver (entropy, propagation, undo stack)
layout.js       createWorldLayout / layoutRegion / stitchCells / seam + reachability checks
index.js        re-exports everything
layout.test.mjs node --test src/world/layout/
```
Sweep: `node tools/wfc-sweep.mjs` (see its header for flags).

## API

```js
import { createWorldLayout, layoutRegion, stitchCells, rotateRoom, slotAtBlock } from './world/layout/index.js';

const world = createWorldLayout({
  worldSeed,                 // number | string
  rooms: content.rooms,      // { id: roomJson } (or an array); rooms tagged "test" are ignored
  zoneAt: (bx, bz) => 'lobby',
  zones,                     // optional, default DEFAULT_ZONES (connectors.js)
  patchSize: 8,              // optional, WFC patch size in blocks
  maxPatches: 256,           // optional, LRU patch cache size
});
world.templates.errors       // validation errors (empty = good); the sweep fails on these
const entries = world.layoutRegion(minBx, minBz, maxBx, maxBz); // inclusive block rect
world.slotResult(slotAtBlock(bx, bz));                           // one slot

// one-shot: layoutRegion({ worldSeed, rooms, zoneAt, minBx, minBz, maxBx, maxBz, world? })
```

Each entry (one per slot touching the rect, sorted by `bz, bx`):

| field | meaning |
|---|---|
| `slotKey`, `bx`, `bz`, `orient` | slot id (`"h:4,-2"`), top-left block, `h` (2×1 blocks) or `v` (1×2) |
| `zone` | `zoneAt(bx, bz)` of the slot's top-left block |
| `edges` | `{n:[…], s:[…], e:[…], w:[…]}` final connectors, world orientation, ordered W→E / N→S |
| `roomId` | template id, or `null` for filler |
| `filler` | the filler layout (`string[]`) when no template matched, otherwise undefined |
| `quarterTurns`, `mirror` | transform applied to the template (informational; `room` is already transformed) |
| `origin` | `[bx, bz]`: the block where `room`'s local (0,0) sits. This is the slot for single rooms and the bounding-box corner for multi-slot rooms |
| `size` | `[cols, rows]` of `room.layout` |
| `room` | a **ready-to-build room JSON**: transformed layout with stamped borders, merged legend (`' '` → `void`), materials (zone defaults if missing), objects/spots/lights/spawn in the transformed local frame |
| `bigRoom` | multi-slot only: `{ key, slots: [slotKeys], primary }`. Every claimed slot returns the same `room` object; build it once per `key` |
| `seed` | `hash(worldSeed, 'room', slotKey)`: use as the spawn/pool seed for this room |
| `solve` | `strict` / `relaxed` / `failed`: how the owning WFC patch was solved |

Helpers: `stitchCells(entries, minBx, minBz, maxBx, maxBz)` builds a walkable grid `{w, h, ox, oz, walk, filled, owner}`.
`findSeamMismatches(grid, entries)` and `reachability(grid, subRect)` are also exported.
So are `rotateRoom(room, quarterTurns, mirror)` and `generateFillerRoom(edges, rng, {pools})`.
`ConnectorField` / `connectorFor(segmentKey, worldSeed, zone)` give connectors, and `solveWfc(...)` is the generic solver.

## Herringbone maths

Blocks are 8×8 cells (16 m). For block `(bx, bz)` let `d = (bx − bz) mod 4` (always non-negative):

| d | block is | slot |
|---|---|---|
| 0 | top-left of an **h** slot | `h:(bx, bz)` covering `(bx,bz)`, `(bx+1,bz)` |
| 1 | right half of an h slot | `h:(bx−1, bz)` |
| 3 | top of a **v** slot | `v:(bx, bz)` covering `(bx,bz)`, `(bx,bz+1)` |
| 2 | bottom half of a v slot | `v:(bx, bz−1)` |

Every block maps to exactly one slot, and both blocks of a slot map back to it, so slots tile the plane with no overlap (tested over a 79×63 rect including negatives).
Each block row is the previous row shifted one block east, which gives the herringbone staircase.
Half the slots are `h` and half are `v`.

**Segments** are unit block edges. `"H:bx,bz"` is the north edge of block `(bx,bz)` and `"V:bx,bz"` is its west edge.
An h slot has n:2, s:2, e:1, w:1 segments and a v slot has n:1, s:1, e:2, w:2.
The two slots touching a segment compute the same key.

## Connectors and the ≥2-openings rule

`raw(seg) = weightedPick(hash(worldSeed, 'conn', segKey), zone.connectors)`.
The zone of a segment is the zone of its north/west block, so both sides agree.
Lobby weights are `wall 4, open 3, door 2, wide 1`.

Border cells per connector, along the 8 cells of a segment:

| connector | profile | |
|---|---|---|
| `wall` | `########` | |
| `door` | `###DD###` | 2 cells, kind `door` |
| `open` | `##....##` | 4 cells |
| `wide` | `#......#` | 6 cells |

Profiles are palindromes, so the reading direction never matters under rotation or mirroring.
Their ends are always solid, so slot corners stay solid.

**Forcing rule:** if a slot has fewer than `minOpenings` (2) non-wall raw connectors, it *demands* its wall segments with the lowest `hash(seed,'force',segKey)` until it would have enough.
A segment's final connector is its raw connector. The exception is a raw `wall` that *either* neighbour demands: it becomes a non-wall pick by `hash(seed,'forcepick',segKey)`.
Demands depend only on raw hashes, so there is no evaluation order.
Forcing only turns walls into openings, so it can never drop a neighbour below 2.

## Templates and edge specs (refinement of PLAN §4.1)

Single-slot templates are authored as `h`: `slots: [2,1]`, 16×8 cells, `edges: {n:[a,b], s:[a,b], e:[a], w:[a]}`. Each spec is one of:

- `"door"` (exact): the authored border must already match the profile. The validator checks this.
- `"open|wide"`: any of these.
- `"!wall"`: any opening.
- `"*"`: anything.

Flexible segments are **stamped** with the actual connector's profile at layout time.
Exact matching (PLAN's "edges match exactly") gave about 48 combos out of 4096, so nearly everything would be filler.
Flexible specs let a template declare only the edges its design depends on: the office's solid west wall, the dead-end alcove's sealed sides, and so on.

To match, every slot segment's connector must be in the spec *and* reach the room.
The template's *core* is its layout with every flexible segment closed, and it must be connected (validated).
A stamped opening is one contiguous run with solid ends, so it connects iff one of its cells touches a walkable core cell on the inside.
That is precomputed per variant, so matching is O(1), and every chosen room is connected by construction.

Optional template fields: `orientations: ["h"]` (no vertical use) and `mirror: false` (no mirrored variants).
`rules: { notNextTo: [tags] }` is a WFC adjacency rule, checked in both directions.

**Rotation** (`transform.js`): `quarterTurns` counts **clockwise turns in map view** (north up, +x east, +z south).
That equals Three.js `rotation.y = −90°·q`. `mirror` flips x and is applied first.

- Point `(x, z)` in a `Wm × Hm` room maps to `(Hm − z, x)` per turn, and `rot → rot − 90` (normalised to `[0,360)`).
- Mirror maps `x → Wm − x` and `rot → −rot`.
- Cells map `(c, r) → (H−1−r, c)`.
- Edges move by transforming each segment's midpoint, so one CW turn gives new `n` = old `w`, new `e` = old `n`, and so on. Order stays W→E / N→S.

h slots use variants `q ∈ {0,2}` × mirror and v slots use `q ∈ {1,3}` × mirror. Identical variants are de-duplicated.
A template's weight is split across its matching variants, so symmetric rooms aren't over-picked.

## WFC (`wfc.js` + `layout.js`)

**Patches.** The world is cut into fixed `patchSize × patchSize`-block patches (8×8 = 32 slots).
A slot belongs to the patch containing its top-left block, and each patch is solved independently, seeded only by slot keys.
Requesting any region solves (and caches) the patches it touches, so results never depend on request order.
Seams between patches can never break, because every option matches the pre-hashed connectors exactly.
The cost: adjacency rules are not enforced *across* patch borders (the sweep reports how often that happens), and multi-slot rooms must lie inside one patch.

**Variables and values.** Each slot is a variable. Its values are:

- every matching single-template variant
- "part of big placement P" for each multi-slot placement that claims it
- `filler`, only if no single template matches

**Constraints.**

- All-or-nothing for multi-slot placements: claimed slot i = P ⇔ claimed slot j = P.
- `notNextTo` tag rules between segment neighbours.

**Solver.** This is the simple tiled model.

- Domains are bitsets.
- Support masks are precomputed once per class pair. `allowed(j)` is the OR of `support[i→j][a]` over `a ∈ D(i)`, and `D(j) &= allowed`; `j` is re-queued when it changes.
- The solver observes the lowest weighted-Shannon-entropy variable (ties within 1e-9 go to the lowest index) and picks by weight with that slot's own `Rng(hash(seed,'wfc',slotKey))`.
- On a contradiction it pops a bounded undo stack (each frame stores only the domains it changed), bans the value and re-propagates.
- It gives up after 64 backtracks. Fallback 1 re-solves the patch without adjacency rules (`solve: 'relaxed'`). Fallback 2 drops big rooms and takes the first single or filler (`'failed'`; never seen).
- With filler as the last value, connectors alone can never contradict (a complete Wang set). Contradictions only come from tag rules.

## Multi-slot rooms (deviation from PLAN §3.2/§4.1)

In this herringbone **no rectangle of blocks is a union of whole slots**: 2×2, 4×1, 3×2 and so on always cut a slot in half.
So a multi-slot template is authored as a **footprint shape inside its bounding box**.
`slots: [w, h]` is the bounding box in blocks, and blocks that are all `' '` (void) are outside the footprint.
Shapes that fit the herringbone:

- **L** (`slots [2,3]`): an h slot plus the v slot under its left block. See `lobby_big_l_hall`.
- **Stair** (`slots [3,2]`): two h slots stepped diagonally. See `lobby_stair_hall`.

Longer staircases and other unions also work.
All 8 transforms are tried, and a placement is valid only if its transformed footprint is exactly a union of whole slots.

**Anchoring (order-free):** slot A is an anchor candidate iff `hash(seed,'bigAnchor',A.key) < zone.bigRoomChance` (lobby 0.15). A placement is enumerated from A only if:

- A is its *first* claimed slot (min `bz`, then `bx`)
- every claimed slot is in A's patch and A's zone
- its outer perimeter has at least 2 openings
- the stamped layout is connected

Multi-slot perimeters are fully flexible (always stamped from the real connectors).
Segments inside the footprint are ignored, so authors only draw the interior.
Valid placements become WFC values with weight `zoneWeight × bigRoomWeight / placementsFound`. WFC decides whether each one wins, and the all-or-nothing constraint propagates the decision to the other claimed slots.

## Filler

`generateFillerRoom(edges, rng, { pools })` works for either orientation; the size comes from `edges`.

1. It stamps the border profiles.
2. It keeps a 2-cell apron inside every opening clear.
3. It adds pillars or partial walls in one of four styles (pillars / partitions / mixed / bare). Every placement is flood-filled and reverted if it would disconnect anything.
4. It adds 1–3 `L` lights and up to 2 spots from `zone.fillerPools`.

The result is always connected, with every opening reachable (tested over about 1000 slots).

## Integration notes (streaming + `roomBuilder.js`)

- **Build:** `buildRoom(entry.room, textures, { x: entry.origin[0] * 16, z: entry.origin[1] * 16 })`. `entry.room` is already rotated, so no extra transform is needed. Build once per `entry.bigRoom?.key ?? entry.slotKey`.
- **roomBuilder edge cells:** `kindAt` treats out-of-bounds as `void`. An opening cell on the layout border therefore gets a wall quad on its outer face, and `isSolidAt` returns solid past the edge. The doorway is visually and physically sealed. Fix in roomBuilder: when the in-bounds border cell is walkable, treat the out-of-bounds neighbour as floor. The layout core guarantees the cell across the seam is walkable too (the sweep checks every seam).
- **Collision across rooms:** route `isSolidAt(x, z)` through `slotAtBlock(floor(x/16), floor(z/16))` → entry → that room's grid. A multi-slot room's bounding box contains `void` cells that belong to neighbouring slots, so never ask a big room about cells outside its footprint.
- **Streaming:** keep one `world = createWorldLayout(...)` per run and call `world.layoutRegion(...)` for the blocks around the player. Solving a patch costs about 5–10 ms (32 slots × about 0.17–0.3 ms). To avoid hitches, prefetch one patch per frame with `world.getPatch(px, pz)` (`world.patchOfBlock(bx, bz)` gives the patch). The cache is LRU (`maxPatches`).
- **Spawns:** roll spots with `entry.seed` (`hash(slotSeed, spotId)` per PLAN §4.3). For multi-slot rooms use the primary entry's seed.
- **Zones:** connectors use the zone of the segment's north/west block. Zone-border `transition` connectors (PLAN §3.6) are not implemented yet. Add the connector to `PROFILES` and force it in `ConnectorField.get` when the two blocks' zones differ.
- **Content:** templates use `rules` and wildcard `edges` specs. A future `tools/validate.mjs` should accept them, or call `prepareTemplates(rooms).errors`, which already checks dims, legend, exact borders, core connectivity and objects/spots on walkable cells.
