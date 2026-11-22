import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { TRAIN_H, TRAIN_HALF_W, TRAIN_LEN, Train } from '../src/game/metro';
import { PlayerController, exitT } from '../src/game/player';
import { buildPhysics, createMap } from '../src/world/map';
import { STATIONS, TUNNEL_Y } from '../src/world/structures';

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

describe('nothing stands in a wall or in the way', () => {
  it('pickups and air drops never land inside or against a building', () => {
    const rects = [...map.buildings, ...map.structures.houses];
    expect(map.pois.length).toBeGreaterThan(30);
    for (const p of map.pois) for (const b of rects) {
      expect(p.x > b.x0 - 1.5 && p.x < b.x1 + 1.5 && p.z > b.z0 - 1.5 && p.z < b.z1 + 1.5, `poi ${p.x},${p.z}`).toBe(false);
    }
  });

  it('the platform in front of the train doors is clear (no benches)', () => {
    for (const sx of STATIONS) for (const d of Train.DOORS) {
      // the lane beside each door, on both sides of the track
      const blockers = map.structures.pieces.filter((pc) => pc.solid && pc.box.minY < TUNNEL_Y + 1 && pc.box.maxY > TUNNEL_Y + 0.05
        && pc.box.maxX > sx + d - 1.5 && pc.box.minX < sx + d + 1.5 && Math.abs(pc.box.minZ + pc.box.maxZ) / 2 > TRAIN_HALF_W && Math.abs(pc.box.minZ + pc.box.maxZ) / 2 < 2.4);
      expect(blockers, `station ${sx} door ${d}`).toEqual([]);
    }
  });
});

describe('metro signs', () => {
  it('no metro sign (post or board) stands in or against a building', () => {
    const rects = [...map.buildings, ...map.structures.houses];
    const signs = map.structures.pieces.filter((pc) => pc.mat === 'sign' && pc.box.minY >= 0);
    expect(signs.length).toBeGreaterThanOrEqual(15);
    for (const s of signs) for (const b of rects) {
      const m = 0.3;
      const hit = s.box.minX < b.x1 + m && s.box.maxX > b.x0 - m && s.box.minZ < b.z1 + m && s.box.maxZ > b.z0 - m;
      expect(hit, `sign at ${s.box.minX.toFixed(1)},${s.box.minZ.toFixed(1)} in building ${b.x0},${b.x1},${b.z0},${b.z1}`).toBe(false);
    }
  });
});

describe('metro rails', () => {
  it('nothing pokes up through the carriage floor along the whole line', () => {
    const floorTop = TUNNEL_Y + 0.06; // TrainView floor slab
    for (const p of map.structures.pieces) {
      const b = p.box;
      if (b.maxX > -130 && b.minX < 130 && b.maxZ > -TRAIN_HALF_W && b.minZ < TRAIN_HALF_W && b.minY < TUNNEL_Y + TRAIN_H && b.maxY > TUNNEL_Y - 0.01)
        expect(b.maxY, `${p.mat} ${JSON.stringify(b)}`).toBeLessThan(floorTop);
    }
  });
});
