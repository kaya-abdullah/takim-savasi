import * as THREE from 'three';
import type { MapData } from '../world/map';

/** Small deterministic PRNG so textures look the same every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, r: () => number, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, size * r() + 0.5, size * r() + 0.5);
  }
}

export interface FacadeSet {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}

/** Facade tile: 4 bays x 4 floors = 16 m x 14 m, one texture set per style. */
export const FACADE_TILE_W = 16;
export const FACADE_TILE_H = 14;
export const FACADE_STYLES = 4;
export function makeFacades(): FacadeSet[] {
  const W = 512, H = 448;
  const r = rng(42);
  const out: FacadeSet[] = [];
  for (let style = 0; style < FACADE_STYLES; style++) {
    const [c, ctx] = canvas(W, H);
    const [ce, cte] = canvas(W, H);
    const [cr, ctr] = canvas(W, H);
    cte.fillStyle = '#000';
    cte.fillRect(0, 0, W, H);
    ctx.fillStyle = style === 3 ? '#9fb0c0' : '#f2f0ea';
    ctx.fillRect(0, 0, W, H);
    ctr.fillStyle = 'rgb(0,235,0)';
    ctr.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 2500, 0.08, r, 3);
    const bayW = W / 4, flH = H / 4;
    for (let fl = 0; fl < 4; fl++) {
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(0, fl * flH + flH - 6, W, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, fl * flH + flH - 8, W, 2);
      for (let b = 0; b < 4; b++) {
        const x = b * bayW, y = fl * flH;
        const wins: [number, number, number, number][] = [];
        if (style === 0) wins.push([x + 22, y + 22, bayW - 44, flH - 50]);
        else if (style === 1) { wins.push([x + 16, y + 20, 36, flH - 46]); wins.push([x + bayW - 52, y + 20, 36, flH - 46]); }
        else if (style === 2) wins.push([x + 12, y + 30, bayW - 24, flH - 60]);
        else wins.push([x + 3, y + 3, bayW - 6, flH - 10]);
        for (const [wx, wy, ww, wh] of wins) {
          ctx.fillStyle = style === 3 ? '#2a3440' : '#5c5e63';
          ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
          const g = ctx.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
          g.addColorStop(0, '#7fa9cf');
          g.addColorStop(0.45, '#2f4a68');
          g.addColorStop(1, '#16222f');
          ctx.fillStyle = g;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.beginPath();
          ctx.moveTo(wx, wy + wh * 0.7);
          ctx.lineTo(wx + ww * 0.5, wy);
          ctx.lineTo(wx + ww * 0.65, wy);
          ctx.lineTo(wx, wy + wh * 0.95);
          ctx.fill();
          ctx.fillStyle = style === 3 ? '#2a3440' : '#6d6f75';
          ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
          if (style !== 2) ctx.fillRect(wx, wy + wh * 0.4, ww, 3);
          if (style !== 3) {
            ctx.fillStyle = '#d8d4cc';
            ctx.fillRect(wx - 8, wy + wh + 4, ww + 16, 6);
          }
          ctr.fillStyle = 'rgb(0,40,0)';
          ctr.fillRect(wx, wy, ww, wh);
          if (r() < 0.14) {
            const lg = cte.createLinearGradient(0, wy, 0, wy + wh);
            lg.addColorStop(0, 'rgb(255,190,110)');
            lg.addColorStop(1, 'rgb(170,110,50)');
            cte.fillStyle = lg;
            cte.fillRect(wx, wy, ww, wh);
            ctx.fillStyle = "rgba(255,200,120,0.35)";
            ctx.fillRect(wx, wy, ww, wh);
          }
        }
      }
    }
    out.push({ map: tex(c), emissive: tex(ce), rough: tex(cr, false) });
  }
  return out;
}

export function makeConcrete(seed = 7, base = '#8d8a84'): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 6000, 0.12, r, 2);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 * r()})`;
    ctx.beginPath();
    ctx.arc(r() * 256, r() * 256, 10 + r() * 40, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c);
}

export function makeCorrugated(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  const r = rng(3);
  for (let x = 0; x < 256; x++) {
    const v = 200 + Math.sin((x / 256) * Math.PI * 2 * 16) * 45;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, 128);
  }
  speckle(ctx, 256, 128, 1500, 0.15, r, 3);
  ctx.fillStyle = 'rgba(80,40,10,0.15)';
  for (let i = 0; i < 20; i++) ctx.fillRect(r() * 256, 110 + r() * 18, 6 + r() * 30, 4);
  return tex(c);
}

export function makeCrate(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const r = rng(9);
  ctx.fillStyle = '#b58650';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    ctx.fillStyle = `rgba(60,30,0,${0.1 + 0.15 * r()})`;
    ctx.fillRect(0, y, 128, 2);
  }
  ctx.strokeStyle = '#6e4a24';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(120, 120);
  ctx.stroke();
  speckle(ctx, 128, 128, 800, 0.15, r, 2);
  return tex(c);
}

/** One big painted ground texture: roads, lane marks, sidewalks, plaza, team zones. */
export function makeGround(m: MapData): THREE.CanvasTexture {
  const PPM = 12; // pixels per metre
  const W = (m.maxX - m.minX) * PPM, H = (m.maxZ - m.minZ) * PPM;
  const [c, ctx] = canvas(W, H);
  const r = rng(11);
  const X = (x: number) => (x - m.minX) * PPM;
  const Z = (z: number) => (z - m.minZ) * PPM;
  // sidewalk / pavement
  ctx.fillStyle = '#a7a299';
  ctx.fillRect(0, 0, W, H);
  // paving slabs
  ctx.strokeStyle = 'rgba(70,65,58,0.25)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += PPM * 1.5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += PPM * 1.5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  speckle(ctx, W, H, 40000, 0.1, r, 3);
  // grass patches near buildings
  for (const b of m.buildings) {
    ctx.fillStyle = 'rgba(40,40,40,0.35)'; // contact shadow/dirt band around footprint
    ctx.fillRect(X(b.x0) - 6, Z(b.z0) - 6, (b.x1 - b.x0) * PPM + 12, (b.z1 - b.z0) * PPM + 12);
  }
  // roads
  for (const rd of m.roads) {
    ctx.fillStyle = '#3c3f44';
    ctx.fillRect(X(rd.x0), Z(rd.z0), (rd.x1 - rd.x0) * PPM, (rd.z1 - rd.z0) * PPM);
  }
  // asphalt grain only on roads
  for (const rd of m.roads) {
    const n = Math.floor((rd.x1 - rd.x0) * (rd.z1 - rd.z0) * 6);
    for (let i = 0; i < n; i++) {
      const v = r() < 0.5 ? 20 : 120;
      ctx.fillStyle = `rgba(${v},${v},${v + 5},${0.25 * r()})`;
      ctx.fillRect(X(rd.x0 + r() * (rd.x1 - rd.x0)), Z(rd.z0 + r() * (rd.z1 - rd.z0)), 2, 2);
    }
    // cracks / patches
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(25,25,28,0.35)';
      ctx.fillRect(X(rd.x0 + r() * (rd.x1 - rd.x0)), Z(rd.z0 + r() * (rd.z1 - rd.z0)), 20 + r() * 40, 14 + r() * 30);
    }
  }
  // curbs
  ctx.strokeStyle = '#cfcac0';
  ctx.lineWidth = 3;
  for (const rd of m.roads) ctx.strokeRect(X(rd.x0), Z(rd.z0), (rd.x1 - rd.x0) * PPM, (rd.z1 - rd.z0) * PPM);
  // lane dashes
  ctx.fillStyle = '#f2efe6';
  for (let x = m.minX; x < m.maxX; x += 6) ctx.fillRect(X(x), Z(0) - 2, 3 * PPM, 4);
  ctx.fillStyle = '#e8c547';
  for (const cx of [-31, 31, 0])
    for (let z = m.minZ; z < m.maxZ; z += 6) ctx.fillRect(X(cx) - 2, Z(z), 4, 3 * PPM);
  // crosswalks
  ctx.fillStyle = 'rgba(245,242,235,0.9)';
  for (const cx of [-31, 31]) {
    for (const side of [-1, 1]) {
      const z0 = side * 7.5;
      for (let i = -3.5; i <= 3.5; i += 1) ctx.fillRect(X(cx + i) - 4, Z(z0) - 12, 6, 24);
    }
  }
  // plaza: circular stone pattern
  const pc = { x: X(0), y: Z(0) };
  const pr = (m.plaza.x1 - m.plaza.x0) / 2 * PPM;
  ctx.fillStyle = '#c9bfae';
  ctx.beginPath();
  ctx.arc(pc.x, pc.y, pr, 0, Math.PI * 2);
  ctx.fill();
  for (let rr = pr; rr > 10; rr -= PPM * 1.2) {
    ctx.strokeStyle = `rgba(110,95,75,${0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pc.x, pc.y, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = 0; a < 32; a++) {
    ctx.beginPath();
    ctx.moveTo(pc.x, pc.y);
    ctx.lineTo(pc.x + Math.cos((a / 32) * Math.PI * 2) * pr, pc.y + Math.sin((a / 32) * Math.PI * 2) * pr);
    ctx.stroke();
  }
  // team base zones
  const zone = (x0: number, x1: number, col: string) => {
    const g = ctx.createLinearGradient(X(x0), 0, X(x1), 0);
    g.addColorStop(x0 < 0 ? 0 : 1, col);
    g.addColorStop(x0 < 0 ? 1 : 0, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(X(x0), Z(-26), (x1 - x0) * PPM, 52 * PPM);
  };
  zone(-70, -56, 'rgba(40,120,255,0.45)');
  zone(56, 70, 'rgba(255,60,50,0.45)');
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 12]);
  ctx.strokeRect(X(-69), Z(-25), 13 * PPM, 50 * PPM);
  ctx.strokeRect(X(56), Z(-25), 13 * PPM, 50 * PPM);
  ctx.setLineDash([]);
  const t = tex(c, true, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function makeRadial(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return tex(c, true, false);
}

export function makeSmoke(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const r = rng(5);
  for (let i = 0; i < 14; i++) {
    const x = 34 + r() * 60, y = 34 + r() * 60, rad = 18 + r() * 28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return tex(c, true, false);
}
