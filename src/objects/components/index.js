// Component runtime behaviours, keyed by the component type used in object JSON.
// Each: { attach(inst, cfg, sys), update?(inst, cfg, sys, dt, ctx), detach?(inst, cfg, sys) }.
// Types with no entry here (interact, pickup, use, combine…) are kept as data until their milestone.
import * as THREE from 'three';

const box = new THREE.Box3();

export const components = {
  // Solid AABB from the mesh's world bounds (rotated meshes → enclosing box; fine at PS1 fidelity).
  collider: {
    attach(inst, cfg, sys) {
      if (cfg.solid === false) return;
      box.setFromObject(inst.root);
      const c = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, inst };
      inst.collider = c;
      sys.colliders.push(c);
    },
    detach(inst, cfg, sys) {
      if (inst.collider) sys.colliders.splice(sys.colliders.indexOf(inst.collider), 1);
    },
  },

  // Text lives on the instance; the interaction/notebook systems (M4/M5) present it.
  readable: {
    attach(inst, cfg) {
      inst.readable = { text: cfg.text ?? null, textId: cfg.textId ?? null, display: cfg.display ?? 'inspect' };
    },
  },

  // Emits light into the shared per-vertex light pool.
  light: {
    attach(inst, cfg, sys) {
      box.setFromObject(inst.root);
      const L = {
        pos: new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.05, (box.min.z + box.max.z) / 2),
        color: new THREE.Color(cfg.color ?? '#ffffff').multiplyScalar(cfg.intensity ?? 1),
        range: cfg.range ?? 5,
        flicker: cfg.flicker ?? 0,
        seed: inst.uid * 13.7,
        inst,
      };
      inst.light = L;
      sys.lights.push(L);
    },
    detach(inst, cfg, sys) {
      if (inst.light) sys.lights.splice(sys.lights.indexOf(inst.light), 1);
    },
  },

  // Positional procedural sound. Triggers: ambient (loop from spawn), proximity, interact/script (later).
  sound: {
    attach(inst, cfg, sys) {
      inst.sound = { fired: false, handle: null };
      if (cfg.trigger === 'ambient') startSound(inst, cfg, sys, cfg.loop ?? true);
    },
    update(inst, cfg, sys, dt, ctx) {
      const s = inst.sound;
      if (cfg.trigger !== 'proximity') return;
      const d = ctx.camera.position.distanceTo(inst.root.position);
      const r = cfg.radius ?? 5;
      if (d < r && !s.handle?.playing && !(cfg.once && s.fired)) {
        startSound(inst, cfg, sys, cfg.loop ?? false);
      } else if (d > r * 1.4 && s.handle?.playing && cfg.loop) {
        s.handle.stop?.(0.5); // hysteresis: stop well outside the trigger radius
      }
    },
    detach(inst) { inst.sound?.handle?.stop?.(0.2); },
  },
};

function startSound(inst, cfg, sys, loop) {
  const audio = sys.audio;
  inst.sound.fired = true;
  if (!audio?.play) return; // sound presets land with the audio agent's work
  const p = inst.root.position;
  inst.sound.handle = audio.play(cfg.preset, { position: { x: p.x, y: p.y + 0.5, z: p.z }, volume: cfg.volume, loop });
}
