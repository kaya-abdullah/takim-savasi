import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPhysics, createMap } from '../src/world/map';
import { Match, SPAWN_SAFE } from '../src/game/match';
import { defaultSave, sanitize, LOADOUT_SIZE } from '../src/core/save';
import { buyWeapon, putInLoadout, sellWeapon } from '../src/game/economy';
import { KNIFE_RETURN, THROWN_KNIFE } from '../src/data/weapons';
import { PlayerController } from '../src/game/player';
import type { Input } from '../src/core/input';

const map = createMap();
const phys = buildPhysics(map);

function quiet(seed = 3) {
  const m = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed, difficulty: 'normal' });
  m.brains.clear();
  for (const c of m.combatants) c.shieldT = 0;
  for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; }
  return m;
}

describe('bigger, varied city', () => {
  it('outer districts are all different kinds side by side, with tall walk-in towers', () => {
    const outer = map.districts.slice(1);
    expect(outer.length).toBe(24);
    expect(new Set(outer.map((d) => d.name)).size).toBeGreaterThanOrEqual(9);
    // neighbours (sharing an edge across a road) are never the same kind
    for (const a of outer) for (const b of outer) {
      if (a === b) continue;
      const nearX = Math.abs(a.x1 - b.x0) <= 8 || Math.abs(b.x1 - a.x0) <= 8;
      const sameZ = a.z0 === b.z0;
      if (nearX && sameZ) expect(a.name === b.name && a.name !== 'MAHALLE', `${a.name} ${a.x0},${a.z0} / ${b.x0},${b.z0}`).toBe(false);
    }
    const roofs = map.structures.levels.filter((l) => l.name.endsWith('-roof'));
    expect(roofs.filter((l) => l.y >= 17).length).toBeGreaterThanOrEqual(4);
  });
  it('spawns are spread over the whole city', () => {
    const xs = map.spawns.map((p) => p.x), zs = map.spawns.map((p) => p.z);
    expect(Math.min(...xs)).toBeLessThan(-120);
    expect(Math.max(...xs)).toBeGreaterThan(120);
    expect(Math.min(...zs)).toBeLessThan(-80);
    expect(Math.max(...zs)).toBeGreaterThan(80);
  });
});

describe('spawning in different places', () => {
  it('two matches start fighters in different spots, each team on its own side', () => {
    const a = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed: 1 });
    const b = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed: 2 });
    let same = 0;
    for (let i = 0; i < a.combatants.length; i++) if (a.combatants[i].pos.distanceTo(b.combatants[i].pos) < 1) same++;
    expect(same).toBeLessThan(3);
    for (const c of a.combatants) expect(c.team === 'blue' ? c.pos.x < 0 : c.pos.x > 0).toBe(true);
  });
  it('respawns land in many different places and never next to a living enemy', () => {
    const m = new Match(map, phys.world, phys.nav, 'pistol', {}, { seed: 7 });
    m.brains.clear();
    const p = m.player;
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i < 25; i++) {
      p.alive = false;
      p.respawnT = 0;
      m.update(0.001);
      expect(p.alive).toBe(true);
      for (const e of m.combatants) if (e.team !== p.team && e.alive) expect(e.pos.distanceTo(p.pos)).toBeGreaterThanOrEqual(SPAWN_SAFE - 1);
      spots.push(p.pos.clone());
    }
    const distinct = spots.filter((s, i) => spots.findIndex((o) => o.distanceTo(s) < 3) === i);
    expect(distinct.length).toBeGreaterThan(15);
  });
});

describe('three hand slots and the backpack', () => {
  it('a new save carries the pistol in slot 1; old saves get a valid loadout', () => {
    expect(defaultSave().loadout).toEqual(['pistol']);
    const old = sanitize({ owned: ['pistol', 'smg', 'rifle', 'sniper', 'lmg'], equipped: 'sniper' });
    expect(old.loadout).toContain('sniper');
    expect(old.loadout.length).toBeLessThanOrEqual(LOADOUT_SIZE);
    const broken = sanitize({ owned: ['pistol', 'smg'], equipped: 'smg', loadout: ['smg', 'smg', 'ghost', 'rifle', 'pistol'] });
    expect(broken.loadout).toEqual(['smg', 'pistol']);
  });
  it('buying fills free slots first, then replaces the weapon in hand; the rest wait in the bag', () => {
    const s = defaultSave();
    s.money = 100000;
    for (const id of ['smg', 'rifle']) expect(buyWeapon(s, id)).toBe('ok');
    expect(s.loadout).toEqual(['pistol', 'smg', 'rifle']);
    expect(buyWeapon(s, 'sniper')).toBe('ok');
    expect(s.loadout).toEqual(['pistol', 'smg', 'sniper']); // rifle was in hand
    expect(s.owned).toContain('rifle');
    // choosing slot 1 for the rifle swaps it in there
    putInLoadout(s, 'rifle', 0);
    expect(s.loadout).toEqual(['rifle', 'smg', 'sniper']);
    expect(s.equipped).toBe('rifle');
    // a weapon already carried moves to the chosen slot (swap)
    putInLoadout(s, 'sniper', 0);
    expect(s.loadout).toEqual(['sniper', 'smg', 'rifle']);
    // selling one empties its slot
    sellWeapon(s, 'smg');
    expect(s.loadout).toEqual(['sniper', 'rifle']);
  });
  it('with the bag in hand the player stands still and cannot shoot', () => {
    const m = quiet();
    const p = m.player;
    const ctrl = new PlayerController(new THREE.PerspectiveCamera());
    ctrl.attach(p, ['pistol']);
    const held = new Set(['fire']);
    const input = {
      isTouch: false, moveX: 0, moveY: 1, aimToggle: false,
      takeLook: () => ({ dx: 0, dy: 0 }), isHeld: (b: string) => held.has(b), consume: () => false, poll: () => {}, sprintHeld: () => false,
    } as unknown as Input;
    const settings = defaultSave().settings;
    p.inBag = true;
    const start = p.pos.clone(), ammo = p.weapon.ammo;
    for (let i = 0; i < 30; i++) { ctrl.update(1 / 30, p, input, m, settings); m.update(1 / 30); }
    expect(p.trigger).toBe(false);
    expect(p.weapon.ammo).toBe(ammo);
    expect(p.pos.distanceTo(start)).toBeLessThan(0.05);
    p.inBag = false;
    for (let i = 0; i < 10; i++) { ctrl.update(1 / 30, p, input, m, settings); m.update(1 / 30); }
    expect(p.weapon.ammo).toBeLessThan(ammo);
  });
});

describe('throwing the knife', () => {
  /** An enemy standing still `d` metres in front of the player, on open street. */
  function setup(d: number) {
    const m = quiet();
    const p = m.player, e = m.combatants.find((c) => c.team === 'red')!;
    p.pos.set(-20, 0, -3); p.yaw = Math.PI / 2; p.pitch = 0;
    e.alive = true; e.hp = e.maxHp = 100; e.shieldT = 0; e.pos.set(-20 + d, 0, -3); e.yaw = Math.PI / 2;
    return { m, p, e };
  }
  it('flies, hits an enemy at 8 m for heavy damage, and the thrower has no knife until it is back', () => {
    const { m, p, e } = setup(8);
    const k = m.throwKnife(p, new THREE.Vector3(1, 0.06, 0));
    expect(k).not.toBeNull();
    expect(p.hasKnife).toBe(false);
    expect(m.melee(p)).toBeNull(); // no knife to stab with
    for (let i = 0; i < 30; i++) m.update(1 / 60);
    expect(e.hp).toBeLessThanOrEqual(100 - THROWN_KNIFE.damage);
    expect(k!.flying).toBe(false);
  });
  it('a throw to the head kills', () => {
    const { m, p, e } = setup(6);
    // aim at the head (eye height 1.67 from a throw height of 1.5, plus the drop)
    m.throwKnife(p, new THREE.Vector3(1, 0.07, 0));
    for (let i = 0; i < 40; i++) m.update(1 / 60);
    expect(e.alive).toBe(false);
    expect(m.killFeed.at(-1)!.weapon.id).toBe('knife');
  });
  it('the owner picks it up by walking over it, or it comes back after a while', () => {
    const { m, p, e } = setup(12);
    e.alive = false; e.respawnT = 1e9;
    const k = m.throwKnife(p, new THREE.Vector3(1, 0.02, 0))!;
    for (let i = 0; i < 120 && k.flying; i++) m.update(1 / 60);
    expect(k.flying).toBe(false);
    p.pos.set(k.pos.x, k.pos.y < 1 ? 0 : p.pos.y, k.pos.z);
    m.update(1 / 60);
    expect(p.hasKnife).toBe(true);
    expect(m.knives.length).toBe(0);
    // thrown into the sky: comes back by itself
    m.throwKnife(p, new THREE.Vector3(0.3, 1, 0));
    for (let t = 0; t < KNIFE_RETURN + 1; t += 1 / 30) m.update(1 / 30);
    expect(p.hasKnife).toBe(true);
  });
});
