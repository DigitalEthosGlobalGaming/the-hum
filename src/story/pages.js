// Notebook picture pages from story props (photo / wanderer / mapReveal; see ui/diegetic/notebook.js).
// All no-ops while unbound (Node tests) except for returning null.
import { story, caption } from './runtime.js';

function notebook() { return story.game?.diegetic?.notebook ?? null; }

/** Flip the open notebook to a page by id (the diegetic UI opens notebook reads by noteId). */
export function openPage(id, title) {
  story.game?.events.emit('readable:open', { title, text: '', display: 'notebook', noteId: id });
}

export function addPhotoPage({ id, image, caption: text, title }, { open = false } = {}) {
  const nb = notebook();
  if (!nb) return null;
  const known = nb.pages.some((p) => p.id === id);
  const i = nb.addPage({ kind: 'photo', id, image, caption: text, title });
  if (!known) caption(`(photo taped into notebook)`, 2.2, 'page');
  if (open) openPage(id, title);
  return i;
}

export function addWandererPage(w, text, { open = false } = {}) {
  const nb = notebook();
  if (!nb) return null;
  const known = nb.pages.some((p) => p.id === w.id);
  const i = nb.addPage({ kind: 'wanderer', id: w.id, title: w.name, face: w.face, number: w.number, caption: text });
  if (!known) caption(`(copied into notebook: ${w.name})`, 2.5, 'page');
  if (open) openPage(w.id, w.name);
  return i;
}

export function addMapRevealPage(data, text, { open = false } = {}) {
  const game = story.game;
  const nb = notebook();
  if (!nb || !game.diegetic.map?.reveal) return null;
  game.diegetic.map.reveal(data.cells, { id: data.id, cx: data.cx, cz: data.cz, lie: data.lie });
  const i = nb.addPage({ kind: 'mapReveal', id: data.id, revealId: data.id, title: 'evacuation plan', caption: text });
  if (open) openPage(data.id, 'evacuation plan');
  return i;
}
