import * as THREE from 'three';
import { GeomBuilder, rotY } from '../render/geomBuilder';
import {
  FACADE_STYLES, FACADE_TILE_H, FACADE_TILE_W, makeConcrete, makeCorrugated, makeCrate, makeFacades, makeGround, rng,
} from '../render/textures';
import type { Building, MapData, Prop } from './map';
import { rbox } from '../render/vehicleModel';
import type { PieceMat, Structures } from './structures';
import type { BakeFn } from '../render/geomBuilder';
import { bakeLit, brickTex, concreteTex as concreteSet, fabricTex, graniteTex, metalTex, plasterTex, subwayTex, tileTex, woodTex, type TexSet } from '../render/materials';

const tmpM = new THREE.Matrix4();
// shared parked-car parts (merged into the static batches)
const carBody = rbox(1.96, 0.6, 4.4, 0.16);
const carHood = rbox(1.8, 0.16, 1.5, 0.06);
const carCab = rbox(1.66, 0.52, 2.0, 0.14);
const carRoof = rbox(1.5, 0.07, 1.55, 0.03);
const carTyre = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 20).rotateX(Math.PI / 2);
const carRim = new THREE.CylinderGeometry(0.24, 0.24, 0.32, 12).rotateX(Math.PI / 2);

function shade(hex: number, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

interface Builders {
  facade: GeomBuilder[];
  bgFacade: GeomBuilder[];
  concrete: GeomBuilder;
  painted: GeomBuilder;
  glossy: GeomBuilder;
  metal: GeomBuilder;
  container: GeomBuilder;
  crate: GeomBuilder;
  foliage: GeomBuilder;
  glow: GeomBuilder;
  water: GeomBuilder;
}

export function buildWorld(m: MapData): THREE.Group {
  const root = new THREE.Group();
  root.name = 'world';
  const B: Builders = {
    facade: Array.from({ length: FACADE_STYLES }, () => new GeomBuilder()),
    bgFacade: Array.from({ length: FACADE_STYLES }, () => new GeomBuilder()),
    concrete: new GeomBuilder(),
    painted: new GeomBuilder(),
    glossy: new GeomBuilder(),
    metal: new GeomBuilder(),
    container: new GeomBuilder(),
    crate: new GeomBuilder(),
    foliage: new GeomBuilder(),
    glow: new GeomBuilder(),
    water: new GeomBuilder(),
  };
  const r = rng(77);

  for (const b of m.buildings) if (!b.enter) addBuilding(B, b, r, true);
  root.add(buildStructureMeshes(m));
  for (const p of m.props) addProp(B, p, r);
  addPerimeter(B, m);
  addStreetFurniture(B, m);
  addBackground(B, m, r);

  // ---- materials
  const facades = makeFacades();
  const concreteTex = makeConcrete(7, '#a19d95');
  const facadeMats = facades.map(
    (f) => new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(0xffc488), emissiveIntensity: 0.45,
      roughnessMap: f.rough, roughness: 1, metalness: 0.05, vertexColors: true, envMapIntensity: 0.9,
    }),
  );
  const mats = {
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.92, vertexColors: true }),
    painted: new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.0, vertexColors: true }),
    glossy: new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.35, vertexColors: true, envMapIntensity: 1.3 }),
    metal: new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.85, vertexColors: true }),
    container: new THREE.MeshStandardMaterial({ map: makeCorrugated(), roughness: 0.6, metalness: 0.25, vertexColors: true }),
    crate: new THREE.MeshStandardMaterial({ map: makeCrate(), roughness: 0.85, vertexColors: true }),
    foliage: new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 2.2), vertexColors: false, toneMapped: false }),
    water: new THREE.MeshStandardMaterial({ color: 0x2b6f8f, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.6 }),
  };

  const addMesh = (gb: GeomBuilder, mat: THREE.Material, cast: boolean, name: string) => {
    if (gb.vertexCount === 0) return;
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  };
  B.facade.forEach((gb, i) => addMesh(gb, facadeMats[i], true, 'facade' + i));
  B.bgFacade.forEach((gb, i) => {
    if (gb.vertexCount === 0) return;
    const mesh = new THREE.Mesh(gb.build(), facadeMats[i]);
    mesh.name = 'bg' + i;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  });
  addMesh(B.concrete, mats.concrete, true, 'concrete');
  addMesh(B.painted, mats.painted, true, 'painted');
  addMesh(B.glossy, mats.glossy, true, 'glossy');
  addMesh(B.metal, mats.metal, true, 'metal');
  addMesh(B.container, mats.container, true, 'container');
  addMesh(B.crate, mats.crate, true, 'crate');
  addMesh(B.foliage, mats.foliage, true, 'foliage');
  addMesh(B.glow, mats.glow, false, 'glow');
  addMesh(B.water, mats.water, false, 'water');


  // ---- ground (with openings over the metro stairs)
  const gw = m.maxX - m.minX, gd = m.maxZ - m.minZ;
  const groundGeo = rectWithHoles(m.minX, m.maxX, m.minZ, m.maxZ, m.structures.pits);
  // match PlaneGeometry's UV layout so the painted road texture lines up
  const P = groundGeo.getAttribute('position'), U = groundGeo.getAttribute('uv');
  for (let i = 0; i < P.count; i++) U.setXY(i, (P.getX(i) - m.minX) / gw, (m.maxZ - P.getZ(i)) / gd);
  // asphalt/paving relief: the normal map tiles every 3 m on its own UV transform
  const relief = concreteSet(23);
  for (const t of [relief.normalMap, relief.roughnessMap]) t.repeat.set(gw / 3, gd / 3);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({
    map: makeGround(m), roughness: 1, normalMap: relief.normalMap, roughnessMap: relief.roughnessMap, normalScale: new THREE.Vector2(0.7, 0.7),
  }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);
  const outerTex = makeConcrete(13, '#55534f');
  outerTex.repeat.set(1 / 7.5, 1 / 7.5);
  // a ring around the city, so it never covers the stairwells
  const outerGeo = rectWithHoles(-450, 450, -450, 450, [{ x0: m.minX, x1: m.maxX, z0: m.minZ, z1: m.maxZ }]);
  const outer = new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({ map: outerTex, roughness: 1 }));
  outer.position.y = -0.02;
  outer.name = 'outerGround';
  root.add(outer);
  return root;
}

/** Horizontal y = 0 rectangle with rectangular holes (ShapeGeometry laid flat). */
function rectWithHoles(x0: number, x1: number, z0: number, z1: number, holes: { x0: number; x1: number; z0: number; z1: number }[]): THREE.BufferGeometry {
  // shape space (x, y) maps to world (x, -y) after the rotation below
  const sh = new THREE.Shape([new THREE.Vector2(x0, -z1), new THREE.Vector2(x1, -z1), new THREE.Vector2(x1, -z0), new THREE.Vector2(x0, -z0)]);
  for (const h of holes)
    sh.holes.push(new THREE.Path([new THREE.Vector2(h.x0, -h.z1), new THREE.Vector2(h.x0, -h.z0), new THREE.Vector2(h.x1, -h.z0), new THREE.Vector2(h.x1, -h.z1)]));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  return g;
}

function makeMetroSign(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1f5fbf';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#ffffff';
  x.lineWidth = 8;
  x.strokeRect(10, 10, 108, 108);
  x.fillStyle = '#ffffff';
  x.font = 'bold 84px Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('M', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Baked light per vertex from the structures' rooms (AO, less sky) and ceiling lamps. */
export function structureBake(st: Structures): BakeFn {
  const rooms = st.rooms, lamps = st.lamps;
  const sm = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
  return (x, y, z, nx, ny, nz) => {
    let ao = 1, lamp = 0;
    for (const r of rooms) {
      if (x < r.x0 - 0.35 || x > r.x1 + 0.35 || z < r.z0 - 0.35 || z > r.z1 + 0.35 || y < r.y0 - 0.06 || y > r.y1 + 0.3) continue;
      const dWall = Math.max(0, Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z));
      // distance to the nearest surface the vertex does not lie on: corners get darker
      const d = Math.abs(ny) > 0.5 ? dWall : Math.max(0, Math.min(y - r.y0, r.y1 - y, Math.abs(nx) > 0.5 ? Math.min(z - r.z0, r.z1 - z) : Math.min(x - r.x0, r.x1 - x)));
      // indoors sees much less sky
      ao = (0.45 + 0.55 * sm(d / 1.1)) * 0.55;
      break;
    }
    for (const l of lamps) {
      if (y < l.y0 || y > l.y1) continue;
      const dx = l.x - x, dy = l.y - y, dz = l.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > l.reach) continue;
      const ndl = Math.max(0, (dx * nx + dy * ny + dz * nz) / (d || 1));
      const fall = (1 - d / l.reach) ** 2;
      lamp += l.power * fall * (0.3 + 0.7 * ndl) * 1.5;
    }
    return [ao, Math.min(lamp, 2.2)];
  };
}

/** Metres per texture repeat for each structure material. */
const UV: Partial<Record<PieceMat, number>> = {
  brick: 1.6, plaster: 3, wood: 1.4, tile: 2.4, subway: 1.2, granite: 2.4, concrete: 3, fabric: 1.0, metal: 2, darkwood: 1.0,
};
/** Large surfaces get subdivided so the baked lamp light falls off smoothly. */
const SUBDIV: Partial<Record<PieceMat, number>> = { plaster: 1.0, wood: 1.0, tile: 1.0, subway: 1.0, granite: 1.0, concrete: 1.2 };

/** Walk-in buildings and the metro: textured, normal-mapped, with baked lamp light and AO. */
function buildStructureMeshes(m: MapData): THREE.Group {
  const g = new THREE.Group();
  g.name = 'structures';
  const bake = structureBake(m.structures);
  const builders = new Map<PieceMat, GeomBuilder>();
  for (const p of m.structures.pieces) {
    if (p.mat === 'hidden') continue;
    let gb = builders.get(p.mat);
    if (!gb) builders.set(p.mat, (gb = new GeomBuilder(false, bake)));
    const b = p.box;
    const uvs = UV[p.mat];
    gb.box((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, p.color, undefined,
      uvs ? { uv: 'world', uvScale: uvs, subdiv: SUBDIV[p.mat] } : { uv: 'unit' });
  }
  const pbr = (t: TexSet, rough: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    bakeLit(new THREE.MeshStandardMaterial({ ...t, roughness: rough, vertexColors: true, normalScale: new THREE.Vector2(1, 1), ...extra }));
  const wood = woodTex();
  const mats: Record<PieceMat, THREE.Material> = {
    brick: pbr(brickTex(), 1),
    plaster: pbr(plasterTex(), 1),
    wood: pbr(wood, 1),
    darkwood: pbr(wood, 1),
    tile: pbr(tileTex(), 1, { envMapIntensity: 1.2 }),
    subway: pbr(subwayTex(), 1, { envMapIntensity: 1.3 }),
    granite: pbr(graniteTex(), 1, { envMapIntensity: 1.1 }),
    concrete: pbr(concreteSet(), 1),
    fabric: pbr(fabricTex(), 1),
    metal: pbr(metalTex(), 1, { metalness: 0.75 }),
    paint: bakeLit(new THREE.MeshStandardMaterial({ roughness: 0.5, vertexColors: true })),
    crate: bakeLit(new THREE.MeshStandardMaterial({ map: makeCrate(), roughness: 0.85, vertexColors: true })),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb6c6, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, envMapIntensity: 1.6, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.4), toneMapped: false }),
    sign: new THREE.MeshBasicMaterial({ map: makeMetroSign(), toneMapped: false }),
    screen: new THREE.MeshBasicMaterial({ map: makeScreen(), toneMapped: false }),
    poster: bakeLit(new THREE.MeshStandardMaterial({ map: makePoster(), roughness: 0.6, vertexColors: true })),
    hidden: new THREE.MeshBasicMaterial(),
  };
  for (const [mat, gb] of builders) {
    if (gb.vertexCount === 0) continue;
    const mesh = new THREE.Mesh(gb.build(), mats[mat]);
    mesh.name = 'st-' + mat;
    const lightless = mat === 'glow' || mat === 'sign' || mat === 'screen' || mat === 'glass';
    mesh.castShadow = !lightless;
    mesh.receiveShadow = !lightless;
    if (mat === 'glass') mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    g.add(mesh);
  }
  return g;
}

/** Abstract print/poster artwork (tinted per piece by its vertex colour). */
function makePoster(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 256, 256);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(1, '#9a9a9a');
  x.fillStyle = gr;
  x.fillRect(0, 0, 256, 256);
  const r = rng(31);
  for (let i = 0; i < 9; i++) {
    x.fillStyle = `hsla(${r() * 360},70%,${30 + r() * 40}%,0.8)`;
    x.beginPath();
    x.arc(r() * 256, r() * 256, 20 + r() * 60, 0, Math.PI * 2);
    x.fill();
  }
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.fillRect(20, 196, 216, 36);
  x.fillStyle = '#222';
  x.font = 'bold 26px Arial, sans-serif';
  x.fillText('ŞEHİR · 2026', 34, 224);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glowing monitor / vending machine screen. */
function makeScreen(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 0, 96);
  gr.addColorStop(0, '#2a6fd6');
  gr.addColorStop(1, '#0d2f66');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 96);
  x.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 6; i++) x.fillRect(12, 14 + i * 12, 40 + ((i * 37) % 60), 5);
  x.fillStyle = '#f2c14e';
  x.fillRect(84, 14, 30, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addBuilding(B: Builders, b: Building, r: () => number, detailed: boolean): void {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const style = b.style % FACADE_STYLES;
  const fb = detailed ? B.facade[style] : B.bgFacade[style];
  fb.box(cx, b.h / 2, cz, w, b.h, d, b.color, undefined, { uv: 'world', uvScale: FACADE_TILE_W, uvScaleY: FACADE_TILE_H, skipTop: true, skipBottom: true });
  // roof
  B.concrete.box(cx, b.h, cz, w, 0.02, d, 0x8e8b86, undefined, { onlyTop: true, uv: 'world', uvScale: 6 });
  if (!detailed) return;
  // plinth
  B.concrete.box(cx, 0.35, cz, w + 0.16, 0.7, d + 0.16, shade(b.color, 0.55), undefined, { uv: 'world', uvScale: 4, skipBottom: true });
  // parapet
  const pc = shade(b.color, 0.8), t = 0.3, ph = 0.7;
  B.concrete.box(cx, b.h + ph / 2, b.z0 + t / 2, w, ph, t, pc, undefined, { uv: 'world', uvScale: 4 });
  B.concrete.box(cx, b.h + ph / 2, b.z1 - t / 2, w, ph, t, pc, undefined, { uv: 'world', uvScale: 4 });
  B.concrete.box(b.x0 + t / 2, b.h + ph / 2, cz, t, ph, d - 2 * t, pc, undefined, { uv: 'world', uvScale: 4 });
  B.concrete.box(b.x1 - t / 2, b.h + ph / 2, cz, t, ph, d - 2 * t, pc, undefined, { uv: 'world', uvScale: 4 });
  // cornice band between floors 1 and 2
  if (b.h > 6) B.concrete.box(cx, 3.55, cz, w + 0.3, 0.25, d + 0.3, shade(b.color, 0.7), undefined, { uv: 'world', uvScale: 4 });
  // awnings on shop-style buildings
  if (style === 2) {
    const aw = [0xd94a3a, 0x2f7fd9, 0x37a35a, 0xe8a23a][Math.floor(r() * 4)];
    B.painted.box(cx, 3.1, b.z0 - 0.6, w * 0.85, 0.12, 1.2, aw);
    B.painted.box(cx, 3.1, b.z1 + 0.6, w * 0.85, 0.12, 1.2, aw);
  }
  // rooftop clutter
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const ax = b.x0 + 1.5 + r() * (w - 3), az = b.z0 + 1.5 + r() * (d - 3);
    B.metal.box(ax, b.h + 0.5, az, 1.6, 1.0, 1.1, 0xb9bcc0);
    B.painted.box(ax, b.h + 1.02, az, 1.2, 0.04, 0.7, 0x333538);
  }
  if (b.h >= 14 && r() < 0.8) {
    const tg = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 12);
    tmpM.makeTranslation(b.x0 + w * 0.7, b.h + 1.8, b.z0 + d * 0.3);
    B.metal.add(tg, 0x6f5a48, tmpM);
    const legs = new THREE.CylinderGeometry(0.08, 0.08, 1, 6);
    for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      tmpM.makeTranslation(b.x0 + w * 0.7 + lx, b.h + 0.5, b.z0 + d * 0.3 + lz);
      B.metal.add(legs, 0x444444, tmpM);
    }
  }
  if (b.h >= 20) {
    const ant = new THREE.CylinderGeometry(0.05, 0.08, 6, 6);
    tmpM.makeTranslation(cx, b.h + 3, cz);
    B.metal.add(ant, 0xaaaaaa, tmpM);
    B.glow.add(new THREE.SphereGeometry(0.15, 8, 6), 0xff3030, new THREE.Matrix4().makeTranslation(cx, b.h + 6.05, cz));
  }
  // entrance door on each long side
  for (const side of [-1, 1]) {
    const dz = side < 0 ? b.z0 - 0.03 : b.z1 + 0.03;
    B.glossy.box(cx, 1.25, dz, 1.8, 2.5, 0.08, 0x1e2a33);
    B.concrete.box(cx, 2.65, dz + side * 0.05, 2.3, 0.3, 0.18, shade(b.color, 0.6));
  }
}

function addProp(B: Builders, p: Prop, r: () => number): void {
  const m = rotY(p.rot === 1 ? Math.PI / 2 : 0, p.x, p.z);
  switch (p.kind) {
    case 'car': {
      // rounded body, glasshouse, bumpers, chrome-rimmed wheels (length along local x)
      const c = p.color;
      const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      const at = (x: number, y: number, z: number) => tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(x, y, z)).multiply(rot);
      B.glossy.add(carBody, c, at(0, 0.62, 0));
      B.glossy.add(carHood, c, at(1.25, 0.94, 0));
      B.glossy.add(carCab, 0x18222b, at(-0.3, 1.15, 0));
      B.glossy.add(carRoof, c, at(-0.4, 1.43, 0));
      B.painted.box(2.22, 0.42, 0, 0.18, 0.22, 1.9, 0x18191b, m);
      B.painted.box(-2.22, 0.42, 0, 0.18, 0.22, 1.9, 0x18191b, m);
      B.painted.box(0, 0.33, 0, 3.0, 0.1, 2.0, 0x18191b, m);
      B.metal.box(2.235, 0.66, 0, 0.04, 0.14, 0.7, 0xd8dde3, m);
      for (const s of [-0.95, 0.95]) B.glossy.box(0.55, 1.08, s, 0.12, 0.1, 0.16, c, m);
      for (const [wx, wz] of [[1.35, 0.86], [1.35, -0.86], [-1.38, 0.86], [-1.38, -0.86]]) {
        tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(wx, 0.38, wz));
        B.painted.add(carTyre, 0x141416, tmpM);
        B.metal.add(carRim, 0xd8dde3, tmpM);
      }
      B.glow.box(2.21, 0.78, 0.66, 0.05, 0.12, 0.42, 0xffffff, m);
      B.glow.box(2.21, 0.78, -0.66, 0.05, 0.12, 0.42, 0xffffff, m);
      B.painted.box(-2.21, 0.8, 0.66, 0.05, 0.1, 0.42, 0xb01010, m);
      B.painted.box(-2.21, 0.8, -0.66, 0.05, 0.1, 0.42, 0xb01010, m);
      break;
    }
    case 'container': {
      B.container.box(0, 1.3, 0, 6.1, 2.6, 2.45, p.color, m, { uv: 'world', uvScale: 6.1, uvScaleY: 2.6 });
      // corner posts
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.metal.box(sx * 3.0, 1.3, sz * 1.18, 0.14, 2.62, 0.14, shade(p.color, 0.6), m);
      break;
    }
    case 'barrier': {
      B.concrete.box(0, 0.18, 0, 3, 0.36, 0.6, 0xc9c5bc, m, { uv: 'world', uvScale: 2 });
      B.concrete.box(0, 0.7, 0, 3, 0.8, 0.3, 0xc9c5bc, m, { uv: 'world', uvScale: 2 });
      for (let i = 0; i < 3; i++) B.painted.box(-1 + i, 0.8, 0, 0.45, 0.22, 0.32, i % 2 ? 0xffffff : 0xd33b2c, m);
      break;
    }
    case 'sandbag': {
      const bag = new THREE.SphereGeometry(0.5, 8, 6);
      bag.scale(0.62, 0.32, 0.5);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 0.3 : 0;
        for (let i = 0; i < 5; i++) {
          const bx = -1.2 + i * 0.6 + off;
          if (bx > 1.25) continue;
          for (const bz of [-0.24, 0.24]) {
            tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(bx, 0.16 + row * 0.27, bz));
            B.painted.add(bag, row % 2 ? 0xa48c62 : 0xb39b70, tmpM);
          }
        }
      }
      break;
    }
    case 'crate':
      B.crate.box(0, 0.7, 0, 1.4, 1.4, 1.4, 0xffffff, m, { uv: 'unit' });
      break;
    case 'barrel': {
      const col = [0x2f6db5, 0xc0392b, 0xe0b52b][Math.floor(r() * 3)];
      const g = new THREE.CylinderGeometry(0.37, 0.37, 1.05, 14);
      tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 0.525, 0));
      B.glossy.add(g, col, tmpM);
      const ring = new THREE.CylinderGeometry(0.385, 0.385, 0.05, 14);
      for (const y of [0.3, 0.75]) {
        tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, y, 0));
        B.metal.add(ring, 0x555555, tmpM);
      }
      break;
    }
    case 'tree': {
      const trunk = new THREE.CylinderGeometry(0.14, 0.24, 3.2, 7);
      tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 1.6, 0));
      B.painted.add(trunk, 0x5a3d26, tmpM);
      const greens = [0x3f7d3a, 0x4f8f3f, 0x2f6a35, 0x5c9a46];
      for (let i = 0; i < 4; i++) {
        const ico = new THREE.IcosahedronGeometry(1.1 + r() * 0.6, 1);
        tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation((r() - 0.5) * 1.4, 3.6 + r() * 1.4, (r() - 0.5) * 1.4));
        B.foliage.add(ico, greens[i % 4], tmpM);
      }
      // planter
      B.concrete.box(0, 0.2, 0, 1.4, 0.4, 1.4, 0x8a857c, m);
      break;
    }
    case 'lamp': {
      const pole = new THREE.CylinderGeometry(0.07, 0.11, 5, 8);
      tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 2.5, 0));
      B.metal.add(pole, 0x2d3238, tmpM);
      B.metal.box(0, 4.95, -0.6, 0.1, 0.1, 1.3, 0x2d3238, m);
      B.metal.box(0, 4.85, -1.2, 0.35, 0.18, 0.6, 0x2d3238, m);
      B.glow.box(0, 4.74, -1.2, 0.28, 0.04, 0.5, 0xffffff, m);
      break;
    }
    case 'wall': {
      B.concrete.box(0, 0.55, 0, 4, 1.1, 0.5, 0xbdb6a8, m, { uv: 'world', uvScale: 2 });
      B.concrete.box(0, 1.13, 0, 4.1, 0.08, 0.6, 0x948c7e, m);
      break;
    }
    case 'fountain': {
      const basin = new THREE.CylinderGeometry(2.75, 2.9, 0.8, 8);
      tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 0.4, 0));
      B.concrete.add(basin, 0xd8d0c0, tmpM);
      const water = new THREE.CylinderGeometry(2.45, 2.45, 0.05, 24);
      tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 0.78, 0));
      B.water.add(water, 0xffffff, tmpM);
      break;
    }
    case 'statue': {
      B.concrete.box(0, 1.0, 0, 1.3, 1.6, 1.3, 0xe2dccd, m, { uv: 'world', uvScale: 2 });
      B.concrete.box(0, 1.85, 0, 1.5, 0.12, 1.5, 0xc9c1b0, m);
      const col = new THREE.CylinderGeometry(0.25, 0.4, 2.0, 10);
      tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 2.9, 0));
      B.metal.add(col, 0xb07b3a, tmpM);
      const ball = new THREE.IcosahedronGeometry(0.45, 2);
      tmpM.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 4.25, 0));
      B.metal.add(ball, 0xd9a24a, tmpM);
      break;
    }
  }
}

/**
 * Visual-only street furniture: hydrants, bins and benches beside the sidewalk
 * trees, bollards round the plaza and traffic lights at the crossings.
 */
function addStreetFurniture(B: Builders, m: MapData): void {
  const cyl = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg);
  const put = (gb: GeomBuilder, g: THREE.BufferGeometry, color: number, x: number, y: number, z: number) =>
    gb.add(g, color, tmpM.makeTranslation(x, y, z));
  const hydrant = cyl(0.13, 0.6), cap = new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), nub = cyl(0.05, 0.36, 8).rotateZ(Math.PI / 2);
  const bin = cyl(0.26, 0.85, 14), lid = cyl(0.29, 0.06, 14), bollard = cyl(0.09, 0.85, 10), pole = cyl(0.07, 4.2, 8);
  const blocked = (x: number, z: number, r: number) => m.props.some((p) => p.kind !== 'tree' && Math.abs(p.x - x) < 3 + r && Math.abs(p.z - z) < 1.6 + r)
    || m.structures.pits.some((p) => x > p.x0 - 1 && x < p.x1 + 1 && z > p.z0 - 1 && z < p.z1 + 1);
  for (const t of m.props.filter((p) => p.kind === 'tree' && Math.abs(Math.abs(p.z) - 7.4) < 0.1)) {
    const s = Math.sign(t.z);
    // hydrant 2.5 m along, bin and bench the other way
    if (!blocked(t.x + 2.5, t.z, 0)) {
      put(B.painted, hydrant, 0xc0281f, t.x + 2.5, 0.3, t.z);
      put(B.painted, cap, 0xc0281f, t.x + 2.5, 0.6, t.z);
      put(B.metal, nub, 0xb0b4ba, t.x + 2.5, 0.42, t.z);
    }
    if (!blocked(t.x - 2.2, t.z, 0)) {
      put(B.metal, bin, 0x2f5f3a, t.x - 2.2, 0.425, t.z + s * 0.4);
      put(B.metal, lid, 0x23282d, t.x - 2.2, 0.88, t.z + s * 0.4);
    }
    if (!blocked(t.x - 4.2, t.z, 0.5)) {
      const bx = t.x - 4.2, bz = t.z + s * 0.6;
      B.painted.box(bx, 0.45, bz, 1.7, 0.06, 0.45, 0x8a5a34);
      B.painted.box(bx, 0.75, bz + s * 0.22, 1.7, 0.4, 0.05, 0x8a5a34);
      for (const lx of [-0.7, 0.7]) B.metal.box(bx + lx, 0.22, bz, 0.06, 0.44, 0.45, 0x2a2c30);
    }
  }
  // bollards round the plaza
  const pl = m.plaza;
  for (let x = pl.x0 + 1; x <= pl.x1 - 1; x += 2.2) for (const z of [pl.z0 - 0.4, pl.z1 + 0.4]) {
    if (blocked(x, z, -1.5) || Math.abs(x) < 2.2) continue;
    put(B.painted, bollard, 0x2a2c30, x, 0.425, z);
    put(B.glow, cyl(0.092, 0.05, 10), 0xffffff, x, 0.7, z);
  }
  // traffic lights at the corners where the cross streets meet the avenue
  for (const cx of [-31, 0, 31]) for (const sz of [-1, 1]) {
    const x = cx + (cx === 0 ? 5 : 5) * sz, z = 6.9 * sz;
    if (blocked(x, z, -1.5)) continue;
    put(B.metal, pole, 0x2a2e33, x, 2.1, z);
    B.painted.box(x, 4.0, z, 0.32, 0.9, 0.28, 0x1b1d20);
    for (const [k, col] of [[0.28, 0x551010], [0, 0x553f10], [-0.28, 0xffffff]] as [number, number][]) {
      const lit = k < 0;
      (lit ? B.glow : B.painted).box(x, 4.0 + k, z - sz * 0.15, 0.18, 0.18, 0.02, lit ? 0xffffff : col);
    }
  }
}

function addPerimeter(B: Builders, m: MapData): void {
  const h = 3.2, t = 0.6;
  const w = m.maxX - m.minX, d = m.maxZ - m.minZ;
  const col = 0xa8a294;
  B.concrete.box(0, h / 2, m.minZ - t / 2, w + 2 * t, h, t, col, undefined, { uv: 'world', uvScale: 4 });
  B.concrete.box(0, h / 2, m.maxZ + t / 2, w + 2 * t, h, t, col, undefined, { uv: 'world', uvScale: 4 });
  B.concrete.box(m.minX - t / 2, h / 2, 0, t, h, d, col, undefined, { uv: 'world', uvScale: 4 });
  B.concrete.box(m.maxX + t / 2, h / 2, 0, t, h, d, col, undefined, { uv: 'world', uvScale: 4 });
  // pillars
  for (let x = m.minX; x <= m.maxX; x += 10) {
    B.concrete.box(x, h / 2 + 0.2, m.minZ - t / 2, 0.9, h + 0.4, 0.9, 0x8f897b);
    B.concrete.box(x, h / 2 + 0.2, m.maxZ + t / 2, 0.9, h + 0.4, 0.9, 0x8f897b);
  }
  for (let z = m.minZ; z <= m.maxZ; z += 10) {
    B.concrete.box(m.minX - t / 2, h / 2 + 0.2, z, 0.9, h + 0.4, 0.9, 0x8f897b);
    B.concrete.box(m.maxX + t / 2, h / 2 + 0.2, z, 0.9, h + 0.4, 0.9, 0x8f897b);
  }
}

function addBackground(B: Builders, m: MapData, r: () => number): void {
  const cols = [0x9aa3ad, 0xb7a58c, 0x8d7f73, 0xa9b4bf, 0xc2b8a3, 0x7a8590];
  // A ring of skyline blocks outside the playable area, hidden partly by fog.
  for (let i = 0; i < 70; i++) {
    let x = 0, z = 0;
    for (let tries = 0; tries < 20; tries++) {
      x = (r() * 2 - 1) * 170;
      z = (r() * 2 - 1) * 140;
      if (x < m.minX - 14 || x > m.maxX + 14 || z < m.minZ - 14 || z > m.maxZ + 14) break;
    }
    const w = 10 + r() * 16, d = 10 + r() * 16, h = 12 + r() * 45;
    addBuilding(B, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h, color: cols[i % cols.length], style: i % 4 }, r, false);
  }
}
