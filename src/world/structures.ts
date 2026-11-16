import type { AABB, Rect } from './collision';

/**
 * Walk-in structures: two-storey buildings with stairs to the roof and the
 * metro tunnel under the main avenue. Everything is made of axis-aligned
 * boxes so the existing collision, raycast and nav code handles it.
 *
 * Rendering rule: two visible faces must never share a plane (that z-fights
 * and flickers). Decorations therefore always stand proud of the surface they
 * sit on, and collision uses separate hidden boxes where visuals are layered.
 */

export type PieceMat =
  | 'brick' | 'plaster' | 'wood' | 'tile' | 'subway' | 'granite' | 'concrete' | 'metal' | 'glass' | 'fabric'
  | 'darkwood' | 'paint' | 'glow' | 'crate' | 'sign' | 'screen' | 'poster' | 'hidden';

export interface Piece {
  box: AABB;
  mat: PieceMat;
  color: number;
  /** false = visual only (no collision). */
  solid: boolean;
}

export interface P3 { x: number; y: number; z: number }

/** One walkable floor for bot navigation (the street level is implicit). */
export interface LevelDef {
  name: string;
  y: number;
  rect: Rect;
  /** Cells are walkable only inside these rects (empty = whole rect). */
  allow: Rect[];
  /** Holes in the floor (stairwells). */
  block: Rect[];
}

/** A stair run between two levels; pts go from level a to level b. */
export interface LinkDef { a: string; b: string; pts: P3[] }

export interface Spot { name: string; label: string; p: P3 }

/** Ceiling lamp for baked lighting: lights surfaces between y0 and y1 within reach. */
export interface Lamp { x: number; y: number; z: number; reach: number; y0: number; y1: number; power: number }

/** Enclosed volume: less sky light, darker corners. */
export interface Room { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }

export interface Structures {
  pieces: Piece[];
  /** Openings in the street (stairs down to the tunnel). */
  pits: Rect[];
  levels: LevelDef[];
  links: LinkDef[];
  /** Interesting places bots like to visit (roofs, upper floors, tunnel). */
  spots: Spot[];
  /** Footprints of the walk-in buildings (minimap, level labels). */
  houses: Rect[];
  tunnel: Rect[];
  lamps: Lamp[];
  rooms: Room[];
}

type Res = Omit<Structures, 'pieces' | 'pits'>;

export const STREET = 'street';
export const TUNNEL = 'tunnel';
export const TUNNEL_Y = -4;

// building dimensions
const T = 0.3; // wall thickness
export const FLOOR1_Y = 3.5;
export const ROOF_Y = 7;
const SLAB = 0.25;
const RISE = 0.25;
const TREAD = 0.35;
const STEPS = 14; // 14 x 0.25 = 3.5 m per storey
const SW = 1.4; // stair width
const STAIR_GAP = 1.6; // free space between the side wall and the first step
const PARAPET = 1.0;
const WIN_SILL = 1.0, WIN_TOP = 2.3, WIN_W = 1.3;
const DOOR_W = 3.0, DOOR_H = 2.6;

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): AABB =>
  ({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minY: y0, maxY: y1, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });

interface Opening { a: number; b: number; bottom: number; top: number; door?: boolean }

class Out {
  pieces: Piece[] = [];
  add(b: AABB, mat: PieceMat, color: number, solid = true): void {
    if (b.maxX - b.minX < 1e-3 || b.maxY - b.minY < 1e-3 || b.maxZ - b.minZ < 1e-3) return;
    this.pieces.push({ box: b, mat, color, solid });
  }

  /** Box in a wall's frame: along-axis [a, b], across [f0, f1]. */
  private wb(axis: 'x' | 'z', a: number, b: number, f0: number, f1: number, y0: number, y1: number): AABB {
    return axis === 'x' ? box(a, b, y0, y1, f0, f1) : box(f0, f1, y0, y1, a, b);
  }

  /** Pier/sill/lintel boxes of a wall with openings cut out. */
  slab(axis: 'x' | 'z', f0: number, f1: number, s: number, e: number, y0: number, y1: number, ops: Opening[], mat: PieceMat, color: number, solid: boolean): void {
    let cur = s;
    for (const o of [...ops].sort((p, q) => p.a - q.a)) {
      this.add(this.wb(axis, cur, o.a, f0, f1, y0, y1), mat, color, solid);
      if (o.bottom > y0) this.add(this.wb(axis, o.a, o.b, f0, f1, y0, o.bottom), mat, color, solid);
      if (o.top < y1) this.add(this.wb(axis, o.a, o.b, f0, f1, o.top, y1), mat, color, solid);
      cur = o.b;
    }
    this.add(this.wb(axis, cur, e, f0, f1, y0, y1), mat, color, solid);
  }

  /**
   * A layered wall: one hidden collision box through the full thickness, a
   * brick outer skin and a plaster inner skin, plus framed openings. `outerLow`
   * says whether the outside is at the f0 side.
   */
  wall(axis: 'x' | 'z', f0: number, f1: number, outerLow: boolean, s: number, e: number, y0: number, y1: number, ops: Opening[],
    outer: [PieceMat, number], inner: [PieceMat, number] | null): void {
    this.slab(axis, f0, f1, s, e, y0, y1, ops, 'hidden', 0, true);
    const mid = (f0 + f1) / 2;
    const [oa, ob] = outerLow ? [f0, mid] : [mid, f1];
    const [ia, ib] = outerLow ? [mid, f1] : [f0, mid];
    this.slab(axis, oa, ob, s, e, y0, y1, ops, outer[0], outer[1], false);
    if (inner) this.slab(axis, ia, ib, s, e, y0, y1, ops, inner[0], inner[1], false);
    else this.slab(axis, ia, ib, s, e, y0, y1, ops, outer[0], outer[1], false);
    const out = outerLow ? -1 : 1;
    for (const o of ops) this.frame(axis, f0, f1, out, o);
  }

  /** Window/door frame proud of both faces, a glass pane and an outside sill. */
  private frame(axis: 'x' | 'z', f0: number, f1: number, out: number, o: Opening): void {
    const fr = 0.08, pr = 0.035, fc = 0xe9e6df;
    const lo = f0 - pr, hi = f1 + pr;
    // each strip also reaches 3 cm into the opening, so it never shares the reveal's plane
    const into = 0.03;
    this.add(this.wb(axis, o.a - fr, o.a + into, lo, hi, o.bottom - (o.door ? 0 : fr), o.top + fr), 'paint', fc, false);
    this.add(this.wb(axis, o.b - into, o.b + fr, lo, hi, o.bottom - (o.door ? 0 : fr), o.top + fr), 'paint', fc, false);
    this.add(this.wb(axis, o.a + into, o.b - into, lo, hi, o.top - into, o.top + fr), 'paint', fc, false);
    if (o.door) return;
    // stone sill sticks out further on the street side
    // (inside it reaches 6 cm, beyond the 3.5 cm frames, so no two faces share a plane)
    const sl = out < 0 ? f0 - 0.14 : f0 - 0.06, sh = out < 0 ? f1 + 0.06 : f1 + 0.14;
    this.add(this.wb(axis, o.a - 0.12, o.b + 0.12, sl, sh, o.bottom - 0.07, o.bottom + 0.03), 'concrete', 0xd8d3c8, false);
    const mid = (f0 + f1) / 2;
    this.add(this.wb(axis, o.a, o.b, mid - 0.008, mid + 0.008, o.bottom + 0.03, o.top), 'glass', 0xffffff, false);
    this.add(this.wb(axis, (o.a + o.b) / 2 - 0.025, (o.a + o.b) / 2 + 0.025, mid - 0.03, mid + 0.03, o.bottom + 0.03, o.top), 'paint', fc, false);
    this.add(this.wb(axis, o.a + into, o.b - into, mid - 0.022, mid + 0.022, (o.bottom + o.top) / 2 + 0.2, (o.bottom + o.top) / 2 + 0.25), 'paint', fc, false);
  }
}

/** Rect minus a hole fully inside it, as up to four rects. */
export function subtract(r: Rect, h: Rect): Rect[] {
  const out: Rect[] = [];
  const push = (x0: number, x1: number, z0: number, z1: number) => { if (x1 - x0 > 1e-3 && z1 - z0 > 1e-3) out.push({ x0, x1, z0, z1 }); };
  push(r.x0, h.x0, r.z0, r.z1);
  push(h.x1, r.x1, r.z0, r.z1);
  push(h.x0, h.x1, r.z0, h.z0);
  push(h.x0, h.x1, h.z1, r.z1);
  return out;
}

/** Window centres along a wall, skipping a door and keeping 1 m from corners. */
function windowSpots(s: number, e: number, skip?: number): number[] {
  const c = (s + e) / 2, out: number[] = [];
  for (const k of [-2, -1, 0, 1, 2]) {
    const x = c + k * 3.1;
    if (x - WIN_W / 2 < s + 1 || x + WIN_W / 2 > e - 1) continue;
    if (skip !== undefined && Math.abs(x - skip) < DOOR_W / 2 + WIN_W / 2 + 0.5) continue;
    out.push(x);
  }
  return out;
}

const win = (x: number, base: number): Opening => ({ a: x - WIN_W / 2, b: x + WIN_W / 2, bottom: base + WIN_SILL, top: base + WIN_TOP });

export interface HouseSpec { x0: number; x1: number; z0: number; z1: number; color: number }

// ------------------------------------------------------------------ furniture
/** Furniture placed in a room's own frame (u along x from ix0, v along z from iz0, y up from the floor). */
class Room3 {
  constructor(private o: Out, private ix0: number, private iz0: number, private fy: number) {}
  b(u0: number, u1: number, y0: number, y1: number, v0: number, v1: number, mat: PieceMat, color: number, solid = false): void {
    this.o.add(box(this.ix0 + u0, this.ix0 + u1, this.fy + y0, this.fy + y1, this.iz0 + v0, this.iz0 + v1), mat, color, solid);
  }
  /** Solid footprint for collision, visual parts drawn separately. */
  solid(u0: number, u1: number, h: number, v0: number, v1: number): void {
    this.b(u0, u1, 0, h, v0, v1, 'hidden', 0, true);
  }
  table(u: number, v: number, w = 1.4, d = 0.8, wood = 0x8a5a34): void {
    this.solid(u - w / 2, u + w / 2, 0.78, v - d / 2, v + d / 2);
    this.b(u - w / 2, u + w / 2, 0.74, 0.79, v - d / 2, v + d / 2, 'darkwood', wood);
    for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      this.b(u + su * (w / 2 - 0.08) - 0.03, u + su * (w / 2 - 0.08) + 0.03, 0, 0.74, v + sv * (d / 2 - 0.08) - 0.03, v + sv * (d / 2 - 0.08) + 0.03, 'metal', 0x3a3d42);
  }
  chair(u: number, v: number, facing: 1 | -1, axis: 'u' | 'v', color = 0x2f3b4a): void {
    this.solid(u - 0.23, u + 0.23, 0.46, v - 0.23, v + 0.23);
    this.b(u - 0.22, u + 0.22, 0.42, 0.47, v - 0.22, v + 0.22, 'fabric', color);
    for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.b(u + su * 0.18 - 0.02, u + su * 0.18 + 0.02, 0, 0.42, v + sv * 0.18 - 0.02, v + sv * 0.18 + 0.02, 'metal', 0x2a2c30);
    // backrest on the side away from the table
    if (axis === 'u') this.b(u - facing * 0.22 - 0.03, u - facing * 0.22 + 0.03, 0.47, 0.95, v - 0.2, v + 0.2, 'fabric', color);
    else this.b(u - 0.2, u + 0.2, 0.47, 0.95, v - facing * 0.22 - 0.03, v - facing * 0.22 + 0.03, 'fabric', color);
  }
  /** Shelf unit (depth along u, length along v). */
  shelf(u0: number, u1: number, v0: number, v1: number, h = 2.0): void {
    if (v1 - v0 < 0.6) return;
    this.solid(u0, u1, h, v0, v1);
    this.b(u0, u1, 0, 0.06, v0, v1, 'darkwood', 0x5a3b22);
    const cols = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x8e44ad];
    for (let y = 0.45; y < h - 0.2; y += 0.5) {
      this.b(u0, u1, y, y + 0.04, v0 + 0.04, v1 - 0.04, 'darkwood', 0x6b4628);
      // goods on each shelf
      let v = v0 + 0.1, k = 0;
      while (v < v1 - 0.3) {
        const w = 0.18 + ((k * 37) % 5) * 0.04, hh = 0.18 + ((k * 13) % 4) * 0.06;
        this.b(u0 + 0.06, u1 - 0.06, y + 0.04, y + 0.04 + hh, v, v + w, 'paint', cols[(k * 7 + Math.round(y * 10)) % cols.length]);
        v += w + 0.06;
        k++;
      }
    }
    this.b(u0, u1, h - 0.04, h, v0, v1, 'darkwood', 0x5a3b22);
    for (const vv of [v0, v1 - 0.04]) this.b(u0, u1, 0.06, h - 0.04, vv, vv + 0.04, 'darkwood', 0x5a3b22);
  }
  sofa(u0: number, u1: number, v0: number, v1: number, backAtHighV: boolean, color = 0x7a2f2f): void {
    this.solid(u0, u1, 0.8, v0, v1);
    this.b(u0 + 0.18, u1 - 0.18, 0.08, 0.45, v0, v1, 'fabric', color);
    const [b0, b1] = backAtHighV ? [v1 - 0.22, v1] : [v0, v0 + 0.22];
    this.b(u0 + 0.18, u1 - 0.18, 0.45, 0.85, b0, b1, 'fabric', color);
    this.b(u0, u0 + 0.18, 0.08, 0.65, v0, v1, 'fabric', color);
    this.b(u1 - 0.18, u1, 0.08, 0.65, v0, v1, 'fabric', color);
    this.b(u0 + 0.05, u1 - 0.05, 0, 0.08, v0 + 0.05, v1 - 0.05, 'darkwood', 0x2a1c12);
  }
  bed(u0: number, u1: number, v0: number, v1: number): void {
    this.solid(u0, u1, 0.55, v0, v1);
    this.b(u0, u1, 0, 0.3, v0, v1, 'darkwood', 0x6b4628);
    this.b(u0 + 0.04, u1 - 0.04, 0.3, 0.5, v0 + 0.04, v1 - 0.04, 'fabric', 0xe8e4dc);
    this.b(u0 + 0.03, u1 - 0.03, 0.5, 0.56, v0 + 0.5, v1 - 0.02, 'fabric', 0x2f5f8f);
    this.b(u0 + 0.15, u1 - 0.15, 0.5, 0.65, v0 + 0.1, v0 + 0.45, 'fabric', 0xffffff);
    this.b(u0, u1, 0, 0.95, v0 - 0.06, v0, 'darkwood', 0x5a3b22);
  }
  desk(u: number, v: number): void {
    this.table(u, v, 1.5, 0.7, 0x9b7b5a);
    // monitor and keyboard
    this.b(u - 0.32, u + 0.32, 0.84, 1.22, v + 0.12, v + 0.16, 'metal', 0x16181b);
    this.b(u - 0.29, u + 0.29, 0.87, 1.19, v + 0.1, v + 0.12, 'screen', 0xffffff);
    this.b(u - 0.04, u + 0.04, 0.79, 0.84, v + 0.13, v + 0.17, 'metal', 0x16181b);
    this.b(u - 0.25, u + 0.25, 0.79, 0.81, v - 0.2, v - 0.05, 'metal', 0x2a2c30);
  }
  rug(u0: number, u1: number, v0: number, v1: number, color: number): void {
    this.b(u0, u1, 0.005, 0.02, v0, v1, 'fabric', color);
  }
  plant(u: number, v: number): void {
    this.solid(u - 0.22, u + 0.22, 0.5, v - 0.22, v + 0.22);
    this.b(u - 0.2, u + 0.2, 0, 0.45, v - 0.2, v + 0.2, 'concrete', 0x8a6a52);
    this.b(u - 0.34, u + 0.34, 0.45, 1.2, v - 0.34, v + 0.34, 'fabric', 0x3e7a35);
    this.b(u - 0.22, u + 0.22, 1.2, 1.55, v - 0.22, v + 0.22, 'fabric', 0x4f8f3f);
  }
  crates(u: number, v: number): void {
    this.solid(u - 0.6, u + 0.6, 1.2, v - 0.6, v + 0.6);
    this.b(u - 0.6, u + 0.6, 0, 1.2, v - 0.6, v + 0.6, 'crate', 0xffffff);
    this.b(u - 0.35, u + 0.25, 1.2, 1.75, v - 0.35, v + 0.25, 'crate', 0xffffff);
  }
  counter(u0: number, u1: number, v0: number, v1: number): void {
    if (v1 - v0 < 0.6) return;
    this.solid(u0, u1, 1.05, v0, v1);
    this.b(u0, u1, 0, 1.0, v0, v1, 'darkwood', 0x4a3020);
    this.b(u0 - 0.03, u1, 1.0, 1.06, v0 - 0.03, v1 + 0.03, 'tile', 0x666666);
    this.b(u0 + 0.2, u0 + 0.5, 1.06, 1.36, (v0 + v1) / 2 - 0.2, (v0 + v1) / 2 + 0.2, 'metal', 0xc9ccd0);
  }
  /** Framed picture on the wall plane v = wallV (protrudes toward +v if dir = 1). */
  pictureV(wallV: number, dir: 1 | -1, u: number, y: number, w: number, h: number, color: number): void {
    const a = wallV, b = wallV + dir * 0.04;
    this.b(u - w / 2, u + w / 2, y, y + h, Math.min(a, b), Math.max(a, b), 'darkwood', 0x2a1c12);
    const c = wallV + dir * 0.045;
    this.b(u - w / 2 + 0.06, u + w / 2 - 0.06, y + 0.06, y + h - 0.06, Math.min(b, c), Math.max(b, c), 'poster', color);
  }
  pictureU(wallU: number, dir: 1 | -1, v: number, y: number, w: number, h: number, color: number): void {
    const a = wallU, b = wallU + dir * 0.04;
    this.b(Math.min(a, b), Math.max(a, b), y, y + h, v - w / 2, v + w / 2, 'darkwood', 0x2a1c12);
    const c = wallU + dir * 0.045;
    this.b(Math.min(b, c), Math.max(b, c), y + 0.06, y + h - 0.06, v - w / 2 + 0.06, v + w / 2 - 0.06, 'poster', color);
  }
  /** Ceiling lamp hanging from height h (relative to this floor). */
  lamp(u: number, v: number, h: number): void {
    this.b(u - 0.02, u + 0.02, h - 0.35, h, v - 0.02, v + 0.02, 'metal', 0x222222);
    this.b(u - 0.35, u + 0.35, h - 0.45, h - 0.35, v - 0.12, v + 0.12, 'metal', 0x2b2d31);
    this.b(u - 0.32, u + 0.32, h - 0.47, h - 0.45, v - 0.1, v + 0.1, 'glow', 0xffffff);
  }
}

/**
 * Two storeys and a flat roof. Stairs run along the inside of the z0 wall in
 * a switchback (ground -> 1st floor -> roof). Doors on the z1 and x1 walls.
 */
export function buildHouse(o: Out, h: HouseSpec, name: string, res: Res): void {
  const { x0, x1, z0, z1, color } = h;
  const ix0 = x0 + T, ix1 = x1 - T, iz0 = z0 + T, iz1 = z1 - T;
  const W = ix1 - ix0, D = iz1 - iz0;
  const xa = ix0 + STAIR_GAP, L = STEPS * TREAD, xb = xa + L;
  const r1: [number, number] = [iz0, iz0 + SW];
  const r2: [number, number] = [iz0 + SW, iz0 + 2 * SW];
  const zm1 = (r1[0] + r1[1]) / 2, zm2 = (r2[0] + r2[1]) / 2;
  const top = ROOF_Y + PARAPET;
  const brick: [PieceMat, number] = ['brick', color];
  const plasterIn = (f: number): [PieceMat, number] => ['plaster', f === 0 ? 0xefe6d2 : 0xdfe7ea];
  // ---- outer walls (each storey separately so the inner paint differs)
  const doorX = (ix0 + ix1) / 2, doorZ = (iz0 + iz1) / 2;
  for (const [f, base] of [[0, 0], [1, FLOOR1_Y]]) {
    const yTop = f === 0 ? FLOOR1_Y : ROOF_Y;
    o.wall('x', z0, iz0, true, x0, x1, base, yTop, [], brick, plasterIn(f));
    const dz1: Opening[] = f === 0 ? [{ a: doorX - DOOR_W / 2, b: doorX + DOOR_W / 2, bottom: 0, top: DOOR_H, door: true }] : [];
    o.wall('x', iz1, z1, false, x0, x1, base, yTop, [...dz1, ...windowSpots(x0, x1, f === 0 ? doorX : undefined).map((x) => win(x, base))], brick, plasterIn(f));
    const dx1: Opening[] = f === 0 ? [{ a: doorZ - DOOR_W / 2, b: doorZ + DOOR_W / 2, bottom: 0, top: DOOR_H, door: true }] : [];
    o.wall('z', ix1, x1, false, iz0, iz1, base, yTop, [...dx1, ...windowSpots(iz0, iz1, f === 0 ? doorZ : undefined).map((z) => win(z, base))], brick, plasterIn(f));
    // the x0 wall keeps its windows clear of the stair bands
    o.wall('z', x0, ix0, true, iz0, iz1, base, yTop, windowSpots(r2[1] + 0.2, iz1).map((z) => win(z, base)), brick, plasterIn(f));
  }
  // parapet: brick both sides with a stone cap
  o.wall('x', z0, iz0, true, x0, x1, ROOF_Y, top, [], brick, null);
  o.wall('x', iz1, z1, false, x0, x1, ROOF_Y, top, [], brick, null);
  o.wall('z', x0, ix0, true, iz0, iz1, ROOF_Y, top, [], brick, null);
  o.wall('z', ix1, x1, false, iz0, iz1, ROOF_Y, top, [], brick, null);
  // a ring of four boxes (never one slab across the building, which would cut through the rooms)
  const ring = (ox: number, ix: number, y0: number, y1: number) => {
    o.add(box(x0 - ox, x1 + ox, y0, y1, z0 - ox, z0 + ix), 'concrete', 0xd8d3c8, false);
    o.add(box(x0 - ox, x1 + ox, y0, y1, z1 - ix, z1 + ox), 'concrete', 0xd8d3c8, false);
    o.add(box(x0 - ox, x0 + ix, y0, y1, z0 + ix, z1 - ix), 'concrete', 0xd8d3c8, false);
    o.add(box(x1 - ix, x1 + ox, y0, y1, z0 + ix, z1 - ix), 'concrete', 0xd8d3c8, false);
  };
  ring(0.06, T + 0.06, top, top + 0.1); // parapet cap
  ring(0.12, 0, FLOOR1_Y - 0.14, FLOOR1_Y + 0.1); // cornice between the storeys
  const plinth = (axis: 'x' | 'z', f0: number, f1: number, s: number, e: number, gap?: number) => {
    const ops: Opening[] = gap !== undefined ? [{ a: gap - DOOR_W / 2 - 0.08, b: gap + DOOR_W / 2 + 0.08, bottom: 0, top: 1 }] : [];
    o.slab(axis, f0, f1, s, e, 0, 0.55, ops, 'concrete', 0x8f8a80, false);
  };
  plinth('x', z0 - 0.05, z0 + 0.01, x0 - 0.05, x1 + 0.05);
  plinth('x', z1 - 0.01, z1 + 0.05, x0 - 0.05, x1 + 0.05, doorX);
  plinth('z', x1 - 0.01, x1 + 0.05, z0 + 0.01, z1 - 0.01, doorZ);
  plinth('z', x0 - 0.05, x0 + 0.01, z0 + 0.01, z1 - 0.01);
  // drainpipes on two corners, a shop sign over the main door, an awning over the side door
  for (const [px, pz] of [[x0 - 0.12, z1 + 0.12], [x1 + 0.12, z0 - 0.12]]) o.add(box(px - 0.06, px + 0.06, 0, top, pz - 0.06, pz + 0.06), 'metal', 0x5b6168, false);
  o.add(box(doorX - 1.6, doorX + 1.6, DOOR_H + 0.25, DOOR_H + 0.75, z1 + 0.03, z1 + 0.14), 'paint', 0x1f3b5c, false);
  o.add(box(doorX - 1.45, doorX + 1.45, DOOR_H + 0.32, DOOR_H + 0.68, z1 + 0.14, z1 + 0.16), 'poster', 0xf2c14e, false);
  o.add(box(x1 + 0.05, x1 + 1.0, DOOR_H + 0.15, DOOR_H + 0.25, doorZ - 1.9, doorZ + 1.9), 'fabric', 0xb8322a, false);
  // ---- floors and ceilings (visual layers over hidden collision slabs)
  const inner: Rect = { x0: ix0, x1: ix1, z0: iz0, z1: iz1 };
  const hole1: Rect = { x0: xa, x1: xb, z0: r1[0], z1: r1[1] };
  const hole2: Rect = { x0: xa, x1: xb, z0: r2[0], z1: r2[1] };
  o.add(box(ix0, ix1, 0, 0.02, iz0, iz1), 'tile', 0xffffff, false);
  for (const r of subtract(inner, hole1)) {
    o.add(box(r.x0, r.x1, FLOOR1_Y - SLAB, FLOOR1_Y, r.z0, r.z1), 'hidden', 0);
    o.add(box(r.x0, r.x1, FLOOR1_Y - SLAB, FLOOR1_Y - 0.03, r.z0, r.z1), 'plaster', 0xf4f1ea, false);
    o.add(box(r.x0, r.x1, FLOOR1_Y - 0.03, FLOOR1_Y, r.z0, r.z1), 'wood', 0xffffff, false);
  }
  for (const r of subtract(inner, hole2)) {
    o.add(box(r.x0, r.x1, ROOF_Y - SLAB, ROOF_Y, r.z0, r.z1), 'hidden', 0);
    o.add(box(r.x0, r.x1, ROOF_Y - SLAB, ROOF_Y - 0.03, r.z0, r.z1), 'plaster', 0xf4f1ea, false);
    o.add(box(r.x0, r.x1, ROOF_Y - 0.03, ROOF_Y, r.z0, r.z1), 'concrete', 0x77736c, false);
  }
  // baseboards along the inner walls (proud of the plaster), skipping doors
  for (const [f, base] of [[0, 0], [1, FLOOR1_Y]]) {
    const y0 = base + (f === 0 ? 0.02 : 0), y1 = y0 + 0.12;
    o.slab('x', iz1 - 0.02, iz1, ix0, ix1, y0, y1, f === 0 ? [{ a: doorX - DOOR_W / 2, b: doorX + DOOR_W / 2, bottom: y0, top: y1 }] : [], 'darkwood', 0x3b2618, false);
    o.slab('z', ix1 - 0.02, ix1, iz0, iz1, y0, y1, f === 0 ? [{ a: doorZ - DOOR_W / 2, b: doorZ + DOOR_W / 2, bottom: y0, top: y1 }] : [], 'darkwood', 0x3b2618, false);
    o.add(box(ix0, ix0 + 0.02, y0, y1, r2[1], iz1), 'darkwood', 0x3b2618, false);
    if (f === 1) o.add(box(ix0, xa, y0, y1, iz0, iz0 + 0.02), 'darkwood', 0x3b2618, false);
    o.add(box(xb, ix1, y0, y1, iz0, iz0 + 0.02), 'darkwood', 0x3b2618, false);
  }
  // ---- stairs (solid down to their floor so nobody walks underneath)
  for (let i = 0; i < STEPS; i++) {
    o.add(box(xa + i * TREAD, xa + (i + 1) * TREAD, 0, (i + 1) * RISE, r1[0], r1[1]), 'concrete', 0xb5b0a6);
    o.add(box(xb - (i + 1) * TREAD, xb - i * TREAD, FLOOR1_Y, FLOOR1_Y + (i + 1) * RISE, r2[0], r2[1]), 'concrete', 0xb5b0a6);
    // dark nosing strip on each tread edge (slightly proud)
    o.add(box(xa + i * TREAD - 0.005, xa + i * TREAD + 0.05, (i + 1) * RISE - 0.03, (i + 1) * RISE + 0.004, r1[0] + 0.02, r1[1] - 0.02), 'metal', 0x2a2c30, false);
    o.add(box(xb - i * TREAD - 0.05, xb - i * TREAD + 0.005, FLOOR1_Y + (i + 1) * RISE - 0.03, FLOOR1_Y + (i + 1) * RISE + 0.004, r2[0] + 0.02, r2[1] - 0.02), 'metal', 0x2a2c30, false);
  }
  // handrail on the open side of the ground-floor flight (visual: posts + rail)
  for (let i = 1; i < STEPS; i += 3) {
    const px = xa + (i + 0.5) * TREAD, py = (i + 1) * RISE;
    o.add(box(px - 0.025, px + 0.025, py, py + 0.95, r1[1] - 0.06, r1[1] - 0.01), 'metal', 0x2c3036, false);
  }
  for (let i = 0; i < STEPS; i++) {
    const px = xa + i * TREAD, py = (i + 1) * RISE + 0.92;
    o.add(box(px, px + TREAD + 0.01, py, py + 0.05, r1[1] - 0.06, r1[1] - 0.01), 'darkwood', 0x4a3020, false);
  }
  // ---- railings round the stairwells (the exit end stays open)
  const rt = 0.05, rh = 1.0, rc = 0x2c3036;
  railing(o, box(xa, xb, FLOOR1_Y, FLOOR1_Y + rh, r1[1] - rt, r1[1] + rt), rc);
  railing(o, box(xa - rt, xa + rt, FLOOR1_Y, FLOOR1_Y + rh, r1[0], r1[1]), rc);
  railing(o, box(xa, xb, ROOF_Y, ROOF_Y + rh, r2[0] - rt, r2[0] + rt), rc);
  railing(o, box(xa, xb, ROOF_Y, ROOF_Y + rh, r2[1] - rt, r2[1] + rt), rc);
  railing(o, box(xb - rt, xb + rt, ROOF_Y, ROOF_Y + rh, r2[0], r2[1]), rc);
  // ---- furniture: ground floor is a café/shop, upstairs a flat
  const g = new Room3(o, ix0, iz0, 0.02);
  g.table(2.4, D - 2.0);
  g.chair(1.35, D - 2.0, 1, 'u', 0x2f4f6f);
  g.chair(3.45, D - 2.0, -1, 'u', 0x2f4f6f);
  g.shelf(0.05, 0.5, 4.3, Math.min(D - 3.3, 7.2));
  g.counter(W - 0.8, W - 0.05, 0.4, Math.min(D / 2 - 2.4, 2.4));
  g.crates(W - 1.0, D - 1.0);
  g.rug(3.2, W - 3.2, 4.6, D - 3.2, 0x8c2f2a);
  g.plant(0.45, D - 0.45);
  g.pictureV(0.02, 1, 7.6, 1.4, 1.1, 0.8, 0x3b6fa8);
  g.lamp(W * 0.35, D * 0.62, FLOOR1_Y - SLAB - 0.02);
  g.lamp(W * 0.72, D * 0.62, FLOOR1_Y - SLAB - 0.02);
  const u = new Room3(o, ix0, iz0, FLOOR1_Y);
  u.desk(2.2, D - 1.0);
  u.chair(2.2, D - 1.75, 1, 'v', 0x1d1f22);
  u.sofa(W / 2 + 2.3, Math.min(W / 2 + 4.3, W - 0.3), D - 0.95, D - 0.1, true);
  u.table(W / 2 + 3.3, D - 1.9, 1.0, 0.55, 0x3b2618);
  u.bed(0.1, 2.1, 4.4, 6.4);
  u.shelf(W - 0.45, W - 0.05, 3.2, Math.min(D / 2 - 2.3, 4.0), 1.8);
  u.rug(W / 2 + 2.0, W - 0.5, D - 3.0, D - 1.3, 0x2f5f6f);
  u.plant(W - 0.45, D - 0.45);
  u.pictureU(0.02, 1, 7.4, 1.5, 1.0, 0.7, 0xa8743b);
  u.lamp(W * 0.35, D * 0.62, ROOF_Y - FLOOR1_Y - SLAB - 0.02);
  u.lamp(W * 0.72, D * 0.62, ROOF_Y - FLOOR1_Y - SLAB - 0.02);
  // ---- roof: AC units, water tank, vents, antenna
  const rf = new Room3(o, ix0, iz0, ROOF_Y);
  for (const [cu, cv] of [[W - 1.6, D - 1.4], [W / 2 - 0.4, D - 1.2]]) {
    rf.solid(cu - 0.8, cu + 0.8, 1.0, cv - 0.55, cv + 0.55);
    rf.b(cu - 0.8, cu + 0.8, 0, 1.0, cv - 0.55, cv + 0.55, 'metal', 0xb9bcc0);
    rf.b(cu - 0.5, cu + 0.5, 1.0, 1.03, cv - 0.4, cv + 0.4, 'metal', 0x2a2c30);
  }
  rf.solid(W - 1.6, W - 0.4, 1.8, 3.6, 4.8);
  rf.b(W - 1.6, W - 0.4, 0.4, 1.8, 3.6, 4.8, 'metal', 0x6f5a48);
  for (const [lu, lv] of [[W - 1.5, 3.7], [W - 0.5, 3.7], [W - 1.5, 4.7], [W - 0.5, 4.7]]) rf.b(lu - 0.05, lu + 0.05, 0, 0.4, lv - 0.05, lv + 0.05, 'metal', 0x333333);
  rf.b(2.6, 2.8, 0, 0.7, D - 0.6, D - 0.4, 'metal', 0x8a8f96);
  rf.b(4.6, 4.75, 0, 3.5, D - 0.35, D - 0.2, 'metal', 0x9aa0a8);
  rf.b(4.0, 5.4, 3.0, 3.06, D - 0.3, D - 0.25, 'metal', 0x9aa0a8);
  // ---- baked lights and rooms
  for (const base of [0, FLOOR1_Y]) {
    const ly = base + FLOOR1_Y - SLAB - 0.5;
    for (const k of [0.35, 0.72]) res.lamps.push({ x: ix0 + W * k, y: ly, z: iz0 + D * 0.62, reach: 6, y0: base - 0.05, y1: base + FLOOR1_Y - 0.2, power: 1.15 });
    res.rooms.push({ x0: ix0, x1: ix1, z0: iz0, z1: iz1, y0: base, y1: base + FLOOR1_Y - SLAB });
  }
  // ---- navigation
  const f1 = name + '-1', roof = name + '-roof';
  res.levels.push({ name: f1, y: FLOOR1_Y, rect: inner, allow: [], block: [hole1] });
  res.levels.push({ name: roof, y: ROOF_Y, rect: inner, allow: [], block: [hole2] });
  res.links.push({ a: STREET, b: f1, pts: [{ x: xa - 0.8, y: 0, z: zm1 }, { x: xb + 0.8, y: FLOOR1_Y, z: zm1 }] });
  res.links.push({ a: f1, b: roof, pts: [{ x: xb + 0.8, y: FLOOR1_Y, z: zm2 }, { x: xa - 0.8, y: ROOF_Y, z: zm2 }] });
  res.spots.push({ name: f1, label: '1. KAT', p: { x: (xb + ix1) / 2, y: FLOOR1_Y, z: (iz0 + iz1) / 2 + 0.5 } });
  res.spots.push({ name: roof, label: 'ÇATI', p: { x: ix0 + W * 0.45, y: ROOF_Y, z: (iz0 + iz1) / 2 } });
  res.houses.push({ x0, x1, z0, z1 });
}

// ------------------------------------------------------------------ tunnel
const TY = TUNNEL_Y;
const TB = TY - 0.5; // bottom of tunnel walls/floor
const CEIL = 0.3;
const BLUE = 0x2f6fbf;

/** A tunnel wall: tiled, with a blue band and dark skirting proud of the tiles on the inner side. */
function tunnelWall(o: Out, axis: 'x' | 'z', f0: number, f1: number, inLow: boolean, s: number, e: number): void {
  o.slab(axis, f0, f1, s, e, TB, 0, [], 'subway', 0xffffff, true);
  const face = inLow ? f0 : f1, d = inLow ? -1 : 1;
  const lay = (y0: number, y1: number, depth: number, mat: PieceMat, c: number) => {
    const a = face, b = face + d * depth;
    o.slab(axis, Math.min(a, b), Math.max(a, b), s, e, y0, y1, [], mat, c, false);
  };
  lay(TY + 1.15, TY + 1.4, 0.02, 'paint', BLUE);
  lay(TY, TY + 0.25, 0.025, 'granite', 0x777777);
}

/** Half of the tunnel (west corridor, west stairs, north stairs, west hall walls); mirrored for the rest. */
function tunnelHalf(o: Out, res: Res, pits: Rect[]): void {
  const tw = 0.3;
  // west corridor x -40..-10, z -2.5..2.5
  tunnelWall(o, 'x', 2.5, 2.5 + tw, true, -40.3, -10);
  tunnelWall(o, 'x', -2.5 - tw, -2.5, false, -40.3, WEST_X - 1.5 - tw);
  tunnelWall(o, 'x', -2.5 - tw, -2.5, false, WEST_X + 1.5 + tw, -10);
  o.add(box(-40, -10, -CEIL, 0, -2.8, 2.8), 'concrete', 0x8f8b84);
  o.add(box(-40, -10, TY - 0.03, TY, -2.5, 2.5), 'granite', 0xffffff, false);
  // cable tray and a pipe along the ceiling
  o.add(box(-40, -10, -CEIL - 0.12, -CEIL - 0.04, 1.6, 2.2), 'metal', 0x6b7076, false);
  o.add(box(-40, -10, -CEIL - 0.25, -CEIL - 0.13, -2.2, -2.05), 'metal', 0x9b4a2a, false);
  // west entrance: on the south sidewalk at the cross-street corner, stairs run
  // down toward +z, then a short passage under the avenue into the corridor
  sidewalkEntrance(o, res, pits, WEST_X, WEST_TOP, 1, -2.5);
  // the corridor's west end is closed now
  tunnelWall(o, 'z', -40.3, -40, false, -2.8, 2.8);
  const rc = RAIL_C, rh = RAIL_H;
  // north stairwell: x -1.5..1.5, z 6..11.6, going down toward -z into the hall
  const pitN: Rect = { x0: -1.5, x1: 1.5, z0: 6, z1: 11.6 };
  pits.push(pitN);
  for (let i = 0; i < 15; i++) {
    o.add(box(-1.5, 1.5, TB, -(i + 1) * RISE, 11.6 - (i + 1) * TREAD, 11.6 - i * TREAD), 'concrete', 0xb0aba2);
    o.add(box(-1.48, 1.48, -(i + 1) * RISE - 0.03, -(i + 1) * RISE + 0.004, 11.6 - i * TREAD - 0.06, 11.6 - i * TREAD + 0.005), 'paint', 0xd9b21f, false);
  }
  o.add(box(-1.5, 1.5, TY - 0.03, TY, 6, 6.35), 'granite', 0xffffff, false);
  o.add(box(1.5, 1.8, TB, 0, 6, 11.6), 'subway', 0xffffff);
  o.add(box(-1.8, -1.5, TB, 0, 6, 11.6), 'subway', 0xffffff);
  railing(o, box(1.5, 1.62, 0, rh, 6, 11.6), rc);
  railing(o, box(-1.62, -1.5, 0, rh, 6, 11.6), rc);
  railing(o, box(-1.5, 1.5, 0, rh, 6, 6.12), rc);
  metroSign(o, 1.95, 12.3);
  for (const bx of [-0.85, 0.85]) bollard(o, bx, 12.1);
  // hall walls (west side and north side)
  tunnelWall(o, 'z', -10.3, -10, false, 2.5, 6.3);
  tunnelWall(o, 'z', -10.3, -10, false, -6.3, -2.5);
  tunnelWall(o, 'x', 6, 6.3, true, -10.3, -1.8);
  tunnelWall(o, 'x', 6, 6.3, true, 1.8, 10.3);
  // tiled pillars with a blue band
  for (const z of [3, -3]) {
    o.add(box(-5.35, -4.65, TY, -CEIL, z - 0.35, z + 0.35), 'subway', 0xffffff);
    o.add(box(-5.38, -4.62, TY + 1.15, TY + 1.4, z - 0.38, z + 0.38), 'paint', BLUE, false);
  }
  // cover: crates and concrete blocks; benches, bins and a vending machine for the station
  o.add(box(-34.6, -33.4, TY, TY + 1.2, -2.3, -1.1), 'crate', 0xffffff);
  o.add(box(-25.6, -24.4, TY, TY + 1.2, 1.1, 2.3), 'crate', 0xffffff);
  o.add(box(-17, -15, TY, TY + 1.0, -2.3, -1.6), 'concrete', 0xc9c4b8);
  o.add(box(-8, -6, TY, TY + 1.0, -0.4, 0.4), 'concrete', 0xc9c4b8);
  bench(o, -9.5, 4.2, 'z');
  bench(o, -3.6, 5.5, 'x');
  o.add(box(-9.9, -9.2, TY, TY + 1.9, -5.6, -4.5), 'hidden', 0);
  o.add(box(-9.9, -9.2, TY, TY + 1.9, -5.6, -4.5), 'paint', 0xb3261e, false);
  o.add(box(-9.2, -9.18, TY + 0.9, TY + 1.7, -5.45, -4.65), 'screen', 0xffffff, false);
  o.add(box(-30.3, -29.7, TY, TY + 0.8, 2.0, 2.45), 'metal', 0x3d6b3d);
  o.add(box(-20.3, -19.7, TY, TY + 0.8, -2.45, -2.0), 'metal', 0x3d6b3d);
  // posters on the corridor walls (frame and print stand proud of the tiles)
  [-36, -28, -21, -13].forEach((x, i) => {
    o.add(box(x - 0.8, x + 0.8, TY + 1.55, TY + 2.75, 2.46, 2.5), 'darkwood', 0x1a1a1a, false);
    o.add(box(x - 0.72, x + 0.72, TY + 1.62, TY + 2.68, 2.455, 2.46), 'poster', [0x2f6fbf, 0xc0392b, 0x27ae60, 0xf39c12][i]);
  });
  // hanging station sign
  o.add(box(-9.95, -9.6, -CEIL - 0.9, -CEIL - 0.3, -1.2, 1.2), 'sign', 0xffffff, false);
  // ceiling light fixtures
  for (let x = -37.5; x < -10; x += 5) {
    o.add(box(x - 0.75, x + 0.75, -CEIL - 0.1, -CEIL, -0.16, 0.16), 'metal', 0x2b2d31, false);
    o.add(box(x - 0.7, x + 0.7, -CEIL - 0.12, -CEIL - 0.1, -0.12, 0.12), 'glow', 0xffffff, false);
    res.lamps.push({ x, y: -CEIL - 0.5, z: 0, reach: 5.5, y0: TB, y1: 0, power: 1.0 });
  }
  res.lamps.push({ x: 0, y: -1.2, z: 9, reach: 4, y0: TB, y1: 0.1, power: 0.7 });
  res.rooms.push({ x0: -40, x1: -10, z0: -2.5, z1: 2.5, y0: TY, y1: -CEIL });
  res.rooms.push({ x0: -1.5, x1: 1.5, z0: 6, z1: 11.6, y0: TY, y1: 0 });
  // links
  res.links.push({ a: STREET, b: TUNNEL, pts: [{ x: 0, y: 0, z: 12.6 }, { x: 0, y: TY, z: 5.2 }] });
  res.spots.push({ name: TUNNEL, label: 'METRO', p: { x: -26, y: TY, z: 0 } });
}

const RAIL_C = 0x2c3540;
const RAIL_H = 1.05;
/** Centre x and top-step z of the west sidewalk entrance (mirrored to the east). */
const WEST_X = -38;
const WEST_TOP = -13.85;
const STAIR_LEN = 15 * TREAD + 0.35;

/** The passage under the avenue from the west entrance (nav needs it). */
export const WEST_PASSAGE: Rect = { x0: WEST_X - 1.5, x1: WEST_X + 1.5, z0: WEST_TOP + STAIR_LEN, z1: 0 }; // overlaps the corridor so the doorway cells count

/**
 * A metro entrance on a sidewalk: a 3 m stairwell along z whose top step is at
 * zTop, going down in direction dir, then a tiled passage at tunnel level that
 * ends at zEnd (a corridor wall with a doorway).
 */
function sidewalkEntrance(o: Out, res: Res, pits: Rect[], cx: number, zTop: number, dir: 1 | -1, zEnd: number): void {
  const x0 = cx - 1.5, x1 = cx + 1.5;
  const zLow = zTop + dir * STAIR_LEN; // foot of the stairs
  const zr = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
  const [pz0, pz1] = zr(zTop, zLow);
  pits.push({ x0, x1, z0: pz0, z1: pz1 });
  for (let i = 0; i < 15; i++) {
    const [a, b] = zr(zTop + dir * i * TREAD, zTop + dir * (i + 1) * TREAD);
    o.add(box(x0, x1, TB, -(i + 1) * RISE, a, b), 'concrete', 0xb0aba2);
    const e = zTop + dir * i * TREAD; // nosing at the outer edge of the step
    const [n0, n1] = zr(e - dir * 0.005, e + dir * 0.06);
    o.add(box(x0 + 0.02, x1 - 0.02, -(i + 1) * RISE - 0.03, -(i + 1) * RISE + 0.004, n0, n1), 'paint', 0xd9b21f, false);
  }
  const [l0, l1] = zr(zTop + dir * 15 * TREAD, zLow);
  o.add(box(x0, x1, TY - 0.03, TY, l0, l1), 'granite', 0xffffff, false);
  // stairwell side walls and handrails
  o.add(box(x1, x1 + 0.3, TB, 0, pz0, pz1), 'subway', 0xffffff);
  o.add(box(x0 - 0.3, x0, TB, 0, pz0, pz1), 'subway', 0xffffff);
  for (const x of [x0 + 0.03, x1 - 0.08]) o.add(box(x, x + 0.05, -2.2, -2.15, pz0, pz1), 'metal', 0xb0b4ba, false);
  // street railing on three sides (the top step stays open)
  railing(o, box(x1, x1 + 0.12, 0, RAIL_H, pz0, pz1), RAIL_C);
  railing(o, box(x0 - 0.12, x0, 0, RAIL_H, pz0, pz1), RAIL_C);
  const [r0, r1] = zr(zLow, zLow - dir * 0.12);
  railing(o, box(x0, x1, 0, RAIL_H, r0, r1), RAIL_C);
  metroSign(o, x1 + 0.45, zTop - dir * 0.6);
  for (const bx of [cx - 0.85, cx + 0.85]) bollard(o, bx, zTop - dir * 0.5);
  // passage under the road: tiled walls, granite floor, ceiling slab
  const [q0, q1] = zr(zLow, zEnd);
  tunnelWall(o, 'z', x0 - 0.3, x0, false, q0, q1);
  tunnelWall(o, 'z', x1, x1 + 0.3, true, q0, q1);
  o.add(box(x0 - 0.3, x1 + 0.3, -CEIL, 0, q0, q1), 'concrete', 0x8f8b84);
  o.add(box(x0, x1, TY - 0.03, TY, q0, q1), 'granite', 0xffffff, false);
  const qm = (q0 + q1) / 2;
  o.add(box(cx - 0.6, cx + 0.6, -CEIL - 0.1, -CEIL, qm - 0.16, qm + 0.16), 'metal', 0x2b2d31, false);
  o.add(box(cx - 0.55, cx + 0.55, -CEIL - 0.12, -CEIL - 0.1, qm - 0.12, qm + 0.12), 'glow', 0xffffff, false);
  res.lamps.push({ x: cx, y: -CEIL - 0.5, z: qm, reach: 4.5, y0: TB, y1: 0, power: 1.0 });
  res.lamps.push({ x: cx, y: -1.2, z: (pz0 + pz1) / 2, reach: 4, y0: TB, y1: 0.1, power: 0.7 });
  res.rooms.push({ x0, x1, z0: pz0, z1: pz1, y0: TY, y1: 0 });
  res.rooms.push({ x0, x1, z0: q0, z1: q1, y0: TY, y1: -CEIL });
  res.links.push({ a: STREET, b: TUNNEL, pts: [{ x: cx, y: 0, z: zTop - dir * 1.0 }, { x: cx, y: TY, z: zLow + dir * 0.8 }] });
}

/** Station bench along x or z (solid seat, visual legs and slats). */
function bench(o: Out, x: number, z: number, along: 'x' | 'z'): void {
  const hx = along === 'x' ? 0.9 : 0.25, hz = along === 'x' ? 0.25 : 0.9;
  o.add(box(x - hx, x + hx, TY, TY + 0.46, z - hz, z + hz), 'hidden', 0);
  o.add(box(x - hx, x + hx, TY + 0.4, TY + 0.46, z - hz, z + hz), 'darkwood', 0x8a5a34, false);
  for (const s of [-0.75, 0.75]) {
    const lx = along === 'x' ? x + s : x, lz = along === 'x' ? z : z + s;
    o.add(box(lx - 0.04, lx + 0.04, TY, TY + 0.4, lz - 0.04, lz + 0.04), 'metal', 0x2a2c30, false);
  }
}

/**
 * A railing: one hidden collision box, drawn as posts every ~1 m, a handrail
 * on top and a mid rail (a solid dark block read as a wall).
 */
function railing(o: Out, b: AABB, color: number): void {
  o.add(b, 'hidden', 0);
  const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
  const len = alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, h = b.maxY - b.minY;
  const seg = (a0: number, a1: number, y0: number, y1: number, t: number) => alongX
    ? box(b.minX + a0, b.minX + a1, y0, y1, cz - t, cz + t)
    : box(cx - t, cx + t, y0, y1, b.minZ + a0, b.minZ + a1);
  o.add(seg(0, len, b.maxY - 0.06, b.maxY, 0.04), 'metal', color, false);
  o.add(seg(0, len, b.minY + h * 0.45, b.minY + h * 0.45 + 0.04, 0.025), 'metal', color, false);
  const n = Math.max(1, Math.round(len / 1.0));
  for (let i = 0; i <= n; i++) {
    const a = Math.min(len - 0.05, Math.max(0, (len * i) / n - 0.025));
    o.add(seg(a, a + 0.05, b.minY, b.maxY - 0.06, 0.03), 'metal', color, false);
  }
}

/**
 * A steel bollard; two of them at a stairwell's open top leave a 1.44 m gap
 * in the middle: people walk through, a car (2.1 m wide) cannot.
 */
function bollard(o: Out, x: number, z: number): void {
  o.add(box(x - 0.13, x + 0.13, 0, 0.95, z - 0.13, z + 0.13), 'metal', 0x2c3540);
  o.add(box(x - 0.14, x + 0.14, 0.78, 0.86, z - 0.14, z + 0.14), 'paint', 0xd9b21f, false);
}

/** Lit "M" totem next to a metro entrance (visual). */
function metroSign(o: Out, x: number, z: number): void {
  o.add(box(x - 0.08, x + 0.08, 0, 2.6, z - 0.08, z + 0.08), 'metal', 0x2c3540, false);
  o.add(box(x - 0.4, x + 0.4, 2.6, 3.4, z - 0.12, z + 0.12), 'sign', 0xffffff, false);
}

function mirrorRect(r: Rect): Rect {
  return { x0: -r.x1, x1: -r.x0, z0: -r.z1, z1: -r.z0 };
}
function mirrorBox(b: AABB): AABB {
  return { minX: -b.maxX, maxX: -b.minX, minY: b.minY, maxY: b.maxY, minZ: -b.maxZ, maxZ: -b.minZ };
}

/**
 * Builds every structure. `half` lists the walk-in buildings of one half of
 * the point-symmetric map; they and the tunnel half are mirrored to (-x, -z).
 */
export function buildStructures(half: HouseSpec[]): Structures {
  const o = new Out();
  const res: Res = { levels: [], links: [], spots: [], houses: [], tunnel: [], lamps: [], rooms: [] };
  const pits: Rect[] = [];
  half.forEach((h, i) => buildHouse(o, h, 'h' + i, res));
  tunnelHalf(o, res, pits);
  // mirror everything built so far
  const n = o.pieces.length;
  for (let i = 0; i < n; i++) o.pieces.push({ ...o.pieces[i], box: mirrorBox(o.pieces[i].box) });
  const mp = (p: P3): P3 => ({ x: -p.x, y: p.y, z: -p.z });
  const mname = (s: string) => (s === STREET || s === TUNNEL ? s : s + 'm');
  for (const l of [...res.levels]) res.levels.push({ name: mname(l.name), y: l.y, rect: mirrorRect(l.rect), allow: l.allow.map(mirrorRect), block: l.block.map(mirrorRect) });
  for (const l of [...res.links]) res.links.push({ a: mname(l.a), b: mname(l.b), pts: l.pts.map(mp) });
  for (const s of [...res.spots]) res.spots.push({ name: mname(s.name), label: s.label, p: mp(s.p) });
  for (const h of [...res.houses]) res.houses.push(mirrorRect(h));
  for (const p of [...pits]) pits.push(mirrorRect(p));
  for (const l of [...res.lamps]) res.lamps.push({ ...l, x: -l.x, z: -l.z });
  for (const r of [...res.rooms]) res.rooms.push({ ...r, ...mirrorRect(r) });
  // shared centre pieces: hall ceiling, floor and lights, plus the tunnel level
  o.add(box(-10.3, 10.3, -CEIL, 0, -6.3, 6.3), 'concrete', 0x8f8b84);
  o.add(box(-46, 46, TB, TY, -12, 12), 'hidden', 0); // collision floor under everything
  o.add(box(-10, 10, TY - 0.03, TY, -6, 6), 'granite', 0xffffff, false);
  for (const x of [-6, 0, 6]) for (const z of [-3.5, 3.5]) {
    o.add(box(x - 0.95, x + 0.95, -CEIL - 0.1, -CEIL, z - 0.2, z + 0.2), 'metal', 0x2b2d31, false);
    o.add(box(x - 0.9, x + 0.9, -CEIL - 0.12, -CEIL - 0.1, z - 0.15, z + 0.15), 'glow', 0xffffff, false);
    res.lamps.push({ x, y: -CEIL - 0.5, z, reach: 6, y0: TB, y1: 0, power: 1.0 });
  }
  res.rooms.push({ x0: -10, x1: 10, z0: -6, z1: 6, y0: TY, y1: -CEIL });
  const corridorW: Rect = { x0: -40, x1: -10, z0: -2.5, z1: 2.5 };
  const hall: Rect = { x0: -10, x1: 10, z0: -6, z1: 6 };
  res.tunnel = [corridorW, hall, mirrorRect(corridorW), WEST_PASSAGE, mirrorRect(WEST_PASSAGE), ...pits];
  res.levels.push({ name: TUNNEL, y: TY, rect: { x0: -46, x1: 46, z0: -12, z1: 12 }, allow: [corridorW, hall, mirrorRect(corridorW), WEST_PASSAGE, mirrorRect(WEST_PASSAGE)], block: [] });
  return { pieces: o.pieces, pits, ...res };
}
