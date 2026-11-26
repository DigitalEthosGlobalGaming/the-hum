# Level direction: dressing the lobby

How rooms in THE HUM are dressed, and the vocabulary for doing more of it. Read this before you
add objects or spots to a room. The level-layout rules (edges, aprons, connectivity) are in
`src/world/layout/README.md`; this doc covers what goes *inside* a room.

## 1. The direction

An endless, slightly wrong, mono-yellow office. Damp carpet, fluorescent hum, too many
identical rooms, everything abandoned mid-task, things that almost make sense.

**Every prop has a reason to be where it is.**
- A desk stands with its back to a wall. Its chair is on the drawer side, pushed back or turned
  as if someone just stood up. A lamp and a phone sit on the back corners of the desk top.
- A tape recorder or a note sits on a desk, on a chair seat, or on the floor beside a chair:
  where someone sat.
- Boxes are stacked in storage corners. Supplies sit on shelves.
- A wet-floor sign stands next to a stain. A stain on the carpet has a matching one on the
  ceiling above it (`decor_leak`).
- A camp has a reason: a corner, a lamp, a low wall of boxes, empties lined up neatly.

**Restraint.** Empty, uncanny space is the default. Most rooms hold almost nothing, and most
spots roll nothing. Clusters tell one micro-story each:
- *Someone camped here*: cardboard floor, sleeping bag, empties, a tally sheet, writing above
  the bed (`lobby_campsite`, `lobby_dead_end_alcove`).
- *A meeting abandoned*: chairs around a table, one pushed back, papers left on the table
  (`lobby_meeting_room`, `lobby_big_l_hall`).
- *Waiting for nothing*: three chairs against a partition, a clock, a bin (`lobby_split_hall`).

**Wrongness, used sparingly.** At most one wrong thing per room, and never in every room of a
kind:
- a desk in a corridor (`lobby_ring`)
- a chair facing a wall or a pillar (`lobby_long_corridor`, `room_chair_facing_wall`)
- chairs stacked to the ceiling, leaning a little more with each chair (`room_center_wrong`)
- a door to nowhere, with rows of chairs facing it (`lobby_chair_hall`)
- a perfectly centred chair in an empty room (`lobby_empty_lit`)
- two identical rooms side by side, same desk, same lamp, same pushed-back chair
  (`lobby_twin_rooms`)
- a clock with thirteen marks; a cord that ends unplugged; a coat nobody took

## 2. Density targets

| Room type | Fixed objects | Spots | Expected rolled items |
|---|---|---|---|
| Common filler-like rooms (pillar forest, colonnade, crossroads, empty) | 0–1 | 3–7 | ≤ 1 |
| Rooms with one set piece (ring desk, waiting area, partial-walls desk) | 2–8 | 5–8 | 1–2 |
| Set-piece rooms (office, storage, meeting, cubicles, camp, chair hall) | 8–20 | 6–16 | 2–3 |
| Big multi-slot halls | 1–7 | 5–9 | 1–2 |

- `null` weight: **55–75 %** on ordinary spots, **85–90 %** on wrongness and wall spots, and
  about **28 %** on camp spots (camps are the reward).
- Story notes (`spine_notes`) and tape recorders go mostly in desk-top, beside-chair, meeting
  table and camp pools. Keep them out of corner and floor-litter pools, except at low weight.
- Frequency: the commonest rooms (pillar forest about 15 %, partial walls about 12 %) stay the
  barest. Set-piece rooms are 1–3 % each.

## 3. Placement conventions

- **Local frame:** `x` along a layout row, `z` down the rows, cell = 2 m. Wall cells are solid
  2 m blocks, so a wall *surface* is at a multiple of 2 (the north border wall's face is z = 2).
- **`rot`:** degrees counter-clockwise from above; 0 faces −z (north), 90 west, 180 south,
  270 east. A prop's front faces −z at rot 0.
  - Something with its back to the **north** wall faces south: rot 180. South wall: rot 0.
    West wall: rot 270. East wall: rot 90.
- **Desk** (`office_desk`, 1.4 × 0.7 m, top at **0.76 m**): drawers face the sitter at local −z.
  Against a wall, the centre is 0.38 m off the wall surface. The chair goes 0.85–1.1 m in front,
  facing the desk (desk rot + 180), turned 10–30° and pushed back for "just left".
  The lamp/phone spot is the back-left corner of the top (local −0.45, +0.15) with the desk's
  rot, and the papers spot is near the middle front (local +0.12, −0.08) with no rot.
- **Freestanding against a wall:** centre = depth / 2 + 0.03 m off the wall.
- **Wall-hung props** (whiteboard, cork board, clock, door to nowhere) and all `wall_*` spots:
  origin **0.13 m off the wall** (`WALL_INSET` in `src/decor/prefabs.js`), facing into the room.
  Wall-hung decor is built with its back 0.13 m behind its origin, and the fuse box (a 0.25 m-deep
  centred box) also fits there. So one spot serves both.
- **Flush wall props** from the feature branches (`light_switch`, `evac_map`, `dark_writing`,
  `dark_arrow`, `wall_scrawl`) are built with their back *on* the origin, and the engine has no
  per-def spot offset. Their spots go **0.02 m off the wall** (`WALL_FLUSH`), never 0.13, or they
  float a hand's width off the wallpaper. So they get their own spot kinds (`*_wall_switch` y 1.05,
  `*_wall_map` y 1.25, `*_wall_dark` y 1.0) next to the 0.13 m `*_wall_panel`/`*_wall_hang` spots.
  A spot pool must not mix flush and inset props; `roomcheck` errors if it does, if a wall prop's
  origin is the wrong distance off the wall, or if the wall behind it can be stamped open.
- **Fuse cabinets make rooms dark.** A room with an unpowered `fuse_box` (fixed *or* rolled) starts
  with every circuit off until a fuse goes in (beyond `safeDepth`). Place fixed ones deliberately.
- **Dark writing** shows only while its spot is darker than `config.power.darkReveal` and the torch
  is off it. Give fixed writing a spot with a one-entry inline pool (`[{"def":"dark_writing","w":1}]`)
  rather than a fixed object: the spot key seeds the message, so it stays the same per run.
- **Ceiling decor** (`decor_ceiling_stain`, the hole in `decor_ceiling_tile_fallen`, the top half
  of `decor_leak`): placed at y 0, and the prefab carries the 3 m height. Keep them off light cells.
- **Seats:** a stacking-chair seat is at 0.47 m. A spot there puts an item on the chair.
- **Spot `rot`:** give it for anything that must face a way (desk fixtures, chairs, wall props,
  solid clutter). Leave it out for litter and pickups, and the spawner picks a random rotation.
- Rooms are rotated and mirrored by the layout. Author in the template's own frame and the
  transform handles the rest.

### Openings, aprons and walls you can trust
- Any border segment whose edge spec allows an opening may be stamped open. The cells it can
  open, **plus two cells inward**, must stay free of colliders. That includes anything solid a
  spot can roll.
- In an all-`*` 16×8 room that leaves only the centre band (rows 3–4, cols 3–12) and the wall
  stubs between segments (cols 7–8 against the north and south walls) for solid props.
- To get real wall space, constrain the edge: `"wall|door"` keeps cells 1–2 and 5–6 of a segment
  solid (the door opens only cells 3–4). `lobby_storage`, `lobby_meeting_room`,
  `lobby_cubicle_farm` and `lobby_chair_hall` use it, and `lobby_office` and `lobby_campsite`
  use plain `"wall"`.
- Non-solid decor (stains, papers, the camp, cords, wall-hung boards) may sit in an apron.
  A wall-hung prop must still sit on a wall that can never be stamped open.

### Checks
```
npm run validate
node src/decor/roomcheck.mjs            # colliders vs aprons, 0.1 m walk grid, floating spots, wall insets
node tools/wfc-sweep.mjs --seeds 100    # reachability + golden digests
npm run room-preview -- <room_id>
```
`roomcheck` treats every solid def a spot *can* roll as present, so it is a worst case. It loads the
physics, power and story prefabs for footprints, and a rolling body (`physics.shape: circle`) counts
with the larger of its mesh bounds and its body radius (office chair 0.3 m, trash bin 0.2 m).

## 4. Spot vocabulary

Spot ids are free-form, but name them for what they are (`desk_top`, `beside_chair`…), and
point them at the matching `room_*` pool.

| Spot (id pattern) | Where | Pool | Solid? |
|---|---|---|---|
| `*_fixture` | desk top, back corner, desk's rot | `room_desk_fixture` | no |
| `*_top` | desk top, middle | `room_desk_top` | no |
| `table_*` | conference table top (0.76 m) | `room_meeting_table` | no |
| `*_beside_chair`, `*_seat` | floor beside a chair, or on a seat (0.47 m) | `room_beside_chair` | no |
| `shelf_*` | on an empty `decor_metal_shelf` (0.57 / 1.02 / 1.47 m) | `room_storage_shelf` | no |
| `storage_floor_*` | open floor in a storage room | `room_storage_floor` | yes |
| `*_wall_base` | standing against a wall (depth 0.6) | `room_wall_base` | yes |
| `*_wall_panel` | on a wall, 0.13 m off, usually by a doorway | `room_wall_panel` | yes (fuse box) |
| `*_wall_hang` | on a wall, 0.13 m off | `room_wall_hang` | no |
| `*_wall_switch` | on a wall **0.02 m off**, y 1.05, beside a doorway | `room_wall_switch` | no |
| `*_wall_map` | on a corridor wall **0.02 m off**, y 1.25 | `room_wall_map` | no |
| `*_wall_dark` | on a wall that never opens, **0.02 m off**, y 1.0 | `room_wall_dark` (or `power_wall`) | no |
| `*_corner`, `pillar_base_*`, `nook` | small pickups in corners and at pillar bases | `room_corner_loot` | no |
| `*_corner` (solid) | a free corner clear of every apron | `room_floor_corner` | yes |
| `*_floor` | open floor | `room_floor_litter` | no |
| `*_stain` | open floor | `room_floor_stain` | no |
| `leak`, `*_leak` | open floor | `room_leak` | no |
| `beside_*leak` | next to a leak/stain spot | `room_beside_stain` | yes |
| `camp_*` | around a camp | `room_camp` | no |
| `*_camp` | a corner where a camp might be | `room_camp_site` | no |
| `corridor_end` | against a wall, centre **0.45 m** off it (fits the 0.9 × 0.8 vending machine) | `room_corridor_end` | yes |
| `dead_centre` | the exact middle of an empty room, rot 0 | `room_center_wrong` | yes |
| `chair_at_pillar` | facing a wall or pillar, rot points at it | `room_chair_facing_wall` | yes |
| `*_ceiling` | anywhere off the light cells | `room_ceiling` | no |

## 5. Pools

All in `content/pools/`. Check odds with `node tools/pool-sim.mjs <id>`.

| Pool | Contents (rough %, depth 3) |
|---|---|
| `room_desk_fixture` | lamp 24, phone 14, `story_desk` 14 (typewriter 2.5, badge 2, coin 2, walkie/tape/camera/string < 1), nothing 53 |
| `room_desk_top` | papers 12, note 7, tape 3.5, **badge 3.5**, battery 3, water 3, spine 2, **walkie 2**, blank tape 2, coin 2, camera/string/matches 1 each, nothing 58 |
| `room_meeting_table` | papers 21, note 6, phone 3.5, tape 2.6, badge 2.6, walkie 1.7, coin 1.7, spine 1.4, typewriter 0.9, nothing 59 |
| `room_beside_chair` | note 7, water 5, tape 4, papers 4, walkie 2.5, spine/camera/badge/blank tape/can 1.7 each, nothing 69 |
| `room_floor_litter` | papers 8, water 7, battery 5, **can 3.5**, chalk 3, note 3, fuse 2, **bottle 2**, nothing 67 |
| `room_corner_loot` | water 9, battery 6.5, fuse 4, chalk 3, note 3, coin 2, `power_room_loot` 6 (tube 1, glow 0.9, matches 0.8, candle 0.6, music box 0.2 from depth 3), nothing 69 |
| `room_floor_corner` | box 9, box stack 6, **trash bin 6**, plant 5.5, **filing cabinet 5.5**, sign 2, office chair 2, nothing 64 |
| `room_storage_shelf` | battery 9, fuse 8, water 8, **spare tube 7**, chalk 4, **glow sticks 4**, coin 2.6, tape 1.7, matches 1.7, nothing 54 |
| `room_storage_floor` | box 19, box stack 11, `physics_carts` 10 (janitor 4.8, AV 4.8), office chair 3, nothing 57 |
| `room_wall_base` | trash bin 6.5, box 5.6, **filing cabinet 5.6**, plant 4.6, coat rack 2, nothing 76 |
| `room_wall_panel` (0.13 m) | fuse_box 10, wall clock 5, nothing 85 |
| `room_wall_hang` (0.13 m) | wall clock 6, cork board 5, nothing 89 |
| `room_wall_switch` (flush) | light_switch 40, nothing 60 |
| `room_wall_map` (flush) | evac_map 14, nothing 86 |
| `room_wall_dark` (flush) | dark_writing 6, dark_arrow 5, nothing 89 |
| `room_camp` | water 15, note 10, tape 6, battery 6, **glow sticks 5, matches 4, candle 4**, can 3, spine 3, chalk 2.5, walkie/camera/blank tape/bottle 1.6, red string 0.8, nothing 34 |
| `room_camp_site` | camp 30, blanket 15, sleeping bag 10, nothing 45 |
| `room_corridor_end` | `story_floor` 10 (filing cabinet 5, **vending machine 1.2**), box stack 5, plant 4, stacking chair 2, nothing 82 |
| `room_center_wrong` | stacking chair 4, office chair 4, chairs-to-ceiling 1, plant 1, **music box 1**, nothing 89 |
| `room_chair_facing_wall` | **office chair 7**, stacking chair 4, nothing 89 |
| `room_ceiling` | ceiling stain 22, fallen tile 8, nothing 70 |
| `room_floor_stain` | water stain 30, nothing 70 |
| `room_leak` | leak 24, water stain 10, nothing 66 |
| `room_beside_stain` | wet_floor_sign 36, **janitor cart 6**, nothing 58 |

Feature pools nested here: `story_desk` (desk fixtures), `story_floor` (corridor ends),
`power_room_loot` (corner loot), `physics_throwables` (floor litter), `physics_carts` (storage floor),
`physics_floor_props` (`lobby_clutter`, the filler solids), `power_wall` (the dark room's spare wall
spot; its `fuse_box` entry was dropped because a fuse cabinet needs the 0.13 m inset, not flush).
The container pools (`story_drawer_*`, `story_vend*`) and `physics_trash_spill` are rolled by their
props. `decor_trash_bin` is no longer placed: every bin is now the physics `trash_bin` (tips, spills).

Kept ids: `lobby_floor_loot` (filler + test rooms; now nests `room_floor_litter` 70 /
`room_corner_loot` 30), `lobby_clutter` (filler solids, no wall-dependent items; now nests
`physics_floor_props` 34 + loose boxes, stacks, plants), `desk_top`
(legacy, nests the two desk pools), `spine_notes` (unchanged: no story pages before depth 1,
more likely deeper).

## 6. Props (`src/decor/`, `content/objects/decor_*.json`)

Prefabs in `src/decor/prefabs.js` and procedural textures (`proc:decor_*`) in
`src/decor/painters.js`, registered by `src/decor/register.js`. All are box-built, tinted
Kenney or tiny canvas textures, with nearest filtering.

| Object | Collider | Notes |
|---|---|---|
| `decor_conference_table` | yes | 2.4 × 1.1, top 0.76 |
| `decor_metal_shelf`, `decor_metal_shelf_stocked` | yes | 1.2 × 0.45 × 1.95; shelf tops 0.12/0.57/1.02/1.47/1.92 |
| `decor_bookcase` | yes | 0.9 × 0.32 × 1.8 |
| `decor_cubicle_panel` | yes | 1.6 × 1.35 half-height partition |
| `decor_stacking_chair` | yes | seat 0.47 |
| `decor_chair_row`, `decor_chair_row_gap` | yes | 5 (or 4) identical chairs, 0.9 m pitch, one collider |
| `decor_stacked_chairs` | yes | 6 nested chairs |
| `decor_stacked_chairs_ceiling` | yes | 20 to the ceiling, leaning (readable) |
| `decor_coat_rack` | yes | with one coat (readable) |
| `decor_dead_plant`, `decor_trash_bin` | yes | |
| `decor_box_stack`, `decor_box_stack_tall` | yes | static stacks (`cardboard_box` is the loose one) |
| `decor_door_to_nowhere` | yes | wall-hung, Kenney `door_wood` (readable) |
| `decor_whiteboard`, `decor_cork_board`, `decor_wall_clock` | no | wall-hung (readable) |
| `decor_water_stain` | no | flat plane decal |
| `decor_ceiling_stain` | no | ceiling decal |
| `decor_leak` | no | ceiling stain + floor stain under it |
| `decor_ceiling_tile_fallen` | no | tile on the carpet + black hole + insulation above |
| `decor_extension_cord` | no | power strip, orange cord, unplugged end |
| `decor_paper_scatter` | no | loose sheets (not pickups) |
| `decor_sleeping_bag`, `decor_blanket_heap` | no | |
| `decor_camp` | no | the whole camp cluster (readable) |

## 7. Rooms

| Room | Story | Light |
|---|---|---|
| `lobby_office` | manager's office: desk to the north wall with a **typewriter** on it, rolling chair pushed back, **bin and filing cabinet** beside the desk, bookcase, coat, plant, whiteboard, **light switch** by the door. Reception desk by the connecting door, switch spot on the divider | rolled |
| `lobby_storage` | north wall of shelving, two shelf islands, tall box stack, sign by a stain, **AV cart** in the aisle; **empty fuse cabinet + switch + filing cabinet** on the west wall. Tubes, fuses, coins on the shelves | one `x`; dark until a fuse goes in |
| `lobby_ring` | desk against the core in the looping corridor, rolling chair, cord; **empty fuse cabinet** on the core, switch spot beside it | one `x`; dark until fused |
| `lobby_twin_rooms` | two identical offices | rolled |
| `lobby_split_hall` | waiting area: three chairs, clock, **physics bin**, plant, **vending machine** at the end of the row; leak by the gap (sign or **janitor cart**); evac-map spot on the east partition | rolled |
| `lobby_partial_walls` | one desk in the nook, notice-board spot, possible camp in the pocket | rolled |
| `lobby_long_corridor` | one chair facing the wall; **evacuation plan** (fixed) on the north wall; **janitor cart** parked on the south side; switch and dark-writing spots | rolled |
| `lobby_dead_end_alcove` | camp at the very end of the dead end, lamp on the floor, writing above; dark-writing spot in the corridor | rolled |
| `lobby_big_l_hall` | meeting table in the middle of the hall; a chair facing a pillar down the arm; sign/cart spot beside the leak | rolled |
| `lobby_stair_hall` | leak + sign where the halves meet, **janitor cart** left beside it, fallen ceiling tile | rolled |
| `lobby_pillar_forest`, `lobby_colonnade`, `lobby_crossroads`, `lobby_empty_lit` | bare on purpose; spots only (cord in the crossroads; the crossroads gets an evac-map spot and a deep corridor-end spot for the vending machine; the colonnade a switch spot) | rolled |
| `lobby_meeting_room` | abandoned meeting: rolling chairs pushed back, a **typewriter** left on the table facing an empty chair, whiteboard, dead clock; switch spot at the entrance | the tube over the table is `f` |
| `lobby_cubicle_farm` | six cubicles; one stripped to a chair facing the wall, one chair rolled into the aisle, a blanket under a desk; **filing cabinet and bin** in the north cubicles; every desk now has a rolling chair | east tube `f` |
| `lobby_campsite` | camp in a walled corner behind a box wall, lamp plugged into nothing, **two candle stubs, a box of matches, a music-box spot** (35 %) by the pillow | rolled |
| `lobby_chair_hall` | rows of identical chairs facing a door to nowhere; one turned round; a switch spot beside the door to nowhere | rolled |
| **new** `lobby_dark_room` | records room: **empty fuse cabinet**, switch by the door, three filing cabinets, a desk with a candle stub and (often) matches, file boxes in the middle. **Dark writing** above the desk and on the south wall, plus a `power_wall` spot: readable only with the lights off. Fuse in and it is just a room (about 1 % of slots) | 3 `x` + 1 `f`; dark until fused |

All desk chairs in rooms are the rolling `office_chair` (physics push body); the stacking chairs
that remain are waiting-room, chair-hall and "facing the wall" set pieces.

## 8. Feature props: final placement

The three feature branches (physics, power, story) have landed. Where each prop lives now:

| Prop | Fixed placements | Rolled from (spot → pool) |
|---|---|---|
| `office_chair` (rolls/spins) | every desk and table chair (office, cubicles, ring, twins, partial walls, meeting room, big L hall, dark room) | `room_chair_facing_wall`, `room_center_wrong`, `room_floor_corner`, `room_storage_floor`, filler `lobby_clutter` |
| `janitor_cart` | stair hall (by the leak), long corridor | `beside_*leak` → `room_beside_stain`; `storage_floor_*` → `physics_carts`; filler |
| `av_cart` | storage aisle | `storage_floor_*` → `physics_carts`; filler |
| `trash_bin` (tips, spills) | office desk, cubicles, split-hall waiting row, dark room | `*_wall_base`, solid `*_corner`, filler |
| `soda_can`, `glass_bottle` | (the camp prefab's empties are decor) | `*_floor` → `physics_throwables`; `camp_*`; cans at `*_beside_chair` |
| `cardboard_box` (carry), `wet_floor_sign` (topples) | campsite, storage, stair hall (unchanged) | corners, storage floor, wall bases, `beside_*leak`, filler |
| `light_switch` | office (manager's door), storage, dark room | `*_wall_switch` → `room_wall_switch` (office, meeting room, long corridor, ring, colonnade, chair hall); dark room `power_wall` |
| `fuse_box` | storage, ring, dark room (all start dark) | `*_wall_panel` → `room_wall_panel` |
| `spare_tube`, `glow_stick` | | `shelf_*`; corners via `power_room_loot`; glow sticks at camps |
| `matches`, `candle` | campsite (2 candles + matches), dark-room desk (candle) | `camp_*`; matches on desk tops, shelves, the dark-room desk |
| `music_box` | | `camp_music_box` (campsite, 35 %); `dead_centre`; corners from depth 3 |
| `dark_writing`, `dark_arrow` | dark room: two writing spots (one-entry pools) + `power_wall` | `*_wall_dark` → `room_wall_dark` (long corridor, dead-end alcove) |
| `filing_cabinet` | office, storage, cubicle farm, dark room ×3 | `*_wall_base`, solid `*_corner`, `corridor_end` (`story_floor`) |
| `vending_machine` | split-hall waiting area | `corridor_end` (`story_floor`, crossroads) |
| `coin` | | shelves, corners, desk tops, meeting tables, desk fixtures (`story_desk`), drawers, vending |
| `typewriter` | office manager's desk, meeting-room table | `*_fixture` (`story_desk`, faces the sitter); `table_*` (rare) |
| `id_badge`, `walkie_talkie`, `flash_camera`, `blank_tape`, `red_string` | | desk tops, desk fixtures, meeting tables, beside chairs, camps (badges and walkies commonest on desks) |
| `evac_map` | long corridor (north wall) | `*_wall_map` → `room_wall_map` (crossroads, split hall) |
| room lights `x` / `f` | `x`: storage, ring, dark room; `f`: meeting room, cubicle farm, dark room | the power network's rolls on `L` cells |

**Power-network extras** (`content/config.json` → `power`): `switchChance` 0.3 → **0.05**,
`writingChance` 0.15 → **0.05**, `lootChance` 0.3 → **0.1**. Rooms now place switches, writing and
power loot deliberately; the small remainder keeps a few in filler rooms, which have no spots.

### Still upcoming
| Spot / pool | Prop | Notes |
|---|---|---|
| `*_wall_base` / `room_wall_base` | water cooler | depth budget 0.6 m |
| `*_wall_hang` | clocks that disagree (watch puzzle), exit signs | 0.13 m inset if built like the decor wall props |
| new spot kinds | keycard doors (badges), lockers and hiding spots, a CRT feed on the AV cart | |
