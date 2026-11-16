import * as THREE from 'three';
import type { Difficulty } from '../core/save';
import { GRENADE_SPEED } from '../data/weapons';
import type { WayPoint } from '../world/navworld';
import type { P3 } from '../world/structures';
import type { Combatant } from './combatant';
import { GRAVITY } from './match';
import type { Match } from './match';

type State = 'roam' | 'fight' | 'chase';

const BOT_SPEED = 4.6;
const VIEW_DIST = 70;
const FOV_COS = Math.cos((62 * Math.PI) / 180);

/** How tough and sharp bots are. All bots (both teams) use the same level. */
export interface DiffSpec {
  hp: number;
  /** Added to each bot's base skill (0.55..0.95). */
  skill: number;
  /** Multiplies the reaction delay before the first shot. */
  react: number;
  /** Multiplies aim error. */
  aimErr: number;
  /** 0..1 chance to sidestep when hit, and how often they crouch to shoot. */
  dodge: number;
  /** Back off to recover when badly hurt. */
  retreat: boolean;
}

export const DIFFICULTY: Record<Difficulty, DiffSpec> = {
  normal: { hp: 100, skill: 0, react: 1, aimErr: 1, dodge: 0.15, retreat: false },
  hard: { hp: 170, skill: 0.08, react: 0.8, aimErr: 0.85, dodge: 0.6, retreat: true },
  extreme: { hp: 250, skill: 0.15, react: 0.65, aimErr: 0.72, dodge: 0.9, retreat: true },
};

const PREF_DIST: Record<string, number> = {
  pistol: 14, smg: 10, rifle: 22, shotgun: 6, sniper: 38, lmg: 20, burst: 24, revolver: 16, minigun: 14, rocket: 24, plasma: 18,
};

const _sep = { x: 0, z: 0 };
const _c = new THREE.Vector3();

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class BotBrain {
  state: State = 'roam';
  target: Combatant | null = null;
  private lastSeenT = -99;
  private lastKnown: P3 | null = null;
  path: WayPoint[] = [];
  pathIdx = 0;
  goal: P3 | null = null;
  private repathT = 0;
  private thinkT = Math.random() * 0.2;
  private reactT = 0;
  private strafe = 1;
  private strafeT = 0;
  private errYaw = 0;
  private errPitch = 0;
  private stuckT = 0;
  private lastPos = { x: 0, z: 0 };
  private desiredYaw = 0;
  private grenadeCd = 4 + Math.random() * 8;
  private crouchT = 0;
  private dodgeT = 0;
  private retreatT = 0;
  private lastHurtSeen = -99;

  constructor(readonly skill: number, readonly diff: DiffSpec = DIFFICULTY.normal) {}

  reset(): void {
    this.state = 'roam';
    this.target = null;
    this.path = [];
    this.goal = null;
    this.lastKnown = null;
    this.retreatT = this.dodgeT = this.crouchT = 0;
  }

  update(dt: number, c: Combatant, m: Match): void {
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.18 + Math.random() * 0.08;
      this.perceive(c, m);
    }
    this.reactT -= dt;
    this.repathT -= dt;
    this.grenadeCd -= dt;
    this.crouchT -= dt;
    this.dodgeT -= dt;
    this.retreatT -= dt;
    let mvx = 0, mvz = 0; // desired move direction (world, unnormalised)
    let speedMul = 1;
    c.trigger = false;
    c.aiming = false;
    const D = this.diff;

    const t = this.target;
    if (this.state === 'fight' && t && t.alive) {
      const dx = t.pos.x - c.pos.x, dz = t.pos.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      // aim error settles over time, faster for skilled bots
      const settle = Math.exp(-dt * (1.5 + this.skill * 2.5));
      const minErr = (0.012 + (1 - this.skill) * 0.03) * D.aimErr;
      this.errYaw = this.errYaw * settle + (Math.random() - 0.5) * minErr * (1 - settle) * 6;
      this.errPitch = this.errPitch * settle + (Math.random() - 0.5) * minErr * (1 - settle) * 4;
      const aimY = t.vehicle ? t.vehicle.center(_c).y : t.pos.y + 1.25 - 0.45 * t.crouchK;
      const chestY = aimY - c.pos.y - c.eyeY();
      this.desiredYaw = Math.atan2(dx, dz) + this.errYaw;
      const desiredPitch = Math.atan2(chestY, dist) + this.errPitch;
      const turn = 7 * dt;
      const dy = angleDiff(this.desiredYaw, c.yaw);
      c.yaw += THREE.MathUtils.clamp(dy, -turn, turn);
      c.pitch += THREE.MathUtils.clamp(desiredPitch - c.pitch, -turn, turn);
      const def = c.weapon.def;
      const pref = PREF_DIST[def.id] ?? 18;
      const visible = m.time - this.lastSeenT < 0.3;
      const aligned = Math.abs(dy) < 0.15;
      const inRange = Math.hypot(dist, aimY - c.pos.y) < def.range * 1.7;
      if (visible && aligned && inRange && this.reactT <= 0) {
        c.trigger = true;
        c.aiming = def.zoom < 0.6 && dist > 20;
      }
      const flying = t.vehicle?.kind === 'heli';
      // knife at point-blank range, grenades at mid range
      if (visible && dist < 2.0 && !t.vehicle) m.melee(c);
      else if (visible && !flying && this.reactT <= 0 && this.grenadeCd <= 0 && c.grenades > 0 && dist > 9 && dist < 24) {
        this.grenadeCd = 6 + Math.random() * 9;
        if (Math.random() < 0.35) this.throwAt(c, m, t.pos.x, t.pos.z, dist);
      }
      if (c.weapon.ammo === 0 || (!visible && c.weapon.ammo < c.weapon.def.mag * 0.4)) c.weapon.startReload();
      // ---- tactics: sidestep when hit, back off when nearly dead, crouch to shoot
      if (c.lastHurtT > this.lastHurtSeen) {
        this.lastHurtSeen = c.lastHurtT;
        if (Math.random() < D.dodge) {
          this.dodgeT = 0.6 + Math.random() * 0.5;
          this.strafe = -this.strafe;
          this.crouchT = 0;
        }
        if (D.retreat && c.hp < c.maxHp * 0.35 && this.retreatT < -4) this.retreatT = 2.2 + Math.random();
      }
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      c.crouch = false;
      if (this.retreatT > 0) {
        // fall back while still shooting; regeneration starts once out of fire
        mvx = -nx * 0.9 - nz * this.strafe * 0.6;
        mvz = -nz * 0.9 + nx * this.strafe * 0.6;
      } else if (dist > pref + 8 || !visible) {
        this.followPathTo(c, m, t.pos.x, t.pos.y, t.pos.z);
        const wp = this.path[this.pathIdx];
        if (wp) { mvx = wp.x - c.pos.x; mvz = wp.z - c.pos.z; }
      } else {
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafe = Math.random() < 0.5 ? -1 : 1;
          this.strafeT = 0.5 + Math.random() * 1.1;
          // sometimes settle into a crouch for a steadier, smaller stance
          if (dist > 7 && this.dodgeT <= 0 && Math.random() < D.dodge * 0.45) this.crouchT = 1.2 + Math.random() * 1.4;
        }
        mvx = -nz * this.strafe;
        mvz = nx * this.strafe;
        const approach = dist > pref ? 0.6 : dist < pref * 0.5 ? -0.6 : 0;
        mvx += nx * approach;
        mvz += nz * approach;
        speedMul = this.dodgeT > 0 ? 1.1 : 0.75;
        if (this.crouchT > 0 && visible) {
          c.crouch = true;
          speedMul = 0.3;
        }
      }
    } else if (this.state === 'chase' && this.lastKnown) {
      c.crouch = false;
      const lk = this.lastKnown;
      this.followPathTo(c, m, lk.x, lk.y, lk.z);
      const wp = this.path[this.pathIdx];
      if (wp) { mvx = wp.x - c.pos.x; mvz = wp.z - c.pos.z; }
      if ((Math.hypot(lk.x - c.pos.x, lk.z - c.pos.z) < 2 && Math.abs(lk.y - c.pos.y) < 2) || !wp) {
        this.state = 'roam';
        this.lastKnown = null;
      }
      if (mvx || mvz) this.desiredYaw = Math.atan2(mvx, mvz);
      this.turnTo(c, dt, 6);
      if (c.weapon.ammo < c.weapon.def.mag * 0.5) c.weapon.startReload();
    } else {
      this.state = 'roam';
      c.crouch = false;
      const g = this.goal;
      if (!g || (Math.hypot(g.x - c.pos.x, g.z - c.pos.z) < 2.5 && Math.abs(g.y - c.pos.y) < 2)) this.pickGoal(c, m);
      if (this.goal) {
        this.followPathTo(c, m, this.goal.x, this.goal.y, this.goal.z);
        const wp = this.path[this.pathIdx];
        if (wp) { mvx = wp.x - c.pos.x; mvz = wp.z - c.pos.z; }
        else this.goal = null;
      }
      if (mvx || mvz) this.desiredYaw = Math.atan2(mvx, mvz);
      this.turnTo(c, dt, 5);
      c.pitch *= 1 - Math.min(1, dt * 3);
      if (c.weapon.ammo < c.weapon.def.mag * 0.5) c.weapon.startReload();
    }

    // apply movement
    const l = Math.hypot(mvx, mvz);
    m.separation(c, _sep);
    let tx = 0, tz = 0;
    if (l > 0.01) { tx = mvx / l; tz = mvz / l; }
    tx += _sep.x * 0.8;
    tz += _sep.z * 0.8;
    const tl = Math.hypot(tx, tz);
    if (tl > 1) { tx /= tl; tz /= tl; }
    // bots jog between objectives and slow down to fight
    c.sprinting = (this.state !== 'fight' || this.retreatT > 0) && l > 0.01 && !c.crouch;
    const sp = BOT_SPEED * c.weapon.def.moveMul * speedMul * (c.speedBuffT > 0 ? 1.4 : 1) * (c.sprinting ? 1.3 : 1);
    const acc = Math.min(1, dt * 10);
    c.vx += (tx * sp - c.vx) * acc;
    c.vz += (tz * sp - c.vz) * acc;
    const bx = c.pos.x, bz = c.pos.z;
    m.move(c, c.vx * dt, c.vz * dt, dt);
    // blocked while strafing -> flip direction
    const moved = Math.hypot(c.pos.x - bx, c.pos.z - bz);
    if (this.state === 'fight' && l > 0.01 && sp > 1 && moved < sp * dt * 0.3) this.strafe *= -1;

    // shots originate from the eyes along the view direction
    const cp = Math.cos(c.pitch);
    c.aimOrigin.set(c.pos.x + Math.sin(c.yaw) * 0.5, c.pos.y + 1.45 - 0.5 * c.crouchK, c.pos.z + Math.cos(c.yaw) * 0.5);
    c.aimDir.set(Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp);
    c.inaccuracy = (0.05 + (1 - this.skill) * 0.04) * D.aimErr;

    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      const d = Math.hypot(c.pos.x - this.lastPos.x, c.pos.z - this.lastPos.z);
      if (d < 0.5 && l > 0.01 && this.state !== 'fight') {
        this.path = [];
        this.goal = null;
        this.repathT = 0;
      }
      this.lastPos = { x: c.pos.x, z: c.pos.z };
      this.stuckT = 0;
    }
  }

  /** Lobs a grenade on a ballistic arc that lands near (x, z). */
  private throwAt(c: Combatant, m: Match, x: number, z: number, dist: number): void {
    const v = GRENADE_SPEED;
    const k = Math.min(1, (GRAVITY * dist) / (v * v));
    const pitch = 0.5 * Math.asin(k) + (Math.random() - 0.5) * 0.08 * (1.3 - this.skill);
    const yaw = Math.atan2(x - c.pos.x, z - c.pos.z) + (Math.random() - 0.5) * 0.12 * (1.3 - this.skill);
    c.aimDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    m.throwGrenade(c, v);
  }

  private turnTo(c: Combatant, dt: number, rate: number): void {
    const d = angleDiff(this.desiredYaw, c.yaw);
    c.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }

  private perceive(c: Combatant, m: Match): void {
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    let best: Combatant | null = null;
    let bestD = Infinity;
    for (const e of m.combatants) {
      if (e.team === c.team || !e.alive) continue;
      const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz, (e.pos.y - c.pos.y) * 0.5);
      if (d > VIEW_DIST) continue;
      const inFov = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) > FOV_COS;
      // a helicopter is loud: everyone nearby notices it
      const loud = !!e.vehicle && d < 45;
      const noticed = inFov || loud || d < 10 || (c.lastAttacker === e && m.time - c.lastHurtT < 2) || (m.time - e.lastShotT < 0.5 && d < 35);
      if (!noticed) continue;
      // prefer the current target a little to avoid flip-flopping
      const score = d - (e === this.target ? 6 : 0);
      if (score >= bestD) continue;
      if (!m.canSee(c, e)) continue;
      best = e;
      bestD = score;
    }
    if (best) {
      if (best !== this.target || this.state !== 'fight') {
        this.reactT = (0.4 + (1 - this.skill) * 0.5 + Math.random() * 0.25) * this.diff.react;
        this.errYaw = (Math.random() - 0.5) * 0.35 * this.diff.aimErr;
        this.errPitch = (Math.random() - 0.5) * 0.15 * this.diff.aimErr;
        this.path = [];
      }
      this.target = best;
      this.state = 'fight';
      this.lastSeenT = m.time;
      this.lastKnown = { x: best.pos.x, y: best.pos.y, z: best.pos.z };
      return;
    }
    if (this.state === 'fight') {
      if (!this.target || !this.target.alive) {
        this.state = 'roam';
        this.target = null;
      } else if (m.time - this.lastSeenT > 0.8) {
        this.state = 'chase';
        this.target = null;
        this.path = [];
      }
    }
    // hurt by someone we can't see: go look for them
    const la = c.lastAttacker;
    if (this.state === 'roam' && la && la.alive && m.time - c.lastHurtT < 1) {
      this.state = 'chase';
      this.lastKnown = { x: la.pos.x, y: la.pos.y, z: la.pos.z };
      this.desiredYaw = Math.atan2(la.pos.x - c.pos.x, la.pos.z - c.pos.z);
      this.path = [];
    }
  }

  private pickGoal(c: Combatant, m: Match): void {
    // power-ups and supply drops nearby are worth a detour
    let near = null as P3 | null, nd = 40;
    for (const p of m.pickups) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) * (p.kind === 'airdrop' ? 0.5 : 1);
      if (d < nd) { nd = d; near = { x: p.pos.x, y: p.falling ? 0 : p.pos.y, z: p.pos.z }; }
    }
    if (near && Math.random() < 0.6) {
      this.goal = near;
      this.path = [];
      return;
    }
    // rooftops, upper floors and the metro make good fighting spots
    const spots = m.map.structures.spots;
    if (spots.length && Math.random() < 0.3) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      this.goal = { x: s.p.x + (Math.random() - 0.5) * 2, y: s.p.y, z: s.p.z + (Math.random() - 0.5) * 2 };
      this.path = [];
      return;
    }
    const pois = m.map.pois;
    const enemyX = c.team === 'blue' ? 1 : -1;
    // weight objectives toward the middle and the enemy side
    let best = pois[0], bestS = -Infinity;
    for (const p of pois) {
      const s = Math.random() * 60 + p.x * enemyX * 0.35 - Math.abs(p.z) * 0.1;
      if (s > bestS && Math.hypot(p.x - c.pos.x, p.z - c.pos.z) > 8) { bestS = s; best = p; }
    }
    // sometimes push straight into the enemy spawn area
    if (Math.random() < 0.15) {
      const sp = m.spawnList(c.team === 'blue' ? 'red' : 'blue');
      best = sp[Math.floor(Math.random() * sp.length)];
    }
    this.goal = { x: best.x + (Math.random() - 0.5) * 4, y: 0, z: best.z + (Math.random() - 0.5) * 4 };
    this.path = [];
  }

  /** True while walking a stair run: replanning mid-flight would send the bot back down. */
  private onStairs(): boolean {
    const cur = this.path[this.pathIdx], prev = this.path[this.pathIdx - 1];
    return !!(cur?.link && prev?.link);
  }

  private followPathTo(c: Combatant, m: Match, x: number, y: number, z: number): void {
    const end = this.path[this.path.length - 1];
    const stale = !end || Math.hypot(end.x - x, end.z - z) > 4 || Math.abs(end.y - y) > 2.5;
    if ((stale || this.path.length === 0) && this.repathT <= 0 && !this.onStairs()) {
      this.repathT = 0.8 + Math.random() * 0.4;
      const p = m.nav.findPath(c.pos.x, c.pos.y, c.pos.z, x, y, z);
      this.path = p ?? [];
      this.pathIdx = 0;
    }
    // advance waypoints (same floor only: a roof point directly above doesn't count)
    while (this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      const reach = wp.link ? 0.7 : 1.0;
      if (Math.hypot(wp.x - c.pos.x, wp.z - c.pos.z) < reach && Math.abs(wp.y - c.pos.y) < 2.2) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= this.path.length) this.path = [];
  }
}
