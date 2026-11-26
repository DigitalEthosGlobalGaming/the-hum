// The notebook as the hub menu: sections, where addPage kinds go, and the Notes index layout.
// Pure (no DOM / three): shared by menu.js and the Node tests.

/** In page order. Index tabs show `label`. */
export const SECTIONS = [
  { id: 'settings', label: 'settings' },
  { id: 'controls', label: 'controls' },
  { id: 'map', label: 'map' },
  { id: 'notes', label: 'notes' },
  { id: 'photos', label: 'photos' },
  { id: 'wanderers', label: 'wanderers' },
  { id: 'secrets', label: 'secrets' },
];
export const SECTION_IDS = SECTIONS.map((s) => s.id);
export const sectionIndex = (id) => Math.max(0, SECTION_IDS.indexOf(id));

const KIND_SECTION = { map: 'map', mapReveal: 'map', photo: 'photos', wanderer: 'wanderers', note: 'notes', learned: 'notes', secret: 'secrets' };

/** Which section a notebook entry kind lives in. Unknown kinds are notes. */
export function sectionOf(kind) {
  return KIND_SECTION[kind] ?? 'notes';
}

/** Entries of one section, in the order they were added. */
export function entriesIn(entries, section) {
  return entries.filter((e) => sectionOf(e.kind) === section);
}

export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * The Notes index as rows (top to bottom):
 *   "what I've learned" + learned lines (kind 'learned', the Tenant's observations; not selectable)
 *   "N / M pages" + one row per spine note (found = selectable title, unfound = blank line)
 *   "scraps" + every other note (fragments, unknown kinds), selectable
 * Row: { type: 'heading'|'learned'|'note'|'blank'|'gap', text?, lines?, id?, h }  (h in lines)
 * @param entries  notebook entries routed to notes
 * @param notes    content.notes ({ id: { title, spine? } }) for the spine count + numbering
 * @param wrap     (text) → lines that fit the index width (learned lines can wrap)
 */
export function notesRows(entries, notes = {}, wrap = (t) => [t]) {
  const rows = [];
  const learned = entries.filter((e) => e.kind === 'learned');
  const spineOf = (e) => (Number.isInteger(notes[e.id]?.spine) ? notes[e.id].spine : Number.isInteger(e.spine) ? e.spine : null);
  const spineNotes = Object.values(notes).filter((n) => Number.isInteger(n.spine)).sort((a, b) => a.spine - b.spine);
  const found = new Map();
  const scraps = [];
  for (const e of entries) {
    if (e.kind === 'learned') continue;
    const n = spineOf(e);
    if (n != null) found.set(n, e); else scraps.push(e);
  }

  if (learned.length) {
    rows.push({ type: 'heading', text: "what I've learned", h: 1 });
    for (const e of learned) {
      const lines = wrap(String(e.text ?? e.caption ?? e.title ?? '')).filter(Boolean);
      if (lines.length) rows.push({ type: 'learned', id: e.id, lines, h: lines.length });
    }
    rows.push({ type: 'gap', h: 0.5 });
  }

  const numbers = spineNotes.map((n) => n.spine);
  for (const n of found.keys()) if (!numbers.includes(n)) numbers.push(n);
  numbers.sort((a, b) => a - b);
  if (numbers.length) {
    rows.push({ type: 'heading', text: `${found.size} / ${numbers.length} pages`, h: 1 });
    for (const n of numbers) {
      const e = found.get(n);
      rows.push(e ? { type: 'note', id: e.id, text: `${n}. ${e.title || 'untitled'}`, h: 1 }
        : { type: 'blank', text: `${n}.`, h: 1 });
    }
  }

  if (scraps.length) {
    if (rows.length) rows.push({ type: 'gap', h: 0.5 });
    rows.push({ type: 'heading', text: 'scraps', h: 1 });
    for (const e of scraps) rows.push({ type: 'note', id: e.id, text: e.title || 'untitled', h: 1 });
  }
  if (!rows.length) rows.push({ type: 'heading', text: 'nothing yet', h: 1 });
  return rows;
}

/**
 * Split rows into pages of at most `perPage` lines. A heading never ends a page (it moves on with
 * its first row), gaps are dropped at the top of a page, and a row taller than a page is clipped.
 */
export function paginate(rows, perPage) {
  perPage = Math.max(1, perPage);
  const pages = [[]];
  let used = 0;
  for (let i = 0; i < rows.length; i++) {
    let r = rows[i];
    if (r.type === 'gap' && used === 0) continue;
    if (r.h > perPage) r = { ...r, lines: r.lines?.slice(0, perPage), h: perPage };
    let need = r.h;
    if (r.type === 'heading' && rows[i + 1] && rows[i + 1].type !== 'heading') need += Math.min(perPage - r.h, rows[i + 1].h);
    if (used > 0 && used + need > perPage + 1e-9) {
      pages.push([]);
      used = 0;
      if (r.type === 'gap') continue;
    }
    pages[pages.length - 1].push(r);
    used += r.h;
  }
  return pages;
}

/**
 * The Secrets ("oddities") pages as rows. `list` = game.secrets.list() ([{ id, title, hint, found }],
 * stable order) or [] when the secrets system is missing; `entries` = notebook entries of kind
 * 'secret' (addPage), counted as found and appended when the list doesn't have them.
 * Found: title + a one-line note (hint). Unfound: "? ? ?" (scribbled; never the title) + the hint
 * only when it is non-empty. Row: { type: 'heading'|'secret'|'secretUnknown'|'empty', text, note?, id, h }.
 */
export function secretsRows(list = [], entries = []) {
  const items = (Array.isArray(list) ? list : []).map((s) => ({ ...s }));
  for (const e of entries) {
    const s = items.find((x) => x.id === e.id);
    if (s) { s.found = true; continue; }
    items.push({ id: e.id, title: e.title || 'untitled', hint: e.text ?? e.caption ?? '', found: true });
  }
  const found = items.filter((s) => s.found).length;
  const rows = [{ type: 'heading', text: `oddities ${found} / ${items.length}`, h: 1 }];
  for (const s of items) {
    const hint = String(s.hint ?? '').trim();
    if (s.found) rows.push({ type: 'secret', id: s.id, text: s.title || 'untitled', note: hint, h: hint ? 2 : 1 });
    else rows.push({ type: 'secretUnknown', id: s.id, text: '? ? ?', note: hint, h: hint ? 2 : 1 });
  }
  if (!items.length) rows.push({ type: 'empty', text: 'nothing odd yet', h: 1 });
  return rows;
}

/** Index of the page holding the row with `id` (or -1). */
export function pageOfId(pages, id) {
  return pages.findIndex((p) => p.some((r) => r.id === id));
}
