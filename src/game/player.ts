import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Settings } from '../core/save';
import { getWeapon } from '../data/weapons';
import { WeaponState, type Combatant } from './combatant';
import type { Match } from './match';

const BASE_FOV = 72;
const PLAYER_SPEED = 5.4;
const JUMP_V = 6.4;

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _head = new THREE.Vector3();
const _want = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Drives the human player's combatant and the third-person camera. */
export class PlayerController {
  private states = new Map<string, WeaponState>();
  owned: string[] = [];
  private camDist = 3.3;
  private fov = BASE_FOV;
  private recoilP = 0;
  private bob = 0;
  jumped = false;
  reloaded = false;

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
    this.jumped = this.reloaded = false;
    const def = c.weapon.def;
    // ---- look
    const look = input.takeLook();
    const zoomK = c.aiming ? def.zoom : 1;
    const sens = (input.isTouch ? 0.0052 : 0.0024) * settings.sensitivity * zoomK;
    if (c.alive) {
      c.yaw -= look.dx * sens;
      c.pitch -= look.dy * sens;
    }
    // recoil recovers smoothly
    const rec = Math.min(this.recoilP, this.recoilP * dt * 14 + 0.0005);
    c.pitch += rec * 0.9;
    this.recoilP -= rec;
    c.pitch = THREE.MathUtils.clamp(c.pitch, -1.1, 1.2);

    if (!c.alive) {
      c.trigger = false;
      this.updateCamera(dt, c, m);
      return;
    }

    // ---- aim assist: gently pull toward an enemy close to the crosshair
    if (settings.aimAssist) this.assist(dt, c, m, input.isTouch ? 1 : 0.4);

    // ---- buttons
    c.aiming = input.aimToggle;
    c.trigger = input.isHeld('fire');
    if (input.consume('reload') && c.weapon.startReload()) this.reloaded = true;

    // ---- movement
    input.poll();
    _f.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    _r.set(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
    const sp = PLAYER_SPEED * def.moveMul * (c.aiming ? 0.65 : 1);
    const tx = (_f.x * input.moveY + _r.x * input.moveX) * sp;
    const tz = (_f.z * input.moveY + _r.z * input.moveX) * sp;
    const acc = Math.min(1, dt * (c.onGround ? 12 : 3));
    c.vx += (tx - c.vx) * acc;
    c.vz += (tz - c.vz) * acc;
    if (input.consume('jump') && c.onGround) {
      c.velY = JUMP_V;
      c.onGround = false;
      this.jumped = true;
    }
    m.move(c, c.vx * dt, c.vz * dt, dt);
    this.updateCamera(dt, c, m);

    // shots go down the camera ray, starting level with the player
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    _head.set(c.pos.x, c.pos.y + 1.5, c.pos.z);
    const ahead = Math.max(0, _head.clone().sub(cam.position).dot(_dir));
    c.aimOrigin.copy(cam.position).addScaledVector(_dir, ahead + 0.3);
    c.aimDir.copy(_dir);
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
    const targetFov = aiming ? BASE_FOV * def.zoom : BASE_FOV;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 12);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    const speed = Math.hypot(c.vx, c.vz);
    this.bob += dt * speed * 2.2;
    const bobY = c.onGround ? Math.sin(this.bob) * 0.025 * Math.min(1, speed / 4) : 0;
    const yaw = c.yaw, pitch = c.alive ? c.pitch : Math.max(c.pitch, -0.6);
    const cp = Math.cos(pitch);
    _dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    _r.set(-Math.cos(yaw), 0, Math.sin(yaw));
    // pivot above the right shoulder
    const dist = aiming ? 1.7 : c.alive ? 3.3 : 5.5;
    const shoulder = aiming ? 0.55 : 0.78;
    _head.set(c.pos.x, c.pos.y + 1.62 + bobY, c.pos.z).addScaledVector(_r, shoulder);
    _want.copy(_head).addScaledVector(_dir, -dist);
    // keep the camera out of walls
    const dx = _want.x - _head.x, dy = _want.y - _head.y, dz = _want.z - _head.z;
    const hit = m.world.raycast(_head.x, _head.y, _head.z, dx, dy, dz, 1);
    const allowed = hit ? Math.max(0.15, hit.t * dist - 0.25) : dist;
    // shrink fast, grow back slowly
    this.camDist = allowed < this.camDist ? allowed : this.camDist + (allowed - this.camDist) * Math.min(1, dt * 4);
    cam.position.copy(_head).addScaledVector(_dir, -this.camDist);
    if (cam.position.y < 0.3) cam.position.y = 0.3;
    _want.copy(_head).addScaledVector(_dir, 30);
    cam.lookAt(_want);
  }
}
