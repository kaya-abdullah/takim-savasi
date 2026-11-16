import type { WeaponDef } from './weapons';
import { STARTER } from './weapons';

export type VehicleKind = 'car' | 'heli';

export interface VehicleDef {
  kind: VehicleKind;
  name: string;
  desc: string;
  price: number;
  hp: number;
  /** Collision circle radius (m) and body height. */
  radius: number;
  height: number;
  /** Seconds before a destroyed vehicle can be called again. */
  respawn: number;
  stats: { speed: number; armor: number; weapon: number };
}

export const VEHICLE_DEFS: Record<VehicleKind, VehicleDef> = {
  car: {
    kind: 'car', name: 'Spor Araba', price: 30000, hp: 450, radius: 1.05, height: 1.5, respawn: 30,
    desc: 'Hızlı sür, düşmanları ez. Camdan ateş edebilirsin.',
    stats: { speed: 0.85, armor: 0.45, weapon: 0.35 },
  },
  heli: {
    kind: 'heli', name: 'Saldırı Helikopteri', price: 50000, hp: 700, radius: 2.2, height: 2.6, respawn: 40,
    desc: 'Gökyüzüne yüksel. Makineli top ve roketlerle saldır, çatılara in.',
    stats: { speed: 1, armor: 0.7, weapon: 1 },
  },
};

export const VEHICLE_LIST: VehicleDef[] = [VEHICLE_DEFS.car, VEHICLE_DEFS.heli];

/** Kill-feed / damage attribution for running someone over. */
export const CAR_HIT: WeaponDef = { ...STARTER, id: 'car', name: 'Araba', desc: '', damage: 400 };

export const HELI_GUN: WeaponDef = {
  ...STARTER, id: 'heligun', name: 'Helikopter Topu', desc: '', mode: 'auto',
  damage: 26, fireRate: 9, mag: 120, reload: 2.5, spread: 0.018, pellets: 1, range: 90,
  zoom: 1, moveMul: 1, recoil: 0.004, body: 0x2b2f36, accent: 0x8a8f99, tracer: 0xffb347,
  sound: { freq: 90, noise: 2400, decay: 0.12, gain: 0.55 },
};

export const HELI_ROCKET: WeaponDef = {
  ...STARTER, id: 'helirocket', name: 'Helikopter Roketi', desc: '', mode: 'projectile',
  damage: 140, fireRate: 0.5, mag: 1, reload: 2.5, spread: 0.004, pellets: 1, range: 120,
  projectile: { speed: 55, radius: 0.13, splash: 5, gravity: 0, color: 0xff7a1a },
  tracer: 0xff7a1a, sound: { freq: 55, noise: 1200, decay: 0.6, gain: 0.8 },
};
export const HELI_ROCKET_CD = 2.2;
