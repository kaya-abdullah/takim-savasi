import * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import type { CharacterView, Team } from '../render/character';

export const MAX_HP = 100;
export const BODY_R = 0.4;
export const BODY_H = 1.45;
export const HEAD_Y = 1.67;
export const HEAD_R = 0.22;
export const EYE_Y = 1.6;

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
  /** Power-up timers (seconds left). */
  dmgBuffT = 0;
  speedBuffT = 0;
  /** Sprinting (player: stamina-limited; bots: when roaming). */
  sprinting = false;
  stamina = 1;

  constructor(readonly id: number, readonly name: string, readonly team: Team, readonly isPlayer: boolean, weapon: WeaponDef) {
    this.weapon = new WeaponState(weapon);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setWeapon(w: WeaponDef): void {
    this.weapon = new WeaponState(w);
    this.view?.setWeapon(w);
  }
}
