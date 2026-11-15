import { describe, expect, it } from 'vitest';
import { buyWeapon, equipWeapon, KILL_REWARD, matchBonus } from '../src/game/economy';
import { defaultSave, sanitize } from '../src/core/save';
import { SHOP_WEAPONS, STARTER, WEAPON_PRICE, getWeapon } from '../src/data/weapons';
import { createMap, mapColliders, propBox, buildingBox } from '../src/world/map';
import { CollisionWorld, rayBox, rayCharacter } from '../src/world/collision';
import { NavGrid } from '../src/world/navgrid';

describe('weapons', () => {
  it('has exactly 10 shop weapons, all 7000 TL, unique ids', () => {
    expect(SHOP_WEAPONS).toHaveLength(10);
    expect(SHOP_WEAPONS.every((w) => w.price === 7000)).toBe(true);
    const ids = new Set([STARTER.id, ...SHOP_WEAPONS.map((w) => w.id)]);
    expect(ids.size).toBe(11);
  });
  it('starter is free and unknown ids fall back to starter', () => {
    expect(STARTER.price).toBe(0);
    expect(getWeapon('nope').id).toBe(STARTER.id);
  });
});

describe('economy', () => {
  it('rejects purchase without money and accepts with exactly 7000', () => {
    const s = defaultSave();
    s.money = WEAPON_PRICE - 1;
    expect(buyWeapon(s, 'rifle')).toBe('no-money');
    s.money = WEAPON_PRICE;
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
  it('keeps valid data', () => {
    const s = sanitize({ money: 7200, owned: ['smg'], equipped: 'smg', settings: { quality: 'low', sensitivity: 1.5, sound: false } });
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
