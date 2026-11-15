export type FireMode = 'semi' | 'auto' | 'burst' | 'pump' | 'bolt' | 'projectile';

export interface ProjectileSpec {
  speed: number; // m/s
  radius: number; // visual radius (m)
  splash: number; // splash radius (m), 0 = direct hit only
  gravity: number; // m/s^2 downward
  color: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  mode: FireMode;
  damage: number; // per pellet / per bullet
  fireRate: number; // shots per second
  mag: number;
  reload: number; // seconds
  spread: number; // radians, hip fire cone half-angle
  pellets: number;
  range: number; // metres; damage falls off to 50% at range
  burst?: number;
  spinUp?: number; // seconds until full fire rate (minigun)
  projectile?: ProjectileSpec;
  zoom: number; // FOV multiplier when aiming (1 = no zoom)
  moveMul: number; // movement speed multiplier
  recoil: number; // radians of camera kick per shot
  // visuals
  body: number; // main colour
  accent: number; // accent colour
  tracer: number;
  length: number; // model length in metres
  sound: SoundProfile;
}

export interface SoundProfile {
  freq: number; // low thump frequency
  noise: number; // noise lowpass cutoff
  decay: number; // seconds
  gain: number;
  laser?: boolean;
}

export const WEAPON_PRICE = 7000;

export const STARTER: WeaponDef = {
  id: 'pistol',
  name: 'Tabanca',
  desc: 'Herkesin başlangıç silahı. Güvenilir ve hızlı.',
  price: 0,
  mode: 'semi',
  damage: 22,
  fireRate: 4,
  mag: 12,
  reload: 1.3,
  spread: 0.018,
  pellets: 1,
  range: 40,
  zoom: 0.85,
  moveMul: 1.05,
  recoil: 0.018,
  body: 0x2b2f36,
  accent: 0x8a8f99,
  tracer: 0xffd27a,
  length: 0.32,
  sound: { freq: 140, noise: 3200, decay: 0.12, gain: 0.55 },
};

export const SHOP_WEAPONS: WeaponDef[] = [
  {
    id: 'smg', name: 'Şimşek SMG', desc: 'Çok hızlı ateş eder. Yakın dövüşün kralı.',
    price: WEAPON_PRICE, mode: 'auto', damage: 14, fireRate: 12, mag: 30, reload: 1.6,
    spread: 0.035, pellets: 1, range: 30, zoom: 0.85, moveMul: 1.08, recoil: 0.009,
    body: 0x1d2633, accent: 0x31c4ff, tracer: 0x8fe3ff, length: 0.55,
    sound: { freq: 170, noise: 4200, decay: 0.08, gain: 0.4 },
  },
  {
    id: 'rifle', name: 'Kartal Tüfek', desc: 'Dengeli taarruz tüfeği. Her mesafede iş görür.',
    price: WEAPON_PRICE, mode: 'auto', damage: 24, fireRate: 8, mag: 30, reload: 2.0,
    spread: 0.02, pellets: 1, range: 60, zoom: 0.7, moveMul: 1.0, recoil: 0.012,
    body: 0x3b3326, accent: 0xc9a25a, tracer: 0xffc66b, length: 0.85,
    sound: { freq: 110, noise: 3000, decay: 0.14, gain: 0.55 },
  },
  {
    id: 'shotgun', name: 'Fırtına Pompalı', desc: 'Yakından tek atışta yere serer.',
    price: WEAPON_PRICE, mode: 'pump', damage: 13, fireRate: 1.2, mag: 6, reload: 2.6,
    spread: 0.09, pellets: 9, range: 18, zoom: 0.9, moveMul: 1.0, recoil: 0.06,
    body: 0x4a2b1c, accent: 0x222222, tracer: 0xffb36b, length: 0.9,
    sound: { freq: 80, noise: 2200, decay: 0.3, gain: 0.8 },
  },
  {
    id: 'sniper', name: 'Şahin Keskin Nişancı', desc: 'Dürbünlü. Uzaktan tek atış.',
    price: WEAPON_PRICE, mode: 'bolt', damage: 95, fireRate: 0.8, mag: 5, reload: 2.8,
    spread: 0.003, pellets: 1, range: 150, zoom: 0.3, moveMul: 0.92, recoil: 0.07,
    body: 0x24331f, accent: 0x6b7f4a, tracer: 0xffffff, length: 1.15,
    sound: { freq: 70, noise: 2600, decay: 0.45, gain: 0.85 },
  },
  {
    id: 'lmg', name: 'Ayı LMG', desc: 'Dev şarjör. Durmadan ateş et.',
    price: WEAPON_PRICE, mode: 'auto', damage: 20, fireRate: 10, mag: 80, reload: 3.6,
    spread: 0.032, pellets: 1, range: 55, zoom: 0.75, moveMul: 0.85, recoil: 0.01,
    body: 0x2e2e2e, accent: 0x5c6b3a, tracer: 0xffa04d, length: 1.0,
    sound: { freq: 95, noise: 2800, decay: 0.15, gain: 0.6 },
  },
  {
    id: 'burst', name: 'Üçlü Atış', desc: 'Üç mermilik seri. Çok isabetli.',
    price: WEAPON_PRICE, mode: 'burst', burst: 3, damage: 27, fireRate: 3, mag: 24, reload: 2.0,
    spread: 0.012, pellets: 1, range: 70, zoom: 0.65, moveMul: 1.0, recoil: 0.01,
    body: 0xe8e8ea, accent: 0x2a6df4, tracer: 0x9cc2ff, length: 0.8,
    sound: { freq: 125, noise: 3600, decay: 0.1, gain: 0.5 },
  },
  {
    id: 'revolver', name: 'Kobra Revolver', desc: 'Altı mermi, devasa hasar.',
    price: WEAPON_PRICE, mode: 'semi', damage: 55, fireRate: 2, mag: 6, reload: 2.2,
    spread: 0.01, pellets: 1, range: 50, zoom: 0.8, moveMul: 1.05, recoil: 0.05,
    body: 0xb8b8c0, accent: 0x6b3a1f, tracer: 0xffe08a, length: 0.38,
    sound: { freq: 90, noise: 2500, decay: 0.3, gain: 0.75 },
  },
  {
    id: 'minigun', name: 'Kasırga Minigun', desc: 'Isınınca mermi yağmuru başlar.',
    price: WEAPON_PRICE, mode: 'auto', spinUp: 0.6, damage: 12, fireRate: 20, mag: 150, reload: 4.2,
    spread: 0.045, pellets: 1, range: 45, zoom: 0.9, moveMul: 0.75, recoil: 0.004,
    body: 0x3a3d42, accent: 0xff6a00, tracer: 0xff9a3d, length: 1.0,
    sound: { freq: 150, noise: 3800, decay: 0.06, gain: 0.35 },
  },
  {
    id: 'rocket', name: 'Volkan Roketatar', desc: 'Patlayan roket. Alan hasarı verir.',
    price: WEAPON_PRICE, mode: 'projectile', damage: 120, fireRate: 0.7, mag: 4, reload: 3.0,
    spread: 0.004, pellets: 1, range: 120, zoom: 0.8, moveMul: 0.88, recoil: 0.06,
    projectile: { speed: 38, radius: 0.12, splash: 4.5, gravity: 0, color: 0xff7a1a },
    body: 0x3d4a2a, accent: 0xd94a1a, tracer: 0xff7a1a, length: 1.2,
    sound: { freq: 55, noise: 1200, decay: 0.6, gain: 0.8 },
  },
  {
    id: 'plasma', name: 'Plazma Tüfeği', desc: 'Parlayan enerji topları fırlatır.',
    price: WEAPON_PRICE, mode: 'projectile', damage: 30, fireRate: 6, mag: 40, reload: 2.2,
    spread: 0.012, pellets: 1, range: 90, zoom: 0.75, moveMul: 1.0, recoil: 0.008,
    projectile: { speed: 75, radius: 0.14, splash: 0, gravity: 0, color: 0x6bfffa },
    body: 0x1b1f3a, accent: 0x6bfffa, tracer: 0x6bfffa, length: 0.9,
    sound: { freq: 400, noise: 6000, decay: 0.12, gain: 0.4, laser: true },
  },
];

export const ALL_WEAPONS: WeaponDef[] = [STARTER, ...SHOP_WEAPONS];

export function getWeapon(id: string): WeaponDef {
  return ALL_WEAPONS.find((w) => w.id === id) ?? STARTER;
}

/** Normalised 0..1 stats for shop bars. */
export function weaponStats(w: WeaponDef) {
  const dps = w.damage * w.pellets * w.fireRate * (w.burst ? w.burst : 1);
  return {
    damage: Math.min(1, (w.damage * w.pellets) / 120),
    rate: Math.min(1, (w.fireRate * (w.burst ?? 1)) / 20),
    range: Math.min(1, w.range / 150),
    mag: Math.min(1, w.mag / 150),
    dps,
  };
}
