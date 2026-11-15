import * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import { GeomBuilder } from './geomBuilder';
import { makeWeaponMesh } from './weaponModel';

export type Team = 'blue' | 'red';

const PAL = {
  blue: { uniform: 0x2f4664, vest: 0x2f6fe0, helmet: 0x223a5e, accent: 0x7fd0ff },
  red: { uniform: 0x5e2c2c, vest: 0xd8402f, helmet: 0x5a2420, accent: 0xffb07a },
};
const SKIN = 0xe0b48f, BOOT = 0x2a2522, GLOVE = 0x262626, BELT = 0x3a3128, GOGGLE = 0x111418;

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

const geoCache = new Map<Team, THREE.BufferGeometry>();

function buildGeometry(team: Team): THREE.BufferGeometry {
  const c = PAL[team];
  const gb = new GeomBuilder(true);
  const M = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const caps = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
  const sph = (r: number) => new THREE.SphereGeometry(r, 14, 10);
  const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
  // pelvis
  gb.add(box(0.34, 0.2, 0.22), c.uniform, M(0, 0.95, 0), undefined, BoneId.Hips);
  gb.add(box(0.36, 0.06, 0.24), BELT, M(0, 1.04, 0), undefined, BoneId.Hips);
  // torso + vest
  gb.add(caps(0.17, 0.22), c.uniform, M(0, 1.2, 0), undefined, BoneId.Spine);
  gb.add(box(0.42, 0.36, 0.28), c.vest, M(0, 1.32, 0.01), undefined, BoneId.Chest);
  gb.add(box(0.3, 0.12, 0.06), c.helmet, M(0, 1.27, 0.15), undefined, BoneId.Chest); // pouches
  gb.add(box(0.3, 0.32, 0.14), c.helmet, M(0, 1.32, -0.2), undefined, BoneId.Chest); // backpack
  gb.add(box(0.12, 0.05, 0.3), c.accent, M(0.21, 1.47, 0), undefined, BoneId.Chest); // shoulder stripes
  gb.add(box(0.12, 0.05, 0.3), c.accent, M(-0.21, 1.47, 0), undefined, BoneId.Chest);
  // head
  gb.add(caps(0.06, 0.06), SKIN, M(0, 1.55, 0), undefined, BoneId.Head);
  gb.add(sph(0.155), SKIN, M(0, 1.68, 0.01), undefined, BoneId.Head);
  const helmet = new THREE.SphereGeometry(0.185, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  gb.add(helmet, c.helmet, M(0, 1.71, -0.005), undefined, BoneId.Head);
  gb.add(box(0.26, 0.06, 0.06), GOGGLE, M(0, 1.71, 0.15), undefined, BoneId.Head);
  gb.add(box(0.3, 0.03, 0.08), c.accent, M(0, 1.755, 0.13), undefined, BoneId.Head);
  // arms
  for (const [side, up, fo] of [[1, BoneId.LUpper, BoneId.LFore], [-1, BoneId.RUpper, BoneId.RFore]] as const) {
    const x = 0.25 * side;
    gb.add(sph(0.085), c.vest, M(x, 1.44, 0), undefined, up);
    gb.add(caps(0.065, 0.16), c.uniform, M(x, 1.31, 0), undefined, up);
    gb.add(caps(0.058, 0.15), c.uniform, M(x, 1.04, 0), undefined, fo);
    gb.add(sph(0.06), GLOVE, M(x, 0.88, 0), undefined, fo);
  }
  // legs
  for (const [side, th, sh] of [[1, BoneId.LThigh, BoneId.LShin], [-1, BoneId.RThigh, BoneId.RShin]] as const) {
    const x = 0.11 * side;
    gb.add(caps(0.085, 0.26), c.uniform, M(x, 0.69, 0), undefined, th);
    gb.add(box(0.1, 0.12, 0.08), c.helmet, M(x + 0.06 * side, 0.7, 0), undefined, th); // thigh pocket
    gb.add(caps(0.07, 0.24), c.uniform, M(x, 0.27, 0), undefined, sh);
    gb.add(box(0.14, 0.11, 0.26), BOOT, M(x, 0.055, 0.04), undefined, sh);
  }
  const g = gb.build();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.6);
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
  readonly marker: THREE.Sprite;

  constructor(readonly team: Team, showMarker: boolean) {
    let geo = geoCache.get(team);
    if (!geo) geoCache.set(team, (geo = buildGeometry(team)));
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
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

  hitFlash(): void { this.flash = 1; }
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
    const sh = this.shield > 0 ? 0.35 + 0.25 * Math.sin(performance.now() * 0.02) : 0;
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
    this.gunMount.position.z = 0.26 - a.kick * 0.06;
    this.gunMount.rotation.x = -a.kick * 0.12 + (a.reloading ? 0.5 : 0);
  }
}
