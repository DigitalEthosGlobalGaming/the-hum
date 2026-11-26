# Props & Items: ideas list

A menu to pick from, not a commitment. Each idea is tagged with what it does for the theme and the
engine pieces it needs (see **Systems** at the bottom). ⭐ = my pick for the next batch.

Theme hooks we keep coming back to:
- **Light is safety:** the Tenant avoids lit space and sanity recovers there.
- **The building moves:** maps, marks and memory can't be trusted.
- **It moves when unseen:** looking, seeing and recording matter.
- **Earlier wanderers:** you're following (and becoming) someone else's trail.

---

## A. Light & power (the core loop)
| | Item / prop | Interaction | Why it matters | Needs |
|---|---|---|---|---|
| ⭐ | **Spare fluorescent tube** (2 pockets) | Carry it to a dead ceiling fixture and press E to install it. That cell lights up for good | Lets you build your own safe rooms. Your choice of where to spend light | power, carry |
| ⭐ | **Fuse box** (exists) | Insert a fuse. Every dead light in that room and its neighbours stutters on | Turns the existing fuse loop into a big, visible reward | power |
| ⭐ | **Wall light switch** | Toggle the room's lights. Some rooms only reveal writing or arrows when the lights are **off** | Puts dark and light in tension: you must make it dark to learn something | power, glow decals |
| ⭐ | **Glow sticks** (3 per pack) | Crack and drop one. A green light marker for about 5 min | Breadcrumbs that light the way back. Finite | throw/drop, timed light |
| | **Matches** | Strike for 10 s of tiny light. Lights candles and reads notes in the dark | A last resort when the torch is dead | timed light |
| | **Candle stub** | Place it and light it with a match. A small permanent safe spot | Slow, ritual-feeling safety | timed light |
| ⭐ | **Disposable flash camera** (12 shots) | Flash: briefly lights a room and **freezes** the Tenant for about 3 s. Every photo goes into the notebook and sometimes shows things you didn't see (writing, a figure behind you) | Ties together seeing, recording and the Tenant rule. Very on-theme | camera render-to-texture, notebook pages |

## B. Navigation & memory (the building moves)
| | Item / prop | Interaction | Why it matters | Needs |
|---|---|---|---|---|
| | **Chalk** (exists) | Wall marks and floor arrows | Your marks sometimes vanish or point somewhere new when the building moves | (done) |
| ⭐ | **Ball of red string** | Tie it off. It unspools behind you as a line on the floor (about 150 m). Press E on it to reel back | A literal thread out of the maze. Something may cut it | line renderer, carry state |
| ⭐ | **"You are here" evacuation map** (wall prop) | Read it: sketches the true layout of about 3 blocks into your notebook map. Some are wrong on purpose | Uses the real WFC layout, rewards reading the walls | map API |
| | **Compass** | The needle points to "the source of the hum" (the exit direction). It spins wildly near the Tenant | Wayfinding plus a danger sensor in one object | |
| | **Polaroid of a room** | Shows a specific room template. Standing in that room triggers a reward or event | A treasure hunt that uses the room library | room ids |
| | **Exit sign** (wall prop) | Most point wrong. True ones flicker | Trust nothing | |

## C. Sound, lures & communication
| | Item / prop | Interaction | Why it matters | Needs |
|---|---|---|---|---|
| ⭐ | **Tape recorder** (exists) + **blank tape** | Record 10 s, then **drop it playing** to lure the Tenant to that spot | Turns story audio into a stealth tool | noise events |
| ⭐ | **Walkie-talkie** | Static. Sometimes another wanderer talks back with hints. Static spikes when the Tenant is near. Find a second one and leave it somewhere as a remote ear | Companionship and dread. Diegetic danger meter | noise events |
| | **Desk phone** (exists) + keypad | Dial numbers found in notes to trigger events (lights on, a door unlocks, a voice) | Notes become puzzle inputs | keypad UI |
| | **Service bell** | Ding. The Tenant hears it. Sometimes it dings by itself | A cheap scare and lure | noise events |
| | **Boombox** | Loops a tinny song. Masks your footsteps nearby but attracts the Tenant to it | A risk/reward stealth tool | noise events |
| | **Intercom panel** | Press to talk. Something answers in captions | Story delivery | |

## D. Sanity & survival
| | Item / prop | Interaction | Why it matters | Needs |
|---|---|---|---|---|
| | **Almond water** (exists) | +sanity | Staple | (done) |
| ⭐ | **Vending machine** + **coins** | Insert a coin and it rolls from a pool (snacks, batteries, rare items). Sometimes it eats the coin, sometimes it drops something wrong | Shows off the pool system and gives coins a purpose | container, pools |
| | **Water cooler** | Drink for a small sanity gain. Glug. Occasionally the water is black (sanity loss) | Familiar office object turned uncanny | |
| ⭐ | **Music box** | Wind it up. While it plays (30 s), sanity doesn't drain and the Tenant won't enter the room | A portable, temporary safe room | timed effect, AI hook |
| | **Expired pills** | Big sanity boost, then hallucinations later | A delayed cost | timed effect |

## E. Story & mystery
| | Item / prop | Interaction | Why it matters | Needs |
|---|---|---|---|---|
| ⭐ | **ID badges** (lanyards) | Each has a name and photo, and adds a "wanderer" page to the notebook. Also opens **keycard doors** | Faces for the earlier wanderers. Gates optional rooms | lock/key, doors |
| ⭐ | **Filing cabinet** | Three drawers open separately, each rolled from a pool (notes, coins, a key, nothing). One drawer is always stuck | Satisfying searching. Containers | container |
| ⭐ | **Typewriter** | Press E: it types the next story line onto the paper. Sometimes it types **what you're doing right now** | Signature creepy moment | text surface |
| | **CRT TV on a cart** (pushable) | Static. Sometimes shows a security feed of **you from behind** | Meta dread. Uses render-to-texture | camera RTT |
| | **Security monitor desk** | Feeds of other rooms. One shows the Tenant or an item. Click to cycle | Scouting | camera RTT |
| | **Whiteboard + marker** | Write a short word with the marker. Later it has been answered | Two-way conversation with the building | text surface |
| | **Mannequin** | Moves when unseen (a red herring that looks like the Tenant rule) | Trains then subverts the rule | anomaly |
| | **Wall clocks** | All show different times. Set your watch to match one and something opens | A diegetic puzzle using the watch | |
| | **Dead elevator** | Needs fuses and a badge. Leads to the ending | Endgame anchor | power, lock |

## F. Physical props (static vs dynamic)
Every prop gets a `physics` mode in its JSON:
`static` (desks, cabinets) · `push` (slides or rolls when you walk into it) · `carry` (pick up and hold in front of you, place anywhere) · `throw` (small things you can toss).

| | Prop | Mode | Behaviour | Theme hook |
|---|---|---|---|---|
| ⭐ | **Office chair** | push (roll) | Rolls and **spins** on casters, coasts with friction, bumps walls and props. A squeak loop scales with speed | **A chair rolling by itself = the Tenant just passed** |
| ⭐ | **Janitor / AV cart** | push | Heavier, rolls straight. You can **wedge it in a doorway** to slow the Tenant | Barricades |
| ⭐ | **Cardboard box** | push + carry | Light, slides. Can be carried in front of you. Items can hide underneath | Search |
| ⭐ | **Wet floor sign** | push → topples | Knocked over with a clatter (noise the Tenant hears) | Stealth cost |
| | **Trash bin** | push → tips | Tips over and spills a rolled item | Search |
| ⭐ | **Bottles / cans** | throw | Throw to make noise elsewhere (a lure). Rolls along the floor | Stealth tool |
| | **Doors** | swing | Open/close. Block line of sight. **The Tenant opens doors** (you hear it) | Hiding |
| | **Desk, filing cabinet, vending machine** | static | Solid | |

## G. Hiding spots
**Under desks** (crouch), **lockers**, **supply closets**. Peek through the slats. The Tenant checks some of them.

---

## Systems these need
| System | What it is | Unlocks |
|---|---|---|
| **physics** component ⭐ | Lightweight 2D kinematic bodies (no physics library): the player pushes, objects slide or roll with friction and spin, collide with walls and props, and topple when tall | chairs, carts, boxes, signs, bins, bottles |
| **noise events** ⭐ | `world.noise(pos, loudness)` from footsteps, clatters, thrown objects and devices. The Tenant (M6) listens | lures, stealth costs |
| **power network** ⭐ | Room lights have states (on/dead/flicker). Fuse boxes, switches and tubes change them. Sanity and the Tenant react to light | the light loop |
| **containers** ⭐ | Drawers and machines that roll a pool on open | cabinets, vending machines, bins |
| **locks & doors** | Door prop with locked/keycard state. Badges and keys open it | badges, offices, elevator |
| **carry / throw** | Hold a prop in front (not in a pocket), place or throw it with an arc | boxes, bottles, tubes |
| timed effects | Lights or auras with a duration | glow sticks, music box, matches |
| text surfaces | Writing that changes (typewriter, whiteboard) | story moments |
| camera render-to-texture | Draw the world from another camera onto a prop | flash camera photos, CRT, monitors |
| keypad UI | A diegetic number entry | phones, doors |

## Suggested next batch (all ⭐)
1. **Physics component:** rolling and spinning chairs, carts, boxes, toppling signs, throwable cans. Noise events come with it.
2. **Power network:** fuse boxes light rooms, light switches, spare tubes, glow sticks.
3. **Containers:** filing cabinets and a vending machine with coins.
4. **Story props:** typewriter, ID badges (as notebook pages for now), evacuation map, walkie-talkie, music box, flash camera, red string.
