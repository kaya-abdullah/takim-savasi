import * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import { GeomBuilder } from './geomBuilder';

/**
 * Detailed weapon models built from primitives. Parts are split by material
 * (gunmetal, polymer/wood, accent paint, glowing bits) so metal reads as metal.
 * Guns point along +Z with the grip near the origin; the muzzle is at z = length.
 */
interface GunGeo { metal: THREE.BufferGeometry; poly: THREE.BufferGeometry; accent: THREE.BufferGeometry; glow: THREE.BufferGeometry | null; muzzle: THREE.Vector3 }

const geoCache = new Map<string, GunGeo>();
let mats: { metal: THREE.MeshStandardMaterial; poly: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial } | null = null;
const glowMats = new Map<number, THREE.MeshBasicMaterial>();

/** Weapon models are drawn larger than life so they read clearly in third person. */
export const GUN_SCALE = 1.3;

const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
function cyl(r: number, len: number, seg = 16, r2 = r): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  g.rotateX(Math.PI / 2); // along +Z
  return g;
}

function buildGeo(w: WeaponDef): GunGeo {
  const M = new GeomBuilder(), P = new GeomBuilder(), A = new GeomBuilder(), G = new GeomBuilder();
  const L = w.length;
  const gm = 0x2b2e33, dark = 0x17191c, steel = 0x6d737b;
  const body = w.body, acc = w.accent;
  let muzzleZ = L, muzzleY = 0.06;

  // shared bits
  const grip = (z: number, h = 0.13) => {
    const g = new THREE.BoxGeometry(0.036, h, 0.055);
    g.rotateX(0.28);
    P.add(g, dark, T(0, -0.035 - h / 2 + 0.05, z));
  };
  const triggerGuard = (z: number) => {
    const t = new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI);
    t.rotateY(Math.PI / 2);
    t.rotateX(Math.PI);
    M.add(t, gm, T(0, -0.005, z + 0.035));
    M.box(0, -0.02, z + 0.04, 0.006, 0.025, 0.006, steel); // trigger
  };
  const rail = (z0: number, z1: number, y: number) => {
    M.box(0, y, (z0 + z1) / 2, 0.026, 0.012, z1 - z0, dark);
    for (let z = z0 + 0.01; z < z1; z += 0.022) M.box(0, y + 0.009, z, 0.028, 0.006, 0.01, dark);
  };
  const ironSights = (zr: number, zf: number, y: number) => {
    M.box(0, y + 0.018, zr, 0.03, 0.03, 0.012, dark);
    M.box(0, y + 0.022, zf, 0.008, 0.036, 0.01, dark);
  };
  const barrel = (z0: number, len: number, r: number, y: number) => {
    M.add(cyl(r, len), gm, T(0, y, z0 + len / 2));
    // muzzle device with slots
    M.add(cyl(r * 1.45, 0.05, 12), dark, T(0, y, z0 + len - 0.02));
    for (const s of [-1, 1]) M.box(s * r * 1.3, y, z0 + len - 0.02, 0.006, r * 1.6, 0.03, 0x0b0c0e);
    muzzleZ = z0 + len + 0.01;
    muzzleY = y;
  };
  const mag = (z: number, len: number, curve: number, color = dark) => {
    // two tilted segments read as a curved box magazine
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BoxGeometry(0.03, len / 2, 0.05);
      g.rotateX(curve * (i + 0.5));
      M.add(g, color, T(0, -0.05 - (i + 0.5) * len * 0.47, z + i * len * 0.12 * curve * 4));
    }
  };

  switch (w.id) {
    case 'pistol':
    case 'revolver': {
      const rev = w.id === 'revolver';
      M.box(0, 0.055, L * 0.45, 0.034, 0.042, L * 0.92, rev ? steel : gm); // slide / frame top
      P.box(0, 0.02, L * 0.32, 0.032, 0.03, L * 0.55, rev ? steel : body); // frame
      if (rev) {
        M.add(cyl(0.032, 0.07, 12), steel, T(0, 0.035, 0.12)); // cylinder
        for (let i = 0; i < 6; i++) M.box(0, 0.035 + Math.cos(i) * 0.024, 0.12, 0.034, 0.004, 0.072, gm);
        M.add(cyl(0.012, L * 0.55), steel, T(0, 0.06, L * 0.65));
        P.box(0, -0.035, 0.0, 0.034, 0.1, 0.05, acc); // wooden grip
      } else {
        for (let z = 0.02; z < 0.1; z += 0.014) M.box(0, 0.06, z, 0.036, 0.04, 0.005, dark); // slide serrations
        P.box(0, -0.035, 0.01, 0.032, 0.1, 0.05, acc);
      }
      triggerGuard(0.03);
      ironSights(0.03, L * 0.86, 0.075);
      muzzleZ = L + 0.01;
      muzzleY = 0.06;
      break;
    }
    case 'smg': {
      M.box(0, 0.05, L * 0.42, 0.05, 0.075, L * 0.6, gm); // receiver
      P.box(0, 0.035, L * 0.72, 0.054, 0.06, L * 0.18, body); // handguard
      rail(L * 0.15, L * 0.68, 0.094);
      barrel(L * 0.78, L * 0.28, 0.012, 0.055);
      mag(0.16, 0.2, 0.0);
      grip(0.04);
      triggerGuard(0.06);
      M.box(0, 0.05, -0.08, 0.02, 0.02, 0.16, steel); // wire stock
      M.box(0, 0.0, -0.16, 0.02, 0.1, 0.02, steel);
      ironSights(0.06, L * 0.66, 0.1);
      G.box(0.028, 0.06, L * 0.45, 0.004, 0.012, L * 0.3, acc);
      break;
    }
    case 'sniper': {
      P.box(0, 0.03, L * 0.25, 0.05, 0.08, L * 0.55, body); // stock body
      P.box(0, 0.0, -0.12, 0.045, 0.12, 0.26, body); // butt
      M.box(0, -0.0, -0.25, 0.048, 0.13, 0.02, dark); // butt pad
      M.box(0, 0.065, L * 0.28, 0.044, 0.04, L * 0.3, gm); // action
      M.add(cyl(0.008, 0.06, 8), steel, T(0.04, 0.07, L * 0.2)); // bolt handle
      barrel(L * 0.42, L * 0.58, 0.014, 0.065);
      // scope: tube, bells, turrets, glass
      M.add(cyl(0.022, 0.3, 18), dark, T(0, 0.13, L * 0.3));
      M.add(cyl(0.034, 0.08, 18, 0.022), dark, T(0, 0.13, L * 0.3 + 0.17));
      M.add(cyl(0.022, 0.06, 18, 0.03), dark, T(0, 0.13, L * 0.3 - 0.16));
      M.add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), dark, T(0, 0.16, L * 0.3));
      for (const z of [L * 0.22, L * 0.38]) M.box(0, 0.1, z, 0.03, 0.04, 0.02, dark); // rings
      G.add(cyl(0.03, 0.004, 18), 0x66ccff, T(0, 0.13, L * 0.3 + 0.212));
      mag(0.12, 0.08, 0);
      grip(0.04, 0.1);
      triggerGuard(0.05);
      // bipod folded under the barrel
      for (const s of [-1, 1]) M.box(s * 0.015, 0.03, L * 0.62, 0.008, 0.008, 0.2, gm);
      break;
    }
    case 'shotgun': {
      barrel(L * 0.2, L * 0.82, 0.02, 0.075);
      M.add(cyl(0.017, L * 0.62), gm, T(0, 0.035, L * 0.5)); // tube magazine
      P.box(0, 0.045, L * 0.6, 0.056, 0.05, L * 0.25, acc); // pump
      for (let z = L * 0.5; z < L * 0.72; z += 0.025) P.box(0, 0.045, z, 0.06, 0.054, 0.008, dark);
      M.box(0, 0.06, 0.08, 0.052, 0.08, 0.24, gm); // receiver
      P.box(0, 0.03, -0.16, 0.046, 0.1, 0.3, body); // stock
      M.box(0, 0.03, -0.31, 0.048, 0.11, 0.02, dark);
      grip(0.02);
      triggerGuard(0.03);
      M.add(new THREE.SphereGeometry(0.007, 6, 4), 0xffd27a, T(0, 0.1, L * 0.98)); // bead sight
      break;
    }
    case 'minigun': {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        M.add(cyl(0.011, L * 0.68, 8), gm, T(Math.cos(a) * 0.042, 0.07 + Math.sin(a) * 0.042, L * 0.62));
      }
      M.add(cyl(0.06, 0.03, 16), dark, T(0, 0.07, L * 0.5));
      M.add(cyl(0.06, 0.03, 16), dark, T(0, 0.07, L * 0.9));
      M.add(cyl(0.075, 0.24, 18), gm, T(0, 0.07, 0.15));
      P.box(0, -0.06, 0.12, 0.16, 0.13, 0.2, acc); // ammo box
      M.box(0.09, -0.0, 0.18, 0.02, 0.1, 0.03, dark); // feed chute
      M.box(0, 0.17, 0.08, 0.025, 0.07, 0.24, dark); // carry handle
      grip(-0.02, 0.12);
      muzzleZ = L * 0.97;
      muzzleY = 0.07;
      break;
    }
    case 'rocket': {
      P.add(cyl(0.07, L, 20), body, T(0, 0.09, L * 0.42));
      M.add(cyl(0.082, 0.1, 20, 0.074), dark, T(0, 0.09, L * 0.92));
      M.add(cyl(0.08, 0.08, 20), dark, T(0, 0.09, -0.08));
      A.add(cyl(0.072, 0.04, 20), acc, T(0, 0.09, L * 0.7));
      A.add(new THREE.ConeGeometry(0.05, 0.12, 14).rotateX(Math.PI / 2), acc, T(0, 0.09, L * 0.93)); // warhead tip
      grip(0.12);
      grip(0.42);
      triggerGuard(0.14);
      M.box(0.06, 0.17, 0.3, 0.02, 0.05, 0.12, dark); // sight
      G.box(0.07, 0.19, 0.3, 0.01, 0.01, 0.02, 0xff3020);
      muzzleZ = L * 0.98;
      muzzleY = 0.09;
      break;
    }
    case 'plasma': {
      P.box(0, 0.05, L * 0.35, 0.07, 0.1, L * 0.62, body);
      P.box(0, 0.03, -0.12, 0.06, 0.09, 0.22, body);
      M.add(cyl(0.028, L * 0.3, 14), dark, T(0, 0.05, L * 0.83));
      for (let i = 0; i < 4; i++) G.add(cyl(0.042, 0.022, 16), acc, T(0, 0.05, L * 0.5 + i * 0.065));
      G.box(0, 0.105, L * 0.3, 0.03, 0.012, L * 0.45, acc);
      G.box(0.037, 0.05, L * 0.2, 0.004, 0.04, 0.12, acc);
      rail(L * 0.1, L * 0.45, 0.106);
      grip(0.03);
      triggerGuard(0.05);
      muzzleZ = L + 0.01;
      muzzleY = 0.05;
      break;
    }
    default: {
      // rifle, lmg, burst: AR-style platform
      const lmg = w.id === 'lmg';
      M.box(0, 0.055, L * 0.28, 0.05, 0.075, L * 0.42, gm); // upper receiver
      P.box(0, 0.025, L * 0.18, 0.048, 0.05, L * 0.32, body); // lower
      P.box(0, 0.055, L * 0.6, lmg ? 0.064 : 0.056, 0.065, L * 0.26, body); // handguard
      for (let z = L * 0.5; z < L * 0.72; z += 0.03) M.box(0, 0.055, z, (lmg ? 0.066 : 0.058), 0.012, 0.012, dark); // vents
      rail(L * 0.05, L * 0.72, 0.1);
      barrel(L * 0.73, L * 0.3, 0.012, 0.06);
      M.box(0, 0.04, -0.06, 0.024, 0.03, 0.14, dark); // buffer tube
      P.box(0, 0.03, -0.16, 0.044, 0.1, 0.16, acc); // stock
      M.box(0, 0.03, -0.245, 0.046, 0.105, 0.015, dark);
      M.box(0.028, 0.07, L * 0.22, 0.004, 0.02, 0.05, 0x0b0c0e); // ejection port
      M.box(0, 0.1, -0.0, 0.03, 0.012, 0.02, steel); // charging handle
      grip(0.05);
      triggerGuard(0.07);
      if (lmg) {
        P.box(0, -0.07, L * 0.3, 0.11, 0.12, 0.16, acc); // box mag
        M.box(0.06, 0.02, L * 0.3, 0.03, 0.06, 0.12, dark);
        for (const s of [-1, 1]) M.box(s * 0.02, 0.0, L * 0.8, 0.008, 0.008, 0.22, gm); // bipod
      } else {
        mag(L * 0.3, 0.17, 0.18);
        // red-dot optic
        M.box(0, 0.125, L * 0.25, 0.034, 0.04, 0.06, dark);
        G.box(0, 0.13, L * 0.25 + 0.031, 0.02, 0.02, 0.002, 0xff3020);
      }
      if (w.id === 'burst') G.box(0.029, 0.03, L * 0.15, 0.003, 0.012, L * 0.2, acc);
      ironSights(L * 0.08, L * 0.7, 0.105);
    }
  }
  return {
    metal: M.build(), poly: P.build(), accent: A.vertexCount ? A.build() : new THREE.BufferGeometry(),
    glow: G.vertexCount ? G.build() : null, muzzle: new THREE.Vector3(0, muzzleY, muzzleZ),
  };
}

export function makeWeaponMesh(w: WeaponDef): THREE.Group {
  let g = geoCache.get(w.id);
  if (!g) geoCache.set(w.id, (g = buildGeo(w)));
  if (!mats) {
    mats = {
      // gunmetal: very metallic, slightly rough so it catches the sky without mirroring it
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.2 }),
      poly: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.62 }),
      accent: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.4 }),
    };
  }
  const grp = new THREE.Group();
  for (const [geo, mat] of [[g.metal, mats.metal], [g.poly, mats.poly], [g.accent, mats.accent]] as const) {
    if (!geo.getAttribute('position')) continue;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    grp.add(m);
  }
  if (g.glow) {
    let gm = glowMats.get(w.accent);
    if (!gm) {
      gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(w.accent).multiplyScalar(3), toneMapped: false, vertexColors: false });
      glowMats.set(w.accent, gm);
    }
    grp.add(new THREE.Mesh(g.glow, gm));
  }
  grp.scale.setScalar(GUN_SCALE);
  grp.userData.muzzle = g.muzzle.clone();
  return grp;
}
