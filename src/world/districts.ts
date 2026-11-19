import type { Rect } from './collision';
import type { Building, Prop, PropKind, V2, Zone } from './map';
import { PROP_SIZE } from './map';
import type { HouseSpec } from './structures';

/**
 * Outer districts around the city centre. Every block gets its own kind of
 * place (downtown tower, park, container port, market, housing, car park,
 * industry, sports field, fuel depot, low-rise walk-in) and a seeded layout,
 * so no two corners of the city look alike.
 */

export type DistrictKind =
  | 'downtown' | 'park' | 'port' | 'market' | 'housing' | 'parking' | 'industry' | 'field' | 'depot' | 'lowrise';

export interface DistrictOut {
  buildings: Building[];
  props: Prop[];
  towers: HouseSpec[];
  zones: Zone[];
  pois: V2[];
  districts: { name: string; x0: number; x1: number; z0: number; z1: number }[];
}

export const DISTRICT_NAMES: Record<DistrictKind, string> = {
  downtown: 'GÖKDELEN', park: 'PARK', port: 'LİMAN', market: 'PAZAR', housing: 'MAHALLE',
  parking: 'OTOPARK', industry: 'SANAYİ', field: 'SAHA', depot: 'DEPO', lowrise: 'HAN',
};

/** Sidewalk kept free along every block edge. */
const WALK = 2.5;
const FACADE_COLORS = [0xd9cbb3, 0xb86b4b, 0x7fa6b8, 0xe0dccf, 0xc9b48f, 0x8a9bb0, 0xc4c9cf, 0xa65d57, 0x6f7f6a, 0x9c8f7a, 0xd6c6a0, 0x8f6f5f];
const BRICK_COLORS = [0xb86b4b, 0x9f5a44, 0xc08060, 0x8c5240, 0xa86f55, 0x7f6a5a];
const CONTAINER_COLORS = [0x2f6db5, 0xb5452f, 0x3f8f4a, 0xd08a2c, 0x7a3fa0, 0x2a8a8a, 0xb0b0b0];

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

interface Ctx {
  r: () => number;
  out: DistrictOut;
  /** Footprints already used in this block (with their own clearance). */
  used: Rect[];
}

const overlaps = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

function free(c: Ctx, r: Rect, m: number): boolean {
  return !c.used.some((u) => overlaps(u, r, m));
}

function prop(c: Ctx, kind: PropKind, x: number, z: number, rot: 0 | 1 = 0, color = 0xffffff, margin = 0.6): boolean {
  const [l, w] = PROP_SIZE[kind];
  const hx = (rot === 0 ? l : w) / 2, hz = (rot === 0 ? w : l) / 2;
  const r = { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
  if (!free(c, r, margin)) return false;
  c.used.push(r);
  c.out.props.push({ kind, x, z, rot, color });
  return true;
}

function building(c: Ctx, x0: number, x1: number, z0: number, z1: number, h: number, style: number, color?: number): void {
  c.used.push({ x0, x1, z0, z1 });
  c.out.buildings.push({ x0, x1, z0, z1, h, style, color: color ?? FACADE_COLORS[Math.floor(c.r() * FACADE_COLORS.length)] });
}

function tower(c: Ctx, x0: number, z0: number, w: number, d: number, floors: number): void {
  // doors open on the +x and +z sides: keep 4 m clear in front of them
  c.used.push({ x0, x1: x0 + w, z0, z1: z0 + d });
  c.used.push({ x0: x0 + w, x1: x0 + w + 4, z0, z1: z0 + d });
  c.used.push({ x0, x1: x0 + w, z0: z0 + d, z1: z0 + d + 4 });
  c.out.towers.push({ x0, x1: x0 + w, z0, z1: z0 + d, color: BRICK_COLORS[Math.floor(c.r() * BRICK_COLORS.length)], floors, seed: Math.floor(c.r() * 3) });
  c.out.pois.push({ x: x0 + w + 2.5, z: z0 + d / 2 }, { x: x0 + w / 2, z: z0 + d + 2.5 });
}

/** Scatter n props of a kind at random free spots inside the rect. */
function scatter(c: Ctx, rect: Rect, n: number, kind: PropKind, margin = 1.2, color?: () => number): void {
  for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
    const x = rect.x0 + c.r() * (rect.x1 - rect.x0), z = rect.z0 + c.r() * (rect.z1 - rect.z0);
    const rot = (c.r() < 0.5 ? 0 : 1) as 0 | 1;
    const [l, w] = PROP_SIZE[kind];
    const hx = (rot === 0 ? l : w) / 2, hz = (rot === 0 ? w : l) / 2;
    if (x - hx < rect.x0 || x + hx > rect.x1 || z - hz < rect.z0 || z + hz > rect.z1) continue;
    if (prop(c, kind, x, z, rot, color ? color() : 0xffffff, margin)) i++;
  }
}

/** A short line of cover (sandbags / low wall) with a gap to walk through. */
function coverLine(c: Ctx, x: number, z: number, along: 'x' | 'z', kind: 'sandbag' | 'wall', n: number): void {
  const len = PROP_SIZE[kind][0];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * (len + 1.4);
    prop(c, kind, along === 'x' ? x + off : x, along === 'x' ? z : z + off, along === 'x' ? 0 : 1, 0xffffff, 0.3);
  }
}

// ------------------------------------------------------------------ district kinds

function downtown(c: Ctx, b: Rect, floors: number): void {
  // walk-in tower in the low corner, a glass skyscraper diagonally opposite, a plaza between
  const tw = Math.min(18, b.x1 - b.x0 - 12), td = 14;
  tower(c, b.x0, b.z0, tw, td, floors);
  const sw = Math.min(14, b.x1 - b.x0 - tw - 6), sd = Math.min(16, b.z1 - b.z0 - td - 8);
  if (sw > 7 && sd > 7) building(c, b.x1 - sw, b.x1, b.z1 - sd, b.z1, 28 + Math.floor(c.r() * 20), 3);
  const plaza = { x0: b.x0, x1: b.x1, z0: b.z0 + td + 4.5, z1: b.z1 };
  scatter(c, plaza, 4, 'tree', 2.5);
  scatter(c, plaza, 3, 'lamp', 3);
  scatter(c, plaza, 3, 'wall', 2);
  scatter(c, { x0: b.x0 + tw + 4.5, x1: b.x1, z0: b.z0, z1: b.z0 + td }, 2, 'crate', 1.5);
  c.out.pois.push({ x: (b.x0 + b.x1) / 2, z: (plaza.z0 + plaza.z1) / 2 });
}

function lowrise(c: Ctx, b: Rect): void {
  const w = Math.min(16, b.x1 - b.x0 - 5), d = 13;
  const z0 = b.z0 + Math.floor(c.r() * Math.max(1, b.z1 - b.z0 - d - 6));
  tower(c, b.x0, z0, w, d, 3);
  // building-site clutter round it
  const rest = { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 };
  scatter(c, rest, 5, 'crate', 1.2);
  scatter(c, rest, 3, 'sandbag', 1.5);
  scatter(c, rest, 4, 'barrel', 1.2);
  scatter(c, rest, 1, 'container', 2, () => CONTAINER_COLORS[Math.floor(c.r() * CONTAINER_COLORS.length)]);
  c.out.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
}

function park(c: Ctx, b: Rect): void {
  c.out.zones.push({ kind: 'grass', ...b });
  // a loose grid of trees with jitter, benches (low walls) along two paths
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  for (let x = b.x0 + 3; x < b.x1 - 2; x += 6.5)
    for (let z = b.z0 + 3; z < b.z1 - 2; z += 6.5) {
      if (Math.abs(x - cx) < 2.5 || Math.abs(z - cz) < 2.5) continue; // paths stay open
      if (c.r() < 0.72) prop(c, 'tree', x + (c.r() - 0.5) * 2.5, z + (c.r() - 0.5) * 2.5, 0, 0xffffff, 1.2);
    }
  for (const z of [cz - 9, cz + 9]) prop(c, 'wall', cx + 3.5, z, 1, 0xffffff, 0.8);
  prop(c, 'lamp', cx + 2.2, cz + 2.2);
  prop(c, 'lamp', cx - 2.2, cz - 2.2);
  scatter(c, b, 2, 'sandbag', 2);
  c.out.pois.push({ x: cx, z: cz }, { x: cx, z: b.z0 + 4 }, { x: cx, z: b.z1 - 4 });
}

function port(c: Ctx, b: Rect): void {
  c.out.zones.push({ kind: 'gravel', ...b });
  // container rows with lanes between them; some rows broken up so it is not a grid
  const alongX = b.x1 - b.x0 > b.z1 - b.z0;
  const col = () => CONTAINER_COLORS[Math.floor(c.r() * CONTAINER_COLORS.length)];
  if (alongX) {
    for (let z = b.z0 + 2.5; z < b.z1 - 2; z += 6.5)
      for (let x = b.x0 + 4; x < b.x1 - 3; x += 7.4) if (c.r() < 0.7) prop(c, 'container', x + (c.r() - 0.5), z, 0, col(), 0.3);
  } else {
    for (let x = b.x0 + 2.5; x < b.x1 - 2; x += 6.5)
      for (let z = b.z0 + 4; z < b.z1 - 3; z += 7.4) if (c.r() < 0.7) prop(c, 'container', x, z + (c.r() - 0.5), 1, col(), 0.3);
  }
  scatter(c, b, 6, 'barrel', 1);
  scatter(c, b, 4, 'crate', 1);
  scatter(c, b, 2, 'lamp', 2);
  c.out.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }, { x: b.x0 + 3, z: b.z0 + 3 }, { x: b.x1 - 3, z: b.z1 - 3 });
}

function market(c: Ctx, b: Rect): void {
  // stall rows: a low counter (wall) with crates and barrels behind, aisles between rows
  for (let z = b.z0 + 3; z < b.z1 - 2; z += 7) {
    for (let x = b.x0 + 3; x < b.x1 - 2; x += 6) {
      if (c.r() < 0.25) continue;
      if (prop(c, 'wall', x, z, 0, 0xffffff, 0.4)) {
        prop(c, 'crate', x + (c.r() - 0.5) * 2, z + 1.8, 0, 0xffffff, 0.2);
        if (c.r() < 0.5) prop(c, 'barrel', x + 1.6, z + 1.6, 0, 0xffffff, 0.2);
      }
    }
  }
  scatter(c, b, 3, 'tree', 1.5);
  scatter(c, b, 2, 'lamp', 2);
  c.out.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }, { x: b.x0 + 4, z: b.z1 - 4 });
}

function housing(c: Ctx, b: Rect): void {
  // three or four houses of different height and colour with yards between
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const n = d > 30 ? 3 : 2;
  const step = d / n;
  for (let i = 0; i < n; i++) {
    const hw = Math.min(w - 6, 9 + c.r() * 7), hd = Math.min(step - 6, 8 + c.r() * 5);
    const left = c.r() < 0.5;
    const x0 = left ? b.x0 : b.x1 - hw;
    const z0 = b.z0 + i * step + (step - hd) / 2;
    building(c, x0, x0 + hw, z0, z0 + hd, 6 + Math.floor(c.r() * 12), Math.floor(c.r() * 4));
  }
  scatter(c, b, 3, 'tree', 1.5);
  scatter(c, b, 2, 'sandbag', 1.5);
  scatter(c, b, 3, 'crate', 1);
  scatter(c, b, 2, 'barrel', 1);
  c.out.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
}

function parking(c: Ctx, b: Rect): void {
  c.out.zones.push({ kind: 'lot', ...b });
  // low concrete dividers between bays, lamps, a ticket booth (crates)
  const alongX = b.x1 - b.x0 > b.z1 - b.z0;
  if (alongX) for (let z = b.z0 + 8; z < b.z1 - 6; z += 12) for (let x = b.x0 + 5; x < b.x1 - 4; x += 9) prop(c, 'wall', x, z, 0, 0xffffff, 0.3);
  else for (let x = b.x0 + 8; x < b.x1 - 6; x += 12) for (let z = b.z0 + 5; z < b.z1 - 4; z += 9) prop(c, 'wall', x, z, 1, 0xffffff, 0.3);
  scatter(c, b, 4, 'lamp', 3);
  scatter(c, b, 2, 'crate', 2);
  c.out.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }, { x: b.x0 + 4, z: b.z0 + 4 });
}

function industry(c: Ctx, b: Rect): void {
  c.out.zones.push({ kind: 'gravel', ...b });
  // one long warehouse and a smaller workshop, a yard with containers and drums
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const ww = w - 8, wd = Math.min(14, d * 0.38);
  building(c, b.x0 + 4, b.x0 + 4 + ww, b.z1 - wd, b.z1, 8 + Math.floor(c.r() * 3), 0, 0x8f8a80);
  building(c, b.x0, b.x0 + Math.min(10, w * 0.35), b.z0, b.z0 + 9, 6, 2, 0x9a9f8a);
  const yard = { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 - wd };
  scatter(c, yard, 3, 'container', 2, () => CONTAINER_COLORS[Math.floor(c.r() * CONTAINER_COLORS.length)]);
  scatter(c, yard, 7, 'barrel', 1);
  scatter(c, yard, 3, 'crate', 1);
  scatter(c, yard, 1, 'lamp', 2);
  c.out.pois.push({ x: (b.x0 + b.x1) / 2, z: (yard.z0 + yard.z1) / 2 });
}

function field(c: Ctx, b: Rect): void {
  c.out.zones.push({ kind: 'grass', ...b });
  // an open pitch: low walls along the long sides, sandbag nests at the ends
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const alongZ = b.z1 - b.z0 > b.x1 - b.x0;
  if (alongZ) {
    for (let z = b.z0 + 5; z < b.z1 - 4; z += 9) { prop(c, 'wall', b.x0 + 1, z, 1); prop(c, 'wall', b.x1 - 1, z, 1); }
    coverLine(c, cx, b.z0 + 6, 'x', 'sandbag', 2);
    coverLine(c, cx, b.z1 - 6, 'x', 'sandbag', 2);
  } else {
    for (let x = b.x0 + 5; x < b.x1 - 4; x += 9) { prop(c, 'wall', x, b.z0 + 1, 0); prop(c, 'wall', x, b.z1 - 1, 0); }
    coverLine(c, b.x0 + 6, cz, 'z', 'sandbag', 2);
    coverLine(c, b.x1 - 6, cz, 'z', 'sandbag', 2);
  }
  prop(c, 'crate', cx, cz);
  for (const [x, z] of [[b.x0 + 2, b.z0 + 2], [b.x1 - 2, b.z1 - 2]]) prop(c, 'tree', x, z);
  c.out.pois.push({ x: cx, z: cz });
}

function depot(c: Ctx, b: Rect): void {
  c.out.zones.push({ kind: 'gravel', ...b });
  // fuel drums in clusters behind sandbag walls, two tanks (containers), a guard post
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  for (let k = 0; k < 5; k++) {
    const x = b.x0 + 4 + c.r() * (b.x1 - b.x0 - 8), z = b.z0 + 4 + c.r() * (b.z1 - b.z0 - 8);
    for (let i = 0; i < 4; i++) prop(c, 'barrel', x + (i % 2) * 0.85, z + Math.floor(i / 2) * 0.85, 0, 0xffffff, 0.05);
  }
  scatter(c, b, 2, 'container', 2, () => CONTAINER_COLORS[Math.floor(c.r() * CONTAINER_COLORS.length)]);
  coverLine(c, cx, cz - 6, 'x', 'sandbag', 2);
  coverLine(c, cx, cz + 6, 'x', 'sandbag', 2);
  scatter(c, b, 2, 'crate', 1);
  scatter(c, b, 1, 'lamp', 2);
  c.out.pois.push({ x: cx, z: cz });
}

export interface BlockSpec { kind: DistrictKind; rect: Rect; floors?: number; seed: number }

export function buildDistricts(blocks: BlockSpec[]): DistrictOut {
  const out: DistrictOut = { buildings: [], props: [], towers: [], zones: [], pois: [], districts: [] };
  for (const bl of blocks) {
    const inner = { x0: bl.rect.x0 + WALK, x1: bl.rect.x1 - WALK, z0: bl.rect.z0 + WALK, z1: bl.rect.z1 - WALK };
    const c: Ctx = { r: rng(bl.seed), out, used: [] };
    out.districts.push({ name: DISTRICT_NAMES[bl.kind], ...bl.rect });
    switch (bl.kind) {
      case 'downtown': downtown(c, inner, bl.floors ?? 5); break;
      case 'lowrise': lowrise(c, inner); break;
      case 'park': park(c, inner); break;
      case 'port': port(c, inner); break;
      case 'market': market(c, inner); break;
      case 'housing': housing(c, inner); break;
      case 'parking': parking(c, inner); break;
      case 'industry': industry(c, inner); break;
      case 'field': field(c, inner); break;
      case 'depot': depot(c, inner); break;
    }
  }
  return out;
}
