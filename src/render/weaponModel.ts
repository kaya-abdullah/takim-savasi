import * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import { GeomBuilder } from './geomBuilder';

const geoCache = new Map<string, { body: THREE.BufferGeometry; glow: THREE.BufferGeometry | null }>();
let bodyMat: THREE.MeshStandardMaterial | null = null;
const glowMats = new Map<number, THREE.MeshBasicMaterial>();

function cyl(r: number, len: number, seg = 18): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2); // along +Z
  return g;
}
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/** Builds a stylised gun along +Z, grip at the origin. Muzzle at z = length. */
function buildGeo(w: WeaponDef) {
  const gb = new GeomBuilder();
  const glow = new GeomBuilder();
  const L = w.length;
  const body = w.body, acc = w.accent;
  const dark = 0x1a1c1f;
  switch (w.id) {
    case 'pistol':
    case 'revolver': {
      gb.box(0, 0.06, L * 0.45, 0.05, 0.07, L * 0.9, body);
      gb.box(0, -0.04, 0.02, 0.045, 0.14, 0.06, acc);
      if (w.id === 'revolver') gb.add(cyl(0.035, 0.08, 8), dark, T(0, 0.03, 0.14));
      gb.add(cyl(0.012, 0.05), dark, T(0, 0.075, L - 0.01));
      break;
    }
    case 'smg': {
      gb.box(0, 0.05, L * 0.4, 0.06, 0.09, L * 0.7, body);
      gb.box(0, -0.06, 0.05, 0.045, 0.14, 0.06, dark);
      gb.box(0, -0.08, 0.2, 0.035, 0.18, 0.05, acc);
      gb.add(cyl(0.018, L * 0.3), dark, T(0, 0.06, L * 0.85));
      gb.box(0, 0.06, -0.12, 0.04, 0.05, 0.2, dark);
      glow.box(0, 0.105, L * 0.4, 0.02, 0.01, L * 0.4, acc);
      break;
    }
    case 'sniper': {
      gb.box(0, 0.04, L * 0.3, 0.06, 0.09, L * 0.6, body);
      gb.add(cyl(0.017, L * 0.5), dark, T(0, 0.055, L * 0.75));
      gb.box(0, 0.02, -0.18, 0.05, 0.12, 0.32, acc);
      gb.box(0, -0.05, 0.05, 0.04, 0.12, 0.06, dark);
      gb.add(cyl(0.035, 0.34, 12), dark, T(0, 0.14, L * 0.3));
      glow.add(cyl(0.028, 0.01, 12), 0x66ccff, T(0, 0.14, L * 0.3 + 0.175));
      break;
    }
    case 'shotgun': {
      gb.add(cyl(0.025, L * 0.75), dark, T(0, 0.07, L * 0.6));
      gb.add(cyl(0.022, L * 0.6), body, T(0, 0.025, L * 0.55));
      gb.box(0, 0.04, 0.08, 0.06, 0.1, 0.3, body);
      gb.box(0, 0.02, -0.2, 0.05, 0.11, 0.3, acc);
      gb.box(0, -0.05, 0.02, 0.04, 0.12, 0.06, dark);
      break;
    }
    case 'minigun': {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        gb.add(cyl(0.014, L * 0.7, 6), dark, T(Math.cos(a) * 0.045, 0.06 + Math.sin(a) * 0.045, L * 0.62));
      }
      gb.add(cyl(0.075, 0.22, 12), body, T(0, 0.06, 0.12));
      gb.box(0, -0.08, 0.1, 0.18, 0.14, 0.2, acc);
      gb.box(0, 0.16, 0.05, 0.03, 0.06, 0.2, dark);
      break;
    }
    case 'rocket': {
      gb.add(cyl(0.075, L, 14), body, T(0, 0.08, L * 0.4));
      gb.add(cyl(0.085, 0.12, 14), acc, T(0, 0.08, L * 0.9));
      gb.box(0, -0.04, 0.12, 0.04, 0.14, 0.06, dark);
      gb.box(0, 0.18, 0.3, 0.03, 0.06, 0.12, dark);
      break;
    }
    case 'plasma': {
      gb.box(0, 0.05, L * 0.35, 0.08, 0.11, L * 0.7, body);
      gb.add(cyl(0.03, L * 0.35, 10), dark, T(0, 0.05, L * 0.82));
      gb.box(0, -0.06, 0.04, 0.045, 0.14, 0.06, dark);
      gb.box(0, 0.03, -0.14, 0.06, 0.1, 0.22, body);
      for (let i = 0; i < 3; i++) glow.add(cyl(0.045, 0.03, 12), acc, T(0, 0.05, L * 0.55 + i * 0.07));
      glow.box(0, 0.11, L * 0.3, 0.03, 0.012, L * 0.45, acc);
      break;
    }
    default: {
      // rifle, lmg, burst
      gb.box(0, 0.05, L * 0.35, 0.06, 0.1, L * 0.55, body);
      gb.add(cyl(0.018, L * 0.4), dark, T(0, 0.06, L * 0.8));
      gb.box(0, 0.035, -0.17, 0.05, 0.11, 0.28, acc);
      gb.box(0, -0.06, 0.04, 0.04, 0.13, 0.06, dark);
      if (w.id === 'lmg') {
        gb.box(0, -0.06, 0.24, 0.12, 0.12, 0.16, acc);
        gb.box(0, 0.115, L * 0.3, 0.05, 0.03, 0.3, dark);
      } else {
        gb.box(0, -0.09, 0.2, 0.04, 0.17, 0.07, dark);
        gb.box(0, 0.12, L * 0.3, 0.03, 0.04, 0.12, dark);
      }
      if (w.id === 'burst') glow.box(0, 0.105, L * 0.42, 0.065, 0.012, L * 0.2, acc);
    }
  }
  return { body: gb.build(), glow: glow.vertexCount ? glow.build() : null };
}

export function makeWeaponMesh(w: WeaponDef): THREE.Group {
  let g = geoCache.get(w.id);
  if (!g) geoCache.set(w.id, (g = buildGeo(w)));
  if (!bodyMat) bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
  const grp = new THREE.Group();
  const body = new THREE.Mesh(g.body, bodyMat);
  body.castShadow = true;
  grp.add(body);
  if (g.glow) {
    let gm = glowMats.get(w.accent);
    if (!gm) {
      gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(w.accent).multiplyScalar(3), toneMapped: false });
      glowMats.set(w.accent, gm);
    }
    grp.add(new THREE.Mesh(g.glow, gm));
  }
  grp.userData.muzzle = new THREE.Vector3(0, 0.06, w.length);
  return grp;
}
