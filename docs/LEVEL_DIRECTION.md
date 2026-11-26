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
  centred box) also fits there. So one spot serves both, and future wall props should follow suit.
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
node src/decor/roomcheck.mjs            # colliders vs aprons, 0.1 m walk grid, floating spots
node tools/wfc-sweep.mjs --seeds 100    # reachability + golden digests
npm run room-preview -- <room_id>
```
`roomcheck` treats every solid def a spot *can* roll as present, so it is a worst case.

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
| `*_corner`, `pillar_base_*`, `nook` | small pickups in corners and at pillar bases | `room_corner_loot` | no |
| `*_corner` (solid) | a free corner clear of every apron | `room_floor_corner` | yes |
| `*_floor` | open floor | `room_floor_litter` | no |
| `*_stain` | open floor | `room_floor_stain` | no |
| `leak`, `*_leak` | open floor | `room_leak` | no |
| `beside_*leak` | next to a leak/stain spot | `room_beside_stain` | yes |
| `camp_*` | around a camp | `room_camp` | no |
| `*_camp` | a corner where a camp might be | `room_camp_site` | no |
| `corridor_end` | end of a corridor, against the wall | `room_corridor_end` | yes |
| `dead_centre` | the exact middle of an empty room, rot 0 | `room_center_wrong` | yes |
| `chair_at_pillar` | facing a wall or pillar, rot points at it | `room_chair_facing_wall` | yes |
| `*_ceiling` | anywhere off the light cells | `room_ceiling` | no |

## 5. Pools

All in `content/pools/`. Check odds with `node tools/pool-sim.mjs <id>`.

| Pool | Contents (rough %) |
|---|---|
| `room_desk_fixture` | desk_lamp 26, old_phone 16, nothing 58 |
| `room_desk_top` | papers 16, note 9, spine 7, tape 4, battery 3, water 3, nothing 58 |
| `room_meeting_table` | papers 24, note 7, spine 5, phone 4, tape 3, nothing 57 |
| `room_beside_chair` | note 8, spine 6, water 6, tape 5, papers 5, nothing 70 |
| `room_floor_litter` | papers 8, water 7, battery 5, chalk 3, note 3, fuse 2, nothing 72 |
| `room_corner_loot` | water 10, battery 7, fuse 4, chalk 3, note 3, nothing 73 |
| `room_floor_corner` | box 10, box stack 7, bin 7, dead plant 6, wet-floor sign 2, nothing 68 |
| `room_storage_shelf` | battery 10, fuse 9, water 9, chalk 5, tape 2, nothing 55 |
| `room_storage_floor` | box 24, box stack 14, nothing 62 |
| `room_wall_base` | bin 7, box 6, dead plant 5, coat rack 2, nothing 80 |
| `room_wall_panel` | fuse_box 10, wall clock 5, nothing 85 |
| `room_wall_hang` | wall clock 6, cork board 5, nothing 89 |
| `room_camp` | water 22, note 14, spine 14, tape 9, battery 9, chalk 4, nothing 28 |
| `room_camp_site` | camp 30, blanket 15, sleeping bag 10, nothing 45 |
| `room_corridor_end` | box stack 6, dead plant 5, stacking chair 3, nothing 86 |
| `room_center_wrong` | stacking chair 5, office chair 3, chairs-to-ceiling 1, dead plant 1, nothing 90 |
| `room_chair_facing_wall` | stacking chair 7, office chair 4, nothing 89 |
| `room_ceiling` | ceiling stain 22, fallen tile 8, nothing 70 |
| `room_floor_stain` | water stain 30, nothing 70 |
| `room_leak` | leak 24, water stain 10, nothing 66 |
| `room_beside_stain` | wet_floor_sign 40, nothing 60 |

Kept ids: `lobby_floor_loot` (filler + test rooms; now nests `room_floor_litter` 70 /
`room_corner_loot` 30), `lobby_clutter` (filler solids, no wall-dependent items), `desk_top`
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

| Room | Story |
|---|---|
| `lobby_office` | manager's office (desk to the wall, chair pushed back, bookcase, coat, plant, whiteboard) + reception desk by the door |
| `lobby_storage` | north wall of shelving, two shelf islands, tall box stack, sign by a stain (north/west now `wall\|door`) |
| `lobby_ring` | desk against the core in the looping corridor, cord on the floor |
| `lobby_twin_rooms` | two identical offices (lights moved so the halves match) |
| `lobby_split_hall` | waiting area: three chairs, clock, bin, plant; leak by the gap |
| `lobby_partial_walls` | one desk in the nook, notice-board spot, possible camp in the pocket |
| `lobby_long_corridor` | one chair facing the wall |
| `lobby_dead_end_alcove` | camp at the very end of the dead end, lamp on the floor, writing above |
| `lobby_big_l_hall` | meeting table in the middle of the hall; a chair facing a pillar down the arm |
| `lobby_stair_hall` | leak + sign where the halves meet, fallen ceiling tile, otherwise empty |
| `lobby_pillar_forest`, `lobby_colonnade`, `lobby_crossroads`, `lobby_empty_lit` | bare on purpose; spots only (plus a cord in the crossroads) |
| **new** `lobby_meeting_room` | abandoned meeting room between two side halls |
| **new** `lobby_cubicle_farm` | six cubicles; one stripped to a chair facing the wall, one chair rolled into the aisle, a blanket under a desk |
| **new** `lobby_campsite` | camp in a walled corner behind a box wall, lamp plugged into nothing |
| **new** `lobby_chair_hall` | rows of identical chairs facing a door to nowhere; one turned round |

## 8. Second pass: where upcoming props go

Other features are adding props in parallel. Their spots already exist and point at stand-in
pools. When a prop lands, **add it to the pool named here** (don't add new spots unless the
table says so). Keep the pool's `null` share about the same.

| Spot / pool | Upcoming prop | Notes |
|---|---|---|
| `*_wall_panel` / `room_wall_panel` | **light switch**, **evacuation map**, fuse box | Panels sit by doorways (office door, meeting entrance, storage west wall, colonnade, ring core, corridor walls). Switch about 1.2 m up, 0.13 m off the wall |
| `*_wall_hang` / `room_wall_hang` | **evacuation map**, **dark writing** (power), clocks, cork boards | Never on a wall that can be stamped open |
| `*_fixture` / `room_desk_fixture` | **typewriter**, phone, lamp | Typewriter faces the sitter (spot rot = desk rot) |
| `*_top` / `room_desk_top` | **ID badge**, **walkie-talkie**, **camera**, **red string** | Badges and walkies are prime desk-top finds |
| `table_*` / `room_meeting_table` | **typewriter** (rare), badge, walkie | |
| `*_beside_chair`, `*_seat` / `room_beside_chair` | **walkie-talkie**, **camera**, badge, tape | "Where someone sat" |
| `camp_*` / `room_camp` | **glow sticks**, **music box**, **red string**, walkie, camera | Camps are the richest spots |
| `*_camp` / `room_camp_site` | (camp variants) | |
| `shelf_*` / `room_storage_shelf` | **spare fluorescent tubes**, **glow sticks**, fuses, batteries | Tubes are 2-pocket; the shelf is 1.2 m wide, so they fit |
| `storage_floor_*` / `room_storage_floor` | **carts** (physics), rolling chairs | Solid; the spot's AABB is checked |
| `*_wall_base` / `room_wall_base` | **filing cabinet**, **water cooler**, **vending machine** (if ≤ 0.6 m deep) | Depth budget is 0.6 m. Deeper props need their own `against(..., depth)` spot |
| `corridor_end` / `room_corridor_end` | **vending machine**, filing cabinet | Crossroads corridor wall today. Add more at true dead ends |
| `*_corner` (solid) / `room_floor_corner` | **filing cabinet**, rolling chair, cart | |
| `dead_centre` / `room_center_wrong` | **music box** (wound, playing, nobody there), rolling chair | |
| `chair_at_pillar` / `room_chair_facing_wall` | **rolling office chair** (physics) | Spot rot must still point the chair at the wall |
| fixed `office_chair` objects (offices, meeting rooms, cubicles, big L hall) | physics rolling chairs | Placement already reads as "pushed back"; keep the rot |
| fixed `cardboard_box`, `wet_floor_sign` (campsite, storage, stair hall) | physics boxes and signs | They may now be pushed out of place, which is fine |
| `*_ceiling` / `room_ceiling` | dead light fixtures (power) | Use the room layout's `L` cells, not spots |

When the physics chair lands, consider swapping the fixed `office_chair` in `lobby_ring` and
`lobby_cubicle_farm` ("rolled into the aisle") for the rolling version. A chair that has drifted
is the Tenant's calling card.
