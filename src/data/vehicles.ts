import type { WeaponDef } from './weapons';
import { STARTER } from './weapons';

export type VehicleKind = 'tank' | 'jet';

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

// prices are the old car (30000) and helicopter (50000) prices
export const VEHICLE_DEFS: Record<VehicleKind, VehicleDef> = {
  tank: {
    kind: 'tank', name: 'Savaş Tankı', price: 30000, hp: 800, radius: 1.05, height: 2.2, respawn: 30,
    desc: 'Ağır zırh. Makineliyle tara, top mermisiyle patlat, düşmanları ez.',
    stats: { speed: 0.55, armor: 1, weapon: 0.75 },
  },
  jet: {
    kind: 'jet', name: 'Savaş Uçağı', price: 50000, hp: 650, radius: 2.2, height: 2.4, respawn: 40,
    desc: 'Gökyüzüne yüksel. Uçak topuyla ateş et, büyük bombalar at, çatılara in.',
    stats: { speed: 1, armor: 0.6, weapon: 1 },
  },
};

export const VEHICLE_LIST: VehicleDef[] = [VEHICLE_DEFS.tank, VEHICLE_DEFS.jet];

/** Kill-feed / damage attribution for running someone over. */
export const TANK_HIT: WeaponDef = { ...STARTER, id: 'tank', name: 'Tank', desc: '', damage: 400 };

export const TANK_GUN: WeaponDef = {
  ...STARTER, id: 'tankgun', name: 'Tank Makinelisi', desc: '', mode: 'auto',
  damage: 20, fireRate: 8, mag: 100, reload: 2.5, spread: 0.022, pellets: 1, range: 80,
  zoom: 1, moveMul: 1, recoil: 0.004, body: 0x2b2f36, accent: 0x8a8f99, tracer: 0xffd27a,
  sound: { freq: 110, noise: 2800, decay: 0.1, gain: 0.5 },
};

/** Tank main gun: the smaller bomb (splash 6 m vs the jet's 9 m). */
export const TANK_SHELL: WeaponDef = {
  ...STARTER, id: 'tankshell', name: 'Tank Topu', desc: '', mode: 'projectile',
  damage: 160, fireRate: 0.4, mag: 1, reload: 2.5, spread: 0.003, pellets: 1, range: 120,
  projectile: { speed: 60, radius: 0.16, splash: 6, gravity: 3, color: 0xffb347 },
  tracer: 0xffb347, sound: { freq: 45, noise: 900, decay: 0.7, gain: 0.9 },
};
export const TANK_SHELL_CD = 2.5;

export const JET_GUN: WeaponDef = {
  ...STARTER, id: 'jetgun', name: 'Uçak Topu', desc: '', mode: 'auto',
  damage: 26, fireRate: 10, mag: 120, reload: 2.5, spread: 0.018, pellets: 1, range: 90,
  zoom: 1, moveMul: 1, recoil: 0.004, body: 0x2b2f36, accent: 0x8a8f99, tracer: 0xffb347,
  sound: { freq: 90, noise: 2400, decay: 0.12, gain: 0.55 },
};

/** Jet bomb: falls in an arc towards the crosshair, bigger blast than the tank shell. */
export const JET_BOMB: WeaponDef = {
  ...STARTER, id: 'jetbomb', name: 'Uçak Bombası', desc: '', mode: 'projectile',
  damage: 220, fireRate: 0.33, mag: 1, reload: 3, spread: 0.004, pellets: 1, range: 120,
  projectile: { speed: 34, radius: 0.3, splash: 9, gravity: 12, color: 0x3a3f46 },
  tracer: 0xff7a1a, sound: { freq: 40, noise: 700, decay: 0.9, gain: 1 },
};
export const JET_BOMB_CD = 3;

/** Cooldown of each vehicle's heavy weapon (grenade button). */
export const HEAVY_CD: Record<VehicleKind, number> = { tank: TANK_SHELL_CD, jet: JET_BOMB_CD };
