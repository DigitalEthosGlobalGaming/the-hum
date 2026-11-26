// Set dressing (art & level direction): low-poly prefabs + procedural textures for the
// decor_* objects in content/objects. Imported once from src/extensions.js.
import { registerPrefabs } from '../objects/prefabs.js';
import { registerPainters } from '../objects/procTextures.js';
import { decorPrefabs } from './prefabs.js';
import { decorPainters } from './painters.js';

registerPrefabs(decorPrefabs);
registerPainters(decorPainters);
