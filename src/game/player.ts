import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Settings } from '../core/save';
import { GRENADE_SPEED, KNIFE_GRAVITY, KNIFE_SPEED, getWeapon } from '../data/weapons';
import { WeaponState, type Combatant } from './combatant';
import { stepGrenade, type Match } from './match';
import { TRAIN_H, TRAIN_HALF_W, TRAIN_LEN } from './metro';
import { TUNNEL_Y } from '../world/structures';

const BASE_FOV = 72;
const PLAYER_SPEED = 5.4;
const JUMP_V = 6.4;

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _head = new THREE.Vector3();
const _want = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Drives the human player's combatant and the third-person camera. */
/** Holding the knife button longer than this aims a throw instead of stabbing. */
export const KNIFE_HOLD = 0.2;

export class PlayerController {
  private states = new Map<string, WeaponState>();
  /** Weapons in the three hand slots (the rest are in the backpack). */
  owned: string[] = [];
  /** Knife button: pressed and for how long; aiming a throw once held long enough. */
  private knifeDown = false;
  private knifeDownT = 0;
  knifeAiming = false;
  knifeThrown = false;
  private camDist = 3.3;
  private restT = 0;
  /** Footstep phase for step sounds. */
  stepPhase = 0;
  stepped = false;
  private fov = BASE_FOV;
  private recoilP = 0;
  private bob = 0;
  jumped = false;
  reloaded = false;
  /** True while the grenade button is held: the arc preview is shown. */
  grenadeAiming = false;
  threw = false;
  slashed = false;
  /** Heli rocket fired this frame. */
  rocket = false;
  rocketFar = false;
  /** Why the last bandage press did nothing (shown once), or null. */
  bandageNo: 'none' | 'full' | null = null;
  /** Seconds since the player last dragged the view (cars swing the camera back behind). */
  private lookIdle = 0;
  /** 0 normal camera .. 1 swung round to the front to watch the backpack being opened. */
  private bagCam = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  attach(c: Combatant, owned: string[]): void {
    this.owned = [...owned];
    this.states.clear();
    this.states.set(c.weapon.def.id, c.weapon);
  }

  equip(c: Combatant, id: string): void {
    if (c.weapon.def.id === id) return;
    this.states.set(c.weapon.def.id, c.weapon);
    let st = this.states.get(id);
    if (!st) this.states.set(id, (st = new WeaponState(getWeapon(id))));
    c.weapon = st;
    c.view?.setWeapon(st.def);
  }

  /** Full ammo for one weapon (picking up a gun you already carry). */
  refill(id: string): void {
    this.states.get(id)?.refill();
  }

  refillAll(): void {
    for (const st of this.states.values()) st.refill();
  }

  cycle(c: Combatant): string {
    if (this.owned.length < 2) return c.weapon.def.id;
    const i = this.owned.indexOf(c.weapon.def.id);
    const next = this.owned[(i + 1) % this.owned.length];
    this.equip(c, next);
    return next;
  }

  onShot(c: Combatant): void {
    const r = c.weapon.def.recoil * (c.aiming ? 0.6 : 1);
    this.recoilP += r;
    c.yaw += (Math.random() - 0.5) * r * 0.6;
  }

  update(dt: number, c: Combatant, input: Input, m: Match, settings: Settings): void {
    this.jumped = this.reloaded = this.threw = this.slashed = this.rocket = this.rocketFar = this.knifeThrown = false;
    this.bandageNo = null;
    const def = c.weapon.def;
    // ---- look
    const look = input.takeLook();
    const zoomK = c.aiming ? def.zoom : 1;
    const sens = (input.isTouch ? 0.0052 : 0.0024) * settings.sensitivity * zoomK;
    if (c.alive) {
      c.yaw -= look.dx * sens;
      c.pitch -= look.dy * sens;
    }
    this.lookIdle = look.dx || look.dy ? 0 : this.lookIdle + dt;
    // recoil recovers smoothly
    const rec = Math.min(this.recoilP, this.recoilP * dt * 14 + 0.0005);
    c.pitch += rec * 0.9;
    this.recoilP -= rec;
    c.pitch = THREE.MathUtils.clamp(c.pitch, -1.1, 1.2);

    if (!c.alive) {
      c.trigger = false;
      this.grenadeAiming = false;
      this.knifeAiming = this.knifeDown = false;
      this.updateCamera(dt, c, m);
      return;
    }

    // backpack in hand: stand still, no shooting; the view can still turn
    if (c.inBag) {
      c.trigger = c.aiming = c.sprinting = false;
      this.grenadeAiming = this.knifeAiming = this.knifeDown = false;
      for (const b of ['fire', 'reload', 'jump', 'crouch', 'grenade', 'knife', 'bandage'] as const) input.consume(b);
      input.poll();
      const k = Math.min(1, dt * 10);
      c.vx -= c.vx * k;
      c.vz -= c.vz * k;
      m.move(c, c.vx * dt, c.vz * dt, dt);
      this.updateCamera(dt, c, m);
      return;
    }

    if (c.vehicle) {
      this.drive(dt, c, input, m);
      return;
    }

    // ---- aim assist (touch only): gently pull toward an enemy close to the crosshair, but
    // only while the player is shooting or steering the aim. Pulling an idle view made the
    // crosshair drift on its own; with a mouse the player aims precisely without help.
    if (settings.aimAssist && input.isTouch && (c.trigger || (look.dx || look.dy))) this.assist(dt, c, m, 1);

    // ---- buttons
    c.aiming = input.aimToggle;
    c.trigger = input.isHeld('fire');
    if (input.consume('reload') && c.weapon.startReload()) this.reloaded = true;

    // ---- movement
    input.poll();
    _f.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    _r.set(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
    if (input.consume('crouch')) c.crouch = !c.crouch;
    // sprint: Shift, or the joystick pushed all the way forward; firing/aiming cancel it
    const wantSprint = (input.sprintHeld() || (input.moveY > 0.92 && !c.crouch)) && input.moveY > 0.5 && !c.aiming && !c.trigger && !this.grenadeAiming;
    if (wantSprint) c.crouch = false;
    if (wantSprint && c.stamina > (c.sprinting ? 0.02 : 0.25)) c.sprinting = true;
    else c.sprinting = false;
    if (c.sprinting) { c.stamina = Math.max(0, c.stamina - dt / 6); this.restT = 0; }
    else { this.restT += dt; if (this.restT > 0.8) c.stamina = Math.min(1, c.stamina + dt / 4); }
    const sp = PLAYER_SPEED * def.moveMul * (c.aiming ? 0.65 : 1) * (c.speedBuffT > 0 ? 1.4 : 1) * (c.sprinting ? 1.6 : 1) * (1 - 0.5 * c.crouchK);
    const tx = (_f.x * input.moveY + _r.x * input.moveX) * sp;
    const tz = (_f.z * input.moveY + _r.z * input.moveX) * sp;
    const acc = Math.min(1, dt * (c.onGround ? 12 : 3));
    c.vx += (tx - c.vx) * acc;
    c.vz += (tz - c.vz) * acc;
    if (input.consume('jump') && c.onGround) {
      // jumping out of a crouch just stands up
      if (c.crouch) c.crouch = false;
      else {
        c.velY = JUMP_V;
        c.onGround = false;
        this.jumped = true;
      }
    }
    m.move(c, c.vx * dt, c.vz * dt, dt);
    const hs = Math.hypot(c.vx, c.vz);
    this.stepped = false;
    if (c.onGround && hs > 1) {
      this.stepPhase += dt * hs * 0.55;
      if (this.stepPhase >= 1) { this.stepPhase -= 1; this.stepped = true; }
    }
    this.updateCamera(dt, c, m);

    // shots go down the camera ray, starting level with the player
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    _head.set(c.pos.x, c.pos.y + 1.5 - 0.5 * c.crouchK, c.pos.z);
    const ahead = Math.max(0, _head.clone().sub(cam.position).dot(_dir));
    c.aimOrigin.copy(cam.position).addScaledVector(_dir, ahead + 0.3);
    c.aimDir.copy(_dir);

    // bandage (H / the bandage button): both hands busy wrapping, no knife or grenade meanwhile
    if (input.consume('bandage')) {
      if (m.useBandage(c)) { this.knifeDown = this.knifeAiming = this.grenadeAiming = false; }
      else this.bandageNo = c.bandages <= 0 ? 'none' : c.hp >= c.maxHp ? 'full' : null;
    }
    if (c.bandageT > 0) { input.consume('knife'); input.consume('grenade'); c.trigger = false; }

    // knife: a tap stabs, holding aims a throw (arc preview), releasing throws
    if (input.consume('knife')) { this.knifeDown = true; this.knifeDownT = 0; }
    if (this.knifeDown) {
      if (input.isHeld('knife')) {
        this.knifeDownT += dt;
        if (this.knifeDownT > KNIFE_HOLD && c.hasKnife) { this.knifeAiming = true; c.trigger = false; }
      } else {
        if (this.knifeAiming) {
          const keep = c.aimDir.clone();
          if (m.throwKnife(c, this.knifeDir(c, c.aimDir))) this.knifeThrown = true;
          c.aimDir.copy(keep);
        } else if (c.hasKnife) {
          m.melee(c);
          this.slashed = true;
        }
        this.knifeDown = this.knifeAiming = false;
      }
    }
    // grenade: hold to aim (arc preview), release to throw
    const held = input.isHeld('grenade');
    input.consume('grenade');
    if (held && c.grenades > 0) {
      this.grenadeAiming = true;
      c.trigger = false;
    } else if (this.grenadeAiming) {
      this.grenadeAiming = false;
      const keep = c.aimDir.clone();
      this.throwDir(c, c.aimDir);
      if (m.throwGrenade(c, GRENADE_SPEED)) this.threw = true;
      c.aimDir.copy(keep);
    }
  }

  /** Driving or flying: joystick steers, the view stays free; fire uses the vehicle gun, the grenade button its heavy weapon. */
  private drive(dt: number, c: Combatant, input: Input, m: Match): void {
    const v = c.vehicle!;
    input.poll();
    c.aiming = false;
    c.sprinting = false;
    this.grenadeAiming = false;
    c.trigger = input.isHeld('fire');
    if (v.kind === 'tank') {
      m.driveInput.set(v, { forward: input.moveY, side: input.moveX, up: 0, yaw: c.yaw });
      // the camera swings back behind the tank when the player isn't looking around
      if (this.lookIdle > 0.8 && Math.abs(v.speed) > 2) {
        let d = v.yaw - c.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        c.yaw += d * Math.min(1, dt * 2.5);
        c.pitch += (-0.12 - c.pitch) * Math.min(1, dt * 2);
      }
    } else {
      const up = (input.isHeld('jump') ? 1 : 0) - (input.isHeld('crouch') ? 1 : 0);
      m.driveInput.set(v, { forward: input.moveY, side: input.moveX, up, yaw: c.yaw });
    }
    if (input.consume('grenade')) {
      if (m.heavyFire(c)) this.rocket = true;
      else if (m.rocketFar) this.rocketFar = true;
    }
    if (input.consume('reload') && v.gun.startReload()) this.reloaded = true;
    // presses that mean nothing in a vehicle must not fire later
    input.consume('jump');
    input.consume('crouch');
    input.consume('grenade');
    input.consume('knife');
    input.consume('bandage');
    this.updateCamera(dt, c, m);
    // shots go down the camera ray, starting level with the vehicle's gun
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    if (v.kind === 'jet') _head.set(v.pos.x + fx * 2.6, v.pos.y + 0.7, v.pos.z + fz * 2.6);
    else _head.set(v.pos.x, v.pos.y + 1.9, v.pos.z);
    const ahead = Math.max(0, _want.copy(_head).sub(cam.position).dot(_dir));
    c.aimOrigin.copy(cam.position).addScaledVector(_dir, ahead + 0.3);
    c.aimDir.copy(_dir);
  }

  /** Throw direction: camera direction lifted a little so grenades arc. */
  throwDir(c: Combatant, out: THREE.Vector3): THREE.Vector3 {
    const p = Math.min(1.2, c.pitch + 0.22);
    return out.set(Math.sin(c.yaw) * Math.cos(p), Math.sin(p), Math.cos(c.yaw) * Math.cos(p));
  }

  /** Knife throw direction: along the view, lifted a touch for the drop. */
  knifeDir(c: Combatant, out: THREE.Vector3): THREE.Vector3 {
    const p = Math.min(1.2, c.pitch + 0.04);
    return out.set(Math.sin(c.yaw) * Math.cos(p), Math.sin(p), Math.cos(c.yaw) * Math.cos(p));
  }

  /** The knife's flight for the preview: straight-ish until it hits something. */
  knifeArc(c: Combatant, m: Match, out: THREE.Vector3[]): number {
    const pos = new THREE.Vector3(c.pos.x + Math.sin(c.yaw) * 0.35, c.pos.y + 1.5 - 0.4 * c.crouchK, c.pos.z + Math.cos(c.yaw) * 0.35);
    const vel = this.knifeDir(c, new THREE.Vector3()).multiplyScalar(KNIFE_SPEED);
    let n = 0;
    const step = 1 / 60;
    for (let i = 0; i < 150 && n < out.length; i++) {
      vel.y -= KNIFE_GRAVITY * step;
      const h = m.world.raycast(pos.x, pos.y, pos.z, vel.x * step, vel.y * step, vel.z * step, 1);
      if (h) { pos.addScaledVector(vel, step * h.t); break; }
      pos.addScaledVector(vel, step);
      if (i % 3 === 0) out[n++].copy(pos);
    }
    if (n < out.length) out[n++].copy(pos);
    return n;
  }

  /** Simulates the throw to draw the preview arc. Returns number of points written. */
  grenadeArc(c: Combatant, m: Match, out: THREE.Vector3[]): number {
    const g = {
      pos: new THREE.Vector3(c.pos.x + Math.sin(c.yaw) * 0.4, c.pos.y + 1.55, c.pos.z + Math.cos(c.yaw) * 0.4),
      vel: this.throwDir(c, new THREE.Vector3()).multiplyScalar(GRENADE_SPEED),
      resting: false,
    };
    g.vel.x += c.vx * 0.5;
    g.vel.z += c.vz * 0.5;
    let n = 0;
    const step = 1 / 60;
    for (let i = 0; i < 132 && n < out.length; i++) {
      stepGrenade(m.world, g, step);
      if (i % 3 === 0) out[n++].copy(g.pos);
      if (g.resting) break;
    }
    if (n < out.length) out[n++].copy(g.pos);
    return n;
  }

  private assist(dt: number, c: Combatant, m: Match, strength: number): void {
    const cp = Math.cos(c.pitch);
    _dir.set(Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp);
    let best: Combatant | null = null;
    let bestA = 0.11; // ~6 degrees
    for (const e of m.combatants) {
      if (!e.alive || e.team === c.team) continue;
      const dx = e.pos.x - c.pos.x, dy = e.pos.y + 1.2 - (c.pos.y + 1.6), dz = e.pos.z - c.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > c.weapon.def.range * 1.8 || d < 1) continue;
      const a = Math.acos(THREE.MathUtils.clamp((dx * _dir.x + dy * _dir.y + dz * _dir.z) / d, -1, 1));
      if (a < bestA && m.canSee(c, e)) { bestA = a; best = e; }
    }
    if (!best) return;
    const dx = best.pos.x - c.pos.x, dz = best.pos.z - c.pos.z;
    const wantYaw = Math.atan2(dx, dz);
    const wantPitch = Math.atan2(best.pos.y + 1.2 - (c.pos.y + 1.6), Math.hypot(dx, dz));
    let dyaw = wantYaw - c.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const k = Math.min(1, dt * 4 * strength * (c.trigger ? 1.6 : 1));
    c.yaw += dyaw * k;
    c.pitch += (wantPitch - c.pitch) * k * 0.6;
  }

  private updateCamera(dt: number, c: Combatant, m: Match): void {
    const cam = this.camera;
    const aiming = c.aiming && c.alive;
    const def = c.weapon.def;
    const targetFov = aiming ? BASE_FOV * def.zoom : BASE_FOV + (c.sprinting ? 7 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 12);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    const speed = Math.hypot(c.vx, c.vz);
    const v = c.alive ? c.vehicle : null;
    this.bob += dt * speed * 2.2;
    const bobY = c.onGround && !v ? Math.sin(this.bob) * 0.025 * Math.min(1, speed / 4) : 0;
    this.bagCam += ((c.inBag && c.alive ? 1 : 0) - this.bagCam) * Math.min(1, dt * 4);
    const bc = this.bagCam;
    const yaw = c.yaw + 2.45 * bc, pitch = (c.alive ? c.pitch : Math.max(c.pitch, -0.6)) * (1 - bc) - 0.32 * bc;
    const cp = Math.cos(pitch);
    _dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    _r.set(-Math.cos(yaw), 0, Math.sin(yaw));
    // pivot above the right shoulder (or above the vehicle, further back)
    let dist = (aiming ? 1.7 : c.alive ? 3.3 : 5.5) * (1 - bc) + 2.6 * bc;
    // with the bag open the fighter stands left of centre, clear of the bag screen on the right
    let shoulder = (aiming ? 0.62 : 0.95) * (1 - bc) + 1.15 * bc;
    let pivotY = (1.62 - 0.5 * c.crouchK) * (1 - bc) + 1.3 * bc;
    if (v) {
      dist = v.kind === 'jet' ? 13 : 8;
      shoulder = 0;
      pivotY = v.kind === 'jet' ? 3.2 : 3.0;
    }
    _head.set(c.pos.x, c.pos.y + pivotY + bobY, c.pos.z);
    // the shoulder offset never pokes through a wall beside the player (narrow tunnel, corridors)
    if (shoulder > 0) {
      const sh = m.world.raycast(_head.x, _head.y, _head.z, _r.x * shoulder, 0, _r.z * shoulder, 1);
      _head.addScaledVector(_r, sh ? Math.max(0, sh.t * shoulder - 0.35) : shoulder);
    }
    // riding the metro: the camera stays inside the carriage (its walls and roof are not world colliders)
    const t = m.train;
    const riding = !v && t.carrying(c);
    if (riding) {
      _box.set(t.x - TRAIN_LEN / 2 + 0.3, TUNNEL_Y + 0.35, -TRAIN_HALF_W + 0.5, t.x + TRAIN_LEN / 2 - 0.3, TUNNEL_Y + TRAIN_H - 0.3, TRAIN_HALF_W - 0.5);
      _head.set(clamp(_head.x, _box.x0, _box.x1), clamp(_head.y, _box.y0, _box.y1), clamp(_head.z, _box.z0, _box.z1));
    }
    _want.copy(_head).addScaledVector(_dir, -dist);
    // keep the camera out of walls
    const dx = _want.x - _head.x, dy = _want.y - _head.y, dz = _want.z - _head.z;
    const hit = m.world.raycast(_head.x, _head.y, _head.z, dx, dy, dz, 1);
    // keep 0.25 m off the wall measured square to it: at a glancing angle that is more along the ray
    const cosHit = hit ? Math.abs(hit.nx * dx + hit.ny * dy + hit.nz * dz) / Math.max(1e-6, Math.hypot(dx, dy, dz)) : 1;
    let allowed = hit ? Math.max(0.15, hit.t * dist - 0.25 / Math.max(0.2, cosHit)) : dist;
    if (riding) allowed = Math.min(allowed, Math.max(0.15, dist * exitT(_head, dx, dy, dz, _box)));
    // shrink fast, grow back slowly
    this.camDist = allowed < this.camDist ? allowed : this.camDist + (allowed - this.camDist) * Math.min(1, dt * 4);
    cam.position.copy(_head).addScaledVector(_dir, -this.camDist);
    // never dip below the floor the player stands on (street, roof or tunnel)
    if (cam.position.y < c.pos.y + 0.3) cam.position.y = c.pos.y + 0.3;
    if (riding) {
      // camDist grows back slowly: a sudden turn toward a near wall must not leave it outside
      cam.position.set(clamp(cam.position.x, _box.x0, _box.x1), clamp(cam.position.y, _box.y0, _box.y1), clamp(cam.position.z, _box.z0, _box.z1));
    }
    _want.copy(_head).addScaledVector(_dir, 30);
    cam.lookAt(_want);
  }
}

/** Inner box of the carriage the camera keeps to while riding. */
const _box = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, set(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) { Object.assign(this, { x0, y0, z0, x1, y1, z1 }); } };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fraction (0..1) of the step (dx, dy, dz) from p, which is inside b, before it leaves b. */
export function exitT(p: { x: number; y: number; z: number }, dx: number, dy: number, dz: number, b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }): number {
  let t = 1;
  const axis = (o: number, d: number, lo: number, hi: number) => {
    if (d > 1e-9) t = Math.min(t, (hi - o) / d);
    else if (d < -1e-9) t = Math.min(t, (lo - o) / d);
  };
  axis(p.x, dx, b.x0, b.x1);
  axis(p.y, dy, b.y0, b.y1);
  axis(p.z, dz, b.z0, b.z1);
  return Math.max(0, t);
}
