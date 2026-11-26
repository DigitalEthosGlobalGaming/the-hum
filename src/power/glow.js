// Glow-in-the-dark writing: a canvas texture per message, drawn at PS1 size, shown with an
// emissive PS1 material (one material per message, shared by every decal that says it).
import * as THREE from 'three';
import { makePS1Material, makeDecal } from '../render/ps1.js';
import { Rng } from '../core/rng.js';

export const DEFAULT_MESSAGES = [
  'STAY IN THE LIGHT',
  'IT CAN\'T SEE YOU HERE',
  'FUSES →',
  'DON\'T TURN AROUND',
  'COUNT THE LIGHTS',
  'IT HATES THE HUM',
  'I WAS HERE 41 DAYS',
  'NOT THIS WAY',
  'LIGHTS OFF = SAFE?  NO',
  'LISTEN FOR IT',
];

export function darkMessage(list, seed) {
  const msgs = list?.length ? list : DEFAULT_MESSAGES;
  return msgs[seed % msgs.length];
}

const cache = new Map();

/** Emissive material showing `message` ('→' / '←' draw a big arrow). null outside a browser. */
export function glowMaterial(textures, message) {
  if (cache.has(message)) return cache.get(message);
  if (typeof document === 'undefined') return null;
  const tex = glowTexture(message);
  const mat = makeDecal(makePS1Material(tex, { emissive: 1, tint: 0xffffff }));
  mat.side = THREE.DoubleSide;
  cache.set(message, mat);
  return mat;
}

function glowTexture(message) {
  const W = 128, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rng = new Rng('glow:' + message);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#9dff8a';
  g.strokeStyle = '#9dff8a';
  if (message === '→' || message === '←') {
    const dir = message === '→' ? 1 : -1;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(W / 2 - dir * 46, H / 2 + rng.range(-3, 3));
    g.lineTo(W / 2 + dir * 40, H / 2);
    g.moveTo(W / 2 + dir * 40, H / 2);
    g.lineTo(W / 2 + dir * 18, H / 2 - 18);
    g.moveTo(W / 2 + dir * 40, H / 2);
    g.lineTo(W / 2 + dir * 18, H / 2 + 18);
    g.stroke();
  } else {
    // hand-painted look: word by word, slightly crooked, wrapped to two lines
    const words = message.split(' ');
    const lines = [''];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if ((cur + ' ' + w).trim().length > 9 && cur) lines.push(w); else lines[lines.length - 1] = (cur + ' ' + w).trim();
    }
    const size = lines.length > 2 ? 17 : 21;
    g.font = `bold ${size}px monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.slice(0, 3).forEach((ln, i) => {
      const y = H / 2 + (i - (Math.min(3, lines.length) - 1) / 2) * (size + 3);
      g.save();
      g.translate(W / 2 + rng.range(-3, 3), y);
      g.rotate(rng.range(-0.06, 0.06));
      g.fillText(ln, 0, 0);
      g.restore();
    });
    // drips
    for (let i = 0; i < 4; i++) g.fillRect(rng.int(16, W - 16), rng.int(H / 2, H - 14), 1, rng.int(3, 10));
  }
  // hard alpha (the PS1 shader discards alpha < 0.5)
  const img = g.getImageData(0, 0, W, H);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 90 ? 255 : 0;
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
