export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface RayHit {
  t: number;
  nx: number; ny: number; nz: number;
}

const CELL = 8;

/**
 * Static world collision. Boxes are bucketed in a uniform XZ grid so raycasts
 * and overlap queries only test nearby boxes.
 */
export class CollisionWorld {
  readonly boxes: AABB[];
  private cells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private stampId = 1;

  constructor(boxes: AABB[], readonly minX: number, readonly minZ: number, readonly maxX: number, readonly maxZ: number) {
    this.boxes = boxes;
    this.stamp = new Uint32Array(boxes.length);
    boxes.forEach((b, i) => {
      const cx0 = Math.floor(b.minX / CELL), cx1 = Math.floor(b.maxX / CELL);
      const cz0 = Math.floor(b.minZ / CELL), cz1 = Math.floor(b.maxZ / CELL);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cz = cz0; cz <= cz1; cz++) {
          const k = key(cx, cz);
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(i);
        }
    });
  }

  /** Calls fn for each box overlapping the XZ rectangle (each box once). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, fn: (b: AABB) => void): void {
    const id = this.nextStamp();
    const cx0 = Math.floor(minX / CELL), cx1 = Math.floor(maxX / CELL);
    const cz0 = Math.floor(minZ / CELL), cz1 = Math.floor(maxZ / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.cells.get(key(cx, cz));
        if (!arr) continue;
        for (const i of arr) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          fn(this.boxes[i]);
        }
      }
  }

  private nextStamp(): number {
    this.stampId++;
    if (this.stampId > 0xfffffff0) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  /**
   * Ray vs boxes and ground plane (y = 0). Direction need not be normalised;
   * t is in units of the direction length. Returns null when nothing is hit
   * before maxT.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxT;
    if (dy < 0 && oy > 0) {
      const t = -oy / dy;
      if (t < bestT) { bestT = t; best = { t, nx: 0, ny: 1, nz: 0 }; }
    }
    // Walk the grid cells the ray crosses (2D DDA in XZ).
    const id = this.nextStamp();
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / Math.abs(dx)) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / Math.abs(dz)) : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 256; guard++) {
      const arr = this.cells.get(key(cx, cz));
      if (arr) {
        for (const i of arr) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          const h = rayBox(ox, oy, oz, dx, dy, dz, this.boxes[i], bestT);
          if (h) { bestT = h.t; best = h; }
        }
      }
      if (bestT <= tCell) break;
      if (tMaxX < tMaxZ) { tCell = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else { tCell = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
      if (tCell > bestT) break;
    }
    return best;
  }

  /** True when the straight segment a->b hits no box and stays above ground. */
  segmentClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return this.raycast(ax, ay, az, bx - ax, by - ay, bz - az, 1) === null;
  }

  /**
   * Pushes a vertical cylinder (feet at y, given height) out of boxes it
   * overlaps. Boxes whose top is within stepUp of the feet are ignored (they
   * are handled by groundHeight). Returns the corrected position.
   */
  resolveCircle(x: number, z: number, r: number, y: number, height: number, stepUp = 0.35): { x: number; z: number } {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(x - r, z - r, x + r, z + r, (b) => {
        if (b.maxY <= y + stepUp || b.minY >= y + height) return;
        const px = clamp(x, b.minX, b.maxX), pz = clamp(z, b.minZ, b.maxZ);
        let ddx = x - px, ddz = z - pz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= r * r) return;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = px + (ddx / d) * r;
          z = pz + (ddz / d) * r;
        } else {
          // Centre is inside the box: push out along the shortest axis.
          const left = x - b.minX, right = b.maxX - x, back = z - b.minZ, front = b.maxZ - z;
          const m = Math.min(left, right, back, front);
          if (m === left) x = b.minX - r;
          else if (m === right) x = b.maxX + r;
          else if (m === back) z = b.minZ - r;
          else z = b.maxZ + r;
        }
        moved = true;
      });
      if (!moved) break;
    }
    x = clamp(x, this.minX + r, this.maxX - r);
    z = clamp(z, this.minZ + r, this.maxZ - r);
    return { x, z };
  }

  /** Highest walkable surface under the circle, no higher than y + stepUp. */
  groundHeight(x: number, z: number, r: number, y: number, stepUp = 0.35): number {
    let g = 0;
    this.query(x - r, z - r, x + r, z + r, (b) => {
      if (b.maxY > y + stepUp) return;
      if (x + r * 0.6 < b.minX || x - r * 0.6 > b.maxX || z + r * 0.6 < b.minZ || z - r * 0.6 > b.maxZ) return;
      if (b.maxY > g) g = b.maxY;
    });
    return g;
  }

  /** Is the point (feet) inside any blocking box? */
  blocked(x: number, z: number, r: number, y = 0, height = 1.8): boolean {
    let hit = false;
    this.query(x - r, z - r, x + r, z + r, (b) => {
      if (hit || b.maxY <= y + 0.35 || b.minY >= y + height) return;
      const px = clamp(x, b.minX, b.maxX), pz = clamp(z, b.minZ, b.maxZ);
      if ((x - px) ** 2 + (z - pz) ** 2 < r * r) hit = true;
    });
    return hit;
  }
}

function key(cx: number, cz: number): number {
  return (cx + 512) * 1024 + (cz + 512);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Slab test. Returns the entry hit with its face normal, or null. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: AABB, maxT: number): RayHit | null {
  let tmin = 0, tmax = maxT;
  let nAxis = -1, nSign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < mn[a] || o[a] > mx[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (mn[a] - o[a]) * inv, t2 = (mx[a] - o[a]) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis === -1) return null; // origin inside box: ignore (avoids self-hits)
  return { t: tmin, nx: nAxis === 0 ? nSign : 0, ny: nAxis === 1 ? nSign : 0, nz: nAxis === 2 ? nSign : 0 };
}

/**
 * Ray vs vertical capsule-ish target (cylinder body + sphere head).
 * Returns t and whether the head was hit.
 */
export function rayCharacter(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number,
  cx: number, cy: number, cz: number, bodyR: number, bodyH: number, headY: number, headR: number,
): { t: number; head: boolean } | null {
  let best: { t: number; head: boolean } | null = null;
  // head sphere
  {
    const lx = ox - cx, ly = oy - (cy + headY), lz = oz - cz;
    const a = dx * dx + dy * dy + dz * dz;
    const bq = 2 * (lx * dx + ly * dy + lz * dz);
    const c = lx * lx + ly * ly + lz * lz - headR * headR;
    const disc = bq * bq - 4 * a * c;
    if (disc >= 0) {
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= maxT) best = { t, head: true };
    }
  }
  // body cylinder (infinite in 2D, clipped by y)
  {
    const lx = ox - cx, lz = oz - cz;
    const a = dx * dx + dz * dz;
    if (a > 1e-12) {
      const bq = 2 * (lx * dx + lz * dz);
      const c = lx * lx + lz * lz - bodyR * bodyR;
      const disc = bq * bq - 4 * a * c;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        for (const t of [(-bq - s) / (2 * a), (-bq + s) / (2 * a)]) {
          if (t < 0 || t > maxT) continue;
          const y = oy + dy * t;
          if (y >= cy && y <= cy + bodyH) {
            if (!best || t < best.t) best = { t, head: false };
            break;
          }
        }
      }
    }
  }
  return best;
}
