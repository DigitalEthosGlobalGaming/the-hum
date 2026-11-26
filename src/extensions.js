// Feature modules that extend the engine at load time (prefabs, procedural textures, systems).
// Imported first by main.js. Add one side-effect import per feature module, e.g.
//   import './physics/register.js';
// Keep this list sorted; each line is owned by the feature that added it.
import './story/register.js';
