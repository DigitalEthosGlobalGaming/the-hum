// Surface footsteps + wet footprints: install from main (it owns player.onStep).
//   const footsteps = installFootsteps(game);
//   player.onStep = (k) => { const s = footsteps.step(k); world.noise(player.pos, s.loudness, 'footstep'); };
// See ./system.js, content/surfaces.json and CONTRACTS.md "Surfaces + footprints".
import { FootstepSystem } from './system.js';
import { FootprintMesh } from './footprintMesh.js';

export function installFootsteps(game) {
  const sys = new FootstepSystem(game, {
    mesh: (ring, wet) => new FootprintMesh(ring, { size: wet.size, color: wet.color, darkness: wet.darkness }),
  });
  game.footsteps = sys;
  game.world.addSystem(sys);
  return sys;
}
