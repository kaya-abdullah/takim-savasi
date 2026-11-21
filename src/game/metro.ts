import { BODY_R, type Combatant } from './combatant';
import { STATIONS, TUNNEL_Y } from '../world/structures';

/** Train size: it runs down the middle of the 5 m corridor and leaves a lane on each side. */
export const TRAIN_LEN = 14;
export const TRAIN_HALF_W = 1.35;
export const TRAIN_H = 2.7;
const V_MAX = 15;
const ACCEL = 4;
/** Doors stay open at least this long after arriving (time to get off). */
export const DWELL = 4;
/** Someone on board this long with the doors open: they close and the train leaves. */
export const BOARD_WAIT = 2;

export type TrainState = 'stopped' | 'moving';

/**
 * The metro train. It waits at a station with the doors open; when someone is
 * on board it closes the doors and runs to the next station (turning back at
 * the line's ends), where it stops again. People on board ride along.
 */
export class Train {
  x = STATIONS[1];
  /** Speed (m/s, always >= 0); direction of travel in `dir`. */
  v = 0;
  dir: 1 | -1 = 1;
  state: TrainState = 'stopped';
  /** Station index it stands at, or runs to. */
  at = 1;
  dwell = DWELL;
  /** How long someone has been on board while waiting (doors close at BOARD_WAIT). */
  boardT = 0;
  /**
   * Who rides between two stations: fixed when the doors close, so a big
   * step against the wall (low frame rate) never counts as being outside.
   */
  readonly riders = new Set<Combatant>();

  get doorsOpen(): boolean {
    return this.state === 'stopped';
  }

  /** Inside the carriage (on its floor, between its walls)? */
  aboard(c: Combatant, x = this.x): boolean {
    return c.alive && !c.vehicle && Math.abs(c.pos.y - TUNNEL_Y) < 1.2
      && Math.abs(c.pos.x - x) < TRAIN_LEN / 2 - 0.2 && Math.abs(c.pos.z) < TRAIN_HALF_W - 0.1;
  }

  /** One step of the timetable; returns how far the train moved along x. */
  step(dt: number, someoneAboard: boolean): number {
    if (this.state === 'stopped') {
      this.dwell = Math.max(0, this.dwell - dt);
      this.boardT = someoneAboard ? this.boardT + dt : 0;
      if (this.dwell <= 0 && this.boardT >= BOARD_WAIT) this.depart();
      return 0;
    }
    const target = STATIONS[this.at];
    const dist = Math.abs(target - this.x);
    // speed up, cruise, and brake so it stops exactly at the platform
    this.v = Math.min(V_MAX, this.v + ACCEL * dt, Math.sqrt(2 * ACCEL * dist));
    const move = Math.min(dist, Math.max(this.v * dt, 0.02));
    const dx = this.dir * move;
    this.x += dx;
    if (dist - move < 0.01) this.arrive();
    return dx;
  }

  private depart(): void {
    let next = this.at + this.dir;
    if (next < 0 || next >= STATIONS.length) { this.dir = this.dir === 1 ? -1 : 1; next = this.at + this.dir; }
    this.at = next;
    this.state = 'moving';
    this.boardT = 0;
  }

  private arrive(): void {
    this.x = STATIONS[this.at];
    this.v = 0;
    this.state = 'stopped';
    this.dwell = DWELL;
    this.boardT = 0;
  }

  /** Door centres along the carriage (each side has a door at each). */
  static readonly DOORS = [-3.5, 3.5];
  static readonly DOOR_HALF = 0.8;

  private inDoor(c: Combatant): boolean {
    return this.doorsOpen && Train.DOORS.some((d) => Math.abs(c.pos.x - (this.x + d)) < Train.DOOR_HALF - BODY_R * 0.5);
  }

  /**
   * The carriage is solid except at open doors: riders stay in, people
   * outside are pushed aside into the lane beside it.
   */
  constrain(c: Combatant, wasAboard: boolean): void {
    if (!c.alive || c.vehicle || Math.abs(c.pos.y - TUNNEL_Y) > 1.5) return;
    const hl = TRAIN_LEN / 2, hw = TRAIN_HALF_W, m = BODY_R + 0.05;
    const door = this.inDoor(c);
    if (wasAboard) {
      c.pos.x = Math.min(this.x + hl - m, Math.max(this.x - hl + m, c.pos.x));
      if (!door) c.pos.z = Math.min(hw - m, Math.max(-hw + m, c.pos.z));
      return;
    }
    if (door) return;
    if (Math.abs(c.pos.x - this.x) < hl + BODY_R && Math.abs(c.pos.z) < hw + BODY_R) c.pos.z = (c.pos.z >= 0 ? 1 : -1) * (hw + BODY_R + 0.02);
  }

  /** Network form (host to the others). */
  pack(): number[] {
    return [Math.round(this.x * 100) / 100, Math.round(this.v * 100) / 100, this.dir, this.state === 'moving' ? 1 : 0, this.at, Math.round(this.boardT * 10) / 10];
  }

  /** Takes the host's train; the position is eased in (returns the step along x). */
  follow(p: number[], dt: number): number {
    const [x, v, dir, moving, at, boardT] = p;
    this.v = v;
    this.dir = dir === -1 ? -1 : 1;
    this.state = moving ? 'moving' : 'stopped';
    this.at = at;
    this.boardT = boardT;
    const before = this.x;
    // run on at the host's speed and close the gap to its position softly
    if (this.state === 'moving') this.x += this.dir * this.v * dt;
    this.x += (x - this.x) * Math.min(1, dt * 6);
    if (Math.abs(x - this.x) > 8) this.x = x;
    return this.x - before;
  }
}
