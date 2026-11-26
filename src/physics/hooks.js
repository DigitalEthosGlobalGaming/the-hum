// Seam between the engine and the physics feature, kept free of Three.js so Node tests that
// import src/interaction/interaction.js don't pull in the renderer.
// src/physics/register.js installs the factory; the first call with a real game creates the
// PhysicsSystem and puts it on world.physics. Without the factory (Node tests) it returns null
// and everything behaves as if physics didn't exist.
let factory = null;

export function setPhysicsFactory(fn) { factory = fn; }

/** The physics system for this gameplay instance (created on first use), or null. */
export function physicsOf(gp) {
  const world = gp?.game?.world;
  if (!world) return null;
  if (world.physics) return world.physics;
  if (!factory || typeof world.addSystem !== 'function') return null;
  world.physics = factory(gp);
  return world.physics;
}
