import type { AABB } from './collision';
import type { V2 } from './map';

/** Walkability grid + A* for bots. One cell = CELL metres. */
export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly walk: Uint8Array;
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private closed: Uint32Array;
  private open: Uint32Array;
  private searchId = 1;

  constructor(readonly minX: number, readonly minZ: number, maxX: number, maxZ: number, boxes: AABB[], readonly cell = 1, agentR = 0.5) {
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    const n = this.w * this.h;
    this.walk = new Uint8Array(n).fill(1);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.closed = new Uint32Array(n);
    this.open = new Uint32Array(n);
    for (let iz = 0; iz < this.h; iz++)
      for (let ix = 0; ix < this.w; ix++) {
        if (ix === 0 || iz === 0 || ix === this.w - 1 || iz === this.h - 1) { this.walk[iz * this.w + ix] = 0; continue; }
      }
    for (const b of boxes) {
      if (b.minY > 1.6) continue;
      const x0 = Math.floor((b.minX - agentR - minX) / cell), x1 = Math.floor((b.maxX + agentR - minX) / cell);
      const z0 = Math.floor((b.minZ - agentR - minZ) / cell), z1 = Math.floor((b.maxZ + agentR - minZ) / cell);
      for (let iz = Math.max(0, z0); iz <= Math.min(this.h - 1, z1); iz++)
        for (let ix = Math.max(0, x0); ix <= Math.min(this.w - 1, x1); ix++) {
          // cell centre must be outside the inflated box to stay walkable
          const cx = minX + (ix + 0.5) * cell, cz = minZ + (iz + 0.5) * cell;
          if (cx > b.minX - agentR && cx < b.maxX + agentR && cz > b.minZ - agentR && cz < b.maxZ + agentR)
            this.walk[iz * this.w + ix] = 0;
        }
    }
  }

  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)];
  }
  center(ix: number, iz: number): V2 {
    return { x: this.minX + (ix + 0.5) * this.cell, z: this.minZ + (iz + 0.5) * this.cell };
  }
  isWalkable(ix: number, iz: number): boolean {
    return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h && this.walk[iz * this.w + ix] === 1;
  }
  walkableAt(x: number, z: number): boolean {
    const [ix, iz] = this.toCell(x, z);
    return this.isWalkable(ix, iz);
  }

  /** Nearest walkable cell centre (spiral search). */
  nearestWalkable(x: number, z: number, maxR = 12): V2 | null {
    const [cx, cz] = this.toCell(x, z);
    if (this.isWalkable(cx, cz)) return this.center(cx, cz);
    for (let r = 1; r <= maxR; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (this.isWalkable(cx + dx, cz + dz)) return this.center(cx + dx, cz + dz);
        }
    return null;
  }

  /** Straight walkable line between two points (grid supercover sampling). */
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.35));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      if (!this.walkableAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /** A* with 8-neighbours and no corner cutting; result is smoothed. */
  findPath(sx: number, sz: number, tx: number, tz: number, maxNodes = 6000): V2[] | null {
    const s0 = this.nearestWalkable(sx, sz, 4), t0 = this.nearestWalkable(tx, tz, 8);
    if (!s0 || !t0) return null;
    const [six, siz] = this.toCell(s0.x, s0.z);
    const [tix, tiz] = this.toCell(t0.x, t0.z);
    const W = this.w;
    const start = siz * W + six, goal = tiz * W + tix;
    const id = ++this.searchId;
    // binary heap of node indices keyed by f
    const heap: number[] = [];
    const push = (n: number) => {
      heap.push(n);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.f[heap[p]] <= this.f[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
          if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const hfn = (ix: number, iz: number) => {
      const dx = Math.abs(ix - tix), dz = Math.abs(iz - tiz);
      return Math.max(dx, dz) + 0.41421 * Math.min(dx, dz);
    };
    this.g[start] = 0;
    this.f[start] = hfn(six, siz);
    this.parent[start] = -1;
    this.open[start] = id;
    push(start);
    let expanded = 0;
    let found = false;
    while (heap.length) {
      const cur = pop();
      if (this.closed[cur] === id) continue;
      this.closed[cur] = id;
      if (cur === goal) { found = true; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.isWalkable(nx, nz)) continue;
          if (dx && dz && (!this.isWalkable(cx + dx, cz) || !this.isWalkable(cx, cz + dz))) continue;
          const n = nz * W + nx;
          if (this.closed[n] === id) continue;
          const ng = this.g[cur] + (dx && dz ? 1.41421 : 1);
          if (this.open[n] === id && ng >= this.g[n]) continue;
          this.open[n] = id;
          this.g[n] = ng;
          this.f[n] = ng + hfn(nx, nz);
          this.parent[n] = cur;
          push(n);
        }
    }
    if (!found) return null;
    const cells: V2[] = [];
    for (let n = goal; n !== -1; n = this.parent[n]) cells.push(this.center(n % W, (n / W) | 0));
    cells.reverse();
    cells[cells.length - 1] = t0;
    return this.smooth(cells);
  }

  private smooth(pts: V2[]): V2[] {
    if (pts.length <= 2) return pts;
    const out: V2[] = [pts[0]];
    let anchor = 0;
    while (anchor < pts.length - 1) {
      let far = anchor + 1;
      for (let j = pts.length - 1; j > anchor + 1; j--) {
        if (this.lineWalkable(pts[anchor].x, pts[anchor].z, pts[j].x, pts[j].z)) { far = j; break; }
      }
      out.push(pts[far]);
      anchor = far;
    }
    return out;
  }
}
