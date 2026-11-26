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

Optional `tags: string[]` on an object let scripts find it (`ctx.world.findByTag`).

**components** (runtime support marked ✓):
| type | fields |
|---|---|
| collider ✓ | `{ shape: "box", solid: true }` blocks movement (uses mesh bounds) |
| readable ✓ | `{ text \| textId, display: "notebook"\|"inspect"\|"surface" }`. `textId`: a note id, `"spine"` (next unread spine note) or `"random"` (an unread fragment, seeded). Resolved on first read and remembered by that object. `notebook` also adds the page to the notebook once, and picks the object up if it has `pickup` |
| sound ✓ | `{ preset, trigger: "ambient"\|"proximity"\|"interact"\|"script", loop?, radius?, volume?, once? }` |
| light ✓ | `{ color, intensity, range, flicker? }` |
| interact ✓ | `{ verb, script, params?, once?, cooldown? (s) }`. E on the object runs the script. `verb` is the hand's label |
| pickup ✓ | `{ size?: 1\|2 }`. E puts it in the pockets (the selected slot if empty). Picked-up spots never respawn |
| use ✓ | `{ script, params?, consume?: bool, requiresHeld? }`. Left click / R while held. `requiresHeld` = another item that must be in the pockets (`"flashlight"` is always held). The script's `ok({consume})` overrides `consume` |
| combine ✓ | `[{ with, script, params?, consume: "self"\|"other"\|"both"\|"none", result? }]`. Held item + E on an object, or item + item in the pockets view. Checked on both sides; `self` = the object that owns the rule. `result` goes into your hand |

E priority on the aimed-at object: **combine** (held item) → **interact** → **readable** → **pickup**.
Item scripts live in `src/scripts/items/` (list each in `index.js`); the `ctx` API is in `src/scripts/api.js`.
| door, hide, anomaly | (later) |

## pools/*.json
`{ id, rolls?: 1, entries: [ { def: id|null, w: >0, minDepth?, maxDepth?, zones?, unique?, minStage? } | { pool: id, w } ] }`
Chance of an entry = `w / sum(w of eligible entries)`. `null` def = nothing spawns. Check odds with `node tools/pool-sim.mjs <pool_id>`.

`minStage` (0..3) gates an entry on the Tenant's **story stage** (PLAN §6.1: 0 Rumour, 1 Noticed, 2 Followed,
3 Hunted), like `minDepth` gates on depth. The stage is read when a room is built, so rooms already built keep
their rolls. To make something *more common* from a stage, add a second entry for the same `def` with
`minStage` (stage-0 odds stay exactly as they were); to make it *appear* from a stage, put `minStage` on its only
entry. Used now: stage 1 adds `soda_can` / `glass_bottle` / `blank_tape` (sound lures) to room pools; stage 2 raises
`music_box` / `glow_stick` / `spare_tube` (light) and brings `flash_camera` into room pools. Only the world
spawner passes the stage today: container, vending, spill and power-loot rolls treat every entry as stage 0.

## notes/*.json
`{ id, title, text, spine?: n }`. Notes with `spine` (1..12, no gaps) are the story, always read in order
(`note_spine` shows the next unread one). The rest are random fragments (`note_random`). Keep them short: 1–4 sentences.
A fragment can also be placed by id (`readable.textId: "<note id>"`), e.g. `note_chair_wheel` → `frag_spinning_man`, the note a secret gives.

## sounds/*.json
Procedural Web Audio presets referenced by `sound.preset`. Format documented in `src/audio/presets.md`.

## secrets/*.json
Discoverable interactions, written as data (runtime: `src/secrets/`, API `game.secrets`; see CONTRACTS.md).
```json
{ "id": "spinning_man", "title": "The spinning man", "hint": "Some chairs don't like each other.",
  "order": 1, "once": true,
  "trigger": { "event": "prop:collide", "where": { "a.id": "office_chair", "b.id": "office_chair", "speed": { "min": 1.1 } } },
  "script": "secret_spinning_man", "params": { "note": "frag_spinning_man" } }
```
| field | notes |
|---|---|
| title | shown once found (the notebook shows "? ? ?" until then) |
| hint? | optional cryptic line shown while unfound |
| order? | list order (then id) |
| once | `true`: fires at most once per run (found secrets stay found across runs, but replay their reward in a new run) |
| trigger.event | a game event: `prop:collide`, `prop:topple`, `prop:carry`, `prop:shatter`, `item:pickup`/`drop`/`use`/`throw`/`combine`, `readable:open`, `note:collected`, `power:switch`/`fuse`/`tube`, `light:candle`, `light:timed`, `aura:start`, `camera:flash`, `world:noise`, `flashlight:change`, `phone:answer`, or `tick` (the secrets runtime polls 4×/s; use with `$hold`) |
| trigger.where | the matcher, below. Every entry must pass |
| script | an item script (`src/scripts/items/`), run with `self` = the event's subject (`a` / `inst`) and `params` = these params + `{ event, secretId }`. The secret is marked found when it returns ok |
| params? | free data for the script |

**Matcher** (`src/secrets/matcher.js`). A plain key is a dotted path into the event payload (`"a.id"`, `"inst.id"`, `"speed"`, `"on"`); its test is a value (equal), an array (any of) or `{ min, max, in, not, has, exists }`. Special keys:
| key | test |
|---|---|
| `$light` | `{ min?, max? }` world light 0..1 at the event's position (else the player's); the torch doesn't count |
| `$torch` | `true` / `false`: torch on / off |
| `$room` | `{ tags?: [...], key? }` the room at the event's position (tags: any of) |
| `$stage` | `{ min?, max? }` story stage: spine notes collected (or `game.stage` if set) |
| `$held` | item id, array of ids, or `null` (empty hand) |
| `$recent` | `{ event, within: s, where?, sameRoom? }` that event happened in the last `within` seconds (matching `where`; `sameRoom`: in the room you're standing in now) |
| `$count` | `{ n, within: s }` the rest must match `n` times inside the window |
| `$hold` | seconds: (on `tick`) the rest must stay true this long without a break |

`npm run validate` checks the script exists, the event is known, and the special keys are well formed.


### Note flags
`"hidden": true` on a note keeps it out of random `note_random` picks: it can only be obtained from its own source (e.g. a secret's reward).
