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
  /** G = roughness, B = metalness (glass reflects the sky). */
  rough: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
}

/** Tangent-space normal map from a grey height canvas (Sobel, wrapping). */
export function heightToNormal(hc: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const W = hc.width, H = hc.height;
  const src = hc.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = src[i * 4] / 255;
  const [nc, nx] = canvas(W, H);
  const img = nx.createImageData(W, H);
  const at = (x: number, y: number) => h[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      img.data[o] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  nx.putImageData(img, 0, 0);
  return tex(nc, false);
}

/** Facade tile: 4 bays x 4 floors = 16 m x 14 m, one texture set per style. */
export const FACADE_TILE_W = 16;
export const FACADE_TILE_H = 14;
export const FACADE_STYLES = 4;
/**
 * Facades, painted in four layers that stay in register: colour (neutral, the
 * building's vertex colour tints it), height (-> normal map: recessed windows,
 * proud frames and sills, brick courses), roughness+metalness (glass is smooth
 * and reflective) and emissive (a few lit rooms).
 * Styles: 0 rendered residential, 1 brick, 2 stone with shop windows, 3 glass office.
 */
export function makeFacades(): FacadeSet[] {
  const W = 1024, H = 896;
  const PX = W / FACADE_TILE_W; // 64 px per metre
  const r = rng(42);
  const out: FacadeSet[] = [];
  for (let style = 0; style < FACADE_STYLES; style++) {
    const [c, ctx] = canvas(W, H);
    const [ce, cte] = canvas(W, H);
    const [cr, ctr] = canvas(W, H);
    // height (-> normal map) at half resolution: plenty for recesses and courses, 4x cheaper
    const [ch, cth] = canvas(W / 2, H / 2);
    cth.scale(0.5, 0.5);
    const RM = (rough: number, metal = 0) => `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
    const HT = (v: number) => `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`;
    cte.fillStyle = '#000';
    cte.fillRect(0, 0, W, H);
    cth.fillStyle = HT(0.5);
    cth.fillRect(0, 0, W, H);
    ctr.fillStyle = RM(0.9);
    ctr.fillRect(0, 0, W, H);
    // ---- wall surface
    ctx.fillStyle = style === 3 ? '#8a939c' : style === 2 ? '#e6e1d8' : '#efebe4';
    ctx.fillRect(0, 0, W, H);
    if (style === 1) {
      // brick courses: 6.5 cm courses (~4 px), running bond
      const bh = 4.4, bw = 14;
      for (let y = 0, row = 0; y < H; y += bh, row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < W; x += bw) {
          const v = 200 + (r() - 0.5) * 60;
          ctx.fillStyle = `rgb(${v},${v * 0.93},${v * 0.88})`;
          ctx.fillRect(x + off, y, bw - 1.2, bh - 1);
        }
        cth.fillStyle = HT(0.42);
        cth.fillRect(0, y + bh - 1, W, 1);
      }
      for (let x = 0; x < W; x += bw / 2) { cth.fillStyle = HT(0.45); cth.fillRect(x, 0, 1, H); }
    } else if (style === 2) {
      // ashlar stone blocks 1 m x 0.5 m
      for (let y = 0, row = 0; y < H; y += PX * 0.5, row++)
        for (let x = (row % 2) * -PX * 0.5; x < W; x += PX) {
          const v = 225 + (r() - 0.5) * 22;
          ctx.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
          ctx.fillRect(x + 1, y + 1, PX - 2, PX * 0.5 - 2);
          cth.fillStyle = HT(0.4);
          cth.fillRect(x, y, PX, 1.5);
          cth.fillRect(x, y, 1.5, PX * 0.5);
        }
    }
    if (style !== 3) {
      speckle(ctx, W, H, 9000, 0.06, r, 3);
      // large soft blotches: uneven paint / weathering
      for (let i = 0; i < 40; i++) {
        const x = r() * W, y = r() * H, rad = 40 + r() * 140;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${r() < 0.5 ? '60,55,48' : '255,250,240'},${0.05 + r() * 0.05})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    const bayW = W / 4, flH = H / 4;
    for (let fl = 0; fl < 4; fl++) {
      const y = fl * flH;
      // floor band / cornice line
      if (style !== 3) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(0, y + flH - 14, W, 10);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(0, y + flH - 4, W, 4);
        cth.fillStyle = HT(0.66);
        cth.fillRect(0, y + flH - 14, W, 10);
      } else {
        // spandrel panel between glazing floors
        ctx.fillStyle = '#3b4148';
        ctx.fillRect(0, y + flH - 40, W, 40);
        ctr.fillStyle = RM(0.35, 0.6);
        ctr.fillRect(0, y + flH - 40, W, 40);
      }
      for (let b = 0; b < 4; b++) {
        const x = b * bayW;
        const wins: [number, number, number, number][] = [];
        if (style === 0) wins.push([x + 64, y + 44, bayW - 128, flH - 92]);
        else if (style === 1) { wins.push([x + 34, y + 44, 72, flH - 92]); wins.push([x + bayW - 106, y + 44, 72, flH - 92]); }
        else if (style === 2) wins.push([x + 26, y + 52, bayW - 52, flH - 104]);
        else wins.push([x + 6, y + 4, bayW - 12, flH - 50]);
        for (const [wx, wy, ww, wh] of wins) {
          const frame = style === 3 ? 6 : 9;
          // reveal (shadowed jamb) round the window, then frame, then glass
          if (style !== 3) {
            ctx.fillStyle = 'rgba(40,36,32,0.55)';
            ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
            cth.fillStyle = HT(0.25);
            cth.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
          }
          const frameCol = style === 3 ? '#2a3038' : style === 1 ? '#e9e6df' : '#f4f2ee';
          ctx.fillStyle = frameCol;
          ctx.fillRect(wx, wy, ww, wh);
          cth.fillStyle = HT(0.4);
          cth.fillRect(wx, wy, ww, wh);
          ctr.fillStyle = RM(0.45, style === 3 ? 0.8 : 0);
          ctr.fillRect(wx, wy, ww, wh);
          // panes
          const panes: [number, number, number, number][] = [];
          const gx = wx + frame, gy = wy + frame, gw = ww - 2 * frame, gh = wh - 2 * frame;
          if (style === 3) panes.push([gx, gy, gw, gh]);
          else {
            const half = (gw - frame) / 2;
            const top = style === 0 ? gh * 0.28 : 0;
            if (top) panes.push([gx, gy, gw, top - frame / 2]);
            panes.push([gx, gy + top + (top ? frame / 2 : 0), half, gh - top - (top ? frame / 2 : 0)]);
            panes.push([gx + half + frame, gy + top + (top ? frame / 2 : 0), half, gh - top - (top ? frame / 2 : 0)]);
          }
          const lit = r() < 0.07;
          for (const [px, py, pw, ph] of panes) {
            // glass: dark, slightly varying tint; the sky reflection comes from the env map
            const tint = r();
            const gl = ctx.createLinearGradient(px, py, px + pw * 0.4, py + ph);
            const lo = style === 3 ? 1.6 : 1;
            gl.addColorStop(0, `rgb(${(80 + tint * 25) * lo},${(98 + tint * 20) * lo},${(116 + tint * 14) * lo})`);
            gl.addColorStop(1, `rgb(${(30 + tint * 10) * lo},${(38 + tint * 10) * lo},${(48 + tint * 10) * lo})`);
            ctx.fillStyle = gl;
            ctx.fillRect(px, py, pw, ph);
            ctr.fillStyle = RM(0.04 + r() * 0.08, 0.55 + r() * 0.2);
            ctr.fillRect(px, py, pw, ph);
            cth.fillStyle = HT(0.18);
            cth.fillRect(px, py, pw, ph);
            if (style === 3) continue;
            // what is behind the glass: blinds, curtains, a dark room
            const k = r();
            if (k < 0.35) { // venetian blind partly down
              const down = ph * (0.2 + r() * 0.7);
              ctx.fillStyle = 'rgba(205,200,188,0.85)';
              ctx.fillRect(px, py, pw, down);
              ctx.fillStyle = 'rgba(80,75,70,0.35)';
              for (let s = py + 3; s < py + down; s += 4) ctx.fillRect(px, s, pw, 1);
              ctr.fillStyle = RM(0.5, 0.15);
              ctr.fillRect(px, py, pw, down);
            } else if (k < 0.6) { // curtain on one side
              const cw = pw * (0.25 + r() * 0.35);
              const left = r() < 0.5;
              const hue = Math.floor(r() * 360);
              ctx.fillStyle = `hsla(${hue},25%,${55 + r() * 25}%,0.9)`;
              ctx.fillRect(left ? px : px + pw - cw, py, cw, ph);
              ctx.fillStyle = 'rgba(0,0,0,0.12)';
              for (let s = 0; s < cw; s += 6) ctx.fillRect((left ? px : px + pw - cw) + s, py, 2, ph);
              ctr.fillStyle = RM(0.6, 0.1);
              ctr.fillRect(left ? px : px + pw - cw, py, cw, ph);
            }
            if (lit) {
              const lg = cte.createLinearGradient(0, py, 0, py + ph);
              lg.addColorStop(0, 'rgb(255,200,130)');
              lg.addColorStop(1, 'rgb(150,95,45)');
              cte.fillStyle = lg;
              cte.fillRect(px, py, pw, ph);
            }
          }
          // mullion highlight
          if (style !== 3) {
            cth.fillStyle = HT(0.55);
            cth.fillRect(wx, wy, ww, frame);
            cth.fillRect(wx, wy + wh - frame, ww, frame);
            cth.fillRect(wx, wy, frame, wh);
            cth.fillRect(wx + ww - frame, wy, frame, wh);
          }
          // sill and lintel, then rain streaks running down from the sill corners
          if (style !== 3) {
            ctx.fillStyle = '#d9d3c7';
            ctx.fillRect(wx - 12, wy + wh + 4, ww + 24, 10);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(wx - 12, wy + wh + 14, ww + 24, 4);
            cth.fillStyle = HT(0.82);
            cth.fillRect(wx - 12, wy + wh + 4, ww + 24, 10);
            if (style !== 0) {
              ctx.fillStyle = style === 1 ? '#cfc8bb' : '#ddd8ce';
              ctx.fillRect(wx - 8, wy - 18, ww + 16, 12);
              cth.fillStyle = HT(0.7);
              cth.fillRect(wx - 8, wy - 18, ww + 16, 12);
            }
            for (let s = 0; s < 5; s++) {
              const sx = wx - 10 + r() * (ww + 20), len = 30 + r() * 90, sw = 3 + r() * 8;
              const g = ctx.createLinearGradient(0, wy + wh + 18, 0, wy + wh + 18 + len);
              g.addColorStop(0, `rgba(45,40,35,${0.12 + r() * 0.12})`);
              g.addColorStop(1, 'rgba(45,40,35,0)');
              ctx.fillStyle = g;
              ctx.fillRect(sx, wy + wh + 18, sw, len);
            }
          }
          // an air conditioner under some windows
          if (style !== 3 && r() < 0.12) {
            const ax = wx + ww / 2 - 34, ay = wy + wh + 26;
            ctx.fillStyle = '#d8d8d4';
            ctx.fillRect(ax, ay, 68, 44);
            ctx.fillStyle = '#9a9a96';
            for (let s = 0; s < 6; s++) ctx.fillRect(ax + 6, ay + 6 + s * 6, 56, 2);
            cth.fillStyle = HT(0.9);
            cth.fillRect(ax, ay, 68, 44);
            ctr.fillStyle = RM(0.5, 0.3);
            ctr.fillRect(ax, ay, 68, 44);
          }
        }
      }
    }
    // ground grime: darker splash zone along the bottom of the tile
    if (style !== 3) {
      const g = ctx.createLinearGradient(0, H - 70, 0, H);
      g.addColorStop(0, 'rgba(40,35,30,0)');
      g.addColorStop(1, 'rgba(40,35,30,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(0, H - 70, W, 70);
    }
    out.push({ map: tex(c), emissive: tex(ce), rough: tex(cr, false), normal: heightToNormal(ch, 1.8) });
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

export interface GroundSet { map: THREE.CanvasTexture; rough: THREE.CanvasTexture }

/**
 * One big painted ground texture plus a matching roughness map (same UVs):
 * concrete paving slabs, worn asphalt with tyre tracks, cracks, patch repairs,
 * manholes and faded markings, and rain puddles that are dark and mirror-smooth
 * so they reflect the sky.
 */
export function makeGround(m: MapData): GroundSet {
  // pixels per metre: the city is 280 x 200 m, so this keeps the canvas under
  // 4096 px (the texture limit of many phones) and its memory reasonable
  const PPM = Math.min(16, Math.floor(3200 / Math.max(m.maxX - m.minX, m.maxZ - m.minZ)));
  const RK = 0.5; // roughness map resolution relative to colour
  const W = (m.maxX - m.minX) * PPM, H = (m.maxZ - m.minZ) * PPM;
  const [c, ctx] = canvas(W, H);
  const [cr, rx] = canvas(Math.round(W * RK), Math.round(H * RK));
  rx.scale(RK, RK);
  const r = rng(11);
  const X = (x: number) => (x - m.minX) * PPM;
  const Z = (z: number) => (z - m.minZ) * PPM;
  const rough = (v: number) => `rgb(0,${Math.round(v * 255)},0)`;
  const inRoad = (x: number, z: number) => m.roads.some((rd) => x > rd.x0 && x < rd.x1 && z > rd.z0 && z < rd.z1);

  // ---- sidewalk: 1.2 m concrete slabs, each a slightly different tone
  ctx.fillStyle = '#8f8b84';
  ctx.fillRect(0, 0, W, H);
  rx.fillStyle = rough(0.88);
  rx.fillRect(0, 0, W, H);
  const SL = 1.2 * PPM;
  for (let y = 0; y < H; y += SL)
    for (let x = 0; x < W; x += SL) {
      const v = 128 + (r() - 0.5) * 18, w = (r() - 0.5) * 6;
      ctx.fillStyle = `rgb(${v + 6 + w},${v + 3},${v - 3 - w})`;
      ctx.fillRect(x + 1, y + 1, SL - 2, SL - 2);
      if (r() < 0.06) { // stained or cracked slab
        ctx.fillStyle = `rgba(40,36,30,${0.08 + r() * 0.12})`;
        ctx.beginPath();
        ctx.ellipse(x + r() * SL, y + r() * SL, 4 + r() * 10, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  speckle(ctx, W, H, 90000 * Math.min(2.5, (W * H) / 3.6e6), 0.07, r, 2);
  // large-scale grime: darker towards walls, lighter in the middle of open space
  const areaK = ((m.maxX - m.minX) * (m.maxZ - m.minZ)) / 14000;
  for (let i = 0; i < 260 * areaK; i++) {
    const x = r() * W, y = r() * H, rad = (2 + r() * 7) * PPM;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(30,28,24,${0.05 + r() * 0.07})`);
    g.addColorStop(1, 'rgba(30,28,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // dirt and contact shadow round every building footprint
  for (const b of m.buildings) {
    for (let k = 0; k < 3; k++) {
      const e = (k + 1) * 0.35 * PPM;
      ctx.fillStyle = 'rgba(25,22,18,0.16)';
      ctx.fillRect(X(b.x0) - e, Z(b.z0) - e, (b.x1 - b.x0) * PPM + 2 * e, (b.z1 - b.z0) * PPM + 2 * e);
    }
  }

  // ---- district grounds: lawns, gravel yards, marked car parks
  for (const zn of m.zones) {
    const x0 = X(zn.x0), y0 = Z(zn.z0), w = (zn.x1 - zn.x0) * PPM, h = (zn.z1 - zn.z0) * PPM;
    if (zn.kind === 'grass') {
      ctx.fillStyle = '#4f6a34';
      ctx.fillRect(x0, y0, w, h);
      for (let i = 0; i < (w * h) / 9; i++) {
        const g = 70 + r() * 70;
        ctx.fillStyle = `rgba(${g * 0.55},${g},${g * 0.35},${0.25 + r() * 0.35})`;
        ctx.fillRect(x0 + r() * w, y0 + r() * h, 1.5, 1.5 + r() * 2.5);
      }
      for (let i = 0; i < (w * h) / (PPM * PPM * 10); i++) {
        const x = x0 + r() * w, y = y0 + r() * h, rad = (1 + r() * 3) * PPM;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, r() < 0.5 ? 'rgba(110,95,60,0.25)' : 'rgba(40,70,25,0.3)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      rx.fillStyle = rough(0.95);
      rx.fillRect(x0, y0, w, h);
    } else if (zn.kind === 'gravel') {
      ctx.fillStyle = '#7d766a';
      ctx.fillRect(x0, y0, w, h);
      for (let i = 0; i < (w * h) / 10; i++) {
        const v = 80 + r() * 90;
        ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.35 + r() * 0.4})`;
        ctx.fillRect(x0 + r() * w, y0 + r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
      }
      rx.fillStyle = rough(0.97);
      rx.fillRect(x0, y0, w, h);
    } else {
      ctx.fillStyle = '#3a3b3e';
      ctx.fillRect(x0, y0, w, h);
      for (let i = 0; i < (w * h) * 0.04; i++) {
        const v = r() < 0.55 ? 22 : 100 + r() * 40;
        ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.2 + 0.3 * r()})`;
        ctx.fillRect(x0 + r() * w, y0 + r() * h, 1 + r(), 1 + r());
      }
      // parking bays: white lines every 2.6 m along the long side
      const along = w >= h;
      ctx.fillStyle = 'rgba(230,228,220,0.75)';
      if (along) for (let x = x0 + 1.3 * PPM; x < x0 + w; x += 2.6 * PPM) { ctx.fillRect(x, y0 + 0.5 * PPM, 0.12 * PPM, 4.8 * PPM); ctx.fillRect(x, y0 + h - 5.3 * PPM, 0.12 * PPM, 4.8 * PPM); }
      else for (let y = y0 + 1.3 * PPM; y < y0 + h; y += 2.6 * PPM) { ctx.fillRect(x0 + 0.5 * PPM, y, 4.8 * PPM, 0.12 * PPM); ctx.fillRect(x0 + w - 5.3 * PPM, y, 4.8 * PPM, 0.12 * PPM); }
      rx.fillStyle = rough(0.8);
      rx.fillRect(x0, y0, w, h);
    }
  }

  // ---- roads
  for (const rd of m.roads) {
    const x0 = X(rd.x0), y0 = Z(rd.z0), w = (rd.x1 - rd.x0) * PPM, h = (rd.z1 - rd.z0) * PPM;
    // gutter: darker, wetter strip along the kerb
    ctx.fillStyle = '#2a2b2d';
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = '#35373a';
    ctx.fillRect(x0 + (w > h ? 0 : 0.45 * PPM), y0 + (w > h ? 0.45 * PPM : 0), w - (w > h ? 0 : 0.9 * PPM), h - (w > h ? 0.9 * PPM : 0));
    rx.fillStyle = rough(0.78);
    rx.fillRect(x0, y0, w, h);
  }
  for (const rd of m.roads) {
    const x0 = X(rd.x0), y0 = Z(rd.z0), w = (rd.x1 - rd.x0) * PPM, h = (rd.z1 - rd.z0) * PPM;
    const along = w > h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    // aggregate grain
    const n = Math.floor(w * h * 0.06);
    for (let i = 0; i < n; i++) {
      const v = r() < 0.55 ? 18 : 105 + r() * 40;
      ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.18 + 0.3 * r()})`;
      ctx.fillRect(x0 + r() * w, y0 + r() * h, 1 + r() * 1.6, 1 + r() * 1.6);
    }
    // blotchy tone variation
    for (let i = 0; i < (w * h) / (PPM * PPM * 6); i++) {
      const x = x0 + r() * w, y = y0 + r() * h, rad = (1.5 + r() * 4) * PPM;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const dark = r() < 0.6;
      g.addColorStop(0, dark ? `rgba(10,10,12,${0.1 + r() * 0.12})` : `rgba(120,118,112,${0.05 + r() * 0.06})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // tyre tracks: two darker, smoother bands per lane
    const lanes = along ? [-3.9, -2.1, 2.1, 3.9] : [-2.6, -1.0, 1.0, 2.6];
    const mid = along ? (rd.z0 + rd.z1) / 2 : (rd.x0 + rd.x1) / 2;
    for (const l of lanes) {
      const p = (mid + l - (along ? m.minZ : m.minX)) * PPM;
      const bw = 0.55 * PPM;
      const g = along ? ctx.createLinearGradient(0, p - bw, 0, p + bw) : ctx.createLinearGradient(p - bw, 0, p + bw, 0);
      g.addColorStop(0, 'rgba(12,12,14,0)');
      g.addColorStop(0.5, 'rgba(12,12,14,0.22)');
      g.addColorStop(1, 'rgba(12,12,14,0)');
      ctx.fillStyle = g;
      if (along) ctx.fillRect(x0, p - bw, w, 2 * bw); else ctx.fillRect(p - bw, y0, 2 * bw, h);
      rx.fillStyle = rough(0.62);
      if (along) rx.fillRect(x0, p - bw * 0.5, w, bw); else rx.fillRect(p - bw * 0.5, y0, bw, h);
    }
    // patch repairs: rectangles of newer, darker asphalt with a sealed outline
    for (let i = 0; i < Math.max(3, (w * h) / (PPM * PPM * 60)); i++) {
      const pw = (1.5 + r() * 4) * PPM, ph = (1 + r() * 2.5) * PPM;
      const px = x0 + r() * (w - pw), py = y0 + r() * (h - ph);
      ctx.fillStyle = `rgba(22,23,25,${0.55 + r() * 0.3})`;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = 'rgba(8,8,9,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);
    }
    // cracks: branching jagged polylines with tar-sealed edges
    for (let i = 0; i < (w * h) / (PPM * PPM * 14); i++) {
      let x = x0 + r() * w, y = y0 + r() * h, a = r() * Math.PI * 2;
      ctx.strokeStyle = `rgba(6,6,7,${0.45 + r() * 0.4})`;
      ctx.lineWidth = 0.8 + r() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0, steps = 6 + r() * 18; k < steps; k++) {
        a += (r() - 0.5) * 1.3;
        x += Math.cos(a) * (4 + r() * 10);
        y += Math.sin(a) * (4 + r() * 10);
        ctx.lineTo(x, y);
        if (r() < 0.12) { ctx.moveTo(x, y); a += (r() - 0.5) * 2.5; }
      }
      ctx.stroke();
    }
    // oil stains (only in lanes)
    for (let i = 0; i < (w * h) / (PPM * PPM * 40); i++) {
      const x = x0 + r() * w, y = y0 + r() * h, rad = (0.3 + r() * 0.9) * PPM;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(5,5,8,0.45)');
      g.addColorStop(1, 'rgba(5,5,8,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
      rx.fillStyle = rough(0.45);
      rx.beginPath();
      rx.arc(x, y, rad * 0.6, 0, Math.PI * 2);
      rx.fill();
    }
    ctx.restore();
  }
  // manholes and drains
  for (const rd of m.roads) {
    const along = rd.x1 - rd.x0 > rd.z1 - rd.z0;
    const len = along ? rd.x1 - rd.x0 : rd.z1 - rd.z0;
    for (let t = 7; t < len - 4; t += 17 + r() * 9) {
      const off = (r() - 0.5) * 2.5;
      const x = along ? rd.x0 + t : (rd.x0 + rd.x1) / 2 + off;
      const z = along ? (rd.z0 + rd.z1) / 2 + off + (r() < 0.5 ? -2.5 : 2.5) : rd.z0 + t;
      const cx = X(x), cy = Z(z), rad = 0.38 * PPM;
      ctx.fillStyle = '#1d1e20';
      ctx.beginPath(); ctx.arc(cx, cy, rad + 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3c3b39';
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(15,15,15,0.7)';
      ctx.lineWidth = 1;
      for (let k = -rad + 2; k < rad; k += 3) { ctx.beginPath(); ctx.moveTo(cx - rad, cy + k); ctx.lineTo(cx + rad, cy + k); ctx.stroke(); }
      rx.fillStyle = rough(0.4);
      rx.beginPath(); rx.arc(cx, cy, rad, 0, Math.PI * 2); rx.fill();
      // kerbside drain grate
      const gx = along ? X(x + 3) : X(rd.x0 + 0.25), gy = along ? Z(rd.z0 + 0.25) : Z(z + 3);
      ctx.fillStyle = '#18191a';
      ctx.fillRect(gx - (along ? 0.45 : 0.2) * PPM, gy - (along ? 0.2 : 0.45) * PPM, (along ? 0.9 : 0.4) * PPM, (along ? 0.4 : 0.9) * PPM);
    }
  }
  // kerb stones: light edge plus a shadow line on the road side
  for (const rd of m.roads) {
    ctx.strokeStyle = '#b9b4aa';
    ctx.lineWidth = 0.22 * PPM;
    ctx.strokeRect(X(rd.x0), Z(rd.z0), (rd.x1 - rd.x0) * PPM, (rd.z1 - rd.z0) * PPM);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(X(rd.x0) + 0.14 * PPM, Z(rd.z0) + 0.14 * PPM, (rd.x1 - rd.x0 - 0.28) * PPM, (rd.z1 - rd.z0 - 0.28) * PPM);
  }
  /** Road paint with worn, patchy coverage. */
  const paint = (x: number, y: number, w: number, h: number, col: [number, number, number]) => {
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.82)`;
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < (w * h) / 6; i++) {
      ctx.fillStyle = `rgba(45,46,48,${r() * 0.55})`;
      ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1 + r() * 2);
    }
    rx.fillStyle = rough(0.55);
    rx.fillRect(x, y, w, h);
  };
  const plazaR = (m.plaza.x1 - m.plaza.x0) / 2;
  const horiz = m.roads.filter((rd) => rd.x1 - rd.x0 > rd.z1 - rd.z0);
  const vert = m.roads.filter((rd) => rd.x1 - rd.x0 <= rd.z1 - rd.z0);
  const inPlaza = (x: number, z: number) => Math.hypot(x, z) < plazaR + 1;
  // centre lines: white dashes on the east-west roads, yellow on the north-south ones,
  // broken at every junction
  for (const rd of horiz) {
    const cz = (rd.z0 + rd.z1) / 2;
    for (let x = rd.x0; x < rd.x1 - 3; x += 6) {
      if (vert.some((v) => x + 3 > v.x0 - 1 && x < v.x1 + 1) || inPlaza(x + 1.5, cz)) continue;
      paint(X(x), Z(cz) - 0.07 * PPM, 3 * PPM, 0.14 * PPM, [236, 233, 222]);
    }
  }
  for (const rd of vert) {
    const cx = (rd.x0 + rd.x1) / 2;
    for (let z = rd.z0; z < rd.z1 - 3; z += 6) {
      if (horiz.some((h) => z + 3 > h.z0 - 1.5 && z < h.z1 + 1.5) || inPlaza(cx, z + 1.5)) continue;
      paint(X(cx) - 0.07 * PPM, Z(z), 0.14 * PPM, 3 * PPM, [222, 188, 70]);
    }
  }
  // zebra crossings and stop lines where a north-south road meets an east-west one
  for (const v of vert) for (const h of horiz) {
    if (v.x0 < m.plaza.x1 && v.x1 > m.plaza.x0 && h.z0 < m.plaza.z1 && h.z1 > m.plaza.z0) continue;
    const cx = (v.x0 + v.x1) / 2, half = (v.x1 - v.x0) / 2 - 0.5;
    for (const side of [-1, 1]) {
      const zEdge = side < 0 ? h.z0 : h.z1;
      if (zEdge <= v.z0 + 2 || zEdge >= v.z1 - 2) continue;
      const z0 = zEdge + side * 1.6;
      for (let i = -half; i <= half; i += 1) paint(X(cx + i) - 0.25 * PPM, Z(z0) - 0.9 * PPM, 0.5 * PPM, 1.8 * PPM, [240, 238, 230]);
      paint(X(cx - half - 0.5), Z(z0 + side * 1.4) - 0.1 * PPM, (2 * half + 1) * PPM, 0.2 * PPM, [240, 238, 230]);
    }
  }

  // ---- plaza: granite setts in concentric rings
  const pc = { x: X(0), y: Z(0) };
  const pr = plazaR * PPM;
  ctx.fillStyle = '#a69d8e';
  ctx.beginPath();
  ctx.arc(pc.x, pc.y, pr, 0, Math.PI * 2);
  ctx.fill();
  rx.fillStyle = rough(0.7);
  rx.beginPath(); rx.arc(pc.x, pc.y, pr, 0, Math.PI * 2); rx.fill();
  for (let rr = pr - 2; rr > 6; rr -= 0.42 * PPM) {
    const n = Math.max(6, Math.floor((2 * Math.PI * rr) / (0.5 * PPM)));
    const off = r() * Math.PI;
    for (let k = 0; k < n; k++) {
      const a0 = off + (k / n) * Math.PI * 2, a1 = off + ((k + 0.92) / n) * Math.PI * 2;
      const v = 150 + (r() - 0.5) * 40;
      ctx.fillStyle = `rgb(${v + 8},${v},${v - 10})`;
      ctx.beginPath();
      ctx.arc(pc.x, pc.y, rr, a0, a1);
      ctx.arc(pc.x, pc.y, rr - 0.36 * PPM, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }
  }
  // a darker granite ring at the edge
  ctx.strokeStyle = '#5d5853';
  ctx.lineWidth = 0.5 * PPM;
  ctx.beginPath(); ctx.arc(pc.x, pc.y, pr - 0.25 * PPM, 0, Math.PI * 2); ctx.stroke();

  // ---- puddles: irregular blobs, mostly on roads and in the gutters
  for (let i = 0; i < 70 * areaK; i++) {
    let x = 0, z = 0;
    for (let t = 0; t < 10; t++) {
      x = m.minX + 2 + r() * (m.maxX - m.minX - 4);
      z = m.minZ + 2 + r() * (m.maxZ - m.minZ - 4);
      if (inRoad(x, z) || r() < 0.15) break;
    }
    const size = 0.5 + r() * 1.6;
    const blobs = 3 + Math.floor(r() * 5);
    const pts: [number, number, number][] = [];
    for (let k = 0; k < blobs; k++) pts.push([X(x) + (r() - 0.5) * size * PPM * 1.6, Z(z) + (r() - 0.5) * size * PPM, (0.3 + r() * 0.6) * size * PPM]);
    // wet darkened rim, then the water itself
    ctx.fillStyle = 'rgba(10,10,12,0.28)';
    for (const [px, py, pr2] of pts) { ctx.beginPath(); ctx.arc(px, py, pr2 * 1.35, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(14,16,20,0.55)';
    for (const [px, py, pr2] of pts) { ctx.beginPath(); ctx.arc(px, py, pr2, 0, Math.PI * 2); ctx.fill(); }
    rx.fillStyle = rough(0.45);
    for (const [px, py, pr2] of pts) { rx.beginPath(); rx.arc(px, py, pr2 * 1.35, 0, Math.PI * 2); rx.fill(); }
    rx.fillStyle = rough(0.04);
    for (const [px, py, pr2] of pts) { rx.beginPath(); rx.arc(px, py, pr2, 0, Math.PI * 2); rx.fill(); }
  }

  const t = tex(c, true, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const tr = tex(cr, false, false);
  tr.wrapS = tr.wrapT = THREE.ClampToEdgeWrapping;
  return { map: t, rough: tr };
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
