import * as THREE from 'three';
import type { VehicleKind } from '../data/vehicles';
import type { Vehicle } from '../game/vehicle';

/**
 * Procedural tank and fighter jet models. Forward is +z (matches yaw), the
 * origin sits on the ground under the body.
 */

interface Parts {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  turret: THREE.Object3D | null;
  barrel: THREE.Object3D | null;
  flame: THREE.Mesh | null;
  gear: THREE.Object3D | null;
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
export function rbox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
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

/** Military paint per team: blue-grey vs rust, so the side reads at a glance. */
function armyPaint(team: 'blue' | 'red', metal = 0.35): THREE.MeshPhysicalMaterial {
  return track(new THREE.MeshPhysicalMaterial({ color: team === 'blue' ? 0x3f5b7c : 0x7c4636, metalness: metal, roughness: 0.55, clearcoat: 0.3 }));
}

function makeTank(team: 'blue' | 'red'): Parts {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const paint = armyPaint(team);
  const band = track(new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x3d8bff : 0xff4a3d, roughness: 0.4 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.5, roughness: 0.55 }));
  const track_ = track(new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.95 }));
  const steel = track(new THREE.MeshStandardMaterial({ color: 0x5d636b, metalness: 0.8, roughness: 0.35 }));
  const head = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.2), toneMapped: false }));
  // hull with a sloped front plate
  body.add(mesh(rbox(2.2, 0.62, 4.5, 0.1), paint, 0, 0.92, 0));
  const glacis = mesh(new THREE.BoxGeometry(2.1, 0.08, 1.0), paint, 0, 1.12, 2.0);
  glacis.rotation.x = 0.45;
  body.add(glacis);
  // tracks: dark belts with road wheels showing on the outside
  const wheels: THREE.Object3D[] = [];
  const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 14);
  wg.rotateZ(Math.PI / 2);
  for (const x of [-1.02, 1.02]) {
    body.add(mesh(rbox(0.5, 0.72, 4.8, 0.3), track_, x, 0.42, 0));
    body.add(mesh(new THREE.BoxGeometry(0.62, 0.06, 4.7), paint, x, 0.88, 0)); // track guard
    for (let i = 0; i < 6; i++) {
      const w = new THREE.Group();
      w.position.set(x * 1.3, 0.38, -1.85 + i * 0.74);
      w.add(mesh(wg, steel));
      // a hub bolt so the roll is visible
      w.add(mesh(new THREE.BoxGeometry(0.17, 0.08, 0.36), dark, 0, 0, 0, false));
      body.add(w);
      wheels.push(w);
    }
  }
  // lights and exhausts
  const lights: THREE.Mesh[] = [];
  for (const x of [-0.8, 0.8]) {
    const h = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), head, x, 1.18, 2.28, false);
    h.rotation.x = Math.PI / 2;
    body.add(h);
    lights.push(h);
    body.add(mesh(new THREE.BoxGeometry(0.3, 0.14, 0.12), dark, x * 0.7, 1.05, -2.27));
  }
  // turret: turns to the driver's aim; the barrel pivots up and down
  const turret = new THREE.Group();
  turret.position.set(0, 1.23, -0.2);
  turret.add(mesh(rbox(1.7, 0.56, 2.1, 0.16), paint, 0, 0.28, 0));
  turret.add(mesh(new THREE.BoxGeometry(1.74, 0.1, 1.2), band, 0, 0.36, -0.2));
  turret.add(mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.22, 14), paint, 0.4, 0.64, -0.3)); // commander hatch
  turret.add(mesh(new THREE.BoxGeometry(0.7, 0.4, 0.6), paint, 0, 0.3, -1.25)); // bustle
  const mg = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), dark, 0.4, 0.86, 0.05);
  mg.rotation.x = Math.PI / 2;
  turret.add(mg);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.32, 1.0);
  const mantlet = mesh(new THREE.BoxGeometry(0.62, 0.38, 0.34), paint, 0, 0, 0.05);
  const tube = mesh(new THREE.CylinderGeometry(0.075, 0.1, 2.7, 12), dark, 0, 0, 1.45);
  tube.rotation.x = Math.PI / 2;
  const brake = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 12), dark, 0, 0, 2.8);
  brake.rotation.x = Math.PI / 2;
  barrel.add(mantlet, tube, brake);
  turret.add(barrel);
  body.add(turret);
  return { root, body, wheels, turret, barrel, flame: null, gear: null, lights };
}

function makeJet(team: 'blue' | 'red'): Parts {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const hull = armyPaint(team, 0.5);
  const band = track(new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x3d8bff : 0xff4a3d, roughness: 0.4 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x23272c, metalness: 0.6, roughness: 0.4 }));
  const glass = track(new THREE.MeshPhysicalMaterial({ color: 0x3a3010, metalness: 0.6, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 }));
  const strobe = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2), toneMapped: false }));
  const nav = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3, 0.6), toneMapped: false }));
  const fire = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.4, 0.4), toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  const Y = 1.35; // fuselage centre height (wheels touch y = 0)
  // fuselage along +z with a pointed nose
  const fus = mesh(new THREE.CylinderGeometry(0.62, 0.72, 6.4, 16), hull, 0, Y, -0.4);
  fus.rotation.x = Math.PI / 2;
  body.add(fus);
  const nose = mesh(new THREE.ConeGeometry(0.62, 2.2, 16), hull, 0, Y, 3.9);
  nose.rotation.x = Math.PI / 2;
  body.add(nose);
  const can = mesh(new THREE.SphereGeometry(0.5, 16, 12), glass, 0, Y + 0.48, 1.9);
  can.scale.set(0.9, 0.8, 2.4);
  body.add(can);
  // air intakes either side of the cockpit
  for (const x of [-0.72, 0.72]) body.add(mesh(new THREE.BoxGeometry(0.42, 0.62, 2.4), hull, x, Y - 0.08, 0.4));
  // flat shapes drawn in (x, z) are laid down with rotateX (shape y becomes world z)
  const flat = (pts: [number, number][], depth: number): THREE.BufferGeometry => {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    g.translate(0, depth / 2, 0);
    return g;
  };
  // swept delta wing and tailplane
  body.add(mesh(flat([[0, 1.6], [3.5, -1.6], [3.5, -2.3], [-3.5, -2.3], [-3.5, -1.6]], 0.1), hull, 0, Y - 0.15, 0));
  body.add(mesh(flat([[0, -2.5], [1.9, -3.7], [1.9, -4.1], [-1.9, -4.1], [-1.9, -3.7]], 0.07), hull, 0, Y - 0.05, 0));
  // team bands on the wing tips
  for (const x of [-3.2, 3.2]) body.add(mesh(new THREE.BoxGeometry(0.6, 0.12, 0.72), band, x, Y - 0.15, -1.95));
  // twin canted tail fins
  for (const x of [-0.55, 0.55]) {
    const fin = mesh(flat([[0, -2.4], [0, -3.9], [1.3, -4.1], [1.3, -3.4]], 0.07), hull, x, Y + 0.3, 0);
    // stand the flat shape up, then lean it outwards
    fin.geometry.rotateZ(Math.PI / 2);
    fin.rotation.z = x > 0 ? -0.35 : 0.35;
    body.add(fin);
  }
  // engine nozzle and the afterburner flame
  const noz = mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.7, 14), dark, 0, Y, -3.85);
  noz.rotation.x = Math.PI / 2;
  body.add(noz);
  const flame = mesh(new THREE.ConeGeometry(0.4, 2.4, 14, 1, true), fire, 0, Y, -5.4, false);
  flame.rotation.x = -Math.PI / 2;
  body.add(flame);
  // bombs under the wings
  for (const x of [-1.7, 1.7]) {
    const b = mesh(new THREE.CapsuleGeometry(0.2, 1.0, 6, 10), dark, x, Y - 0.5, -0.6);
    b.rotation.x = Math.PI / 2;
    body.add(b);
  }
  // landing gear: folds away in the air
  const gear = new THREE.Group();
  const tyre = track(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 }));
  const tg = new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12);
  tg.rotateZ(Math.PI / 2);
  for (const [x, z] of [[0, 2.6], [-1.1, -1.2], [1.1, -1.2]]) {
    gear.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, Y - 0.4, 6), dark, x, (Y - 0.4) / 2 + 0.22, z));
    gear.add(mesh(tg, tyre, x, 0.22, z));
  }
  body.add(gear);
  const lights = [mesh(new THREE.SphereGeometry(0.07, 8, 6), strobe, 0, Y + 1.6, -4.0, false), mesh(new THREE.SphereGeometry(0.06, 8, 6), nav, 3.5, Y - 0.1, -1.9, false)];
  body.add(...lights);
  return { root, body, wheels: [], turret: null, barrel: null, flame, gear, lights };
}

export class VehicleView {
  readonly root: THREE.Group;
  private p: Parts;
  private t = 0;

  constructor(readonly kind: VehicleKind, team: 'blue' | 'red', icon = false) {
    this.p = kind === 'tank' ? makeTank(team) : makeJet(team);
    this.root = this.p.root;
    // shop icon: drop the (invisible) flame so it doesn't blow up the framing
    if (icon && this.p.flame) this.p.flame.removeFromParent();
  }

  sync(v: Vehicle, dt: number): void {
    const p = this.p;
    this.t += dt;
    this.root.position.copy(v.pos);
    this.root.rotation.y = v.yaw;
    if (v.kind === 'tank') {
      for (const w of p.wheels) w.rotation.x = v.wheel * 1.25;
      // turret follows the driver's view; with nobody inside it swings back to the front
      const d = v.driver;
      let want = d ? d.yaw - v.yaw : 0;
      let cur = p.turret!.rotation.y;
      want = cur + Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      cur += (want - cur) * Math.min(1, dt * 6);
      p.turret!.rotation.y = cur;
      const pitch = d ? THREE.MathUtils.clamp(d.pitch, -0.15, 0.35) : 0;
      p.barrel!.rotation.x += (-pitch - p.barrel!.rotation.x) * Math.min(1, dt * 6);
      // the hull rocks back a little when it pulls away
      p.body.rotation.x += (-THREE.MathUtils.clamp(v.speed / 12, -1, 1) * 0.02 - p.body.rotation.x) * Math.min(1, dt * 4);
    } else {
      const spin = v.rotor;
      const f = p.flame!.material as THREE.MeshBasicMaterial;
      const sp = Math.min(1, v.groundSpeed / 25);
      f.opacity = Math.max(0, spin - 0.3) * (0.35 + 0.5 * sp) * (0.85 + 0.15 * Math.sin(this.t * 40));
      p.flame!.scale.set(1, 0.6 + 0.8 * sp, 1);
      p.gear!.visible = v.onGround || spin < 0.6;
      p.body.rotation.x = v.tiltX;
      p.body.rotation.z = -v.tiltZ * 1.6;
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
