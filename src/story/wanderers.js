// Earlier wanderers: seeded identities for ID badges, and the tiny procedural face on each badge.
// Pure (Node-testable): drawFace only uses the 2D context it is given.
import { Rng, hash } from '../core/rng.js';

const FALLBACK = {
  first: ['M.', 'J.', 'R.', 'A.'],
  last: ['Doe', 'Harlow', 'Mercer', 'Quill'],
  roles: ['Records clerk', 'Facilities', 'Night auditor'],
};

const SKIN = ['#e3c4a6', '#d2a681', '#b07e58', '#8a5a3c', '#6a4430', '#f0d6bd'];
const HAIR = ['#1d1712', '#3b2a1c', '#6b4a2a', '#a07a44', '#c9c2b4', '#5a1f14'];

/**
 * Identity of the wanderer on a badge.
 * @param {number} seed  the badge's seed (state.seed)
 * @param {object} lines content.lines ({ wanderer_first, wanderer_last, wanderer_roles })
 */
export function wandererFor(seed, lines = {}) {
  const r = new Rng(hash(seed >>> 0, 'wanderer'));
  const first = lines.wanderer_first?.lines ?? FALLBACK.first;
  const last = lines.wanderer_last?.lines ?? FALLBACK.last;
  const roles = lines.wanderer_roles?.lines ?? FALLBACK.roles;
  const name = `${r.pick(first)} ${r.pick(last)}`;
  const role = r.pick(roles);
  const number = String(r.int(1000, 9999)).padStart(4, '0');
  const clearance = r.pick(['A', 'B', 'B', 'C', 'C', 'C']) + r.int(1, 4);
  const year = 1979 + r.int(0, 19);
  const face = {
    skin: r.int(0, SKIN.length - 1),
    hair: r.int(0, HAIR.length - 1),
    style: r.int(0, 4),        // 0 bald-ish, 1 short, 2 parted, 3 long, 4 tall
    headW: r.range(0.56, 0.74),
    eyeY: r.range(0.42, 0.5),
    eyeGap: r.range(0.17, 0.26),
    mouth: r.int(0, 2),        // 0 flat, 1 down, 2 open
    glasses: r.chance(0.3),
    blank: r.chance(0.08),     // the photo has worn off
  };
  return { id: `badge:${seed >>> 0}`, seed: seed >>> 0, name, role, number, clearance, year, face };
}

/** Text for the notebook "wanderer" page and the inspected badge. */
export function wandererText(w) {
  return `${w.role}. Badge ${w.number}, clearance ${w.clearance}. Issued ${w.year}. ` +
    'The photo is clipped on crooked. Whoever this was came in the same way I did.';
}

/**
 * Tiny passport face, deliberately crude (blocks, not portraiture). Draws into (x, y, w, h).
 * Integer pixel blocks so it survives the PS1 pass.
 */
export function drawFace(g, x, y, w, h, face) {
  const P = Math.max(1, Math.floor(Math.min(w, h) / 16)); // block size
  const box = (fx, fy, fw, fh, col) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x + fx * w), Math.round(y + fy * h), Math.max(P, Math.round(fw * w)), Math.max(P, Math.round(fh * h)));
  };
  box(0, 0, 1, 1, '#8c97a0');                                   // backdrop
  box(0, 0.86, 1, 0.14, '#3b4250');                            // shoulders
  box(0.2, 0.8, 0.6, 0.2, '#2e3440');
  if (face.blank) { box(0.15, 0.1, 0.7, 0.75, 'rgba(230,226,214,0.9)'); return; }
  const skin = SKIN[face.skin % SKIN.length], hair = HAIR[face.hair % HAIR.length];
  const hw = face.headW, hx = 0.5 - hw / 2;
  box(0.42, 0.7, 0.16, 0.16, skin);                           // neck
  box(hx, 0.18, hw, 0.58, skin);                              // head
  if (face.style === 1) box(hx, 0.14, hw, 0.1, hair);
  if (face.style === 2) { box(hx, 0.12, hw, 0.1, hair); box(hx, 0.12, hw * 0.35, 0.18, hair); }
  if (face.style === 3) { box(hx - 0.05, 0.12, hw + 0.1, 0.1, hair); box(hx - 0.06, 0.16, 0.08, 0.5, hair); box(hx + hw - 0.02, 0.16, 0.08, 0.5, hair); }
  if (face.style === 4) box(hx + 0.04, 0.04, hw - 0.08, 0.18, hair);
  const ey = face.eyeY, gap = face.eyeGap;
  box(0.5 - gap - 0.04, ey, 0.08, 0.06, '#1a1714');           // eyes
  box(0.5 + gap - 0.04, ey, 0.08, 0.06, '#1a1714');
  if (face.glasses) {
    g.strokeStyle = '#141414'; g.lineWidth = Math.max(1, P * 0.6);
    g.strokeRect(Math.round(x + (0.5 - gap - 0.08) * w), Math.round(y + (ey - 0.03) * h), Math.round(0.16 * w), Math.round(0.12 * h));
    g.strokeRect(Math.round(x + (0.5 + gap - 0.08) * w), Math.round(y + (ey - 0.03) * h), Math.round(0.16 * w), Math.round(0.12 * h));
  }
  box(0.48, ey + 0.08, 0.05, 0.08, 'rgba(0,0,0,0.18)');      // nose shadow
  if (face.mouth === 0) box(0.4, 0.64, 0.2, 0.03, '#5a2e26');
  if (face.mouth === 1) { box(0.4, 0.66, 0.2, 0.03, '#5a2e26'); box(0.37, 0.68, 0.04, 0.03, '#5a2e26'); box(0.59, 0.68, 0.04, 0.03, '#5a2e26'); }
  if (face.mouth === 2) box(0.44, 0.62, 0.12, 0.07, '#2a1410');
}
