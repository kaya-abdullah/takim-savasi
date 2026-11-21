import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Match } from '../src/game/match';
import { BOARD_WAIT, DWELL, TRAIN_HALF_W, TRAIN_LEN, Train } from '../src/game/metro';
import { DISCOVER_MS, Online, type Msg, type StartInfo, type Transport } from '../src/net/online';
import { buildPhysics, createMap } from '../src/world/map';
import { ENTRANCES, METRO_END, STATIONS, TUNNEL, TUNNEL_Y, entranceFootprint } from '../src/world/structures';

const map = createMap();
const { world, nav } = buildPhysics(map);

describe('metro line', () => {
  it('runs under the whole avenue with an entrance in every part of the city', () => {
    const t = map.structures;
    expect(ENTRANCES).toHaveLength(14);
    // entrances in all four quarters, on both sides of the avenue
    for (const [lo, hi] of [[-140, -70], [-70, 0], [0, 70], [70, 140]]) {
      expect(ENTRANCES.filter((e) => e.x >= lo && e.x < hi).length).toBeGreaterThanOrEqual(3);
    }
    // nothing stands on a stairwell
    for (const e of ENTRANCES) {
      const f = entranceFootprint(e);
      for (const b of map.buildings) expect(b.x1 <= f.x0 || b.x0 >= f.x1 || b.z1 <= f.z0 || b.z0 >= f.z1).toBe(true);
    }
    // the tunnel can be walked from one end to the other
    const p = nav.findPath(-METRO_END + 3, TUNNEL_Y, 0, METRO_END - 3, TUNNEL_Y, 0);
    expect(p).not.toBeNull();
    // and every entrance leads down from the street
    for (const e of ENTRANCES) {
      const z = e.side === 'S' ? -16 : 16;
      const q = nav.findPath(e.x, 0, z, e.x, TUNNEL_Y, 0);
      expect(q, `entrance at ${e.x} ${e.side}`).not.toBeNull();
    }
    expect(t.levels.filter((l) => l.name === TUNNEL)).toHaveLength(1);
    // the corridor floor holds people from end to end
    for (let x = -130; x <= 130; x += 10) expect(world.groundHeight(x, 0, 0.4, TUNNEL_Y + 0.5)).toBeCloseTo(TUNNEL_Y, 1); // on the track (benches line the walls)
  });

  it('the train waits until someone boards, leaves, and stops at the next station', () => {
    const t = new Train();
    const start = t.x;
    for (let i = 0; i < 600; i++) t.step(1 / 60, false);
    expect(t.x).toBe(start); // nobody aboard: it stays
    let i = 0;
    while (t.state === 'stopped' && i++ < 600) t.step(1 / 60, true);
    expect(i / 60).toBeGreaterThanOrEqual(BOARD_WAIT - 0.05);
    expect(t.state).toBe('moving');
    const next = STATIONS[t.at];
    expect(Math.abs(next - start)).toBe(70);
    for (i = 0; i < 60 * 30 && t.state === 'moving'; i++) t.step(1 / 60, true);
    expect(t.state).toBe('stopped');
    expect(t.x).toBe(next);
    // a 70 m hop takes seconds, not minutes
    expect(i / 60).toBeLessThan(12);
    // doors stay open for a while even with riders
    for (i = 0; i < 60 * (DWELL - 0.5); i++) t.step(1 / 60, true);
    expect(t.state).toBe('stopped');
  });

  it('turns back at the end of the line', () => {
    const t = new Train();
    const seen: number[] = [];
    for (let k = 0; k < 8; k++) {
      for (let i = 0; i < 60 * 40 && !(t.state === 'moving'); i++) t.step(1 / 60, true);
      for (let i = 0; i < 60 * 40 && t.state === 'moving'; i++) t.step(1 / 60, true);
      seen.push(t.at);
    }
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(STATIONS.length - 1);
    for (let k = 1; k < seen.length; k++) expect(Math.abs(seen[k] - seen[k - 1])).toBe(1);
  });

  it('carries its riders and pushes people on the track aside', () => {
    const m = new Match(map, world, nav, 'pistol', {}, { seed: 7 });
    for (const [, b] of m.brains) b.update = () => {};
    const p = m.player, other = m.combatants[3];
    const t = m.train;
    p.pos.set(t.x + 2, TUNNEL_Y, 0.3);
    p.shieldT = 99;
    other.pos.set(STATIONS[t.at + 1] - 20, TUNNEL_Y, 0.2); // standing on the track ahead
    for (let i = 0; i < 60 * 30 && !(t.state === 'stopped' && t.x === STATIONS[2]); i++) {
      m.update(1 / 60);
      p.hp = p.maxHp; other.hp = other.maxHp;
      if (t.state === 'moving') expect(Math.abs(other.pos.z) < TRAIN_HALF_W && Math.abs(other.pos.x - t.x) < TRAIN_LEN / 2).toBe(false);
    }
    expect(t.x).toBe(STATIONS[2]);
    // the rider arrived with it, still inside
    expect(t.aboard(p)).toBe(true);
    expect(p.pos.x).toBeCloseTo(STATIONS[2] + 2, 0);
    // the one on the track was moved into the side lane
    expect(Math.abs(other.pos.z)).toBeGreaterThan(TRAIN_HALF_W);
  });

  it('a rider cannot step out of the running train even at a low frame rate', () => {
    const m = new Match(map, world, nav, 'pistol', {}, { seed: 9 });
    for (const [, b] of m.brains) b.update = () => {};
    const p = m.player, t = m.train;
    p.pos.set(t.x, TUNNEL_Y, 0);
    p.shieldT = 99;
    const dt = 0.05; // 20 fps: the game's largest step
    for (let i = 0; i < 200 && t.state === 'stopped'; i++) m.update(dt);
    expect(t.state).toBe('moving');
    for (let i = 0; i < 40 && t.state === 'moving'; i++) {
      // a full sprint step straight at the side wall, every frame
      m.move(p, 0, 0.45, dt);
      m.update(dt);
      expect(t.aboard(p) || Math.abs(p.pos.z) < TRAIN_HALF_W).toBe(true);
      expect(Math.abs(p.pos.x - t.x)).toBeLessThan(TRAIN_LEN / 2);
    }
  });
});

describe('roof bridges', () => {
  it('four bridges join centre roofs; bots can plan a way across', () => {
    const links = map.structures.links.filter((l) => l.a.endsWith('-roof') || l.a.endsWith('-roofm')).filter((l) => l.b.endsWith('-roof') || l.b.endsWith('-roofm'));
    expect(links).toHaveLength(4);
    // A (west house) roof to B (by the plaza) roof: on the deck, standing height 7
    expect(world.groundHeight(-35, 19.1, 0.4, 7.5)).toBeCloseTo(7, 1);
    // through the parapet gaps there is nothing in the way at body height
    expect(world.blocked(-46, 19.1, 0.4, 7, 1.8)).toBe(false);
    expect(world.blocked(-25, 19.1, 0.4, 7, 1.8)).toBe(false);
    // over the avenue
    expect(world.groundHeight(49.5, 0, 0.4, 7.5)).toBeCloseTo(7, 1);
    expect(world.groundHeight(-49.5, 0, 0.4, 7.5)).toBeCloseTo(7, 1);
    const path = nav.findPath(-50, 7, 15, -20, 7, 20);
    expect(path).not.toBeNull();
    expect(path!.some((w) => w.link && w.x > -46 && w.x < -25)).toBe(false); // link points sit on the roofs
    expect(path!.every((w) => w.y > 6)).toBe(true); // never climbs down to the street
  });
});

/** In-memory room (as in online.test.ts). */
class Hub {
  peers = new Map<string, Mem>();
  q: (() => void)[] = [];
  join(t: Mem): void {
    for (const o of this.peers.values()) this.q.push(() => { o.onPeerJoin?.(t.selfId); t.onPeerJoin?.(o.selfId); });
    this.peers.set(t.selfId, t);
  }
  flush(): void { for (let i = 0; i < 10000 && this.q.length; i++) this.q.shift()!(); }
}
class Mem implements Transport {
  onMessage: ((m: Msg, f: string) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  constructor(readonly hub: Hub, readonly selfId: string) {}
  send(msg: Msg, to?: string): void {
    const c = JSON.parse(JSON.stringify(msg)) as Msg;
    for (const o of this.hub.peers.values()) if (o !== this && (!to || o.selfId === to)) this.hub.q.push(() => o.onMessage?.(c, this.selfId));
  }
  leave(): void { this.hub.peers.delete(this.selfId); for (const o of this.hub.peers.values()) this.hub.q.push(() => o.onPeerLeave?.(this.selfId)); }
}

describe('after a match nobody is pulled into the next one', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const dev = (hub: Hub, id: string) => {
    const t = new Mem(hub, id);
    hub.join(t);
    const d = { starts: [] as StartInfo[], on: null as unknown as Online };
    d.on = new Online(t, id, {
      start: (info) => {
        d.starts.push(info);
        const m = new Match(map, world, nav, 'pistol', {}, { seed: info.seed, slot: info.slot, duration: 1000 });
        d.on.attach(m);
      },
      end: () => {}, status: () => {}, full: () => {},
    });
    return d;
  };

  it('waits for "play again"; a guest who wants to play while the host idles takes over the room', () => {
    const hub = new Hub();
    const a = dev(hub, 'a');
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    vi.advanceTimersByTime(5);
    const b = dev(hub, 'b'); hub.flush();
    vi.advanceTimersByTime(5);
    const c = dev(hub, 'c'); hub.flush();
    expect([a.starts.length, b.starts.length, c.starts.length]).toEqual([1, 1, 1]);
    // the host ends the match
    a.on.match!.finish();
    hub.flush();
    expect(b.on.match!.over && c.on.match!.over).toBe(true);
    vi.advanceTimersByTime(60_000);
    hub.flush();
    // nothing started by itself
    expect([a.starts.length, b.starts.length, c.starts.length]).toEqual([1, 1, 1]);
    // B wants to play, A (host) still looks at the results: B runs the room now
    b.on.again(); hub.flush();
    expect(b.on.isHost()).toBe(true);
    expect(b.starts.length).toBe(2);
    expect(a.starts.length).toBe(1);
    expect(c.starts.length).toBe(1);
    expect(c.on.hostId).toBe('b');
    expect(a.on.hostId).toBe('b');
    // C joins B's match when it presses play again; A later too
    c.on.again(); hub.flush();
    expect(c.starts.length).toBe(2);
    expect(c.starts[1].mid).toBe(b.on.mid);
    a.on.again(); hub.flush();
    expect(a.starts.length).toBe(2);
    expect(a.starts[1].mid).toBe(b.on.mid);
    expect(b.on.humans()).toBe(3);
  });

  it('a guest sees the host train run and rides along in it', () => {
    const hub = new Hub();
    const a = dev(hub, 'a');
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    const b = dev(hub, 'b'); hub.flush();
    const ma = a.on.match!, mb = b.on.match!;
    for (const m of [ma, mb]) for (const [, br] of m.brains) br.update = () => {};
    // the guest boards on its own device; the host sees it aboard through the snapshots and starts the train
    mb.player.pos.set(ma.train.x + 2, TUNNEL_Y, 0.4);
    mb.player.shieldT = ma.combatants[1].shieldT = 99;
    let maxGap = 0;
    for (let i = 0; i < 60 * 30; i++) {
      ma.update(1 / 60); mb.update(1 / 60);
      a.on.tick(1 / 60); b.on.tick(1 / 60); hub.flush();
      mb.player.hp = mb.player.maxHp;
      if (ma.train.state === 'moving') maxGap = Math.max(maxGap, Math.abs(ma.train.x - mb.train.x));
      if (ma.train.state === 'stopped' && ma.train.x === STATIONS[2] && i > 60 * 5) break;
    }
    expect(ma.train.x).toBe(STATIONS[2]);
    expect(Math.abs(mb.train.x - STATIONS[2])).toBeLessThan(0.3);
    // the two screens never disagree by more than a couple of metres
    expect(maxGap).toBeLessThan(3);
    // the guest came along, inside the carriage
    expect(mb.train.aboard(mb.player)).toBe(true);
  });

  it('the host pressing "play again" starts a match only for itself and those who asked', () => {
    const hub = new Hub();
    const a = dev(hub, 'a');
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    const b = dev(hub, 'b'); hub.flush();
    a.on.match!.finish(); hub.flush();
    a.on.again(); hub.flush();
    expect(a.starts.length).toBe(2);
    expect(b.starts.length).toBe(1); // B stays on its end screen
    expect(a.on.humans()).toBe(1);
    b.on.again(); hub.flush();
    expect(b.starts.length).toBe(2);
    expect(b.starts[1].mid).toBe(a.on.mid);
  });
});
