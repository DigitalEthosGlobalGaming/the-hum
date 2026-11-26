// Screen-space paper scraps (interaction tag, captions, surface lines, pocket name tags), drawn
// as a second overlay into the low-res target with an orthographic camera in low-res pixels, so
// they get the same dither and VHS treatment as the world. Immediate-mode: call draw() each frame.
import * as THREE from 'three';
import { hash } from '../../core/rng.js';
import { makeCanvas, inkLines, paperScrap, HAND_FONT } from './text.js';
import { makeFlatMaterial, canvasTexture } from '../../viewmodel/vmMaterial.js';

const geo = new THREE.PlaneGeometry(1, 1);

export class PaperOverlay {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.overlay = game.renderer.addOverlay(this.scene, this.camera);
    this.cache = new Map();   // key → { tex, w, h }
    this.pool = [];
    this.used = 0;
    this.resize();
  }

  get W() { return this.game.renderer.lowRes.x; }
  get H() { return this.game.renderer.lowRes.y; }

  resize() {
    const r = this.game.renderer.lowRes;
    Object.assign(this.camera, { left: 0, right: r.x, top: r.y, bottom: 0 });
    this.camera.updateProjectionMatrix();
  }

  get scale() { return this.game.cfg.ui?.textScale ?? 1; }

  /** Paper texture for some lines of handwriting (cached by key+text). */
  paper(lines, { size = 10, color = '#d8cfb4', ink, key = '' } = {}) {
    size = Math.round(size * this.scale);
    const k = key + '|' + size + '|' + color + '|' + lines.join('\n');
    let e = this.cache.get(k);
    if (e) { this.cache.delete(k); this.cache.set(k, e); return e; } // LRU touch
    const [, m] = makeCanvas(4, 4);
    m.font = `bold ${size}px ${HAND_FONT}`;
    const lineH = Math.round(size * 1.3);
    const pad = Math.round(size * 0.5) + 2;
    const w = Math.ceil(Math.max(8, ...lines.map((l) => m.measureText(l).width))) + pad * 2;
    const h = lines.length * lineH + pad * 2 - Math.round(size * 0.2);
    const [c, g] = makeCanvas(w, h);
    const seed = hash(k);
    paperScrap(g, w, h, seed, { color });
    inkLines(g, lines, pad, pad - Math.round(size * 0.15), { size, lineH, seed, color: ink });
    e = { tex: canvasTexture(c), w, h };
    this.cache.set(k, e);
    if (this.cache.size > 48) {
      const [oldK, old] = this.cache.entries().next().value;
      old.tex.dispose();
      this.cache.delete(oldK);
    }
    return e;
  }

  begin() { this.used = 0; }

  /**
   * Draw a paper at low-res pixel (x, y). anchor: [ax, ay] in 0..1 of the paper (0,0 = bottom-left).
   * Returns the drawn rect { x, y, w, h } (bottom-left origin).
   */
  draw(lines, x, y, { anchor = [0, 0], opacity = 1, ...opts } = {}) {
    const e = this.paper(lines, opts);
    let mesh = this.pool[this.used];
    if (!mesh) {
      mesh = new THREE.Mesh(geo, makeFlatMaterial(e.tex));
      mesh.frustumCulled = false;
      this.pool.push(mesh);
      this.scene.add(mesh);
    }
    this.used++;
    mesh.visible = true;
    mesh.material.uniforms.map.value = e.tex;
    mesh.material.uniforms.uOpacity.value = opacity;
    mesh.renderOrder = this.used;
    const left = Math.round(x - anchor[0] * e.w), bottom = Math.round(y - anchor[1] * e.h);
    mesh.scale.set(e.w, e.h, 1);
    mesh.position.set(left + e.w / 2, bottom + e.h / 2, 0);
    return { x: left, y: bottom, w: e.w, h: e.h };
  }

  end() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
