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
| `input` | Input | main | `held(action)`, `wasPressed(action)`, `lookDX/DY` (already × `sensitivity`, Y flipped by `invertY`), `locked`, `mode`, `captureSuspended` (canvas clicks don't re-lock while a menu owns the cursor) |
| `events` | Events | main | `on(name, fn) → unsubscribe`, `emit(name, payload)` |
| `synth` | Synth | audio | `play(presetId, {position, volume, loop, delay, occlude}) → handle`, `has(id)`; see "Ambience" for the env bus, acoustics and occlusion |
| `ambience` | AmbienceSystem | ambience | environmental audio (bound on the first gameplay frame); `debugLines()` |
| `audioDirector` | AudioDirector | ambience | distant-event pacing: `intensity` 0..1 (the Tenant director raises it), `trigger(kind?)`, `next`, `last` |
| `world` | World | world (M3) | see below |
| `player` | Player | player | `pos` (feet, Vector3), `yaw`, `pitch`, `eye`, `speedNow`; camera follows it |
| `playing` | bool | main | false on title / pause |
| `time` | seconds | main | play time: advances only while not `paused` (the renderer's grain still uses wall time) |
| `focus` | `{ inst, distance } \| null` | main | aimed-at interactable this frame (cylinder pick, highlighted) |
| `stats` | `{ sanity 0..1, stamina 0..1, steps }` | M5 vitals updates sanity/stamina; main counts steps | |
| `flashlight` | `{ on, battery 0..1, toggle(), recharge(amount) }` | M5 (replaces main's minimal one, same fields) | main feeds `on`/`battery` into the shader |
| `inventory` | Inventory | M4 | see below |
| `gameplay` | Gameplay | M4 | see "Gameplay (M4)" below |
| `fullscreen` | `{ on, enter(), exit(), error? }` | main | enter() only works inside a real input event |
| `paused` | bool | main | true while paused (Esc). `playing` is false then too. Scripts, gameplay, physics, power clock and `game.time` stop; the notebook is open at Settings with a free cursor |
| `pause()`, `resume()` | fn | main | `pause()` → `game:pause`. `resume()` re-requests pointer lock, then fullscreen (if the setting is on), then emits `game:resume`; **call it only inside a real click/keydown handler** |
| `settings` | object | settings (`src/settings/`) | live persisted settings, see "Settings" below |
| `secrets` | `{ list(), count() }` \| undefined | secrets system | optional; read by the notebook's Secrets section, see "Notebook hub" |
| `diegetic` | read-only state | M5 | `notebookOpen`, `section` (open section id or null), `pocketsOpen`, `inspecting`, `reading`, `bpm`, `map` (SeenMap: `toJSON()/fromJSON()` for saves), `notebook`, `menu`, `vitals` |

## Settings (`src/settings/`)
`game.settings` is installed in main before gameplay/diegetic. Plain data fields plus non-enumerable
`set(key, value)` (coerces + clamps, applies, emits `settings:change { key, value, settings }`, saves),
`status` (`ok`|`default`|`migrated`|`newer`|`corrupt`|`blocked`), `persisted` (false when storage is blocked
or a newer build wrote it), `defaults`, `save()`. Stored in `localStorage['the-hum.settings.v1']` as
`{ version: 1, values }`; every storage access is try/caught and the game runs on defaults without it.
| key | type / range | applied to |
|---|---|---|
| `mouseSensitivity` | 0.25..3 (× `config.player.mouseSensitivity`, log slider) | `input.sensitivity` |
| `invertY` | bool | `input.invertY` |
| `masterVolume`, `ambienceVolume` | 0..1 | `synth.setVolume('master'|'ambience', v)` (gain = v²) |
| `effectsVolume` | 0..1 | `synth.setVolume('sfx', v)` and `('tenant', min(1, 1.25 v))` |
| `textScale` | 0.8..1.5 | `cfg.ui.textScale` (tags, captions, the notebook's notes/secret lists) |
| `textGrit` | 0..1 | `cfg.ui.textGrit` + `setTextGrit` |
| `captions`, `textPrompts`, `reduceFlashing` | bool | `cfg.ui.*` (read live by their systems) |
| `calm` | bool | **read by the Tenant**: "the Tenant keeps its distance" |
| `fullscreen` | bool | whether main enters fullscreen on start / resume; the Enter key and the Settings tick update it |

## Notebook hub (M5/M6: `src/ui/diegetic/menu.js`, `hub.js`, `keys.js`)
The notebook is a two-page spread and the game's menu. Sections, in page order, as paper index tabs:
`settings` · `controls` · `map` · `notes` · `photos` · `wanderers` · `secrets`.
- **Keys** (handled in DOM key/mouse handlers, so pointer lock / fullscreen work): Tab/M open or close at the
  last section viewed (default Map) **without pausing**; Esc pauses and opens Settings (main: lock lost →
  `pause()`; click-drag mode: Esc keydown). In the book: A/D ←/→ turn pages (multi-page sections page within
  themselves first), W/S ↑/↓ pick a row, E/Enter act; a slider row is *held* with E/Enter and then A/D move it.
  Tab while paused flips to Map; Esc while open unpaused closes it. Mouse (free cursor): tabs, rows, ticks,
  slider drag, click a page's outer edge to turn. `input.captureSuspended` is set while the cursor serves the menu.
- **Routing** `addPage({ kind })`: `map`/`mapReveal` → Map, `photo` → Photos, `wanderer` → Wanderers,
  `note` → Notes, `learned` → Notes ("what I've learned" block at the top; `{ id, text }`), `secret` → Secrets
  (`{ id, title, text }` shown as found), anything else → Notes (scraps). `addNote` / `addPage` return the entry
  index (deduped by id) and `notebook.open(index)` opens its section and page; `notebook.pages` is the entry list.
- **Notes**: spine notes numbered with progress (`7 / 12 pages`, unfound = blank lines, numbering from
  `content.notes[].spine`), then "scraps"; the selected note is read full-size on the facing page.
- **Secrets** ("oddities N / M"): reads `game.secrets.list() → [{ id, title, hint, found, foundAt? }]` (stable
  order; `game.secrets` may be missing). Found: title + hint line. Unfound: "? ? ?" with a scribbled-out bar,
  plus the hint only if non-empty; the title is never drawn. On `secret:found { id, title }` a caption
  "(something written in the back of the notebook)" shows.

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

### World extension points (feature systems)
- `world.addSystem({ update?(dt, ctx, world), onRoomPlaced?(placed, world), onRoomDropped?(placed, world) })` — per-frame hook + room streaming hooks. `world.roomAt` already finds the room inside `onRoomPlaced`. `placed = { key, entry, json, built, origin, depth, objects }`.
- `world.noise(pos, loudness, source)` — a sound others can hear; `loudness` ≈ hearing radius in metres (footstep 3–8, clatter 10, bell 18, boombox 25). Emits `world:noise` `{x,y,z,loudness,source,t}`; recent ones in `world.noises`. Footsteps already report.
- `registerPrefabs(map)` (`src/objects/prefabs.js`) and `registerPainters(map)` (`src/objects/procTextures.js`) — add prefabs / `proc:` textures from your own module, imported for side effects in `src/extensions.js`.

### Power network & light (`src/power/`, `world.power`)
Light is safety: the Tenant avoids lit space, sanity recovers under working lights.
- `world.lightAt(pos, { occlude = true }?) → 0..1`: how lit a point is from world lights (fixtures,
  object `light` components, candles, timed lights) with the shader's falloff; walls occlude. Not the
  flashlight (check `shared.uFlash*` / `world.power.flashOn(p)` for that). ≈0.7 under a working
  tube, ≈0.25 at 5 m, < 0.1 in a dead patch. Vitals uses it (`vitals.lightThreshold` 0.18).
- `world.auras → [{ id, pos, radius, kind: 'calm', until, follow?, roomKey? }]` (until = power-clock s);
  `world.auraAt(pos, kind?)`. A wound music box makes a 5 m calm aura for 30 s: no sanity drain;
  the Tenant should stay out.
- **Fixtures**: `placed.built.lights[i]` = `{ pos, idx, cell, fixture ('light'|'dead'|'flicker' as
  designed), cond ('on'|'flicker'|'dead'), circuit, out 0..1, color, range }`. Legend kinds `light`
  (rolled), `deadlight` (core char `x`), `flickerlight` (core char `f`): all walkable floor.
  Rolls are seeded per fixture with value-noise dark patches (`config.power`); rooms within
  `safeDepth` blocks of the origin roll nothing. A room JSON may set `power: { dead, flicker }`.
  The ceiling texture follows `out` through a per-vertex `aLit` attribute (one shared material).
- **Circuits**: one per 8×8 block of a room, `{ powered, on }`. A room with an unpowered `fuse_box`
  starts unpowered. Fuse in → all its circuits powered, every dead tube in the room and its
  neighbours stutters on (~1 s). A wall switch toggles the room's circuits.
- **Actions** (`getPower()` from `src/power/network.js`, or `world.power`): `fuseInserted(pos)`,
  `toggleSwitch(pos, circuit?)`, `switchOn(pos)`, `installTube(lightFixtureInst)`,
  `strikeMatch(pos, {duration, radius})`, `lightCandle(inst)`, `windMusicBox(state, inst|null, pos)`,
  `expiresIn(sec)` (for `state.expiresAt` on placed timed objects), `timed.addLight/addAura`.
- **Timed effects** run on the power clock: it only advances between `game:start` and `game:pause`
  (resumes on `game:resume`). Anything placed with `state.expiresAt` is removed for good when due.
- **Persistence**: `world.run.power = { clock, rooms: { [roomKey]: { circuits, fixtures, revive? } },
  lights, auras, seq }` (plain JSON), restored in `onRoomPlaced`.
- Each room may also get seeded extras (spot keys `<roomKey>/power_loot|power_switch|power_writing`):
  a `power_room_loot` roll, a wall `light_switch`, `dark_writing`/`dark_arrow`. Chances in
  `config.power` (`lootChance`, `switchChance`, `writingChance`; 0 turns one off).
- Dead fixtures get an invisible `light_fixture` interactable just under the ceiling (E with a
  `spare_tube` = install; `use` on a held tube also finds the fixture you look up at).
### Physics (src/physics/)
- `world.physics` — the PhysicsSystem, created on first gameplay input by `physicsOf(gp)` (`src/physics/hooks.js`; null in Node tests). Registered with `world.addSystem`.
  - `resolvePlayer(pos, r, vel, push)` — called by `Player.move`: pushes dynamic bodies, then steps the player out of them. Static colliders still block in `Player.move`.
  - `carried` (inst held in front, or null), `verbFor(inst)`, `interact(inst)`, `handleInput(gp)` — hooks used by `src/interaction/interaction.js`.
  - `startCarry(inst)`, `putDown()`, `throwCarried()`, `throwHeld()`, `shove(inst)`, `startTopple(inst, dirX, dirZ)`.
- **`physics` component** (object JSON; schema + validation in `src/physics/schema.js`, checked by `npm run validate`):
  `{ mode: "static"|"push"|"carry"|"throw", shape?: "box"|"circle", radius?, mass?, friction? (1/s), stop? (m/s² brake), restitution?, spin? (0..1), straight? (wheels), topple? (impact m/s), spill? (pool id, once on topple), shatter? { speed, into, noise? }, noise? (m), throwSpeed?, sound? { roll, impact, topple, land, break } }`.
  Every non-static mode is a pushable floor body; `carry` adds E to hold it; `throw` (with `pickup`) lets the pocket item be thrown. List `collider` before `physics` in the JSON (physics makes its own collider if there is none).
- `world.objects.bodies: Set<inst>` — instances with a dynamic body. `inst.body` = the 2D body (`src/physics/sim.js`: `x, z, a, vx, vz, w, y, vy, airborne, sleeping, moved, carried`), `inst.physics` = the filled-in component config. A dynamic body's `inst.collider` carries `body` and is kept in step every frame (so pick, highlight and player collision stay right); `inst.center` too.
- `world.run.bodies: Map<stableKey, { x, z, a, toppled? }>` — root pose of props the player moved, saved when they settle or their room streams out, restored in `onRoomPlaced`. Same keys as `gameplay.stableKey`. A prop that comes to rest in another room, or is carried, leaves its spawn spot (marked `taken`) and becomes a `run.placed` entry of the room it ends up in.
- Keys: `throw` (Mouse2 / T) throws the carried prop or a held `throw`-mode pocket item; `physicsDebug` (F6, dev builds) draws noise rings and body outlines. Tunables: `config.physics`.
- `verbFor` kinds added: `push` (only while touching), `carry`, `putdown` (while carrying; has `alt: { verb: 'throw', key }`). The hand tag's key is still E, so carry also shows a keyed `ui:caption` (`physics:prompt`) with the throw key.
- Noise sources: `impact:<id>`, `topple:<id>`, `roll:<id>` (soft, while rolling), `place:<id>`, `shatter:<id>`.

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
| `game:start`, `game:resize`, `game:pause`, `game:resume` | `{}` | main (pause → the notebook opens at Settings; resume closes it) |
| `settings:change` | `{ key, value, settings }` | settings (`game.settings.set`) |
| `secret:found` | `{ id, title }` | secrets system (the notebook captions it) |
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
| `world:noise` | `{ x, y, z, loudness, source, t }` | world.noise() |
| `item:throw` | `{ id, stack?, inst }` | physics (a pocket item or the carried prop was thrown) |
| `prop:carry` | `{ inst }` | physics |
| `prop:topple` | `{ inst, dir }` | physics |
| `prop:shatter` | `{ id, x, z }` | physics (the inst is gone; its `shatter.into` decal is spawned) |
| `camera:flash` | `{ pos: {x,y,z}, dir: {x,y,z} }` | flash camera (src/story/camera.js), for the Tenant |
| `flashlight:change` | `{ on, battery }` | M5 (on toggle, recharge, and when an LED goes out at 66/33/5 %) |
| `power:fuse` | `{ roomKey, rooms: [roomKey], revived }` | power (a fuse went in; `rooms` = the room + neighbours) |
| `power:switch` | `{ roomKey, on }` | power (wall switch flipped) |
| `power:tube` | `{ roomKey, idx }` | power (spare tube installed in fixture `idx`) |
| `light:timed` | `{ kind: 'match', light }` | power |
| `light:candle` | `{ inst }` | power (a candle was lit) |
| `light:expired` | `{ id }` | power (a timed placed light, e.g. a glow marker, burned out) |
| `aura:start` / `aura:end` | `{ aura }` | power (music box) |

## Item scripts (M4)
`src/scripts/items/<id>.js` default-exports `{ id, run(ctx, params) }`, registered by listing it in
`src/scripts/items/index.js` (esbuild can't glob; `npm run validate` errors on an unlisted file or an unknown script id).
`run` returns `ctx.ok({ consume? })` or `ctx.fail(message)` (shows the message as a caption).
`ctx` gives scripts a safe API (player, inventory, world spawn/remove, sound, ui via events, stats,
flashlight, rng, state, timer, self, params) — see `src/scripts/api.js`.

## Containers + story props (src/containers, src/story)
Registered from `src/story/register.js` (one line in `src/extensions.js`).
- **Binding.** Extension modules can't see `game` at import time, so register.js wraps
  `Gameplay.prototype.update` to call `bindStory(gp)` on the first gameplay frame. After that the story
  runtime (`src/story/runtime.js`) runs as a `world.addSystem` system: `onReady(fn(game))`,
  `onUpdate(fn(dt, game, ctx))`, `onInstance(id, fn(inst, game))` (once per spawned/streamed instance).
- **`container` component** (`src/containers/component.js`, rules in `logic.js`), added to the engine's
  component table at load. `{ compartments: [{ pool, name? }], stuckChance?, drawers? }` or
  `{ vend: { pool, wrongPool?, eatChance?, wrongChance? }, tray?: [x,y,z] }`. Each compartment rolls its pool
  once per run, seeded `hash(seed, 'container', stableKey, i)`; state (`opened`, `rolled`, `rattles`, `coins`)
  lives in `gameplay.stateOf(inst)` so it persists per run. Opened with the `container_open` interact script;
  vending with a `{ with: "coin", script: "vend_coin", consume: "other" }` combine rule.
- **`game.dangerLevel`** 0..1 (default 0, set at bind). The Tenant should set it; the walkie static reads it.
- **Run state** (`world.run.scriptState` = `ctx.state.run`) keys: `badges: Set<badgeId>` +
  `badgeInfo[badgeId] = { name, role, clearance }` (for keycard doors), `threads: [{ id, pts: [[x,z]], len, open }]`
  (red string), `photos` (count), `typewriterLine`, `walkieHint`, `threadSeq`.
- **Notebook** (`game.diegetic.notebook`; sections in "Notebook hub"): `addPage({ kind: 'photo'|'wanderer'|'mapReveal'|'learned'|'secret', id, title, caption, ... })`
  → page index (deduped by id). Open a page with `readable:open { display: 'notebook', noteId: <page id> }`.
- **Auto-map** (`game.diegetic.map`): `reveal(cells [[cx,cz,v]], { id, cx, cz, lie })`, `contradictions()`,
  `drawReveal(...)`, `revealsJSON()` (saves; `toJSON()` is unchanged).
- **Post pass**: `renderer.postUniforms.uFlash` 0..1 white pop.
- **Script ctx additions** (`src/scripts/api.js`): `ctx.seed`, `ctx.content`, `ctx.emit(name, payload)`,
  `ctx.inventory.freeIndexFor(id, prefer)`, `ctx.world.keyOf(inst)`, `ctx.world.noise(pos, loudness, source)`,
  `ctx.world.depthAt(x, z)`.
- **Content kind `lines`**: `content/lines/<id>.json` = `{ id, note?, lines: string[] }` (typewriter story,
  walkie hints, wanderer names/roles, photo writing), read as `ctx.content.lines[id].lines`. Validated.

## Ambience: environmental + spatial audio (src/ambience)
Registered from `src/ambience/register.js` (one line in `src/extensions.js`); binds on the first gameplay
frame like the story runtime and runs as a `world.addSystem` system. Tunables: `config.audio`.
- **Env bus.** `BUSES` gained `env` (presets may use `"bus": "env"`). It feeds the ambience bus, so the
  ambience slider covers it; its own gain is `config.audio.env` × duck × pause, set with
  `synth.setBusGain('env', gain, tau)`. Ducked by `duckDb` while `diegetic.reading`/`notebookOpen` or while a
  preset in `duckPresets` (default `sting_low`) plays; faded to `pausedLevel` while `game.paused` / not playing.
- **Hum.** The old global `synth.startHum()` is off (`new Synth({ hum: false })` in main). `humEmitters` looping
  `fluoro_hum_unit` voices are pooled and re-assigned (≈5×/s) to the nearest fixtures that are not dead and whose
  circuit is powered and on; each follows its fixture's `out` every frame, so flicker, stutter, fuses and
  switches are heard in sync. Failing/stuttering tubes play `flicker_crackle` on dropout edges. `power:switch`
  plays `hum_kill`/`hum_surge`, `power:fuse` plays `hum_surge` at the room's nearest fixture. A head-locked
  `room_tone` loop is always under it.
- **Acoustics.** When the listener enters a new cell (≤ 4×/s) a flood fill of walkable cells within
  `acousticsRadius` m estimates size / elongation / width → weights for three generated impulses
  (`ROOM_IMPULSES` in `src/audio/synth.js`: small, hall, corridor) and per-bus send scales:
  `synth.setAcoustics(weights, { sfx, env, tenant, ambience }, fadeSec)`. Idle impulses are disconnected.
- **Occlusion.** Positioned spatial voices now run `out → lowpass → gain → panner` (`play(..., { occlude: false })`
  opts out); `voice.setOcclusion(cutoffHz, gain, tau)`. The ambience system sets every new voice at once (via
  `synth.playHooks`) and then `occlusion.perFrame` voices a frame round-robin: solid cells crossed on the
  straight line (unbuilt space counts), softened when the flood fill shows a short detour.
- **Emitters.** `onRoomPlaced` adds pooled records for fixtures, leaks (`decor_leak`, `decor_ceiling_stain`,
  `decor_water_stain`: `drip` at irregular seeded intervals, nearest `dripEmitters`) and vents (rooms with a
  `*vent*` ceiling texture, else a seeded `ventsPerRoom` few: nearest `ventEmitters` play `vent_drone`);
  `onRoomDropped` releases them.
- **Distant events** (`game.audioDirector`): seeded, rare (`distantMaxGap` s apart at intensity 0, `distantMinGap`
  at 1), never the same twice running: `far_thud`, `far_door`, `far_phone`, `far_chair`, and footsteps
  (`far_step`) that take a few steps, then answer the player's `player:step`s and stop when they stop. Placed
  `distantDistance` m away, preferring unloaded space and directions with walls between; occluded like any voice.
  They are not `world.noise` (the Tenant doesn't hear them).
- **Debug.** Dev builds: F7 toggles an overlay (emitters, acoustics, occlusion per voice, env gain, peak into
  the soft-clipper from `synth.meterPeak()`).
