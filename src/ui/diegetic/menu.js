// The notebook as the hub menu (see hub.js for the sections and the pure layout helpers).
//
// Opening: Tab / M open or close it at the last section viewed (default Map) without pausing.
// Esc pauses (main.js) and the notebook opens at Settings (game:pause); "back to it" resumes.
// In the book: A/D or ←/→ turn pages (sections with several spreads page within themselves first),
// W/S or ↑/↓ pick a row, E / Enter acts on it. A slider row is "held" with E / Enter: then A/D
// move it instead of turning pages. With a free cursor (paused, or the click-drag fallback) the
// mouse works too: click tabs, rows, ticks; drag sliders; click near a page's outer edge to turn.
//
// All menu keys are handled inside the DOM key/mouse handlers (not the frame loop), so "back to
// it" and the fullscreen tick run inside a real input event, which pointer lock and fullscreen need.
import { hash } from '../../core/rng.js';
import { wrapText } from './text.js';
import { SECTIONS, SECTION_IDS, sectionIndex, sectionOf, entriesIn, chunk, notesRows, secretsRows, paginate, pageOfId } from './hub.js';
import { controlsList } from './keys.js';
import { toSlider, fromSlider } from '../../settings/settings.js';
import { PW, PH, TEXT, FONT, writePage } from './notebook.js';

const PENCIL = '#4a4438';
const LINE = (i) => TEXT.top + TEXT.size + i * TEXT.lineH;     // baseline of ruled line i
const ROW = { label: 22, ctrl: 98, ctrlEnd: 146, size: 8.6 };

// Settings rows: page, ruled line, setting key, label. Actions have an `id` instead of a key.
const SETTING_ROWS = [
  { side: 'L', line: 0, key: 'mouseSensitivity', label: 'mouse speed', type: 'slider' },
  { side: 'L', line: 1, key: 'invertY', label: 'invert Y', type: 'tick' },
  { side: 'L', line: 3, key: 'textScale', label: 'text size', type: 'slider' },
  { side: 'L', line: 4, key: 'textGrit', label: 'text grit', type: 'slider' },
  { side: 'L', line: 5, key: 'captions', label: 'captions', type: 'tick' },
  { side: 'L', line: 6, key: 'textPrompts', label: 'text prompts', type: 'tick' },
  { side: 'L', line: 7, key: 'reduceFlashing', label: 'reduce flashing', type: 'tick' },
  { side: 'R', line: 0, key: 'masterVolume', label: 'master', type: 'slider' },
  { side: 'R', line: 1, key: 'ambienceVolume', label: 'ambience', type: 'slider' },
  { side: 'R', line: 2, key: 'effectsVolume', label: 'effects', type: 'slider' },
  { side: 'R', line: 4, key: 'calm', label: 'calm mode', type: 'tick', note: 'the Tenant keeps its distance' },
  { side: 'R', line: 6, key: 'fullscreen', label: 'fullscreen', type: 'tick' },
  { side: 'R', line: 8, id: 'newtape', label: 'new tape', type: 'action' },
  { side: 'R', line: 10, id: 'resume', label: 'back to it →', type: 'action', big: true },
];
const CONFIRM_ROWS = [
  { side: 'R', line: 9, id: 'yes', label: 'yes, end it', type: 'action', x: 22 },
  { side: 'R', line: 9, id: 'no', label: 'no', type: 'action', x: 104 },
];

export class Menu {
  constructor(game, nb) {
    this.game = game;
    this.nb = nb;
    this.open = false;
    this.section = sectionIndex('map');
    this.lastSection = 'map';
    this.subs = SECTIONS.map(() => 0);
    this.setSel = 0;              // settings row
    this.held = false;            // a slider row is held (A/D adjust)
    this.confirm = false;         // "new tape" asked for confirmation
    this.noteSel = null;          // selected note id
    this.reading = null;          // { id, part } shown on the facing page
    this.drag = null;             // slider being dragged with the mouse
    this.geo = { L: null, R: null, tabs: [] };
    this.regions = [];            // hit regions recorded while inking (page units)
    this.hooks = { closeInspect: () => false, onOpen: () => {} };
    this._notes = { key: '', pages: [[]] };
    this._secrets = { key: '', pages: [[]] };
    const seedParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('seed') : null;
    this.seedText = seedParam ?? String(game.seed);
  }

  get sectionId() { return SECTION_IDS[this.section]; }
  get sub() { return this.subs[this.section]; }
  get cursorFree() { return this.open && !this.game.input.locked; }

  // ── open / close / move ──────────────────────────────────────────────────────────────────────
  show(id = this.lastSection, sub = null) {
    const s = sectionIndex(id);
    if (!this.open) {
      this.open = true;
      this.section = s;
      if (sub != null) this.subs[s] = this.clampSub(s, sub);
      this.held = false; this.confirm = false;
      this.remember();
      this.game.synth?.play?.('paper_rustle', { volume: 0.5 });
      this.hooks.onOpen();
      return;
    }
    this.goTo(s, sub ?? this.subs[s]);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.held = false; this.confirm = false; this.drag = null;
    this.game.synth?.play?.('paper_rustle', { volume: 0.4 });
  }

  remember() {
    if (this.sectionId !== 'settings') this.lastSection = this.sectionId; // Tab reopens here (Esc opens Settings)
  }

  clampSub(s, sub) { return Math.max(0, Math.min(this.spreadCount(SECTION_IDS[s]) - 1, sub)); }

  /** Jump to a section/spread, turning the page in the right direction. */
  goTo(s, sub = 0) {
    if (typeof s === 'string') s = sectionIndex(s);
    sub = this.clampSub(s, sub);
    if (s === this.section && sub === this.sub) return false;
    const from = this.current();
    const dir = s > this.section || (s === this.section && sub > this.sub) ? 1 : -1;
    this.section = s;
    this.subs[s] = sub;
    this.held = false; this.confirm = false; this.drag = null;
    this.remember();
    if (this.open) this.nb.startFlip(dir, from, this.current());
    return true;
  }

  /** One page turn: within the section first, then into the next / previous section. */
  flip(dir) {
    const n = this.spreadCount(this.sectionId);
    if (this.sub + dir >= 0 && this.sub + dir < n) return this.goTo(this.section, this.sub + dir);
    const s = this.section + dir;
    if (s < 0 || s >= SECTIONS.length) return false;
    return this.goTo(s, dir > 0 ? 0 : this.spreadCount(SECTION_IDS[s]) - 1);
  }

  /** Open at a notebook entry (readable:open display 'notebook', notebook.open(index)). */
  openEntry(index) {
    const e = this.nb.pages[index];
    if (!e) return this.show();
    const sec = sectionOf(e.kind);
    let sub = 0;
    if (sec === 'map' && e.kind === 'mapReveal') {
      const r = this.reveals().indexOf(e);
      sub = r <= 0 ? 0 : Math.floor((r - 1) / 2) + 1;
    } else if (sec === 'photos' || sec === 'wanderers') {
      sub = Math.floor(entriesIn(this.nb.pages, sec).indexOf(e) / 2);
    } else if (sec === 'notes') {
      if (e.kind !== 'learned') { this.noteSel = e.id; this.reading = { id: e.id, part: 0 }; }
      sub = Math.max(0, pageOfId(this.notesPages(), e.id));
    } else if (sec === 'secrets') {
      sub = Math.floor(Math.max(0, pageOfId(this.secretsPages(), e.id)) / 2);
    }
    this.show(sec, sub);
  }

  // ── content ──────────────────────────────────────────────────────────────────────────────────
  get textScale() { return Math.max(0.8, Math.min(1.5, this.game.cfg.ui?.textScale ?? 1)); }
  listMetrics() {
    const s = this.textScale;
    const size = TEXT.size * s * 0.92, lineH = TEXT.lineH * s;
    const perPage = Math.floor((TEXT.bottom - (TEXT.top + size)) / lineH) + 1;
    return { size, lineH, perPage, s };
  }

  reveals() { return this.nb.pages.filter((e) => e.kind === 'mapReveal'); }

  notesPages() {
    const m = this.listMetrics();
    const key = `${this.nb.version}|${m.s}`;
    if (this._notes.key !== key) {
      const wrapW = TEXT.width - 6;
      const rows = notesRows(entriesIn(this.nb.pages, 'notes'), this.game.content?.notes ?? {},
        (t) => wrapText(this.nb.g, t, wrapW, FONT(m.size * 0.9)));
      this._notes = { key, pages: paginate(rows, m.perPage) };
    }
    return this._notes.pages;
  }

  secretsPages() {
    const m = this.listMetrics();
    const sec = this.game.secrets;
    let list = [];
    try { list = typeof sec?.list === 'function' ? sec.list() ?? [] : []; } catch { list = []; }
    const entries = this.nb.pages.filter((e) => sectionOf(e.kind) === 'secrets');
    const key = `${m.s}|${JSON.stringify(list.map((s) => [s.id, s.title, s.hint, !!s.found]))}|${entries.length}`;
    if (this._secrets.key !== key) this._secrets = { key, pages: paginate(secretsRows(list, entries), m.perPage) };
    return this._secrets.pages;
  }

  spreadCount(id) {
    switch (id) {
      case 'map': return 1 + Math.ceil(Math.max(0, this.reveals().length - 1) / 2);
      case 'notes': return Math.max(1, this.notesPages().length);
      case 'secrets': return Math.max(1, Math.ceil(this.secretsPages().length / 2));
      case 'photos': case 'wanderers': return Math.max(1, Math.ceil(entriesIn(this.nb.pages, id).length / 2));
      default: return 1;
    }
  }

  current() { return this.spread(this.sectionId, this.sub); }

  /** [descL, descR] for a spread. desc.key identifies the page *texture* (paper / picture). */
  spread(id, sub) {
    const blank = (k) => ({ kind: 'blank', key: `blank:${id}:${sub}:${k}` });
    const n = this.spreadCount(id);
    const label = n > 1 ? `${sub + 1} / ${n}` : '';
    switch (id) {
      case 'settings': return [{ kind: 'settingsL', key: 'settings:L' }, { kind: 'settingsR', key: 'settings:R' }];
      case 'controls': return [{ kind: 'controlsL', key: 'controls:L' }, { kind: 'controlsR', key: 'controls:R' }];
      case 'map': {
        const rv = this.reveals();
        const reveal = (e) => (e ? { kind: 'reveal', key: `reveal:${e.id}`, entry: e } : blank('r'));
        if (sub === 0) return [{ kind: 'map', key: 'map', label }, rv[0] ? reveal(rv[0]) : { kind: 'mapInfo', key: 'mapInfo' }];
        return [reveal(rv[sub * 2 - 1]), reveal(rv[sub * 2])];
      }
      case 'notes': {
        const pages = this.notesPages();
        const left = { kind: 'notesIndex', key: `notes:${sub}`, rows: pages[sub] ?? [], label, cont: sub > 0 };
        const e = this.reading && this.nb.pages.find((p) => p.id === this.reading.id);
        return [left, e ? { kind: 'noteRead', key: `read:${e.id}`, entry: e, part: this.reading.part } : { kind: 'notesHint', key: 'notes:hint' }];
      }
      case 'secrets': {
        const pages = this.secretsPages();
        return [0, 1].map((k) => ({ kind: 'secrets', key: `secrets:${sub}:${k}`, rows: pages[sub * 2 + k] ?? [], label: k === 0 ? label : '', first: sub === 0 && k === 0 }));
      }
      case 'photos': case 'wanderers': {
        const list = entriesIn(this.nb.pages, id);
        const kind = id === 'photos' ? 'photo' : 'wanderer';
        const page = (e) => (e ? { kind, key: `${kind}:${e.id}`, entry: e } : null);
        if (!list.length) {
          return [{ kind: 'empty', key: `empty:${id}`, title: id === 'photos' ? 'photographs' : 'people',
            lines: id === 'photos' ? ['none yet.', '', 'the flash camera\'s', 'pictures get taped', 'in here.']
              : ['no one yet.', '', 'badges I find get', 'copied in here.'] }, blank('e')];
        }
        return [page(list[sub * 2]) ?? blank('a'), page(list[sub * 2 + 1]) ?? blank('b')].map((d, i) => (i === 0 && label ? { ...d, label } : d));
      }
      default: return [blank('a'), blank('b')];
    }
  }

  // ── settings ─────────────────────────────────────────────────────────────────────────────────
  settingRows() {
    if (!this.confirm) return SETTING_ROWS;
    return [...SETTING_ROWS.filter((r) => r.id !== 'newtape' && r.id !== 'resume'), ...CONFIRM_ROWS, SETTING_ROWS.at(-1)];
  }
  get settings() { return this.game.settings ?? null; }

  adjust(dir, row = this.settingRows()[this.setSel]) {
    if (!row || row.type !== 'slider' || !this.settings) return;
    const t = toSlider(row.key, this.settings[row.key]);
    this.settings.set(row.key, fromSlider(row.key, Math.round((t + dir * 0.05) * 20) / 20));
    this.game.synth?.play?.('switch_click', { volume: 0.15 });
  }

  activateSetting(row) {
    const st = this.settings;
    if (!row) return;
    if (row.type === 'slider') { this.held = !this.held; return; }
    if (row.type === 'tick' && st) {
      const v = !st[row.key];
      st.set(row.key, v);
      if (row.key === 'fullscreen') { // we're inside the key/mouse event: allowed to change it now
        if (v) this.game.fullscreen?.enter?.(); else this.game.fullscreen?.exit?.();
      }
      this.game.synth?.play?.('switch_click', { volume: 0.2 });
      return;
    }
    if (row.id === 'resume') { this.resume(); return; }
    if (row.id === 'newtape') { this.confirm = true; this.setSel = this.settingRows().findIndex((r) => r.id === 'no'); return; }
    if (row.id === 'no') { this.confirm = false; this.setSel = SETTING_ROWS.findIndex((r) => r.id === 'newtape'); return; }
    if (row.id === 'yes') this.newTape();
  }

  resume() {
    if (this.game.paused && this.game.resume) this.game.resume(); // pointer lock + fullscreen, from this event
    else this.close();
  }

  newTape() {
    try {
      const url = new URL(location.href);
      url.searchParams.set('seed', 'tape-' + Math.floor(Math.random() * 36 ** 6).toString(36));
      location.assign(url.toString());
    } catch { location.reload(); }
  }

  // ── selection ────────────────────────────────────────────────────────────────────────────────
  noteTargets() {
    const out = [];
    this.notesPages().forEach((p, page) => p.forEach((r) => { if (r.type === 'note') out.push({ id: r.id, page }); }));
    return out;
  }

  moveSel(dir) {
    const id = this.sectionId;
    if (id === 'settings') {
      const rows = this.settingRows();
      this.setSel = (this.setSel + dir + rows.length) % rows.length;
      this.held = false;
    } else if (id === 'notes') {
      const t = this.noteTargets();
      if (!t.length) return;
      let i = t.findIndex((x) => x.id === this.noteSel);
      i = i < 0 ? (dir > 0 ? 0 : t.length - 1) : Math.max(0, Math.min(t.length - 1, i + dir));
      this.noteSel = t[i].id;
      if (t[i].page !== this.sub) this.goTo(this.section, t[i].page);
    } else return;
    this.game.synth?.play?.('switch_click', { volume: 0.08 });
  }

  activate() {
    const id = this.sectionId;
    if (id === 'settings') this.activateSetting(this.settingRows()[this.setSel]);
    else if (id === 'notes') this.readNote(this.noteSel);
  }

  readNote(noteId) {
    if (!noteId) return;
    const e = this.nb.pages.find((p) => p.id === noteId);
    if (!e) return;
    this.noteSel = noteId;
    if (this.reading?.id === noteId) {
      const parts = this.readParts(e).length;
      this.reading = { id: noteId, part: (this.reading.part + 1) % parts };
      if (parts === 1) return;
    } else this.reading = { id: noteId, part: 0 };
    this.game.synth?.play?.('paper_rustle', { volume: 0.35 });
  }

  readParts(e) {
    const s = this.textScale;
    const size = TEXT.size * s, lineH = TEXT.lineH * s;
    const per = Math.max(1, Math.floor((TEXT.bottom - 14 - (TEXT.top + size)) / lineH) + 1);
    const lines = wrapText(this.nb.g, String(e.text ?? e.caption ?? ''), TEXT.width, FONT(size));
    return chunk(lines, per).length ? chunk(lines, per) : [[]];
  }

  // ── input (DOM handlers, see index.js) ───────────────────────────────────────────────────────
  /** Returns true when the key was ours (the caller then stops it reaching main's handlers). */
  onKeyDown(e) {
    const g = this.game;
    if (!(g.playing || g.paused)) return false;
    const is = (a) => !!g.cfg.keys?.[a]?.includes(e.code);
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (!this.open) {
      if (is('notebook') && g.playing && !e.repeat) {
        if (!this.hooks.closeInspect()) this.show(this.lastSection);
        return true;
      }
      return false;
    }
    const nav = is('left') || is('right') || is('forward') || is('back');
    if (e.repeat && !nav) return enter || is('notebook') || is('pause') || is('interact');
    if (is('notebook')) { if (g.paused) this.goTo('map'); else this.close(); return true; }
    if (is('pause')) {
      if (this.held) this.held = false;
      else if (this.confirm) this.activateSetting({ id: 'no' });
      else if (g.paused) this.goTo('settings');
      else this.close();
      return true;
    }
    if (is('left') || is('right')) {
      const d = is('left') ? -1 : 1;
      if (this.held && this.sectionId === 'settings') this.adjust(d); else if (!e.repeat) this.flip(d);
      return true;
    }
    if (is('forward') || is('back')) { this.moveSel(is('forward') ? -1 : 1); return true; }
    if (is('interact') || enter) { this.activate(); return true; }
    return false;
  }

  /** CSS px → { side, u, v } in page units, or null. */
  pick(x, y) {
    for (const side of ['L', 'R']) {
      const c = this.geo[side];
      if (!c) continue;
      const p = invert(c, x, y);
      if (p && p.a >= 0 && p.a <= 1 && p.b >= 0 && p.b <= 1) return { side, u: p.a * PW, v: p.b * PH };
    }
    return null;
  }

  pickTab(x, y) {
    return this.geo.tabs.findIndex((c) => { const p = c && invert(c, x, y); return p && p.a >= 0 && p.a <= 1 && p.b >= -0.1 && p.b <= 1; });
  }

  regionAt(hit) {
    if (!hit) return null;
    return this.regions.findLast((r) => r.side === hit.side && hit.u >= r.x && hit.u <= r.x + r.w && hit.v >= r.y && hit.v <= r.y + r.h) ?? null;
  }

  onMouse(type, e) {
    if (!this.cursorFree || this.nb.flipping) { if (type === 'up') this.drag = null; return false; }
    const hit = this.pick(e.clientX, e.clientY);
    if (type === 'up') { this.drag = null; return false; }
    if (type === 'move') {
      if (this.drag) { this.dragTo(hit); return true; }
      const r = this.regionAt(hit);
      if (r?.row != null && this.sectionId === 'settings' && !this.held) this.setSel = r.row;
      return false;
    }
    if (type !== 'down' || e.button !== 0) return false;
    const tab = this.pickTab(e.clientX, e.clientY);
    if (tab >= 0 && !hit) { this.goTo(tab, this.subs[tab]); return true; }
    const r = this.regionAt(hit);
    if (r) {
      if (r.row != null) {
        this.setSel = r.row;
        const row = this.settingRows()[r.row];
        if (row.type === 'slider' && r.slider) { this.drag = { row, x0: r.x, x1: r.x + r.w, side: r.side }; this.dragTo(hit); }
        else if (row.type !== 'slider') this.activateSetting(row);
        return true;
      }
      if (r.note) { this.readNote(r.note); return true; }
    }
    if (hit) {
      if (hit.side === 'R' && hit.u > PW - 26) { this.flip(1); return true; }
      if (hit.side === 'L' && hit.u < 26) { this.flip(-1); return true; }
    }
    return !!hit;
  }

  dragTo(hit) {
    const d = this.drag;
    if (!d || !hit || hit.side !== d.side || !this.settings) return;
    this.settings.set(d.row.key, fromSlider(d.row.key, (hit.u - d.x0) / (d.x1 - d.x0)));
  }

  // ── ink ──────────────────────────────────────────────────────────────────────────────────────
  /** Draw one page's writing (page units) and record its hit regions. */
  ink(layer, g, d, side) {
    const seed = hash(d.key, side);
    switch (d.kind) {
      case 'settingsL': case 'settingsR': this.inkSettings(layer, g, side, seed); break;
      case 'controlsL': case 'controlsR': this.inkControls(layer, g, side, seed); break;
      case 'map': writePage(layer, g, { title: 'where I have been', seed, label: d.label }); break;
      case 'mapInfo': {
        const map = this.game.diegetic?.map;
        const q = (() => { try { return map?.contradictions?.()?.length ?? 0; } catch { return 0; } })();
        const lines = ['pencil: rooms I have', 'walked myself.', '', 'the red arrow is me.', '',
          'wall plans I find get', 'copied in faintly.'];
        if (q) lines.push('', `? = ${q} place${q > 1 ? 's' : ''} the plans`, 'got wrong.');
        lines.push('', `steps: ${this.game.stats?.steps ?? 0}`);
        writePage(layer, g, { title: 'the map', lines: lines.slice(0, 11), seed });
        break;
      }
      case 'reveal': case 'photo': case 'wanderer':
        writePage(layer, g, { title: d.entry.title, lines: d.entry.lines, seed, top: d.entry.top, label: d.label });
        break;
      case 'empty': writePage(layer, g, { title: d.title, lines: d.lines, seed }); break;
      case 'notesIndex': this.inkNotesIndex(layer, g, d, seed); break;
      case 'noteRead': this.inkNoteRead(layer, g, d, seed); break;
      case 'notesHint': {
        const lines = this.noteTargets().length ? ['pick one on the left', 'to read it here.'] : ['nothing to read yet.'];
        layer.ink(lines, TEXT.x, LINE(1), TEXT.size * 0.9, TEXT.lineH, seed, PENCIL, g);
        break;
      }
      case 'secrets': this.inkSecrets(layer, g, d, seed); break;
      default: if (d.label) writePage(layer, g, { label: d.label, seed });
    }
  }

  inkTab(layer, g, i, tw, th) {
    const label = SECTIONS[i].label;
    let size = Math.min(13, th * 0.8);
    g.font = layer.font(size);
    const w = g.measureText(label).width;
    if (w > tw - 6) size *= (tw - 6) / w;
    g.font = layer.font(size);
    const lw = g.measureText(label).width;
    const x = (tw - lw) / 2;
    // always dark ink (the tab colours are pale; red on them is too faint); the current one is underlined
    layer.ink([label], x, th * 0.5 + size * 0.36, size, size, hash('tab', i), layer.ink0, g);
    if (i === this.section) stroke(layer, g, [[x, th * 0.5 + size * 0.6], [x + lw, th * 0.5 + size * 0.55]], layer.red, 1.4, hash('tabu', i));
  }

  inkSettings(layer, g, side, seed) {
    const st = this.settings;
    if (side === 'L') {
      layer.ink(['settings'], TEXT.x, 20, 11, 13, hash(seed, 't'), layer.red, g);
      if (this.game.paused) layer.ink(['(paused)'], 96, 20, 8, 10, hash(seed, 'p'), PENCIL, g);
    } else {
      layer.ink(['sound'], TEXT.x, 20, 11, 13, hash(seed, 't'), layer.red, g);
      layer.ink([`tape: ${this.seedText}`], ROW.label, LINE(7), ROW.size, 10, hash(seed, 'seed'), PENCIL, g);
      if (this.confirm) layer.ink(['are you sure? this run ends'], ROW.label, LINE(8), ROW.size, 10, hash(seed, 'c'), layer.red, g);
      if (st && !st.persisted) layer.ink(["(can't save these here)"], ROW.label, LINE(11) - 2, 7, 9, hash(seed, 'ns'), PENCIL, g);
    }
    const rows = this.settingRows();
    rows.forEach((row, i) => {
      if (row.side !== side) return;
      const y = LINE(row.line);
      const x = row.x ?? ROW.label;
      const sel = i === this.setSel;
      const size = row.big ? 10.5 : ROW.size;
      const col = row.big || row.id === 'yes' ? layer.red : layer.ink0;
      fitInk(layer, g, row.label, x, y, size, row.type === 'action' ? 120 : ROW.ctrl - x - 4, hash(seed, i), col);
      if (sel) layer.ink([this.held ? '»' : '›'], x - 10, y, size, 10, hash(seed, 's'), layer.red, g);
      const hit = { side, row: i, x: x - 12, y: y - 11, w: (row.type === 'action' ? (row.x != null ? 40 : 120) : ROW.ctrlEnd - x + 14), h: 14 };
      this.regions.push(hit);
      if (row.type === 'slider' && st) {
        const t = Math.max(0, Math.min(1, toSlider(row.key, st[row.key])));
        drawSlider(layer, g, ROW.ctrl, ROW.ctrlEnd, y - 3.5, t, sel && this.held, hash(seed, 'sl', i));
        this.regions.push({ side, row: i, slider: true, x: ROW.ctrl, y: y - 11, w: ROW.ctrlEnd - ROW.ctrl, h: 14 });
      } else if (row.type === 'tick' && st) {
        drawTick(layer, g, ROW.ctrl, y - 8.5, !!st[row.key], hash(seed, 'tk', i));
      }
      if (row.note) layer.ink([row.note], x + 4, y + 10, 7.2, 9, hash(seed, 'n', i), PENCIL, g);
      if (sel && this.game.cfg.ui?.textPrompts !== false && row.type === 'slider') {
        const hint = this.held ? 'A / D to set · E to let go' : 'E / Enter to hold, then A / D';
        layer.ink([hint], ROW.label, LINE(side === 'L' ? 9 : 3) - 1, 7.4, 9, hash(seed, 'h'), PENCIL, g); // a free ruled line, never over a row
      }
    });
  }

  inkControls(layer, g, side, seed) {
    const list = controlsList(this.game.cfg.keys ?? {});
    const half = Math.ceil(list.length / 2) + 1;
    const rows = side === 'L' ? list.slice(0, half) : list.slice(half);
    layer.ink([side === 'L' ? 'controls' : ''], TEXT.x, 20, 11, 13, hash(seed, 't'), layer.red, g);
    rows.forEach((r, i) => {
      const y = LINE(i);
      fitInk(layer, g, r.label, TEXT.x, y, ROW.size, 52, hash(seed, i), layer.ink0);
      fitInk(layer, g, r.keys, 72, y, ROW.size, PW - 72 - 8, hash(seed, 'k', i), layer.red);
    });
    if (side === 'R') {
      const y0 = rows.length + 1;
      layer.ink(['in the notebook'], TEXT.x, LINE(y0), ROW.size, 10, hash(seed, 'nb'), layer.red, g);
      const tips = ['A D · turn pages', 'W S · pick a line', 'E / Enter · choose', 'click works when paused'];
      tips.forEach((t, i) => fitInk(layer, g, t, TEXT.x + 4, LINE(y0 + 1 + i), 7.8, PW - 40, hash(seed, 'tip', i), PENCIL));
    }
  }

  inkNotesIndex(layer, g, d, seed) {
    const m = this.listMetrics();
    layer.ink([d.cont ? 'notes (cont.)' : 'notes'], TEXT.x, 20, 11, 13, hash(seed, 't'), layer.red, g);
    let y = TEXT.top + m.size;
    d.rows.forEach((r, i) => {
      if (r.type === 'gap') { y += m.lineH * r.h; return; }
      const rs = hash(seed, i);
      if (r.type === 'heading') fitInk(layer, g, r.text, TEXT.x, y, m.size, TEXT.width, rs, layer.red);
      else if (r.type === 'learned') layer.ink(r.lines, TEXT.x + 4, y, m.size * 0.9, m.lineH, rs, PENCIL, g);
      else if (r.type === 'blank') {
        fitInk(layer, g, r.text, TEXT.x + 4, y, m.size, 30, rs, PENCIL);
        scribbleLine(layer, g, TEXT.x + 22, PW - 24, y + 1, rs, PENCIL, 0.45);
      } else if (r.type === 'note') {
        const sel = r.id === this.noteSel, reading = r.id === this.reading?.id;
        fitInk(layer, g, r.text, TEXT.x + 4, y, m.size, TEXT.width - 8, rs, layer.ink0);
        if (sel) layer.ink(['›'], TEXT.x - 8, y, m.size, 10, hash(rs, 's'), layer.red, g);
        if (reading) scribbleLine(layer, g, TEXT.x + 4, PW - 16, y + 2, hash(rs, 'u'), layer.red, 0.8);
        this.regions.push({ side: 'L', note: r.id, x: 4, y: y - m.size, w: PW - 8, h: m.lineH });
      }
      y += m.lineH * r.h;
    });
    if (d.label) layer.ink([d.label], PW / 2 - 8, PH - 12, 8, 10, hash(seed, 'n'), PENCIL, g);
  }

  inkNoteRead(layer, g, d, seed) {
    const s = this.textScale;
    const parts = this.readParts(d.entry);
    const part = Math.min(d.part, parts.length - 1);
    layer.ink([d.entry.title || 'untitled'], TEXT.x, 20, 11, 13, hash(seed, 't'), layer.red, g);
    layer.ink(parts[part], TEXT.x, TEXT.top + TEXT.size * s, TEXT.size * s, TEXT.lineH * s, seed, undefined, g);
    if (parts.length > 1) layer.ink([`${part + 1} / ${parts.length}  (E: more)`], PW / 2 - 26, PH - 12, 7.5, 10, hash(seed, 'p'), PENCIL, g);
  }

  inkSecrets(layer, g, d, seed) {
    const m = this.listMetrics();
    if (d.first) layer.ink(['the back pages'], TEXT.x, 20, 11, 13, hash(seed, 't'), layer.red, g);
    let y = TEXT.top + m.size;
    d.rows.forEach((r, i) => {
      const rs = hash(seed, i);
      if (r.type === 'heading') fitInk(layer, g, r.text, TEXT.x, y, m.size, TEXT.width, rs, layer.red);
      else if (r.type === 'empty') fitInk(layer, g, r.text, TEXT.x + 4, y, m.size, TEXT.width, rs, PENCIL);
      else if (r.type === 'secret') {
        fitInk(layer, g, r.text, TEXT.x + 4, y, m.size, TEXT.width - 8, rs, layer.ink0);
        if (r.note) fitInk(layer, g, r.note, TEXT.x + 10, y + m.lineH, m.size * 0.82, TEXT.width - 14, hash(rs, 'n'), PENCIL);
      } else if (r.type === 'secretUnknown') {
        fitInk(layer, g, r.text, TEXT.x + 4, y, m.size, 40, rs, layer.ink0);
        scribbleOut(layer, g, TEXT.x + 50, y - m.size * 0.75, 66, m.size * 0.9, hash(rs, "x"));
        if (r.note) fitInk(layer, g, r.note, TEXT.x + 10, y + m.lineH, m.size * 0.82, TEXT.width - 14, hash(rs, 'n'), 'rgba(74,68,56,0.78)');
      }
      y += m.lineH * r.h;
    });
    if (d.label) layer.ink([d.label], PW / 2 - 8, PH - 12, 8, 10, hash(seed, 'n'), PENCIL, g);
  }
}

/** Solve p = tl + a·(tr−tl) + b·(bl−tl). */
function invert([tl, tr, bl], x, y) {
  const ax = tr.x - tl.x, ay = tr.y - tl.y, bx = bl.x - tl.x, by = bl.y - tl.y;
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-6) return null;
  const px = x - tl.x, py = y - tl.y;
  return { a: (px * by - py * bx) / det, b: (ax * py - ay * px) / det };
}

/** One line of ink, shrunk (down to 75 %) and then cut with "…" so it never runs past maxW. */
function fitInk(layer, g, text, x, y, size, maxW, seed, color) {
  g.font = layer.font(size);
  let w = g.measureText(text).width;
  if (w > maxW) { size = Math.max(size * 0.75, (size * maxW) / w); g.font = layer.font(size); w = g.measureText(text).width; }
  let t = String(text);
  while (w > maxW && t.length > 2) { t = t.slice(0, -2) + '…'; w = g.measureText(t).width; }
  layer.ink([t], x, y, size, size * 1.2, seed, color, g);
}

/** A wobbly pencil stroke; wobble grows with text grit. */
function stroke(layer, g, pts, color, width, seed) {
  const k = layer.grit;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * (0.4 + k * 0.9);
  g.save();
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x + rnd(), y + rnd()) : g.moveTo(x + rnd(), y + rnd())));
  g.stroke();
  g.restore();
}

function drawSlider(layer, g, x0, x1, y, t, held, seed) {
  const col = held ? layer.red : layer.ink0;
  stroke(layer, g, [[x0, y], [(x0 + x1) / 2, y + 0.4], [x1, y]], col, 1.1, seed);
  stroke(layer, g, [[x0, y - 3], [x0, y + 3]], col, 1, seed + 1);
  stroke(layer, g, [[x1, y - 3], [x1, y + 3]], col, 1, seed + 2);
  const kx = x0 + (x1 - x0) * t;
  g.save();
  g.fillStyle = col;
  g.beginPath(); g.ellipse(kx, y, 3.2, 3.8, 0.3, 0, Math.PI * 2); g.fill();
  g.restore();
  if (held) {
    stroke(layer, g, [[x0 - 5, y - 3], [x0 - 8, y], [x0 - 5, y + 3]], col, 1, seed + 3);
    stroke(layer, g, [[x1 + 5, y - 3], [x1 + 8, y], [x1 + 5, y + 3]], col, 1, seed + 4);
  }
}

function drawTick(layer, g, x, y, on, seed) {
  stroke(layer, g, [[x, y], [x + 9, y], [x + 9, y + 9], [x, y + 9], [x, y]], layer.ink0, 1, seed);
  if (on) stroke(layer, g, [[x + 1.5, y + 4.5], [x + 4, y + 8], [x + 11, y - 2]], layer.red, 1.6, seed + 1);
}

function scribbleLine(layer, g, x0, x1, y, seed, color, width) {
  stroke(layer, g, [[x0, y], [(x0 * 2 + x1) / 3, y + 0.5], [(x0 + x1 * 2) / 3, y - 0.4], [x1, y]], color, width, seed);
}

/** Redaction scribble over unfound secrets: tight zig-zags, never the real title underneath. */
function scribbleOut(layer, g, x, y, w, h, seed) {
  const pts = [];
  for (let i = 0; i <= 9; i++) pts.push([x + (w * i) / 9, i % 2 ? y + h : y + 1]);
  stroke(layer, g, pts, layer.ink0, 1.2, seed);
}
