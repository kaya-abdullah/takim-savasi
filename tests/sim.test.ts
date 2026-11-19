import { describe, expect, it } from 'vitest';
import { buildPhysics, createMap } from '../src/world/map';
import * as THREE from 'three';
import { Match, stepGrenade } from '../src/game/match';
import { WeaponState } from '../src/game/combatant';
import { getWeapon, GRENADE_SPEED } from '../src/data/weapons';

function setup(seed: number) {
  const map = createMap();
  const { world, nav } = buildPhysics(map);
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
    for (const c of m.combatants) if (c.alive) expect(s.world.blocked(c.pos.x, c.pos.z, 0.3, c.pos.y), `${c.name} at ${c.pos.toArray()}`).toBe(false);
  });
  it('match ends at the kill limit and reports the winner', () => {
    const s = setup(2);
    let winner: string | null = null;
    const m = new Match(s.map, s.world, s.nav, 'pistol', { end: (w) => (winner = w) }, { seed: 7, killLimit: 5 });
    for (let i = 0; i < 30 * 300 && !m.over; i++) m.update(1 / 30);
    expect(m.over).toBe(true);
    expect(winner).not.toBeNull();
    // a grenade or rocket can take out two at once, so the winner may overshoot by a little
    expect(Math.max(m.score.blue, m.score.red)).toBeGreaterThanOrEqual(5);
    expect(Math.max(m.score.blue, m.score.red)).toBeLessThanOrEqual(7);
  });
});

describe('grenades, knife, regen, streaks', () => {
  function quiet(seed = 3) {
    const s = setup(seed);
    const m = new Match(s.map, s.world, s.nav, 'pistol', {}, { seed, difficulty: 'normal' });
    m.brains.clear(); // freeze bots so the scenario is deterministic
    for (const c of m.combatants) c.shieldT = 0;
    return { s, m };
  }
  it('grenade falls, bounces, comes to rest and never sinks into the ground', () => {
    const { s } = quiet();
    const g = { pos: new THREE.Vector3(0, 1.5, 20), vel: new THREE.Vector3(0, 4, 12), resting: false };
    let minY = Infinity;
    for (let i = 0; i < 400 && !g.resting; i++) { stepGrenade(s.world, g, 1 / 120); minY = Math.min(minY, g.pos.y); }
    expect(g.resting).toBe(true);
    expect(minY).toBeGreaterThanOrEqual(0);
  });
  it('a thrown grenade explodes after the fuse and kills a nearby enemy', () => {
    const { m } = quiet();
    const p = m.player, e = m.combatants.find((c) => c.team === 'red')!;
    p.pos.set(-20, 0, 0); p.yaw = Math.PI / 2;
    e.pos.set(-8, 0, 0);
    p.aimDir.set(Math.cos(0.3), Math.sin(0.3), 0);
    let kills = 0;
    m.events.kill = (k) => { if (k.weapon.id === 'grenade') kills++; };
    expect(p.grenades).toBe(3);
    expect(m.throwGrenade(p, GRENADE_SPEED * 0.55)).toBe(true);
    expect(p.grenades).toBe(2);
    // walk the enemy onto the grenade just before it goes off
    while (m.grenades[0].fuse > 0.1) m.update(1 / 30);
    const g = m.grenades[0];
    e.pos.set(g.pos.x + 1, 0, g.pos.z);
    e.hp = 60;
    for (let i = 0; i < 10; i++) m.update(1 / 30);
    expect(m.grenades.length).toBe(0);
    expect(kills).toBe(1);
  });
  it('cannot throw with no grenades left; respawn refills them', () => {
    const { m } = quiet();
    const p = m.player;
    p.grenades = 0;
    expect(m.throwGrenade(p, GRENADE_SPEED)).toBe(false);
    const e = m.combatants.find((c) => c.team === 'red')!;
    m.damage(p, e, 999, false, getWeapon('pistol'));
    for (let i = 0; i < 30 * 5; i++) m.update(1 / 30);
    expect(p.alive).toBe(true);
    expect(p.grenades).toBe(3);
  });
  it('knife: front hit does 55, backstab kills', () => {
    const { m } = quiet();
    const p = m.player, e = m.combatants.find((c) => c.team === 'red')!;
    p.pos.set(0, 0, 20); p.yaw = 0; // facing +z
    e.pos.set(0, 0, 21.5); e.yaw = Math.PI; // facing the player
    m.melee(p);
    expect(e.hp).toBe(45);
    p.meleeCd = 0;
    e.yaw = 0; // turned away
    m.melee(p);
    expect(e.alive).toBe(false);
  });
  it('health regenerates after 4 s without damage, up to max', () => {
    const { m } = quiet();
    const p = m.player, e = m.combatants.find((c) => c.team === 'red')!;
    m.damage(p, e, 60, false, getWeapon('pistol'));
    for (let i = 0; i < 30 * 3; i++) m.update(1 / 30);
    expect(p.hp).toBe(40);
    for (let i = 0; i < 30 * 6; i++) m.update(1 / 30);
    expect(p.hp).toBe(100);
  });
  it('streak counts kills and resets on death', () => {
    const { m } = quiet();
    const p = m.player;
    const reds = m.combatants.filter((c) => c.team === 'red');
    for (const r of reds.slice(0, 3)) m.damage(r, p, 999, false, getWeapon('pistol'));
    expect(p.streak).toBe(3);
    m.damage(p, reds[5], 999, false, getWeapon('pistol'));
    expect(p.streak).toBe(0);
  });
});

describe('power-ups and supply drops', () => {
  function quiet(seed = 4) {
    const s = setup(seed);
    const m = new Match(s.map, s.world, s.nav, 'pistol', {}, { seed, difficulty: 'normal' });
    m.brains.clear();
    for (const c of m.combatants) c.shieldT = 0;
    return m;
  }
  it('power-ups appear over time and an airdrop falls then lands', () => {
    const m = quiet();
    for (let i = 0; i < 30 * 40; i++) m.update(1 / 30);
    expect(m.pickups.filter((p) => p.kind !== 'airdrop').length).toBeGreaterThan(0);
    const drop = m.pickups.find((p) => p.kind === 'airdrop')!;
    expect(drop).toBeTruthy();
    expect(drop.falling).toBe(true);
    for (let i = 0; i < 30 * 10; i++) m.update(1 / 30);
    expect(drop.falling).toBe(false);
    expect(drop.pos.y).toBe(0);
  });
  it('health pickup heals; damage pickup doubles damage; speed pickup sets buff', () => {
    const m = quiet();
    const p = m.player, e = m.combatants.find((c) => c.team === 'red')!;
    p.hp = 30;
    m.spawnPickup('health', new THREE.Vector3(p.pos.x, 0, p.pos.z));
    m.update(1 / 30);
    expect(p.hp).toBe(100);
    m.spawnPickup('damage', new THREE.Vector3(p.pos.x, 0, p.pos.z));
    m.update(1 / 30);
    expect(p.dmgBuffT).toBeGreaterThan(9);
    m.damage(e, p, 20, false, getWeapon('pistol'));
    expect(e.hp).toBe(60);
    m.spawnPickup('speed', new THREE.Vector3(p.pos.x, 0, p.pos.z));
    m.update(1 / 30);
    expect(p.speedBuffT).toBeGreaterThan(9);
  });
  it('a bot that reaches a landed airdrop gets a premium weapon', () => {
    const m = quiet();
    const b = m.combatants.find((c) => c.team === 'red')!;
    const got: string[] = [];
    m.events.pickedUp = (_c, _p, w) => w && got.push(w.id);
    const drop = m.spawnPickup('airdrop', new THREE.Vector3(b.pos.x, 0, b.pos.z))!;
    drop.pos.y = 0.5;
    for (let i = 0; i < 10; i++) m.update(1 / 30);
    expect(got).toHaveLength(1);
    expect(['minigun', 'rocket', 'plasma', 'sniper', 'lmg']).toContain(b.weapon.def.id);
  });
});

describe('weapon drops', () => {
  function quiet(seed = 5) {
    const s = setup(seed);
    const m = new Match(s.map, s.world, s.nav, 'pistol', {}, { seed, difficulty: 'normal' });
    m.brains.clear();
    for (const c of m.combatants) c.shieldT = 0;
    return m;
  }
  it('a killed fighter drops their gun; the player picking it up raises weaponFound', () => {
    const m = quiet();
    const p = m.player, e = m.combatants.find((c) => c.team === 'red')!;
    e.setWeapon(getWeapon('sniper'));
    m.damage(e, p, 999, false, getWeapon('pistol'));
    expect(m.drops).toHaveLength(1);
    expect(m.drops[0].def.id).toBe('sniper');
    const found: string[] = [];
    m.events.weaponFound = (_c, d) => found.push(d.def.id);
    p.pos.set(m.drops[0].pos.x, 0, m.drops[0].pos.z);
    for (let i = 0; i < 30; i++) m.update(1 / 30);
    expect(found).toEqual(['sniper']);
    expect(m.drops).toHaveLength(0);
  });
  it('bots only swap to a more valuable dropped gun, and drops expire', () => {
    const m = quiet();
    const [a, b] = m.combatants.filter((c) => c.team === 'red');
    a.setWeapon(getWeapon('rifle'));
    b.setWeapon(getWeapon('pistol'));
    m.damage(a, m.player, 999, false, getWeapon('pistol'));
    const d = m.drops[0];
    b.pos.set(d.pos.x, 0, d.pos.z);
    for (let i = 0; i < 30; i++) m.update(1 / 30);
    expect(b.weapon.def.id).toBe('rifle');
    // a cheaper gun is ignored and eventually disappears
    const c = m.combatants.filter((x) => x.team === 'red')[2];
    c.setWeapon(getWeapon('pistol'));
    m.damage(c, m.player, 999, false, getWeapon('pistol'));
    for (let i = 0; i < 30 * 26; i++) m.update(1 / 30);
    expect(m.drops.filter((x) => x.def.id === 'pistol' && x.age > 25)).toHaveLength(0);
  });
});
