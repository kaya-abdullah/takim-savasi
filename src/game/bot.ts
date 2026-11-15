import * as THREE from 'three';
import type { V2 } from '../world/map';
import { GRENADE_SPEED } from '../data/weapons';
import { EYE_Y, type Combatant } from './combatant';
import { GRAVITY } from './match';
import type { Match } from './match';

type State = 'roam' | 'fight' | 'chase';

const BOT_SPEED = 4.6;
const VIEW_DIST = 70;
const FOV_COS = Math.cos((62 * Math.PI) / 180);

const PREF_DIST: Record<string, number> = {
  pistol: 14, smg: 10, rifle: 22, shotgun: 6, sniper: 38, lmg: 20, burst: 24, revolver: 16, minigun: 14, rocket: 24, plasma: 18,
};

const _sep = { x: 0, z: 0 };

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
  private lastKnown: V2 | null = null;
  private path: V2[] = [];
  private pathIdx = 0;
  private goal: V2 | null = null;
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

  constructor(readonly skill: number) {}

  reset(): void {
    this.state = 'roam';
    this.target = null;
    this.path = [];
    this.goal = null;
    this.lastKnown = null;
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
    let mvx = 0, mvz = 0; // desired move direction (world, unnormalised)
    let speedMul = 1;
    c.trigger = false;
    c.aiming = false;

    const t = this.target;
    if (this.state === 'fight' && t && t.alive) {
      const dx = t.pos.x - c.pos.x, dz = t.pos.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      // aim error settles over time, faster for skilled bots
      const settle = Math.exp(-dt * (1.5 + this.skill * 2.5));
      const minErr = 0.012 + (1 - this.skill) * 0.03;
      this.errYaw = this.errYaw * settle + (Math.random() - 0.5) * minErr * (1 - settle) * 6;
      this.errPitch = this.errPitch * settle + (Math.random() - 0.5) * minErr * (1 - settle) * 4;
      const chestY = t.pos.y + 1.25 - c.pos.y - EYE_Y;
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
      const inRange = dist < def.range * 1.7;
      if (visible && aligned && inRange && this.reactT <= 0) {
        c.trigger = true;
        c.aiming = def.zoom < 0.6 && dist > 20;
      }
      // knife at point-blank range, grenades at mid range
      if (visible && dist < 2.0) m.melee(c);
      else if (visible && this.reactT <= 0 && this.grenadeCd <= 0 && c.grenades > 0 && dist > 9 && dist < 24) {
        this.grenadeCd = 6 + Math.random() * 9;
        if (Math.random() < 0.35) this.throwAt(c, m, t.pos.x, t.pos.z, dist);
      }
      if (c.weapon.ammo === 0 || (!visible && c.weapon.ammo < c.weapon.def.mag * 0.4)) c.weapon.startReload();
      // movement: close distance via path, otherwise strafe
      if (dist > pref + 8 || !visible) {
        this.followPathTo(c, m, t.pos.x, t.pos.z);
        const wp = this.path[this.pathIdx];
        if (wp) { mvx = wp.x - c.pos.x; mvz = wp.z - c.pos.z; }
      } else {
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafe = Math.random() < 0.5 ? -1 : 1;
          this.strafeT = 0.5 + Math.random() * 1.1;
        }
        const nx = dx / (dist || 1), nz = dz / (dist || 1);
        mvx = -nz * this.strafe;
        mvz = nx * this.strafe;
        const approach = dist > pref ? 0.6 : dist < pref * 0.5 ? -0.6 : 0;
        mvx += nx * approach;
        mvz += nz * approach;
        speedMul = 0.75;
      }
    } else if (this.state === 'chase' && this.lastKnown) {
      this.followPathTo(c, m, this.lastKnown.x, this.lastKnown.z);
      const wp = this.path[this.pathIdx];
      if (wp) { mvx = wp.x - c.pos.x; mvz = wp.z - c.pos.z; }
      if (Math.hypot(this.lastKnown.x - c.pos.x, this.lastKnown.z - c.pos.z) < 2 || !wp) {
        this.state = 'roam';
        this.lastKnown = null;
      }
      if (mvx || mvz) this.desiredYaw = Math.atan2(mvx, mvz);
      this.turnTo(c, dt, 6);
      if (c.weapon.ammo < c.weapon.def.mag * 0.5) c.weapon.startReload();
    } else {
      this.state = 'roam';
      if (!this.goal || Math.hypot(this.goal.x - c.pos.x, this.goal.z - c.pos.z) < 2.5) this.pickGoal(c, m);
      if (this.goal) {
        this.followPathTo(c, m, this.goal.x, this.goal.z);
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
    c.sprinting = this.state !== 'fight' && l > 0.01;
    const sp = BOT_SPEED * c.weapon.def.moveMul * speedMul * (c.speedBuffT > 0 ? 1.4 : 1) * (c.sprinting ? 1.3 : 1);
    const acc = Math.min(1, dt * 10);
    c.vx += (tx * sp - c.vx) * acc;
    c.vz += (tz * sp - c.vz) * acc;
    const bx = c.pos.x, bz = c.pos.z;
    m.move(c, c.vx * dt, c.vz * dt, dt);
    // blocked while strafing -> flip direction
    const moved = Math.hypot(c.pos.x - bx, c.pos.z - bz);
    if (this.state === 'fight' && l > 0.01 && moved < sp * dt * 0.3) this.strafe *= -1;

    // shots originate from the eyes along the view direction
    const cp = Math.cos(c.pitch);
    c.aimOrigin.set(c.pos.x + Math.sin(c.yaw) * 0.5, c.pos.y + 1.45, c.pos.z + Math.cos(c.yaw) * 0.5);
    c.aimDir.set(Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp);
    c.inaccuracy = 0.05 + (1 - this.skill) * 0.04;

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
      const d = Math.hypot(dx, dz);
      if (d > VIEW_DIST) continue;
      const inFov = (dx * fx + dz * fz) / (d || 1) > FOV_COS;
      const noticed = inFov || d < 10 || (c.lastAttacker === e && m.time - c.lastHurtT < 2) || (m.time - e.lastShotT < 0.5 && d < 35);
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
        this.reactT = 0.4 + (1 - this.skill) * 0.5 + Math.random() * 0.25;
        this.errYaw = (Math.random() - 0.5) * 0.35;
        this.errPitch = (Math.random() - 0.5) * 0.15;
        this.path = [];
      }
      this.target = best;
      this.state = 'fight';
      this.lastSeenT = m.time;
      this.lastKnown = { x: best.pos.x, z: best.pos.z };
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
    if (this.state === 'roam' && c.lastAttacker && c.lastAttacker.alive && m.time - c.lastHurtT < 1) {
      this.state = 'chase';
      this.lastKnown = { x: c.lastAttacker.pos.x, z: c.lastAttacker.pos.z };
      this.desiredYaw = Math.atan2(c.lastAttacker.pos.x - c.pos.x, c.lastAttacker.pos.z - c.pos.z);
      this.path = [];
    }
  }

  private pickGoal(c: Combatant, m: Match): void {
    // power-ups and supply drops nearby are worth a detour
    let near = null as { x: number; z: number } | null, nd = 40;
    for (const p of m.pickups) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) * (p.kind === 'airdrop' ? 0.5 : 1);
      if (d < nd) { nd = d; near = { x: p.pos.x, z: p.pos.z }; }
    }
    if (near && Math.random() < 0.6) {
      this.goal = near;
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
    this.goal = { x: best.x + (Math.random() - 0.5) * 4, z: best.z + (Math.random() - 0.5) * 4 };
    this.path = [];
  }

  private followPathTo(c: Combatant, m: Match, x: number, z: number): void {
    const end = this.path[this.path.length - 1];
    const stale = !end || Math.hypot(end.x - x, end.z - z) > 4;
    if ((stale && this.repathT <= 0) || this.path.length === 0) {
      if (this.repathT <= 0) {
        this.repathT = 0.8 + Math.random() * 0.4;
        const p = m.nav.findPath(c.pos.x, c.pos.z, x, z);
        this.path = p ?? [];
        this.pathIdx = this.path.length > 1 ? 1 : 0;
      }
    }
    // advance waypoints
    while (this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      if (Math.hypot(wp.x - c.pos.x, wp.z - c.pos.z) < 1.0) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= this.path.length) this.path = [];
  }
}
