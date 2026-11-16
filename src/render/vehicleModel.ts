import * as THREE from 'three';
import type { VehicleKind } from '../data/vehicles';
import type { Vehicle } from '../game/vehicle';

/**
 * Procedural car and helicopter models. Forward is +z (matches yaw), the
 * origin sits on the ground under the body.
 */

interface Parts {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  rotor: THREE.Object3D | null;
  tailRotor: THREE.Object3D | null;
  disc: THREE.Mesh | null;
  lights: THREE.Mesh[];
}

/** Marks a material as owned by this model (disposed with it). */
function track<T extends THREE.Material>(m: T): T {
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

/** Rounded box: a box with bevelled edges via ExtrudeGeometry. */
function rbox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r * 0.6, bevelEnabled: true, bevelSize: r * 0.6, bevelThickness: r * 0.6, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(d - 2 * r * 0.6) / 2);
  return g;
}

function makeCar(team: 'blue' | 'red'): Parts {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const paint = track(new THREE.MeshPhysicalMaterial({
    color: team === 'blue' ? 0x1d5fd8 : 0xd8261d, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
  }));
  const stripe = track(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35 }));
  const glass = track(new THREE.MeshPhysicalMaterial({ color: 0x0d151d, metalness: 0.2, roughness: 0.05, clearcoat: 1 }));
  const black = track(new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.7 }));
  const chrome = track(new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.18 }));
  const tyre = track(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 }));
  const head = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.2), toneMapped: false }));
  const tail = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.1), toneMapped: false }));
  // lower body, hood and boot
  body.add(mesh(rbox(1.96, 0.6, 4.4, 0.16), paint, 0, 0.62, 0));
  const hood = mesh(rbox(1.8, 0.16, 1.5, 0.06), paint, 0, 0.94, 1.25);
  hood.rotation.x = 0.08;
  body.add(hood);
  // cabin: tinted glasshouse with a painted roof
  const cab = mesh(rbox(1.66, 0.52, 2.0, 0.14), glass, 0, 1.15, -0.3);
  body.add(cab);
  body.add(mesh(rbox(1.5, 0.07, 1.55, 0.03), paint, 0, 1.43, -0.4));
  // racing stripes
  body.add(mesh(new THREE.BoxGeometry(0.22, 0.02, 4.38), stripe, 0.22, 0.93, 0));
  body.add(mesh(new THREE.BoxGeometry(0.22, 0.02, 4.38), stripe, -0.22, 0.93, 0));
  // bumpers, skirts, spoiler
  body.add(mesh(new THREE.BoxGeometry(1.9, 0.22, 0.18), black, 0, 0.42, 2.22));
  body.add(mesh(new THREE.BoxGeometry(1.9, 0.22, 0.18), black, 0, 0.42, -2.22));
  body.add(mesh(new THREE.BoxGeometry(2.0, 0.1, 3.0), black, 0, 0.33, 0));
  body.add(mesh(new THREE.BoxGeometry(1.9, 0.06, 0.32), paint, 0, 1.22, -2.05));
  for (const x of [-0.7, 0.7]) body.add(mesh(new THREE.BoxGeometry(0.06, 0.28, 0.14), black, x, 1.06, -2.05));
  // lights and grille
  const lights: THREE.Mesh[] = [];
  for (const x of [-0.66, 0.66]) {
    const h = mesh(new THREE.BoxGeometry(0.42, 0.12, 0.05), head, x, 0.78, 2.21, false);
    const t = mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), tail, x, 0.8, -2.21, false);
    body.add(h, t);
    lights.push(h, t);
  }
  body.add(mesh(new THREE.BoxGeometry(0.7, 0.14, 0.04), chrome, 0, 0.66, 2.22));
  // mirrors
  for (const x of [-0.95, 0.95]) body.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), paint, x, 1.08, 0.55));
  // wheels with chrome rims
  const wheels: THREE.Object3D[] = [], front: THREE.Object3D[] = [];
  const tg = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 20);
  tg.rotateZ(Math.PI / 2);
  const rg = new THREE.CylinderGeometry(0.24, 0.24, 0.32, 10);
  rg.rotateZ(Math.PI / 2);
  for (const [x, z] of [[0.86, 1.35], [-0.86, 1.35], [0.86, -1.38], [-0.86, -1.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.38, z);
    const spin = new THREE.Group();
    spin.add(mesh(tg, tyre), mesh(rg, chrome));
    // spokes so the roll is visible
    for (let k = 0; k < 3; k++) {
      const sp = mesh(new THREE.BoxGeometry(0.33, 0.06, 0.42), chrome, 0, 0, 0, false);
      sp.rotation.x = (k * Math.PI) / 3;
      spin.add(sp);
    }
    pivot.add(spin);
    root.add(pivot);
    wheels.push(spin);
    if (z > 0) front.push(pivot);
  }
  return { root, body, wheels, frontWheels: front, rotor: null, tailRotor: null, disc: null, lights };
}

function makeHeli(team: 'blue' | 'red'): Parts {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const hull = track(new THREE.MeshPhysicalMaterial({ color: team === 'blue' ? 0x2f4f6f : 0x6f2f2f, metalness: 0.4, roughness: 0.45, clearcoat: 0.6 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x23272c, metalness: 0.6, roughness: 0.4 }));
  const glass = track(new THREE.MeshPhysicalMaterial({ color: 0x1b2a36, metalness: 0.1, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 }));
  const blade = track(new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.6 }));
  const strobe = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2), toneMapped: false }));
  const nav = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3, 0.6), toneMapped: false }));
  const Y = 1.25; // fuselage centre height (skids touch y = 0)
  const fus = mesh(new THREE.CapsuleGeometry(0.95, 2.2, 8, 16), hull, 0, Y, 0);
  fus.rotation.x = Math.PI / 2;
  fus.scale.set(1, 1, 0.9);
  body.add(fus);
  // bubble canopy
  const can = mesh(new THREE.SphereGeometry(0.88, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), glass, 0, Y + 0.15, 1.15);
  can.rotation.x = Math.PI / 2.4;
  body.add(can);
  // tail boom, fin and stabiliser
  const boom = mesh(new THREE.CylinderGeometry(0.13, 0.32, 4.2, 12), hull, 0, Y + 0.25, -3.3);
  boom.rotation.x = Math.PI / 2;
  body.add(boom);
  const fin = mesh(new THREE.BoxGeometry(0.08, 1.1, 0.7), hull, 0, Y + 0.75, -5.25);
  fin.rotation.x = -0.35;
  body.add(fin);
  body.add(mesh(new THREE.BoxGeometry(1.5, 0.06, 0.45), hull, 0, Y + 0.25, -4.9));
  // engine housing and mast
  body.add(mesh(rbox(0.9, 0.45, 1.6, 0.15), dark, 0, Y + 0.95, -0.3));
  body.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 10), dark, 0, Y + 1.3, 0));
  // stub wings with rocket pods and a nose gun
  body.add(mesh(new THREE.BoxGeometry(2.9, 0.08, 0.6), hull, 0, Y - 0.1, -0.2));
  for (const x of [-1.35, 1.35]) {
    const pod = mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.0, 10), dark, x, Y - 0.32, -0.15);
    pod.rotation.x = Math.PI / 2;
    body.add(pod);
  }
  const gun = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), dark, 0, Y - 0.75, 1.75);
  gun.rotation.x = Math.PI / 2;
  body.add(gun);
  body.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), dark, 0, Y - 0.7, 1.35));
  // skids
  for (const x of [-0.8, 0.8]) {
    const sk = mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 8), dark, x, 0.05, 0.1);
    sk.rotation.x = Math.PI / 2;
    body.add(sk);
    for (const z of [-0.7, 0.8]) {
      const st = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.85, 6), dark, x * 0.85, 0.45, z);
      st.rotation.z = x > 0 ? 0.3 : -0.3;
      body.add(st);
    }
  }
  // lights
  const lights = [mesh(new THREE.SphereGeometry(0.06, 8, 6), strobe, 0, Y + 1.3, -5.5, false), mesh(new THREE.SphereGeometry(0.05, 8, 6), nav, 1.45, Y - 0.1, -0.2, false)];
  body.add(...lights);
  // main rotor
  const rotor = new THREE.Group();
  rotor.position.set(0, Y + 1.58, 0);
  rotor.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 12), dark));
  for (let k = 0; k < 4; k++) {
    const b = mesh(new THREE.BoxGeometry(0.26, 0.035, 5.4), blade, 0, 0, 0);
    b.geometry.translate(0, 0, 2.75);
    b.rotation.y = (k * Math.PI) / 2;
    rotor.add(b);
  }
  body.add(rotor);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.6, 40), track(new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, Y + 1.6, 0);
  body.add(disc);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.12, Y + 0.85, -5.45);
  for (let k = 0; k < 2; k++) {
    const b = mesh(new THREE.BoxGeometry(0.03, 1.2, 0.12), blade, 0, 0, 0, false);
    b.rotation.x = (k * Math.PI) / 2;
    tailRotor.add(b);
  }
  body.add(tailRotor);
  return { root, body, wheels: [], frontWheels: [], rotor, tailRotor, disc, lights };
}

export class VehicleView {
  readonly root: THREE.Group;
  private p: Parts;
  private t = 0;

  constructor(readonly kind: VehicleKind, team: 'blue' | 'red', icon = false) {
    this.p = kind === 'car' ? makeCar(team) : makeHeli(team);
    this.root = this.p.root;
    // shop icon: drop the (invisible) blur disc so it doesn't blow up the framing
    if (icon && this.p.disc) this.p.disc.removeFromParent();
  }

  sync(v: Vehicle, dt: number): void {
    const p = this.p;
    this.t += dt;
    this.root.position.copy(v.pos);
    this.root.rotation.y = v.yaw;
    if (v.kind === 'car') {
      for (const w of p.wheels) w.rotation.x = v.wheel;
      for (const w of p.frontWheels) w.rotation.y = -v.steer * 0.45;
      // body rolls in turns and dips under braking
      p.body.rotation.z += (v.steer * Math.min(1, Math.abs(v.speed) / 12) * 0.05 - p.body.rotation.z) * Math.min(1, dt * 6);
    } else {
      const spin = v.rotor;
      p.rotor!.rotation.y += dt * spin * 32;
      p.tailRotor!.rotation.x += dt * spin * 45;
      // a faint blur disc once the blades are a smear
      (p.disc!.material as THREE.MeshBasicMaterial).opacity = Math.max(0, spin - 0.5) * 0.35;
      p.body.rotation.x = v.tiltX;
      p.body.rotation.z = -v.tiltZ;
      p.lights[0].visible = Math.sin(this.t * 6) > 0.6;
    }
  }

  /** Frees GPU geometry and materials (each view owns its own). */
  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }
}
