import type { SaveData } from '../core/save';
import { START_GRENADES, getWeapon, SHOP_WEAPONS } from '../data/weapons';
import { VEHICLE_DEFS, type VehicleKind } from '../data/vehicles';

export const KILL_REWARD = 200;
export const HEADSHOT_BONUS = 50;
export const KNIFE_BONUS = 100;
export const WIN_BONUS = 1400;
/** Losing costs money (never below zero). */
export const LOSE_PENALTY = 400;
export const DRAW_BONUS = 600;

export type BuyResult = 'ok' | 'owned' | 'no-money' | 'unknown' | 'max';

export function canAfford(save: SaveData, weaponId: string): boolean {
  const w = SHOP_WEAPONS.find((x) => x.id === weaponId);
  return !!w && save.money >= w.price;
}

/** Mutates save on success. */
export function buyWeapon(save: SaveData, weaponId: string): BuyResult {
  const w = SHOP_WEAPONS.find((x) => x.id === weaponId);
  if (!w) return 'unknown';
  if (save.owned.includes(w.id)) return 'owned';
  if (save.money < w.price) return 'no-money';
  save.money -= w.price;
  save.owned.push(w.id);
  save.equipped = w.id;
  return 'ok';
}

export function equipWeapon(save: SaveData, weaponId: string): boolean {
  if (!save.owned.includes(weaponId)) return false;
  save.equipped = getWeapon(weaponId).id;
  return true;
}

// ---------------------------------------------------------------- equipment
export type UpgradeId = 'bag' | 'armor';
export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: (level: number) => string;
  prices: number[]; // price of each next level
}
export const UPGRADES: UpgradeDef[] = [
  {
    id: 'bag', name: 'Bomba Çantası', prices: [1500, 3000],
    desc: (l) => `Doğarken ${START_GRENADES + l} el bombası${l < 2 ? ` → ${START_GRENADES + l + 1}` : ''}`,
  },
  {
    id: 'armor', name: 'Çelik Yelek', prices: [2500, 5000],
    desc: (l) => `Can ${100 + l * 25}${l < 2 ? ` → ${100 + (l + 1) * 25}` : ''}`,
  },
];

export function buyUpgrade(save: SaveData, id: UpgradeId): BuyResult {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return 'unknown';
  const lvl = save.upgrades[id];
  if (lvl >= u.prices.length) return 'max';
  const price = u.prices[lvl];
  if (save.money < price) return 'no-money';
  save.money -= price;
  save.upgrades[id] = lvl + 1;
  return 'ok';
}

export function grenadeCount(save: SaveData): number {
  return START_GRENADES + save.upgrades.bag;
}
export function maxHp(save: SaveData): number {
  return 100 + save.upgrades.armor * 25;
}

// ---------------------------------------------------------------- rewards
export function killReward(head: boolean, knife: boolean): number {
  return KILL_REWARD + (head ? HEADSHOT_BONUS : 0) + (knife ? KNIFE_BONUS : 0);
}

/** Kill-streak announcer: text and bonus money for the n-th kill without dying. */
export function streakReward(n: number): { text: string; bonus: number } | null {
  switch (n) {
    case 2: return { text: 'ÇİFTE LEŞ!', bonus: 0 };
    case 3: return { text: 'ÜÇLÜ LEŞ!', bonus: 100 };
    case 5: return { text: 'DURDURULAMAZ!', bonus: 250 };
    case 7: return { text: 'EFSANE!', bonus: 500 };
    case 10: return { text: 'TANRI MODU!', bonus: 1000 };
    default: return n > 10 && n % 5 === 0 ? { text: 'TANRI MODU!', bonus: 1000 } : null;
  }
}

/** Money change for a match result: positive for win/draw, negative for a loss. */
export function matchBonus(result: 'win' | 'lose' | 'draw'): number {
  return result === 'win' ? WIN_BONUS : result === 'lose' ? -LOSE_PENALTY : DRAW_BONUS;
}

/** Applies the result to the wallet; a loss never takes the balance below zero. Returns the real change. */
export function applyMatchResult(save: SaveData, result: 'win' | 'lose' | 'draw'): number {
  const delta = Math.max(-save.money, matchBonus(result));
  save.money += delta;
  return delta;
}

// ---------------------------------------------------------------- vehicles
export function buyVehicle(save: SaveData, kind: VehicleKind): BuyResult {
  const v = VEHICLE_DEFS[kind];
  if (!v) return 'unknown';
  if (save.vehicles.includes(kind)) return 'owned';
  if (save.money < v.price) return 'no-money';
  save.money -= v.price;
  save.vehicles.push(kind);
  return 'ok';
}

export function formatTL(n: number): string {
  return n.toLocaleString('tr-TR') + ' TL';
}

// ---------------------------------------------------------------- daily wheel
export const WHEEL = [100, 300, 150, 1000, 200, 500, 250, 2000];
// weights keep the big prizes rare
const WHEEL_W = [22, 14, 20, 5, 18, 9, 10, 2];

export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function canSpin(save: SaveData, now = new Date()): boolean {
  return save.lastSpin !== today(now);
}
/** Picks a wheel segment, pays it and stamps today's date. Returns the segment index or -1. */
export function spinWheel(save: SaveData, rnd = Math.random(), now = new Date()): number {
  if (!canSpin(save, now)) return -1;
  const total = WHEEL_W.reduce((a, b) => a + b, 0);
  let x = rnd * total, i = 0;
  while (i < WHEEL.length - 1 && x >= WHEEL_W[i]) { x -= WHEEL_W[i]; i++; }
  save.money += WHEEL[i];
  save.lastSpin = today(now);
  return i;
}
