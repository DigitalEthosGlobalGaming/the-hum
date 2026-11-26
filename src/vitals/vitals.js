// Vitals: sanity (falls in the dark, recovers under working lights), stamina (sprinting),
// heart rate (sanity-driven BPM for the watch + heartbeat audio), breathing when winded, and the
// meta VHS layer at low sanity (post-pass grain + wobble/chroma). Writes game.stats.sanity/stamina.
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class Vitals {
  constructor(game) {
    this.game = game;
    this.bpm = 72;
    this.exhausted = false;   // stamina hit 0: sprint is locked out until it recovers a bit
    this.dark = false;
    this.lit = false;
    this._beat = 0;
    this._breath = 0;
    this.breathing = false;
    this.grain = 0.035;
    this.distort = 0;
  }

  get cfg() { return this.game.cfg.vitals ?? {}; }

  /**
   * light: fallback luminance at the player (used only when the world has no lightAt);
   * beam: flashlight output 0..1. Light comes from world.lightAt (src/power: walls occlude,
   * dead fixtures give nothing); a calm aura (wound music box) stops the dark drain.
   */
  update(dt, { light = 0, beam = 0 } = {}) {
    const game = this.game, c = this.cfg, st = game.stats;
    const ui = game.cfg.ui ?? {};
    const world = game.world;
    if (world?.lightAt) {
      const p = game.player?.pos;
      light = world.lightAt(p ? { x: p.x, y: p.y + 1.5, z: p.z } : game.camera.position);
    }
    this.light = light;
    this.calm = !!(game.player?.pos && world?.auraAt?.(game.player.pos, 'calm'));
    if (game.playing) {
      this.lit = light > (c.lightThreshold ?? 0.18);
      this.dark = !this.lit && beam <= 0.05;
      if (this.dark && !this.calm) st.sanity -= (c.sanityDarkDrain ?? 0.004) * dt;
      else if (this.lit) st.sanity += (c.sanityLightRegen ?? 0.002) * dt;
      st.sanity = clamp01(st.sanity);

      const pl = game.player;
      const sprinting = game.input.held('sprint') && (pl.speedNow ?? 0) > game.cfg.player.walkSpeed + 0.25;
      if (sprinting) st.stamina -= (c.staminaDrain ?? 0.18) * dt;
      else st.stamina += (c.staminaRegen ?? 0.12) * dt * ((pl.speedNow ?? 0) < 0.3 ? 1.4 : 1);
      st.stamina = clamp01(st.stamina);
      if (st.stamina <= 0) this.exhausted = true;
      else if (st.stamina > (c.staminaRecover ?? 0.3)) this.exhausted = false;
    }

    // heart rate: 72 calm → 140 at zero sanity, a little exertion on top, a little jitter
    const target = 72 + (140 - 72) * (1 - st.sanity) + (1 - st.stamina) * 12;
    this.bpm += (Math.min(150, target) - this.bpm) * (1 - Math.exp(-0.8 * dt));

    // heartbeat audio below half sanity, at the BPM
    this._beat -= dt;
    if (game.playing && st.sanity < 0.5 && this._beat <= 0) {
      this._beat = 60 / this.bpm;
      game.synth?.play?.('heartbeat', { volume: 0.35 + (0.5 - st.sanity) * 1.3 });
    }
    if (this._beat < -1) this._beat = 0;

    // breathing when winded (hysteresis so it doesn't chatter at the threshold)
    if (st.stamina < 0.3) this.breathing = true;
    else if (st.stamina > 0.55) this.breathing = false;
    this._breath -= dt;
    if (game.playing && this.breathing && this._breath <= 0) {
      this._breath = 1.2 + st.stamina * 1.6;
      game.synth?.play?.('breath_heavy', { volume: 0.5 + (0.55 - st.stamina) });
    }

    // meta: grain + VHS wobble ramp in as sanity falls (smooth either way: no strobe)
    const ins = 1 - st.sanity;
    this.grain = (ui.grainBase ?? 0.035) + ins * ins * (ui.grainLowSanity ?? 0.11);
    this.distort = clamp01((0.5 - st.sanity) / 0.4) * (ui.vhsStrength ?? 1);
    const pu = game.renderer.postUniforms;
    if (pu) {
      pu.uGrain.value = this.grain;
      if (pu.uDistort) pu.uDistort.value = this.distort;
    }
  }
}
