import type { AABB } from './collision';

export interface Building {
  x0: number; x1: number; z0: number; z1: number; h: number;
  color: number;
  style: number; // facade variant
}

export type PropKind = 'car' | 'container' | 'barrier' | 'sandbag' | 'crate' | 'barrel' | 'tree' | 'lamp' | 'wall' | 'fountain' | 'statue';

export interface Prop {
  kind: PropKind;
  x: number; z: number;
  rot: 0 | 1; // 0 = long side along X, 1 = along Z
  color: number;
}

export interface V2 { x: number; z: number; }

export interface MapData {
  minX: number; maxX: number; minZ: number; maxZ: number;
  buildings: Building[];
  props: Prop[];
  spawns: { blue: V2[]; red: V2[] };
  pois: V2[];
  roads: { x0: number; x1: number; z0: number; z1: number }[];
  plaza: { x0: number; x1: number; z0: number; z1: number };
}

/** Footprint (length along X when rot 0, width along Z) and height. */
export const PROP_SIZE: Record<PropKind, [number, number, number]> = {
  car: [4.4, 2.0, 1.5],
  container: [6.1, 2.45, 2.6],
  barrier: [3.0, 0.6, 1.1],
  sandbag: [3.0, 0.9, 1.1],
  crate: [1.4, 1.4, 1.4],
  barrel: [0.75, 0.75, 1.05],
  tree: [0.5, 0.5, 3.0],
  lamp: [0.3, 0.3, 5.0],
  wall: [4.0, 0.5, 1.15],
  fountain: [5.5, 5.5, 0.8],
  statue: [1.3, 1.3, 4.6],
};

export function propBox(p: Prop): AABB {
  const [l, w, h] = PROP_SIZE[p.kind];
  const hx = (p.rot === 0 ? l : w) / 2, hz = (p.rot === 0 ? w : l) / 2;
  return { minX: p.x - hx, maxX: p.x + hx, minY: 0, maxY: h, minZ: p.z - hz, maxZ: p.z + hz };
}

export function buildingBox(b: Building): AABB {
  return { minX: b.x0, maxX: b.x1, minY: 0, maxY: b.h, minZ: b.z0, maxZ: b.z1 };
}

const B = (x0: number, x1: number, z0: number, z1: number, h: number, color: number, style: number): Building =>
  ({ x0, x1, z0, z1, h, color, style });
const P = (kind: PropKind, x: number, z: number, rot: 0 | 1 = 0, color = 0xffffff): Prop => ({ kind, x, z, rot, color });

/**
 * The map is point-symmetric around the origin: every object in HALF is
 * mirrored to (-x, -z). Blue spawns in the west, red in the east, so both
 * teams get an identical layout.
 */
const HALF_BUILDINGS: Building[] = [
  B(-58, -41, 30, 47, 22, 0xd9cbb3, 0),
  B(-58, -46, 9, 21, 10, 0xb86b4b, 1),
  B(-43, -37, 9, 17, 6, 0x7fa6b8, 2),
  B(-25, -8, 30, 47, 14, 0xe0dccf, 1),
  B(-25, -14, 14, 24, 8, 0x9c8f7a, 0),
  B(-10, -5, 16, 23, 4.5, 0xe8b04a, 2),
  B(8, 24, 15, 27, 12, 0x8a9bb0, 0),
  B(8, 24, 33, 47, 26, 0xc4c9cf, 3),
  B(38, 57, 31, 47, 16, 0xa65d57, 1),
  B(40, 53, 10, 21, 7, 0xd1c29a, 2),
  B(60, 68, 30, 46, 9, 0x6f7f6a, 0),
];

const CAR_COLORS = [0xc0392b, 0x2e86de, 0xf1c40f, 0xecf0f1, 0x27ae60, 0x34495e];
const CONTAINER_COLORS = [0x2f6db5, 0xb5452f, 0x3f8f4a, 0xd08a2c];

const HALF_PROPS: Prop[] = [
  // avenue
  P('car', -46, 3, 0, CAR_COLORS[0]),
  P('car', -18, 4, 0, CAR_COLORS[1]),
  P('car', 22, 3.5, 0, CAR_COLORS[2]),
  P('car', 48, 2.6, 0, CAR_COLORS[3]),
  P('barrier', -38, 1.5, 0),
  P('barrier', 37, 4.2, 0),
  P('barrier', -8, 4.6, 0),
  // alleys / cross streets
  P('container', -50, 25.5, 0, CONTAINER_COLORS[0]),
  P('container', -31, 20, 1, CONTAINER_COLORS[1]),
  P('container', 17, 30, 0, CONTAINER_COLORS[2]),
  P('container', 45, 26, 0, CONTAINER_COLORS[3]),
  P('container', 31, 42, 1, CONTAINER_COLORS[0]),
  P('crate', -20, 9),
  P('crate', -18.5, 9),
  P('crate', 6, 9.6),
  P('crate', 29.5, 37),
  P('crate', -29.5, 44),
  P('crate', -2.5, 36),
  P('barrel', -36, 24),
  P('barrel', -36.9, 24.8),
  P('barrel', -26.5, 12),
  P('barrel', 25.8, 12.5),
  P('barrel', 36, 8),
  P('barrel', 2.6, 28),
  // plaza
  P('wall', -8, 9, 0),
  P('wall', 9, 8, 1),
  P('tree', -11, 11),
  P('tree', 11, 11),
  // sidewalks
  P('tree', -52, 7.4),
  P('tree', -23, 7.4),
  P('tree', 15, 7.4),
  P('tree', 49, 7.4),
  P('tree', -4.8, 42),
  P('lamp', -40, 6.6),
  P('lamp', 20, 6.6),
  P('lamp', 44, 6.6),
  P('lamp', -26.6, 28),
  // bases
  P('sandbag', -59.5, 6, 1),
  P('sandbag', -60, 20, 0),
  P('sandbag', -54, 0, 1),
  P('sandbag', 58, 11, 1),
  P('crate', -62, 25),
  P('crate', -62, 26.5),
  P('barrel', 63, 24),
];

const CENTER_PROPS: Prop[] = [P('fountain', 0, 0), P('statue', 0, 0)];

function mirrorB(b: Building): Building {
  return { ...b, x0: -b.x1, x1: -b.x0, z0: -b.z1, z1: -b.z0 };
}
function mirrorP(p: Prop): Prop {
  return { ...p, x: -p.x, z: -p.z };
}

export function createMap(): MapData {
  const buildings = [...HALF_BUILDINGS, ...HALF_BUILDINGS.map(mirrorB)];
  const props = [...HALF_PROPS, ...HALF_PROPS.map(mirrorP), ...CENTER_PROPS];
  const blue: V2[] = [];
  for (const x of [-66, -63]) for (const z of [-16, -8, 0, 8, 16]) blue.push({ x, z });
  const red = blue.map((p) => ({ x: -p.x, z: -p.z }));
  const halfPois: V2[] = [
    { x: -31, z: 30 }, { x: 0, z: 30 }, { x: -45, z: 0 }, { x: -18, z: 11 },
    { x: -42, z: 25 }, { x: 31, z: 30 }, { x: 0, z: 42 }, { x: 52, z: 26 }, { x: -12, z: 0 },
  ];
  const pois = [{ x: 0, z: 9 }, ...halfPois, ...halfPois.map((p) => ({ x: -p.x, z: -p.z }))];
  return {
    minX: -70, maxX: 70, minZ: -50, maxZ: 50,
    buildings,
    props,
    spawns: { blue, red },
    pois,
    roads: [
      { x0: -70, x1: 70, z0: -6, z1: 6 },
      { x0: -35, x1: -27, z0: -50, z1: 50 },
      { x0: 27, x1: 35, z0: -50, z1: 50 },
      { x0: -4, x1: 4, z0: -50, z1: 50 },
    ],
    plaza: { x0: -12, x1: 12, z0: -12, z1: 12 },
  };
}

export function mapColliders(m: MapData): AABB[] {
  return [...m.buildings.map(buildingBox), ...m.props.map(propBox)];
}
