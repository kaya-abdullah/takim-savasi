import * as THREE from 'three';
import { GeomBuilder } from './geomBuilder';
import { rng } from './textures';

/**
 * Realistic street trees: a bent, tapered trunk with branches and a crown of
 * alpha-tested leaf cards. Each card's normal points out of the crown, so the
 * whole crown shades like one soft volume (lit side, shaded underside) instead
 * of a heap of flat planes. Leaves sway a little in the wind.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

/** Leaf-cluster sprite: dozens of small leaves with midribs on a transparent background. */
export function makeLeafTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const r = rng(101);
  // twigs first, so leaves cover them
  x.strokeStyle = 'rgba(70,52,34,1)';
  x.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    x.lineWidth = 2 + r() * 2;
    x.beginPath();
    x.moveTo(S / 2, S / 2);
    const a = r() * Math.PI * 2, l = S * (0.25 + r() * 0.18);
    x.quadraticCurveTo(S / 2 + Math.cos(a + 0.4) * l * 0.5, S / 2 + Math.sin(a + 0.4) * l * 0.5, S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l);
    x.stroke();
  }
  for (let i = 0; i < 420; i++) {
    // denser towards the middle, ragged edge
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.43;
    const px = S / 2 + Math.cos(a) * d, py = S / 2 + Math.sin(a) * d;
    const len = 16 + r() * 16, wid = len * (0.38 + r() * 0.14);
    const h = 78 + r() * 34, sat = 32 + r() * 26, lum = 20 + r() * 22 + (1 - d / (S * 0.43)) * 4;
    x.save();
    x.translate(px, py);
    x.rotate(r() * Math.PI * 2);
    x.fillStyle = `hsl(${h},${sat}%,${lum}%)`;
    x.beginPath();
    x.moveTo(0, -len / 2);
    x.quadraticCurveTo(wid, -len * 0.1, 0, len / 2);
    x.quadraticCurveTo(-wid, -len * 0.1, 0, -len / 2);
    x.fill();
    // one half a touch lighter: reads as a folded leaf catching light
    x.fillStyle = `hsla(${h + 6},${sat}%,${lum + 8}%,0.55)`;
    x.beginPath();
    x.moveTo(0, -len / 2);
    x.quadraticCurveTo(wid, -len * 0.1, 0, len / 2);
    x.closePath();
    x.fill();
    x.strokeStyle = `hsla(${h},${sat}%,${lum + 14}%,0.5)`;
    x.lineWidth = 0.8;
    x.beginPath();
    x.moveTo(0, -len / 2);
    x.lineTo(0, len / 2);
    x.stroke();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Bark: vertical furrows, tileable horizontally. */
export function makeBarkTexture(): THREE.CanvasTexture {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const r = rng(77);
  x.fillStyle = '#5b4a3b';
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    const v = r() < 0.5 ? 30 : 120;
    x.strokeStyle = `rgba(${v},${v * 0.85},${v * 0.7},${0.15 + r() * 0.3})`;
    x.lineWidth = 1 + r() * 4;
    const px = r() * W;
    x.beginPath();
    x.moveTo(px, 0);
    for (let y = 0; y <= H; y += 16) x.lineTo(px + (r() - 0.5) * 6, y);
    x.stroke();
  }
  // lichen
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(120,135,90,${r() * 0.25})`;
    x.beginPath();
    x.arc(r() * W, r() * H, 2 + r() * 6, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Leaves: alpha-tested, double sided without normal flipping, gentle wind. */
export function makeLeafMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: makeLeafTexture(), alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0,
    envMapIntensity: 0.7,
  });
  const time = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.time = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float time;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = max(position.y - 2.4, 0.0) * 0.035;
        float ph = position.x * 0.37 + position.z * 0.29;
        transformed.x += sin(time * 1.6 + ph) * sway + sin(time * 4.1 + ph * 3.0) * sway * 0.3;
        transformed.z += cos(time * 1.3 + ph) * sway;`);
    // keep the crown-shaped normal on both faces (no flip on back faces)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  m.customProgramCacheKey = () => 'leaves';
  (m.userData as { time?: { value: number } }).time = time;
  return m;
}

/** Updates the wind time of a leaf material made by makeLeafMaterial. */
export function tickLeaves(m: THREE.Material, t: number): void {
  const u = (m.userData as { time?: { value: number } }).time;
  if (u) u.value = t;
}

/** Pushes one quad (two triangles) with explicit per-vertex normal and colour. */
function quad(gb: GeomBuilder, corners: THREE.Vector3[], n: THREE.Vector3, col: THREE.Color): void {
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const k of [0, 1, 2, 0, 2, 3]) {
    const p = corners[k];
    gb.pos.push(p.x, p.y, p.z);
    gb.nor.push(n.x, n.y, n.z);
    gb.uv.push(uvs[k][0], uvs[k][1]);
    gb.col.push(col.r, col.g, col.b);
  }
}

/**
 * Adds one tree at (x, z). bark/leaves are separate builders (two materials).
 * Height ~6-7.5 m, crown ~5 m wide, starting above head height so it never
 * blocks a soldier's view at street level.
 */
export function addTree(bark: GeomBuilder, leaves: GeomBuilder, x: number, z: number, seed: number): void {
  const r = rng(seed * 7919 + 13);
  const scale = 0.9 + r() * 0.3;
  const lean = new THREE.Vector3((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25).normalize();
  // trunk: three tapered segments following the lean, slightly kinked
  let base = new THREE.Vector3(x, 0, z);
  let rad = 0.2 * scale;
  const segs = 3, segLen = 1.15 * scale;
  let dir = lean.clone();
  const barkCol = new THREE.Color(0xffffff);
  const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(r1, r0, len, 8, 1, true);
    _v.subVectors(to, from).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
    _m.compose(_v.clone().multiplyScalar(len / 2).add(from), _q, _s);
    // bark texture: about one repeat per 1.2 m
    const U = g.getAttribute('uv');
    for (let i = 0; i < U.count; i++) U.setY(i, U.getY(i) * len / 1.2);
    bark.add(g, barkCol, _m);
    g.dispose();
  };
  // flared root collar
  const flare = new THREE.CylinderGeometry(rad, rad * 1.7, 0.35, 8, 1, true);
  bark.add(flare, barkCol, _m.makeTranslation(x, 0.17, z));
  for (let i = 0; i < segs; i++) {
    const top = base.clone().addScaledVector(dir, segLen);
    const r1 = rad * 0.78;
    limb(base, top, rad, r1);
    base = top;
    rad = r1;
    dir = dir.clone().add(new THREE.Vector3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3)).normalize();
  }
  const crown = base.clone().add(new THREE.Vector3(0, 1.6 * scale, 0));
  // main branches fanning out and up from the top of the trunk
  const tips: THREE.Vector3[] = [];
  const nb = 4 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + r() * 0.8;
    const out = new THREE.Vector3(Math.cos(a), 0.9 + r() * 0.8, Math.sin(a)).normalize();
    const start = base.clone().addScaledVector(lean, -r() * 0.6);
    const mid = start.clone().addScaledVector(out, (1.0 + r() * 0.5) * scale);
    const tip = mid.clone().addScaledVector(out.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize(), (0.9 + r() * 0.5) * scale);
    limb(start, mid, rad * 0.75, rad * 0.45);
    limb(mid, tip, rad * 0.45, rad * 0.2);
    tips.push(tip);
  }
  // leaf cards clustered round the branch tips and the crown centre
  const rx = 2.4 * scale, ry = 1.7 * scale;
  const n = 120;
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const anchor = i % 3 === 0 ? crown : tips[i % tips.length];
    // random point in a squashed sphere round the anchor, kept inside the crown ellipsoid
    const u = r() * 2 - 1, th = r() * Math.PI * 2, d = Math.cbrt(r());
    const p = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th), u * 0.7, Math.sqrt(1 - u * u) * Math.sin(th))
      .multiplyScalar(d * 1.3 * scale).add(anchor);
    const rel = p.clone().sub(crown);
    const e = Math.hypot(rel.x / rx, rel.y / ry, rel.z / rx);
    if (e > 1) p.copy(crown).addScaledVector(rel, 1 / e);
    if (p.y < 2.6) p.y = 2.6 + r() * 0.4;
    // crown-shaped normal: outward from the centre, biased up
    const nrm = p.clone().sub(crown).multiply(new THREE.Vector3(1 / rx, 1 / ry, 1 / rx)).normalize();
    nrm.y += 0.35;
    nrm.normalize();
    // inner and lower leaves are darker (self-shadowing of the crown)
    const depth = Math.min(1, p.clone().sub(crown).length() / rx);
    const ao = 0.45 + 0.55 * depth * (0.7 + 0.3 * Math.max(0, nrm.y));
    const hue = r();
    col.setRGB((0.82 + hue * 0.25) * ao, (0.9 + hue * 0.1) * ao, (0.7 + hue * 0.1) * ao);
    const size = (1.1 + r() * 0.7) * scale;
    _e.set(r() * Math.PI, r() * Math.PI * 2, r() * Math.PI);
    _q.setFromEuler(_e);
    const hs = size / 2;
    const local = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]];
    for (let k = 0; k < 4; k++) corners[k].set(local[k][0], local[k][1], 0).applyQuaternion(_q).add(p);
    quad(leaves, corners, nrm, col);
  }
}

/** A low shrub (a ball of leaf cards) e.g. in a planter or along a building. */
export function addShrub(leaves: GeomBuilder, x: number, y: number, z: number, radius: number, seed: number): void {
  const r = rng(seed * 31 + 7);
  const c = new THREE.Vector3(x, y, z);
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const col = new THREE.Color();
  const n = Math.round(14 + radius * 22);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, d = Math.cbrt(r()) * radius;
    const dirv = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th), Math.abs(u) * 0.8, Math.sqrt(1 - u * u) * Math.sin(th));
    const p = c.clone().addScaledVector(dirv, d);
    const nrm = dirv.clone();
    nrm.y += 0.4;
    nrm.normalize();
    const ao = 0.5 + 0.5 * (d / radius);
    col.setRGB(0.78 * ao, 0.95 * ao, 0.7 * ao);
    const hs = radius * (0.45 + r() * 0.3);
    _e.set(r() * Math.PI, r() * Math.PI * 2, r() * Math.PI);
    _q.setFromEuler(_e);
    const local = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]];
    for (let k = 0; k < 4; k++) corners[k].set(local[k][0], local[k][1], 0).applyQuaternion(_q).add(p);
    quad(leaves, corners, nrm, col);
  }
}
