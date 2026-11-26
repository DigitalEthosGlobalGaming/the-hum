// Physics system: steps the prop bodies, moves their meshes and colliders, plays roll / bump /
// clatter sounds, reports noises, topples tall things, and runs carry + throw.
// Created lazily by src/physics/hooks.js (physicsOf) the first time gameplay asks for it; lives on
// world.physics and is registered with world.addSystem (update + room streaming hooks).
import * as THREE from 'three';
import { step, pushByPlayer, settleBody, impulse, wake, speedOf, collide } from './sim.js';
import { syncCollider, fitBody, localBounds } from './component.js';
import { stableKeyOf, savePose, loadPose, rekeyPose } from './persist.js';
import { physicsConfig } from './schema.js';
import { rollPool } from '../spawn/pools.js';
import { Rng, hash } from '../core/rng.js';
import { makePS1Material } from '../render/ps1.js';

const DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const HALF_PI = Math.PI / 2;

export class PhysicsSystem {
  constructor(gp) {
    this.gp = gp;
    this.game = gp.game;
    this.world = gp.game.world;
    this.objects = this.world.objects;
    const c = this.game.cfg?.physics ?? {};
    this.tun = {
      playerMass: c.playerMass ?? 45,
      reach: c.pushReach ?? 0.3,           // E · push shows within this gap (m) of a body
      shove: c.shoveSpeed ?? 2.2,          // m/s given to a 15 kg body by E · push
      holdDistance: c.holdDistance ?? 0.45,
      throwUp: c.throwUp ?? 1.6,
      impactSound: c.impactSoundSpeed ?? 0.5,
      impactNoise: c.impactNoiseSpeed ?? 1.2,
      rollNoiseEvery: c.rollNoiseEvery ?? 0.7,
      maxRollLoops: c.maxRollLoops ?? 3,
    };
    this.list = [];
    this.events = [];
    this.statics = [];
    this.carried = null;       // inst held in front of the camera
    this.topples = [];         // running topple animations
    this.rolls = new Map();    // inst → looping roll sound handle
    this.debug = null;         // F6 debug view (dev only)
    this._v = new THREE.Vector3();
    this.world.addSystem(this);
    if (DEV) this.game.events?.on?.('world:noise', (n) => this.debug && this.debug.ring(n));
  }

  get run() { return this.gp.run; }
  get poses() { return (this.world.run.bodies ??= new Map()); }

  bodies() {
    const out = this.list;
    out.length = 0;
    for (const inst of this.objects.bodies ?? []) if (inst.body && !inst.body.carried) out.push(inst.body);
    return out;
  }

  env() {
    const s = this.statics;
    s.length = 0;
    for (const c of this.world.colliders) if (!c.body) s.push(c);
    this._env ??= { isSolidAt: (x, z) => this.world.isSolidAt(x, z), statics: s, cell: 2 };
    return this._env;
  }

  // ------------------------------------------------------------------ per frame

  update(dt, ctx) {
    const game = this.game;
    if (DEV && game.input?.wasPressed?.('physicsDebug')) this.toggleDebug();
    if (game.paused || !dt) { this.debug?.update(0, this); return; }
    const bodies = this.bodies();
    const env = this.env();
    const ev = this.events;
    ev.length = 0;
    const n = dt > 1 / 50 ? 2 : 1;
    for (let i = 0; i < n; i++) step(bodies, dt / n, env, ev);
    for (const b of bodies) if (!b.sleeping || b._dirty) { this.syncVisual(b.data); b._dirty = false; }
    for (const e of ev) this.onEvent(e);
    this.updateCarry(dt);
    this.updateTopples(dt);
    this.updateRolls(dt, ctx);
    this.updateAim();
    this.debug?.update(dt, this);
  }

  /** Root mesh follows the body; collider + pick centre too. */
  syncVisual(inst) {
    const b = inst?.body;
    if (!b) return;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const r = inst.root;
    r.position.x = b.x - (b.ox * c + b.oz * s);
    r.position.z = b.z - (-b.ox * s + b.oz * c);
    r.position.y = b.y;
    r.rotation.y = b.a;
    syncCollider(inst);
  }

  onEvent(e) {
    const inst = e.body.data;
    if (!inst || e.body.removed) return;
    const P = inst.physics;
    if (e.type === 'impact') {
      this.impactFx(inst, e.speed, e);
      if (P.topple && e.speed >= P.topple) this.startTopple(inst, -e.nx, -e.nz);
      const o = e.other?.data;
      if (o?.physics?.topple && e.speed >= o.physics.topple) this.startTopple(o, -e.nx, -e.nz);
    } else if (e.type === 'land') {
      if (P.shatter && e.speed >= P.shatter.speed) return this.shatter(inst);
      this.impactFx(inst, e.speed, e, P.sound.land ?? P.sound.impact);
    } else if (e.type === 'sleep') {
      this.settled(inst);
    }
  }

  impactFx(inst, speed, at, preset = inst.physics.sound.impact) {
    const P = inst.physics, b = inst.body, t = this.game.time ?? 0;
    if (speed < this.tun.impactSound || t - (b._lastHit ?? -1) < 0.12) return;
    b._lastHit = t;
    const pos = { x: at.x ?? b.x, y: b.y + 0.3, z: at.z ?? b.z };
    if (preset) this.game.synth?.play?.(preset, { position: pos, volume: Math.min(1, 0.25 + speed / 3) });
    if (speed >= this.tun.impactNoise) this.world.noise(pos, P.noise * Math.min(1, speed / 3.5), `impact:${inst.id}`);
  }

  // ------------------------------------------------------------------ the player

  /**
   * Called by Player.move. Pushes bodies the player walks into (push = true, once per frame),
   * then moves the player fully out of every body (a body stuck against a wall blocks you).
   */
  resolvePlayer(pos, r, vel, push = true) {
    const env = push ? this.env() : null;
    const P = { shape: 'circle', x: pos.x, z: pos.z, r };
    for (const inst of this.objects.bodies ?? []) {
      const b = inst.body;
      if (!b || b.carried || b.y > 0.5) continue;
      const cl = inst.collider;
      if (cl && (pos.x + r < cl.minX || pos.x - r > cl.maxX || pos.z + r < cl.minZ || pos.z - r > cl.maxZ)) continue;
      P.x = pos.x; P.z = pos.z;
      if (push) {
        const hit = pushByPlayer(b, P, vel, this.tun.playerMass);
        if (!hit) continue;
        settleBody(b, env);
        b._dirty = true;
        this.syncVisual(inst);
        const T = inst.physics.topple;
        if (T && hit.speed >= T) this.startTopple(inst, hit.nx, hit.nz);
        if (hit.speed > 1.2 && !b._touching) this.impactFx(inst, hit.speed * 0.6, hit);
        b._touching = true;
      }
      P.x = pos.x; P.z = pos.z; // (the push may have moved the body)
      const c = collide(P, b);
      if (!c) { b._touching = false; continue; }
      pos.x += c.nx * c.depth;
      pos.z += c.nz * c.depth;
    }
  }

  /** Is the player within reach of this body (for "E · push")? */
  touching(inst) {
    const p = this.game.player.pos, b = inst.body;
    if (!b) return false;
    return !!collide({ shape: 'circle', x: p.x, z: p.z, r: this.game.cfg.player.radius + this.tun.reach }, b);
  }

  // Push-only props are only aimable while you're touching them, so the hand tag shows
  // "E · push" up close and nothing glows from across the room.
  updateAim() {
    for (const inst of this.objects.bodies ?? []) {
      const P = inst.physics;
      if (!P || P.canCarry || inst.body.carried) continue;
      if (inst.def.components?.pickup || inst.def.components?.interact || inst.readable) continue;
      inst.interactive = this.touching(inst);
    }
  }

  // ------------------------------------------------------------------ verbs (via interaction.js)

  verbFor(inst) {
    if (this.carried) return { verb: 'put down', kind: 'putdown', alt: { verb: 'throw', key: this.keyLabel('throw') } };
    const P = inst?.physics;
    if (!P?.dynamic || !inst.body) return null;
    if (P.canCarry) return { verb: 'carry', kind: 'carry' };
    if (this.touching(inst)) return { verb: 'push', kind: 'push' };
    return null;
  }

  interact(inst) {
    if (this.carried) return this.putDown();
    const P = inst?.physics;
    if (!P?.dynamic || !inst.body) return false;
    if (P.canCarry) return this.startCarry(inst);
    if (this.touching(inst)) return this.shove(inst);
    return false;
  }

  /** Input while a prop is held (E / G put down, throw key throws, use is blocked). */
  handleInput(gp) {
    const input = gp.game.input;
    if (this.carried) {
      if (input.wasPressed('throw')) this.throwCarried();
      else if (input.wasPressed('interact') || input.wasPressed('drop')) this.putDown();
      return true; // pockets are blocked while your hands are full
    }
    if (input.wasPressed('throw')) return this.throwHeld();
    this.promptThrowable();
    return false;
  }

  keyLabel(action) {
    const code = this.game.cfg.keys?.[action]?.find((c) => c.startsWith('Key')) ?? this.game.cfg.keys?.[action]?.[0] ?? '?';
    return code.replace(/^Key/, '').replace(/^Mouse2$/, 'Right click');
  }

  // A throwable just came into your hand: say how to throw it (once per item kind).
  promptThrowable() {
    const held = this.gp.inventory.held;
    if (held === this._lastHeld) return;
    this._lastHeld = held;
    if (!held || physicsConfig(held.def.components?.physics ?? {}).mode !== 'throw' || !held.def.components?.physics) return;
    this._prompted ??= new Set();
    if (this._prompted.has(held.id)) return;
    this._prompted.add(held.id);
    this.gp.caption(`${this.keyLabel('throw')} · throw`, 3, 'physics:prompt');
  }

  shove(inst) {
    const b = inst.body, P = inst.physics;
    const yaw = this.game.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // hit where the view ray passes the body: off-centre shoves spin it
    const p = this.game.player.pos;
    const t = (b.x - p.x) * fx + (b.z - p.z) * fz;
    const ax = p.x + fx * t, az = p.z + fz * t;
    const speed = this.tun.shove * Math.min(1.6, Math.sqrt(15 / Math.max(1, P.mass)));
    impulse(b, fx * speed * b.mass, fz * speed * b.mass, ax, az);
    this.impactFx(inst, Math.max(this.tun.impactSound, speed * 0.5), { x: ax, z: az });
    if (P.topple && speed >= P.topple) this.startTopple(inst, fx, fz);
    return true;
  }

  // ------------------------------------------------------------------ carry

  startCarry(inst) {
    if (this.carried || !inst.body) return false;
    const b = inst.body;
    this.leaveRoom(inst);
    b.carried = true;
    b.airborne = false;
    b.vx = b.vz = b.w = b.vy = 0;
    this.stopRoll(inst);
    const cols = this.world.colliders;
    const i = cols.indexOf(inst.collider);
    if (i >= 0) cols.splice(i, 1);
    inst._wasInteractive = inst.interactive;
    inst.interactive = false;
    this.objects.setHighlight(null);
    if (this.game.focus?.inst === inst) this.game.focus = null;
    this.carried = inst;
    this.carryYaw = b.a - this.game.player.yaw;
    const preset = inst.physics.sound.impact;
    if (preset) this.game.synth?.play?.(preset, { volume: 0.25 });
    this.game.events.emit('prop:carry', { inst });
    return true;
  }

  /** Where the held prop wants to be: in front of the eye, pulled back from walls and props. */
  holdTarget(inst) {
    const cam = this.game.camera, p = this.game.player.pos, b = inst.body;
    const yaw = this.game.player.yaw, pitch = this.game.player.pitch;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const size = Math.max(b.hx, b.hz);
    const want = this.tun.holdDistance + size;
    const margin = size * 0.9;
    let d = 0.15;
    for (; d < want; d += 0.05) {
      const x = p.x + fx * (d + margin), z = p.z + fz * (d + margin);
      if (this.world.isSolidAt(x, z) || this.inStatic(x, z, 0.05)) break;
    }
    const y = Math.max(0.05, cam.position.y - 0.5 - (b.height ?? 0.4) / 2 + Math.sin(pitch) * 0.25);
    return { x: p.x + fx * d, y, z: p.z + fz * d };
  }

  inStatic(x, z, pad) {
    for (const c of this.world.colliders) {
      if (c.body) continue;
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
    }
    return false;
  }

  updateCarry(dt) {
    const inst = this.carried;
    if (!inst) return;
    const b = inst.body;
    const t = this.holdTarget(inst);
    const k = 1 - Math.exp(-dt * 22 / Math.sqrt(Math.max(1, b.mass)));
    b.x += (t.x - b.x) * k;
    b.z += (t.z - b.z) * k;
    b.y += (t.y - b.y) * k;
    const targetA = this.game.player.yaw + this.carryYaw;
    b.a += wrapAngle(targetA - b.a) * k;
    this.syncVisual(inst);
  }

  putDown() {
    const inst = this.carried;
    if (!inst) return false;
    const b = inst.body;
    const size = Math.max(b.hx, b.hz);
    let p = null;
    const hit = this.gp.castFromEye(2.2);
    const pp = this.game.player.pos;
    if (hit?.surface === 'floor') {
      // not inside the player, not inside a wall
      const dx = hit.point.x - pp.x, dz = hit.point.z - pp.z, d = Math.hypot(dx, dz) || 1;
      const minD = this.game.cfg.player.radius + size + 0.05;
      const dd = Math.max(minD, d);
      p = { x: pp.x + (dx / d) * dd, z: pp.z + (dz / d) * dd };
    }
    if (!p || !this.clear(p.x, p.z, size)) p = { x: b.x, z: b.z }; // where it's held: already wall-checked
    this.release(inst, p.x, 0, p.z);
    b.y = 0;
    this.syncVisual(inst);
    const preset = inst.physics.sound.land ?? inst.physics.sound.impact;
    if (preset) this.game.synth?.play?.(preset, { position: { x: p.x, y: 0.2, z: p.z }, volume: 0.35 });
    this.world.noise({ x: p.x, y: 0, z: p.z }, 2, `place:${inst.id}`);
    return true;
  }

  clear(x, z, r) {
    const w = this.world;
    return !w.isSolidAt(x, z) && !w.isSolidAt(x + r, z) && !w.isSolidAt(x - r, z) && !w.isSolidAt(x, z + r) && !w.isSolidAt(x, z - r)
      && !w.wallBetween(this.game.player.pos, { x, z });
  }

  throwCarried() {
    const inst = this.carried;
    if (!inst) return false;
    const b = inst.body, P = inst.physics;
    this.release(inst, b.x, b.y, b.z);
    const speed = P.throwSpeed / Math.sqrt(Math.max(1, b.mass / 2));
    this.launch(b, speed);
    this.game.events.emit('item:throw', { id: inst.id, inst });
    return true;
  }

  /** Back into the world (not held): collider, aim, room membership. */
  release(inst, x, y, z) {
    const b = inst.body;
    b.carried = false;
    b.x = x; b.z = z; b.y = y;
    b.moved = true;
    wake(b);
    if (inst.collider && !this.world.colliders.includes(inst.collider)) this.world.colliders.push(inst.collider);
    inst.interactive = inst._wasInteractive ?? true;
    this.carried = null;
    this.joinRoom(inst, x, z);
    this.gp.clearCaption('physics:prompt');
  }

  launch(b, speed) {
    const d = this.gp.viewDir();
    b.vx = d.x * speed;
    b.vz = d.z * speed;
    b.vy = d.y * speed + this.tun.throwUp;
    b.w = (Math.random() - 0.5) * 8;
    b.airborne = true;
    b.sleeping = false;
    b.moved = true;
  }

  /** Throw the held pocket item (a `throw`-mode prop). */
  throwHeld() {
    const inv = this.gp.inventory;
    const st = inv.held;
    const P = st && physicsConfig(st.def.components?.physics ?? {});
    if (!st || !st.def.components?.physics || P.mode !== 'throw') return false;
    const cam = this.game.camera, pp = this.game.player.pos, yaw = this.game.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let d = 0.45;
    while (d > 0.05 && this.world.isSolidAt(pp.x + fx * (d + 0.1), pp.z + fz * (d + 0.1))) d -= 0.05;
    const pos = { x: pp.x + fx * d, y: cam.position.y - 0.3, z: pp.z + fz * d };
    inv.remove(inv.indexOf(st));
    const inst = this.gp.spawn(st.id, pos, yaw, { persist: true, state: st.state });
    if (!inst?.body) return true;
    const pe = this.run.placed.get(inst.meta.placedKey);
    if (pe) pe.pos[1] = 0; // it will come down; never respawn it floating
    inst.body.y = pos.y;
    this.launch(inst.body, P.throwSpeed);
    this.syncVisual(inst);
    this.game.events.emit('item:throw', { id: st.id, stack: st, inst });
    return true;
  }

  // ------------------------------------------------------------------ rooms & persistence

  /** The room this inst belongs to (its placed record), if built. */
  roomOf(inst) { return inst.meta?.roomKey != null ? this.world.rooms.get(inst.meta.roomKey) ?? null : null; }

  /**
   * Take an inst out of its room's bookkeeping (it's in your hands, or about to move rooms):
   * its spawn spot / fixed slot is marked taken so the room never respawns a copy.
   */
  leaveRoom(inst) {
    const m = inst.meta ?? (inst.meta = {});
    const key = stableKeyOf(inst);
    const room = this.roomOf(inst);
    if (room) { const i = room.objects.indexOf(inst); if (i >= 0) room.objects.splice(i, 1); }
    const run = this.run;
    if (m.placedKey) run.placed.delete(m.placedKey);
    else if (m.spotKey) run.taken.add(m.spotKey);
    else if (m.roomKey != null && m.fixed != null) run.taken.add(`${m.roomKey}#${m.fixed}`);
    if (key) { this.poses.delete(key); run.objState.delete(key); }
    inst.meta = { roomKey: null };
    return key;
  }

  /** Make an inst a placed thing of the room at (x, z), so it streams with that room. */
  joinRoom(inst, x, z) {
    const room = this.world.roomAt(x, z);
    const run = this.run;
    const placedKey = `placed:${run.placedSeq++}`;
    inst.meta = { roomKey: room?.key ?? null, placedKey };
    const r = inst.root;
    run.placed.set(placedKey, { id: inst.id, pos: [r.position.x, 0, r.position.z], rotY: r.rotation.y, state: inst.state, roomKey: inst.meta.roomKey });
    run.objState.set(placedKey, inst.state);
    if (room && !room.objects.includes(inst)) room.objects.push(inst);
  }

  /** A body came to rest: remember where, and move it to the room it ended up in. */
  settled(inst) {
    if (!inst.body?.moved || inst.body.carried) return;
    const b = inst.body;
    const here = this.world.roomAt(b.x, b.z);
    if (here && here.key !== inst.meta?.roomKey) {
      const st = inst.state;
      this.leaveRoom(inst);
      inst.state = st;
      this.joinRoom(inst, b.x, b.z);
    }
    this.persist(inst);
  }

  persist(inst) {
    const key = stableKeyOf(inst);
    const r = inst.root;
    const pose = { x: r.position.x, z: r.position.z, a: r.rotation.y, toppled: inst.toppled ?? null };
    if (!savePose(this.poses, key, inst.body, pose)) return;
    const pe = inst.meta?.placedKey ? this.run.placed.get(inst.meta.placedKey) : null;
    if (pe) { pe.pos = [pose.x, 0, pose.z]; pe.rotY = pose.a; }
  }

  onRoomPlaced(placed) {
    for (const inst of placed.objects ?? []) {
      if (!inst.body) continue;
      const pose = loadPose(this.poses, stableKeyOf(inst));
      if (!pose) continue;
      const r = inst.root;
      r.position.x = pose.x; r.position.z = pose.z; r.rotation.y = pose.a;
      if (pose.toppled) { this.tilt(inst, pose.toppled, HALF_PI); inst.toppled = pose.toppled; }
      fitBody(inst.body, inst);
      inst.body.moved = true;
      inst.body.sleeping = true;
      syncCollider(inst);
    }
  }

  onRoomDropped(placed) {
    for (const inst of placed.objects ?? []) {
      if (!inst.body) continue;
      this.stopRoll(inst);
      this.persist(inst);
    }
    this.topples = this.topples.filter((t) => !placed.objects.includes(t.inst));
  }

  // ------------------------------------------------------------------ toppling

  startTopple(inst, fx, fz) {
    const P = inst.physics;
    if (!P?.topple || inst.toppled || inst._toppling || inst.body?.carried) return false;
    const b = inst.body;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const lx = fx * c - fz * s, lz = fx * s + fz * c;      // fall direction in the body's frame
    const dir = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? '+x' : '-x') : (lz > 0 ? '+z' : '-z');
    inst._toppling = true;
    this.topples.push({ inst, t: 0, T: 0.42, dir });
    return true;
  }

  /** Rotate the mesh about its bottom edge on side `dir` by `angle` (0 upright … π/2 lying). */
  tilt(inst, dir, angle) {
    const root = inst.root;
    if (!inst.tiltPivot) {
      const lb = localBounds(root);
      const cx = (lb.minX + lb.maxX) / 2, cz = (lb.minZ + lb.maxZ) / 2;
      const px = dir === '+x' ? lb.maxX : dir === '-x' ? lb.minX : cx;
      const pz = dir === '+z' ? lb.maxZ : dir === '-z' ? lb.minZ : cz;
      const pivot = new THREE.Group(), inner = new THREE.Group();
      pivot.position.set(px, 0, pz);
      inner.position.set(-px, 0, -pz);
      for (const ch of [...root.children]) inner.add(ch);
      pivot.add(inner);
      root.add(pivot);
      inst.tiltPivot = pivot;
    }
    const p = inst.tiltPivot;
    p.rotation.set(0, 0, 0);
    if (dir === '+z') p.rotation.x = angle;
    else if (dir === '-z') p.rotation.x = -angle;
    else if (dir === '+x') p.rotation.z = -angle;
    else p.rotation.z = angle;
  }

  updateTopples(dt) {
    if (!this.topples.length) return;
    for (const tp of this.topples) {
      tp.t += dt;
      const k = Math.min(1, tp.t / tp.T);
      // falls like a stick: slow start, fast finish, then a small bounce
      let ang = HALF_PI * k * k;
      if (k >= 1) {
        const bt = tp.t - tp.T;
        ang = HALF_PI - 0.12 * Math.max(0, Math.sin(bt * 18)) * Math.exp(-bt * 9);
      }
      this.tilt(tp.inst, tp.dir, ang);
      if (k >= 1 && !tp.landed) { tp.landed = true; this.toppled(tp.inst, tp.dir); }
      if (tp.t > tp.T + 0.45) { this.tilt(tp.inst, tp.dir, HALF_PI); tp.done = true; }
    }
    this.topples = this.topples.filter((t) => !t.done);
  }

  toppled(inst, dir) {
    inst._toppling = false;
    inst.toppled = dir;
    const b = inst.body, P = inst.physics;
    this.tilt(inst, dir, HALF_PI);
    const vx = b.vx, vz = b.vz;
    fitBody(b, inst);           // lying down: new footprint
    b.vx = vx * 0.5; b.vz = vz * 0.5;
    b.moved = true;
    wake(b);
    syncCollider(inst);
    const pos = { x: b.x, y: 0.2, z: b.z };
    const preset = P.sound.topple ?? P.sound.impact;
    if (preset) this.game.synth?.play?.(preset, { position: pos, volume: 1 });
    this.world.noise(pos, P.noise, `topple:${inst.id}`);
    this.game.events.emit('prop:topple', { inst, dir });
    if (P.spill) this.spill(inst, dir);
    this.persist(inst);
  }

  /** A tipped bin spills one rolled item, once per run. */
  spill(inst, dir) {
    const st = this.gp.stateOf(inst);
    if (st.spilled) return;
    st.spilled = true;
    const key = stableKeyOf(inst) ?? String(inst.uid);
    const rng = new Rng(hash(this.game.seed >>> 0, 'spill', key));
    let ids = [];
    try { ids = rollPool(inst.physics.spill, this.game.content.pools ?? {}, rng, { depth: this.roomOf(inst)?.depth ?? 0 }); } catch (e) { console.warn('[physics] spill', e.message); }
    const b = inst.body;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const [lx, lz] = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[dir];
    const fx = lx * c + lz * s, fz = -lx * s + lz * c;     // fall direction in the world
    for (const id of ids) {
      let d = Math.max(b.hx, b.hz) + 0.15;
      while (d > 0.1 && this.world.isSolidAt(b.x + fx * d, b.z + fz * d)) d -= 0.1;
      const it = this.gp.spawn(id, { x: b.x + fx * d, y: 0, z: b.z + fz * d }, rng.range(0, Math.PI * 2), { persist: true });
      if (it?.body) { it.body.vx = fx * 1.2; it.body.vz = fz * 1.2; it.body.w = rng.range(-4, 4); wake(it.body); it.body.moved = true; }
    }
  }

  // ------------------------------------------------------------------ breaking

  shatter(inst) {
    const P = inst.physics, b = inst.body;
    const pos = { x: b.x, y: 0.1, z: b.z };
    if (P.sound.break) this.game.synth?.play?.(P.sound.break, { position: pos, volume: 1 });
    this.world.noise(pos, P.shatter.noise ?? P.noise * 2, `shatter:${inst.id}`);
    this.poses.delete(stableKeyOf(inst));
    this.stopRoll(inst);
    this.gp.removeInst(inst);
    if (P.shatter.into) this.gp.spawn(P.shatter.into, { x: b.x, y: 0, z: b.z }, Math.random() * Math.PI * 2, { persist: true });
    this.game.events.emit('prop:shatter', { id: inst.id, x: b.x, z: b.z });
  }

  // ------------------------------------------------------------------ rolling loops

  updateRolls(dt, ctx) {
    const cam = ctx?.camera?.position ?? this.game.player.pos;
    const want = [];
    for (const inst of this.objects.bodies ?? []) {
      const b = inst.body;
      if (!inst.physics?.sound.roll || b.sleeping || b.carried || b.airborne) continue;
      const sp = speedOf(b) + Math.abs(b.w) * 0.15;
      if (sp < 0.2) continue;
      want.push([inst, sp, (b.x - cam.x) ** 2 + (b.z - cam.z) ** 2]);
      // a rolling chair is a soft noise too
      b._rollNoise = (b._rollNoise ?? 0) - dt;
      if (sp > 0.6 && b._rollNoise <= 0) {
        b._rollNoise = this.tun.rollNoiseEvery;
        this.world.noise({ x: b.x, y: 0.2, z: b.z }, Math.min(6, 1.5 + sp * 1.5), `roll:${inst.id}`);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    const keep = new Set(want.slice(0, this.tun.maxRollLoops).map((w) => w[0]));
    for (const inst of [...this.rolls.keys()]) if (!keep.has(inst)) this.stopRoll(inst);
    for (const [inst, sp] of want) {
      if (!keep.has(inst)) continue;
      const b = inst.body;
      const pos = { x: b.x, y: 0.15, z: b.z };
      let h = this.rolls.get(inst);
      const vol = Math.min(1, (sp - 0.15) / 1.8);
      if (!h) {
        h = this.game.synth?.play?.(inst.physics.sound.roll, { position: pos, loop: true, volume: 0.001 });
        if (!h) continue;
        this.rolls.set(inst, h);
      }
      h.setPosition?.(pos);
      h.setVolume?.(vol, 0.08);
    }
  }

  stopRoll(inst) {
    const h = this.rolls.get(inst);
    if (!h) return;
    h.stop?.(0.25);
    this.rolls.delete(inst);
  }

  // ------------------------------------------------------------------ debug (F6, dev builds)

  toggleDebug() {
    if (this.debug) { this.debug.dispose(); this.debug = null; return; }
    this.debug = new PhysicsDebug(this.game.scene, this.game.textures);
    for (const n of this.world.noises) this.debug.ring(n);
    this.gp.caption('physics debug: noise rings + bodies (F6)', 2, 'physics:debug');
  }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Noise rings (radius = loudness, fading) and body outlines (green awake, grey asleep). */
// Drawn with the PS1 material at full emissive: plain three.js line/basic materials come out
// black through the PS1 pass.
class PhysicsDebug {
  constructor(scene, textures) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.white = textures.get('proc:white');
    this.circle = new THREE.RingGeometry(0.93, 1, 40).rotateX(-Math.PI / 2);
    // a square frame with corners at (±1, ±1): a 4-segment ring turned 45°
    this.square = new THREE.RingGeometry(Math.SQRT2 * 0.9, Math.SQRT2, 4).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2);
    this.thin = new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2);
    this.rings = [];
    this.outlines = [];
    this.mats = { awake: this.mat(0x40ff60), asleep: this.mat(0x808080) };
  }
  mat(color) {
    const m = makePS1Material(this.white, { tint: color, emissive: 1 });
    m.depthTest = false;
    m.side = THREE.DoubleSide;
    return m;
  }
  ring(n) {
    const base = new THREE.Color(n.source?.startsWith('footstep') ? 0x60a0ff : 0xff5030);
    const mat = this.mat(base);
    mat.userData.base = base;
    const line = new THREE.Mesh(n.loudness > 4 ? this.circle : this.thin, mat);
    line.position.set(n.x, 0.05, n.z);
    line.scale.setScalar(Math.max(0.1, n.loudness));
    this.group.add(line);
    this.rings.push({ line, age: 0 });
  }
  update(dt, sys) {
    for (const r of this.rings) {
      r.age += dt;
      const m = r.line.material;
      m.uniforms.uTint.value.copy(m.userData.base).multiplyScalar(Math.max(0, 1 - r.age / 1.5)); // fade by darkening
      r.line.position.y = 0.05 + r.age * 0.2;
    }
    for (const r of this.rings.filter((r) => r.age > 1.5)) { this.group.remove(r.line); r.line.material.dispose(); }
    this.rings = this.rings.filter((r) => r.age <= 1.5);
    let i = 0;
    const p = sys.game.player.pos;
    for (const inst of sys.objects.bodies ?? []) {
      const b = inst.body;
      if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 > 400) continue;
      let o = this.outlines[i];
      if (!o) { o = new THREE.Mesh(this.circle, this.mats.awake); this.group.add(o); this.outlines.push(o); }
      o.visible = true;
      o.geometry = b.shape === 'circle' ? this.circle : this.square;
      o.material = b.sleeping ? this.mats.asleep : this.mats.awake;
      o.position.set(b.x, b.y + 0.03, b.z);
      o.rotation.y = b.a;
      if (b.shape === 'circle') o.scale.set(b.r, 1, b.r); else o.scale.set(b.hx, 1, b.hz);
      i++;
    }
    for (; i < this.outlines.length; i++) this.outlines[i].visible = false;
  }
  dispose() {
    this.scene.remove(this.group);
    for (const r of this.rings) r.line.material.dispose();
    this.circle.dispose(); this.square.dispose(); this.thin.dispose();
    this.mats.awake.dispose(); this.mats.asleep.dispose();
  }
}
