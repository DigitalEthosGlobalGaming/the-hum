// Per-run persistence of props the player moved. Pure (no Three.js).
// world.run.bodies: Map<stableKey, { x, z, a, toppled? }> = the instance's root pose (feet
// position + yaw, and the side it fell to), written when a body settles or its room streams out,
// read back by the physics system's onRoomPlaced hook.

/**
 * Same key rules as game.gameplay.stableKey (src/gameplay/gameplay.js): placedKey for dropped or
 * spawned things, "<spotKey>:<id>" for pool spawns, "<roomKey>#<i>" for fixed room objects.
 */
export function stableKeyOf(inst) {
  const m = inst?.meta ?? {};
  if (m.placedKey) return m.placedKey;
  if (m.spotKey) return `${m.spotKey}:${inst.id}`;
  if (m.roomKey != null && m.fixed != null) return `${m.roomKey}#${m.fixed}`;
  return null;
}

/** Record a pose under `key`, but only for bodies the player (or something) actually moved. */
export function savePose(map, key, body, pose) {
  if (!key || !body?.moved) return false;
  const e = { x: round(pose.x), z: round(pose.z), a: round(pose.a) };
  if (pose.toppled) e.toppled = pose.toppled;
  map.set(key, e);
  return true;
}

/** The saved pose for `key`, or null. */
export const loadPose = (map, key) => (key ? map.get(key) ?? null : null);

/** Move a saved pose to a new key (a prop that changed rooms got a new placedKey). */
export function rekeyPose(map, from, to) {
  if (!from || !to || from === to || !map.has(from)) return false;
  map.set(to, map.get(from));
  map.delete(from);
  return true;
}

const round = (v) => Math.round(v * 1000) / 1000;
