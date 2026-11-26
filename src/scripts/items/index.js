// Every item script, listed by hand because esbuild can't glob. Add a line when you add a file:
// tools/validate.mjs fails the build if a file in this folder is missing from this list.
import chalk_mark from './chalk_mark.js';
import drink_almond_water from './drink_almond_water.js';
import flashlight_recharge from './flashlight_recharge.js';
import fuse_box_inspect from './fuse_box_inspect.js';
import fuse_insert from './fuse_insert.js';
import phone_answer from './phone_answer.js';
import read_held_note from './read_held_note.js';
import tape_recorder from './tape_recorder.js';

export default [
  chalk_mark,
  drink_almond_water,
  flashlight_recharge,
  fuse_box_inspect,
  fuse_insert,
  phone_answer,
  read_held_note,
  tape_recorder,
];
