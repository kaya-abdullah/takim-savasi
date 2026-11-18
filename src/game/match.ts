import * as THREE from 'three';
import { GRENADE, GRENADE_FUSE, GRENADE_RADIUS, KNIFE, SHOP_WEAPONS, START_GRENADES, STARTER, getWeapon, type WeaponDef } from '../data/weapons';
import type { Team } from '../render/character';
import { CollisionWorld, WORLD_FLOOR, rayCharacter } from '../world/collision';
import type { MapData, V2 } from '../world/map';
import { NavWorld } from '../world/navworld';
import type { Difficulty } from '../core/save';
import { HEAVY_CD, JET_BOMB, TANK_HIT, TANK_SHELL, VEHICLE_DEFS, type VehicleKind } from '../data/vehicles';
import { BotBrain, DIFFICULTY } from './bot';
import { BODY_R, Combatant, HEAD_R, MAX_HP } from './combatant';
import { Vehicle, type DriveInput } from './vehicle';

export const TEAM_SIZE = 10;
export const KILL_LIMIT = 60;
export const MATCH_TIME = 300;
export const RESPAWN_TIME = 3;
export const SHIELD_TIME = 2;

const BLUE_NAMES = ['Kartal', 'Aslan', 'Pars', 'Doğan', 'Yıldız', 'Bora', 'Tuna', 'Efe', 'Atlas'];
const RED_NAMES = ['Kurt', 'Kobra', 'Akrep', 'Kara', 'Fırtına', 'Yılan', 'Çakal', 'Duman', 'Kaya', 'Volkan'];

export interface Projectile {
  owner: Combatant;
  def: WeaponDef;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  alive: boolean;
}

export interface Grenade {
  owner: Combatant;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  alive: boolean;
  resting: boolean;
}

export type PickupKind = 'health' | 'damage' | 'speed' | 'airdrop';
export interface Pickup {
  kind: PickupKind;
  pos: THREE.Vector3;
  alive: boolean;
  falling: boolean;
  age: number;
}
export const BUFF_TIME = 10;
export const AIRDROP_WEAPONS = ['minigun', 'rocket', 'plasma', 'sniper', 'lmg'];
const PICKUP_EVERY = 12;
const AIRDROP_FIRST = 35;
const AIRDROP_EVERY = 55;
const AIRDROP_FALL = 5; // m/s under the parachute

/** A weapon lying on the ground after its owner fell. */
export interface Drop {
  def: WeaponDef;
  pos: THREE.Vector3;
  age: number;
  alive: boolean;
}
export const DROP_LIFETIME = 25;

export const GRAVITY = 18;
const REGEN_DELAY = 4;
const REGEN_RATE = 15;
const _gn = new THREE.Vector3();

/** One physics step for a grenade: gravity, bounce off boxes/ground, roll friction. */
export function stepGrenade(world: CollisionWorld, g: { pos: THREE.Vector3; vel: THREE.Vector3; resting: boolean }, dt: number): boolean {
  if (g.resting) return false;
  g.vel.y -= GRAVITY * dt;
  const sx = g.vel.x * dt, sy = g.vel.y * dt, sz = g.vel.z * dt;
  const h = world.raycast(g.pos.x, g.pos.y, g.pos.z, sx, sy, sz, 1);
  if (!h) {
    g.pos.x += sx; g.pos.y += sy; g.pos.z += sz;
    return false;
  }
  g.pos.x += sx * h.t; g.pos.y += sy * h.t; g.pos.z += sz * h.t;
  _gn.set(h.nx, h.ny, h.nz);
  const vn = g.vel.dot(_gn);
  g.vel.addScaledVector(_gn, -2 * vn).multiplyScalar(0.45);
  g.pos.addScaledVector(_gn, 0.05);
  if (h.ny > 0.5) {
    g.vel.x *= 0.7; g.vel.z *= 0.7;
    if (g.vel.lengthSq() < 0.6) { g.vel.set(0, 0, 0); g.resting = true; }
  }
  return Math.abs(vn) > 2; // audible bounce
}

export interface HitInfo {
  point: THREE.Vector3;
  normal: THREE.Vector3 | null;
  victim: Combatant | null;
  head: boolean;
  dist: number;
  /** Vehicle body that took the hit (driven or parked). */
  vehicle?: Vehicle | null;
}

export type SpawnVehicleResult = 'ok' | 'cooldown' | 'blocked' | 'busy' | 'dead';

export interface KillEntry {
  killer: Combatant;
  victim: Combatant;
  weapon: WeaponDef;
  head: boolean;
  t: number;
}

export interface MatchEvents {
  grenadeThrown?(g: Grenade): void;
  pickupSpawned?(p: Pickup): void;
  pickedUp?(c: Combatant, p: Pickup, weapon?: WeaponDef): void;
  dropSpawned?(d: Drop): void;
  /** Player walked over a dropped weapon; the app decides how it joins the inventory. */
  weaponFound?(c: Combatant, d: Drop): void;
  grenadeBounce?(g: Grenade): void;
  melee?(c: Combatant, victim: Combatant | null, backstab: boolean): void;
  shot?(c: Combatant, hit: HitInfo, def: WeaponDef): void;
  projectileFired?(p: Projectile): void;
  explosion?(pos: THREE.Vector3, radius: number, owner: Combatant): void;
  damage?(victim: Combatant, attacker: Combatant, amount: number, head: boolean): void;
  kill?(e: KillEntry): void;
  respawn?(c: Combatant): void;
  end?(winner: Team | 'draw'): void;
  vehicleSpawned?(v: Vehicle): void;
  vehicleDamaged?(v: Vehicle, attacker: Combatant, amount: number): void;
  vehicleDestroyed?(v: Vehicle, attacker: Combatant): void;
  vehicleCrash?(v: Vehicle, impact: number): void;
  runOver?(v: Vehicle, victim: Combatant): void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Match {
  readonly combatants: Combatant[] = [];
  readonly player: Combatant;
  readonly score: Record<Team, number> = { blue: 0, red: 0 };
  time = 0;
  over = false;
  winner: Team | 'draw' | null = null;
  readonly projectiles: Projectile[] = [];
  readonly grenades: Grenade[] = [];
  readonly pickups: Pickup[] = [];
  readonly drops: Drop[] = [];
  readonly vehicles: Vehicle[] = [];
  /** Seconds until each vehicle kind may be called again. */
  readonly vehicleCd: Record<VehicleKind, number> = { tank: 0, jet: 0 };
  /** Driver input for each driven vehicle, set by the controller every frame. */
  readonly driveInput = new Map<Vehicle, DriveInput>();
  readonly difficulty: Difficulty;
  private pickupT = 6;
  private airdropT = AIRDROP_FIRST;
  readonly killFeed: KillEntry[] = [];
  readonly brains = new Map<Combatant, BotBrain>();
  private rand: () => number;

  constructor(
    readonly map: MapData,
    readonly world: CollisionWorld,
    readonly nav: NavWorld,
    playerWeapon: string,
    public events: MatchEvents = {},
    opts: { killLimit?: number; duration?: number; seed?: number; playerName?: string; playerGrenades?: number; playerHp?: number; difficulty?: Difficulty } = {},
  ) {
    this.difficulty = opts.difficulty ?? 'hard';
    this.killLimit = opts.killLimit ?? KILL_LIMIT;
    this.duration = opts.duration ?? MATCH_TIME;
    let s = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    let id = 0;
    this.player = new Combatant(id++, opts.playerName ?? 'MUSTAFA', 'blue', true, getWeapon(playerWeapon));
    this.player.maxGrenades = opts.playerGrenades ?? START_GRENADES;
    this.player.maxHp = this.player.hp = opts.playerHp ?? MAX_HP;
    this.combatants.push(this.player);
    for (const n of BLUE_NAMES.slice(0, TEAM_SIZE - 1)) this.addBot(id++, n, 'blue');
    for (const n of RED_NAMES.slice(0, TEAM_SIZE)) this.addBot(id++, n, 'red');
    const used = new Set<number>();
    for (const c of this.combatants) {
      const list = this.spawnList(c.team);
      let i = 0;
      while (used.has((c.team === 'blue' ? 0 : 100) + i)) i++;
      used.add((c.team === 'blue' ? 0 : 100) + i);
      const p = list[i % list.length];
      this.placeAt(c, p);
      c.shieldT = SHIELD_TIME;
      c.grenades = c.maxGrenades;
    }
  }

  readonly killLimit: number;
  readonly duration: number;

  private addBot(id: number, name: string, team: Team): void {
    // Bots carry a mix of weapons; a third use the starter pistol.
    const pool = [STARTER, ...SHOP_WEAPONS.filter((w) => w.id !== 'rocket' && w.id !== 'minigun'), STARTER];
    const def = pool[Math.floor(this.randomish(id) * pool.length)];
    const c = new Combatant(id, name, team, false, def);
    c.maxGrenades = 2;
    // every bot (both teams) gets the difficulty's toughness, so the teams stay fair
    const d = DIFFICULTY[this.difficulty];
    c.maxHp = c.hp = d.hp;
    this.combatants.push(c);
    this.brains.set(c, new BotBrain(Math.min(1, 0.55 + this.randomish(id * 7 + 3) * 0.4 + d.skill), d));
  }

  private randomish(n: number): number {
    const x = Math.sin(n * 12.9898 + (this.rand ? this.rand() * 100 : 0)) * 43758.5453;
    return x - Math.floor(x);
  }

  random(): number {
    return this.rand();
  }

  spawnList(team: Team): V2[] {
    return team === 'blue' ? this.map.spawns.blue : this.map.spawns.red;
  }

  enemiesOf(c: Combatant): Combatant[] {
    return this.combatants.filter((o) => o.team !== c.team);
  }

  private placeAt(c: Combatant, p: V2): void {
    c.pos.set(p.x, 0, p.z);
    c.yaw = c.team === 'blue' ? Math.PI / 2 : -Math.PI / 2; // face the enemy base
    c.pitch = 0;
    c.vx = c.vz = c.velY = 0;
    c.onGround = true;
    c.crouch = false;
    c.crouchK = 0;
  }

  private respawn(c: Combatant): void {
    const list = this.spawnList(c.team);
    const enemies = this.combatants.filter((o) => o.alive && o.team !== c.team);
    let best = list[0], bestScore = -Infinity;
    for (const p of list) {
      let minD = 999;
      for (const e of enemies) minD = Math.min(minD, Math.hypot(e.pos.x - p.x, e.pos.z - p.z));
      const crowd = this.combatants.some((o) => o !== c && o.alive && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 1.2);
      const score = minD + this.rand() * 10 - (crowd ? 100 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    this.placeAt(c, best);
    c.hp = c.maxHp;
    c.alive = true;
    c.grenades = c.maxGrenades;
    c.streak = 0;
    c.shieldT = SHIELD_TIME;
    c.lastAttacker = null;
    c.weapon.refill();
    c.view?.revive();
    this.brains.get(c)?.reset();
    this.events.respawn?.(c);
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.updateVehicles(dt);
    for (const c of this.combatants) {
      if (!c.alive) {
        c.respawnT -= dt;
        if (c.respawnT <= 0) this.respawn(c);
        continue;
      }
      const ck = c.crouch && !c.vehicle ? 1 : 0;
      c.crouchK += (ck - c.crouchK) * Math.min(1, dt * 10);
      if (c.shieldT > 0) c.shieldT -= dt;
      c.kick = Math.max(0, c.kick - dt * 8);
      if (c.meleeCd > 0) c.meleeCd -= dt;
      if (c.dmgBuffT > 0) c.dmgBuffT -= dt;
      if (c.speedBuffT > 0) c.speedBuffT -= dt;
      if (c.hp < c.maxHp && this.time - c.lastHurtT > REGEN_DELAY) c.hp = Math.min(c.maxHp, c.hp + REGEN_RATE * dt);
      const brain = this.brains.get(c);
      if (brain) brain.update(dt, c, this);
      // the vehicle's gun replaces the hand weapon while driving or flying
      const ws = c.vehicle?.gun ?? c.weapon;
      const shots = ws.update(dt, c.trigger);
      for (let i = 0; i < shots; i++) this.fire(c, ws.def);
    }
    this.updateProjectiles(dt);
    this.updateGrenades(dt);
    this.updatePickups(dt);
    this.updateDrops(dt);
    if (this.score.blue >= this.killLimit || this.score.red >= this.killLimit || this.time >= this.duration) this.finish();
  }

  private finish(): void {
    this.over = true;
    this.winner = this.score.blue > this.score.red ? 'blue' : this.score.red > this.score.blue ? 'red' : 'draw';
    this.events.end?.(this.winner);
  }

  /** Fires one shot (all pellets) along c.aimDir from c.aimOrigin. */
  fire(c: Combatant, def: WeaponDef = c.weapon.def): void {
    c.lastShotT = this.time;
    c.shieldT = 0; // shooting ends spawn protection
    c.kick = 1;
    const moving = Math.hypot(c.vx, c.vz) > 1;
    const spread = def.spread * (c.aiming ? 0.45 : 1) * (moving ? 1.35 : 1) * (c.onGround || c.vehicle ? 1 : 1.6) * (1 - 0.35 * c.crouchK) + c.inaccuracy;
    _d.copy(c.aimDir).normalize();
    // build a basis around the aim direction for the spread cone
    _right.set(0, 1, 0).cross(_d);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.copy(_d).cross(_right).normalize();
    for (let p = 0; p < def.pellets; p++) {
      const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * spread;
      const dir = _v.copy(_d).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
      if (def.projectile) {
        this.launch(c, def, c.aimOrigin, dir);
      } else {
        const hit = this.hitscan(c, c.aimOrigin, dir, def.range * 3);
        const falloff = hit.dist <= def.range ? 1 : Math.max(0.35, 1 - (hit.dist - def.range) / (def.range * 1.5));
        if (hit.vehicle) this.damageVehicle(hit.vehicle, c, def.damage * falloff);
        else if (hit.victim) {
          const headMul = def.id === 'sniper' ? 2.2 : 1.6;
          this.damage(hit.victim, c, def.damage * falloff * (hit.head ? headMul : 1), hit.head, def);
        }
        this.events.shot?.(c, hit, def);
      }
    }
  }

  /** Launches a projectile weapon shot. */
  launch(c: Combatant, def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3): Projectile {
    const pr: Projectile = {
      owner: c, def, pos: origin.clone(), vel: dir.clone().normalize().multiplyScalar(def.projectile!.speed), life: 4, alive: true,
    };
    this.projectiles.push(pr);
    this.events.projectileFired?.(pr);
    return pr;
  }

  /** Nearest fighter or vehicle along the ray (radius grows the targets for fat projectiles). */
  private traceTargets(c: Combatant, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, bestT: number, radius = 0):
  { t: number; victim: Combatant | null; head: boolean; vehicle: Vehicle | null } {
    let victim: Combatant | null = null, head = false, vehicle: Vehicle | null = null;
    for (const e of this.combatants) {
      if (!e.alive || e.team === c.team || e.vehicle) continue;
      const h = rayCharacter(ox, oy, oz, dx, dy, dz, bestT, e.pos.x, e.pos.y, e.pos.z, BODY_R + radius, e.bodyH(), e.headY(), HEAD_R + radius);
      if (h && h.t < bestT) { bestT = h.t; victim = e; head = h.head; }
    }
    // vehicles stop bullets; only the enemy's ones take damage
    for (const v of this.vehicles) {
      if (!v.alive || v === c.vehicle) continue;
      const t = v.rayHit(ox, oy, oz, dx, dy, dz, bestT);
      if (t !== null && t < bestT) {
        bestT = t;
        head = false;
        const enemy = v.owner.team !== c.team;
        victim = enemy && v.driver ? v.driver : null;
        vehicle = enemy ? v : null;
        if (!enemy) { victim = null; vehicle = null; }
      }
    }
    return { t: bestT, victim, head, vehicle };
  }

  hitscan(c: Combatant, o: THREE.Vector3, dir: THREE.Vector3, maxDist: number): HitInfo {
    const wh = this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, maxDist);
    const r = this.traceTargets(c, o.x, o.y, o.z, dir.x, dir.y, dir.z, wh ? wh.t : maxDist);
    const point = o.clone().addScaledVector(dir, r.t);
    const blocked = r.victim || r.vehicle || (wh ? r.t < wh.t - 1e-6 : r.t < maxDist - 1e-6);
    const normal = blocked ? null : wh ? new THREE.Vector3(wh.nx, wh.ny, wh.nz) : null;
    return { point, normal, victim: r.victim, head: r.head, dist: r.t, vehicle: r.vehicle };
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      const spec = p.def.projectile!;
      p.vel.y -= spec.gravity * dt;
      const sx = p.vel.x * dt, sy = p.vel.y * dt, sz = p.vel.z * dt;
      const wh = this.world.raycast(p.pos.x, p.pos.y, p.pos.z, sx, sy, sz, 1);
      const tr = this.traceTargets(p.owner, p.pos.x, p.pos.y, p.pos.z, sx, sy, sz, wh ? wh.t : 1, spec.radius);
      const bestT = tr.t;
      const victim = tr.vehicle ? null : tr.victim, head = tr.head;
      const hitThing = tr.vehicle || victim || (wh && tr.t >= wh.t - 1e-6) || tr.t < 1 - 1e-6;
      if (hitThing || p.life <= 0) {
        p.pos.x += sx * bestT; p.pos.y += sy * bestT; p.pos.z += sz * bestT;
        p.alive = false;
        if (spec.splash > 0) {
          if (wh && !victim && !tr.vehicle) p.pos.add(_v.set(wh.nx, wh.ny, wh.nz).multiplyScalar(0.3));
          if (tr.vehicle) this.damageVehicle(tr.vehicle, p.owner, p.def.damage);
          this.explode(p, victim);
        } else {
          if (tr.vehicle) this.damageVehicle(tr.vehicle, p.owner, p.def.damage);
          else if (victim) this.damage(victim, p.owner, p.def.damage * (head ? 1.6 : 1), head, p.def);
          this.events.shot?.(p.owner, {
            point: p.pos.clone(), normal: wh && !victim && !tr.vehicle ? new THREE.Vector3(wh.nx, wh.ny, wh.nz) : null, victim: tr.victim, head, dist: 0, vehicle: tr.vehicle,
          }, p.def);
        }
      } else {
        p.pos.x += sx; p.pos.y += sy; p.pos.z += sz;
      }
    }
    // compact
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i].alive) this.projectiles.splice(i, 1);
  }

  private explode(p: Projectile, direct: Combatant | null): void {
    this.blast(p.pos, p.owner, p.def, p.def.projectile!.splash, direct);
  }

  /** Splash damage to enemies with line of sight to the blast centre. */
  blast(pos: THREE.Vector3, owner: Combatant, def: WeaponDef, radius: number, direct: Combatant | null = null): void {
    this.events.explosion?.(pos.clone(), radius, owner);
    for (const v of this.vehicles) {
      if (!v.alive || v.owner.team === owner.team) continue;
      const c = v.center(_v2);
      const d = c.distanceTo(pos);
      if (d > radius + 1.5) continue;
      this.damageVehicle(v, owner, def.damage * (0.35 + 0.65 * Math.max(0, 1 - d / (radius + 1.5))));
    }
    for (const e of this.combatants) {
      if (!e.alive || e.team === owner.team || e.vehicle) continue;
      const cx = e.pos.x, cy = e.pos.y + 1 - 0.3 * e.crouchK, cz = e.pos.z;
      const d = Math.hypot(cx - pos.x, cy - pos.y, cz - pos.z);
      if (e === direct) { this.damage(e, owner, def.damage, false, def); continue; }
      if (d > radius) continue;
      if (!this.world.segmentClear(pos.x, pos.y + 0.2, pos.z, cx, cy, cz)) continue;
      const k = 1 - d / radius;
      this.damage(e, owner, def.damage * (0.25 + 0.75 * k), false, def);
    }
  }

  /** Throws a grenade along c.aimDir (lifted a little). Returns false if none left. */
  throwGrenade(c: Combatant, speed: number): boolean {
    if (!c.alive || c.grenades <= 0 || this.over) return false;
    c.grenades--;
    c.shieldT = 0;
    const g: Grenade = {
      owner: c,
      pos: new THREE.Vector3(c.pos.x + Math.sin(c.yaw) * 0.4, c.pos.y + 1.55, c.pos.z + Math.cos(c.yaw) * 0.4),
      vel: c.aimDir.clone().normalize().multiplyScalar(speed),
      fuse: GRENADE_FUSE,
      alive: true,
      resting: false,
    };
    // start outside walls if the player hugs one
    if (this.world.blocked(g.pos.x, g.pos.z, 0.05, g.pos.y - 0.1, 0.2)) g.pos.set(c.pos.x, c.pos.y + 1.55, c.pos.z);
    g.vel.x += c.vx * 0.5;
    g.vel.z += c.vz * 0.5;
    this.grenades.push(g);
    this.events.grenadeThrown?.(g);
    return true;
  }

  private updateGrenades(dt: number): void {
    for (const g of this.grenades) {
      if (!g.alive) continue;
      g.fuse -= dt;
      // two sub-steps keep fast throws from tunnelling through thin props
      for (let i = 0; i < 2; i++) if (stepGrenade(this.world, g, dt / 2)) this.events.grenadeBounce?.(g);
      if (g.fuse <= 0) {
        g.alive = false;
        this.blast(g.pos, g.owner, GRENADE, GRENADE_RADIUS);
      }
    }
    for (let i = this.grenades.length - 1; i >= 0; i--) if (!this.grenades[i].alive) this.grenades.splice(i, 1);
  }

  private freePoi(minDist: number): THREE.Vector3 | null {
    const pois = this.map.pois;
    for (let tries = 0; tries < 12; tries++) {
      const p = pois[Math.floor(this.rand() * pois.length)];
      if (this.pickups.some((q) => q.alive && Math.hypot(q.pos.x - p.x, q.pos.z - p.z) < minDist)) continue;
      return new THREE.Vector3(p.x, 0, p.z);
    }
    return null;
  }

  spawnPickup(kind: PickupKind, at?: THREE.Vector3): Pickup | null {
    const pos = at ?? this.freePoi(kind === 'airdrop' ? 6 : 10);
    if (!pos) return null;
    const p: Pickup = { kind, pos, alive: true, falling: kind === 'airdrop', age: 0 };
    if (p.falling) p.pos.y = 45;
    this.pickups.push(p);
    this.events.pickupSpawned?.(p);
    return p;
  }

  private updatePickups(dt: number): void {
    this.pickupT -= dt;
    if (this.pickupT <= 0) {
      this.pickupT = PICKUP_EVERY;
      if (this.pickups.filter((p) => p.alive && p.kind !== 'airdrop').length < 3) {
        const kinds: PickupKind[] = ['health', 'damage', 'speed'];
        this.spawnPickup(kinds[Math.floor(this.rand() * 3)]);
      }
    }
    this.airdropT -= dt;
    if (this.airdropT <= 0) {
      this.airdropT = AIRDROP_EVERY;
      this.spawnPickup('airdrop');
    }
    for (const p of this.pickups) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.falling) {
        p.pos.y -= AIRDROP_FALL * dt;
        if (p.pos.y <= 0) { p.pos.y = 0; p.falling = false; }
        continue;
      }
      if (p.kind !== 'airdrop' && p.age > 40) { p.alive = false; continue; }
      for (const c of this.combatants) {
        if (!c.alive || c.vehicle || Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) > 1.4 || Math.abs(c.pos.y - p.pos.y) > 1.5) continue;
        if (p.kind === 'health' && c.hp >= c.maxHp) continue;
        this.collect(c, p);
        break;
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) if (!this.pickups[i].alive) this.pickups.splice(i, 1);
  }

  private collect(c: Combatant, p: Pickup): void {
    p.alive = false;
    let weapon: WeaponDef | undefined;
    if (p.kind === 'health') c.hp = c.maxHp;
    else if (p.kind === 'damage') c.dmgBuffT = BUFF_TIME;
    else if (p.kind === 'speed') c.speedBuffT = BUFF_TIME;
    else {
      weapon = getWeapon(AIRDROP_WEAPONS[Math.floor(this.rand() * AIRDROP_WEAPONS.length)]);
      // the player's weapon swap is handled by the controller (keeps per-weapon ammo)
      if (!c.isPlayer) c.setWeapon(weapon);
      c.grenades = Math.max(c.grenades, c.maxGrenades);
    }
    this.events.pickedUp?.(c, p, weapon);
  }

  private updateDrops(dt: number): void {
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.age += dt;
      if (d.age > DROP_LIFETIME) { d.alive = false; continue; }
      if (d.age < 0.6) continue; // let it land before anyone grabs it
      for (const c of this.combatants) {
        if (!c.alive || c.vehicle || Math.hypot(c.pos.x - d.pos.x, c.pos.z - d.pos.z) > 1.3 || Math.abs(c.pos.y - d.pos.y) > 1.5) continue;
        if (c.isPlayer) {
          d.alive = false;
          this.events.weaponFound?.(c, d);
          break;
        }
        // bots trade up to a better gun
        if (d.def.price > c.weapon.def.price) {
          d.alive = false;
          c.setWeapon(d.def);
          break;
        }
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) if (!this.drops[i].alive) this.drops.splice(i, 1);
  }

  /** Knife swing. Backstabs kill instantly. Returns the victim, if any. */
  melee(c: Combatant): Combatant | null {
    if (!c.alive || c.meleeCd > 0 || this.over) return null;
    c.meleeCd = 0.6;
    c.shieldT = 0;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    let best: Combatant | null = null, bestD = KNIFE.range;
    if (c.vehicle) return null;
    for (const e of this.combatants) {
      if (!e.alive || e.team === c.team || e.vehicle) continue;
      const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d > bestD || Math.abs(e.pos.y - c.pos.y) > 1.2) continue;
      if (d > 0.5 && (dx * fx + dz * fz) / d < 0.55) continue;
      best = e;
      bestD = d;
    }
    let backstab = false;
    if (best) {
      const dx = best.pos.x - c.pos.x, dz = best.pos.z - c.pos.z, d = Math.hypot(dx, dz) || 1;
      // victim facing away from the attacker
      backstab = (Math.sin(best.yaw) * dx + Math.cos(best.yaw) * dz) / d > 0.4;
      this.damage(best, c, backstab ? 999 : KNIFE.damage, false, KNIFE);
    }
    this.events.melee?.(c, best, backstab);
    return best;
  }

  damage(victim: Combatant, attacker: Combatant, amount: number, head: boolean, def: WeaponDef): void {
    if (!victim.alive || victim.shieldT > 0 || this.over) return;
    // a driver is protected by the vehicle body: the vehicle takes the hit
    if (victim.vehicle && def !== VEHICLE_EJECT) { this.damageVehicle(victim.vehicle, attacker, amount); return; }
    if (attacker.dmgBuffT > 0) amount *= 2;
    amount = Math.round(amount);
    victim.hp -= amount;
    victim.lastHurtT = this.time;
    victim.lastAttacker = attacker;
    victim.view?.hitFlash();
    this.events.damage?.(victim, attacker, amount, head);
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.trigger = false;
      victim.respawnT = RESPAWN_TIME + (victim.isPlayer ? 1 : 0);
      victim.deaths++;
      victim.streak = 0;
      // own goals (crashing your own vehicle) score nothing
      if (attacker.team !== victim.team) {
        attacker.kills++;
        attacker.streak++;
        this.score[attacker.team]++;
      }
      if (victim.vehicle) this.exitVehicle(victim);
      victim.crouch = false;
      victim.view?.die();
      // the fallen fighter's gun drops where they stood (onto the floor below them)
      const gy = this.world.groundHeight(victim.pos.x, victim.pos.z, 0.2, victim.pos.y + 0.3);
      const drop: Drop = { def: victim.weapon.def, pos: new THREE.Vector3(victim.pos.x, Math.max(gy, victim.pos.y - 50), victim.pos.z), age: 0, alive: true };
      this.drops.push(drop);
      if (this.drops.length > 24) this.drops.shift();
      this.events.dropSpawned?.(drop);
      const entry: KillEntry = { killer: attacker, victim, weapon: def, head, t: this.time };
      this.killFeed.push(entry);
      if (this.killFeed.length > 30) this.killFeed.shift();
      this.events.kill?.(entry);
    }
  }

  /** Line of sight between two combatants' eyes/chests. */
  canSee(a: Combatant, b: Combatant): boolean {
    const ey = a.pos.y + a.eyeY();
    if (b.vehicle) {
      const c = b.vehicle.center(_v2);
      return this.world.segmentClear(a.pos.x, ey, a.pos.z, c.x, c.y, c.z);
    }
    return this.world.segmentClear(a.pos.x, ey, a.pos.z, b.pos.x, b.pos.y + b.bodyH() - 0.15, b.pos.z)
      || this.world.segmentClear(a.pos.x, ey, a.pos.z, b.pos.x, b.pos.y + b.headY(), b.pos.z);
  }

  /** Moves a combatant horizontally with collision; handles gravity. */
  move(c: Combatant, dx: number, dz: number, dt: number): void {
    let nx = c.pos.x + dx, nz = c.pos.z + dz;
    // vehicles are solid for people on foot
    for (const v of this.vehicles) {
      if (!v.alive || Math.abs(v.pos.y - c.pos.y) > 2) continue;
      const out = v.contains(nx, nz, BODY_R);
      if (out) { nx = out[0]; nz = out[1]; }
    }
    const r = this.world.resolveCircle(nx, nz, BODY_R, c.pos.y, c.height());
    c.pos.x = r.x;
    c.pos.z = r.z;
    const g = this.world.groundHeight(c.pos.x, c.pos.z, BODY_R, c.pos.y);
    c.velY -= 18 * dt;
    c.pos.y += c.velY * dt;
    if (c.pos.y <= g) {
      c.pos.y = g;
      c.velY = 0;
      c.onGround = true;
    } else c.onGround = c.pos.y - g < 0.05;
    // safety net: never fall out of the world
    if (c.pos.y < WORLD_FLOOR) {
      const p = this.nav.street.nearestWalkable(c.pos.x, c.pos.z, 20) ?? this.spawnList(c.team)[0];
      c.pos.set(p.x, 0, p.z);
      c.velY = 0;
    }
  }

  // ------------------------------------------------------------------ vehicles
  vehicleOf(kind: VehicleKind, owner: Combatant): Vehicle | undefined {
    return this.vehicles.find((v) => v.kind === kind && v.owner === owner && v.alive);
  }

  /**
   * Calls the owner's vehicle next to them (or moves the existing one there).
   * Needs open sky: not inside a building or the tunnel.
   */
  spawnVehicle(kind: VehicleKind, owner: Combatant): SpawnVehicleResult {
    if (!owner.alive || this.over) return 'dead';
    if (this.vehicleCd[kind] > 0) return 'cooldown';
    let v = this.vehicleOf(kind, owner);
    if (v && v.driver) return 'busy';
    if (owner.vehicle) return 'busy';
    const def = VEHICLE_DEFS[kind];
    const fx = Math.sin(owner.yaw), fz = Math.cos(owner.yaw);
    const y = owner.pos.y;
    let spot: { x: number; z: number } | null = null;
    for (const [dist, side] of [[4.5, 0], [4.5, 2.5], [4.5, -2.5], [6.5, 0], [-4.5, 0], [0, 4], [0, -4]] as [number, number][]) {
      const x = owner.pos.x + fx * dist - fz * side, z = owner.pos.z + fz * dist + fx * side;
      if (x < this.map.minX + def.radius || x > this.map.maxX - def.radius || z < this.map.minZ + def.radius || z > this.map.maxZ - def.radius) continue;
      if (this.world.blocked(x, z, def.radius + (kind === 'tank' ? 1.2 : 0.4), y, def.height)) continue;
      if (Math.abs(this.world.groundHeight(x, z, def.radius, y + 0.5, 1) - y) > 0.6) continue;
      // open sky above (no roof, no tunnel ceiling)
      if (!this.world.segmentClear(x, y + 0.5, z, x, y + 12, z)) continue;
      spot = { x, z };
      break;
    }
    if (!spot) return 'blocked';
    if (!v) {
      v = new Vehicle(kind, owner);
      this.vehicles.push(v);
    }
    v.pos.set(spot.x, y, spot.z);
    v.vel.set(0, 0, 0);
    v.speed = 0;
    v.yaw = owner.yaw;
    v.hp = Math.max(v.hp, v.maxHp * 0.5);
    this.vehicleCd[kind] = 6;
    this.events.vehicleSpawned?.(v);
    return 'ok';
  }

  /** Nearest vehicle the fighter could get into (own team, free, within reach). */
  nearbyVehicle(c: Combatant, reach = 4.5): Vehicle | null {
    let best: Vehicle | null = null, bd = reach;
    for (const v of this.vehicles) {
      if (!v.alive || v.driver || v.owner.team !== c.team) continue;
      const d = Math.hypot(v.pos.x - c.pos.x, v.pos.z - c.pos.z) - (v.kind === 'jet' ? 1.5 : 0.8);
      if (d < bd && Math.abs(v.pos.y - c.pos.y) < 2.5) { bd = d; best = v; }
    }
    return best;
  }

  enterVehicle(c: Combatant, v: Vehicle): boolean {
    if (!c.alive || !v.alive || v.driver || c.vehicle) return false;
    v.driver = c;
    c.vehicle = v;
    c.crouch = false;
    c.crouchK = 0;
    c.sprinting = false;
    c.aiming = false;
    c.shieldT = 0;
    c.pos.copy(v.pos);
    return true;
  }

  /** Puts the driver down beside the vehicle (or below it, if nothing else fits). */
  exitVehicle(c: Combatant): void {
    const v = c.vehicle;
    if (!v) return;
    v.driver = null;
    c.vehicle = null;
    this.driveInput.delete(v);
    const fx = v.forwardX(), fz = v.forwardZ();
    const side = v.kind === 'jet' ? 2.6 : 1.9;
    for (const [rx, fwd] of [[-side, 0], [side, 0], [0, -3.6], [0, 3.6], [-side, -2], [side, -2]]) {
      const x = v.pos.x - fz * rx + fx * fwd, z = v.pos.z + fx * rx + fz * fwd;
      if (this.world.blocked(x, z, BODY_R, v.pos.y, 1.8) || v.contains(x, z, BODY_R * 0.5)) continue;
      c.pos.set(x, v.pos.y + 0.1, z);
      c.velY = 0;
      return;
    }
    c.pos.set(v.pos.x, v.pos.y + (v.kind === 'jet' ? 2.7 : 1.6), v.pos.z);
  }

  damageVehicle(v: Vehicle, attacker: Combatant, amount: number): void {
    if (!v.alive || this.over) return;
    if (attacker.dmgBuffT > 0) amount *= 2;
    amount = Math.round(amount);
    v.hp -= amount;
    this.events.vehicleDamaged?.(v, attacker, amount);
    if (v.hp <= 0) this.destroyVehicle(v, attacker);
  }

  private destroyVehicle(v: Vehicle, attacker: Combatant): void {
    v.alive = false;
    v.hp = 0;
    this.vehicleCd[v.kind] = v.def.respawn;
    const driver = v.driver;
    this.events.vehicleDestroyed?.(v, attacker);
    // the blast skips the driver (still seated); the ejection damage below is theirs
    const at = v.center(new THREE.Vector3());
    this.blast(at, attacker, VEHICLE_EJECT, 5.5);
    if (driver) this.exitVehicle(driver);
    // the driver is thrown out and badly hurt
    if (driver && driver.alive) {
      driver.shieldT = 0;
      this.damage(driver, attacker, driver.maxHp * 0.45, false, VEHICLE_EJECT);
    }
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  /** Heavy weapon on the grenade button: tank shell or jet bomb. */
  heavyFire(c: Combatant): boolean {
    const v = c.vehicle;
    if (!v || v.rocketCd > 0 || !c.alive) return false;
    v.rocketCd = HEAVY_CD[v.kind];
    c.lastShotT = this.time;
    if (v.kind === 'tank') this.launch(c, TANK_SHELL, c.aimOrigin, c.aimDir);
    else {
      // the bomb leaves from under the belly and never flies upward
      _v.copy(c.aimDir); _v.y = Math.min(_v.y, -0.25);
      const b = this.launch(c, JET_BOMB, _v2.set(v.pos.x, v.pos.y + 0.4, v.pos.z), _v);
      // it keeps the jet's speed, so the jet never overtakes its own bomb
      b.vel.x += v.vel.x;
      b.vel.z += v.vel.z;
    }
    return true;
  }

  private updateVehicles(dt: number): void {
    for (const k of ['tank', 'jet'] as VehicleKind[]) this.vehicleCd[k] = Math.max(0, this.vehicleCd[k] - dt);
    for (const v of [...this.vehicles]) {
      const inp = v.driver ? this.driveInput.get(v) ?? null : null;
      const impact = v.step(this.world, inp, dt);
      if (impact > 4) this.events.vehicleCrash?.(v, impact);
      if (impact > 11 && this.time - v.lastImpact > 0.4) {
        v.lastImpact = this.time;
        this.damageVehicle(v, v.driver ?? v.owner, (impact - 11) * 14);
        if (!v.alive) continue;
      }
      const d = v.driver;
      if (d) {
        d.pos.copy(v.pos);
        d.vx = v.kind === 'tank' ? v.forwardX() * v.speed : v.vel.x;
        d.vz = v.kind === 'tank' ? v.forwardZ() * v.speed : v.vel.z;
        d.velY = 0;
        d.onGround = true;
      }
      // the tank runs people over
      if (v.kind === 'tank' && Math.abs(v.speed) > 4 && d) {
        for (const e of this.combatants) {
          if (!e.alive || e.vehicle || e.team === d.team || Math.abs(e.pos.y - v.pos.y) > 1.5) continue;
          if (!v.contains(e.pos.x, e.pos.z, BODY_R + 0.25)) continue;
          e.shieldT = 0;
          this.damage(e, d, TANK_HIT.damage, false, TANK_HIT);
          this.events.runOver?.(v, e);
        }
      }
    }
  }

  /** Separation from nearby teammates so bots don't stack. */
  separation(c: Combatant, out: { x: number; z: number }): void {
    out.x = out.z = 0;
    for (const o of this.combatants) {
      if (o === c || !o.alive) continue;
      const dx = c.pos.x - o.pos.x, dz = c.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.6 * 1.6 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        out.x += (dx / d) * (1.6 - d);
        out.z += (dz / d) * (1.6 - d);
      }
    }
  }

  playerRank(): number {
    const sorted = [...this.combatants].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    return sorted.indexOf(this.player) + 1;
  }
}

/** Damage source for wrecks exploding and drivers being thrown out. */
export const VEHICLE_EJECT: WeaponDef = { ...GRENADE, id: 'wreck', name: 'Araç Patlaması', damage: 160 };

export { CollisionWorld, NavWorld };
