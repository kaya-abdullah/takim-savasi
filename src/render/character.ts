import * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeomBuilder } from './geomBuilder';
import { makeWeaponMesh } from './weaponModel';

export type Team = 'blue' | 'red';

const PAL = {
  blue: { uniform: 0x2f4664, vest: 0x2f6fe0, helmet: 0x223a5e, accent: 0x7fd0ff },
  red: { uniform: 0x5e2c2c, vest: 0xd8402f, helmet: 0x5a2420, accent: 0xffb07a },
};
const SKIN = 0xe0b48f, BOOT = 0x2a2522, GLOVE = 0x262626, BELT = 0x3a3128, GOGGLE = 0x30363e;

enum BoneId { Root, Hips, Spine, Chest, Head, LUpper, LFore, RUpper, RFore, LThigh, LShin, RThigh, RShin }

// bind pose positions (world) of each bone, parent index
const BONES: { p: [number, number, number]; parent: number }[] = [
  { p: [0, 0, 0], parent: -1 },
  { p: [0, 0.95, 0], parent: BoneId.Root },
  { p: [0, 1.07, 0], parent: BoneId.Hips },
  { p: [0, 1.29, 0], parent: BoneId.Spine },
  { p: [0, 1.52, 0], parent: BoneId.Chest },
  { p: [0.25, 1.45, 0], parent: BoneId.Chest },
  { p: [0.25, 1.17, 0], parent: BoneId.LUpper },
  { p: [-0.25, 1.45, 0], parent: BoneId.Chest },
  { p: [-0.25, 1.17, 0], parent: BoneId.RUpper },
  { p: [0.11, 0.9, 0], parent: BoneId.Hips },
  { p: [0.11, 0.47, 0], parent: BoneId.LThigh },
  { p: [-0.11, 0.9, 0], parent: BoneId.Hips },
  { p: [-0.11, 0.47, 0], parent: BoneId.RThigh },
];

const geoCache = new Map<string, THREE.BufferGeometry>();

function buildGeometry(team: Team, lo = false): THREE.BufferGeometry {
  const c = PAL[team];
  // far LOD: same shapes with a fraction of the segments
  const k = lo ? 0.5 : 1;
  const seg = (n: number, min = 3) => Math.max(min, Math.round(n * k));
  const gb = new GeomBuilder(true);
  const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  // Smooth, high-segment primitives: the old boxy look came from 1-segment boxes.
  const caps = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, seg(4, 2), seg(12, 6));
  const sph = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, seg(Math.min(w, 16), 6), seg(Math.min(h, 12), 4));
  const rbox = (x: number, y: number, z: number, r = 0.035) => new RoundedBoxGeometry(x, y, z, lo ? 1 : 2, Math.min(r, x / 2.01, y / 2.01, z / 2.01));
  const H = BoneId;
  // ---- pelvis + belt
  gb.add(caps(0.15, 0.08), c.uniform, M(0, 0.95, 0, 0, 0, Math.PI / 2, 1, 1, 0.82), undefined, H.Hips);
  gb.add(new THREE.TorusGeometry(0.165, 0.032, 6, 18), BELT, M(0, 1.04, 0, Math.PI / 2, 0, 0, 1, 0.8, 1), undefined, H.Hips);
  gb.add(rbox(0.07, 0.06, 0.03, 0.01), 0xb8a46a, M(0, 1.04, 0.135), undefined, H.Hips); // buckle
  // ---- torso: rounded body under a padded vest
  gb.add(caps(0.165, 0.2), c.uniform, M(0, 1.2, 0, 0, 0, 0, 1, 1, 0.8), undefined, H.Spine);
  gb.add(rbox(0.4, 0.38, 0.27, 0.08), c.vest, M(0, 1.33, 0.005), undefined, H.Chest);
  gb.add(rbox(0.34, 0.06, 0.29, 0.025), c.helmet, M(0, 1.2, 0.005), undefined, H.Chest); // vest hem
  for (const x of [-0.1, 0, 0.1]) gb.add(rbox(0.085, 0.1, 0.06, 0.02), c.helmet, M(x, 1.26, 0.155), undefined, H.Chest); // pouches
  gb.add(rbox(0.07, 0.04, 0.02, 0.008), c.accent, M(0.11, 1.43, 0.14), undefined, H.Chest); // patch
  gb.add(rbox(0.3, 0.34, 0.15, 0.06), c.helmet, M(0, 1.33, -0.2), undefined, H.Chest); // backpack
  gb.add(caps(0.05, 0.22), c.helmet, M(0, 1.24, -0.29, 0, 0, Math.PI / 2), undefined, H.Chest); // bedroll
  gb.add(caps(0.07, 0.04), c.uniform, M(0, 1.5, 0), undefined, H.Chest); // neck base / collar
  // ---- head
  gb.add(caps(0.055, 0.06), SKIN, M(0, 1.56, 0), undefined, H.Head);
  gb.add(sph(0.15, 24, 18), SKIN, M(0, 1.675, 0.012, 0, 0, 0, 0.95, 1.05, 1), undefined, H.Head);
  gb.add(sph(0.032, 10, 8), SKIN, M(0, 1.655, 0.155), undefined, H.Head); // nose
  for (const x of [-0.148, 0.148]) gb.add(sph(0.032, 10, 8), SKIN, M(x, 1.67, 0.0, 0, 0, 0, 0.6, 1, 1), undefined, H.Head); // ears
  gb.add(rbox(0.07, 0.012, 0.02, 0.005), 0x7a4a3a, M(0, 1.6, 0.145), undefined, H.Head); // mouth
  // goggles: two rounded lenses on a strap
  for (const x of [-0.055, 0.055]) {
    gb.add(rbox(0.085, 0.055, 0.03, 0.02), GOGGLE, M(x, 1.705, 0.14), undefined, H.Head);
    gb.add(rbox(0.07, 0.042, 0.01, 0.015), 0x9fe3ff, M(x, 1.705, 0.156), undefined, H.Head);
  }
  gb.add(new THREE.TorusGeometry(0.152, 0.012, 4, 18), GOGGLE, M(0, 1.705, 0.005, Math.PI / 2, 0, 0, 1, 1, 1), undefined, H.Head);
  // helmet with a rim and a strap
  gb.add(new THREE.SphereGeometry(0.18, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), c.helmet, M(0, 1.715, -0.005), undefined, H.Head);
  gb.add(new THREE.TorusGeometry(0.178, 0.018, 5, 20), c.helmet, M(0, 1.72, -0.005, Math.PI / 2, 0, 0, 1, 1, 1), undefined, H.Head);
  gb.add(new THREE.TorusGeometry(0.18, 0.012, 4, 20), c.accent, M(0, 1.78, -0.005, Math.PI / 2, 0, 0, 0.93, 0.93, 1), undefined, H.Head);
  // ---- arms
  for (const [side, up, fo] of [[1, H.LUpper, H.LFore], [-1, H.RUpper, H.RFore]] as const) {
    const x = 0.25 * side;
    gb.add(sph(0.095), c.vest, M(x, 1.44, 0, 0, 0, 0, 1, 0.85, 1), undefined, up); // shoulder pad
    gb.add(caps(0.062, 0.17), c.uniform, M(x, 1.31, 0), undefined, up);
    gb.add(sph(0.06, 14, 10), c.helmet, M(x, 1.17, -0.005, 0, 0, 0, 1, 0.8, 1), undefined, fo); // elbow pad
    gb.add(caps(0.055, 0.15), c.uniform, M(x, 1.04, 0), undefined, fo);
    gb.add(caps(0.06, 0.02), c.helmet, M(x, 0.95, 0), undefined, fo); // cuff
    gb.add(sph(0.058, 16, 12), GLOVE, M(x, 0.885, 0.01, 0, 0, 0, 0.9, 1, 1.1), undefined, fo);
  }
  // ---- legs
  for (const [side, th, sh] of [[1, H.LThigh, H.LShin], [-1, H.RThigh, H.RShin]] as const) {
    const x = 0.11 * side;
    gb.add(caps(0.085, 0.27), c.uniform, M(x, 0.69, 0), undefined, th);
    gb.add(rbox(0.08, 0.13, 0.11, 0.025), c.helmet, M(x + 0.075 * side, 0.7, 0.005), undefined, th); // cargo pocket
    gb.add(sph(0.068, 16, 12), c.helmet, M(x, 0.47, 0.05, 0, 0, 0, 1, 1, 0.7), undefined, sh); // knee pad
    gb.add(caps(0.07, 0.25), c.uniform, M(x, 0.27, 0), undefined, sh);
    gb.add(rbox(0.135, 0.12, 0.27, 0.045), BOOT, M(x, 0.06, 0.035), undefined, sh);
    gb.add(rbox(0.14, 0.03, 0.28, 0.012), 0x141210, M(x, 0.012, 0.035), undefined, sh); // sole
  }
  // Indexing shares vertices between triangles: ~6x fewer vertices to skin per frame.
  const g = mergeVertices(gb.build());
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.6);
  return g;
}

/** Team-coloured rim light so fighters pop out of the background. */
function addRim(mat: THREE.MeshStandardMaterial, color: THREE.Color): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: color };
    sh.fragmentShader = 'uniform vec3 rimColor;\n' + sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
      gl_FragColor.rgb += rimColor * pow(rimF, 3.0);`,
    );
  };
  mat.customProgramCacheKey = () => 'rim';
}

function makeKnife(): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.2, 0.035),
    new THREE.MeshStandardMaterial({ color: 0xdfe5ea, metalness: 1, roughness: 0.2 }),
  );
  blade.position.y = -0.13;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.09, 10), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 }));
  g.add(blade, handle);
  g.visible = false;
  return g;
}

let markerTex: Record<Team, THREE.Texture> | null = null;
function markerTextures(): Record<Team, THREE.Texture> {
  if (markerTex) return markerTex;
  const make = (col: string) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = col;
    x.strokeStyle = 'rgba(0,0,0,0.6)';
    x.lineWidth = 5;
    x.beginPath();
    x.moveTo(10, 14);
    x.lineTo(54, 14);
    x.lineTo(32, 50);
    x.closePath();
    x.stroke();
    x.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  markerTex = { blue: make('#4fa3ff'), red: make('#ff4a3d') };
  return markerTex;
}

export interface AnimInput {
  speed: number; // horizontal speed m/s
  fwd: number; // -1..1 local forward component of motion
  side: number; // -1..1 local strafe component
  pitch: number;
  airborne: boolean;
  kick: number; // 0..1 recoil pulse
  reloading: boolean;
}

export class CharacterView {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly mat: THREE.MeshStandardMaterial;
  private bones: THREE.Bone[] = [];
  private gunMount = new THREE.Group();
  gun: THREE.Group | null = null;
  private phase = Math.random() * 10;
  private deadT = -1;
  private flash = 0;
  private shield = 0;
  private slashT = 0;
  private throwT = 0;
  private knife = makeKnife();
  private hiGeo!: THREE.BufferGeometry;
  private loGeo!: THREE.BufferGeometry;
  readonly marker: THREE.Sprite;

  constructor(readonly team: Team, showMarker: boolean) {
    let geo = geoCache.get(team);
    if (!geo) geoCache.set(team, (geo = buildGeometry(team)));
    let lo = geoCache.get(team + '-lo');
    if (!lo) geoCache.set(team + '-lo', (lo = buildGeometry(team, true)));
    this.hiGeo = geo;
    this.loGeo = lo;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
    addRim(this.mat, new THREE.Color(team === 'blue' ? 0x3d7bff : 0xff4a3a).multiplyScalar(0.55));
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    for (const b of BONES) {
      const bone = new THREE.Bone();
      if (b.parent >= 0) {
        const pp = BONES[b.parent].p;
        bone.position.set(b.p[0] - pp[0], b.p[1] - pp[1], b.p[2] - pp[2]);
        this.bones[b.parent].add(bone);
      } else bone.position.set(...b.p);
      this.bones.push(bone);
    }
    this.mesh.add(this.bones[0]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.root.add(this.mesh);
    // gun hangs off the chest so it pitches with aim
    this.gunMount.position.set(-0.13, 0.13, 0.26);
    this.bones[BoneId.Chest].add(this.gunMount);
    this.knife.position.set(0, -0.3, 0.02);
    this.knife.rotation.x = -0.3;
    this.bones[BoneId.LFore].add(this.knife);
    const mt = new THREE.SpriteMaterial({ map: markerTextures()[team], depthTest: true, sizeAttenuation: false, transparent: true });
    this.marker = new THREE.Sprite(mt);
    this.marker.scale.set(0.028, 0.028, 1);
    this.marker.position.y = 2.25;
    this.marker.visible = showMarker;
    this.root.add(this.marker);
  }

  setWeapon(w: WeaponDef): void {
    if (this.gun) this.gunMount.remove(this.gun);
    this.gun = makeWeaponMesh(w);
    this.gunMount.add(this.gun);
  }

  /** World position of the current muzzle. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (!this.gun) return out.set(0, 1.4, 0).applyMatrix4(this.root.matrixWorld);
    return out.copy(this.gun.userData.muzzle as THREE.Vector3).applyMatrix4(this.gun.matrixWorld);
  }

  /** Distance-based detail: far fighters use the light mesh and skip the shadow pass. */
  setDistance(d: number): void {
    const g = d > 18 ? this.loGeo : this.hiGeo;
    if (this.mesh.geometry !== g) this.mesh.geometry = g;
    this.mesh.castShadow = d < 32;
    if (this.gun) for (const ch of this.gun.children) ch.castShadow = d < 20;
  }

  hitFlash(): void { this.flash = 1; }
  slash(): void { this.slashT = 0.32; }
  throwAnim(): void { this.throwT = 0.4; }
  setShield(v: number): void { this.shield = v; }

  die(): void { this.deadT = 0; }
  revive(): void {
    this.deadT = -1;
    this.root.visible = true;
    this.root.rotation.x = 0;
    this.mesh.position.y = 0;
    this.mesh.rotation.x = 0;
  }

  update(dt: number, a: AnimInput): void {
    const B = this.bones;
    // emissive: damage flash (white) + spawn shield (team tint)
    this.flash = Math.max(0, this.flash - dt * 6);
    const sh = this.shield > 0 ? 0.14 + 0.1 * Math.sin(performance.now() * 0.02) : 0;
    const tint = this.team === 'blue' ? [0.2, 0.5, 1] : [1, 0.3, 0.2];
    this.mat.emissive.setRGB(this.flash + sh * tint[0], this.flash * 0.9 + sh * tint[1], this.flash * 0.8 + sh * tint[2]);

    if (this.deadT >= 0) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.55);
      const e = 1 - (1 - k) * (1 - k);
      this.mesh.rotation.x = -e * Math.PI / 2;
      this.mesh.position.y = 0.15 * e;
      B[BoneId.LUpper].rotation.set(-2.5 * e, 0, 0.3);
      B[BoneId.RUpper].rotation.set(-2.6 * e, 0, -0.3);
      B[BoneId.Head].rotation.x = -0.4 * e;
      if (this.deadT > 2.6) this.root.visible = false;
      return;
    }

    const moving = Math.min(1, a.speed / 4.5);
    this.phase += dt * (3 + a.speed * 1.55);
    const s = Math.sin(this.phase), c2 = Math.cos(this.phase);
    const amp = 0.75 * moving * (a.fwd < -0.3 ? -1 : 1);
    if (a.airborne) {
      B[BoneId.LThigh].rotation.x = -0.6;
      B[BoneId.LShin].rotation.x = 0.9;
      B[BoneId.RThigh].rotation.x = -0.2;
      B[BoneId.RShin].rotation.x = 0.5;
    } else {
      B[BoneId.LThigh].rotation.x = -s * amp;
      B[BoneId.RThigh].rotation.x = s * amp;
      B[BoneId.LShin].rotation.x = Math.max(0, c2) * 1.1 * moving;
      B[BoneId.RShin].rotation.x = Math.max(0, -c2) * 1.1 * moving;
      // sidestep: splay legs
      B[BoneId.LThigh].rotation.z = a.side * s * 0.35 * moving;
      B[BoneId.RThigh].rotation.z = a.side * s * 0.35 * moving;
    }
    B[BoneId.Hips].position.y = 0.95 - Math.abs(c2) * 0.05 * moving;
    B[BoneId.Hips].rotation.y = s * 0.12 * moving;
    B[BoneId.Spine].rotation.y = -s * 0.1 * moving;
    B[BoneId.Spine].rotation.x = -0.08 * moving;
    // aim: chest pitches with view, head follows a bit more
    const pitch = THREE.MathUtils.clamp(a.pitch, -0.9, 0.9);
    B[BoneId.Chest].rotation.x = -pitch * 0.8;
    B[BoneId.Head].rotation.x = -pitch * 0.3;
    // arms hold the gun in front
    const kick = a.kick * 0.25;
    const rel = a.reloading ? Math.sin(performance.now() * 0.012) * 0.25 + 0.4 : 0;
    B[BoneId.RUpper].rotation.set(-1.25 + kick, 0, -0.15);
    B[BoneId.RFore].rotation.set(-0.55, 0, 0);
    B[BoneId.LUpper].rotation.set(-1.45 + kick + rel, 0, -0.75);
    B[BoneId.LFore].rotation.set(-0.35 - rel, 0.2, 0);
    // knife slash: left arm sweeps across the body
    if (this.slashT > 0) {
      this.slashT -= dt;
      const k = 1 - Math.max(0, this.slashT) / 0.32;
      const sw = Math.sin(k * Math.PI);
      B[BoneId.LUpper].rotation.set(-1.9 + sw * 0.4, -0.9 + k * 1.6, -0.2 - sw * 0.6);
      B[BoneId.LFore].rotation.set(-0.3, 0, 0);
      B[BoneId.Spine].rotation.y += (k - 0.5) * 0.6;
    }
    this.knife.visible = this.slashT > 0;
    // overhand grenade throw with the left arm
    if (this.throwT > 0) {
      this.throwT -= dt;
      const k = 1 - Math.max(0, this.throwT) / 0.4;
      B[BoneId.LUpper].rotation.set(-3.0 + k * 2.2, 0, 0.2);
      B[BoneId.LFore].rotation.set(-0.8 + k * 0.6, 0, 0);
    }
    this.gunMount.position.z = 0.26 - a.kick * 0.06;
    this.gunMount.rotation.x = -a.kick * 0.12 + (a.reloading ? 0.5 : 0);
  }
}
