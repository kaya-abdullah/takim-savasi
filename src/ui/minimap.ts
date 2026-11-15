import type { Match } from '../game/match';
import type { MapData } from '../world/map';

/** Top-down minimap: static layer pre-rendered once, dots drawn each frame. */
export class Minimap {
  private bg: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sx: number;
  private sz: number;
  private acc = 0;

  constructor(canvas: HTMLCanvasElement, private map: MapData) {
    this.ctx = canvas.getContext('2d')!;
    this.sx = canvas.width / (map.maxX - map.minX);
    this.sz = canvas.height / (map.maxZ - map.minZ);
    this.bg = document.createElement('canvas');
    this.bg.width = canvas.width;
    this.bg.height = canvas.height;
    const g = this.bg.getContext('2d')!;
    g.fillStyle = '#26303d';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#3a4352';
    for (const r of map.roads) g.fillRect(this.X(r.x0), this.Z(r.z0), (r.x1 - r.x0) * this.sx, (r.z1 - r.z0) * this.sz);
    g.fillStyle = 'rgba(61,139,255,0.35)';
    g.fillRect(this.X(-70), this.Z(-25), 14 * this.sx, 50 * this.sz);
    g.fillStyle = 'rgba(255,77,77,0.35)';
    g.fillRect(this.X(56), this.Z(-25), 14 * this.sx, 50 * this.sz);
    for (const b of map.buildings) {
      g.fillStyle = '#8a95a6';
      g.fillRect(this.X(b.x0), this.Z(b.z0), (b.x1 - b.x0) * this.sx, (b.z1 - b.z0) * this.sz);
    }
    g.fillStyle = '#6b7280';
    for (const p of map.props) {
      if (p.kind === 'tree' || p.kind === 'lamp') continue;
      g.fillRect(this.X(p.x) - 2, this.Z(p.z) - 2, 4, 4);
    }
  }

  private X(x: number): number { return (x - this.map.minX) * this.sx; }
  private Z(z: number): number { return (z - this.map.minZ) * this.sz; }

  draw(m: Match, dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / 20) return; // 20 Hz is plenty
    this.acc = 0;
    const g = this.ctx;
    g.drawImage(this.bg, 0, 0);
    const p = m.player;
    for (const c of m.combatants) {
      if (!c.alive || c === p) continue;
      const ally = c.team === p.team;
      // enemies only show briefly after firing (like a radar ping)
      if (!ally && m.time - c.lastShotT > 1.2) continue;
      g.fillStyle = ally ? '#4fa3ff' : '#ff4a3d';
      g.beginPath();
      g.arc(this.X(c.pos.x), this.Z(c.pos.z), ally ? 5 : 6, 0, Math.PI * 2);
      g.fill();
    }
    if (p.alive) {
      const x = this.X(p.pos.x), y = this.Z(p.pos.z);
      // yaw: forward = (sin, cos) in (x, z)
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      g.save();
      g.translate(x, y);
      g.rotate(Math.atan2(fz, fx) - Math.PI / 2);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 40, Math.PI / 2 - 0.6, Math.PI / 2 + 0.6);
      g.fill();
      g.fillStyle = '#ffcc33';
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 12);
      g.lineTo(-8, -8);
      g.lineTo(0, -3);
      g.lineTo(8, -8);
      g.closePath();
      g.stroke();
      g.fill();
      g.restore();
    }
  }
}
