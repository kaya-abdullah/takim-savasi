import * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GeomBuilder } from './geomBuilder';
import { makeWeaponMesh } from './weaponModel';

export type Team = 'blue' | 'red';

const PAL = {
  blue: { uniform: 0x2f4664, vest: 0x2f6fe0, helmet: 0x223a5e, accent: 0x7fd0ff },
  red: { uniform: 0x5e2c2c, vest: 0xd8402f, helmet: 0x5a2420, accent: 0xffb07a },
};
const SKIN = 0xe0b48f, BOOT = 0x2a2522, GLOVE = 0x262626, BELT = 0x3a3128, GOGGLE = 0x30363e;

const STANCE_YAW = 0.55;

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

// ------------------------------------------------------------------ realistic soldier
/**
 * The realistic body: a rigged, textured soldier (Mixamo "Vanguard", as shipped
 * with the three.js examples). Our 13-bone procedural rig still does all the
 * animation; its pose is copied onto the soldier's skeleton every frame.
 * Without the asset (load failed) the procedural figure is used instead.
 */
interface HumanAsset {
  scene: THREE.Object3D;
  /** Team-painted body texture (old soldier only); people wear a team-coloured vest instead. */
  maps: Record<Team, THREE.Texture> | null;
  height: number;
  minY: number;
  /** The old soldier faces -z; the MakeHuman people already face +z like our fighters. */
  flip: boolean;
}
/** Loaded body models; each new fighter takes the next one, so a match shows every face. */
const HUMANS: HumanAsset[] = [];
let nextHuman = Math.floor(Math.random() * 6);
/** Height of a fighter in metres (top of the head). */
const HUMAN_H = 1.8;
/** Realistic people built with MakeHuman/MPFB (scripts/humans/gen_humans.py). */
export const PEOPLE_URLS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((n) => `models/people/${n}.glb`);

/** Repaints the tan armour plates in the team colour, keeping scratches and shading. */
function teamTexture(src: THREE.Texture, team: Team): THREE.Texture {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, cv.width, cv.height);
  const px = d.data;
  // muted, military tones (navy / oxblood): still clearly two teams, no longer toy-like
  const armour = team === 'blue' ? [0.26, 0.38, 0.62] : [0.66, 0.22, 0.17];
  const stripe = team === 'blue' ? [0.9, 0.94, 1.0] : [0.98, 0.86, 0.5];
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    if (mx - mn < 1e-3) continue;
    let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
    h *= 60;
    if (h < 0) h += 360;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let c: number[] | null = null, k = 0;
    if (h > 18 && h < 48 && sat > 0.18 && sat < 0.7 && mx > 0.42) { c = armour; k = lum / 0.62; } // tan plates
    else if ((h < 12 || h > 345) && sat > 0.5 && mx > 0.3) { c = stripe; k = lum / 0.3; } // red stripes
    if (!c) continue;
    px[i] = Math.min(255, c[0] * k * 200);
    px[i + 1] = Math.min(255, c[1] * k * 200);
    px[i + 2] = Math.min(255, c[2] * k * 200);
  }
  cx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.anisotropy = 4;
  return t;
}

/** Plate-carrier fabric: Cordura weave with wear, tinted in the team colour. */
let vestTex: Record<Team, THREE.Texture> | null = null;
function vestTextures(): Record<Team, THREE.Texture> {
  if (vestTex) return vestTex;
  const make = (base: [number, number, number]) => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d')!;
    x.fillStyle = `rgb(${base.join(',')})`;
    x.fillRect(0, 0, S, S);
    // weave: fine crossing threads
    for (let i = 0; i < S; i += 2) {
      x.fillStyle = `rgba(0,0,0,${0.05 + (i % 4) * 0.02})`;
      x.fillRect(0, i, S, 1);
      x.fillStyle = 'rgba(255,255,255,0.035)';
      x.fillRect(i, 0, 1, S);
    }
    // scuffs and dirt
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const px = r() * S, py = r() * S, rad = 4 + r() * 22;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, r() < 0.6 ? 'rgba(40,32,24,0.22)' : 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    return t;
  };
  vestTex = { blue: make([44, 86, 168]), red: make([168, 46, 38]) };
  return vestTex;
}

async function loadAsset(url: string, flip: boolean, teamMaps: boolean): Promise<HumanAsset | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const scene = gltf.scene;
    let map: THREE.Texture | null = null;
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && !map) map = (m.material as THREE.MeshStandardMaterial).map;
    });
    if (!map) return null;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    return {
      scene, flip, height: box.max.y - box.min.y, minY: box.min.y,
      maps: teamMaps ? { blue: teamTexture(map, 'blue'), red: teamTexture(map, 'red') } : null,
    };
  } catch (e) {
    console.warn('model unavailable', url, e);
    return null;
  }
}

/**
 * Loads the realistic people (in parallel). If none can be loaded, the old
 * soldier; if that fails too, the procedural figure. Returns false only then.
 */
export async function loadHumans(urls = PEOPLE_URLS, fallback = 'models/soldier.glb'): Promise<boolean> {
  HUMANS.length = 0;
  for (const a of await Promise.all(urls.map((u) => loadAsset(u, false, false)))) if (a) HUMANS.push(a);
  if (!HUMANS.length) {
    const s = await loadAsset(fallback, true, true);
    if (s) HUMANS.push(s);
  }
  return HUMANS.length > 0;
}

/** How many body models are loaded (0: procedural figure). */
export function humanCount(): number {
  return HUMANS.length;
}

/** Soldier bone (Mixamo name), our rig bone driving it, and the soldier bone it points at. */
const RETARGET: [string, BoneId, string][] = [
  ['Hips', BoneId.Hips, 'Spine'],
  ['Spine', BoneId.Spine, 'Spine1'],
  ['Spine2', BoneId.Chest, 'Neck'],
  ['Head', BoneId.Head, 'HeadTop_End'],
  ['LeftArm', BoneId.LUpper, 'LeftForeArm'],
  ['LeftForeArm', BoneId.LFore, 'LeftHand'],
  ['RightArm', BoneId.RUpper, 'RightForeArm'],
  ['RightForeArm', BoneId.RFore, 'RightHand'],
  ['LeftUpLeg', BoneId.LThigh, 'LeftLeg'],
  ['LeftLeg', BoneId.LShin, 'LeftFoot'],
  ['RightUpLeg', BoneId.RThigh, 'RightLeg'],
  ['RightLeg', BoneId.RShin, 'RightFoot'],
];
/** Direction each of our rig bones points in its rest pose. */
const RIG_DIR: Partial<Record<BoneId, [number, number, number]>> = {
  [BoneId.Hips]: [0, 1, 0], [BoneId.Spine]: [0, 1, 0], [BoneId.Chest]: [0, 1, 0], [BoneId.Head]: [0, 1, 0],
  [BoneId.LUpper]: [0, -1, 0], [BoneId.LFore]: [0, -1, 0], [BoneId.RUpper]: [0, -1, 0], [BoneId.RFore]: [0, -1, 0],
  [BoneId.LThigh]: [0, -1, 0], [BoneId.LShin]: [0, -1, 0], [BoneId.RThigh]: [0, -1, 0], [BoneId.RShin]: [0, -1, 0],
};
const findBone = (root: THREE.Object3D, n: string) =>
  (root.getObjectByName('mixamorig' + n) ?? root.getObjectByName('mixamorig:' + n)) as THREE.Bone | undefined;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3();
const _t = new THREE.Vector3(), _pole = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3();

/** Turns a bone in world space so its direction `from` becomes `to` (minimal rotation keeps the twist). */
function turnBone(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  const r = _q.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(r);
  bone.parent!.getWorldQuaternion(_q);
  bone.quaternion.copy(_q.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

/** Two-bone IK: [upper, fore, hand] so the hand reaches `target`, elbow bent toward `pole`. */
function ikSolve([up, fore, hand]: THREE.Bone[], target: THREE.Vector3, pole: THREE.Vector3): void {
  up.getWorldPosition(_a);
  fore.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  _d.copy(target).sub(_a);
  const dist = THREE.MathUtils.clamp(_d.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  _d.normalize();
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _u.copy(pole).sub(_a);
  _u.addScaledVector(_d, -_u.dot(_d)).normalize();
  _e.copy(_a).addScaledVector(_d, x).addScaledVector(_u, h); // elbow
  turnBone(up, _b.sub(_a), _t.copy(_e).sub(_a));
  fore.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  // reach toward the (clamped) target from the new elbow
  _u.copy(_a).addScaledVector(_d, dist);
  turnBone(fore, _c.sub(_b), _u.sub(_b));
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
  sprint: boolean;
  /** 0 standing .. 1 fully crouched. */
  crouch?: number;
}

export class CharacterView {
  readonly root = new THREE.Group();
  /** Everything that falls over on death: our rig and the visible body. */
  private body = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly mat: THREE.MeshStandardMaterial;
  /** Every material of the visible body (emissive flash/shield tint). */
  private mats: THREE.MeshStandardMaterial[] = [];
  private meshes: THREE.Mesh[] = [];
  private bones: THREE.Bone[] = [];
  /** Soldier bones driven from our rig (empty for the simple figure). */
  private drive: { bone: THREE.Bone; rig: THREE.Bone; off: THREE.Quaternion }[] = [];
  /** Soldier hips: rest position in its parent's space and body-space → parent-space (linear part). */
  private hips: { bone: THREE.Bone; rest: THREE.Vector3; toLocal: THREE.Matrix3 } | null = null;
  /** Per-frame world rotations, accumulated down the hierarchy (no matrix updates). */
  private qCache = new Map<THREE.Object3D, { q: THREE.Quaternion; s: number }>();
  private stamp = 0;
  private dist = 0;
  private frameNo = Math.floor(Math.random() * 2);
  /** Soldier arm chains for hand IK onto the gun: [upper arm, forearm, hand]. */
  private arms: { r: THREE.Bone[]; l: THREE.Bone[] } | null = null;
  private reloading = false;
  private gunMount = new THREE.Group();
  gun: THREE.Group | null = null;
  private phase = Math.random() * 10;
  private deadT = -1;
  private flash = 0;
  private shield = 0;
  private slashT = 0;
  private sprintK = 0;
  private throwT = 0;
  private knife = makeKnife();
  private hiGeo!: THREE.BufferGeometry;
  private loGeo!: THREE.BufferGeometry;
  readonly marker: THREE.Sprite;
  /** The team-coloured plate carrier (realistic people only). */
  vestMat: THREE.MeshStandardMaterial | null = null;
  /** Which body model this fighter wears (index into the loaded people), -1 for the procedural figure. */
  variant = -1;

  constructor(readonly team: Team, showMarker: boolean) {
    const rim = new THREE.Color(team === 'blue' ? 0x3d7bff : 0xff4a3a).multiplyScalar(0.2);
    // our animation rig (never drawn itself)
    for (const b of BONES) {
      const bone = new THREE.Bone();
      if (b.parent >= 0) {
        const pp = BONES[b.parent].p;
        bone.position.set(b.p[0] - pp[0], b.p[1] - pp[1], b.p[2] - pp[2]);
        this.bones[b.parent].add(bone);
      } else bone.position.set(...b.p);
      this.bones.push(bone);
    }
    this.body.add(this.bones[0]);
    this.root.add(this.body);
    if (HUMANS.length) this.variant = nextHuman++ % HUMANS.length;
    const H = HUMANS.length ? HUMANS[this.variant] : null;
    if (H) {
      const model = SkeletonUtils.clone(H.scene);
      const wrap = new THREE.Group();
      const k = HUMAN_H / H.height;
      wrap.scale.setScalar(k);
      wrap.position.y = -H.minY * k;
      if (H.flip) wrap.rotation.y = Math.PI; // the old soldier faces -z, our fighters face +z
      wrap.add(model);
      this.body.add(wrap);
      let main: THREE.SkinnedMesh | null = null;
      model.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = src.clone();
        const part = m.name.toLowerCase();
        if (H.maps) {
          if (!main) { main = m; mat.map = H.maps[team]; }
          mat.roughness = 0.8;
        } else if (part.startsWith('vest')) {
          this.vestMat = mat;
          // the team colour: a plate carrier over civilian clothes
          mat.map = vestTextures()[team];
          mat.color.setRGB(1, 1, 1);
          mat.roughness = 0.9;
          mat.metalness = 0;
        } else if (part.startsWith('hair')) {
          // eyebrows, eyelashes, beards: cut-out cards
          // glTF BLEND materials arrive with depthWrite off: as cut-outs they must write depth,
          // or the head drawn after them paints over the hair
          mat.transparent = false;
          mat.depthWrite = true;
          mat.alphaTest = 0.45;
          mat.side = THREE.DoubleSide;
          mat.roughness = 0.75;
        } else {
          if (!main) main = m;
          mat.roughness = 0.72;
          mat.metalness = 0;
        }
        addRim(mat, rim);
        m.material = mat;
        m.castShadow = true;
        m.receiveShadow = false;
        this.mats.push(mat);
        this.meshes.push(m);
      });
      if (!main) main = this.meshes[0] as THREE.SkinnedMesh;
      this.mesh = main!;
      this.mat = this.mats[0];
      this.hiGeo = this.loGeo = this.mesh.geometry;
      this.root.updateMatrixWorld(true);
      // rest-pose alignment: a soldier bone's world rotation = rig bone's world rotation * off
      const dir = new THREE.Vector3(), want = new THREE.Vector3(), rw = new THREE.Quaternion(), bw = new THREE.Quaternion();
      for (const [name, id, child] of RETARGET) {
        const bone = findBone(model, name), tip = findBone(model, child);
        if (!bone) continue;
        // MPFB's mixamo rig has no head-top bone: the head points straight up in the rest pose
        if (tip) dir.copy(tip.getWorldPosition(_p)).sub(bone.getWorldPosition(want)).normalize();
        else if (name === 'Head') dir.set(0, 1, 0);
        else continue;
        want.set(...RIG_DIR[id]!);
        const align = new THREE.Quaternion().setFromUnitVectors(dir, want);
        this.bones[id].getWorldQuaternion(rw);
        bone.getWorldQuaternion(bw);
        this.drive.push({ bone, rig: this.bones[id], off: rw.clone().invert().multiply(align).multiply(bw) });
      }
      const chain = (s: string) => ['Arm', 'ForeArm', 'Hand'].map((n) => findBone(model, s + n)!);
      const ra = chain('Right'), la = chain('Left');
      if (ra.every(Boolean) && la.every(Boolean)) this.arms = { r: ra, l: la };
      const hb = findBone(model, 'Hips');
      if (hb) {
        const toLocal = new THREE.Matrix4().copy(hb.parent!.matrixWorld).invert().multiply(this.body.matrixWorld);
        this.hips = { bone: hb, rest: hb.position.clone(), toLocal: new THREE.Matrix3().setFromMatrix4(toLocal) };
      }
    } else {
      let geo = geoCache.get(team);
      if (!geo) geoCache.set(team, (geo = buildGeometry(team)));
      let lo = geoCache.get(team + '-lo');
      if (!lo) geoCache.set(team + '-lo', (lo = buildGeometry(team, true)));
      this.hiGeo = geo;
      this.loGeo = lo;
      this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
      addRim(this.mat, rim);
      this.mesh = new THREE.SkinnedMesh(geo, this.mat);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = false;
      this.body.add(this.mesh);
      this.body.updateMatrixWorld(true);
      this.mesh.bind(new THREE.Skeleton(this.bones));
      this.mats.push(this.mat);
      this.meshes.push(this.mesh);
    }
    // gun hangs off the chest so it pitches with aim
    this.gunMount.position.set(-0.2, 0.15, 0.14);
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
    // the local player's gun is seen from behind; scale it up so it reads on screen
    if (!this.marker.visible) this.gun.scale.multiplyScalar(1.25);
    this.gunMount.add(this.gun);
  }

  /** World position of the current muzzle. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (!this.gun) return out.set(0, 1.4, 0).applyMatrix4(this.root.matrixWorld);
    return out.copy(this.gun.userData.muzzle as THREE.Vector3).applyMatrix4(this.gun.matrixWorld);
  }

  /** Frees per-character GPU resources (shared geometry is kept). */
  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const m of this.meshes) (m as THREE.SkinnedMesh).skeleton?.dispose(); // bone textures live on the GPU
    this.marker.material.dispose();
    this.knife.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
  }

  /** Distance-based detail: far fighters use the light mesh and skip the shadow pass. */
  setDistance(d: number): void {
    this.dist = d;
    const g = d > 18 ? this.loGeo : this.hiGeo;
    if (this.mesh.geometry !== g) this.mesh.geometry = g;
    for (const m of this.meshes) m.castShadow = d < 32;
    if (this.gun) for (const ch of this.gun.children) ch.castShadow = d < 20;
  }

  hitFlash(): void { this.flash = 1; }
  slash(): void { this.slashT = 0.32; }
  throwAnim(): void { this.throwT = 0.4; }
  setShield(v: number): void { this.shield = v; }

  die(): void {
    this.deadT = 0;
    if (this.gun) this.gun.visible = false; // it dropped to the ground
  }
  revive(): void {
    this.deadT = -1;
    if (this.gun) this.gun.visible = true;
    this.root.visible = true;
    this.root.rotation.x = 0;
    this.body.position.y = 0;
    this.body.rotation.x = 0;
  }

  update(dt: number, a: AnimInput): void {
    this.animate(dt, a);
    this.reloading = a.reloading;
    if (this.drive.length && this.root.visible) {
      // far soldiers pose every other frame; hands only matter up close
      if (this.dist > 30 && (++this.frameNo & 1)) return;
      this.syncHuman();
      if (this.dist < 25) {
        this.body.updateMatrixWorld(true);
        this.handsOnGun();
      }
    }
  }

  /** World rotation of o this frame (cached; parents first). */
  private wq(o: THREE.Object3D): THREE.Quaternion {
    let e = this.qCache.get(o);
    if (!e) this.qCache.set(o, (e = { q: new THREE.Quaternion(), s: -1 }));
    if (e.s === this.stamp) return e.q;
    e.s = this.stamp;
    if (o === this.root || !o.parent) return e.q.copy(o.quaternion);
    return e.q.copy(this.wq(o.parent)).multiply(o.quaternion);
  }

  /** Puts the soldier's hands on the gun: right on the grip, left on the forend (two-bone IK). */
  private handsOnGun(): void {
    const gun = this.gun;
    if (!this.arms || !gun || !gun.visible || this.deadT >= 0) return;
    gun.updateWorldMatrix(true, false);
    const mz = (gun.userData.muzzle as THREE.Vector3).z;
    const long = mz > 0.4;
    // wrist targets in gun space: the palm wraps the grip, the wrist sits just behind it
    ikSolve(this.arms.r, gun.localToWorld(_t.set(-0.01, -0.07, -0.03)), this.body.localToWorld(_pole.set(-0.6, -0.5, -0.3)));
    if (this.slashT > 0 || this.throwT > 0 || this.reloading) return;
    if (long) {
      // the forend, or as far along it as the arm reaches (the stance holds the gun well forward)
      const [u, f, h] = this.arms.l;
      u.getWorldPosition(_a);
      const reach = 0.97 * (_a.distanceTo(f.getWorldPosition(_b)) + _b.distanceTo(h.getWorldPosition(_c)));
      let z = mz * 0.55 - 0.06;
      while (z > 0.06 && gun.localToWorld(_t.set(0, -0.04, z)).distanceTo(_a) > reach) z -= 0.03;
      gun.localToWorld(_t.set(0, -0.04, z));
    } else gun.localToWorld(_t.set(0.035, -0.08, -0.01));
    ikSolve(this.arms.l, _t, this.body.localToWorld(_pole.set(0.6, -0.6, -0.1)));
  }

  /** Copies the rig's pose onto the soldier skeleton (world-space rotations, hips height). */
  private syncHuman(): void {
    this.stamp++;
    if (this.hips) {
      const rig = this.bones[BoneId.Hips];
      _p.set(rig.position.x, rig.position.y - BONES[BoneId.Hips].p[1], rig.position.z).applyMatrix3(this.hips.toLocal);
      this.hips.bone.position.copy(this.hips.rest).add(_p);
    }
    // the rig and the soldier share the root, so root-relative rotations are enough
    for (const d of this.drive) {
      _q.copy(this.wq(d.rig)).multiply(d.off);
      _q2.copy(this.wq(d.bone.parent!)).invert().multiply(_q);
      d.bone.quaternion.copy(_q2);
      const e = this.qCache.get(d.bone);
      if (e) { e.q.copy(_q); e.s = this.stamp; }
      else this.qCache.set(d.bone, { q: _q.clone(), s: this.stamp });
    }
  }

  private animate(dt: number, a: AnimInput): void {
    const B = this.bones;
    // emissive: damage flash (white) + spawn shield (team tint)
    this.flash = Math.max(0, this.flash - dt * 6);
    // steady tint that fades over the last half second (a pulsing glow read as flicker)
    const sh = 0.16 * Math.min(1, Math.max(0, this.shield) / 0.5);
    const tint = this.team === 'blue' ? [0.2, 0.5, 1] : [1, 0.3, 0.2];
    for (const m of this.mats) m.emissive.setRGB(this.flash + sh * tint[0], this.flash * 0.9 + sh * tint[1], this.flash * 0.8 + sh * tint[2]);

    if (this.deadT >= 0) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.55);
      const e = 1 - (1 - k) * (1 - k);
      this.body.rotation.x = -e * Math.PI / 2;
      this.body.position.y = 0.15 * e;
      B[BoneId.LUpper].rotation.set(-2.5 * e, 0, 0.3);
      B[BoneId.RUpper].rotation.set(-2.6 * e, 0, -0.3);
      B[BoneId.Head].rotation.x = -0.4 * e;
      if (this.deadT > 2.6) this.root.visible = false;
      return;
    }

    const moving = Math.min(1, a.speed / 4.5);
    this.phase += dt * (3 + a.speed * 1.55);
    const s = Math.sin(this.phase), c2 = Math.cos(this.phase);
    const amp = 0.5 * moving * (a.fwd < -0.3 ? -1 : 1); // a realistic stride, not a cartoon split
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
    // crouch: hips drop, knees fold, torso leans in a little (small steps while moving)
    const ck = a.airborne ? 0 : a.crouch ?? 0;
    if (ck > 0.01) {
      for (const t of [BoneId.LThigh, BoneId.RThigh]) B[t].rotation.x = B[t].rotation.x * (1 - 0.55 * ck) - 1.3 * ck;
      for (const t of [BoneId.LShin, BoneId.RShin]) B[t].rotation.x = B[t].rotation.x * (1 - 0.55 * ck) + 2.0 * ck;
      B[BoneId.Hips].position.y -= 0.44 * ck;
      B[BoneId.Spine].rotation.x -= 0.2 * ck;
    }
    // aim: chest pitches with view, head follows a bit more
    const pitch = THREE.MathUtils.clamp(a.pitch, -0.9, 0.9);
    // bladed rifle stance: torso turned right, head and gun counter-turned to the target
    const blade = STANCE_YAW * (1 - this.sprintK);
    B[BoneId.Chest].rotation.set(-pitch * 0.8, -blade, 0);
    B[BoneId.Head].rotation.set(-pitch * 0.3, blade * 0.9, 0);
    // arms hold the gun in front
    const kick = a.kick * 0.25;
    const rel = a.reloading ? Math.sin(performance.now() * 0.012) * 0.25 + 0.4 : 0;
    B[BoneId.RUpper].rotation.set(-1.25 + kick, 0, -0.38);
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
    // sprint: lean in, pump the arms, carry the gun low across the chest
    this.sprintK += ((a.sprint && a.speed > 2 ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);
    const sk = this.sprintK;
    if (sk > 0.01) {
      B[BoneId.Spine].rotation.x += -0.28 * sk;
      B[BoneId.Chest].rotation.x = B[BoneId.Chest].rotation.x * (1 - sk) + 0.25 * sk;
      B[BoneId.LThigh].rotation.x *= 1 + 0.2 * sk;
      B[BoneId.RThigh].rotation.x *= 1 + 0.2 * sk;
      B[BoneId.RUpper].rotation.x += 0.55 * sk + s * 0.25 * sk;
      B[BoneId.LUpper].rotation.x += 0.4 * sk - s * 0.25 * sk;
    }
    this.gunMount.position.z = 0.14 - a.kick * 0.06;
    this.gunMount.rotation.set(-a.kick * 0.12 + (a.reloading ? 0.5 : 0) + 0.75 * sk, blade + 0.55 * sk, -0.3 * sk);
    // a little weapon bob while moving
    this.gunMount.position.y = 0.15 + Math.sin(this.phase * 2) * 0.012 * moving;
  }
}
