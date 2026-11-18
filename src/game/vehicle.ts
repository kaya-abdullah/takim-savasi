import * as THREE from 'three';
import { JET_GUN, TANK_GUN, VEHICLE_DEFS, type VehicleDef, type VehicleKind } from '../data/vehicles';
import { WORLD_FLOOR, rayBox, type CollisionWorld } from '../world/collision';
import { WeaponState, type Combatant } from './combatant';

export const TANK_MAX_SPEED = 12;
const TANK_REVERSE = 5;
export const JET_SPEED = 30;
export const JET_CLIMB = 10;
export const JET_MAX_ALT = 50;
const GRAV = 18;

/** Driver controls, already mapped from the joystick/keys. */
export interface DriveInput {
  /** Car: -1..1 throttle (reverse/brake .. full). Heli: forward -1..1. */
  forward: number;
  /** Car: steering. Heli: sideways -1..1 (right +). */
  side: number;
  /** Heli: climb (+1) / descend (-1). */
  up: number;
  /** Heli: heading to turn to (the camera yaw). */
  yaw: number;
}

/** Half extents of the hit box in the vehicle's own frame (x = right, z = forward). */
const HIT: Record<VehicleKind, { hx: number; hz: number; h: number }> = {
  tank: { hx: 1.15, hz: 2.4, h: 2.0 },
  jet: { hx: 1.3, hz: 4.2, h: 2.4 },
};

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Vehicle {
  readonly def: VehicleDef;
  readonly pos = new THREE.Vector3();
  /** World velocity (heli) / vertical speed (car uses vel.y only). */
  readonly vel = new THREE.Vector3();
  yaw = 0;
  /** Car speed along its heading (m/s, negative = reverse). */
  speed = 0;
  hp: number;
  alive = true;
  driver: Combatant | null = null;
  onGround = true;
  /** Jet engine spool 0..1 (lift needs a spun-up engine). */
  rotor = 0;
  /** Visual state. */
  wheel = 0;
  steer = 0;
  tiltX = 0;
  tiltZ = 0;
  readonly gun: WeaponState;
  /** Seconds until the heavy weapon (tank shell / jet bomb) is ready. */
  rocketCd = 0;
  /** Time of the last hard crash (for sound/damage throttling). */
  lastImpact = 0;

  constructor(readonly kind: VehicleKind, readonly owner: Combatant) {
    this.def = VEHICLE_DEFS[kind];
    this.hp = this.def.hp;
    this.gun = new WeaponState(kind === 'jet' ? JET_GUN : TANK_GUN);
  }

  get maxHp(): number {
    return this.def.hp;
  }

  forwardX(): number { return Math.sin(this.yaw); }
  forwardZ(): number { return Math.cos(this.yaw); }

  /** Centre of the body (for blasts and aiming). */
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + HIT[this.kind].h * 0.5, this.pos.z);
  }

  /** Circles (x, z, r) that approximate the footprint, front to back. */
  footprint(): [number, number, number][] {
    const fx = this.forwardX(), fz = this.forwardZ();
    if (this.kind === 'tank') return [-1.3, 0, 1.3].map((o) => [this.pos.x + fx * o, this.pos.z + fz * o, this.def.radius]);
    return [[this.pos.x, this.pos.z, this.def.radius], [this.pos.x - fx * 3.6, this.pos.z - fz * 3.6, 0.5]];
  }

  /** Ray vs the rotated hit box. Returns t or null. */
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number | null {
    if (!this.alive) return null;
    const hb = HIT[this.kind];
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    // local axes: right = (c, 0, -s), forward = (s, 0, c)
    const px = ox - this.pos.x, pz = oz - this.pos.z;
    const lx = px * c - pz * s, lz = px * s + pz * c;
    const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
    const h = rayBox(lx, oy - this.pos.y, lz, ldx, dy, ldz, { minX: -hb.hx, maxX: hb.hx, minY: 0, maxY: hb.h, minZ: -hb.hz, maxZ: hb.hz }, maxT);
    return h ? h.t : null;
  }

  /** Is the point within the body (used to keep walkers out). */
  contains(x: number, z: number, r: number): [number, number] | null {
    for (const [cx, cz, cr] of this.footprint()) {
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz), min = cr + r;
      if (d < min) return d > 1e-4 ? [cx + (dx / d) * min, cz + (dz / d) * min] : [cx + min, cz];
    }
    return null;
  }

  /** One physics step. Returns the impact speed of a crash (0 if none). */
  step(world: CollisionWorld, inp: DriveInput | null, dt: number): number {
    if (!this.alive) return 0;
    this.rocketCd = Math.max(0, this.rocketCd - dt);
    return this.kind === 'tank' ? this.stepTank(world, inp, dt) : this.stepJet(world, inp, dt);
  }

  private stepTank(world: CollisionWorld, inp: DriveInput | null, dt: number): number {
    const throttle = inp?.forward ?? 0, steerIn = inp?.side ?? 0;
    if (throttle > 0.05) this.speed += (this.speed < 0 ? 24 : 11) * dt * throttle;
    else if (throttle < -0.05) this.speed += (this.speed > 0 ? 24 : 8) * dt * throttle;
    else this.speed *= 1 - Math.min(1, dt * 1.1);
    if (!inp) {
      // nobody at the wheel: the handbrake stops it within a couple of metres
      const brake = 22 * dt;
      this.speed = Math.abs(this.speed) <= brake ? 0 : this.speed - Math.sign(this.speed) * brake;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -TANK_REVERSE, TANK_MAX_SPEED);
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 8);
    // tracks let a tank pivot on the spot; reversing flips the steering like a car
    const k = this.speed < -0.5 ? -1 : 1;
    this.yaw -= this.steer * 1.5 * k * dt;
    const fx = this.forwardX(), fz = this.forwardZ();
    let x = this.pos.x + fx * this.speed * dt, z = this.pos.z + fz * this.speed * dt;
    for (let it = 0; it < 2; it++)
      for (const o of [-1.3, 0, 1.3]) {
        const px = x + fx * o, pz = z + fz * o;
        const r = world.resolveCircle(px, pz, this.def.radius, this.pos.y, 1.4, 0.5);
        x += r.x - px;
        z += r.z - pz;
      }
    const expected = this.speed * dt;
    const moved = (x - this.pos.x) * fx + (z - this.pos.z) * fz;
    let impact = 0;
    if (Math.abs(expected) > 1e-4) {
      const ratio = moved / expected;
      if (ratio < 0.7) {
        impact = Math.abs(this.speed) * (1 - Math.max(0, ratio));
        this.speed *= Math.max(0, ratio) * 0.5;
      }
    }
    this.pos.x = x;
    this.pos.z = z;
    this.fall(world, 0.9, 0.5, dt);
    this.wheel += (this.speed * dt) / 0.38;
    return impact;
  }

  private stepJet(world: CollisionWorld, inp: DriveInput | null, dt: number): number {
    this.rotor += ((inp ? 1 : 0) - this.rotor) * Math.min(1, dt * (inp ? 0.9 : 0.4));
    const v = this.vel;
    if (inp) {
      this.yaw += angleDiff(inp.yaw, this.yaw) * Math.min(1, dt * 4);
      const fx = Math.sin(inp.yaw), fz = Math.cos(inp.yaw), rx = -Math.cos(inp.yaw), rz = Math.sin(inp.yaw);
      const tx = (fx * inp.forward + rx * inp.side) * JET_SPEED, tz = (fz * inp.forward + rz * inp.side) * JET_SPEED;
      const k = Math.min(1, dt * 1.6);
      v.x += (tx - v.x) * k;
      v.z += (tz - v.z) * k;
      const lift = this.rotor > 0.55 ? inp.up * JET_CLIMB : -2;
      v.y += (lift - v.y) * Math.min(1, dt * 3);
    } else {
      v.x *= 1 - Math.min(1, dt * 1.2);
      v.z *= 1 - Math.min(1, dt * 1.2);
      v.y = Math.max(v.y - 9 * dt, -7); // autorotation: sinks gently
    }
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.addScaledVector(v, dt);
    if (this.pos.y > JET_MAX_ALT) { this.pos.y = JET_MAX_ALT; v.y = Math.min(0, v.y); }
    let impact = 0;
    const r = world.resolveCircle(this.pos.x, this.pos.z, this.def.radius, this.pos.y, 2.4, 0.6);
    if (Math.hypot(r.x - this.pos.x, r.z - this.pos.z) > 1e-3) {
      impact = Math.hypot(v.x, v.z) * 0.6;
      v.x *= 0.3;
      v.z *= 0.3;
    }
    this.pos.x = r.x;
    this.pos.z = r.z;
    const g = world.groundHeight(this.pos.x, this.pos.z, 1.3, this.pos.y, 0.6);
    if (this.pos.y <= g) {
      if (v.y < -7) impact = Math.max(impact, -v.y);
      this.pos.y = g;
      v.y = Math.max(0, v.y);
      this.onGround = true;
      v.x *= 1 - Math.min(1, dt * 4);
      v.z *= 1 - Math.min(1, dt * 4);
    } else this.onGround = false;
    if (this.pos.y < WORLD_FLOOR) this.pos.set(ox, 0, oz);
    // body leans into the motion (visual)
    const fx = this.forwardX(), fz = this.forwardZ();
    const fwd = v.x * fx + v.z * fz, side = v.x * -fz + v.z * fx;
    this.tiltX += (fwd * 0.018 - this.tiltX) * Math.min(1, dt * 4);
    this.tiltZ += (side * 0.02 - this.tiltZ) * Math.min(1, dt * 4);
    return impact;
  }

  /** Gravity and ground contact for the car. */
  private fall(world: CollisionWorld, r: number, stepUp: number, dt: number): void {
    const g = world.groundHeight(this.pos.x, this.pos.z, r, this.pos.y, stepUp);
    this.vel.y -= GRAV * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= g) {
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else this.onGround = this.pos.y - g < 0.05;
    if (this.pos.y < WORLD_FLOOR) { this.pos.y = 0; this.vel.y = 0; }
  }

  /** Horizontal speed in m/s. */
  get groundSpeed(): number {
    return this.kind === 'tank' ? Math.abs(this.speed) : Math.hypot(this.vel.x, this.vel.z);
  }
}
