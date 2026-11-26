// Environmental + spatial audio: load-time registration (imported once from src/extensions.js).
// Extension modules can't see `game` at import time, so (like src/story/register.js) we wrap
// Gameplay.prototype.update and bind the ambience system on the first gameplay frame; it then runs
// as a world system (world.addSystem). See src/ambience/system.js and CONTRACTS.md "Ambience".
import { Gameplay } from '../gameplay/gameplay.js';
import { bindAmbience } from './system.js';

const update = Gameplay.prototype.update;
Gameplay.prototype.update = function ambienceBoundUpdate(dt) {
  bindAmbience(this);
  return update.call(this, dt);
};
