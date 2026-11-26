// Set-dressing prefabs for THE HUM's rooms (art & level direction; see docs/LEVEL_DIRECTION.md).
// Pure data, no imports: register.js hands it to the engine, and Node tools can read it too.
//
// Same format as src/objects/prefabs.js: each part is a box { size, pos (centre), rot?, tint?,
// texture?, emissive? } in object-local metres, y up, origin on the floor, front faces -z.
//
// Conventions for placing these in rooms:
// - Freestanding props: the origin is the centre of the footprint.
// - Wall-hung props (whiteboard, cork board, clock, door to nowhere): the back face sits
//   WALL_INSET (0.13 m) behind the origin, so the origin goes 0.13 m off the wall, the same as
//   the fuse box (a 0.25 m-deep box with a centred origin). One "wall_*" spot then fits both.
// - Desk and table tops are at 0.76 m.
// - Ceiling props (stains, the hole above a fallen tile) are built at y ≈ 3 m and placed at y 0.

export const WALL_INSET = 0.13;
const B = WALL_INSET; // back plane of wall-hung props (local +z)

const WOOD = '#6f5b43';
const WOOD_DARK = '#54442f';
const METAL = '#2a2a2a';
const STEEL = '#7d7f7a';
const CARD = '#d8c098';
const BOOKS = ['#5a2e24', '#2f3d52', '#4a4a32', '#6b5a3a', '#30302c', '#6a3a2a', '#3b4a3e'];

/** A stacking chair (plastic shell on steel legs), lifted by y and nudged by dx/dz. */
function stackingChair(y = 0, dx = 0, dz = 0, ry = 0, tint = '#4a5560') {
  return [
    { size: [0.44, 0.035, 0.42], pos: [dx, y + 0.45, dz], rot: [0, ry, 0], tint },              // seat
    { size: [0.44, 0.32, 0.03], pos: [dx, y + 0.72, dz + 0.22], rot: [-10, ry, 0], tint },     // back
    { size: [0.025, 0.45, 0.025], pos: [dx - 0.2, y + 0.225, dz - 0.18], tint: METAL },        // legs
    { size: [0.025, 0.45, 0.025], pos: [dx + 0.2, y + 0.225, dz - 0.18], tint: METAL },
    { size: [0.025, 0.86, 0.025], pos: [dx - 0.2, y + 0.43, dz + 0.2], tint: METAL },
    { size: [0.025, 0.86, 0.025], pos: [dx + 0.2, y + 0.43, dz + 0.2], tint: METAL },
  ];
}

/** Nested stack: legs and backs repeat every `step`, drifting by `lean` per chair (the wrong one). */
function chairStack(n, step, lean = 0, twist = 0) {
  const parts = stackingChair(0);
  for (let i = 1; i < n; i++) {
    const y = i * step;
    const dx = lean * i * i * 0.5;
    const ry = twist * Math.sin(i * 1.7);
    parts.push(
      { size: [0.44, 0.035, 0.42], pos: [dx, y + 0.45, 0], rot: [0, ry, 0], tint: '#4a5560' },
      { size: [0.44, 0.32, 0.03], pos: [dx, y + 0.72, 0.22], rot: [-10, ry, 0], tint: '#4a5560' },
    );
  }
  // one long leg pair per side stands in for the nested legs (keeps the poly count down)
  const top = (n - 1) * step;
  const topDx = lean * (n - 1) * (n - 1) * 0.5;
  const tilt = -Math.atan2(topDx, top || 1) * 180 / Math.PI;
  for (const sx of [-0.2, 0.2]) {
    const front = top + 0.45, back = top + 0.86;
    parts.push({ size: [0.025, front, 0.025], pos: [sx + topDx / 2, front / 2, -0.18], rot: [0, 0, tilt], tint: METAL });
    parts.push({ size: [0.025, back, 0.025], pos: [sx + topDx / 2, back / 2, 0.2], rot: [0, 0, tilt], tint: METAL });
  }
  return parts;
}

function shelfUnit({ w = 1.2, d = 0.45, h = 1.95, shelves = [0.12, 0.57, 1.02, 1.47, 1.92], tint = STEEL } = {}) {
  const parts = [];
  for (const sx of [-w / 2 + 0.02, w / 2 - 0.02]) for (const sz of [-d / 2 + 0.02, d / 2 - 0.02]) {
    parts.push({ size: [0.035, h, 0.035], pos: [sx, h / 2, sz], tint });
  }
  for (const y of shelves) parts.push({ size: [w, 0.025, d], pos: [0, y - 0.0125, 0], tint });
  return parts;
}

/** A cable lying on the floor through the given [x, z] points (one thin box per stretch). */
function cord(points, tint = '#c45a14') {
  const parts = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    parts.push({ size: [0.03, 0.02, len + 0.03], pos: [(ax + bx) / 2, 0.01, (az + bz) / 2], rot: [0, Math.atan2(dx, dz) * 180 / Math.PI, 0], tint });
  }
  return parts;
}

function box(size, pos, ry = 0, tint = CARD) {
  return { size, pos: [pos[0], pos[1] + size[1] / 2, pos[2]], rot: [0, ry, 0], tint, texture: 'proc:cardboard' };
}

export const decorPrefabs = {
  // ── furniture ──────────────────────────────────────────────────────────────
  decor_conference_table: [
    { size: [2.4, 0.05, 1.1], pos: [0, 0.735, 0], tint: WOOD_DARK },
    { size: [2.3, 0.02, 1.0], pos: [0, 0.7, 0], tint: '#3f3324' },                       // underside lip
    ...[[-1.08, -0.43], [1.08, -0.43], [-1.08, 0.43], [1.08, 0.43]].map(([x, z]) => (
      { size: [0.06, 0.71, 0.06], pos: [x, 0.355, z], tint: METAL })),
    { size: [2.0, 0.08, 0.04], pos: [0, 0.3, 0], tint: METAL },                          // stretcher
  ],

  decor_metal_shelf: shelfUnit(),

  decor_metal_shelf_stocked: [
    ...shelfUnit(),
    box([0.42, 0.3, 0.36], [-0.32, 0.12, 0], 4),
    box([0.36, 0.24, 0.34], [0.12, 0.12, 0.02], -6, '#c4a478'),
    box([0.5, 0.36, 0.38], [-0.22, 0.57, 0], 0),
    box([0.3, 0.2, 0.3], [-0.25, 1.02, -0.02], 12, '#e2cc9c'),
    box([0.28, 0.2, 0.3], [0.1, 1.02, 0], -3),
    { size: [0.08, 0.3, 0.24], pos: [0.36, 1.17, 0], rot: [0, 0, -14], tint: '#2f3d52' },  // binders
    { size: [0.08, 0.3, 0.24], pos: [0.45, 1.17, 0], tint: '#5a2e24' },
    box([0.46, 0.32, 0.38], [0.2, 1.47, 0], 8),
  ],

  decor_bookcase: (() => {
    const parts = [
      { size: [0.9, 1.8, 0.02], pos: [0, 0.9, 0.15], tint: WOOD_DARK },                 // back
      { size: [0.03, 1.8, 0.32], pos: [-0.435, 0.9, 0], tint: WOOD },                    // sides
      { size: [0.03, 1.8, 0.32], pos: [0.435, 0.9, 0], tint: WOOD },
    ];
    const shelfY = [0.08, 0.5, 0.92, 1.34, 1.78];
    for (const y of shelfY) parts.push({ size: [0.84, 0.03, 0.3], pos: [0, y, 0], tint: WOOD });
    // a few runs of books per shelf, some gaps, one leaning run (bottom shelf is half empty)
    const runs = [
      [0, -0.38, 0.22, 0.3], [0, 0.0, 0.12, 0.26],
      [1, -0.38, 0.5, 0.32], [1, 0.2, 0.16, 0.28],
      [2, -0.3, 0.28, 0.3], [2, 0.08, 0.3, 0.33],
      [3, -0.38, 0.18, 0.27], [3, 0.12, 0.2, 0.3],
    ];
    runs.forEach(([s, x0, w, h], i) => {
      parts.push({ size: [w, h, 0.22], pos: [x0 + w / 2, shelfY[s] + 0.015 + h / 2, 0.01], tint: BOOKS[i % BOOKS.length] });
    });
    parts.push({ size: [0.06, 0.28, 0.22], pos: [-0.05, 0.5 + 0.17, 0.01], rot: [0, 0, 18], tint: BOOKS[3] }); // leaning book
    return parts;
  })(),

  decor_stacking_chair: stackingChair(0),

  // five identical chairs in a perfect row (0.9 m apart), one object so the row is one collider
  decor_chair_row: [-1.8, -0.9, 0, 0.9, 1.8].flatMap((x) => stackingChair(0, x)),
  // the same row with the right-hand chair missing (it is somewhere else, facing the wrong way)
  decor_chair_row_gap: [-1.8, -0.9, 0, 0.9].flatMap((x) => stackingChair(0, x)),

  decor_stacked_chairs: chairStack(6, 0.11),

  // the wrong one: stacked to the ceiling, leaning a little more with every chair
  decor_stacked_chairs_ceiling: chairStack(20, 0.108, 0.0016, 6),

  decor_cubicle_panel: [
    { size: [1.6, 1.3, 0.06], pos: [0, 0.69, 0], tint: '#8a8e96', texture: 'proc:decor_fabric' },
    { size: [1.62, 0.04, 0.08], pos: [0, 1.36, 0], tint: '#9a9a94' },                     // top cap
    { size: [0.04, 1.36, 0.08], pos: [-0.8, 0.68, 0], tint: '#9a9a94' },                  // end caps
    { size: [0.04, 1.36, 0.08], pos: [0.8, 0.68, 0], tint: '#9a9a94' },
    { size: [0.06, 0.04, 0.16], pos: [-0.6, 0.02, 0], tint: METAL },                      // feet
    { size: [0.06, 0.04, 0.16], pos: [0.6, 0.02, 0], tint: METAL },
  ],

  decor_coat_rack: [
    { size: [0.42, 0.04, 0.42], pos: [0, 0.02, 0], tint: METAL },
    { size: [0.04, 1.78, 0.04], pos: [0, 0.91, 0], tint: '#3a3632' },
    { size: [0.26, 0.03, 0.03], pos: [0, 1.74, 0], rot: [0, 0, 20], tint: '#3a3632' },     // hooks
    { size: [0.03, 0.03, 0.26], pos: [0, 1.7, 0], rot: [-20, 0, 0], tint: '#3a3632' },
    { size: [0.42, 0.85, 0.12], pos: [0.02, 1.22, -0.13], rot: [6, 0, 3], tint: '#5e5444' }, // the coat nobody took
    { size: [0.2, 0.2, 0.1], pos: [0.02, 1.62, -0.13], rot: [6, 0, 0], tint: '#5e5444' },     // collar
  ],

  decor_dead_plant: [
    { size: [0.34, 0.3, 0.34], pos: [0, 0.15, 0], tint: '#7a4a32' },
    { size: [0.38, 0.05, 0.38], pos: [0, 0.31, 0], tint: '#6a3e2a' },                     // rim
    { size: [0.3, 0.02, 0.3], pos: [0, 0.325, 0], tint: '#2a2018' },                      // dry soil
    { size: [0.025, 0.7, 0.025], pos: [0.02, 0.66, 0], rot: [0, 0, 6], tint: '#5a4a2a' },
    { size: [0.02, 0.55, 0.02], pos: [-0.07, 0.58, 0.03], rot: [12, 0, -18], tint: '#5a4a2a' },
    { size: [0.02, 0.45, 0.02], pos: [0.09, 0.52, -0.04], rot: [-15, 0, 22], tint: '#5a4a2a' },
    { size: [0.16, 0.01, 0.06], pos: [0.1, 0.98, 0.01], rot: [0, 30, -50], tint: '#7a6a3a' },  // last leaves, drooping
    { size: [0.14, 0.01, 0.05], pos: [-0.16, 0.8, 0.05], rot: [0, -20, 60], tint: '#6e5e30' },
    { size: [0.12, 0.005, 0.05], pos: [0.18, 0.006, 0.12], rot: [0, 40, 0], tint: '#6e5e30' }, // fallen leaf
  ],

  decor_trash_bin: [
    { size: [0.3, 0.36, 0.3], pos: [0, 0.18, 0], tint: '#4a4c4a' },
    { size: [0.26, 0.01, 0.26], pos: [0, 0.355, 0], tint: '#141414' },                    // the dark inside
    { size: [0.09, 0.08, 0.09], pos: [0.05, 0.38, -0.02], rot: [20, 30, 10], tint: '#d9d2bd', texture: 'proc:paper' },
  ],

  decor_box_stack: [
    box([0.6, 0.45, 0.5], [0, 0, 0], 2),
    box([0.55, 0.4, 0.48], [0.02, 0.45, 0.01], -7, '#c4a478'),
    box([0.42, 0.32, 0.4], [-0.04, 0.85, -0.02], 11, '#e2cc9c'),
  ],

  decor_box_stack_tall: [
    box([0.6, 0.45, 0.5], [0, 0, 0], 0),
    box([0.6, 0.45, 0.5], [0.66, 0, 0.02], 3, '#c4a478'),
    box([0.58, 0.42, 0.5], [0.01, 0.45, 0], -4, '#e2cc9c'),
    box([0.55, 0.4, 0.48], [0.64, 0.45, 0], 6),
    box([0.5, 0.38, 0.44], [0.05, 0.87, 0.02], 9, '#c4a478'),
    box([0.44, 0.34, 0.4], [0.6, 0.85, -0.03], -10, '#e2cc9c'),
    box([0.42, 0.32, 0.4], [0.1, 1.25, 0], -14),
  ],

  // ── wall-hung (back face at +WALL_INSET) ───────────────────────────────────
  decor_whiteboard: [
    { size: [1.8, 1.1, 0.025], pos: [0, 1.5, B - 0.0125], tint: '#ffffff', texture: 'proc:decor_whiteboard' },
    { size: [1.84, 0.03, 0.04], pos: [0, 2.065, B - 0.02], tint: '#a8aaa8' },             // frame
    { size: [1.84, 0.03, 0.04], pos: [0, 0.935, B - 0.02], tint: '#a8aaa8' },
    { size: [0.03, 1.16, 0.04], pos: [-0.915, 1.5, B - 0.02], tint: '#a8aaa8' },
    { size: [0.03, 1.16, 0.04], pos: [0.915, 1.5, B - 0.02], tint: '#a8aaa8' },
    { size: [0.7, 0.03, 0.08], pos: [0.3, 0.91, B - 0.05], tint: '#a8aaa8' },             // marker tray
    { size: [0.12, 0.02, 0.02], pos: [0.45, 0.935, B - 0.06], rot: [0, 8, 0], tint: '#202a50' }, // dead marker
  ],

  decor_cork_board: [
    { size: [1.2, 0.9, 0.025], pos: [0, 1.5, B - 0.0125], tint: '#ffffff', texture: 'proc:decor_cork' },
    { size: [1.24, 0.03, 0.035], pos: [0, 1.965, B - 0.018], tint: WOOD },
    { size: [1.24, 0.03, 0.035], pos: [0, 1.035, B - 0.018], tint: WOOD },
    { size: [0.03, 0.96, 0.035], pos: [-0.615, 1.5, B - 0.018], tint: WOOD },
    { size: [0.03, 0.96, 0.035], pos: [0.615, 1.5, B - 0.018], tint: WOOD },
  ],

  decor_wall_clock: [
    { size: [0.34, 0.34, 0.05], pos: [0, 2.2, B - 0.025], tint: '#ffffff', texture: 'proc:decor_clock' },
    { size: [0.36, 0.02, 0.06], pos: [0, 2.38, B - 0.03], tint: '#2a2a2a' },
    { size: [0.36, 0.02, 0.06], pos: [0, 2.02, B - 0.03], tint: '#2a2a2a' },
    { size: [0.02, 0.36, 0.06], pos: [-0.18, 2.2, B - 0.03], tint: '#2a2a2a' },
    { size: [0.02, 0.36, 0.06], pos: [0.18, 2.2, B - 0.03], tint: '#2a2a2a' },
  ],

  decor_door_to_nowhere: [
    { size: [0.92, 2.04, 0.04], pos: [0, 1.02, B - 0.03], tint: '#ffffff', texture: 'door_wood' },
    { size: [0.08, 2.12, 0.1], pos: [-0.5, 1.06, B - 0.05], tint: '#6a5a44' },             // frame
    { size: [0.08, 2.12, 0.1], pos: [0.5, 1.06, B - 0.05], tint: '#6a5a44' },
    { size: [1.08, 0.08, 0.1], pos: [0, 2.08, B - 0.05], tint: '#6a5a44' },
    { size: [0.04, 0.04, 0.06], pos: [0.36, 1.0, B - 0.08], tint: '#b8a060' },            // knob
  ],

  // ── floor and ceiling decals / litter (no colliders) ───────────────────────
  decor_ceiling_stain: [
    { size: [1.6, 0.004, 1.2], pos: [0, 2.996, 0], tint: '#ffffff', texture: 'proc:decor_ceiling_stain' },
  ],

  // a leak: the stain on the ceiling and the damp patch it made on the carpet below
  decor_leak: [
    { size: [1.4, 0.004, 1.1], pos: [0, 2.996, 0], rot: [0, 25, 0], tint: '#ffffff', texture: 'proc:decor_ceiling_stain' },
    { size: [1.8, 0.004, 1.4], pos: [0.1, 0.004, 0.05], tint: '#ffffff', texture: 'proc:decor_water_stain' },
  ],

  decor_ceiling_tile_fallen: [
    { size: [0.6, 0.02, 0.6], pos: [0.1, 0.01, 0.05], rot: [0, 17, 0], tint: '#d8d0b8', texture: 'ceiling_small' },
    { size: [0.34, 0.02, 0.28], pos: [-0.38, 0.06, -0.12], rot: [0, -32, 14], tint: '#d8d0b8', texture: 'ceiling_small' },
    { size: [0.06, 0.02, 0.05], pos: [-0.1, 0.01, 0.4], rot: [0, 40, 0], tint: '#c8c0a8' },   // crumbs
    { size: [0.05, 0.02, 0.04], pos: [0.42, 0.01, -0.3], rot: [0, 10, 0], tint: '#c8c0a8' },
    { size: [0.6, 0.006, 0.6], pos: [0, 2.994, 0], tint: '#060504' },                    // the hole it left
    { size: [0.22, 0.32, 0.12], pos: [0.12, 2.84, 0.08], rot: [0, 0, 12], tint: '#b8a878' },  // insulation hanging out
  ],

  decor_extension_cord: [
    { size: [0.3, 0.05, 0.08], pos: [-0.95, 0.025, -0.2], rot: [0, 10, 0], tint: '#d8d4c4' },  // power strip
    ...cord([[-0.8, -0.18], [-0.45, 0.5], [0.25, 0.48], [0.68, 0.05], [0.8, -0.5]]),
    { size: [0.06, 0.04, 0.08], pos: [0.8, 0.02, -0.54], tint: '#2a2a2a' },                // unplugged end
  ],

  decor_paper_scatter: [
    { size: [0.21, 0.003, 0.29], pos: [0, 0.002, 0], rot: [0, 12, 0], tint: '#ffffff', texture: 'proc:paper' },
    { size: [0.21, 0.003, 0.29], pos: [0.24, 0.004, 0.1], rot: [0, -38, 0], tint: '#f0ece0', texture: 'proc:paper' },
    { size: [0.21, 0.003, 0.29], pos: [-0.2, 0.003, 0.18], rot: [0, 70, 0], tint: '#ffffff', texture: 'proc:paper' },
    { size: [0.21, 0.003, 0.29], pos: [0.08, 0.006, -0.26], rot: [0, -5, 0], tint: '#e8e4d4', texture: 'proc:paper' },
    { size: [0.21, 0.003, 0.14], pos: [-0.3, 0.004, -0.15], rot: [0, 25, 8], tint: '#ffffff', texture: 'proc:paper' },
  ],

  decor_sleeping_bag: [
    { size: [0.78, 0.1, 1.9], pos: [0, 0.05, 0], tint: '#3d4a35' },
    { size: [0.74, 0.05, 0.62], pos: [0.02, 0.13, 0.55], rot: [0, 4, 0], tint: '#4a5a40' },  // folded-back flap
    { size: [0.44, 0.12, 0.28], pos: [0, 0.16, -0.75], rot: [0, -6, 0], tint: '#5a5048' },  // rolled jacket for a pillow
    { size: [0.04, 0.01, 1.8], pos: [0.37, 0.1, 0], tint: '#a89a60' },                   // zip
  ],

  decor_blanket_heap: [
    { size: [0.9, 0.08, 0.7], pos: [0, 0.04, 0], rot: [0, 8, 0], tint: '#ffffff', texture: 'proc:decor_plaid' },
    { size: [0.6, 0.1, 0.45], pos: [0.12, 0.1, -0.1], rot: [6, -20, 4], tint: '#e8e0e0', texture: 'proc:decor_plaid' },
    { size: [0.4, 0.08, 0.3], pos: [-0.2, 0.15, 0.08], rot: [-10, 35, 8], tint: '#ffffff', texture: 'proc:decor_plaid' },
  ],

  // someone camped here: a flattened box for a floor, a sleeping bag, empties lined up neatly
  decor_camp: [
    { size: [1.3, 0.015, 2.1], pos: [0, 0.008, 0], rot: [0, 3, 0], tint: CARD, texture: 'proc:cardboard' },
    { size: [0.78, 0.1, 1.85], pos: [0.05, 0.065, 0.02], rot: [0, -4, 0], tint: '#3d4a35' },
    { size: [0.74, 0.05, 0.6], pos: [0.08, 0.14, 0.55], rot: [0, -2, 0], tint: '#4a5a40' },
    { size: [0.44, 0.12, 0.28], pos: [0.02, 0.17, -0.72], rot: [0, 8, 0], tint: '#5a5048' },
    // empties, lined up at the foot of the bed (and one knocked over)
    ...[0, 1, 2].map((i) => ({ size: [0.08, 0.24, 0.08], pos: [0.85, 0.12, 0.55 + i * 0.12], tint: '#9aa8a2', texture: 'proc:bottle' })),
    { size: [0.08, 0.08, 0.24], pos: [0.9, 0.04, 1.05], rot: [0, 30, 0], tint: '#9aa8a2', texture: 'proc:bottle' },
    { size: [0.09, 0.12, 0.09], pos: [-0.62, 0.06, -0.8], tint: '#8a8a80' },               // tin can
    { size: [0.3, 0.003, 0.22], pos: [-0.55, 0.018, 0.3], rot: [0, 20, 0], tint: '#ffffff', texture: 'proc:paper' }, // tally sheet
  ],
};
