import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Match } from '../src/game/match';
import { DISCOVER_MS, Online, assignSlot, type Msg, type StartInfo, type Transport } from '../src/net/online';
import { buildPhysics, createMap } from '../src/world/map';

/** All peers in one room; messages wait in a queue until flush() (in order, like a data channel). */
class Hub {
  peers = new Map<string, MemTransport>();
  queue: (() => void)[] = [];
  join(t: MemTransport): void {
    for (const o of this.peers.values()) {
      this.queue.push(() => { o.onPeerJoin?.(t.selfId); t.onPeerJoin?.(o.selfId); });
    }
    this.peers.set(t.selfId, t);
  }
  leave(t: MemTransport): void {
    this.peers.delete(t.selfId);
    for (const o of this.peers.values()) this.queue.push(() => o.onPeerLeave?.(t.selfId));
  }
  flush(): void {
    for (let i = 0; i < 10000 && this.queue.length; i++) this.queue.shift()!();
  }
}

class MemTransport implements Transport {
  onMessage: ((msg: Msg, from: string) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  constructor(readonly hub: Hub, readonly selfId: string) {}
  send(msg: Msg, to?: string): void {
    const copy = JSON.parse(JSON.stringify(msg)) as Msg;
    for (const o of this.hub.peers.values()) {
      if (o === this || (to && o.selfId !== to)) continue;
      this.hub.queue.push(() => { if (this.hub.peers.has(o.selfId) && this.hub.peers.has(this.selfId)) o.onMessage?.(copy, this.selfId); });
    }
  }
  leave(): void { this.hub.leave(this); }
}

interface Dev { on: Online; starts: StartInfo[]; full: boolean }

function device(hub: Hub, id: string, onStart?: (d: Dev, info: StartInfo) => void): Dev {
  const t = new MemTransport(hub, id);
  hub.join(t);
  const d = { starts: [] as StartInfo[], full: false } as Dev;
  d.on = new Online(t, id.toUpperCase(), {
    start: (info) => { d.starts.push(info); onStart?.(d, info); },
    end: () => {},
    status: () => {},
    full: () => { d.full = true; },
  });
  return d;
}

const lastSlot = (d: Dev) => d.starts[d.starts.length - 1]?.slot;

describe('online room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fills blue first, then red, then says the room is full', () => {
    expect(assignSlot(Array(20).fill(null))).toBe(0);
    const hub = new Hub();
    const host = device(hub, 'a');
    hub.flush();
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    expect(host.on.isHost()).toBe(true);
    expect(lastSlot(host)).toBe(0);
    const guests: Dev[] = [];
    for (let i = 1; i < 21; i++) {
      vi.advanceTimersByTime(5); // later devices are younger
      guests.push(device(hub, `p${String(i).padStart(2, '0')}`));
      hub.flush();
    }
    // nine more people complete blue (slots 1..9), the next ten go to red (10..19)
    expect(guests.slice(0, 9).map(lastSlot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(guests.slice(9, 19).map(lastSlot)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(guests[19].full).toBe(true);
    expect(guests[19].starts).toHaveLength(0);
    // nobody opened a second room
    expect(guests.filter((g) => g.on.isHost())).toHaveLength(0);
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    expect(guests.filter((g) => g.on.isHost())).toHaveLength(0);
  });

  it('a freed blue slot goes to the next newcomer', () => {
    const hub = new Hub();
    const host = device(hub, 'a');
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    const b = device(hub, 'b'); hub.flush();
    const c = device(hub, 'c'); hub.flush();
    expect([lastSlot(b), lastSlot(c)]).toEqual([1, 2]);
    b.on.leave(); hub.flush();
    expect(host.on.slots[1]).toBeNull();
    const d = device(hub, 'd'); hub.flush();
    expect(lastSlot(d)).toBe(1);
  });

  it('the oldest guest takes over when the host leaves', () => {
    const hub = new Hub();
    const host = device(hub, 'a');
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    vi.advanceTimersByTime(5);
    const b = device(hub, 'b'); hub.flush();
    vi.advanceTimersByTime(5);
    const c = device(hub, 'c'); hub.flush();
    host.on.leave(); hub.flush();
    expect(b.on.isHost()).toBe(true);
    expect(c.on.hostId).toBe('b');
    expect(c.on.isHost()).toBe(false);
    // both keep their slots; the host's old slot is a bot again
    expect(b.on.slots.slice(0, 3)).toEqual([null, 'b', 'c']);
    expect(c.on.slots.slice(0, 3)).toEqual([null, 'b', 'c']);
  });

  it('two rooms opened at once merge: the older host keeps it', () => {
    const hub = new Hub();
    // both alone at first (they cannot see each other yet)
    const a = device(hub, 'a');
    hub.peers.delete('a');
    vi.advanceTimersByTime(5);
    const b = device(hub, 'b');
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    expect(a.on.isHost() && b.on.isHost()).toBe(true);
    // now they meet
    hub.peers.delete('b');
    hub.join(a.on.tr as MemTransport);
    hub.join(b.on.tr as MemTransport);
    hub.flush();
    expect(a.on.isHost()).toBe(true);
    expect(b.on.isHost()).toBe(false);
    expect(lastSlot(b)).toBe(1);
  });
});

describe('online match', () => {
  const map = createMap();
  const { world, nav } = buildPhysics(map);
  const build = (d: Dev, info: StartInfo) => {
    const m = new Match(map, world, nav, 'pistol', {}, { seed: info.seed, slot: info.slot, playerName: d.on.name });
    d.on.attach(m);
  };

  it('hits are decided by the shooter and applied by the victim\'s device', () => {
    vi.useFakeTimers();
    const hub = new Hub();
    const a = device(hub, 'a', build);
    vi.advanceTimersByTime(DISCOVER_MS + 10);
    const b = device(hub, 'b', build);
    hub.flush();
    vi.useRealTimers();
    const ma = a.on.match!, mb = b.on.match!;
    expect(mb.player.id).toBe(1);
    expect(mb.player.team).toBe('blue');
    // on the host, slot 1 is now the guest (no bot brain); on the guest, the host is slot 0
    expect(ma.combatants[1].remote).toBe(true);
    expect(ma.combatants[1].name).toBe('B');
    expect(mb.combatants[0].remote).toBe(true);
    for (const c of [...ma.combatants, ...mb.combatants]) c.shieldT = 0;

    // the guest shoots a red bot: only the host (which runs the bots) takes the hp off
    const botA = ma.combatants[12], botB = mb.combatants[12];
    const hp0 = botA.hp;
    mb.damage(botB, mb.player, 30, false, mb.player.weapon.def);
    expect(botB.hp).toBe(hp0); // not applied on the shooter's device
    hub.flush();
    expect(botA.hp).toBe(hp0 - 30);

    // a host bot kills the guest: the guest's device applies it and tells everyone
    const killerA = ma.combatants[15];
    ma.damage(ma.combatants[1], killerA, 999, true, killerA.weapon.def);
    expect(ma.combatants[1].alive).toBe(true); // waits for the guest
    hub.flush();
    expect(mb.player.alive).toBe(false);
    expect(mb.score.red).toBe(1);
    expect(ma.score.red).toBe(1);
    expect(ma.combatants[1].alive).toBe(false);
    expect(ma.combatants[15].kills).toBe(1);

    // state flows both ways: the guest's position reaches the host
    mb.player.pos.set(10, 0, 4);
    a.on.tick(0.2); b.on.tick(0.2); hub.flush();
    a.on.tick(1); // smoothing
    expect(ma.combatants[1].pos.distanceTo(new THREE.Vector3(10, 0, 4))).toBeLessThan(0.01);
    // and the host's bots move on the guest's screen
    ma.combatants[12].pos.set(-20, 0, 3);
    a.on.tick(0.2); hub.flush(); b.on.tick(1);
    expect(mb.combatants[12].pos.distanceTo(new THREE.Vector3(-20, 0, 3))).toBeLessThan(0.01);
  });
});
