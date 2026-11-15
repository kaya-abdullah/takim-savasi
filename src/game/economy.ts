import type { SaveData } from '../core/save';
import { getWeapon, SHOP_WEAPONS } from '../data/weapons';

export const KILL_REWARD = 200;
export const WIN_BONUS = 1000;
export const LOSE_BONUS = 300;
export const DRAW_BONUS = 600;

export type BuyResult = 'ok' | 'owned' | 'no-money' | 'unknown';

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

export function matchBonus(result: 'win' | 'lose' | 'draw'): number {
  return result === 'win' ? WIN_BONUS : result === 'lose' ? LOSE_BONUS : DRAW_BONUS;
}

export function formatTL(n: number): string {
  return n.toLocaleString('tr-TR') + ' TL';
}
