import * as THREE from 'three';
import { makeRadial, makeSmoke } from './textures';

interface Tracer { mesh: THREE.Mesh; life: number; max: number; }
interface SpriteFx { s: THREE.Sprite; life: number; max: number; vel: THREE.Vector3; grow: number; startScale: number; fade: number; rotV: number; }

const MAX_SPARKS = 700;
const MAX_CASINGS = 60;
const MAX_DECALS = 90;
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

function holeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,10,10,1)');
  g.addColorStop(0.25, 'rgba(25,22,20,0.95)');
  g.addColorStop(0.5, 'rgba(60,55,50,0.45)');
  g.addColorStop(1, 'rgba(60,55,50,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    x.rotate(Math.PI / 3);
    const g = x.createLinearGradient(0, 0, 60, 0);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.5, 'rgba(255,170,60,0.6)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, -7); x.lineTo(60, 0); x.lineTo(0, 7);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pooled visual effects: tracers, muzzle flashes, sparks, smoke, explosions. */
export class Effects {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private flashes: SpriteFx[] = [];
  private smokes: SpriteFx[] = [];
  private fires: SpriteFx[] = [];
  private sparkPos = new Float32Array(MAX_SPARKS * 3);
  private sparkCol = new Float32Array(MAX_SPARKS * 3);
  private sparkVel = new Float32Array(MAX_SPARKS * 3);
  private sparkLife = new Float32Array(MAX_SPARKS);
  private sparkBase = new Float32Array(MAX_SPARKS * 3);
  private sparkIdx = 0;
  private sparks: THREE.Points;
  private tracerGeo: THREE.BoxGeometry;
  shake = 0;
  // brass casings
  private casings: THREE.InstancedMesh;
  private cPos = new Float32Array(MAX_CASINGS * 3);
  private cVel = new Float32Array(MAX_CASINGS * 3);
  private cRot = new Float32Array(MAX_CASINGS * 2);
  private cLife = new Float32Array(MAX_CASINGS);
  private cIdx = 0;
  // bullet holes
  private decals: THREE.InstancedMesh;
  private dIdx = 0;
  // 3D muzzle flashes (crossed star planes)
  private stars: { m: THREE.Mesh; life: number }[] = [];

  constructor() {
    this.group.name = 'effects';
    const cg = new THREE.CylinderGeometry(0.0065, 0.0065, 0.028, 8);
    this.casings = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0xd8a13a, metalness: 1, roughness: 0.28 }), MAX_CASINGS);
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casings.frustumCulled = false;
    _m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_CASINGS; i++) this.casings.setMatrixAt(i, _m4);
    this.group.add(this.casings);
    const dg = new THREE.PlaneGeometry(0.13, 0.13);
    this.decals = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({
      map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }), MAX_DECALS);
    this.decals.frustumCulled = false;
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, _m4);
    this.group.add(this.decals);
    const st = starTexture();
    const sg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: st, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(2.2, 2, 1.6) });
      const m = new THREE.Mesh(sg, mat);
      const m2 = new THREE.Mesh(sg, mat);
      m2.rotation.y = Math.PI / 2;
      m.add(m2);
      m.visible = false;
      this.group.add(m);
      this.stars.push({ m, life: 0 });
    }
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerGeo.translate(0, 0, 0.5);
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(this.tracerGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 1 });
    }
    const flashTex = makeRadial('rgba(255,255,240,1)', 'rgba(255,140,30,0)');
    const fireTex = makeRadial('rgba(255,230,160,1)', 'rgba(255,80,10,0)');
    const smokeTex = makeSmoke();
    const mk = (tex: THREE.Texture, additive: boolean, n: number, list: SpriteFx[]) => {
      for (let i = 0; i < n; i++) {
        const mat = new THREE.SpriteMaterial({
          map: tex, transparent: true, depthWrite: false, toneMapped: !additive,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        const s = new THREE.Sprite(mat);
        s.visible = false;
        this.group.add(s);
        list.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 0, startScale: 1, fade: 1, rotV: 0 });
      }
    };
    mk(flashTex, true, 24, this.flashes);
    mk(fireTex, true, 40, this.fires);
    mk(smokeTex, false, 60, this.smokes);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkPos.fill(-9999);
    const dot = makeRadial('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32);
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.09, map: dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.025, life = 0.07): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, len);
    (t.mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(4);
    t.mesh.visible = true;
    t.life = t.max = life;
  }

  muzzleFlash(at: THREE.Vector3, size = 0.45): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.s.position.copy(at);
    f.startScale = size * (0.8 + Math.random() * 0.5);
    f.s.scale.setScalar(f.startScale);
    f.s.material.rotation = Math.random() * Math.PI;
    f.s.material.opacity = 1;
    f.s.visible = true;
    f.life = f.max = 0.05;
    f.vel.set(0, 0, 0);
    f.grow = 0;
    f.fade = 1;
  }

  /** Side-on star flash at the muzzle, aligned with the shot direction. */
  muzzleStar(at: THREE.Vector3, dir: THREE.Vector3, size = 0.5): void {
    const f = this.stars.find((x) => x.life <= 0) ?? this.stars[0];
    f.m.position.copy(at);
    f.m.quaternion.setFromUnitVectors(_z, dir);
    f.m.rotateY(Math.PI / 2);
    f.m.scale.set(size * 1.6, size * (0.8 + Math.random() * 0.4), 1);
    f.m.visible = true;
    f.life = 0.045;
  }

  /** Ejects a brass casing to the right of the shooter. */
  casing(at: THREE.Vector3, right: THREE.Vector3): void {
    const k = this.cIdx;
    this.cIdx = (this.cIdx + 1) % MAX_CASINGS;
    this.cPos.set([at.x, at.y, at.z], k * 3);
    const sp = 1.6 + Math.random() * 1.2;
    this.cVel.set([right.x * sp + (Math.random() - 0.5) * 0.6, 1.8 + Math.random() * 1.2, right.z * sp + (Math.random() - 0.5) * 0.6], k * 3);
    this.cRot.set([Math.random() * 6, Math.random() * 6], k * 2);
    this.cLife[k] = 3.5;
  }

  /** Bullet hole on a wall/ground, oriented to the surface. */
  decal(at: THREE.Vector3, normal: THREE.Vector3): void {
    _q.setFromUnitVectors(_z, normal);
    _p.copy(at).addScaledVector(normal, 0.01);
    const sc = 0.7 + Math.random() * 0.6;
    _s.set(sc, sc, sc);
    _m4.compose(_p, _q, _s);
    this.decals.setMatrixAt(this.dIdx, _m4);
    this.dIdx = (this.dIdx + 1) % MAX_DECALS;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Burst of additive particles. */
  sparkBurst(at: THREE.Vector3, normal: THREE.Vector3 | null, color: number, n = 8, speed = 6): void {
    const c = new THREE.Color(color).multiplyScalar(2.5);
    for (let i = 0; i < n; i++) {
      const k = this.sparkIdx;
      this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
      this.sparkPos[k * 3] = at.x;
      this.sparkPos[k * 3 + 1] = at.y;
      this.sparkPos[k * 3 + 2] = at.z;
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      if (normal) { vx += normal.x * 1.5; vy += normal.y * 1.5; vz += normal.z * 1.5; }
      const sp = speed * (0.4 + Math.random() * 0.8);
      const l = Math.hypot(vx, vy, vz) || 1;
      this.sparkVel[k * 3] = (vx / l) * sp;
      this.sparkVel[k * 3 + 1] = (vy / l) * sp + 1.5;
      this.sparkVel[k * 3 + 2] = (vz / l) * sp;
      this.sparkLife[k] = 0.25 + Math.random() * 0.35;
      this.sparkBase[k * 3] = c.r; this.sparkBase[k * 3 + 1] = c.g; this.sparkBase[k * 3 + 2] = c.b;
    }
  }

  puff(at: THREE.Vector3, size = 0.6, color = 0xcfc8bc, life = 0.8, up = 0.6): void {
    const f = this.smokes.find((x) => x.life <= 0) ?? this.smokes[Math.floor(Math.random() * this.smokes.length)];
    f.s.position.copy(at);
    f.startScale = size;
    f.s.scale.setScalar(size);
    f.s.material.color.set(color);
    f.s.material.opacity = 0.7;
    f.s.material.rotation = Math.random() * 6;
    f.rotV = (Math.random() - 0.5) * 1.5;
    f.s.visible = true;
    f.life = f.max = life * (0.8 + Math.random() * 0.4);
    f.vel.set((Math.random() - 0.5) * 0.6, up, (Math.random() - 0.5) * 0.6);
    f.grow = size * 1.6;
    f.fade = 0.7;
  }

  explosion(at: THREE.Vector3, radius: number): void {
    for (let i = 0; i < 10; i++) {
      const f = this.fires.find((x) => x.life <= 0);
      if (!f) break;
      f.s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * radius * 0.5, Math.random() * radius * 0.4, (Math.random() - 0.5) * radius * 0.5));
      f.startScale = radius * (0.5 + Math.random() * 0.5);
      f.s.scale.setScalar(f.startScale);
      f.s.material.opacity = 1;
      f.s.material.rotation = Math.random() * 6;
      f.s.visible = true;
      f.life = f.max = 0.35 + Math.random() * 0.25;
      f.vel.set((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4);
      f.grow = radius * 0.8;
      f.fade = 1;
      f.rotV = (Math.random() - 0.5) * 3;
    }
    for (let i = 0; i < 9; i++) {
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius * 0.6, Math.random() * radius * 0.4, (Math.random() - 0.5) * radius * 0.6));
      this.puff(p, radius * 0.6, 0x4a4540, 1.8, 1.5);
    }
    this.sparkBurst(at, new THREE.Vector3(0, 1, 0), 0xffa040, 40, 14);
  }

  get active(): number {
    return this.tracers.filter((t) => t.life > 0).length;
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const m = t.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const list of [this.flashes, this.fires, this.smokes]) {
      for (const f of list) {
        if (f.life <= 0) continue;
        f.life -= dt;
        if (f.life <= 0) { f.s.visible = false; continue; }
        const k = 1 - f.life / f.max;
        f.s.position.addScaledVector(f.vel, dt);
        f.vel.multiplyScalar(1 - dt * 1.5);
        f.s.scale.setScalar(f.startScale + f.grow * k);
        f.s.material.opacity = f.fade * (1 - k);
        f.s.material.rotation += f.rotV * dt;
      }
    }
    for (let k = 0; k < MAX_SPARKS; k++) {
      if (this.sparkLife[k] <= 0) continue;
      this.sparkLife[k] -= dt;
      if (this.sparkLife[k] <= 0) {
        this.sparkPos[k * 3 + 1] = -9999;
        continue;
      }
      this.sparkVel[k * 3 + 1] -= 14 * dt;
      this.sparkPos[k * 3] += this.sparkVel[k * 3] * dt;
      this.sparkPos[k * 3 + 1] += this.sparkVel[k * 3 + 1] * dt;
      this.sparkPos[k * 3 + 2] += this.sparkVel[k * 3 + 2] * dt;
      if (this.sparkPos[k * 3 + 1] < 0.02) { this.sparkPos[k * 3 + 1] = 0.02; this.sparkVel[k * 3 + 1] *= -0.3; }
      const f = Math.min(1, this.sparkLife[k] * 4);
      this.sparkCol[k * 3] = this.sparkBase[k * 3] * f;
      this.sparkCol[k * 3 + 1] = this.sparkBase[k * 3 + 1] * f;
      this.sparkCol[k * 3 + 2] = this.sparkBase[k * 3 + 2] * f;
    }
    (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    for (const f of this.stars) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.m.visible = false;
    }
    let anyCasing = false;
    for (let k = 0; k < MAX_CASINGS; k++) {
      if (this.cLife[k] <= 0) continue;
      anyCasing = true;
      this.cLife[k] -= dt;
      const i = k * 3;
      if (this.cLife[k] <= 0) {
        _m4.makeScale(0, 0, 0);
        this.casings.setMatrixAt(k, _m4);
        continue;
      }
      this.cVel[i + 1] -= 14 * dt;
      this.cPos[i] += this.cVel[i] * dt;
      this.cPos[i + 1] += this.cVel[i + 1] * dt;
      this.cPos[i + 2] += this.cVel[i + 2] * dt;
      if (this.cPos[i + 1] < 0.007) {
        // tinkle and roll to a stop on the ground
        this.cPos[i + 1] = 0.007;
        this.cVel[i + 1] *= -0.35;
        this.cVel[i] *= 0.6;
        this.cVel[i + 2] *= 0.6;
        this.cRot[k * 2] = Math.PI / 2;
      } else {
        this.cRot[k * 2] += dt * 18;
        this.cRot[k * 2 + 1] += dt * 11;
      }
      _q.setFromEuler(new THREE.Euler(this.cRot[k * 2], this.cRot[k * 2 + 1], 0));
      _s.set(1, 1, 1);
      _p.set(this.cPos[i], this.cPos[i + 1], this.cPos[i + 2]);
      _m4.compose(_p, _q, _s);
      this.casings.setMatrixAt(k, _m4);
    }
    if (anyCasing) this.casings.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    _m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, _m4);
    this.decals.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_CASINGS; i++) { this.cLife[i] = 0; this.casings.setMatrixAt(i, _m4); }
    this.casings.instanceMatrix.needsUpdate = true;
    for (const f of this.stars) { f.life = 0; f.m.visible = false; }
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const list of [this.flashes, this.fires, this.smokes]) for (const f of list) { f.life = 0; f.s.visible = false; }
    this.sparkLife.fill(0);
    this.sparkPos.fill(-9999);
  }
}
