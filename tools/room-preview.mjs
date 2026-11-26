// Print a room's layout as ASCII with its objects and spawn spots marked, to sanity-check positions.
//   node tools/room-preview.mjs <room_id>
// Local metres → cells: cell = 2 m, x → column, z → row (row 0 = top of the layout = north).
import { loadContent } from './lib/loadContent.mjs';
import { CELL, TILE_KINDS } from './validate.mjs';

// Display glyph per tile kind (independent of the room's own legend characters,
// so they never clash with the object letters and spot digits).
const GLYPH = { wall: '#', pillar: '%', floor: '.', door: '=', light: '*', deadlight: 'x', flickerlight: 'f', void: ' ' };
const OBJ_MARKS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SPOT_MARKS = '123456789abcdefghijklmnopqrstuvwxyz';

const fmtPos = (p) => Array.isArray(p) ? `[${p.map((v) => +Number(v).toFixed(2)).join(', ')}]` : String(p);
const poolDesc = (pool) => {
  if (typeof pool === 'string') return pool;
  const entries = Array.isArray(pool) ? pool : pool?.entries ?? [];
  const total = entries.reduce((s, e) => s + (e.w > 0 ? e.w : 0), 0) || 1;
  return '(inline) ' + entries.map((e) => `${e.pool ? 'pool:' + e.pool : e.def ?? 'nothing'} ${Math.round((e.w / total) * 100)}%`).join(', ');
};

function main() {
  const id = process.argv[2];
  const { content, sources } = loadContent();
  const rooms = content.rooms ?? {};
  if (!id || id.startsWith('-')) {
    console.error(`usage: node tools/room-preview.mjs <room_id>\nrooms: ${Object.keys(rooms).sort().join(', ') || '(none)'}`);
    process.exit(2);
  }
  const room = rooms[id];
  if (!room) {
    console.error(`unknown room "${id}". Known: ${Object.keys(rooms).sort().join(', ') || '(none)'}`);
    process.exit(1);
  }
  const layout = room.layout ?? [];
  const legend = room.legend ?? {};
  const rows = layout.length;
  const cols = Math.max(0, ...layout.map((r) => r.length));

  // grid[row][col] = [base, overlay]; each cell prints as 2 chars so the room keeps its aspect.
  const grid = layout.map((row) => Array.from({ length: cols }, (_, x) => {
    const kind = legend[row[x]];
    const g = row[x] === undefined ? '?' : kind ? (GLYPH[kind] ?? '?') : '?';
    return { a: g, b: g === '#' || g === '%' ? g : ' ', marks: [] };
  }));

  const notes = [];
  const place = (mark, pos, label) => {
    if (!Array.isArray(pos) || pos.length < 3) { notes.push(`${mark}  ${label}  BAD POS ${fmtPos(pos)}`); return; }
    const cx = Math.floor(pos[0] / CELL), cz = Math.floor(pos[2] / CELL);
    const inside = cx >= 0 && cz >= 0 && cx < cols && cz < rows;
    let flags = '';
    if (!inside) flags = '  OUTSIDE ROOM';
    else {
      const cell = grid[cz][cx];
      const kind = legend[layout[cz][cx]];
      if (TILE_KINDS[kind] !== false) flags = `  IN SOLID (${kind ?? 'unknown'})`;
      if (cell.marks.length) flags += `  shares cell with ${cell.marks.join(',')}`;
      cell.marks.push(mark);
    }
    notes.push(`${mark}  ${label}  @ ${fmtPos(pos)} → col ${cx}, row ${cz}${flags}`);
  };

  const objLines = [];
  (room.objects ?? []).forEach((o, i) => {
    const mark = OBJ_MARKS[i] ?? '+';
    const before = notes.length;
    place(mark, o.pos, `${o.def}${o.rot != null ? ` rot ${o.rot}°` : ''}`);
    objLines.push(...notes.splice(before));
  });
  const spotLines = [];
  (room.spots ?? []).forEach((s, i) => {
    const mark = SPOT_MARKS[i] ?? '+';
    const before = notes.length;
    place(mark, s.pos, `spot "${s.id}" pool ${poolDesc(s.pool)}${s.rot != null ? ` rot ${s.rot}°` : ''}`);
    spotLines.push(...notes.splice(before));
  });
  let spawnLine = null;
  if (room.spawn?.pos) {
    const before = notes.length;
    place('@', room.spawn.pos, `player spawn${room.spawn.rot != null ? ` rot ${room.spawn.rot}°` : ''}`);
    spawnLine = notes.splice(before)[0];
  }

  // Markers: first mark in the left char, second (if any) in the right char.
  for (const row of grid) for (const c of row) {
    if (c.marks[0]) c.a = c.marks[0];
    if (c.marks[1]) c.b = c.marks[c.marks.length - 1];
  }

  const tens = '    ' + Array.from({ length: cols }, (_, x) => (x >= 10 ? String(Math.floor(x / 10)) : ' ') + ' ').join('');
  const ones = '    ' + Array.from({ length: cols }, (_, x) => String(x % 10) + ' ').join('');
  console.log(`room ${room.id ?? id}  (${sources.rooms?.[id] ?? ''})`);
  console.log(`${cols}×${rows} cells = ${cols * CELL}×${rows * CELL} m${room.slots ? `, slots ${JSON.stringify(room.slots)}` : ''}${room.zones ? `, zones ${JSON.stringify(room.zones)}` : ''}`);
  console.log(`x → columns, z ↓ rows, cell = ${CELL} m. North (-z) is up.`);
  console.log();
  if (cols >= 10) console.log(tens.trimEnd());
  console.log(ones.trimEnd());
  grid.forEach((row, z) => console.log(String(z).padStart(3) + ' ' + row.map((c) => c.a + c.b).join('').trimEnd()));
  console.log();
  const usedKinds = [...new Set(Object.values(legend))].filter((k) => GLYPH[k] !== undefined);
  console.log('tiles:   ' + usedKinds.map((k) => `${JSON.stringify(GLYPH[k])} ${k}`).join('   ') + '   "?" not in legend');
  if (objLines.length) { console.log('objects:'); objLines.forEach((l) => console.log('  ' + l)); }
  if (spotLines.length) { console.log('spots:'); spotLines.forEach((l) => console.log('  ' + l)); }
  if (spawnLine) console.log('spawn:\n  ' + spawnLine);
}

main();
