import { ALL_WEAPONS, STARTER } from '../data/weapons';
import type { VehicleKind } from '../data/vehicles';

export type Quality = 'low' | 'medium' | 'high';
export type Difficulty = 'normal' | 'hard' | 'extreme';

export interface Settings {
  quality: Quality;
  sensitivity: number; // 0.3 .. 2
  sound: boolean;
  aimAssist: boolean;
  /** Bot toughness and skill. */
  difficulty: Difficulty;
}

export interface SaveData {
  version: 1;
  money: number;
  owned: string[];
  equipped: string;
  totalKills: number;
  matches: number;
  wins: number;
  settings: Settings;
  /** Equipment upgrade levels bought in the shop. */
  upgrades: { bag: number; armor: number };
  /** Vehicles bought in the shop. */
  vehicles: VehicleKind[];
  /** Local date (YYYY-MM-DD) of the last daily wheel spin. */
  lastSpin: string;
  /** Settings schema version; older saves get the new quality default once. */
  sv: number;
}

const KEY = 'takim-savasi-save-v1';

export function defaultQuality(): Quality {
  if (typeof navigator === 'undefined') return 'high';
  // Phones get 'medium' (sharp, no post-processing); desktops get bloom.
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 ? 'medium' : 'high';
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    money: 0,
    owned: [STARTER.id],
    equipped: STARTER.id,
    totalKills: 0,
    matches: 0,
    wins: 0,
    settings: { quality: defaultQuality(), sensitivity: 1, sound: true, aimAssist: true, difficulty: 'hard' },
    upgrades: { bag: 0, armor: 0 },
    vehicles: [],
    lastSpin: '',
    sv: 3,
  };
}

/** Validates untrusted parsed data and fills in anything missing or broken. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : def);
  d.money = num(r.money, 0);
  d.totalKills = num(r.totalKills, 0);
  d.matches = num(r.matches, 0);
  d.wins = num(r.wins, 0);
  const valid = new Set(ALL_WEAPONS.map((w) => w.id));
  if (Array.isArray(r.owned)) {
    const owned = r.owned.filter((x): x is string => typeof x === 'string' && valid.has(x));
    d.owned = Array.from(new Set([STARTER.id, ...owned]));
  }
  if (typeof r.equipped === 'string' && d.owned.includes(r.equipped)) d.equipped = r.equipped;
  const s = r.settings as Record<string, unknown> | undefined;
  if (s && typeof s === 'object') {
    if (s.quality === 'low' || s.quality === 'medium' || s.quality === 'high') d.settings.quality = s.quality;
    if (typeof s.sensitivity === 'number' && s.sensitivity >= 0.3 && s.sensitivity <= 2) d.settings.sensitivity = s.sensitivity;
    if (typeof s.sound === 'boolean') d.settings.sound = s.sound;
    if (typeof s.aimAssist === 'boolean') d.settings.aimAssist = s.aimAssist;
    if (s.difficulty === 'normal' || s.difficulty === 'hard' || s.difficulty === 'extreme') d.settings.difficulty = s.difficulty;
  }
  // Quality defaults changed in v2 and v3: re-pick the device default once.
  if (r.sv !== 3) d.settings.quality = defaultQuality();
  if (typeof r.lastSpin === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastSpin)) d.lastSpin = r.lastSpin;
  const u = r.upgrades as Record<string, unknown> | undefined;
  if (u && typeof u === 'object') {
    d.upgrades.bag = Math.min(2, num(u.bag, 0));
    d.upgrades.armor = Math.min(2, num(u.armor, 0));
  }
  // v4.7: the car became the tank and the helicopter the jet (same prices), so old purchases carry over
  const kind = (v: unknown): VehicleKind | null => (v === 'car' || v === 'tank' ? 'tank' : v === 'heli' || v === 'jet' ? 'jet' : null);
  if (Array.isArray(r.vehicles)) d.vehicles = Array.from(new Set(r.vehicles.map(kind).filter((v): v is VehicleKind => !!v)));
  return d;
}

export function loadSave(): SaveData {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt) return defaultSave();
    return sanitize(JSON.parse(txt));
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode); the game still works in memory.
  }
}
