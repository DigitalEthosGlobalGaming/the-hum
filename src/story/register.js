// Story + container props: load-time registration (imported once from src/extensions.js).
//   - prefabs and proc: textures (./prefabs.js)
//   - the `container` component (../containers/component.js)
//   - story runtimes: typewriter, badges, evacuation maps, walkie-talkie, flash camera, red string,
//     tape-recorder lure
// Binding: extension modules can't see `game` at import time, so we wrap Gameplay.prototype.update
// to bind the story runtime on the first gameplay frame (bindStory is idempotent). See CONTRACTS.md.
import { Gameplay } from '../gameplay/gameplay.js';
import { bindStory } from './runtime.js';
import './prefabs.js';
import '../containers/component.js';
import './typewriter.js';
import './badges.js';
import './evacMap.js';
import './walkie.js';
import './camera.js';
import './redString.js';
import './tapeLure.js';

const update = Gameplay.prototype.update;
Gameplay.prototype.update = function storyBoundUpdate(dt) {
  bindStory(this);
  return update.call(this, dt);
};
