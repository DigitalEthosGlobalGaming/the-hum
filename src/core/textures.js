// Texture bank backed by the build-time base64 map. Nearest filtering, no mipmaps (PS1).
import * as THREE from 'three';
import sources from 'virtual:textures';

export class TextureBank {
  constructor() { this.cache = new Map(); }

  // Decode every image up front so the first frame has no pop-in.
  async preload(names = Object.keys(sources)) {
    await Promise.all(names.map((n) => this.load(n)));
  }

  load(name) {
    if (this.cache.has(name)) return Promise.resolve(this.cache.get(name));
    const src = sources[name];
    if (!src) return Promise.reject(new Error(`Unknown texture "${name}"`));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.needsUpdate = true;
        this.cache.set(name, tex);
        resolve(tex);
      };
      img.onerror = () => reject(new Error(`Failed to decode texture "${name}"`));
      img.src = src;
    });
  }

  get(name) {
    const t = this.cache.get(name);
    if (!t) throw new Error(`Texture "${name}" not loaded (is it in assets/textures?)`);
    return t;
  }
}
