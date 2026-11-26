// Every item script, listed by hand because esbuild can't glob. Add a line when you add a file:
// tools/validate.mjs fails the build if a file in this folder is missing from this list.
import badge_read from './badge_read.js';
import camera_flash from './camera_flash.js';
import chalk_mark from './chalk_mark.js';
import container_open from './container_open.js';
import drink_almond_water from './drink_almond_water.js';
import evac_map_read from './evac_map_read.js';
import flashlight_recharge from './flashlight_recharge.js';
import fuse_box_inspect from './fuse_box_inspect.js';
import fuse_insert from './fuse_insert.js';
import phone_answer from './phone_answer.js';
import read_held_note from './read_held_note.js';
import string_end_take from './string_end_take.js';
import string_use from './string_use.js';
import tape_load_blank from './tape_load_blank.js';
import tape_recorder from './tape_recorder.js';
import typewriter_type from './typewriter_type.js';
import vend_coin from './vend_coin.js';
import walkie_use from './walkie_use.js';

export default [
  badge_read,
  camera_flash,
  chalk_mark,
  container_open,
  drink_almond_water,
  evac_map_read,
  flashlight_recharge,
  fuse_box_inspect,
  fuse_insert,
  phone_answer,
  read_held_note,
  string_end_take,
  string_use,
  tape_load_blank,
  tape_recorder,
  typewriter_type,
  vend_coin,
  walkie_use,
];
