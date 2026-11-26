// The Tenant: load-time registration (imported once from src/extensions.js).
// Extension modules can't see `game` at import time, so (like src/story/register.js) we wrap
// Gameplay.prototype.update and bind the Tenant on the first gameplay frame; it then runs as a
// world system (world.addSystem). See src/tenant/system.js and CONTRACTS.md "The Tenant".
import { Gameplay } from '../gameplay/gameplay.js';
import { bindTenant } from './system.js';

const update = Gameplay.prototype.update;
Gameplay.prototype.update = function tenantBoundUpdate(dt) {
  bindTenant(this);
  return update.call(this, dt);
};
