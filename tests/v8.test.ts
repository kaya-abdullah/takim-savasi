import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { TRAIN_H, TRAIN_HALF_W, TRAIN_LEN } from '../src/game/metro';
import { PlayerController, exitT } from '../src/game/player';
import { buildPhysics, createMap } from '../src/world/map';
import { TUNNEL_Y } from '../src/world/structures';

const map = createMap();
const { world, nav } = buildPhysics(map);

describe('riding the metro shows only the carriage inside', () => {
  it('exitT: the part of a step that stays inside a box', () => {
    const b = { x0: 0, y0: 0, z0: 0, x1: 10, y1: 2, z1: 2 };
    expect(exitT({ x: 5, y: 1, z: 1 }, -10, 0, 0, b)).toBeCloseTo(0.5);
    expect(exitT({ x: 5, y: 1, z: 1 }, 0, 4, 0, b)).toBeCloseTo(0.25);
    expect(exitT({ x: 5, y: 1, z: 1 }, 1, 0, 0, b)).toBe(1);
  });

  it('the camera stays inside the carriage whichever way the rider looks', () => {
    const m = new Match(map, world, nav, 'pistol', {}, { seed: 3 });
    for (const [, b] of m.brains) b.update = () => {};
    const p = m.player, t = m.train;
    const cam = new THREE.PerspectiveCamera();
    const ctrl = new PlayerController(cam) as unknown as { updateCamera(dt: number, c: unknown, m: Match): void };
    p.pos.set(t.x + 5, TUNNEL_Y, 0.4);
    p.shieldT = 99;
    // looking down (the camera rises behind), sideways at a wall, along the carriage
    for (const [yaw, pitch] of [[Math.PI / 2, -1.2], [0, 0], [Math.PI, 0.3], [-Math.PI / 2, -0.4], [Math.PI / 2, 0]]) {
      p.yaw = yaw; p.pitch = pitch;
      for (let i = 0; i < 90; i++) { m.update(1 / 60); p.hp = p.maxHp; ctrl.updateCamera(1 / 60, p, m); }
      expect(t.aboard(p)).toBe(true);
      const c = cam.position;
      expect(Math.abs(c.x - t.x), `yaw ${yaw} pitch ${pitch}`).toBeLessThan(TRAIN_LEN / 2);
      expect(Math.abs(c.z)).toBeLessThan(TRAIN_HALF_W);
      expect(c.y).toBeGreaterThan(TUNNEL_Y);
      expect(c.y).toBeLessThan(TUNNEL_Y + TRAIN_H - 0.12); // under the roof
    }
  });

  it('someone who leaves the running train (respawn) is no longer carried', () => {
    const m = new Match(map, world, nav, 'pistol', {}, { seed: 4 });
    for (const [, b] of m.brains) b.update = () => {};
    const p = m.player, t = m.train;
    p.pos.set(t.x, TUNNEL_Y, 0);
    p.shieldT = 99;
    for (let i = 0; i < 400 && t.state === 'stopped'; i++) m.update(1 / 60);
    expect(t.state).toBe('moving');
    m.update(1 / 60);
    expect(t.riders.has(p)).toBe(true);
    // back on the street, far away (as after a respawn)
    p.pos.set(-60, 0, -30);
    const x = p.pos.x;
    for (let i = 0; i < 30; i++) m.update(1 / 60);
    expect(t.carrying(p)).toBe(false);
    expect(p.pos.x).toBeCloseTo(x, 1); // not dragged along with the train
  });
});

describe('roof bridges sit cleanly', () => {
  it('a bridge landing is a clean cut in the parapet: no cap or frame across it', () => {
    // the west house (x -58..-46) meets the bridge to the plaza house over z 18.1..20.1
    const across = map.structures.pieces.filter((pc) => {
      const b = pc.box;
      return b.minX < -46.0 && b.maxX > -46.3 && b.minZ < 19.9 && b.maxZ > 18.3 && b.maxY > 7.05 && b.minY < 8.3;
    });
    expect(across.map((pc) => pc.mat)).toEqual([]);
  });

  it('no tree grows through a bridge or into a building wall', () => {
    const trees = map.props.filter((p) => p.kind === 'tree');
    expect(trees.length).toBeGreaterThan(50);
    const r = 2.3;
    for (const t of trees) {
      for (const b of map.structures.bridges) expect(t.x > b.x0 - r && t.x < b.x1 + r && t.z > b.z0 - r && t.z < b.z1 + r, `tree ${t.x},${t.z}`).toBe(false);
      for (const b of map.buildings) if (b.h > 2.5) expect(t.x > b.x0 - r && t.x < b.x1 + r && t.z > b.z0 - r && t.z < b.z1 + r, `tree ${t.x},${t.z}`).toBe(false);
    }
    expect(map.structures.bridges).toHaveLength(4);
  });
});
