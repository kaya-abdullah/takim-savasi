import type { AABB } from './collision';
import type { MapData } from './map';
import { NavGrid } from './navgrid';
import { STREET, type P3 } from './structures';

/** A path point. `link` marks points on a stair run (no repathing while on them). */
export interface WayPoint extends P3 { link?: boolean }

interface Level {
  name: string;
  y: number;
  x0: number; x1: number; z0: number; z1: number;
  grid: NavGrid;
}

interface Link { a: number; b: number; pts: P3[] }

/**
 * Multi-level navigation: one walk grid per floor (street, each upper floor
 * and roof, the tunnel) joined by stair links. Paths are planned level by
 * level through the link graph.
 */
export class NavWorld {
  readonly levels: Level[] = [];
  readonly links: Link[] = [];
  /** Level-graph adjacency: for each level, the outgoing links (both directions stored). */
  private adj: Link[][] = [];

  constructor(map: MapData, boxes: AABB[]) {
    const s = map.structures;
    const street = new NavGrid(map.minX, map.minZ, map.maxX, map.maxZ, boxes, 1, 0.5, { baseY: 0, block: s.pits });
    this.levels.push({ name: STREET, y: 0, x0: map.minX, x1: map.maxX, z0: map.minZ, z1: map.maxZ, grid: street });
    for (const l of s.levels) {
      const pad = 1; // one cell of margin so the outer walls sit inside the grid
      const grid = new NavGrid(l.rect.x0 - pad, l.rect.z0 - pad, l.rect.x1 + pad, l.rect.z1 + pad, boxes, 1, 0.5, {
        baseY: l.y, allow: l.allow.length ? l.allow : [l.rect], block: l.block,
      });
      this.levels.push({ name: l.name, y: l.y, x0: l.rect.x0, x1: l.rect.x1, z0: l.rect.z0, z1: l.rect.z1, grid });
    }
    const idx = (n: string) => this.levels.findIndex((l) => l.name === n);
    for (const l of s.links) {
      const a = idx(l.a), b = idx(l.b);
      if (a < 0 || b < 0) continue;
      this.links.push({ a, b, pts: l.pts }, { a: b, b: a, pts: [...l.pts].reverse() });
    }
    this.adj = this.levels.map((_, i) => this.links.filter((k) => k.a === i));
  }

  get street(): NavGrid {
    return this.levels[0].grid;
  }

  /** The floor someone at (x, y, z) stands on: the highest level at or just below the feet. */
  levelAt(x: number, y: number, z: number): number {
    let best = 0, bestY = -Infinity;
    for (let i = 0; i < this.levels.length; i++) {
      const l = this.levels[i];
      if (x < l.x0 || x > l.x1 || z < l.z0 || z > l.z1) continue;
      if (l.y <= y + 0.8 && l.y > bestY) { bestY = l.y; best = i; }
    }
    return best;
  }

  levelName(x: number, y: number, z: number): string {
    return this.levels[this.levelAt(x, y, z)].name;
  }

  walkableAt(x: number, y: number, z: number): boolean {
    return this.levels[this.levelAt(x, y, z)].grid.walkableAt(x, z);
  }

  /** Breadth-first search over the level graph; returns the links to take. */
  private route(from: number, to: number): Link[] | null {
    if (from === to) return [];
    const prev = new Map<number, Link>();
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const cur = q.shift()!;
      for (const k of this.adj[cur]) {
        if (seen.has(k.b)) continue;
        seen.add(k.b);
        prev.set(k.b, k);
        if (k.b === to) {
          const out: Link[] = [];
          for (let n = to; n !== from; n = prev.get(n)!.a) out.unshift(prev.get(n)!);
          return out;
        }
        q.push(k.b);
      }
    }
    return null;
  }

  /** Path from one 3D point to another across floors, or null when unreachable. */
  findPath(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number): WayPoint[] | null {
    const la = this.levelAt(sx, sy, sz), lb = this.levelAt(tx, ty, tz);
    const route = this.route(la, lb);
    if (!route) return null;
    const out: WayPoint[] = [];
    let cx = sx, cz = sz, cl = la;
    const leg = (ex: number, ez: number): boolean => {
      const lv = this.levels[cl];
      const p = lv.grid.findPath(cx, cz, ex, ez);
      if (!p) return false;
      // the grid snaps the start to a cell centre: drop it so we don't walk back
      for (let i = out.length === 0 ? 1 : 0; i < p.length; i++) out.push({ x: p[i].x, y: lv.y, z: p[i].z });
      return true;
    };
    for (const k of route) {
      const first = k.pts[0];
      if (!leg(first.x, first.z)) return null;
      for (const p of k.pts) out.push({ x: p.x, y: p.y, z: p.z, link: true });
      const last = k.pts[k.pts.length - 1];
      cx = last.x; cz = last.z; cl = k.b;
    }
    if (!leg(tx, tz)) return null;
    return out;
  }
}
