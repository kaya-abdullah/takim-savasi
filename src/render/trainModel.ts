import * as THREE from 'three';
import { TRAIN_H, TRAIN_HALF_W, TRAIN_LEN, Train } from '../game/metro';
import { TUNNEL_Y } from '../world/structures';

/**
 * The metro carriage: white body with a blue stripe, a window band, sliding
 * doors, seats, poles and a lit ceiling. Walls and roof fade out while the
 * local player rides (the camera sits behind them otherwise).
 */
export class TrainView {
  readonly root = new THREE.Group();
  private doors: { mesh: THREE.Mesh; base: number; dir: number }[] = [];
  private shell: THREE.MeshStandardMaterial[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private open = 1;
  private fade = 1;

  constructor() {
    const L = TRAIN_LEN, W = TRAIN_HALF_W, H = TRAIN_H;
    const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}, shell = false) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, ...opts });
      this.mats.push(m);
      if (shell) { m.transparent = true; this.shell.push(m); }
      return m;
    };
    const white = mat(0xe9edf2, {}, true), blue = mat(0x2f6fbf, {}, true), glass = mat(0x1d2a36, { roughness: 0.1, metalness: 0.6, opacity: 0.55 }, true);
    const roof = mat(0xb9bec6, {}, true), door = mat(0xc9ced6, { metalness: 0.4 }, true);
    const floor = mat(0x3a3d42, { roughness: 0.9 }), seat = mat(0x2f6fbf, { roughness: 0.7 }), pole = mat(0xd8dce2, { metalness: 0.8, roughness: 0.25 });
    const light = mat(0xffffff, { emissive: 0xfff4dd, emissiveIntensity: 1.6 });
    const head = mat(0xfff1c0, { emissive: 0xfff1c0, emissiveIntensity: 2.5 });
    const add = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      this.geos.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    const t = 0.08; // wall thickness
    add(floor, -L / 2, L / 2, 0, 0.06, -W, W);
    add(roof, -L / 2, L / 2, H - 0.12, H, -W, W);
    // side walls with door gaps: lower panel, stripe, window band, upper panel
    const doorsX = Train.DOORS, dh = Train.DOOR_HALF;
    const spans: [number, number][] = [];
    let cur = -L / 2;
    for (const d of doorsX) { spans.push([cur, d - dh]); cur = d + dh; }
    spans.push([cur, L / 2]);
    for (const side of [-1, 1]) {
      const z0 = side > 0 ? W - t : -W, z1 = side > 0 ? W : -W + t;
      for (const [a, b] of spans) {
        add(white, a, b, 0.06, 0.95, z0, z1);
        add(blue, a, b, 0.95, 1.12, z0 - side * 0.005, z1 + side * 0.005);
        add(glass, a, b, 1.12, 2.0, z0, z1);
        add(white, a, b, 2.0, H - 0.12, z0, z1);
      }
      for (const d of doorsX) {
        // two leaves per door; they slide apart along the carriage when open
        for (const dir of [-1, 1]) {
          const leaf = add(door, d + (dir < 0 ? -dh : 0), d + (dir < 0 ? 0 : dh), 0.06, 2.15, z0 + side * 0.03, z1 + side * 0.03);
          this.doors.push({ mesh: leaf, base: leaf.position.x, dir });
        }
        add(white, d - dh, d + dh, 2.15, H - 0.12, z0, z1);
      }
    }
    // ends: cab windows and headlights
    for (const end of [-1, 1]) {
      const x0 = end > 0 ? L / 2 - t : -L / 2, x1 = end > 0 ? L / 2 : -L / 2 + t;
      add(white, x0, x1, 0.06, 1.12, -W, W);
      add(glass, x0, x1, 1.12, 2.0, -W + 0.15, W - 0.15);
      add(white, x0, x1, 2.0, H - 0.12, -W, W);
      add(blue, x0 - end * 0.005, x1 + end * 0.005, 0.95, 1.12, -W, W);
      for (const z of [-0.8, 0.8]) add(head, x0 + end * 0.01, x1 + end * 0.01, 0.55, 0.72, z - 0.15, z + 0.15);
    }
    // inside: seats along the walls between the doors, poles, ceiling lights
    for (const side of [-1, 1]) for (const [a, b] of spans) {
      const zi = side * (W - 0.32);
      add(seat, a + 0.3, b - 0.3, 0.42, 0.52, zi - 0.22, zi + 0.22);
      add(seat, a + 0.3, b - 0.3, 0.52, 1.05, side * (W - 0.12), side * (W - 0.1));
    }
    for (const x of [-5.5, 0, 5.5]) add(pole, x - 0.03, x + 0.03, 0.06, H - 0.12, -0.03, 0.03);
    for (const x of [-4.5, 0, 4.5]) add(light, x - 1.8, x + 1.8, H - 0.16, H - 0.12, -0.12, 0.12);
    this.root.position.y = TUNNEL_Y;
  }

  /** Follows the train; `riding` fades the shell so the camera can see inside. */
  sync(t: Train, dt: number, riding: boolean): void {
    this.root.position.x = t.x;
    this.open += ((t.doorsOpen ? 1 : 0) - this.open) * Math.min(1, dt * 5);
    for (const d of this.doors) d.mesh.position.x = d.base + d.dir * this.open * (Train.DOOR_HALF - 0.05);
    const want = riding ? 0.22 : 1;
    if (Math.abs(this.fade - want) > 0.005) {
      this.fade += (want - this.fade) * Math.min(1, dt * 6);
      for (const m of this.shell) {
        const base = m.userData.base ?? (m.userData.base = m.opacity);
        m.opacity = base * this.fade;
        m.depthWrite = this.fade > 0.95;
      }
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
