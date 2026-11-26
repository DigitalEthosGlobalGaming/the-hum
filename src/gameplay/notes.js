// Note selection (content/notes/*.json). Pure: shared by the game and the Node tests.
// A note is { id, title, text, spine?: n }. Notes with `spine` are the story (read in order 1..12);
// the rest are random fragments.
// Special readable textIds: "spine" = the next unread spine note, "random" = an unread fragment.
import { Rng, hash } from '../core/rng.js';

export const SPINE = 'spine';
export const RANDOM = 'random';

/** { spine: [notes sorted by spine], fragments: [notes sorted by id] } */
export function splitNotes(notes = {}) {
  const all = Object.values(notes);
  const spine = all.filter((n) => Number.isInteger(n.spine)).sort((a, b) => a.spine - b.spine);
  const fragments = all.filter((n) => !Number.isInteger(n.spine)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { spine, fragments };
}

/** The lowest-numbered spine note not yet collected, or null when the story is complete. */
export function nextSpine(notes, collected) {
  return splitNotes(notes).spine.find((n) => !collected.has(n.id)) ?? null;
}

/**
 * An unread fragment picked with `seed` (stable for the same seed and read-set); once every
 * fragment is read, any fragment.
 */
export function randomFragment(notes, collected, seed) {
  const { fragments } = splitNotes(notes);
  if (!fragments.length) return null;
  const unread = fragments.filter((n) => !collected.has(n.id));
  const pool = unread.length ? unread : fragments;
  return new Rng(seed >>> 0).pick(pool);
}

/**
 * Resolve a readable's textId to a note.
 * @param {string} textId  note id, "spine" or "random"
 * @param {object} notes   content.notes
 * @param {Set<string>} collected  note ids already read this run / profile
 * @param {number} seed    per-instance seed (run seed + instance key)
 * @param {Set<string>} [reserved]  ids already promised to another note in the world (avoids two
 *                                  crumpled notes showing the same fragment before either is read)
 */
export function resolveNote(textId, notes, collected, seed, reserved = new Set()) {
  if (!notes) return null;
  const busy = new Set([...collected, ...reserved]);
  // Spine order is decided when the page is read, so story notes are always read 1, 2, 3…
  if (textId === SPINE) return nextSpine(notes, collected) ?? randomFragment(notes, busy, hash(seed, 'spine-fallback'));
  if (textId === RANDOM) return randomFragment(notes, busy, seed);
  return notes[textId] ?? null;
}
