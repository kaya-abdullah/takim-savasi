import * as THREE from 'three';
import type { Pickup, PickupKind } from '../game/match';
import { GeomBuilder } from './geomBuilder';

const COLORS: Record<PickupKind, number> = { health: 0x3dff7a, damage: 0xff3b3b, speed: 0x3dd8ff, airdrop: 0xffc533 };

function beamMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    // bright at the bottom, fading upward, with slow rising bands
    fragmentShader: `uniform vec3 color; uniform float time; varying vec2 vUv;
      void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * (0.55 + 0.25 * sin(vUv.y * 30.0 - time * 4.0));
      gl_FragColor = vec4(color * 1.6, a * 0.75); }`,
  });
}

function iconGeometry(kind: PickupKind): THREE.BufferGeometry {
  const gb = new GeomBuilder();
  if (kind === 'health') {
    gb.box(0, 0, 0, 0.5, 0.5, 0.16, 0xffffff);
    gb.box(0, 0, 0, 0.36, 0.11, 0.18, 0xe02020);
    gb.box(0, 0, 0, 0.11, 0.36, 0.18, 0xe02020);
  } else if (kind === 'damage') {
    gb.add(new THREE.OctahedronGeometry(0.3, 0), 0xff4040);
    gb.add(new THREE.TorusGeometry(0.36, 0.035, 6, 24), 0xffd0d0);
  } else {
    // speed: stacked chevrons
    for (let i = 0; i < 3; i++) {
      const c = new THREE.ConeGeometry(0.2, 0.22, 3);
      c.rotateZ(-Math.PI / 2);
      gb.add(c, 0x7fe8ff, new THREE.Matrix4().makeTranslation(-0.18 + i * 0.18, 0, 0));
    }
  }
  return gb.build();
}

function crate(): THREE.Group {
  const g = new THREE.Group();
  const gb = new GeomBuilder();
  gb.box(0, 0.55, 0, 1.3, 1.1, 1.3, 0x4a5d2e);
  for (const y of [0.12, 0.98]) gb.box(0, y, 0, 1.34, 0.1, 1.34, 0x2f3b1d);
  for (const x of [-0.6, 0.6]) for (const z of [-0.6, 0.6]) gb.box(x, 0.55, z, 0.12, 1.12, 0.12, 0x2f3b1d);
  gb.box(0, 0.55, 0.66, 0.5, 0.5, 0.02, 0xffc533); // star plate
  gb.box(0, 0.55, -0.66, 0.5, 0.5, 0.02, 0xffc533);
  const body = new THREE.Mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  body.castShadow = true;
  g.add(body);
  // parachute: striped canopy + cords
  const chute = new THREE.Group();
  chute.name = 'chute';
  const canopyGeo = new THREE.SphereGeometry(2.2, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
  const cols = new Float32Array(canopyGeo.attributes.position.count * 3);
  const cA = new THREE.Color(0xff7a1a), cB = new THREE.Color(0xffffff);
  for (let i = 0; i < canopyGeo.attributes.position.count; i++) {
    const x = canopyGeo.attributes.position.getX(i), z = canopyGeo.attributes.position.getZ(i);
    const seg = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8);
    (seg % 2 ? cA : cB).toArray(cols, i * 3);
  }
  canopyGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  canopy.position.y = 3.6;
  canopy.castShadow = true;
  chute.add(canopy);
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push(0, 1.1, 0, Math.cos(a) * 1.75, 4.55, Math.sin(a) * 1.75);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  chute.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdddddd })));
  g.add(chute);
  return g;
}

/** Visuals for power-ups and supply drops, synced from Match.pickups. */
export class PickupViews {
  readonly group = new THREE.Group();
  private views = new Map<Pickup, { root: THREE.Group; icon?: THREE.Object3D; beam: THREE.Mesh; ring: THREE.Mesh }>();
  private icons: Partial<Record<PickupKind, THREE.BufferGeometry>> = {};
  private iconMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2, emissive: 0x222222 });
  private beamGeo: THREE.CylinderGeometry;
  private ringGeo: THREE.RingGeometry;
  private t = 0;

  constructor() {
    this.beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 18, 16, 1, true);
    this.beamGeo.translate(0, 9, 0);
    this.ringGeo = new THREE.RingGeometry(0.9, 1.15, 32);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  private make(p: Pickup) {
    const root = new THREE.Group();
    const col = COLORS[p.kind];
    const beam = new THREE.Mesh(this.beamGeo, beamMaterial(col));
    beam.frustumCulled = false;
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.5), transparent: true, depthWrite: false, toneMapped: false }));
    ring.position.y = 0.04;
    let icon: THREE.Object3D | undefined;
    if (p.kind === 'airdrop') {
      icon = crate();
      beam.scale.set(1.6, 2.2, 1.6);
    } else {
      let g = this.icons[p.kind];
      if (!g) this.icons[p.kind] = g = iconGeometry(p.kind);
      icon = new THREE.Mesh(g, this.iconMat);
      icon.position.y = 1.1;
    }
    root.add(beam, ring, icon);
    this.group.add(root);
    const v = { root, icon, beam, ring };
    this.views.set(p, v);
    return v;
  }

  sync(pickups: Pickup[], dt: number, onFallingSmoke: (pos: THREE.Vector3) => void): void {
    this.t += dt;
    for (const p of pickups) {
      const v = this.views.get(p) ?? this.make(p);
      if (p.kind === 'airdrop') {
        v.icon!.position.set(0, p.pos.y, 0);
        v.icon!.getObjectByName('chute')!.visible = p.falling;
        v.icon!.rotation.y = p.falling ? Math.sin(this.t) * 0.2 : 0;
        // red flare smoke marks the landing zone while the crate falls
        if (p.falling && Math.random() < dt * 8) onFallingSmoke(p.pos);
      } else {
        v.icon!.rotation.y += dt * 2;
        v.icon!.position.y = 1.1 + Math.sin(this.t * 3 + p.pos.x) * 0.12;
      }
      v.root.position.set(p.pos.x, 0, p.pos.z);
      (v.beam.material as THREE.ShaderMaterial).uniforms.time.value = this.t;
      const pulse = 1 + Math.sin(this.t * 4) * 0.12;
      v.ring.scale.set(pulse, 1, pulse);
    }
    for (const [p, v] of this.views) {
      if (pickups.includes(p) && p.alive) continue;
      this.group.remove(v.root);
      (v.beam.material as THREE.Material).dispose();
      (v.ring.material as THREE.Material).dispose();
      this.views.delete(p);
    }
  }

  clear(): void {
    for (const v of this.views.values()) this.group.remove(v.root);
    this.views.clear();
  }
}

export const PICKUP_NAMES: Record<PickupKind, string> = {
  health: 'CAN DOLDU!',
  damage: '2X HASAR!',
  speed: 'SÜPER HIZ!',
  airdrop: 'HAVA İKMALİ!',
};
export const PICKUP_COLORS = COLORS;
