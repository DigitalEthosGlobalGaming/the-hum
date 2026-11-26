# Content formats

Everything in `content/` is bundled into the game at build time (`virtual:content`).
`content/<kind>/**/*.json` → `content[kind][id]`; `content/config.json` → `content.config`.
Full design rationale: [PLAN.md §4](../PLAN.md).

## Conventions
- Units are **metres**. A cell is 2 m. Wall height 3 m.
- **Room-local space:** origin = top-left corner of `layout` (row 0, col 0). `+x` = along a row (columns), `+z` = down the rows, `+y` = up.
  Cell (col, row) spans x∈[col·2, col·2+2], z∈[row·2, row·2+2]. Position `[x, y, z]`.
- `rot` = degrees around Y, counter-clockwise seen from above (same as Three.js `rotation.y`). 0 faces `-z` (north / up the layout).
- Ids are `snake_case` and unique per kind. File name should match `id`.

## rooms/<zone>/*.json
| field | type | notes |
|---|---|---|
| id | string | |
| zones | {zone: weight} | which zones may use it, with weight |
| tags | string[] | used by adjacency rules |
| slots | [w, h] | size in 8×8-cell blocks. Herringbone slot = [2,1] |
| edges | {n,s,e,w: connector[]} | one connector per block-width segment on that side (WFC sockets; optional until M3) |
| layout | string[] | rows of cells; each char via `legend` |
| legend | {char: kind} | kinds: `wall`, `pillar`, `floor`, `door`, `light`, `void` |
| materials | {wall, pillar, floor, ceiling, ceilingLight} | texture names (assets/textures without .png) |
| objects | [{def, pos, rot?}] | always placed |
| spots | [{id, pos, rot?, pool}] | `pool` = pool id or inline entry array or pool object |
| spawn | {pos, rot} | optional player spawn (test rooms only) |
| script | string\|null | optional room script id |

## objects/*.json
`{ id, name, mesh, components: { <type>: {...} } }`

**mesh**: `{ type: "box", size:[x,y,z], texture?, tint? }` · `{ type: "plane", size:[w,h], texture?, tint?, doubleSided?, flat? }` (`flat: true` lies on the surface below it) ·
`{ type: "sprite", size:[w,h], texture, tint? }` (always faces camera on Y) · `{ type: "prefab", name, tint? }` (built-in models, see `src/objects/prefabs.js`).
Box/plane origin is at the **bottom centre** (so `pos.y` = what it stands on).
`texture` may be a Kenney name or `proc:<name>` (procedural canvas texture, see `src/objects/procTextures.js`).

**components** (M2 runtime support marked ✓):
| type | fields |
|---|---|
| collider ✓ | `{ shape: "box", solid: true }` blocks movement (uses mesh bounds) |
| readable ✓ | `{ text \| textId, display: "notebook"\|"inspect"\|"surface" }` |
| sound ✓ | `{ preset, trigger: "ambient"\|"proximity"\|"interact"\|"script", loop?, radius?, volume?, once? }` |
| light ✓ | `{ color, intensity, range, flicker? }` |
| interact | `{ verb, script, params?, once?, cooldown? }` (M4) |
| pickup | `{ size? }` (M4) |
| use | `{ script, params?, consume?, requiresHeld? }` (M4) |
| combine | `[{ with, script, consume, result? }]` (M4) |
| door, hide, anomaly | (later) |

## pools/*.json
`{ id, rolls?: 1, entries: [ { def: id|null, w: >0, minDepth?, maxDepth?, zones?, unique? } | { pool: id, w } ] }`
Chance of an entry = `w / sum(w of eligible entries)`. `null` def = nothing spawns. Check odds with `node tools/pool-sim.mjs <pool_id>`.

## sounds/*.json
Procedural Web Audio presets referenced by `sound.preset`. Format documented in `src/audio/presets.md`.
