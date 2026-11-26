// M4 entry point: interaction, inventory, item scripts. Owned by the M4 work stream.
// install() runs once after the world exists; update() runs every frame while playing.
//
// Exposes:
//   game.inventory  the four pockets (API in src/CONTRACTS.md)
//   game.gameplay   { inventory, combineSlots(a, b), interact(inst), use(), drop(), verbFor(inst),
//                     runScript(id, {self, params}), notesCollected, inputBlocked, ... }
import { Gameplay } from './gameplay.js';
import { handleInput, interact, useHeld, dropHeld, combineSlots, verbFor, pickup } from '../interaction/interaction.js';
import { runScript } from '../scripts/api.js';

export function installGameplay(game) {
  const gp = new Gameplay(game);
  gp.combineSlots = (a, b) => combineSlots(gp, a, b);
  gp.interact = (inst = game.focus?.inst) => interact(gp, inst);
  gp.pickup = (inst) => pickup(gp, inst);
  gp.use = () => useHeld(gp);
  gp.drop = () => dropHeld(gp);
  gp.verbFor = (inst = game.focus?.inst) => verbFor(gp, inst);
  gp.runScript = (id, opts) => runScript(gp, id, opts);
  game.gameplay = gp;
  game.inventory = gp.inventory;
  // Signals don't replay: anyone installed later reads game.inventory once, then listens.
  game.events.on('game:start', () => gp.inventory.changed());
}

export function updateGameplay(game, dt) {
  const gp = game.gameplay;
  if (!gp || game.paused) return;
  handleInput(gp);
  gp.update(dt);
}
