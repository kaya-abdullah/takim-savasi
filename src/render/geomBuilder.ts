import * as THREE from 'three';

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const IDENT = new THREE.Matrix4();

export interface BoxOpts {
  uv?: 'world' | 'unit';
  uvScale?: number; // metres per texture repeat for world UVs
  uvScaleY?: number;
  skipTop?: boolean;
  skipBottom?: boolean;
  onlyTop?: boolean;
}

/**
 * Accumulates many small pieces into one non-indexed geometry with vertex
 * colours, so a whole class of static objects renders in a single draw call.
 */
export class GeomBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  skin?: { idx: number[]; w: number[] };

  constructor(skinned = false) {
    if (skinned) this.skin = { idx: [], w: [] };
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  add(
    g: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    m: THREE.Matrix4 = IDENT,
    filter?: (nx: number, ny: number, nz: number) => boolean,
    bone = 0,
  ): void {
    const src = g.index ? g.toNonIndexed() : g;
    const P = src.getAttribute('position');
    const N = src.getAttribute('normal');
    const U = src.getAttribute('uv');
    _nm.getNormalMatrix(m);
    // ColorManagement converts the sRGB hex to linear, as vertex colours expect.
    _c.set(color);
    for (let i = 0; i < P.count; i += 3) {
      if (filter) {
        _n.fromBufferAttribute(N, i);
        if (!filter(_n.x, _n.y, _n.z)) continue;
      }
      for (let k = 0; k < 3; k++) {
        const j = i + k;
        _p.fromBufferAttribute(P, j).applyMatrix4(m);
        this.pos.push(_p.x, _p.y, _p.z);
        _n.fromBufferAttribute(N, j).applyMatrix3(_nm).normalize();
        this.nor.push(_n.x, _n.y, _n.z);
        if (U) this.uv.push(U.getX(j), U.getY(j));
        else this.uv.push(0, 0);
        this.col.push(_c.r, _c.g, _c.b);
        if (this.skin) {
          this.skin.idx.push(bone, 0, 0, 0);
          this.skin.w.push(1, 0, 0, 0);
        }
      }
    }
    if (src !== g) src.dispose();
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, m: THREE.Matrix4 = IDENT, o: BoxOpts = {}): void {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(cx, cy, cz);
    if (o.uv === 'world') worldUV(g, o.uvScale ?? 4, o.uvScaleY ?? o.uvScale ?? 4);
    const filter = o.onlyTop
      ? (_x: number, ny: number) => ny > 0.5
      : o.skipTop || o.skipBottom
        ? (_x: number, ny: number) => !((o.skipTop && ny > 0.5) || (o.skipBottom && ny < -0.5))
        : undefined;
    this.add(g, color, m, filter);
    g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.skin) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin.idx, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skin.w, 4));
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Planar world-space UVs chosen per face from the face normal. */
export function worldUV(g: THREE.BufferGeometry, su: number, sv: number): void {
  const P = g.getAttribute('position');
  const N = g.getAttribute('normal');
  const U = g.getAttribute('uv');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i));
    if (ny > 0.5) U.setXY(i, x / su, z / su);
    else if (nx > 0.5) U.setXY(i, z / su, y / sv);
    else U.setXY(i, x / su, y / sv);
  }
  U.needsUpdate = true;
}

export function rotY(angle: number, x = 0, z = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(angle).setPosition(x, 0, z);
}
