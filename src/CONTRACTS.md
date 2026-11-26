# System contracts

How the systems talk to each other. Several work streams build against this at the same time,
so **change it only deliberately** and note the change in your commit.

## The `game` object (built in `src/main.js`)
| field | type | owner | notes |
|---|---|---|---|
| `cfg`, `content` | config + all content JSON | main | `content.objects`, `content.pools`, `content.sounds`, `content.notes` (M4) |
| `seed` | u32 | main | run seed |
| `canvas`, `renderer` (PS1Renderer), `scene`, `camera` | | main | world camera; view-model uses its own scene/camera (M5) |
| `textures` | TextureBank | main | `get(name)`, supports `proc:*` |
| `input` | Input | main | `held(action)`, `wasPressed(action)`, `lookDX/DY`, `locked`, `mode` |
| `events` | Events | main | `on(name, fn) → unsubscribe`, `emit(name, payload)` |
| `synth` | Synth | audio | `play(presetId, {position, volume, loop}) → handle`, `has(id)` |
| `world` | World | world (M3) | see below |
| `player` | Player | player | `pos` (feet, Vector3), `yaw`, `pitch`, `eye`, `speedNow`; camera follows it |
| `playing` | bool | main | false on title / pause |
| `time` | seconds | main | |
| `focus` | `{ inst, distance } \| null` | main | aimed-at interactable this frame (cylinder pick, highlighted) |
| `stats` | `{ sanity 0..1, stamina 0..1, steps }` | M5 vitals updates sanity/stamina; main counts steps | |
| `flashlight` | `{ on, battery 0..1, toggle(), recharge(amount) }` | M5 (replaces main's minimal one, same fields) | main feeds `on`/`battery` into the shader |
| `inventory` | Inventory | M4 | see below |
| `gameplay` | Gameplay | M4 | see "Gameplay (M4)" below |
| `paused` | bool | M5 sets while the notebook settings page is open (M6) | |
| `diegetic` | read-only state | M5 | `notebookOpen`, `pocketsOpen`, `inspecting`, `reading`, `bpm`, `map` (SeenMap: `toJSON()/fromJSON()` for saves), `notebook`, `vitals` |

## Renderer overlays (M5)
- `renderer.addOverlay(scene, camera) → { visible, remove() }`: drawn every `render()` into the same
  low-res target after the world, with depth cleared first, then dithered by the post pass. M5
  registers the view-model scene (hands, torch, held item, watch, notebook, pockets) here.
- `renderer.render(scene, camera, time, overlays?)`: optional extra overlays for one call.
- `renderer.postUniforms`: post-pass uniforms; M5 vitals drives `uGrain` and `uDistort` (0..1 VHS
  wobble + chroma split at low sanity). `renderer.lowRes` is the target size.
- Text is **not** rendered through the PS1 pass: `renderDiegetic()` draws tags, captions, pocket
  labels and notebook writing on a 2D canvas layer over the game canvas. Its look is the
  `ui.textGrit` dial (0 crisp .. 1 PS1 crunch); `setTextGrit(v)` (exported from
  `src/ui/diegetic/index.js`) changes it live, for the M6 settings page.

## Input gating (M5)
M5 wraps the `game.input` instance (not `core/input.js`): while the notebook / an inspected paper is
up, `held()`/`wasPressed()` return false for movement, `interact`, `use`, `drop`; while the pockets view
is open, mouse look reads 0 and `use`/`drop`/`left`/`right` drive the pocket cursor; when exhausted,
`sprint` reads false. M5 also sets `game.gameplay.inputBlocked` in those modes.

## World (M3) — what other systems may call
- `world.isSolidAt(x, z)` → bool (cell walls; props not included)
- `world.wallBetween(a, b)` → bool
- `world.colliders` → `[{minX,maxX,minZ,maxZ,inst}]`
- `world.objects` (ObjectSystem): `spawn(id, pos, rotY, meta) → inst`, `remove(inst)`, `buildMesh(def) → THREE.Group`, `instances`, `defs`
- `world.roomAt(x, z)` → placed room `{ key, json, ... } | null`
- `world.run` → `{ spawnedUnique: Set, taken: Set<spotKey> }` (add an inst's `meta.spotKey` to `taken` when it's picked up so it never respawns)
  - M4 adds (created lazily by `game.gameplay`, M3 streams them, M8 saves them):
    - `taken` may also hold `"<roomKey>#<i>"` for a **fixed** room object (index `i` in `room.objects`) that was removed for good; the spawner should skip those too.
    - `placed: Map<placedKey, { id, pos:[x,y,z], rotY, state, roomKey }>`: things the player put in the world (dropped items, chalk marks). When a room streams in, spawn each entry whose `roomKey` matches with `objects.spawn(id, pos, rotY, { roomKey, placedKey })` and set `inst.state = entry.state`. When it streams out just remove the insts; the map keeps them. Entries are deleted when the thing is picked up.
    - `objState: Map<stableKey, state>`: per-run state of world objects that scripts touched (fuse box powered, phone answered). `game.gameplay.stateOf(inst)` rehydrates it lazily; keys are `placedKey`, `"<spotKey>:<id>"` or `"<roomKey>#<i>"`.
    - `scriptState: {}`: per-run scratch shared by scripts (`ctx.state.run`).

## Object instance (`inst`)
`{ uid, id, def, name, root (THREE.Group), meta {roomKey, spotKey?}, state {}, interactive, center, radius, readable? }`

## Inventory (M4)
```
game.inventory = {
  size: 4,
  slots: [ItemStack|null × 4],     // ItemStack = { id, def, state: {}, slot }
  selected: 0..3,
  held: ItemStack|null,            // slots[selected]
  add(id, state?) → bool,          // false when full
  remove(index) → ItemStack|null,
  find(id) → { index, stack } | null,
  select(index),
}
```
Extras (additive): `add(id, state, { index?, select? })`, `step(±1)` (wheel, wraps), `indexOf(stack)`,
`freeIndexFor(id, prefer?)`, `canAdd(id)`, `changed()` (re-emit after mutating a stack's state), `serialize()`.
A `pickup.size: 2` item puts the **same** stack object in two neighbouring slots; `stack.slot` is the first.

## Gameplay (M4)
`game.gameplay` — what M5 (and later systems) may call:
- `combineSlots(a, b) → bool` — item + item from the pockets view; `b` may be `"flashlight"` (the torch has no pocket).
- `verbFor(inst = game.focus?.inst) → { verb, kind: 'combine'|'interact'|'readable'|'pickup' } | null` — label for the hand's verb tag.
- `interact(inst?)`, `use()`, `drop()`, `pickup(inst)` — the same verbs E / Mouse0·R / G trigger.
- `inputBlocked` (bool) — set true while the pockets view / notebook owns the keys; M4 then ignores slot/E/use/drop. `game.paused` does the same and also freezes script timers.
- `runScript(id, { self, other?, params? })`, `stateOf(inst|stack)`, `notesCollected: Set<noteId>`, `noteOf(inst|stack)`.

## Events
| name | payload | emitted by |
|---|---|---|
| `game:start`, `game:resize` | `{}` | main |
| `player:step` | `{ intensity }` | main |
| `inventory:change` | `{ slots, selected }` | M4 |
| `inventory:full` | `{ id }` | M4 (M5 shakes the hand) |
| `item:pickup` / `item:drop` / `item:use` | `{ id, stack }` | M4 |
| `item:combine` | `{ a, b, result? }` (ids; `a` = the held item) | M4 |
| `readable:open` | `{ inst?, title, text, display: "notebook"\|"inspect"\|"surface", noteId? }` | M4 (M5 presents it) |
| `note:collected` | `{ noteId, title, text }` | M4 (M5 adds a notebook page) |
| `ui:caption` | `{ text, seconds, key? }` (same `key` replaces the previous caption) | anyone (M5 shows sound captions/prompts when accessibility allows) |
| `ui:captionClear` | `{ key }` | anyone (removes a keyed caption) |
| `ui:watchBeep` | `{ text? }` | anyone (M5 watch) |
| `flashlight:change` | `{ on, battery }` | M5 (on toggle, recharge, and when an LED goes out at 66/33/5 %) |

## Item scripts (M4)
`src/scripts/items/<id>.js` default-exports `{ id, run(ctx, params) }`, registered by listing it in
`src/scripts/items/index.js` (esbuild can't glob; `npm run validate` errors on an unlisted file or an unknown script id).
`run` returns `ctx.ok({ consume? })` or `ctx.fail(message)` (shows the message as a caption).
`ctx` gives scripts a safe API (player, inventory, world spawn/remove, sound, ui via events, stats,
flashlight, rng, state, timer, self, params) — see `src/scripts/api.js`.
