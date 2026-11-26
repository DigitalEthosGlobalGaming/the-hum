// Use a held disposable flash camera: flash, noise, camera:flash for the Tenant, and a photo page
// in the notebook (1 in 6 have something extra in them). 12 shots, shown on the camera body.
// params: { shots = 12 }
import { story } from '../../story/runtime.js';
import { takePhoto, refreshHeldCounter } from '../../story/camera.js';

export default {
  id: 'camera_flash',
  run(ctx, params) {
    const st = ctx.state.self;
    st.shots ??= params.shots ?? 12;
    if (st.shots <= 0) {
      ctx.sound.play('battery_click', { volume: 0.4 });
      return ctx.fail('The wheel turns and turns. No more film.');
    }
    if (st.cooldownUntil && ctx.time < st.cooldownUntil) return ctx.fail(); // the flash is recharging
    st.shots--;
    st.cooldownUntil = ctx.time + 1.2;
    ctx.sound.play('camera_flash');
    const game = story.game;
    if (game) {
      const room = game.world.roomAt(game.player.pos.x, game.player.pos.z);
      const name = room?.entry?.roomId ? room.entry.roomId.replace(/^lobby_/, '').replace(/_/g, ' ') : null;
      takePhoto(game, name);
      refreshHeldCounter(game);
    } else {
      ctx.world.noise(ctx.player.pos, 12, 'camera_flash');
      ctx.emit('camera:flash', { pos: ctx.player.eye, dir: ctx.player.forward() });
    }
    ctx.timer.after(0.5, () => ctx.sound.play('camera_wind', { volume: 0.6 }));
    if (st.shots === 0) ctx.timer.after(1.2, () => ctx.ui.caption('The counter reads 0.', 2.5));
    return ctx.ok({ consume: false });
  },
};
