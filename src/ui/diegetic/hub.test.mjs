// node --test src/ui/diegetic/ src/settings/
// The notebook hub's pure parts: section routing, Notes / Secrets layout and pagination, key labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, sectionOf, entriesIn, notesRows, secretsRows, paginate, pageOfId, chunk } from './hub.js';
import { keyLabel, keyLabels, controlsList } from './keys.js';
import { loadContent } from '../../../tools/lib/loadContent.mjs';

const { content } = loadContent();

test('sections are in page order', () => {
  assert.deepEqual(SECTIONS.map((s) => s.id), ['settings', 'controls', 'map', 'notes', 'photos', 'wanderers', 'secrets']);
});

test('addPage kinds route into sections; unknown kinds go to Notes', () => {
  assert.equal(sectionOf('map'), 'map');
  assert.equal(sectionOf('mapReveal'), 'map');
  assert.equal(sectionOf('photo'), 'photos');
  assert.equal(sectionOf('wanderer'), 'wanderers');
  assert.equal(sectionOf('note'), 'notes');
  assert.equal(sectionOf('learned'), 'notes');
  assert.equal(sectionOf('secret'), 'secrets');
  assert.equal(sectionOf('something_new'), 'notes');
  assert.equal(sectionOf(undefined), 'notes');
  const entries = [{ kind: 'map' }, { kind: 'photo', id: 'p' }, { kind: 'weird', id: 'w' }, { kind: 'note', id: 'n' }];
  assert.deepEqual(entriesIn(entries, 'notes').map((e) => e.id), ['w', 'n']);
});

test('notes index: learned block first, spine progress with blanks, scraps after', () => {
  const notes = {
    s1: { id: 's1', title: 'One', spine: 1 }, s2: { id: 's2', title: 'Two', spine: 2 }, s3: { id: 's3', title: 'Three', spine: 3 },
    f1: { id: 'f1', title: 'Frag' },
  };
  const entries = [
    { kind: 'note', id: 's2', title: 'Two' },
    { kind: 'learned', id: 'l1', text: 'it hates the light' },
    { kind: 'note', id: 'f1', title: 'Frag' },
    { kind: 'odd', id: 'x', title: 'Odd page' },
  ];
  const rows = notesRows(entries, notes);
  const types = rows.map((r) => r.type);
  assert.equal(types[0], 'heading');
  assert.equal(rows[0].text, "what I've learned");
  assert.equal(rows[1].type, 'learned');
  const prog = rows.find((r) => r.type === 'heading' && /pages/.test(r.text));
  assert.equal(prog.text, '1 / 3 pages');
  assert.deepEqual(rows.filter((r) => r.type === 'blank').map((r) => r.text), ['1.', '3.']);
  assert.equal(rows.find((r) => r.id === 's2').text, '2. Two');
  const scrapsAt = rows.findIndex((r) => r.text === 'scraps');
  assert.ok(scrapsAt > rows.indexOf(prog));
  assert.deepEqual(rows.slice(scrapsAt + 1).map((r) => r.id), ['f1', 'x']);
});

test('notes index with real content: 12 spine pages, progress counts what was found', () => {
  const ids = Object.values(content.notes).filter((n) => Number.isInteger(n.spine)).slice(0, 7).map((n) => n.id);
  const rows = notesRows(ids.map((id) => ({ kind: 'note', id, title: content.notes[id].title })), content.notes);
  assert.equal(rows[0].text, '7 / 12 pages');
  assert.equal(rows.filter((r) => r.type === 'blank').length, 5);
});

test('paginate: fits perPage, keeps headings with their first row, drops leading gaps', () => {
  const rows = [];
  rows.push({ type: 'heading', text: 'A', h: 1 });
  for (let i = 0; i < 8; i++) rows.push({ type: 'note', id: 'a' + i, h: 1 });
  rows.push({ type: 'gap', h: 0.5 });
  rows.push({ type: 'heading', text: 'B', h: 1 });
  for (let i = 0; i < 5; i++) rows.push({ type: 'note', id: 'b' + i, h: 1 });
  const pages = paginate(rows, 10);
  for (const p of pages) assert.ok(p.reduce((s, r) => s + r.h, 0) <= 10, 'page overflows');
  for (const p of pages) {
    assert.notEqual(p.at(-1).type, 'heading', 'heading orphaned at page bottom');
    assert.notEqual(p[0].type, 'gap');
  }
  assert.equal(pages.flat().filter((r) => r.type === 'note').length, 13);
  assert.equal(pageOfId(pages, 'b4'), pages.length - 1);
  assert.equal(pageOfId(pages, 'nope'), -1);
  // tall rows are clipped to a page
  const tall = paginate([{ type: 'learned', lines: ['1', '2', '3', '4'], h: 4 }], 3);
  assert.equal(tall[0][0].h, 3);
  assert.deepEqual(paginate([], 5), [[]]);
});

test('secrets: found show titles, unfound never reveal them, progress header', () => {
  const list = [
    { id: 'a', title: 'The tall door', hint: 'it was there twice', found: true },
    { id: 'b', title: 'SECRET TITLE', hint: '', found: false },
    { id: 'c', title: 'ALSO HIDDEN', hint: 'listen near the vents', found: false },
  ];
  const rows = secretsRows(list, []);
  assert.equal(rows[0].text, 'oddities 1 / 3');
  assert.equal(rows[1].text, 'The tall door');
  assert.equal(rows[1].note, 'it was there twice');
  assert.equal(rows[2].text, '? ? ?');
  assert.equal(rows[2].h, 1); // no hint line
  assert.equal(rows[3].note, 'listen near the vents');
  assert.ok(!JSON.stringify(rows).includes('SECRET TITLE') && !JSON.stringify(rows).includes('ALSO HIDDEN'));
  // missing secrets system + an addPage({kind:'secret'}) entry
  const r2 = secretsRows(undefined, [{ kind: 'secret', id: 'z', title: 'Odd clock', text: 'ran backwards' }]);
  assert.equal(r2[0].text, 'oddities 1 / 1');
  assert.equal(secretsRows()[1].type, 'empty');
  assert.equal(chunk([1, 2, 3], 2).length, 2);
});

test('key labels', () => {
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('Escape'), 'Esc');
  assert.equal(keyLabel('Tab'), 'Tab');
  assert.equal(keyLabel('Enter'), 'Enter');
  assert.equal(keyLabel('ShiftLeft'), 'Shift');
  assert.equal(keyLabel('ControlLeft'), 'Ctrl');
  assert.equal(keyLabel('Mouse0'), 'left click');
  assert.equal(keyLabel('Mouse2'), 'right click');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('F3'), 'F3');
  assert.equal(keyLabel('Numpad4'), 'num 4');
  assert.deepEqual(keyLabels(['ShiftLeft', 'ShiftRight']), ['Shift']);
});

test('controls list from config.keys', () => {
  const rows = controlsList(content.config.keys);
  const by = Object.fromEntries(rows.map((r) => [r.label, r.keys]));
  for (const l of ['move', 'sprint', 'crouch', 'interact', 'use', 'drop', 'throw', 'pockets', 'watch', 'notebook', 'pause', 'flashlight', 'fullscreen']) {
    assert.ok(by[l], `missing ${l}`);
  }
  assert.equal(by.move, 'W A S D / arrows');
  assert.equal(by.sprint, 'Shift');
  assert.equal(by.use, 'left click / R');
  assert.equal(by.pockets, 'Q');
  assert.equal(by.watch, 'Z (hold)');
  assert.equal(by.notebook, 'Tab / M');
  assert.equal(by.pause, 'Esc');
  assert.equal(by.flashlight, 'F');
  assert.equal(by.fullscreen, 'Enter');
  assert.equal(by['pick pocket'], '1-4 / wheel');
  // unbound rows drop out
  assert.equal(controlsList({ interact: ['KeyE'] }).length, 1);
});
