// Secrets feature module (one side-effect import in src/extensions.js).
// Extension modules can't see `game` at import time, so, like src/story/register.js, we wrap
// Gameplay.prototype.update and bind game.secrets on the first gameplay frame (idempotent).
// Content: content/secrets/*.json; scripts: src/scripts/items/secret_*.js. See CONTRACTS.md.
import { Gameplay } from '../gameplay/gameplay.js';
import { bindSecrets } from './secrets.js';

const update = Gameplay.prototype.update;
Gameplay.prototype.update = function secretsBoundUpdate(dt) {
  if (this.game?.secrets?.gp !== this) bindSecrets(this);
  return update.call(this, dt);
};
