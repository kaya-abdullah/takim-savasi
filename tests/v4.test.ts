import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyMatchResult, buyVehicle, buyWeapon, sellVehicle, sellWeapon } from '../src/game/economy';
import { defaultSave, sanitize } from '../src/core/save';
import { buildPhysics, createMap } from '../src/world/map';
import { Match } from '../src/game/match';
import type { Combatant } from '../src/game/combatant';
import { FLOOR1_Y, ROOF_Y, STREET, TUNNEL, TUNNEL_Y } from '../src/world/structures';
import { getWeapon } from '../src/data/weapons';

const map = createMap();
const phys = buildPhysics(map);

function quietMatch(seed = 11, difficulty: 'normal' | 'hard' | 'extreme' = 'hard') {
  const m = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed, difficulty });
  m.brains.clear();
  for (const c of m.combatants) c.shieldT = 0;
  // park everyone but the player far away so nothing interferes
  for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; }
  return m;
}

/** Steers a fighter along a nav path with real collision; returns the final position. */
function walk(m: Match, c: Combatant, to: { x: number; y: number; z: number }, seconds = 40): THREE.Vector3 {
  const path = m.nav.findPath(c.pos.x, c.pos.y, c.pos.z, to.x, to.y, to.z);
  expect(path, `path to ${JSON.stringify(to)}`).not.toBeNull();
  let i = 0;
  const dt = 1 / 30;
  for (let f = 0; f < seconds * 30 && i < path!.length; f++) {
    const wp = path![i];
    const dx = wp.x - c.pos.x, dz = wp.z - c.pos.z, d = Math.hypot(dx, dz);
    if (d < (wp.link ? 0.6 : 0.9) && Math.abs(wp.y - c.pos.y) < 2.2) { i++; continue; }
    const sp = 4.6;
    m.move(c, (dx / d) * sp * dt, (dz / d) * sp * dt, dt);
  }
  return c.pos.clone();
}

describe('selling', () => {
  it('a bought weapon sells back for 70 %, the starter cannot be sold, equipped falls back', () => {
    const s = defaultSave();
    s.money = 3500;
    expect(buyWeapon(s, 'rifle')).toBe('ok');
    expect(s.equipped).toBe('rifle');
    expect(sellWeapon(s, 'rifle')).toBe(2450);
    expect(s.money).toBe(2450);
    expect(s.owned).toEqual(['pistol']);
    expect(s.equipped).toBe('pistol');
    expect(sellWeapon(s, 'rifle')).toBe(0); // not owned any more
    expect(sellWeapon(s, 'pistol')).toBe(0);
    expect(s.owned).toEqual(['pistol']);
  });
  it('vehicles sell for 70 % too', () => {
    const s = defaultSave();
    s.money = 50000;
    buyVehicle(s, 'heli');
    expect(sellVehicle(s, 'heli')).toBe(35000);
    expect(s.vehicles).toEqual([]);
    expect(s.money).toBe(35000);
    expect(sellVehicle(s, 'car')).toBe(0);
  });
});

describe('economy v4', () => {
  it('win pays 1400 TL, loss costs 400 TL but never below zero', () => {
    const s = defaultSave();
    s.money = 1000;
    expect(applyMatchResult(s, 'win')).toBe(1400);
    expect(s.money).toBe(2400);
    expect(applyMatchResult(s, 'lose')).toBe(-400);
    expect(s.money).toBe(2000);
    s.money = 250;
    expect(applyMatchResult(s, 'lose')).toBe(-250);
    expect(s.money).toBe(0);
  });
  it('car costs 30000 TL, helicopter 50000 TL', () => {
    const s = defaultSave();
    s.money = 29999;
    expect(buyVehicle(s, 'car')).toBe('no-money');
    s.money = 80000;
    expect(buyVehicle(s, 'car')).toBe('ok');
    expect(s.money).toBe(50000);
    expect(buyVehicle(s, 'heli')).toBe('ok');
    expect(s.money).toBe(0);
    expect(buyVehicle(s, 'car')).toBe('owned');
    expect(s.vehicles).toEqual(['car', 'heli']);
  });
  it('save keeps vehicles and difficulty, drops junk', () => {
    const s = sanitize({ money: 5, vehicles: ['heli', 'tank', 'heli'], settings: { difficulty: 'extreme' } });
    expect(s.vehicles).toEqual(['heli']);
    expect(s.settings.difficulty).toBe('extreme');
    expect(sanitize({}).settings.difficulty).toBe('hard');
    expect(sanitize({ settings: { difficulty: 'god' } }).settings.difficulty).toBe('hard');
  });
});

describe('walk-in buildings and tunnel', () => {
  const s = map.structures;
  it('has 6 walk-in buildings (2 floors + roof each) and the tunnel', () => {
    expect(s.houses).toHaveLength(6);
    expect(s.levels.filter((l) => l.y === FLOOR1_Y)).toHaveLength(6);
    expect(s.levels.filter((l) => l.y === ROOF_Y)).toHaveLength(6);
    expect(s.levels.filter((l) => l.name === TUNNEL)).toHaveLength(1);
    expect(s.pits).toHaveLength(4);
    expect(s.links.filter((l) => l.b === TUNNEL)).toHaveLength(4);
  });
  it('every stair end lies on a walkable cell of its floor', () => {
    for (const l of phys.nav.links) {
      const a = l.pts[0];
      const lv = phys.nav.levels[l.a];
      expect(lv.grid.nearestWalkable(a.x, a.z, 1), `${lv.name} at ${a.x},${a.z}`).not.toBeNull();
    }
  });
  it('POIs and spawns are on walkable street, never inside a stairwell', () => {
    for (const p of [...map.pois, ...map.spawns.blue, ...map.spawns.red]) {
      expect(phys.world.inPit(p.x, p.z)).toBe(false);
      expect(phys.nav.street.walkableAt(p.x, p.z), `${p.x},${p.z}`).toBe(true);
    }
  });
  it('the street ground has holes only at the stairwells', () => {
    const w = phys.world;
    expect(w.groundHeight(0, 30, 0.4, 0)).toBe(0);
    // standing in the tunnel: the street above does not count as ground
    expect(w.groundHeight(-26, 0, 0.4, TUNNEL_Y)).toBeCloseTo(TUNNEL_Y, 5);
    // a ray shot down a stairwell passes the street level
    const h = w.raycast(-43, 3, 0, 0, -1, 0, 20)!;
    expect(h.t).toBeGreaterThan(3.2);
    // a ray shot down elsewhere stops at the street
    expect(w.raycast(-20, 3, -13, 0, -1, 0, 20)!.t).toBeCloseTo(3, 4);
  });
  it('nav finds a route from the blue base to every roof, upper floor and the metro', () => {
    for (const sp of s.spots) {
      const path = phys.nav.findPath(-63, 0, 0, sp.p.x, sp.p.y, sp.p.z);
      expect(path, sp.name).not.toBeNull();
      expect(phys.nav.levelName(sp.p.x, sp.p.y, sp.p.z)).toBe(sp.name);
    }
  });
  it('a fighter physically walks up the stairs to every roof', () => {
    for (const sp of s.spots.filter((x) => x.label === 'ÇATI')) {
      const m = quietMatch();
      const p = m.player;
      p.pos.set(-63, 0, 0);
      const end = walk(m, p, sp.p, 60);
      expect(end.y, sp.name).toBeCloseTo(ROOF_Y, 1);
      expect(Math.hypot(end.x - sp.p.x, end.z - sp.p.z), sp.name).toBeLessThan(1.5);
    }
  });
  it('a fighter walks down into the metro and over to the far side', () => {
    const m = quietMatch();
    const p = m.player;
    p.pos.set(-63, 0, 0);
    let end = walk(m, p, { x: -26, y: TUNNEL_Y, z: 0 });
    expect(end.y).toBeCloseTo(TUNNEL_Y, 1);
    // through the station and up the east stairs
    end = walk(m, p, { x: 52, y: 0, z: 0 }, 60);
    expect(end.y).toBeCloseTo(0, 1);
    expect(end.x).toBeGreaterThan(50);
  });
  it('the street level is a single connected area (no sealed pockets)', () => {
    const g = phys.nav.street;
    const seen = new Uint8Array(g.w * g.h);
    const [sx, sz] = g.toCell(-63, 0);
    const q = [sz * g.w + sx];
    seen[q[0]] = 1;
    while (q.length) {
      const n = q.pop()!;
      const x = n % g.w, z = (n / g.w) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (z + dz) * g.w + x + dx;
        if (g.isWalkable(x + dx, z + dz) && !seen[k]) { seen[k] = 1; q.push(k); }
      }
    }
    let total = 0, reached = 0;
    for (let i = 0; i < g.walk.length; i++) if (g.walk[i]) { total++; if (seen[i]) reached++; }
    // tiny gaps between props may be isolated; the city itself must be one piece
    expect(reached / total).toBeGreaterThan(0.97);
  });
});

describe('crouch', () => {
  it('lowers the head out of a standing head-height shot and steadies aim', () => {
    const m = quietMatch(12, 'normal');
    const p = m.player;
    const e = m.combatants.find((c) => c.team === 'red')!;
    e.alive = true;
    e.pos.set(10, 0, 30);
    p.pos.set(0, 0, 30);
    const o = new THREE.Vector3(0, 1.67, 30), dir = new THREE.Vector3(1, 0, 0);
    expect(m.hitscan(p, o, dir, 50).head).toBe(true);
    e.crouch = true;
    for (let i = 0; i < 30; i++) m.update(1 / 30);
    expect(e.crouchK).toBeGreaterThan(0.95);
    const h = m.hitscan(p, o, dir, 50);
    expect(h.victim).toBeNull();
    // a crouched body is still hittable lower down
    expect(m.hitscan(p, new THREE.Vector3(0, 0.8, 30), dir, 50).victim).toBe(e);
  });
});

describe('difficulty', () => {
  it('bots on both teams get the difficulty hit points', () => {
    for (const [d, hp] of [['normal', 100], ['hard', 170], ['extreme', 250]] as const) {
      const m = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed: 3, difficulty: d });
      const bots = m.combatants.filter((c) => !c.isPlayer);
      expect(bots.every((b) => b.maxHp === hp && b.hp === hp)).toBe(true);
      expect(m.player.maxHp).toBe(100);
    }
  });
});

describe('vehicles', () => {
  function withVehicle(kind: 'car' | 'heli', at = { x: -66, z: -5 }, yaw = Math.PI / 2) {
    const m = quietMatch(21);
    const p = m.player;
    p.pos.set(at.x, 0, at.z);
    p.yaw = yaw;
    expect(m.spawnVehicle(kind, p)).toBe('ok');
    const v = m.vehicleOf(kind, p)!;
    expect(m.nearbyVehicle(p)).toBe(v);
    expect(m.enterVehicle(p, v)).toBe(true);
    return { m, p, v };
  }
  it('the car drives, steers and stays out of buildings', () => {
    const { m, p, v } = withVehicle('car');
    const x0 = v.pos.x;
    let top = 0;
    for (let i = 0; i < 60; i++) { m.driveInput.set(v, { forward: 1, side: 0, up: 0, yaw: 0 }); m.update(1 / 30); top = Math.max(top, v.speed); }
    expect(v.pos.x - x0).toBeGreaterThan(12);
    expect(top).toBeGreaterThan(15);
    expect(p.pos.distanceTo(v.pos)).toBeLessThan(1e-6);
    // full lock into the buildings for a while: it must never end up inside one
    for (let i = 0; i < 300; i++) {
      m.driveInput.set(v, { forward: 1, side: i < 150 ? 1 : -1, up: 0, yaw: 0 });
      m.update(1 / 30);
      for (const [x, z] of v.footprint().map((f) => [f[0], f[1]])) expect(m.world.blocked(x, z, 0.5, v.pos.y + 0.6, 0.6)).toBe(false);
    }
  });
  it('running an enemy over kills them and credits the driver', () => {
    const { m, p, v } = withVehicle('car');
    const e = m.combatants.find((c) => c.team === 'red')!;
    e.alive = true;
    e.hp = e.maxHp;
    e.pos.set(v.pos.x + 12, 0, v.pos.z);
    let hit = false;
    m.events.runOver = () => (hit = true);
    for (let i = 0; i < 60 && e.alive; i++) { m.driveInput.set(v, { forward: 1, side: 0, up: 0, yaw: 0 }); m.update(1 / 30); }
    expect(hit).toBe(true);
    expect(e.alive).toBe(false);
    expect(p.kills).toBe(1);
  });
  it('the helicopter climbs, flies and lands on a roof', () => {
    const { m, v } = withVehicle('heli');
    for (let i = 0; i < 120; i++) { m.driveInput.set(v, { forward: 0, side: 0, up: 1, yaw: Math.PI / 2 }); m.update(1 / 30); }
    expect(v.pos.y).toBeGreaterThan(12);
    // fly over the blue-side walk-in building at x -58..-46, z 9..21 and land on it
    const target = { x: -52, z: 15 };
    for (let i = 0; i < 600; i++) {
      const dx = target.x - v.pos.x, dz = target.z - v.pos.z, d = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      m.driveInput.set(v, { forward: d > 1 ? Math.min(1, d / 8) : 0, side: 0, up: d < 1.5 ? -1 : 0, yaw });
      m.update(1 / 30);
    }
    expect(v.pos.y).toBeCloseTo(ROOF_Y, 0);
    expect(v.onGround).toBe(true);
  });
  it('shots at the driver hit the vehicle; a wreck throws the driver out', () => {
    const { m, p, v } = withVehicle('car');
    const e = m.combatants.find((c) => c.team === 'red')!;
    e.alive = true;
    const hp = p.hp;
    m.damage(p, e, 100, false, getWeapon('rifle'));
    expect(p.hp).toBe(hp);
    expect(v.hp).toBe(v.maxHp - 100);
    let destroyed = false;
    m.events.vehicleDestroyed = () => (destroyed = true);
    m.damage(p, e, 9999, false, getWeapon('rifle'));
    expect(destroyed).toBe(true);
    expect(p.vehicle).toBeNull();
    expect(m.vehicles).toHaveLength(0);
    expect(p.hp).toBeLessThan(hp);
    expect(m.vehicleCd.car).toBeGreaterThan(20);
    expect(m.spawnVehicle('car', p)).toBe('cooldown');
  });
  it('hitscan from an enemy stops at the car body and damages it', () => {
    const { m, v } = withVehicle('car');
    const e = m.combatants.find((c) => c.team === 'red')!;
    e.alive = true;
    const c = v.center(new THREE.Vector3());
    const o = new THREE.Vector3(c.x + 15, c.y, c.z);
    const h = m.hitscan(e, o, new THREE.Vector3(-1, 0, 0), 40);
    expect(h.vehicle).toBe(v);
    expect(h.dist).toBeLessThan(15);
  });
  it('cannot be called inside a building or the metro', () => {
    const m = quietMatch(31);
    const p = m.player;
    p.pos.set(-26, TUNNEL_Y, 0);
    expect(m.spawnVehicle('car', p)).toBe('blocked');
    p.pos.set(-50, 0, 18); // ground floor of the blue walk-in building
    expect(m.spawnVehicle('heli', p)).toBe('blocked');
  });
  it('heli cannon and rockets fire from the air', () => {
    const { m, p, v } = withVehicle('heli');
    for (let i = 0; i < 60; i++) { m.driveInput.set(v, { forward: 0, side: 0, up: 1, yaw: 0 }); m.update(1 / 30); }
    let shots = 0;
    m.events.shot = (_c, _h, def) => { if (def.id === 'heligun') shots++; };
    p.aimOrigin.copy(v.pos).add(new THREE.Vector3(0, 0.7, 2.6));
    p.aimDir.set(0, -0.3, 1).normalize();
    p.trigger = true;
    for (let i = 0; i < 30; i++) m.update(1 / 30);
    expect(shots).toBeGreaterThan(5);
    expect(m.heliRocket(p)).toBe(true);
    expect(m.heliRocket(p)).toBe(false); // cooldown
    expect(m.projectiles.length).toBe(1);
  });
});

describe('bots use the new spaces', () => {
  it('a bot with nothing to fight walks into the metro, then up onto a roof', () => {
    const m = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed: 5, difficulty: 'hard' });
    const bot = m.combatants.find((c) => c.team === 'blue' && !c.isPlayer)!;
    for (const c of m.combatants) if (c !== bot) { c.alive = false; c.respawnT = 1e9; }
    const brain = m.brains.get(bot)!;
    for (const target of [{ x: -26, y: TUNNEL_Y, z: 0 }, { x: 48, y: ROOF_Y, z: -15 }]) {
      let reached = false;
      for (let i = 0; i < 30 * 70 && !reached; i++) {
        // keep the chosen objective (the brain would otherwise pick a new one on arrival)
        if (!brain.goal || brain.goal.y !== target.y) { brain.goal = { ...target }; brain.path = []; }
        m.update(1 / 30);
        reached = Math.abs(bot.pos.y - target.y) < 0.3 && Math.hypot(bot.pos.x - target.x, bot.pos.z - target.z) < 4;
      }
      expect(reached, JSON.stringify(target) + ' bot at ' + bot.pos.toArray().map((v) => v.toFixed(1))).toBe(true);
    }
  });
  it('a 3 minute bot match stays in bounds and bots visit roofs or the metro', () => {
    const m = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed: 99, difficulty: 'hard' });
    let up = 0, down = 0;
    for (let i = 0; i < 30 * 180 && !m.over; i++) {
      m.update(1 / 30);
      for (const c of m.combatants) {
        expect(Number.isFinite(c.pos.y)).toBe(true);
        expect(c.pos.y).toBeGreaterThan(TUNNEL_Y - 0.6);
        expect(c.pos.y).toBeLessThan(ROOF_Y + 1.5);
        if (c.alive && c.pos.y > FLOOR1_Y - 0.2) up++;
        if (c.alive && c.pos.y < TUNNEL_Y + 0.2) down++;
      }
    }
    expect(m.score.blue + m.score.red).toBeGreaterThan(5);
    expect(up + down).toBeGreaterThan(0);
    for (const c of m.combatants) if (c.alive) expect(phys.world.blocked(c.pos.x, c.pos.z, 0.3, c.pos.y)).toBe(false);
    expect(STREET).toBe('street');
  });
});
