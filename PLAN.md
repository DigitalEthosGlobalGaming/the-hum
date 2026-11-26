# THE HUM: Game Design Doc (v4, agreed)

A first-person **psychological horror exploration game** in an endless, procedurally generated liminal maze. It has a PS1 look and is delivered as **one self-contained HTML file under 10 MB** for a SharePoint page.

> **v3 changes:** the game is now **data-driven**. A small set of core systems (engine) reads **JSON content** (rooms, objects, items, spawn pools) and a folder of **item scripts**. The world is split into **rooms** using Noita-style **herringbone Wang tiles** solved with WFC, so it doesn't read as a giant grid. Adds a 4-slot inventory, item combining and weighted spawn pools.
> All design questions were settled in the grilling session (see §13 Decisions log).

---

## 1. Pitch

You no-clip out of reality into a buzzing, endless office space that keeps going in every direction. You have no weapons, no map and no HUD. You carry what you can hold in four pockets, a cheap digital watch and a notebook. There are no levels and no loading. The building just *changes* the further you walk: yellow wallpaper becomes blue offices, then flooded pool halls, then rusted maintenance tunnels. Something called **the Tenant** lives in the walls. It moves only when you aren't looking.

**Pillars**
1. **Exploration first.** The reward is what's in the next room.
2. **Dread over jump scares.** Psychological only, with no gore.
3. **Everything lives in the world.** Diegetic UI.
4. **Authentic PS1 crunch.**
5. **Endless and seamless.**
6. **Content is data.** A new room, object or item is a JSON file, not an engine change.

---

## 2. Architecture: core systems + content

```
┌──────────────────────── CONTENT (data, easy to add) ───────────────────────┐
│ content/rooms/*.json     content/objects/*.json    content/pools/*.json    │
│ content/zones/*.json     content/notes/*.json      content/sounds/*.json   │
│ src/scripts/items/*.js   (named custom behaviours, registered by id)       │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │ validated + bundled at build time (build.mjs)
┌───────────────▼──────────────── CORE SYSTEMS (engine) ─────────────────────┐
│ World Layout   herringbone slots + WFC picks room templates per slot       │
│ Room Builder   room JSON → meshes, colliders, lights; local→world transform│
│ Spawner        rolls spots against weighted pools (seeded)                 │
│ Object System  instantiates object defs; component → behaviour             │
│ Interaction    raycast, verbs (read / use / pick up / combine / script)    │
│ Inventory      4 slots, held item, combine rules                           │
│ Script Runner  calls item scripts with a safe context API                  │
│ Audio, Render (PS1), Tenant AI, Player, Diegetic UI, Save                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Rules of the split**
- The engine never mentions a specific room or item by name. It only knows *component types* and *script ids*.
- Everything that varies goes in JSON. Anything that truly needs logic goes in a small script under `src/scripts/items/` and is referenced from JSON by id.
- **Build-time validation** catches content mistakes before they ship. Examples: an unknown object id, a pool with zero total weight, a door that leads nowhere, a missing script, or a room whose edges don't fit the slot shape.

---

## 3. World layout: rooms, herringbone and WFC *(skills: procedural-gen, level-design)*

### 3.1 Why not a plain grid
A square grid of square rooms reads as a grid within a minute. **Noita** avoids this with **herringbone Wang tiles** (Sean Barrett's technique, used per biome). Room templates are rectangles in a 2:1 ratio, laid in a staggered brick pattern. Each template's edges carry connector "colours", and neighbours must match. The stagger means no long seams line up, so the world reads as organic. Noita's templates also contain **marked spawn spots**, which is exactly the role of our room `spots`.

### 3.2 Three scales
| Scale | Unit | What decides it |
|---|---|---|
| **Slot** | A herringbone rectangle: **2×1 blocks**, horizontal or vertical. 1 block = 8×8 cells = 16 m | The fixed herringbone pattern (pure maths, infinite) |
| **Room** | A JSON template that fills one slot (or several merged slots for big rooms) | **WFC** over slots, matching edge connectors |
| **Cell** | 2 m × 2 m inside a room: wall, floor, door, water, pillar… | The room's authored layout |

### 3.3 Edge connectors (the WFC sockets)
- Each slot edge is split into **segments** of one block width (a horizontal 2×1 slot has 6 segments: 2 north, 2 south, 1 east, 1 west).
- Each segment has a **connector type**: `wall`, `door`, `open`, `wide` (full-width opening), `vent`, and later others.
- Two neighbouring slots must use the **same connector** on a shared segment.
- **Order-independent and seamless:** the connector on every segment is decided first, by `hash(worldSeed, segmentX, segmentZ, zone)` using weights from the zone JSON. WFC then only has to pick, for each slot, a room template whose edges match the already-fixed connectors. Chunks don't depend on the direction you walked.

### 3.4 WFC's job
With the edges pre-hashed, a slot's choice is constrained only by its own edges. WFC then handles:
- **Multi-slot rooms** (big pool halls, long corridors) that claim neighbouring slots. These propagate constraints across slots, which is where real WFC collapse and propagation are needed.
- **Adjacency rules** on top of connectors, written as data. Examples: "no two `lit_room_alone` within 3 slots", "`office_*` prefers neighbours tagged `office`", "a `door_wood_boarded` room never next to a dead end".
- **Weighted choice:** each room's `weight` × zone multipliers. Lowest-entropy-first, seeded tie-breaks (procedural-gen gotchas).

### 3.5 Never stuck: coverage guarantee
- The build tool checks that **every connector combination a slot could get has at least one room** for that zone (a "complete Wang set", the article's no-contradiction property).
- **Runtime fallback:** if a combination is missing or a multi-slot claim fails, the **filler generator** builds a procedural room from cell-level rules that match any edge set. You never hit a wall of nothing.
- **Connectivity:** every slot must have at least 2 non-wall connectors, enforced at hash time. A seed sweep tool checks reachability over thousands of seeds.

### 3.6 Zones and depth (no levels)
- **Depth** = distance from your entry point. Zone = f(depth, low-frequency noise), so zones are irregular regions.
- A zone is a JSON file: textures, allowed rooms and weights, connector weights, light density, ambience, Tenant intensity, and battery scarcity.
- Zones: **Yellow Lobby**, **Blue Offices**, **Poolrooms**, **Maintenance**, and rare **Red Halls** (see §9 for textures).
- Zone borders force a `transition` connector, so a doorway, arch or emergency door marks the change.

### 3.7 "The building moves"
A slot that is far away and out of sight can be re-rolled with a salted seed. You come back and it's a different room, and your notebook map no longer matches. Used sparingly, and more often at depth or low sanity.

---

## 4. Content formats

All positions inside a room are **local** (metres from the room's origin corner, `y` up), and rotations are degrees around Y. The Room Builder transforms them: `world = slotOrigin + rotateY(local, slotRotation)`, and `worldRot = local.rot + slotRotation`. Vertical slots are horizontal templates rotated 90°, so you only author one orientation (a room can opt out with `"orientations": ["h"]`).

### 4.1 Room JSON
```jsonc
// content/rooms/lobby_pillar_hall.json
{
  "id": "lobby_pillar_hall",
  "zones": { "lobby": 10, "red_halls": 1 },      // weight per zone
  "tags": ["lobby", "open"],
  "slots": [2, 1],                               // blocks: 2×1 = one herringbone slot
  "edges": {                                     // one connector per edge segment
    "n": ["open", "wall"], "s": ["wall", "door"],
    "e": ["open"], "w": ["wide"]
  },
  "layout": [                                    // 16×8 cells; legend below
    "################",
    "#..............#",
    "#..P....P....P.#",
    "................",
    "#..P....P....P.#",
    "#..............#",
    "#..............#",
    "#######D########"
  ],
  "legend": { "#": "wall", ".": "floor", "P": "pillar", "D": "door" },
  "materials": { "wall": "wall_yellow_pattern", "floor": "carpet_green",
                 "ceiling": "ceiling_large", "pillar": "wall_yellow_small" },
  "lights": [ { "pos": [4, 3, 4], "type": "fluoro", "state": { "on": 80, "flicker": 15, "off": 5 } } ],
  "objects": [                                   // always placed
    { "def": "office_chair", "pos": [9.5, 0, 10.2], "rot": 200 }
  ],
  "spots": [                                     // rolled from a pool
    { "id": "corner", "pos": [1.2, 0, 1.2], "rot": 45, "pool": "lobby_floor_loot" },
    { "id": "desk_top", "pos": [20, 0.8, 6], "pool": [
        { "def": "note_random", "w": 5 },
        { "def": "battery",     "w": 1 },
        { "def": null,          "w": 14 }        // null = nothing spawns
    ]}
  ],
  "script": null                                 // optional room script id (e.g. "room_longer_corridor")
}
```
Layout strings let you sketch a room in a text editor. The legend is extendable per room (for example `"~": "water"`). Default materials come from the zone if a room doesn't override them.

### 4.2 Object definition JSON
An object = a **mesh** plus a list of **components**. Components are the "properties or different things on it" and can be combined freely.
```jsonc
// content/objects/old_phone.json
{
  "id": "old_phone",
  "name": "Desk phone",
  "mesh": { "type": "box", "size": [0.3, 0.12, 0.2], "texture": "metal_structure" },
  "components": {
    "collider":   { "shape": "box" },
    "sound":      { "preset": "phone_ring", "trigger": "proximity", "radius": 6, "once": true },
    "interact":   { "verb": "answer", "script": "phone_answer", "params": { "noteId": "spine_04" } }
  }
}
```
```jsonc
// content/objects/battery.json
{
  "id": "battery",
  "name": "AA battery",
  "mesh": { "type": "sprite", "texture": "item_battery" },
  "components": {
    "pickup":  {},
    "use":     { "script": "flashlight_recharge", "consume": true, "requiresHeld": "flashlight" },
    "combine": [ { "with": "flashlight", "script": "flashlight_recharge", "consume": "self" } ]
  }
}
```

**Component catalogue (v1)**
| Component | Fields | Does |
|---|---|---|
| `mesh` | `box` / `plane` / `sprite` / `prefab` (named built-in low-poly model), texture, tint | How it looks |
| `collider` | shape, solid | Blocks movement and line of sight |
| `readable` | `text` or `textId`, `display`: `"notebook"` (copied into the notebook) / `"inspect"` (held up close) / `"surface"` (writing on the object itself) | Read verb |
| `sound` | `preset` (procedural synth id), `trigger`: `ambient` / `proximity` / `interact` / `script`, `loop`, `radius`, `volume` | Plays a positional sound |
| `interact` | `verb` label, `script`, `params`, `once`, `cooldown` | Generic action → script |
| `pickup` | `size` (pocket slots, default 1), `heldPose` | Can go in the inventory |
| `use` | `script`, `params`, `consume`, `requiresHeld` | Used while held (left-click) |
| `combine` | list of `{ with, script, consume: self/other/both/none, result }` | Item + item, or item + world object |
| `light` | colour, intensity, range, `flicker` | Emits light (lamps, glowing things) |
| `door` | `locked`, `keyItem`, `opensTo` | Openable. Can be locked by an item |
| `hide` | capacity, exit | A hiding spot from the Tenant |
| `anomaly` | `script`, `when`: `unseen` / `seen` / `near` | Changes when you look away, look at it, or get close |

New components are an engine change (rare). New *objects* are only JSON.

### 4.3 Spawn pools: weighted rolls
The rule is exactly as you described: **chance = weight ÷ sum of all weights in that pool.**
```jsonc
// content/pools/lobby_floor_loot.json
{
  "id": "lobby_floor_loot",
  "rolls": 1,                         // how many picks for this spot (default 1)
  "entries": [
    { "def": "almond_water", "w": 75 },
    { "def": "battery",             "w": 5  },
    { "def": "note_random",         "w": 1  },
    { "def": null,                  "w": 19 }   // "nothing" is just another weighted entry
  ]
}
```
- `[{99},{1}]` → 99% / 1%. `[{1},{5},{75}]` → 1/81, 5/81, 75/81. Any positive numbers work. They don't have to sum to 100.
- An entry can point at **another pool** (`{ "pool": "rare_items", "w": 2 }`) for nested tables, for example "2% chance to roll on the rare table".
- Optional modifiers on an entry: `"minDepth"`, `"maxDepth"`, `"zones"`, and `"unique": true` (spawns at most once per run, used for story notes). Entries that fail their conditions are dropped and the rest are re-normalised.
- **Seeded per spot** (`hash(slotSeed, spotId)`), so the same room in the same run always rolls the same result. Picked-up items are remembered and don't respawn.
- **Debug tool:** `tools/pool-sim.mjs` rolls a pool 100k times and prints the actual percentages next to the expected ones.

### 4.4 Item scripts
```js
// src/scripts/items/flashlight_recharge.js
export default {
  id: 'flashlight_recharge',
  run(ctx, params) {                  // ctx = safe API, never the raw engine
    const torch = ctx.inventory.find('flashlight');
    if (!torch) return ctx.fail('Nothing to put it in.');
    torch.state.battery = 1;
    ctx.sound.play('battery_click', { at: ctx.player });
    ctx.ui.watchBeep();
    return ctx.ok({ consume: true });
  }
};
```
- The registry is auto-built from the folder at build time (drop a file in, reference it by `id`).
- **`ctx` API:** `player`, `inventory` (add/remove/find/held), `world` (spawn/remove/find by tag, nearby objects), `sound`, `light` (flicker/kill nearby), `ui` (notebook add page, watch message, caption), `tenant` (provoke/calm), `sanity` (add), `state` (per-object and per-run storage), `rng` (seeded), `timer` (after/every), `self` (this object) and `params`.
- The same script system serves `interact`, `use`, `combine`, `anomaly` and room scripts.

---

## 5. Inventory and interaction

### 5.1 Four pockets
- **4 slots.** Select with **1–4** or the **mouse wheel**. The selected item is **held in your right hand** (diegetic view model).
- **Left-click = use** the held item (`use` component). **E = interact** with what you're looking at. If you're holding something and the target has a matching `combine` rule, E combines instead.
- **G = drop** the held item, placed in the world and saved.
- **Pocket check (diegetic):** hold **Q** to look down at your open jacket and see all four pocket items (rendered as small 3D models). Pockets are full when there's no room left. The hand shakes the item when you try to pick up a fifth.
- Items with `size: 2` take two slots (for example a crowbar).

### 5.2 Combining
- **Item + world object:** hold the item and press E on the object. For example, *battery + flashlight* or *fuse + fuse box*.
- **Item + item:** hold item A, open pockets (Q), then click item B. For example, *tape + torn note → readable note*.
- Rules live on either object's `combine` list. The engine checks both directions. Results: run a script, consume one or both, and/or spawn a `result` object into your hand.

### 5.3 Example starter content
| Item | Components | Notes |
|---|---|---|
| Flashlight | pickup, use (toggle), light, battery state | You start with it. **Always in the left hand, takes no pocket** |
| Battery | pickup, combine → flashlight | Rarer with depth |
| Almond water (bottle) | pickup, use → +sanity | Common calm-down item |
| Note (spine / random) | pickup or readable → notebook | Story |
| Chalk | pickup, use → draw mark on wall (persists) | Player-made wayfinding |
| Tape recorder | pickup, use → plays a voice log (synth + caption) | Atmosphere |
| Fuse | pickup, combine → fuse box | Opens a locked area |
| Desk phone | interact → script | Rings when you're near |
| Office chair | collider, anomaly (turns to face you when unseen) | Pure dread |

---

## 6. The Tenant *(skill: game-ai)*
- **FSM:** `Dormant → Glimpse → Stalk → Hunt → Lose → Dormant`. It freezes while inside your view cone. It hunts with A* over cell grids stitched across rooms. You lose it by breaking line of sight or hiding (`hide` component).
- Uses hysteresis thresholds, a minimum time in each state, and perception checked cheap → expensive.
- **Director:** a tension meter, with intensity from the zone JSON plus depth.
- No gore. Tall thin silhouette, never fully lit.
- Being caught: you wake up elsewhere (see the decisions log).

---

## 7. Player
Walk, sprint (stamina), crouch, interact, inventory, watch, notebook. **Sanity** goes down in the dark, near or seeing the Tenant, and from anomalies. It goes up under working lights, with almond water, and from some notes. **Flashlight battery** drains while on.

---

## 8. Diegetic UI *(game-ui-ux + Unity article)*
| Info | Home | Second channel |
|---|---|---|
| Battery | Beam dims and flickers; 3 LEDs on the torch | Click sound plus LED count |
| Sanity | Watch heart rate, glitching face | Heartbeat audio plus VHS distortion (meta) |
| Stamina | Breathing, ragged camera bob | Audio plus camera |
| Tenant near | Lights die, hum cuts out, watch scrambles | Three channels |
| Time / distance | Watch clock + pedometer | (none needed) |
| Map / notes | Notebook (auto pencil sketch, collected pages) | (none needed) |
| Inventory | Held item in hand; look down at pockets (Q) | Item shape plus name written on the tag |
| Interact | Hand reaches toward the target; verb written on a tag | Optional text prompt |
| Caught | VHS tracking glitch (meta) | Audio sting |
| Saved | Watch beeps, shows `SAVED` | Beep plus text |

**Menus in the world:** a CRT title screen, settings in the notebook's inside cover, and the ending on the CRT. **Accessibility:** remap, sensitivity, invert-Y, reduce flashing, separate volume sliders, sound captions, text size and contrast, optional prompts.

---

## 9. Presentation
- **PS1 render:** 320×240 target, vertex snap, affine UVs, 15-bit colour plus Bayer dither, thick fog, nearest-filtered Kenney textures, per-vertex light, and a VHS layer at low sanity. *(shader-programming, threejs-*)*
- **Zone textures:** Lobby `wall_yellow*`, `carpet_green*` · Offices `wall_blue*`, `door_wood*` · Poolrooms `pool_*` · Maintenance `metal_structure*`, `wall_concrete_dirt`, `door_emergency_exit*` · Red Halls `carpet_red*`, `wall_yellow_arch*`.
- **Item and prop art:** simple low-poly primitives and tiny procedural canvas textures (battery, bottle, note). No extra downloads.
- **Audio:** fully procedural Web Audio. Sound presets are also data (`content/sounds/*.json`: oscillator and noise recipes), so `"preset": "phone_ring"` is content, not code. *(audio-design)*
- **Game feel:** head bob, sway, flicker cascades, trauma² shake, FOV kick. *(game-feel)*

---

## 10. Saving *(save-systems, roguelike)*
Versioned `localStorage` with try/catch fallback. Saves settings, seed, player position, inventory, picked-up and dropped items, chalk marks, notes found and stats. New seed each run, with an optional typed-in seed. Notes and stats carry over.

---

## 11. Project layout and build
```
the-hum/
  PLAN.md
  .claude/skills/            # gamedev skills + grilling
  content/                   # ← add content here
    zones/*.json
    rooms/<zone>/*.json
    objects/*.json
    pools/*.json
    notes/*.json
    sounds/*.json
  src/
    core/                    # loop, events, seeded rng, registry, validation types
    world/                   # herringbone.js, connectors.js, wfc.js, roomBuilder.js, filler.js, streaming.js
    objects/                 # objectSystem.js, components/*.js (one file per component type)
    spawn/pools.js
    interaction/             # raycast, verbs, combine resolver
    inventory/
    scripts/
      api.js                 # the ctx API given to scripts
      items/*.js             # ← custom item/object/room scripts (auto-registered)
    ai/tenant.js
    player/
    ui/diegetic/             # watch, notebook, pockets, torch LEDs, hand prompt
    render/ps1.js
    audio/synth.js
    save.js
  tools/
    validate.mjs             # content checks (ids, refs, edges, weights, coverage)
    pool-sim.mjs             # roll a pool 100k times, show real vs expected odds
    wfc-sweep.mjs            # thousands of seeds: no failures, reachable, timing
    room-preview.mjs         # print a room's layout + spots as ASCII
  assets/textures/           # used Kenney PNGs (CC0) + tiny item textures
  build.mjs                  # validate → esbuild bundle (content JSON inlined) → dist/the-hum.html (fails if ≥ 10 MB)
  dist/the-hum.html          # the deliverable
```
- **Dev loop:** `npm run dev` serves the game with live reload. Edit a JSON file, save, and the room updates. `npm run build` produces the single HTML.
- **Size estimate:** ≈ 2 MB (Three.js 0.7 + code 0.3 + textures 0.7 + content JSON < 0.2).
- **SharePoint risks** (milestone 1 smoke test): `.html` may download instead of rendering (an Embed web part iframe is the likely route), pointer lock in an iframe (click-drag fallback), audio needs a click first, fullscreen may be blocked.

---

## 12. Milestones
1. **Smoke test + skeleton:** build pipeline → single HTML, PS1 renderer, one hard-coded room. Upload to SharePoint.
2. **Content pipeline:** room JSON → Room Builder, object defs + components (mesh, collider, readable, sound), pools + spawner, validator, pool-sim.
3. **Endless layout:** herringbone slots, hashed connectors, WFC + multi-slot rooms, filler, streaming, wfc-sweep. Lobby zone with about 15 rooms.
4. **Interaction + inventory:** verbs, 4 pockets, use and combine, script runner + ctx API, starter items.
5. **Diegetic kit + audio:** flashlight, watch, notebook map, pockets view, procedural sounds.
6. **The Tenant + director.**
7. **More zones**, transitions, anomalies, notes and story, "the building moves".
8. **Menus, accessibility, save, ending.** Then tuning and final size check.

---

## 13. Decisions log
| Decision | Answer |
|---|---|
| Levels? | **No.** One endless world. Zones change with depth |
| World structure | **Herringbone Wang slots (Noita-style) + WFC** choosing room templates by edge connectors |
| Content | **JSON** for zones, rooms, objects, pools, notes, sounds. **Scripts** in `src/scripts/items/` by id |
| Object positions | **Local to the room**, transformed by the slot's origin and rotation |
| Spawn odds | **Weight ÷ sum of weights** in the pool. `null` entry = nothing. Nested pools allowed |
| Inventory | **4 slots**, switchable, use and combine (item+item and item+world) |
| Tone | Psychological horror, **no gore** |
| UI | Diegetic first. Meta for sanity and caught effects. Accessibility toggles |
| Skills | In `.claude/skills/` |
| Output | Single HTML, everything inline, < 10 MB |
| Goal | **Endless, with a hidden ending:** spine notes lead to an exit that only appears past a depth threshold |
| Caught by the Tenant | **"Wake up elsewhere":** sanity loss, scrambled map, pocket loss. The run ends only if sanity is already near zero |
| Persistence | **New seed each run** plus a seed you can type in to share runs. Notes and stats carry over |
| Session length | **10–20 min**, with autosave to resume a run |
| Story | **About 12 fixed-order spine notes** (`unique` pool entries) plus random fragments (for now) |
| Vertical | **Single floor.** Variety from ceiling heights and sunken pools |
| Input | **Keyboard + mouse only** (v1) |
| Title | **THE HUM** |
| Room scale | 1 block = 8×8 cells (16 m). Standard room = 16×8 cells. Big rooms span several slots |
| Flashlight | Always in the **left hand**, takes no pocket. Pockets are for found items (right hand) |
| Authoring | Hand-edited JSON + text layouts + validator/preview tools. Editor maybe later |
| Content delivery | Everything compiled into the HTML. New content = rebuild + re-upload |
| Exit unlock | **All 12 spine notes**, then the exit can appear past depth X. The last note hints at its direction. Spine notes spawn in increasing depth order |
| Sanity zero | The tape **ejects** → CRT title, new seed. Spine notes persist; inventory and map reset |
| Caught cost | **One random pocket item** dropped at the spot where you were caught |
| First playable | Yellow Lobby only, ~15 rooms + filler, ~10 objects, Tenant, inventory, diegetic kit. Play end to end before more zones |
| Exit depth | All 12 notes **and** ≥ 20 blocks (~320 m) from start. Spine notes every ~1–2 blocks. Tunables in `content/config.json` |
| Difficulty | No modes. A **Calm** toggle: the Tenant never hunts |
| Autosave | On entering a new room and on pick-up/drop, at most once per 10 s. Watch beeps |
| SharePoint | User uploads the M1 smoke test and reports back on rendering, pointer lock and audio |
| Version control | git, one commit per milestone |
| Seed UI | Written on the **VHS tape label**. Changed via a "rewrite label" notebook page. Shown on the watch's hidden screen (hold Z 3 s) |
