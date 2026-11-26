// Feature modules that extend the engine at load time (prefabs, procedural textures, systems).
// Imported first by main.js. Add one side-effect import per feature module, e.g.
//   import './physics/register.js';
// Keep this list sorted; each line is owned by the feature that added it.
import './ambience/register.js';
import './decor/register.js';
import './physics/register.js';
import './power/register.js';
import './secrets/register.js';
import './story/register.js';
import './tenant/register.js';
