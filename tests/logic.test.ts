import { describe, expect, it } from 'vitest';
import { canSpin, spinWheel, WHEEL, buyUpgrade, buyWeapon, equipWeapon, grenadeCount, KILL_REWARD, killReward, matchBonus, maxHp, streakReward } from '../src/game/economy';
import { defaultSave, sanitize } from '../src/core/save';
import { SHOP_WEAPONS, STARTER, getWeapon } from '../src/data/weapons';
import { createMap, mapColliders, propBox, buildingBox } from '../src/world/map';
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
  it('a typical match (10 kills + win) earns 3000 TL', () => {
    expect(10 * KILL_REWARD + matchBonus('win')).toBe(3000);
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
    expect(cur.upgrades).toEqual({ bag: 1, armor: 2 });
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

  it('has 10 spawns per team and many buildings', () => {
    expect(m.spawns.blue).toHaveLength(10);
    expect(m.spawns.red).toHaveLength(10);
    expect(m.buildings.length).toBeGreaterThanOrEqual(20);
  });
  it('no building overlaps another building or a prop', () => {
    const bb = m.buildings.map(buildingBox);
    const pb = m.props.filter((p) => p.kind !== 'statue' && p.kind !== 'fountain').map(propBox);
    for (let i = 0; i < bb.length; i++) {
      for (let j = i + 1; j < bb.length; j++) expect(overlap(bb[i], bb[j]), `b${i} b${j}`).toBe(false);
      for (const p of pb) expect(overlap(bb[i], p)).toBe(false);
    }
    for (let i = 0; i < pb.length; i++)
      for (let j = i + 1; j < pb.length; j++) expect(overlap(pb[i], pb[j]), `p${i} p${j}`).toBe(false);
  });
  it('every spawn and POI is reachable from the blue base', () => {
    const nav = new NavGrid(m.minX, m.minZ, m.maxX, m.maxZ, boxes);
    const s = m.spawns.blue[0];
    for (const p of [...m.spawns.blue, ...m.spawns.red, ...m.pois]) {
      expect(nav.walkableAt(p.x, p.z), `walkable ${p.x},${p.z}`).toBe(true);
      const path = nav.findPath(s.x, s.z, p.x, p.z, 20000);
      expect(path, `path to ${p.x},${p.z}`).not.toBeNull();
    }
  });
  it('smoothed path segments never cross obstacles', () => {
    const nav = new NavGrid(m.minX, m.minZ, m.maxX, m.maxZ, boxes);
    const world = new CollisionWorld(boxes, m.minX, m.minZ, m.maxX, m.maxZ);
    const path = nav.findPath(-65, 0, 65, 0, 20000)!;
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
