import type { Match } from '../game/match';
import type { MapData } from '../world/map';

/** Background resolution (pixels per metre of the pre-rendered city). */
const S = 2;
/** Metres of city shown across the minimap's width (it follows the player). */
const VIEW = 120;

/** Top-down minimap: static layer pre-rendered once, a window round the player drawn each frame. */
export class Minimap {
  private bg: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sx = S;
  private sz = S;
  private acc = 0;
  /** Screen pixels per metre and the window centre (world) for this frame. */
  private k: number;
  private cx = 0;
  private cz = 0;

  constructor(private canvas: HTMLCanvasElement, private map: MapData) {
    this.ctx = canvas.getContext('2d')!;
    this.k = canvas.width / VIEW;
    this.bg = document.createElement('canvas');
    this.bg.width = Math.ceil((map.maxX - map.minX) * S);
    this.bg.height = Math.ceil((map.maxZ - map.minZ) * S);
    const g = this.bg.getContext('2d')!;
    g.fillStyle = '#26303d';
    g.fillRect(0, 0, this.bg.width, this.bg.height);
    const zc: Record<string, string> = { grass: '#2f4a2c', gravel: '#3d3a35', lot: '#30343b' };
    for (const z of map.zones) {
      g.fillStyle = zc[z.kind];
      g.fillRect(this.X(z.x0), this.Z(z.z0), (z.x1 - z.x0) * this.sx, (z.z1 - z.z0) * this.sz);
    }
    g.fillStyle = '#3a4352';
    for (const r of map.roads) g.fillRect(this.X(r.x0), this.Z(r.z0), (r.x1 - r.x0) * this.sx, (r.z1 - r.z0) * this.sz);
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
    // walk-in buildings: storey count on the footprint
    g.fillStyle = '#ffe2a8';
    g.font = 'bold 12px sans-serif';
    for (const h of map.structures.houses) {
      const roof = map.structures.levels.filter((l) => l.name.endsWith('-roof') && l.rect.x0 > h.x0 - 0.5 && l.rect.x1 < h.x1 + 0.5 && l.rect.z0 > h.z0 - 0.5 && l.rect.z1 < h.z1 + 0.5);
      const floors = roof.length ? Math.round(roof[0].y / 3.5) : 2;
      if (floors > 2) g.fillText(String(floors), this.X((h.x0 + h.x1) / 2), this.Z((h.z0 + h.z1) / 2));
    }
  }

  /** Background-canvas pixel of a world point. */
  private X(x: number): number { return (x - this.map.minX) * this.sx; }
  private Z(z: number): number { return (z - this.map.minZ) * this.sz; }
  /** Minimap pixel of a world point (window centred on the player). */
  private U(x: number): number { return (x - this.cx) * this.k + this.canvas.width / 2; }
  private V(z: number): number { return (z - this.cz) * this.k + this.canvas.height / 2; }

  draw(m: Match, dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / 20) return; // 20 Hz is plenty
    this.acc = 0;
    const g = this.ctx;
    const p = m.player;
    const W = this.canvas.width, H = this.canvas.height;
    this.cx = p.pos.x;
    this.cz = p.pos.z;
    g.fillStyle = '#1b222c';
    g.fillRect(0, 0, W, H);
    const sw = (W / this.k) * S, sh = (H / this.k) * S;
    g.drawImage(this.bg, this.X(this.cx) - sw / 2, this.Z(this.cz) - sh / 2, sw, sh, 0, 0, W, H);
    const pc: Record<string, string> = { health: '#3dff7a', damage: '#ff3b3b', speed: '#3dd8ff', airdrop: '#ffc533', bandage: '#ff8a8a' };
    for (const q of m.pickups) {
      let x = this.U(q.pos.x), y = this.V(q.pos.z);
      // the supply drop stays on the edge of the map when it is out of view
      if (q.kind === 'airdrop') { x = Math.min(W - 12, Math.max(12, x)); y = Math.min(H - 12, Math.max(12, y)); }
      else if (x < -8 || y < -8 || x > W + 8 || y > H + 8) continue;
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
      } else if (q.kind === 'bandage') {
        // small red-cross plus for a bandage
        const a = 2, b = 6;
        g.moveTo(x - a, y - b); g.lineTo(x + a, y - b); g.lineTo(x + a, y - a); g.lineTo(x + b, y - a); g.lineTo(x + b, y + a); g.lineTo(x + a, y + a);
        g.lineTo(x + a, y + b); g.lineTo(x - a, y + b); g.lineTo(x - a, y + a); g.lineTo(x - b, y + a); g.lineTo(x - b, y - a); g.lineTo(x - a, y - a);
      } else {
        g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y);
      }
      g.closePath();
      g.stroke();
      g.fill();
    }
    // the metro train under the avenue
    const tx = m.train.x, half = 7;
    g.lineCap = 'round';
    g.strokeStyle = '#0b1220';
    g.lineWidth = 8;
    g.beginPath(); g.moveTo(this.U(tx - half), this.V(0)); g.lineTo(this.U(tx + half), this.V(0)); g.stroke();
    g.strokeStyle = m.train.state === 'moving' ? '#5ad1ff' : '#e9edf2';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(this.U(tx - half), this.V(0)); g.lineTo(this.U(tx + half), this.V(0)); g.stroke();
    g.lineCap = 'butt';
    for (const v of m.vehicles) {
      if (!v.alive || v.owner.team !== p.team || v.driver === p) continue;
      g.fillStyle = '#ffd84a';
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.U(v.pos.x), this.V(v.pos.z), 6, 0, Math.PI * 2);
      g.stroke();
      g.fill();
      g.fillStyle = '#000';
      g.fillText(v.kind === 'tank' ? 'T' : 'U', this.U(v.pos.x), this.V(v.pos.z) + 0.5);
    }
    for (const c of m.combatants) {
      if (!c.alive || c === p) continue;
      const ally = c.team === p.team;
      // enemies only show briefly after firing (like a radar ping)
      if (!ally && m.time - c.lastShotT > 1.2) continue;
      g.fillStyle = ally ? '#4fa3ff' : '#ff4a3d';
      g.beginPath();
      g.arc(this.U(c.pos.x), this.V(c.pos.z), ally ? 5 : 6, 0, Math.PI * 2);
      g.fill();
    }
    if (p.alive) {
      const x = this.U(p.pos.x), y = this.V(p.pos.z);
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
