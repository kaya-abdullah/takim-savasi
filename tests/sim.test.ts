import { describe, expect, it } from 'vitest';
import { createMap, mapColliders } from '../src/world/map';
import { CollisionWorld } from '../src/world/collision';
import { NavGrid } from '../src/world/navgrid';
import { Match } from '../src/game/match';
import { WeaponState } from '../src/game/combatant';
import { getWeapon } from '../src/data/weapons';

function setup(seed: number) {
  const map = createMap();
  const boxes = mapColliders(map);
  const world = new CollisionWorld(boxes, map.minX, map.minZ, map.maxX, map.maxZ);
  const nav = new NavGrid(map.minX, map.minZ, map.maxX, map.maxZ, boxes);
  return { map, world, nav, seed };
}

describe('weapon state', () => {
  it('fires at fire rate and auto-reloads when empty', () => {
    const w = new WeaponState(getWeapon('smg'));
    let shots = 0;
    for (let i = 0; i < 60; i++) shots += w.update(1 / 60, true);
    expect(shots).toBeGreaterThanOrEqual(11);
    expect(shots).toBeLessThanOrEqual(13);
    for (let i = 0; i < 600; i++) shots += w.update(1 / 60, true);
    expect(w.ammo).toBeLessThanOrEqual(30);
    expect(shots).toBeGreaterThan(30); // reloaded at least once
  });
  it('burst fires exactly 3 rounds per trigger pull', () => {
    const w = new WeaponState(getWeapon('burst'));
    let shots = w.update(1 / 60, true);
    for (let i = 0; i < 20; i++) shots += w.update(1 / 60, false);
    expect(shots).toBe(3);
  });
  it('minigun needs spin up', () => {
    const w = new WeaponState(getWeapon('minigun'));
    expect(w.update(0.05, true)).toBe(0);
    let shots = 0;
    for (let i = 0; i < 60; i++) shots += w.update(1 / 60, true);
    expect(shots).toBeGreaterThan(5);
  });
});

describe('bot-only match simulation', () => {
  it('runs 3 minutes of 10v10 with kills, valid positions and fair outcome', () => {
    const s = setup(1);
    const m = new Match(s.map, s.world, s.nav, 'pistol', {}, { seed: 12345 });
    // the player stands still at spawn; bots do the fighting
    const dt = 1 / 30;
    let kills = 0;
    m.events.kill = () => kills++;
    for (let i = 0; i < 30 * 180 && !m.over; i++) {
      m.update(dt);
      for (const c of m.combatants) {
        expect(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.z)).toBe(true);
        expect(c.pos.x).toBeGreaterThanOrEqual(s.map.minX);
        expect(c.pos.x).toBeLessThanOrEqual(s.map.maxX);
      }
    }
    expect(kills).toBeGreaterThan(10);
    expect(m.score.blue + m.score.red).toBe(kills);
    // nobody ends up embedded in a building
    for (const c of m.combatants) if (c.alive) expect(s.world.blocked(c.pos.x, c.pos.z, 0.3)).toBe(false);
  });
  it('match ends at the kill limit and reports the winner', () => {
    const s = setup(2);
    let winner: string | null = null;
    const m = new Match(s.map, s.world, s.nav, 'pistol', { end: (w) => (winner = w) }, { seed: 7, killLimit: 5 });
    for (let i = 0; i < 30 * 300 && !m.over; i++) m.update(1 / 30);
    expect(m.over).toBe(true);
    expect(winner).not.toBeNull();
    expect(Math.max(m.score.blue, m.score.red)).toBe(5);
  });
});
