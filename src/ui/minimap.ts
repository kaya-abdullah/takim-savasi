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
    // metro tunnel under the street (dashed outline), drawn below the buildings
    g.save();
    g.strokeStyle = 'rgba(90,209,255,.7)';
    g.fillStyle = 'rgba(90,209,255,.12)';
    g.setLineDash([4, 3]);
    g.lineWidth = 1.5;
    for (const r of map.structures.tunnel) {
      g.fillRect(this.X(r.x0), this.Z(r.z0), (r.x1 - r.x0) * this.sx, (r.z1 - r.z0) * this.sz);
      g.strokeRect(this.X(r.x0), this.Z(r.z0), (r.x1 - r.x0) * this.sx, (r.z1 - r.z0) * this.sz);
    }
    g.restore();
    for (const b of map.buildings) {
      // walk-in buildings are warm-coloured with a lighter interior
      g.fillStyle = b.enter ? '#c9a66b' : '#8a95a6';
      g.fillRect(this.X(b.x0), this.Z(b.z0), (b.x1 - b.x0) * this.sx, (b.z1 - b.z0) * this.sz);
      if (b.enter) {
        g.fillStyle = '#4a3f30';
        g.fillRect(this.X(b.x0 + 0.6), this.Z(b.z0 + 0.6), (b.x1 - b.x0 - 1.2) * this.sx, (b.z1 - b.z0 - 1.2) * this.sz);
      }
    }
    // metro entrances
    g.font = 'bold 9px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of map.structures.pits) {
      const cx = this.X((p.x0 + p.x1) / 2), cz = this.Z((p.z0 + p.z1) / 2);
      g.fillStyle = '#1f5fbf';
      g.fillRect(cx - 6, cz - 6, 12, 12);
      g.fillStyle = '#fff';
      g.fillText('M', cx, cz + 0.5);
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
    const pc: Record<string, string> = { health: '#3dff7a', damage: '#ff3b3b', speed: '#3dd8ff', airdrop: '#ffc533' };
    for (const q of m.pickups) {
      const x = this.X(q.pos.x), y = this.Z(q.pos.z);
      g.fillStyle = pc[q.kind];
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      if (q.kind === 'airdrop') {
        // pulsing star for the supply drop
        const r = 11 + Math.sin(m.time * 6) * 2;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r * 0.45 : r;
          if (k) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
      } else {
        g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y);
      }
      g.closePath();
      g.stroke();
      g.fill();
    }
    for (const v of m.vehicles) {
      if (!v.alive || v.owner.team !== p.team || v.driver === p) continue;
      g.fillStyle = '#ffd84a';
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.X(v.pos.x), this.Z(v.pos.z), 6, 0, Math.PI * 2);
      g.stroke();
      g.fill();
      g.fillStyle = '#000';
      g.fillText(v.kind === 'tank' ? 'T' : 'U', this.X(v.pos.x), this.Z(v.pos.z) + 0.5);
    }
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
