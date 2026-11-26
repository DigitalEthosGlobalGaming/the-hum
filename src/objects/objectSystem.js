// Object definitions (content/objects/*.json) → live instances in the world.
// An object = mesh + components. The engine only knows component *types*; content picks them.
import * as THREE from 'three';
import { makePS1Material } from '../render/ps1.js';
import { prefabs } from './prefabs.js';
import { components } from './components/index.js';

const DEG = Math.PI / 180;

export class ObjectSystem {
  constructor({ defs, textures, scene, audio }) {
    this.defs = defs;
    this.textures = textures;
    this.scene = scene;
    this.audio = audio;
    this.instances = [];
    this.byMesh = new Map();      // THREE.Object3D (root) → instance, for raycast lookups
    this.matCache = new Map();
    this.colliders = [];          // world AABBs { minX, maxX, minZ, maxZ, inst }
    this.lights = [];             // { pos, color, range, flicker, seed, inst }
    this.raycastRoots = [];
    this._nextId = 1;
  }

  material(texture = 'proc:white', tint = '#ffffff', emissive = 0, doubleSided = false) {
    const key = `${texture}|${tint}|${emissive}|${doubleSided}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = makePS1Material(this.textures.get(texture), { tint: new THREE.Color(tint), emissive });
      if (doubleSided) m.side = THREE.DoubleSide;
      this.matCache.set(key, m);
    }
    return m;
  }

  buildMesh(def) {
    const m = def.mesh;
    const root = new THREE.Group();
    switch (m.type) {
      case 'box': {
        const [x, y, z] = m.size;
        const geo = new THREE.BoxGeometry(x, y, z).translate(0, y / 2, 0);
        root.add(new THREE.Mesh(geo, this.material(m.texture, m.tint)));
        break;
      }
      case 'plane': {
        const [w, h] = m.size;
        const geo = new THREE.PlaneGeometry(w, h);
        if (m.flat) geo.rotateX(-Math.PI / 2).translate(0, 0.005, 0); // lies on the surface
        else geo.rotateY(Math.PI).translate(0, h / 2, 0);              // faces -z at rot 0
        root.add(new THREE.Mesh(geo, this.material(m.texture, m.tint, 0, m.doubleSided)));
        break;
      }
      case 'sprite': {
        const [w, h] = m.size;
        const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
        const mesh = new THREE.Mesh(geo, this.material(m.texture, m.tint, 0, true));
        mesh.userData.billboard = true;
        root.add(mesh);
        break;
      }
      case 'prefab': {
        const parts = prefabs[m.name];
        if (!parts) throw new Error(`Object "${def.id}": unknown prefab "${m.name}"`);
        for (const p of parts) {
          const geo = new THREE.BoxGeometry(...p.size);
          const mesh = new THREE.Mesh(geo, this.material(p.texture, m.tint ?? p.tint, p.emissive ?? 0));
          mesh.position.set(...p.pos);
          if (p.rot) mesh.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
          root.add(mesh);
        }
        break;
      }
      default:
        throw new Error(`Object "${def.id}": unknown mesh type "${m.type}"`);
    }
    return root;
  }

  /**
   * Spawn an object by id at a world position.
   * @param {string} id  object def id
   * @param {THREE.Vector3} pos  world position (bottom of the object)
   * @param {number} rotY  world rotation in radians
   * @param {object} meta  { roomKey, spotId } for saves and debugging
   */
  spawn(id, pos, rotY = 0, meta = {}) {
    const def = this.defs[id];
    if (!def) { console.warn(`Unknown object "${id}"`); return null; }
    const root = this.buildMesh(def);
    root.position.copy(pos);
    root.rotation.y = rotY;
    root.name = `obj:${id}`;
    this.scene.add(root);
    root.updateMatrixWorld(true);

    const inst = { uid: this._nextId++, id, def, name: def.name ?? id, root, meta, state: {}, comps: [] };
    root.userData.inst = inst;
    this.byMesh.set(root, inst);
    this.raycastRoots.push(root);
    for (const [type, cfg] of Object.entries(def.components ?? {})) {
      const impl = components[type];
      if (!impl) continue; // future component types (interact, pickup…) are data-only for now
      inst.comps.push({ type, cfg, impl });
      impl.attach?.(inst, cfg, this);
    }
    this.instances.push(inst);
    return inst;
  }

  remove(inst) {
    for (const c of inst.comps) c.impl.detach?.(inst, c.cfg, this);
    this.scene.remove(inst.root);
    this.byMesh.delete(inst.root);
    this.raycastRoots.splice(this.raycastRoots.indexOf(inst.root), 1);
    this.instances.splice(this.instances.indexOf(inst), 1);
  }

  update(dt, ctx) {
    for (const inst of this.instances) {
      for (const c of inst.comps) c.impl.update?.(inst, c.cfg, this, dt, ctx);
      // sprites turn to face the camera around Y
      for (const child of inst.root.children) {
        if (child.userData.billboard) {
          const dx = ctx.camera.position.x - inst.root.position.x;
          const dz = ctx.camera.position.z - inst.root.position.z;
          child.rotation.y = Math.atan2(dx, dz) - inst.root.rotation.y;
        }
      }
    }
  }

  /** Find the object under the camera's centre ray within maxDist metres. */
  pick(camera, maxDist = 3) {
    this._ray ??= new THREE.Raycaster();
    this._ray.setFromCamera({ x: 0, y: 0 }, camera);
    this._ray.far = maxDist;
    const hit = this._ray.intersectObjects(this.raycastRoots, true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.inst) o = o.parent;
    return o ? { inst: o.userData.inst, distance: hit.distance } : null;
  }
}
