import * as THREE from 'three';
import { rng } from './textures';

/**
 * Procedural PBR texture sets (colour + normal + roughness) for walk-in
 * buildings and the metro. A height field is painted alongside the colour and
 * turned into a tangent-space normal map, so mortar, grout and plank seams
 * catch the light.
 */

export interface TexSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; }

const S = 512;

class Painter {
  readonly c: HTMLCanvasElement;
  readonly x: CanvasRenderingContext2D;
  /** Height 0..1 per pixel. */
  readonly h = new Float32Array(S * S);
  /** Roughness 0..1 per pixel. */
  readonly r = new Float32Array(S * S).fill(0.8);
  constructor(base: string) {
    this.c = document.createElement('canvas');
    this.c.width = this.c.height = S;
    this.x = this.c.getContext('2d')!;
    this.x.fillStyle = base;
    this.x.fillRect(0, 0, S, S);
    this.h.fill(0.5);
  }
  /** Fills a rect in the height and roughness fields (wraps around the edges). */
  field(x0: number, y0: number, w: number, hgt: number, height: number | null, rough: number | null): void {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + hgt); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
        const k = ((y + S) % S) * S + ((x + S) % S);
        if (height !== null) this.h[k] = height;
        if (rough !== null) this.r[k] = rough;
      }
  }
  /** Adds multi-octave value noise to height (and darkens/lightens the colour a little). */
  noise(seed: number, amp: number, scale: number, tint = 0): void {
    const n = valueNoise(seed, scale);
    for (let i = 0; i < S * S; i++) this.h[i] += (n[i] - 0.5) * amp;
    if (tint > 0) {
      const img = this.x.getImageData(0, 0, S, S);
      for (let i = 0; i < S * S; i++) {
        const k = 1 + (n[i] - 0.5) * tint;
        img.data[i * 4] *= k; img.data[i * 4 + 1] *= k; img.data[i * 4 + 2] *= k;
      }
      this.x.putImageData(img, 0, 0);
    }
  }
  /** 3x3 box blur of the height field: sharp one-pixel bumps sparkle under the sun. */
  private smooth(passes: number): void {
    const t = new Float32Array(S * S);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          let a = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += this.h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
          t[y * S + x] = a / 9;
        }
      this.h.set(t);
    }
  }
  build(normalStrength: number, repeat = true): TexSet {
    this.smooth(2);
    const map = new THREE.CanvasTexture(this.c);
    map.colorSpace = THREE.SRGBColorSpace;
    // normal map from the height field (Sobel, wrapping)
    const nc = document.createElement('canvas');
    nc.width = nc.height = S;
    const nx = nc.getContext('2d')!;
    const img = nx.createImageData(S, S);
    const H = (x: number, y: number) => this.h[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * normalStrength;
        const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * normalStrength;
        const l = Math.hypot(dx, dy, 1);
        const o = (y * S + x) * 4;
        img.data[o] = (-dx / l * 0.5 + 0.5) * 255;
        img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255;
        img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    nx.putImageData(img, 0, 0);
    const normalMap = new THREE.CanvasTexture(nc);
    // roughness map (green channel)
    const rc = document.createElement('canvas');
    rc.width = rc.height = S;
    const rx = rc.getContext('2d')!;
    const ri = rx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = Math.max(0, Math.min(1, this.r[i])) * 255;
      ri.data[i * 4] = v; ri.data[i * 4 + 1] = v; ri.data[i * 4 + 2] = v; ri.data[i * 4 + 3] = 255;
    }
    rx.putImageData(ri, 0, 0);
    const roughnessMap = new THREE.CanvasTexture(rc);
    for (const t of [map, normalMap, roughnessMap]) {
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    return { map, normalMap, roughnessMap };
  }
}

/** Tileable multi-octave value noise in 0..1. */
function valueNoise(seed: number, scale: number): Float32Array {
  const out = new Float32Array(S * S);
  const r = rng(seed);
  let amp = 1, total = 0;
  for (let cells = scale; cells <= S / 2; cells *= 2) {
    const g = new Float32Array(cells * cells).map(() => r());
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * cells, fy = (y / S) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const G = (a: number, b: number) => g[((b % cells) * cells) + (a % cells)];
        const v = (G(x0, y0) * (1 - sx) + G(x0 + 1, y0) * sx) * (1 - sy) + (G(x0, y0 + 1) * (1 - sx) + G(x0 + 1, y0 + 1) * sx) * sy;
        out[y * S + x] += v * amp;
      }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const hsl = (h: number, s: number, l: number) => `hsl(${h},${s}%,${l}%)`;

/** Red brick, running bond. One tile = 1.6 m x 1.6 m (8 courses x 2.5 bricks). */
export function brickTex(seed = 1): TexSet {
  const p = new Painter('#b9b2a6');
  const r = rng(seed);
  const rows = 24, bw = S / 3.4, bh = S / rows, m = 3;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < S + bw; x += bw) {
      const x0 = x + off + m / 2, y0 = row * bh + m / 2, w = bw - m, hh = bh - m;
      p.x.fillStyle = hsl(8 + r() * 14, 38 + r() * 18, 30 + r() * 14);
      p.x.fillRect(x0, y0, w, hh);
      // burnt patches and chips
      p.x.fillStyle = `rgba(30,15,10,${r() * 0.25})`;
      p.x.fillRect(x0 + r() * w * 0.6, y0, w * 0.4, hh);
      p.field(x0, y0, w, hh, 0.78 + r() * 0.06, 0.85);
    }
  }
  p.noise(seed * 7 + 3, 0.12, 32, 0.25);
  return p.build(2.4);
}

/** Smooth painted plaster with faint trowel marks. One tile = 3 m. */
export function plasterTex(seed = 2): TexSet {
  const p = new Painter('#f2eee6');
  p.noise(seed * 11, 0.18, 4, 0.08);
  p.noise(seed * 13, 0.05, 64, 0.04);
  p.r.fill(0.9);
  return p.build(0.8);
}

/** Oak floorboards, 7 boards across. One tile = 1.4 m. */
export function woodTex(seed = 3): TexSet {
  const p = new Painter('#7a5634');
  const r = rng(seed);
  const n = 7, bw = S / n;
  for (let i = 0; i < n; i++) {
    let y = -r() * S;
    while (y < S) {
      const len = S * (0.45 + r() * 0.6);
      const base = 26 + r() * 10;
      p.x.fillStyle = hsl(28 + r() * 6, 42 + r() * 12, base);
      p.x.fillRect(i * bw + 1, y + 1, bw - 2, len - 2);
      // grain
      for (let g = 0; g < 18; g++) {
        p.x.strokeStyle = `rgba(40,22,10,${0.08 + r() * 0.14})`;
        p.x.lineWidth = 0.6 + r();
        const gx = i * bw + 3 + r() * (bw - 6);
        p.x.beginPath();
        p.x.moveTo(gx, y);
        p.x.bezierCurveTo(gx + (r() - 0.5) * 8, y + len * 0.3, gx + (r() - 0.5) * 8, y + len * 0.7, gx + (r() - 0.5) * 4, y + len);
        p.x.stroke();
      }
      p.field(i * bw + 1, y + 1, bw - 2, len - 2, 0.72, 0.55 + r() * 0.15);
      p.field(i * bw, y, bw, 1.5, 0.45, 0.8);
      y += len;
    }
    p.field(i * bw, 0, 1.5, S, 0.4, 0.85);
  }
  p.noise(seed * 5, 0.04, 64);
  return p.build(2.0);
}

/** Square ceramic floor tiles with grout. One tile = 1.6 m (4 x 4 tiles). */
export function tileTex(seed = 4, light = true): TexSet {
  // grout close to the tile colour: dark thin lines shimmer when the camera moves
  const p = new Painter(light ? '#b7b0a4' : '#4a4a4c');
  const r = rng(seed);
  const n = 4, t = S / n, g = 6;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const l = light ? 78 + r() * 8 : 32 + r() * 8;
      p.x.fillStyle = light ? hsl(36, 10 + r() * 6, l) : hsl(210, 6, l);
      p.x.fillRect(i * t + g / 2, j * t + g / 2, t - g, t - g);
      // marbling
      for (let k = 0; k < 6; k++) {
        p.x.strokeStyle = `rgba(${light ? '90,80,70' : '200,200,210'},${0.05 + r() * 0.08})`;
        p.x.lineWidth = 1 + r() * 2;
        p.x.beginPath();
        p.x.moveTo(i * t + r() * t, j * t + r() * t);
        p.x.quadraticCurveTo(i * t + r() * t, j * t + r() * t, i * t + r() * t, j * t + r() * t);
        p.x.stroke();
      }
      p.field(i * t + g / 2, j * t + g / 2, t - g, t - g, 0.8, 0.25 + r() * 0.1);
    }
  p.noise(seed * 3, 0.03, 32);
  return p.build(1.6);
}

/** White glazed metro tiles (half bond). One tile = 1.2 m. */
export function subwayTex(seed = 5): TexSet {
  const p = new Painter('#c4c0b6');
  const r = rng(seed);
  const rows = 16, tw = S / 4, th = S / rows, g = 4;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? tw / 2 : 0;
    for (let x = -tw; x < S + tw; x += tw) {
      p.x.fillStyle = hsl(40, 12, 86 + r() * 6);
      p.x.fillRect(x + off + g / 2, row * th + g / 2, tw - g, th - g);
      p.field(x + off + g / 2, row * th + g / 2, tw - g, th - g, 0.82, 0.3);
    }
  }
  p.noise(seed * 9, 0.06, 16, 0.12);
  return p.build(1.6);
}

/** Speckled granite slabs. One tile = 2.4 m (4 x 4 slabs). */
export function graniteTex(seed = 6): TexSet {
  const p = new Painter('#3d3b39');
  const r = rng(seed);
  const n = 4, t = S / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      p.x.fillStyle = hsl(25, 4, 30 + r() * 8);
      p.x.fillRect(i * t + 1, j * t + 1, t - 2, t - 2);
      p.field(i * t + 1, j * t + 1, t - 2, t - 2, 0.75, 0.35);
    }
  // soft mottling rather than single-pixel speckles (those shimmer in motion)
  for (let k = 0; k < 2200; k++) {
    const v = r();
    p.x.fillStyle = v < 0.5 ? 'rgba(15,15,15,0.18)' : v < 0.85 ? 'rgba(200,195,190,0.16)' : 'rgba(150,110,90,0.2)';
    p.x.beginPath();
    p.x.arc(r() * S, r() * S, 2 + r() * 4, 0, Math.PI * 2);
    p.x.fill();
  }
  // a yellow safety line along one edge of the tile set
  p.x.fillStyle = '#d9b21f';
  p.x.fillRect(0, S - 22, S, 14);
  p.field(0, S - 22, S, 14, 0.85, 0.6);
  return p.build(2.5);
}

/** Board-formed concrete with pores. One tile = 3 m. */
export function concreteTex(seed = 7): TexSet {
  const p = new Painter('#a6a29a');
  const r = rng(seed);
  p.noise(seed * 3, 0.3, 4, 0.2);
  for (let k = 0; k < 1400; k++) {
    const x = r() * S, y = r() * S, s = 1 + r() * 2.5;
    p.x.fillStyle = 'rgba(40,38,35,0.2)';
    p.x.fillRect(x, y, s + 1, s + 1);
    p.field(x, y, s + 1, s + 1, 0.4, 0.95);
  }
  for (let y = 0; y < S; y += S / 6) p.field(0, y, S, 1, 0.3, 0.95);
  return p.build(1.6);
}

/** Woven upholstery / carpet. */
export function fabricTex(seed = 8): TexSet {
  // soft, low-contrast weave: a fine hard checker would shimmer when moving
  const p = new Painter('#d8d8d8');
  for (let y = 0; y < S; y += 16)
    for (let x = 0; x < S; x += 16) {
      const on = ((x + y) / 16) % 2 === 0;
      p.x.fillStyle = on ? '#dcdcdc' : '#d2d2d2';
      p.x.fillRect(x, y, 16, 16);
    }
  p.noise(seed, 0.25, 32, 0.12);
  p.r.fill(0.95);
  return p.build(0.8);
}

/** Brushed metal. */
export function metalTex(seed = 9): TexSet {
  const p = new Painter('#c9ccd0');
  const r = rng(seed);
  for (let y = 0; y < S; y++) {
    p.x.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},255,${r() * 0.06})`;
    p.x.fillRect(0, y, S, 1);
  }
  p.noise(seed, 0.05, 8, 0.08);
  p.r.fill(0.35);
  return p.build(0.6);
}

/**
 * Patches a standard material to read a per-vertex `bake` attribute:
 * x = ambient occlusion (scales sky light), y = light from nearby lamps.
 * This is a cheap stand-in for lightmaps: rooms get lit corners and lamp pools
 * without any extra real-time lights.
 */
export function bakeLit<T extends THREE.MeshStandardMaterial>(m: T, lamp = new THREE.Color(1.0, 0.85, 0.64)): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lampColor = { value: lamp };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 bake;\nvarying vec2 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBake;\nuniform vec3 lampColor;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= vBake.x;
        reflectedLight.indirectSpecular *= vBake.x;
        reflectedLight.directDiffuse += diffuseColor.rgb * vBake.y * lampColor;`);
  };
  m.customProgramCacheKey = () => 'bake';
  return m;
}
