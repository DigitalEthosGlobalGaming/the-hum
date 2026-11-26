// Object definitions (content/objects/*.json) → live instances in the world.
// An object = mesh + components. The engine only knows component *types*; content picks them.
import * as THREE from 'three';
import { makePS1Material, makeHighlightMaterial, makeOutlineMaterial } from '../render/ps1.js';
import { prefabs } from './prefabs.js';
import { components } from './components/index.js';

const DEG = Math.PI / 180;

// Components that make an object something you can act on (and so worth highlighting).
const INTERACTIVE = ['pickup', 'readable', 'interact', 'use', 'door', 'hide'];
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _box = new THREE.Box3();

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
    this.highlightCache = new Map();
    this.highlighted = null;
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
    inst.interactive = INTERACTIVE.some((t) => def.components?.[t]);
    _box.setFromObject(root);
    inst.center = _box.getCenter(new THREE.Vector3());
    inst.radius = Math.max(0.08, _box.getSize(_v).length() / 2);
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

  /** Show the glow overlay on one instance (or none). */
  setHighlight(inst) {
    if (this.highlighted === inst) return;
    if (this.highlighted) {
      for (const o of this.highlighted.overlays ?? []) o.parent?.remove(o);
      this.highlighted.overlays = null;
    }
    this.highlighted = inst;
    if (!inst) return;
    inst.overlays = [];
    const meshes = [];
    inst.root.traverse((m) => { if (m.isMesh && !m.userData.overlay) meshes.push(m); });
    this.outlineMat ??= makeOutlineMaterial();
    for (const m of meshes) {
      // 1) additive glow on the surface itself
      const tex = m.material.uniforms?.map?.value;
      let mat = this.highlightCache.get(tex);
      if (!mat) this.highlightCache.set(tex, (mat = makeHighlightMaterial(tex)));
      const glow = new THREE.Mesh(m.geometry, mat);
      glow.userData.overlay = true;
      glow.renderOrder = 10;
      m.add(glow);
      inst.overlays.push(glow);
      // 2) outline shell: scaled about the part's own centre by ~2.5 cm (skip flat planes)
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      const size = bb.getSize(new THREE.Vector3());
      if (Math.min(size.x, size.y, size.z) < 0.01) continue;
      const c = bb.getCenter(new THREE.Vector3());
      const shell = new THREE.Mesh(m.geometry, this.outlineMat);
      shell.userData.overlay = true;
      const t = 0.025;
      shell.scale.set(1 + (2 * t) / size.x, 1 + (2 * t) / size.y, 1 + (2 * t) / size.z);
      shell.position.set(c.x * (1 - shell.scale.x), c.y * (1 - shell.scale.y), c.z * (1 - shell.scale.z));
      m.add(shell);
      inst.overlays.push(shell);
    }
  }

  /**
   * The interactable the player is aiming at: closest to the view centre inside a small cone,
   * so tiny things (a battery on the carpet) don't need pixel-perfect aim.
   * @param occluded (from, to) => bool, e.g. a wall check
   */
  // Cylinder pick: anything whose centre lies within `radius` (+ half its own size) of the view
  // ray, between the eye and maxDist, is a candidate; the one closest to the ray wins.
  // Forgiving for tiny props, but still precise when several sit side by side.
  pickInteractable(camera, { maxDist = 2.6, radius = 0.35, occluded } = {}) {
    camera.getWorldDirection(_fwd);
    let best = null, bestScore = Infinity;
    for (const inst of this.instances) {
      if (!inst.interactive) continue;
      _v.copy(inst.center).sub(camera.position);
      const along = _v.dot(_fwd);                       // distance along the ray
      if (along < 0.1 || along > maxDist) continue;
      const perp = Math.sqrt(Math.max(0, _v.lengthSq() - along * along)); // distance from the ray
      const allow = radius + inst.radius * 0.5;
      if (perp > allow) continue;
      if (occluded?.(camera.position, inst.center)) continue;
      const score = perp / allow + along * 0.02;        // closest to centre first, nearer breaks ties
      if (score < bestScore) { bestScore = score; best = inst; }
    }
    return best ? { inst: best, distance: camera.position.distanceTo(best.center) } : null;
  }

  remove(inst) {
    if (this.highlighted === inst) this.setHighlight(null);
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
