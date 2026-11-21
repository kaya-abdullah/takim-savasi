import { describe, expect, it } from 'vitest';
import { canSpin, spinWheel, WHEEL, buyUpgrade, buyWeapon, equipWeapon, grenadeCount, KILL_REWARD, killReward, matchBonus, maxHp, streakReward } from '../src/game/economy';
import { defaultSave, sanitize } from '../src/core/save';
import { SHOP_WEAPONS, STARTER, getWeapon } from '../src/data/weapons';
import { buildPhysics, createMap, mapColliders, propBox, buildingBox } from '../src/world/map';
import { CollisionWorld, rayBox, rayCharacter } from '../src/world/collision';
import { NavGrid } from '../src/world/navgrid';

describe('weapons', () => {
  it('has exactly 10 shop weapons with prices rising in shop order', () => {
    expect(SHOP_WEAPONS).toHaveLength(10);
    for (let i = 1; i < SHOP_WEAPONS.length; i++) expect(SHOP_WEAPONS[i].price).toBeGreaterThan(SHOP_WEAPONS[i - 1].price);
    expect(SHOP_WEAPONS[0].price).toBeLessThanOrEqual(2000); // first gun within ~1-2 matches
    expect(SHOP_WEAPONS[9].price).toBeLessThanOrEqual(10000);
    const ids = new Set([STARTER.id, ...SHOP_WEAPONS.map((w) => w.id)]);
    expect(ids.size).toBe(11);
  });
  it('starter is free and unknown ids fall back to starter', () => {
    expect(STARTER.price).toBe(0);
    expect(getWeapon('nope').id).toBe(STARTER.id);
  });
});

describe('economy', () => {
  it('rejects purchase without money and accepts with the exact price', () => {
    const s = defaultSave();
    const price = getWeapon('rifle').price;
    s.money = price - 1;
    expect(buyWeapon(s, 'rifle')).toBe('no-money');
    s.money = price;
    expect(buyWeapon(s, 'rifle')).toBe('ok');
    expect(s.money).toBe(0);
    expect(s.owned).toContain('rifle');
    expect(s.equipped).toBe('rifle');
    expect(buyWeapon(s, 'rifle')).toBe('owned');
    expect(buyWeapon(s, 'pistol')).toBe('unknown');
  });
  it('equip only owned weapons', () => {
    const s = defaultSave();
    expect(equipWeapon(s, 'sniper')).toBe(false);
    expect(equipWeapon(s, 'pistol')).toBe(true);
  });
  it('a typical match (10 kills + win) earns 3400 TL; a loss costs 400 TL', () => {
    expect(10 * KILL_REWARD + matchBonus('win')).toBe(3400);
    expect(matchBonus('lose')).toBe(-400);
  });
  it('kill rewards: headshot and knife bonuses, streak bonuses', () => {
    expect(killReward(false, false)).toBe(200);
    expect(killReward(true, false)).toBe(250);
    expect(killReward(false, true)).toBe(300);
    expect(streakReward(1)).toBeNull();
    expect(streakReward(3)!.bonus).toBe(100);
    expect(streakReward(5)!.text).toBe('DURDURULAMAZ!');
  });
  it('equipment upgrades: levels, prices, max', () => {
    const s = defaultSave();
    expect(grenadeCount(s)).toBe(3);
    expect(maxHp(s)).toBe(100);
    expect(buyUpgrade(s, 'bag')).toBe('no-money');
    s.money = 100000;
    expect(buyUpgrade(s, 'bag')).toBe('ok');
    expect(buyUpgrade(s, 'bag')).toBe('ok');
    expect(buyUpgrade(s, 'bag')).toBe('max');
    expect(grenadeCount(s)).toBe(5);
    expect(buyUpgrade(s, 'armor')).toBe('ok');
    expect(maxHp(s)).toBe(125);
    expect(s.money).toBe(100000 - 1500 - 3000 - 2500);
    // the vest goes up to level 5
    for (let i = 0; i < 4; i++) expect(buyUpgrade(s, 'armor')).toBe('ok');
    expect(buyUpgrade(s, 'armor')).toBe('max');
    expect(maxHp(s)).toBe(225);
  });
});

describe('save', () => {
  it('sanitizes garbage', () => {
    const s = sanitize({ money: -5, owned: ['rifle', 'hack', 3], equipped: 'sniper', settings: { quality: 'ultra', sensitivity: 99 } });
    expect(s.money).toBe(0);
    expect(s.owned).toEqual(['pistol', 'rifle']);
    expect(s.equipped).toBe('pistol');
    expect(['low', 'medium', 'high']).toContain(s.settings.quality);
    expect(s.settings.sensitivity).toBe(1);
  });
  it('migrates old saves to high quality once and keeps upgrades', () => {
    const old = sanitize({ money: 5, settings: { quality: 'low' } });
    expect(old.settings.quality).toBe('high'); // node has no phone UA -> desktop default
    const cur = sanitize({ sv: 3, settings: { quality: 'low' }, upgrades: { bag: 1, armor: 9 } });
    expect(cur.settings.quality).toBe('low');
    expect(cur.upgrades).toEqual({ bag: 1, armor: 5 });
  });
  it('keeps valid data', () => {
    const s = sanitize({ sv: 3, money: 7200, owned: ['smg'], equipped: 'smg', settings: { quality: 'low', sensitivity: 1.5, sound: false } });
    expect(s.money).toBe(7200);
    expect(s.equipped).toBe('smg');
    expect(s.settings.sound).toBe(false);
  });
});

describe('collision', () => {
  const box = { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 };
  it('rayBox hits face with normal', () => {
    const h = rayBox(-5, 1, 1, 1, 0, 0, box, 100)!;
    expect(h.t).toBeCloseTo(5);
    expect(h.nx).toBe(-1);
  });
  it('world raycast finds the nearest box and the ground', () => {
    const w = new CollisionWorld([box, { ...box, minX: 10, maxX: 12 }], -50, -50, 50, 50);
    expect(w.raycast(-5, 1, 1, 1, 0, 0, 100)!.t).toBeCloseTo(5);
    expect(w.raycast(20, 1, 1, -1, 0, 0, 100)!.t).toBeCloseTo(8);
    expect(w.raycast(-5, 1, 1, -1, 0, 0, 100)).toBeNull();
    expect(w.raycast(-5, 2, -5, 0, -1, 0, 100)!.ny).toBe(1);
  });
  it('resolveCircle pushes out of boxes', () => {
    const w = new CollisionWorld([box], -50, -50, 50, 50);
    const p = w.resolveCircle(2.2, 1, 0.5, 0, 1.8);
    expect(p.x).toBeCloseTo(2.5);
  });
  it('rayCharacter hits head and body', () => {
    const head = rayCharacter(-5, 1.65, 0, 1, 0, 0, 100, 0, 0, 0, 0.4, 1.45, 1.65, 0.25)!;
    expect(head.head).toBe(true);
    const body = rayCharacter(-5, 1.0, 0, 1, 0, 0, 100, 0, 0, 0, 0.4, 1.45, 1.65, 0.25)!;
    expect(body.head).toBe(false);
    expect(body.t).toBeCloseTo(4.6);
    expect(rayCharacter(-5, 3, 0, 1, 0, 0, 100, 0, 0, 0, 0.4, 1.45, 1.65, 0.25)).toBeNull();
  });
});

describe('map', () => {
  const m = createMap();
  const boxes = mapColliders(m);
  const overlap = (a: typeof boxes[0], b: typeof boxes[0]) =>
    a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

  it('is four times the old area with many buildings and a city-wide spawn pool', () => {
    expect((m.maxX - m.minX) * (m.maxZ - m.minZ)).toBe(4 * 140 * 100);
    expect(m.buildings.length + m.structures.houses.length).toBeGreaterThanOrEqual(40);
    buildPhysics(m);
    expect(m.spawns.length).toBeGreaterThan(300);
    // spawn points cover every part of the city, not one base per team
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]])
      expect(m.spawns.filter((p) => Math.sign(p.x) === sx && Math.sign(p.z) === sz).length).toBeGreaterThan(50);
  });
  it('no building overlaps another building or a prop', () => {
    const bb = m.buildings.map(buildingBox);
    const pb = m.props.map(propBox);
    for (let i = 0; i < bb.length; i++) {
      for (let j = i + 1; j < bb.length; j++) expect(overlap(bb[i], bb[j]), `b${i} b${j}`).toBe(false);
      for (const p of pb) expect(overlap(bb[i], p)).toBe(false);
    }
    for (let i = 0; i < pb.length; i++)
      for (let j = i + 1; j < pb.length; j++) expect(overlap(pb[i], pb[j]), `p${i} p${j}`).toBe(false);
  });
  it('every spawn and POI is reachable from the west of the city', () => {
    const nav = new NavGrid(m.minX, m.minZ, m.maxX, m.maxZ, boxes);
    buildPhysics(m);
    const s = { x: -66, z: 0 };
    const pts = [...m.spawns.filter((_, i) => i % 7 === 0), ...m.pois];
    for (const p of pts) {
      expect(nav.walkableAt(p.x, p.z), `walkable ${p.x},${p.z}`).toBe(true);
      const path = nav.findPath(s.x, s.z, p.x, p.z, 60000);
      expect(path, `path to ${p.x},${p.z}`).not.toBeNull();
    }
  });
  it('smoothed path segments never cross obstacles', () => {
    const nav = new NavGrid(m.minX, m.minZ, m.maxX, m.maxZ, boxes);
    const world = new CollisionWorld(boxes, m.minX, m.minZ, m.maxX, m.maxZ);
    const path = nav.findPath(-130, 0, 130, 0, 60000)!;
    for (let i = 1; i < path.length; i++) {
      expect(world.segmentClear(path[i - 1].x, 0.5, path[i - 1].z, path[i].x, 0.5, path[i].z)).toBe(true);
    }
  });
});

describe('daily wheel', () => {
  it('pays a wheel prize once per day', () => {
    const s = defaultSave();
    const day = new Date(2026, 10, 15, 12);
    expect(canSpin(s, day)).toBe(true);
    const i = spinWheel(s, 0.5, day);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(s.money).toBe(WHEEL[i]);
    expect(spinWheel(s, 0.5, day)).toBe(-1);
    expect(canSpin(s, new Date(2026, 10, 16, 9))).toBe(true);
  });
  it('the jackpot is rare (top weight segment index 7 only at the end of the range)', () => {
    const s = defaultSave();
    expect(WHEEL[spinWheel(s, 0.999, new Date(2026, 0, 1))]).toBe(2000);
  });
});

describe('fps limit', () => {
  it('defaults to 100 and rejects unknown caps', async () => {
    const { sanitize } = await import('../src/core/save');
    expect(sanitize({ sv: 3 }).settings.fpsLimit).toBe(100);
    expect(sanitize({ sv: 3, settings: { fpsLimit: 60 } }).settings.fpsLimit).toBe(60);
    expect(sanitize({ sv: 3, settings: { fpsLimit: 144 } }).settings.fpsLimit).toBe(100);
  });
  it('caps a fast screen at the limit', async () => {
    const { FrameCap } = await import('../src/core/framecap');
    for (const [hz, limit, lo, hi] of [[120, 100, 95, 101], [144, 100, 95, 101], [60, 30, 29, 31], [60, 100, 59, 61], [240, 60, 58, 61]]) {
      const cap = new FrameCap(limit);
      let n = 0;
      for (let i = 0; i < hz * 10; i++) if (cap.shouldRun(1000 + (i * 1000) / hz)) n++;
      expect(n / 10, `${hz}Hz cap ${limit}`).toBeGreaterThanOrEqual(lo);
      expect(n / 10, `${hz}Hz cap ${limit}`).toBeLessThanOrEqual(hi);
    }
  });
});

describe('player name', async () => {
  const { cleanName, sanitize, NAME_MAX } = await import('../src/core/save');
  it('keeps readable names, trims, limits the length and drops markup', () => {
    expect(cleanName('  Mustafa  ')).toBe('Mustafa');
    expect(cleanName('Kara   Kartal')).toBe('Kara Kartal');
    expect(cleanName('Şahin Çelik Ğüİö')).toBe('Şahin Çelik Ğü');
    expect(cleanName('<b>x</b>')).toBe('bx/b');
    expect(cleanName('a'.repeat(40))).toHaveLength(NAME_MAX);
    expect(cleanName(42)).toBe('');
  });
  it('is stored in the save and cleaned on load', () => {
    expect(sanitize({}).name).toBe('');
    expect(sanitize({ name: ' Ali\n<script> ' }).name).toBe('Ali script');
  });
});
