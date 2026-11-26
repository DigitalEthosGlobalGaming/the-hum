// What the typewriter types. Pure (Node-testable).
//   liveLine(facts, rng)  → a sentence about what the player is doing right now, from live game state
//   pickLine(...)         → the next story line, or (about 1 in 5) a live line
// Typewriter voice: lower case, second person, flat. No jokes, no gore.

/** "a battery", "an almond water", null → null */
export function withArticle(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  if (/^(the|a|an|some|your)\s/.test(n)) return n;
  return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
}

const DIRS = ['north', 'north-west', 'west', 'south-west', 'south', 'south-east', 'east', 'north-east'];
/** Compass word for a yaw (0 = facing -z = north, positive turns left/west). */
export function facingWord(yaw) {
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return DIRS[Math.round(a / (Math.PI / 4)) % 8];
}

/**
 * @param {object} f facts:
 *   near      name of what you're standing by ("the typewriter")
 *   held      display name of the held item, or null
 *   torchOn   bool, battery 0..1
 *   sanity    0..1, steps n, yaw (radians), minutes in the run
 *   lit       bool: standing under a working light
 *   photos    photos taken so far
 * @param rng  { next(): [0,1) }
 * @returns {string}
 */
export function liveLine(f, rng) {
  const near = f.near ? String(f.near).toLowerCase() : 'the typewriter';
  const held = withArticle(f.held);
  const first = `you are standing by ${near.startsWith('the ') ? near : 'the ' + near}.`;
  const hand = held ? `you are holding ${held}.` : 'your hands are empty.';
  const extra = [];
  if (f.torchOn === false) extra.push('your torch is off. you can still see the keys.');
  else if ((f.battery ?? 1) < 0.25) extra.push('your torch is dying. you know it is.');
  else extra.push('your torch is on. it is pointed at the paper.');
  if ((f.sanity ?? 1) < 0.4) extra.push('you are not sleeping well. you are standing very still.');
  if (Number.isFinite(f.steps) && f.steps > 0) extra.push(`you have taken ${f.steps} steps. you are facing ${facingWord(f.yaw ?? 0)}.`);
  if (Number.isFinite(f.minutes) && f.minutes >= 1) extra.push(`you have been here ${Math.floor(f.minutes)} minutes. you have been here longer.`);
  if (f.lit === false) extra.push('the light above you is out. you did not look up.');
  if (f.photos > 0) extra.push(`you have taken ${f.photos} photograph${f.photos === 1 ? '' : 's'}. you have not looked at all of them.`);
  // the hand clause is the signature; one other fact usually follows it
  const tail = rng.next() < 0.75 ? ' ' + extra[Math.floor(rng.next() * extra.length)] : '';
  return `${first} ${hand}${tail}`;
}

/**
 * Next line for a typewriter press.
 * @param {string[]} story   the sequence (content/lines/typewriter_story.json)
 * @param {number} index     how many story lines this run has typed so far (any typewriter)
 * @param {object} facts     liveLine facts
 * @param rng                seeded per press
 * @param {number} liveChance default 0.2 (about 1 in 5)
 * @returns {{ text: string, live: boolean, advance: boolean }}
 */
export function pickLine(story, index, facts, rng, liveChance = 0.2) {
  if (rng.next() < liveChance || !story?.length) return { text: liveLine(facts, rng), live: true, advance: false };
  if (index >= story.length) return { text: story[story.length - 1], live: false, advance: false }; // it just repeats the last line
  return { text: story[index], live: false, advance: true };
}

/** Wrap typed text to fixed-width lines (monospace). */
export function wrapMono(text, cols) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (line && line.length + 1 + word.length > cols) { out.push(line); line = word; }
    else line = line ? line + ' ' + word : word;
    while (line.length > cols) { out.push(line.slice(0, cols)); line = line.slice(cols); }
  }
  if (line) out.push(line);
  return out;
}
