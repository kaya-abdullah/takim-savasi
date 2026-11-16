import type { AABB, Rect } from './collision';

/**
 * Walk-in structures: two-storey buildings with stairs to the roof and the
 * metro tunnel under the main avenue. Everything is made of axis-aligned
 * boxes so the existing collision, raycast and nav code handles it.
 */

export type PieceMat = 'wall' | 'floor' | 'stair' | 'rail' | 'tile' | 'tunnelFloor' | 'ceiling' | 'glow' | 'crate' | 'trim' | 'sign' | 'hidden';

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
}

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

interface Opening { a: number; b: number; bottom: number; top: number }

class Out {
  pieces: Piece[] = [];
  add(b: AABB, mat: PieceMat, color: number, solid = true): void {
    if (b.maxX - b.minX < 1e-3 || b.maxY - b.minY < 1e-3 || b.maxZ - b.minZ < 1e-3) return;
    this.pieces.push({ box: b, mat, color, solid });
  }

  /**
   * A wall running along `axis` from s to e, occupying [f0, f1] across it and
   * [y0, y1] vertically, with door/window openings cut out.
   */
  wall(axis: 'x' | 'z', f0: number, f1: number, s: number, e: number, y0: number, y1: number, openings: Opening[], color: number): void {
    const mk = (a: number, b: number, ya: number, yb: number, mat: PieceMat = 'wall', c = color, solid = true) => {
      if (b - a < 1e-3 || yb - ya < 1e-3) return;
      this.add(axis === 'x' ? box(a, b, ya, yb, f0, f1) : box(f0, f1, ya, yb, a, b), mat, c, solid);
    };
    const ops = [...openings].sort((p, q) => p.a - q.a);
    let cur = s;
    for (const o of ops) {
      mk(cur, o.a, y0, y1);
      mk(o.a, o.b, y0, o.bottom); // sill
      mk(o.a, o.b, o.top, y1); // lintel
      // dark frame strips, visual only
      const fr = 0.07;
      mk(o.a - fr, o.a, o.bottom, o.top, 'trim', 0x2a2c30, false);
      mk(o.b, o.b + fr, o.bottom, o.top, 'trim', 0x2a2c30, false);
      if (o.bottom > y0) mk(o.a - fr, o.b + fr, o.bottom - 0.08, o.bottom, 'trim', 0xd9d4c8, false);
      cur = o.b;
    }
    mk(cur, e, y0, y1);
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

/**
 * Two storeys and a flat roof. Stairs run along the inside of the z0 wall in
 * a switchback (ground -> 1st floor -> roof). Doors on the z1 and x1 walls.
 */
export function buildHouse(o: Out, h: HouseSpec, name: string, res: Omit<Structures, 'pieces' | 'pits'>): void {
  const { x0, x1, z0, z1, color } = h;
  const ix0 = x0 + T, ix1 = x1 - T, iz0 = z0 + T, iz1 = z1 - T;
  const xa = ix0 + STAIR_GAP, L = STEPS * TREAD, xb = xa + L;
  const r1: [number, number] = [iz0, iz0 + SW];
  const r2: [number, number] = [iz0 + SW, iz0 + 2 * SW];
  const zm1 = (r1[0] + r1[1]) / 2, zm2 = (r2[0] + r2[1]) / 2;
  const top = ROOF_Y + PARAPET;
  // ---- outer walls
  o.wall('x', z0, iz0, x0, x1, 0, top, [], color); // stair side: solid
  const doorX = (ix0 + ix1) / 2, doorZ = (iz0 + iz1) / 2;
  for (const base of [0, FLOOR1_Y]) {
    const yTop = base === 0 ? FLOOR1_Y : top;
    const doorZ1 = base === 0 ? [{ a: doorX - DOOR_W / 2, b: doorX + DOOR_W / 2, bottom: 0, top: DOOR_H }] : [];
    o.wall('x', iz1, z1, x0, x1, base, yTop, [...doorZ1, ...windowSpots(x0, x1, base === 0 ? doorX : undefined).map((x) => win(x, base))], color);
    const doorX1 = base === 0 ? [{ a: doorZ - DOOR_W / 2, b: doorZ + DOOR_W / 2, bottom: 0, top: DOOR_H }] : [];
    o.wall('z', ix1, x1, iz0, iz1, base, yTop, [...doorX1, ...windowSpots(iz0, iz1, base === 0 ? doorZ : undefined).map((z) => win(z, base))], color);
    // the x0 wall keeps its windows clear of the stair bands
    o.wall('z', x0, ix0, iz0, iz1, base, yTop, windowSpots(r2[1] + 0.2, iz1).map((z) => win(z, base)), color);
  }
  // cornice band between the storeys and a cap on the parapet (visual)
  const dark = shadeHex(color, 0.72);
  o.add(box(x0 - 0.12, x1 + 0.12, FLOOR1_Y - 0.12, FLOOR1_Y + 0.12, z0 - 0.12, z1 + 0.12), 'trim', dark, false);
  o.add(box(x0 - 0.06, x1 + 0.06, top, top + 0.08, z0 - 0.06, z1 + 0.06), 'trim', dark, false);
  // ---- floors
  const inner: Rect = { x0: ix0, x1: ix1, z0: iz0, z1: iz1 };
  const hole1: Rect = { x0: xa, x1: xb, z0: r1[0], z1: r1[1] };
  const hole2: Rect = { x0: xa, x1: xb, z0: r2[0], z1: r2[1] };
  o.add(box(ix0, ix1, 0, 0.02, iz0, iz1), 'tile', 0xb9b2a4, false);
  for (const r of subtract(inner, hole1)) o.add(box(r.x0, r.x1, FLOOR1_Y - SLAB, FLOOR1_Y, r.z0, r.z1), 'floor', 0x8a6a4a);
  for (const r of subtract(inner, hole2)) o.add(box(r.x0, r.x1, ROOF_Y - SLAB, ROOF_Y, r.z0, r.z1), 'floor', 0x8e8b86);
  // ---- stairs (solid down to their floor so nobody walks underneath)
  for (let i = 0; i < STEPS; i++) {
    o.add(box(xa + i * TREAD, xa + (i + 1) * TREAD, 0, (i + 1) * RISE, r1[0], r1[1]), 'stair', 0xa7a39b);
    o.add(box(xb - (i + 1) * TREAD, xb - i * TREAD, FLOOR1_Y, FLOOR1_Y + (i + 1) * RISE, r2[0], r2[1]), 'stair', 0xa7a39b);
  }
  // ---- railings round the stairwells (the exit end stays open)
  const rt = 0.05, rh = 1.0, rc = 0x3a3f46;
  o.add(box(xa, xb, FLOOR1_Y, FLOOR1_Y + rh, r1[1] - rt, r1[1] + rt), 'rail', rc);
  o.add(box(xa - rt, xa + rt, FLOOR1_Y, FLOOR1_Y + rh, r1[0], r1[1]), 'rail', rc);
  o.add(box(xa, xb, ROOF_Y, ROOF_Y + rh, r2[0] - rt, r2[0] + rt), 'rail', rc);
  o.add(box(xa, xb, ROOF_Y, ROOF_Y + rh, r2[1] - rt, r2[1] + rt), 'rail', rc);
  o.add(box(xb - rt, xb + rt, ROOF_Y, ROOF_Y + rh, r2[0], r2[1]), 'rail', rc);
  // ---- cover inside
  o.add(box(ix1 - 1.9, ix1 - 0.7, 0, 1.2, iz1 - 1.9, iz1 - 0.7), 'crate', 0xffffff);
  o.add(box(ix0 + 0.6, ix0 + 1.8, FLOOR1_Y, FLOOR1_Y + 1.2, iz1 - 1.8, iz1 - 0.6), 'crate', 0xffffff);
  o.add(box(ix1 - 2.6, ix1 - 1.4, ROOF_Y, ROOF_Y + 1.0, iz1 - 2.2, iz1 - 1.2), 'rail', 0xb9bcc0); // roof AC unit
  // ---- ceiling lamps (visual)
  const cx = (ix0 + ix1) / 2 + 1, cz = (iz0 + iz1) / 2 + 1.5;
  o.add(box(cx - 0.5, cx + 0.5, FLOOR1_Y - SLAB - 0.05, FLOOR1_Y - SLAB, cz - 0.15, cz + 0.15), 'glow', 0xffffff, false);
  o.add(box(cx - 0.5, cx + 0.5, ROOF_Y - SLAB - 0.05, ROOF_Y - SLAB, cz - 0.15, cz + 0.15), 'glow', 0xffffff, false);
  // ---- navigation
  const f1 = name + '-1', roof = name + '-roof';
  res.levels.push({ name: f1, y: FLOOR1_Y, rect: inner, allow: [], block: [hole1] });
  res.levels.push({ name: roof, y: ROOF_Y, rect: inner, allow: [], block: [hole2] });
  res.links.push({ a: STREET, b: f1, pts: [{ x: xa - 0.8, y: 0, z: zm1 }, { x: xb + 0.8, y: FLOOR1_Y, z: zm1 }] });
  res.links.push({ a: f1, b: roof, pts: [{ x: xb + 0.8, y: FLOOR1_Y, z: zm2 }, { x: xa - 0.8, y: ROOF_Y, z: zm2 }] });
  res.spots.push({ name: f1, label: '1. KAT', p: { x: (xb + ix1) / 2, y: FLOOR1_Y, z: (iz0 + iz1) / 2 + 1 } });
  res.spots.push({ name: roof, label: 'ÇATI', p: { x: (xb + ix1) / 2, y: ROOF_Y, z: (iz0 + iz1) / 2 } });
  res.houses.push({ x0, x1, z0, z1 });
}

function shadeHex(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

// ------------------------------------------------------------------ tunnel
const TY = TUNNEL_Y;
const TB = TY - 0.5; // bottom of tunnel walls/floor
const CEIL = 0.3;
const TILE = 0xd9d6cc, TILE2 = 0x3f7fbf;

/** Half of the tunnel (west corridor, west stairs, north stairs, west hall walls); mirrored for the rest. */
function tunnelHalf(o: Out, res: Omit<Structures, 'pieces' | 'pits'>, pits: Rect[]): void {
  const tw = 0.3;
  // west corridor x -40..-10, z -2.5..2.5
  o.wall('x', 2.5, 2.5 + tw, -40.3, -10, TB, 0, [], TILE);
  o.wall('x', -2.5 - tw, -2.5, -40.3, -10, TB, 0, [], TILE);
  o.add(box(-40, -10, -CEIL, 0, -2.8, 2.8), 'ceiling', 0x6f6c66);
  o.add(box(-40, -10, TY - 0.02, TY, -2.5, 2.5), 'tunnelFloor', 0x55524d, false);
  // blue stripe along the walls (visual)
  o.add(box(-40, -10, TY + 1.1, TY + 1.4, 2.48, 2.5), 'trim', TILE2, false);
  o.add(box(-40, -10, TY + 1.1, TY + 1.4, -2.5, -2.48), 'trim', TILE2, false);
  // west stairwell: x -45.6..-40, z -1.5..1.5, going down toward +x
  const pit: Rect = { x0: -45.6, x1: -40, z0: -1.5, z1: 1.5 };
  pits.push(pit);
  for (let i = 0; i < 15; i++) o.add(box(-45.6 + i * TREAD, -45.6 + (i + 1) * TREAD, TB, -(i + 1) * RISE, -1.5, 1.5), 'stair', 0x9d9a92);
  o.add(box(-40.35, -40, TY - 0.02, TY, -1.5, 1.5), 'tunnelFloor', 0x55524d, false);
  o.add(box(-45.6, -40, TB, 0, 1.5, 1.8), 'wall', TILE);
  o.add(box(-45.6, -40, TB, 0, -1.8, -1.5), 'wall', TILE);
  o.add(box(-40.3, -40, TB, 0, 1.8, 2.8), 'wall', TILE);
  o.add(box(-40.3, -40, TB, 0, -2.8, -1.8), 'wall', TILE);
  // street railing (open at the top step)
  const rc = 0x2c3540, rh = 1.05;
  o.add(box(-45.6, -40, 0, rh, 1.5, 1.62), 'rail', rc);
  o.add(box(-45.6, -40, 0, rh, -1.62, -1.5), 'rail', rc);
  o.add(box(-40.12, -40, 0, rh, -1.5, 1.5), 'rail', rc);
  metroSign(o, -46.4, 1.9);
  // north stairwell: x -1.5..1.5, z 6..11.6, going down toward -z into the hall
  const pitN: Rect = { x0: -1.5, x1: 1.5, z0: 6, z1: 11.6 };
  pits.push(pitN);
  for (let i = 0; i < 15; i++) o.add(box(-1.5, 1.5, TB, -(i + 1) * RISE, 11.6 - (i + 1) * TREAD, 11.6 - i * TREAD), 'stair', 0x9d9a92);
  o.add(box(-1.5, 1.5, TY - 0.02, TY, 6, 6.35), 'tunnelFloor', 0x55524d, false);
  o.add(box(1.5, 1.8, TB, 0, 6, 11.6), 'wall', TILE);
  o.add(box(-1.8, -1.5, TB, 0, 6, 11.6), 'wall', TILE);
  o.add(box(1.5, 1.62, 0, rh, 6, 11.6), 'rail', rc);
  o.add(box(-1.62, -1.5, 0, rh, 6, 11.6), 'rail', rc);
  o.add(box(-1.5, 1.5, 0, rh, 6, 6.12), 'rail', rc);
  metroSign(o, 1.95, 12.3);
  // hall walls (west side and north side)
  o.wall('z', -10.3, -10, 2.5, 6.3, TB, 0, [], TILE);
  o.wall('z', -10.3, -10, -6.3, -2.5, TB, 0, [], TILE);
  o.wall('x', 6, 6.3, -10.3, -1.8, TB, 0, [], TILE);
  o.wall('x', 6, 6.3, 1.8, 10.3, TB, 0, [], TILE);
  // pillars and cover
  o.add(box(-5.35, -4.65, TY, -CEIL, 2.65, 3.35), 'tile', TILE2);
  o.add(box(-5.35, -4.65, TY, -CEIL, -3.35, -2.65), 'tile', TILE2);
  o.add(box(-34.6, -33.4, TY, TY + 1.2, -2.3, -1.1), 'crate', 0xffffff);
  o.add(box(-25.6, -24.4, TY, TY + 1.2, 1.1, 2.3), 'crate', 0xffffff);
  o.add(box(-17, -15, TY, TY + 1.0, -2.3, -1.6), 'tile', 0xbfb9ad);
  o.add(box(-8, -6, TY, TY + 1.0, -0.4, 0.4), 'tile', 0xbfb9ad);
  // ceiling lights
  for (let x = -37.5; x < -10; x += 5) o.add(box(x - 0.7, x + 0.7, -CEIL - 0.05, -CEIL, -0.12, 0.12), 'glow', 0xffffff, false);
  // links
  res.links.push({ a: STREET, b: TUNNEL, pts: [{ x: -46.6, y: 0, z: 0 }, { x: -39.2, y: TY, z: 0 }] });
  res.links.push({ a: STREET, b: TUNNEL, pts: [{ x: 0, y: 0, z: 12.6 }, { x: 0, y: TY, z: 5.2 }] });
  res.spots.push({ name: TUNNEL, label: 'METRO', p: { x: -26, y: TY, z: 0 } });
}

/** Lit "M" totem next to a metro entrance (visual). */
function metroSign(o: Out, x: number, z: number): void {
  o.add(box(x - 0.08, x + 0.08, 0, 2.6, z - 0.08, z + 0.08), 'trim', 0x2c3540, false);
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
  const res: Omit<Structures, 'pieces' | 'pits'> = { levels: [], links: [], spots: [], houses: [], tunnel: [] };
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
  // shared centre pieces: hall ceiling, floor and lights, plus the tunnel level
  o.add(box(-10.3, 10.3, -CEIL, 0, -6.3, 6.3), 'ceiling', 0x6f6c66);
  o.add(box(-46, 46, TB, TY, -12, 12), 'hidden', 0); // collision floor under everything
  o.add(box(-10, 10, TY - 0.02, TY + 0.001, -6, 6), 'tunnelFloor', 0x4d4a46, false);
  for (const x of [-6, 0, 6]) for (const z of [-3.5, 3.5]) o.add(box(x - 0.9, x + 0.9, -CEIL - 0.05, -CEIL, z - 0.15, z + 0.15), 'glow', 0xffffff, false);
  const corridorW: Rect = { x0: -40, x1: -10, z0: -2.5, z1: 2.5 };
  const hall: Rect = { x0: -10, x1: 10, z0: -6, z1: 6 };
  res.tunnel = [corridorW, hall, mirrorRect(corridorW), ...pits];
  res.levels.push({ name: TUNNEL, y: TY, rect: { x0: -46, x1: 46, z0: -12, z1: 12 }, allow: [corridorW, hall, mirrorRect(corridorW)], block: [] });
  return { pieces: o.pieces, pits, ...res };
}
