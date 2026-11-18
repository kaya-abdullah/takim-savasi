import * as THREE from 'three';
import { ALL_WEAPONS } from '../data/weapons';
import { makeWeaponMesh } from './weaponModel';
import { VehicleView } from './vehicleModel';

/** Renders a side view of every weapon into PNG data URLs for the shop. */
export function renderWeaponIcons(renderer: THREE.WebGLRenderer, envMap: THREE.Texture | null): Record<string, string> {
  const W = 320, H = 160;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const scene = new THREE.Scene();
  scene.environment = envMap;
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x445566, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(2, 3, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 2.0);
  rim.position.set(-2, 1, -3);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(22, W / H, 0.05, 20);
  const out: Record<string, string> = {};
  const pixels = new Uint8Array(W * H * 4);
  const cnv = document.createElement('canvas');
  cnv.width = W;
  cnv.height = H;
  const ctx = cnv.getContext('2d')!;
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  const prevColor = renderer.getClearColor(new THREE.Color());
  renderer.setClearColor(0x000000, 0);
  const items: { id: string; obj: THREE.Object3D; done?: () => void }[] = ALL_WEAPONS.map((w) => {
    const g = makeWeaponMesh(w);
    // side view: gun points right
    g.rotation.y = Math.PI / 2;
    return { id: w.id, obj: g };
  });
  // vehicles: three-quarter view
  for (const kind of ['tank', 'jet'] as const) {
    const v = new VehicleView(kind, 'blue', true);
    const g = new THREE.Group();
    g.add(v.root);
    v.root.rotation.y = kind === 'tank' ? 2.3 : 2.0;
    v.root.rotation.x = 0.12;
    items.push({ id: 'veh-' + kind, obj: g, done: () => v.dispose() });
  }
  for (const it of items) {
    const g = it.obj;
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    g.position.sub(c);
    scene.add(g);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y * 2) * 1.15;
    const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / cam.aspect + 0.2;
    cam.position.set(0.15 * dist, 0.25 * dist, dist);
    cam.lookAt(0, 0, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
    const img = ctx.createImageData(W, H);
    // flip vertically (GL origin is bottom-left)
    for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.clearRect(0, 0, W, H);
    ctx.putImageData(img, 0, 0);
    out[it.id] = cnv.toDataURL('image/png');
    scene.remove(g);
    it.done?.();
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevClear);
  rt.dispose();
  return out;
}
