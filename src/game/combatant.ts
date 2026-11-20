import * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import type { CharacterView, Team } from '../render/character';
import type { Vehicle } from './vehicle';

export const MAX_HP = 100;
export const BODY_R = 0.4;
export const BODY_H = 1.45;
export const HEAD_Y = 1.67;
export const HEAD_R = 0.22;
export const EYE_Y = 1.6;
/** How much a full crouch lowers the head and eyes, and shortens the body. */
export const CROUCH_DROP = 0.5;
export const CROUCH_BODY = 0.45;
export const STAND_HEIGHT = 1.8;

/** Per-weapon runtime state (ammo, cooldowns, reload). */
export class WeaponState {
  ammo: number;
  reloadT = 0;
  cd = 0;
  burstLeft = 0;
  spin = 0;

  constructor(readonly def: WeaponDef) {
    this.ammo = def.mag;
  }

  get reloading(): boolean {
    return this.reloadT > 0;
  }

  startReload(): boolean {
    if (this.reloadT > 0 || this.ammo >= this.def.mag) return false;
    this.reloadT = this.def.reload;
    this.burstLeft = 0;
    return true;
  }

  refill(): void {
    this.ammo = this.def.mag;
    this.reloadT = 0;
    this.cd = 0;
    this.burstLeft = 0;
    this.spin = 0;
  }

  /** Advances timers and returns how many shots to fire this frame. */
  update(dt: number, trigger: boolean): number {
    const d = this.def;
    if (d.spinUp) {
      this.spin = trigger && !this.reloading
        ? Math.min(1, this.spin + dt / d.spinUp)
        : Math.max(0, this.spin - (dt / d.spinUp) * 1.5);
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.ammo = d.mag;
      }
      return 0;
    }
    this.cd -= dt;
    let shots = 0;
    const MAX_PER_FRAME = 3;
    if (this.burstLeft > 0) {
      while (this.cd <= 0 && this.burstLeft > 0 && this.ammo > 0 && shots < MAX_PER_FRAME) {
        shots++;
        this.ammo--;
        this.burstLeft--;
        this.cd += this.burstLeft > 0 ? 0.075 : 1 / d.fireRate;
      }
    } else if (trigger && this.ammo > 0) {
      if (d.spinUp && this.spin < 0.3) {
        this.cd = Math.max(this.cd, 0);
        return 0;
      }
      const rate = d.fireRate * (d.spinUp ? 0.3 + 0.7 * this.spin : 1);
      if (this.cd <= 0 && d.mode === 'burst') {
        this.burstLeft = d.burst ?? 3;
        while (this.cd <= 0 && this.burstLeft > 0 && this.ammo > 0 && shots < MAX_PER_FRAME) {
          shots++;
          this.ammo--;
          this.burstLeft--;
          this.cd += this.burstLeft > 0 ? 0.075 : 1 / d.fireRate;
        }
      } else {
        while (this.cd <= 0 && this.ammo > 0 && shots < MAX_PER_FRAME) {
          shots++;
          this.ammo--;
          this.cd += 1 / rate;
        }
      }
    }
    // no stored "credit" while idle
    if (!trigger && this.burstLeft === 0 && this.cd < 0) this.cd = 0;
    if (this.ammo === 0 && this.burstLeft === 0) this.startReload();
    return shots;
  }
}

export class Combatant {
  readonly pos = new THREE.Vector3();
  velY = 0;
  vx = 0;
  vz = 0;
  onGround = true;
  yaw = 0;
  pitch = 0;
  hp = MAX_HP;
  alive = true;
  respawnT = 0;
  shieldT = 0;
  kills = 0;
  deaths = 0;
  trigger = false;
  aiming = false;
  readonly aimOrigin = new THREE.Vector3();
  readonly aimDir = new THREE.Vector3(0, 0, 1);
  lastShotT = -99;
  lastHurtT = -99;
  lastAttacker: Combatant | null = null;
  kick = 0;
  weapon: WeaponState;
  view?: CharacterView;
  /** Extra aim error (radians) bots add on top of weapon spread. */
  inaccuracy = 0;
  maxHp = MAX_HP;
  grenades = 0;
  maxGrenades = 0;
  /** Kills since last death. */
  streak = 0;
  meleeCd = 0;
  /** False while the knife is thrown (until picked up or it comes back). */
  hasKnife = true;
  knifeBackT = 0;
  /** Backpack in hand (choosing weapons): no shooting, no moving. */
  inBag = false;
  /** Bandages carried (picked up in buildings, used later). */
  bandages = 0;
  /** Seconds left of wrapping a bandage (0 = not bandaging); no shooting meanwhile. */
  bandageT = 0;
  /** Power-up timers (seconds left). */
  dmgBuffT = 0;
  speedBuffT = 0;
  /** Sprinting (player: stamina-limited; bots: when roaming). */
  sprinting = false;
  stamina = 1;
  /** Wants to crouch; crouchK eases toward it (0 standing .. 1 crouched). */
  crouch = false;
  crouchK = 0;
  /** Vehicle this fighter is driving, if any. */
  vehicle: Vehicle | null = null;

  constructor(readonly id: number, readonly name: string, readonly team: Team, readonly isPlayer: boolean, weapon: WeaponDef) {
    this.weapon = new WeaponState(weapon);
  }

  /** Body cylinder height for hit tests. */
  bodyH(): number { return BODY_H - CROUCH_BODY * this.crouchK; }
  headY(): number { return HEAD_Y - CROUCH_DROP * this.crouchK; }
  eyeY(): number { return EYE_Y - CROUCH_DROP * this.crouchK; }
  /** Collision height (lower when crouched). */
  height(): number { return STAND_HEIGHT - 0.6 * this.crouchK; }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setWeapon(w: WeaponDef): void {
    this.weapon = new WeaponState(w);
    this.view?.setWeapon(w);
  }
}
