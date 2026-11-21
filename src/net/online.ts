import * as THREE from 'three';
import { ALL_WEAPONS, GRENADE, KNIFE, THROWN_KNIFE, getWeapon, type WeaponDef } from '../data/weapons';
import { JET_BOMB, JET_GUN, TANK_GUN, TANK_HIT, TANK_SHELL } from '../data/vehicles';
import type { Combatant } from '../game/combatant';
import { SLOTS, TEAM_SIZE, VEHICLE_EJECT, botName, type KillEntry, type Match, type MatchNet, type Pickup, type PickupKind } from '../game/match';
import type { Team } from '../render/character';

/**
 * Online team play without a game server.
 *
 * Every device joins one shared room. The device that has been there longest
 * is the host: it runs the bots, the clock, the pickups and the end of the
 * match. Each person runs their own fighter and sends its state ~12 times a
 * second. A hit is decided on the shooter's device and applied on the
 * victim's device (MatchNet). People fill the blue team first (10 slots);
 * once blue is full, newcomers go to red. A slot no person holds is a bot.
 */

export type Msg = { t: string; [k: string]: unknown };

/** The wire: trystero in the game, an in-memory hub in the tests. */
export interface Transport {
  readonly selfId: string;
  /** To one peer, or to everyone when `to` is omitted. */
  send(msg: Msg, to?: string): void;
  onMessage: ((msg: Msg, from: string) => void) | null;
  onPeerJoin: ((id: string) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
  leave(): void;
}

export interface StartInfo {
  mid: string;
  slot: number;
  seed: number;
  time: number;
  score: Record<Team, number>;
  /** kills, deaths per slot (late join) */
  kd: [number, number][];
  /** pickups already lying around (late join): id, kind, x, y, z */
  pk: [number, PickupKind, number, number, number][];
  /** bandage ids currently taken */
  gone: number[];
}

export interface OnlineHooks {
  /** Build a match for this slot (a new one, or join the running one). */
  start(info: StartInfo): void;
  /** The match ended on the host. */
  end(winner: Team | 'draw'): void;
  /** Short text for the waiting screen. */
  status(text: string): void;
  /** Every slot is taken by people. */
  full(): void;
}

/** First free slot: blue until it holds TEAM_SIZE people, then red. -1 when full. */
export function assignSlot(slots: (string | null)[]): number {
  for (let i = 0; i < TEAM_SIZE; i++) if (!slots[i]) return i;
  for (let i = TEAM_SIZE; i < SLOTS; i++) if (!slots[i]) return i;
  return -1;
}

/** How long a lone device waits for others before it opens the room itself. */
export const DISCOVER_MS = 4000;
const SEND_EVERY = 1 / 12;

const EXTRA_DEFS: WeaponDef[] = [GRENADE, KNIFE, THROWN_KNIFE, VEHICLE_EJECT, TANK_HIT, TANK_GUN, TANK_SHELL, JET_GUN, JET_BOMB];
export function defById(id: string): WeaponDef {
  return EXTRA_DEFS.find((d) => d.id === id && d.name !== THROWN_KNIFE.name) ?? (id === 'tknife' ? THROWN_KNIFE : ALL_WEAPONS.find((w) => w.id === id) ?? getWeapon(id));
}
/** THROWN_KNIFE shares KNIFE's id; it travels as 'tknife'. */
const wireId = (d: WeaponDef): string => (d === THROWN_KNIFE ? 'tknife' : d.id);

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

interface PeerInfo { name: string; since: number }

export class Online implements MatchNet {
  readonly since = Date.now();
  readonly peers = new Map<string, PeerInfo>();
  hostId: string | null = null;
  /** Peer id of the person in each slot (null: a bot). */
  slots: (string | null)[] = Array(SLOTS).fill(null);
  names: Record<string, string> = {};
  mySlot = -1;
  mid = '';
  match: Match | null = null;
  private sendT = 0;
  private discoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where each other-peer fighter should be (smoothed toward every frame). */
  private targets = new Map<Combatant, THREE.Vector3>();
  closed = false;

  constructor(readonly tr: Transport, readonly name: string, readonly hooks: OnlineHooks) {
    tr.onMessage = (m, from) => this.onMsg(m, from);
    tr.onPeerJoin = (id) => this.hello(id);
    tr.onPeerLeave = (id) => this.peerLeft(id);
    hooks.status('Oda aranıyor…');
    this.hello();
    this.discoverTimer = setTimeout(() => {
      this.discoverTimer = null;
      if (!this.hostId && !this.closed) this.becomeHost(true);
    }, DISCOVER_MS);
  }

  get self(): string { return this.tr.selfId; }
  isHost(): boolean { return this.hostId === this.self; }

  leave(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.discoverTimer) clearTimeout(this.discoverTimer);
    this.match = null;
    this.tr.leave();
  }

  /** People in the room (with slots), for the HUD. */
  humans(): number {
    return this.slots.filter(Boolean).length;
  }

  // ------------------------------------------------------------ MatchNet
  owns(c: Combatant): boolean {
    if (this.match && c === this.match.player) return true;
    const s = this.slots[c.id];
    if (s) return s === this.self;
    return this.isHost();
  }

  /** Which peer runs a fighter. */
  ownerOf(c: Combatant): string | null {
    return this.slots[c.id] ?? this.hostId;
  }

  sendDamage(victim: Combatant, attacker: Combatant, amount: number, head: boolean, def: WeaponDef): void {
    const to = this.ownerOf(victim);
    if (to && to !== this.self) this.tr.send({ t: 'dmg', mid: this.mid, v: victim.id, a: attacker.id, n: amount, h: head, w: wireId(def) }, to);
  }

  sendKill(e: KillEntry): void {
    this.tr.send({ t: 'kill', mid: this.mid, k: e.killer.id, v: e.victim.id, w: wireId(e.weapon), h: e.head });
  }

  sendPickupTaken(p: Pickup, c: Combatant | null): void {
    this.tr.send({ t: 'pk-', mid: this.mid, id: p.id, c: c ? c.id : -1 });
  }

  sendPickupSpawned(p: Pickup): void {
    this.tr.send({ t: 'pk+', mid: this.mid, id: p.id, k: p.kind, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)] });
  }

  // ------------------------------------------------------------ match wiring
  /** Hooks a freshly built match into the room. */
  attach(m: Match): void {
    this.match = m;
    m.net = this;
    this.targets.clear();
    this.applyRoster();
    const ev = m.events;
    m.events = {
      ...ev,
      grenadeThrown: (g) => {
        ev.grenadeThrown?.(g);
        if (this.owns(g.owner)) this.tr.send({ t: 'gr', mid: this.mid, o: g.owner.id, p: vec(g.pos), v: vec(g.vel) });
      },
      knifeThrown: (k) => {
        ev.knifeThrown?.(k);
        if (this.owns(k.owner)) this.tr.send({ t: 'kn', mid: this.mid, o: k.owner.id, p: vec(k.pos), v: vec(k.vel) });
      },
      melee: (c, v, back) => {
        ev.melee?.(c, v, back);
        if (this.owns(c)) this.tr.send({ t: 'ml', mid: this.mid, o: c.id });
      },
      end: (w) => {
        ev.end?.(w);
        if (this.isHost()) {
          this.tr.send({ t: 'end', mid: this.mid, w, sc: { ...m.score } });
          // everyone gets a fresh match a little later
          setTimeout(() => { if (!this.closed && this.isHost() && this.match === m) this.newMatch(); }, 12000);
        }
      },
    };
  }

  /** Slot owners, names and the "remote" flag onto the match's fighters. */
  private applyRoster(): void {
    const m = this.match;
    if (!m) return;
    for (const c of m.combatants) {
      if (c === m.player) continue;
      const peer = this.slots[c.id];
      const wasRemote = c.remote;
      c.remote = !!peer && peer !== this.self;
      c.name = c.remote ? this.names[peer!] ?? 'Oyuncu' : botName(c.id);
      // a person left: the bot takes over from where they stood
      if (wasRemote && !c.remote) m.brains.get(c)?.reset();
    }
  }

  /** Every frame: smooth other peers' fighters, send ours. */
  tick(dt: number): void {
    const m = this.match;
    if (!m || this.closed) return;
    const k = Math.min(1, dt * 14);
    for (const [c, t] of this.targets) {
      if (this.owns(c)) { this.targets.delete(c); continue; }
      c.pos.lerp(t, k);
    }
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = SEND_EVERY;
    const list: unknown[] = [];
    for (const c of m.combatants) if (this.owns(c)) list.push(pack(c));
    const msg: Msg = { t: 'st', mid: this.mid, c: list };
    if (this.isHost()) { msg.time = r2(m.time); msg.sc = { ...m.score }; }
    this.tr.send(msg);
  }

  // ------------------------------------------------------------ room
  private hello(to?: string): void {
    this.tr.send({ t: 'hi', name: this.name, since: this.since, host: this.hostId }, to);
    if (to && this.isHost()) this.sendRoster(to);
  }

  /** This device opens the room (or takes it over when the host left). */
  private becomeHost(fresh: boolean): void {
    this.hostId = this.self;
    // people whose device is gone lose their slot
    for (let i = 0; i < SLOTS; i++) if (this.slots[i] && this.slots[i] !== this.self && !this.peers.has(this.slots[i]!)) this.slots[i] = null;
    if (this.mySlot < 0 || this.slots[this.mySlot] !== this.self) {
      this.mySlot = assignSlot(this.slots);
      this.slots[this.mySlot] = this.self;
    }
    this.names[this.self] = this.name;
    if (fresh || !this.match) this.newMatch();
    else {
      this.sendRoster();
      this.applyRoster();
      for (const b of this.match.brains.values()) b.reset();
    }
    // peers already here without a slot get one now
    for (const id of this.peers.keys()) if (!this.slots.includes(id)) this.admit(id);
  }

  private newMatch(): void {
    this.mid = Math.random().toString(36).slice(2, 10);
    const seed = Math.floor(Math.random() * 1e9);
    this.sendRoster();
    for (let i = 0; i < SLOTS; i++) {
      const id = this.slots[i];
      if (id && id !== this.self) this.tr.send({ t: 'start', ...this.startInfo(i, seed, true) }, id);
    }
    this.hooks.start(this.startInfo(this.mySlot, seed, true));
  }

  private startInfo(slot: number, seed: number, fresh: boolean): StartInfo {
    const m = this.match;
    const live = !fresh && m;
    return {
      mid: this.mid, slot, seed,
      time: live ? m.time : 0,
      score: live ? { ...m.score } : { blue: 0, red: 0 },
      kd: live ? m.combatants.map((c) => [c.kills, c.deaths] as [number, number]) : [],
      pk: live ? m.pickups.filter((p) => p.alive && p.kind !== 'bandage').map((p) => [p.id, p.kind, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)] as [number, PickupKind, number, number, number]) : [],
      gone: live ? this.goneBandages(m) : [],
    };
  }

  private goneBandages(m: Match): number[] {
    const have = new Set(m.pickups.filter((p) => p.alive && p.kind === 'bandage').map((p) => p.id));
    const out: number[] = [];
    for (let i = 0; i < m.bandageCount; i++) if (!have.has(i)) out.push(i);
    return out;
  }

  private sendRoster(to?: string): void {
    this.tr.send({ t: 'roster', host: this.self, since: this.since, slots: this.slots, names: this.names, mid: this.mid }, to);
  }

  /** Host: give a newcomer a slot and the running match. */
  private admit(id: string): void {
    if (this.slots.includes(id)) return;
    const s = assignSlot(this.slots);
    if (s < 0) { this.tr.send({ t: 'full' }, id); return; }
    this.slots[s] = id;
    this.names[id] = this.peers.get(id)?.name ?? 'Oyuncu';
    this.sendRoster();
    this.applyRoster();
    this.tr.send({ t: 'start', ...this.startInfo(s, Math.floor(Math.random() * 1e9), false) }, id);
  }

  private peerLeft(id: string): void {
    this.peers.delete(id);
    const wasHost = id === this.hostId;
    const s = this.slots.indexOf(id);
    if (s >= 0) this.slots[s] = null;
    delete this.names[id];
    if (wasHost) {
      // the oldest remaining device takes over the room
      let best = this.self, bestSince = this.since;
      for (const [pid, p] of this.peers) if (p.since < bestSince || (p.since === bestSince && pid < best)) { best = pid; bestSince = p.since; }
      if (best === this.self) this.becomeHost(false);
      else this.hostId = best;
    } else if (this.isHost()) {
      this.sendRoster();
    }
    this.applyRoster();
  }

  /** A is older than B (ties: smaller id). */
  private static older(aSince: number, aId: string, bSince: number, bId: string): boolean {
    return aSince < bSince || (aSince === bSince && aId < bId);
  }

  private onMsg(msg: Msg, from: string): void {
    if (this.closed) return;
    switch (msg.t) {
      case 'hi': {
        this.peers.set(from, { name: String(msg.name ?? 'Oyuncu').slice(0, 16), since: Number(msg.since) || Date.now() });
        if (this.isHost()) this.admit(from);
        return;
      }
      case 'roster': {
        const since = Number(msg.since);
        if (this.isHost() && from !== this.self) {
          // two rooms opened at once: the older host keeps it, the other joins as a guest
          if (Online.older(this.since, this.self, since, from)) { this.sendRoster(from); return; }
          this.hostId = from;
          this.mySlot = -1;
          this.slots = Array(SLOTS).fill(null);
          this.tr.send({ t: 'hi', name: this.name, since: this.since, host: from }, from);
          return;
        }
        if (this.hostId && this.hostId !== from && this.peers.has(this.hostId)) {
          const cur = this.peers.get(this.hostId)!;
          if (Online.older(cur.since, this.hostId, since, from)) return;
        }
        if (this.discoverTimer) { clearTimeout(this.discoverTimer); this.discoverTimer = null; }
        this.hostId = from;
        this.slots = (msg.slots as (string | null)[]).slice(0, SLOTS);
        this.names = { ...(msg.names as Record<string, string>) };
        // the host forgot us (it restarted): say hello again
        if (this.mySlot >= 0 && this.slots[this.mySlot] !== this.self && !this.slots.includes(this.self)) {
          this.mySlot = -1;
          this.tr.send({ t: 'hi', name: this.name, since: this.since, host: from }, from);
        }
        this.applyRoster();
        return;
      }
      case 'full':
        if (from === this.hostId || !this.hostId) this.hooks.full();
        return;
      case 'start': {
        if (from !== this.hostId) return;
        const info = msg as unknown as StartInfo;
        this.mid = info.mid;
        this.mySlot = info.slot;
        this.slots[info.slot] = this.self;
        this.hooks.start(info);
        return;
      }
    }
    const m = this.match;
    if (!m || msg.mid !== this.mid) return;
    switch (msg.t) {
      case 'st': this.onState(msg, from, m); break;
      case 'dmg': {
        const v = m.combatants[msg.v as number], a = m.combatants[msg.a as number];
        if (v && a && this.owns(v)) m.applyDamage(v, a, Number(msg.n), !!msg.h, defById(String(msg.w)));
        break;
      }
      case 'kill': {
        const v = m.combatants[msg.v as number], k = m.combatants[msg.k as number];
        if (v && k && !this.owns(v) && v.alive) m.registerKill(v, k, defById(String(msg.w)), !!msg.h);
        break;
      }
      case 'gr': {
        const o = m.combatants[msg.o as number];
        if (o && !this.owns(o)) m.remoteGrenade(o, toVec(msg.p), toVec(msg.v));
        break;
      }
      case 'kn': {
        const o = m.combatants[msg.o as number];
        if (o && !this.owns(o)) m.remoteKnife(o, toVec(msg.p), toVec(msg.v));
        break;
      }
      case 'ml': {
        const o = m.combatants[msg.o as number];
        if (o && !this.owns(o)) m.events.melee?.(o, null, false);
        break;
      }
      case 'pk+': {
        if (m.pickups.some((p) => p.id === msg.id)) break;
        m.spawnPickup(msg.k as PickupKind, toVec(msg.p), msg.id as number, true);
        break;
      }
      case 'pk-': m.pickupTaken(msg.id as number, (msg.c as number) >= 0 ? m.combatants[msg.c as number] ?? null : null); break;
      case 'end': {
        if (from !== this.hostId) break;
        const sc = msg.sc as Record<Team, number>;
        m.score.blue = sc.blue; m.score.red = sc.red;
        m.finish(msg.w as Team | 'draw');
        break;
      }
    }
  }

  private onState(msg: Msg, from: string, m: Match): void {
    if (from === this.hostId) {
      if (typeof msg.time === 'number' && Math.abs(m.time - msg.time) > 0.5) m.time = msg.time;
      const sc = msg.sc as Record<Team, number> | undefined;
      // kills reach each device a moment apart: never count backwards
      if (sc) { m.score.blue = Math.max(m.score.blue, sc.blue); m.score.red = Math.max(m.score.red, sc.red); }
    }
    for (const row of msg.c as number[][]) {
      const c = m.combatants[row[0]];
      if (!c || this.owns(c)) continue;
      // only the device that runs this fighter may move it
      if ((this.slots[c.id] ?? this.hostId) !== from) continue;
      unpack(c, row as unknown as Packed, this.targets);
    }
  }
}

type Packed = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, string, number];

const F_ALIVE = 1, F_CROUCH = 2, F_TRIGGER = 4, F_AIM = 8, F_BANDAGE = 16, F_SPRINT = 32, F_GROUND = 64, F_KNIFE = 128;

function pack(c: Combatant): Packed {
  const f = (c.alive ? F_ALIVE : 0) | (c.crouch ? F_CROUCH : 0) | (c.trigger ? F_TRIGGER : 0) | (c.aiming ? F_AIM : 0)
    | (c.bandageT > 0 ? F_BANDAGE : 0) | (c.sprinting ? F_SPRINT : 0) | (c.onGround ? F_GROUND : 0) | (c.hasKnife ? F_KNIFE : 0);
  return [c.id, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z), r3(c.yaw), r3(c.pitch), r2(c.vx), r2(c.vz), Math.ceil(c.hp), c.maxHp, f, r2(c.shieldT),
    r2(c.aimOrigin.x), r2(c.aimOrigin.y), r2(c.aimOrigin.z), r3(c.aimDir.x), r3(c.aimDir.y), r3(c.aimDir.z), c.kills, c.deaths, c.weapon.def.id, c.bandages];
}

function unpack(c: Combatant, r: Packed, targets: Map<Combatant, THREE.Vector3>): void {
  const f = r[10];
  const alive = !!(f & F_ALIVE);
  let t = targets.get(c);
  if (!t) { t = new THREE.Vector3(); targets.set(c, t); }
  t.set(r[1], r[2], r[3]);
  // came back to life, or far off: jump there instead of sliding across the map
  const revived = alive && !c.alive;
  if (revived || c.pos.distanceToSquared(t) > 36) c.pos.copy(t);
  if (revived) {
    c.alive = true;
    c.view?.revive();
  }
  c.yaw = r[4]; c.pitch = r[5]; c.vx = r[6]; c.vz = r[7];
  // a death arrives as a 'kill' message (with the killer); hp alone never kills here
  if (c.alive) c.hp = Math.max(1, r[8]);
  c.maxHp = r[9];
  c.crouch = !!(f & F_CROUCH);
  c.trigger = c.alive && !!(f & F_TRIGGER);
  c.aiming = !!(f & F_AIM);
  c.bandageT = f & F_BANDAGE ? 1 : 0;
  c.sprinting = !!(f & F_SPRINT);
  c.onGround = !!(f & F_GROUND);
  c.hasKnife = !!(f & F_KNIFE);
  c.shieldT = r[11];
  c.aimOrigin.set(r[12], r[13], r[14]);
  c.aimDir.set(r[15], r[16], r[17]);
  c.kills = r[18]; c.deaths = r[19];
  if (c.weapon.def.id !== r[20]) c.setWeapon(defById(r[20]));
  c.bandages = r[21];
}

function vec(v: THREE.Vector3): number[] { return [r2(v.x), r2(v.y), r2(v.z)]; }
function toVec(a: unknown): THREE.Vector3 {
  const v = a as number[];
  return new THREE.Vector3(v[0], v[1], v[2]);
}
