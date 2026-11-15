import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { audio } from './core/audio';
import { Input } from './core/input';
import { loadSave, writeSave, type SaveData, type Settings } from './core/save';
import { getWeapon } from './data/weapons';
import { buyWeapon, equipWeapon, formatTL, KILL_REWARD, matchBonus } from './game/economy';
import { Match, type HitInfo, type Projectile } from './game/match';
import type { Combatant } from './game/combatant';
import { PlayerController } from './game/player';
import { CharacterView } from './render/character';
import { Effects } from './render/effects';
import { makeEnvMap, makeLights, makeSky, updateSun, type Lights } from './render/env';
import { renderWeaponIcons } from './render/icons';
import { UI } from './ui/ui';
import { Minimap } from './ui/minimap';
import { buildWorld } from './world/build3d';
import { CollisionWorld } from './world/collision';
import { createMap, mapColliders, type MapData } from './world/map';
import { NavGrid } from './world/navgrid';

type State = 'loading' | 'menu' | 'playing' | 'paused' | 'end';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class Game {
  state: State = 'loading';
  save: SaveData = loadSave();
  readonly canvas = document.getElementById('c') as HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 900);
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  lights!: Lights;
  effects = new Effects();
  input: Input;
  ui: UI;
  map!: MapData;
  world!: CollisionWorld;
  nav!: NavGrid;
  match: Match | null = null;
  ctrl: PlayerController;
  minimap!: Minimap;
  envMap: THREE.Texture | null = null;
  private last = performance.now();
  private menuT = 0;
  private projMeshes = new Map<Projectile, THREE.Mesh>();
  private projGeo = new THREE.SphereGeometry(1, 12, 8);
  private killMoney = 0;
  private flashT = 0;
  private crossT = 0;
  private enemyUnderCross = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 60;
  private lowFpsT = 0;
  private dprScale = 1;
  private hadLock = false;
  private shopFrom: State = 'menu';
  private trailT = 0;
  private endTimer: number | null = null;
  frames = 0;
  errors: string[] = [];

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new Input(document.getElementById('touch')!, this.canvas);
    this.ctrl = new PlayerController(this.camera);
    this.ui = new UI(document.getElementById('ui')!, {
      play: () => this.startMatch(),
      again: () => this.startMatch(),
      openShop: () => this.openShop(),
      closeShop: () => this.closeShop(),
      buy: (id) => this.buy(id),
      equip: (id) => this.equip(id),
      settings: (s) => this.changeSettings(s),
      pause: () => this.pause(),
      resume: () => this.resume(),
      quit: () => this.toMenu(),
      switchWeapon: () => this.switchWeapon(),
    }, this.input);
    audio.enabled = this.save.settings.sound;
  }

  async boot(): Promise<void> {
    const step = () => new Promise((r) => setTimeout(r, 0));
    this.ui.loading(0.1, 'Harita hazırlanıyor...');
    await step();
    this.map = createMap();
    const boxes = mapColliders(this.map);
    this.world = new CollisionWorld(boxes, this.map.minX, this.map.minZ, this.map.maxX, this.map.maxZ);
    this.nav = new NavGrid(this.map.minX, this.map.minZ, this.map.maxX, this.map.maxZ, boxes);
    this.ui.loading(0.3, 'Şehir inşa ediliyor...');
    await step();
    this.scene.add(makeSky());
    this.lights = makeLights(this.scene);
    this.scene.add(buildWorld(this.map));
    this.scene.add(this.effects.group);
    this.ui.loading(0.6, 'Işıklar yakılıyor...');
    await step();
    this.envMap = makeEnvMap(this.renderer);
    this.scene.environment = this.envMap;
    this.applyQuality();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.ui.loading(0.75, 'Silahlar hazırlanıyor...');
    await step();
    this.ui.icons = renderWeaponIcons(this.renderer, this.envMap);
    this.minimap = new Minimap(this.ui.minimap, this.map);
    this.ui.loading(0.9, 'Gölgeler derleniyor...');
    await step();
    // warm up shader compilation with characters present so the first match doesn't hitch
    const warm = [new CharacterView('blue', true), new CharacterView('red', true)];
    warm.forEach((w, i) => { w.setWeapon(getWeapon('rifle')); w.root.position.set(i * 2, 0, 0); this.scene.add(w.root); });
    this.renderer.compile(this.scene, this.camera);
    this.render();
    warm.forEach((w) => this.scene.remove(w.root));
    this.ui.loading(1, 'Hazır!');
    this.bindGlobal();
    this.toMenu();
    this.ui.hideLoading();
    requestAnimationFrame((t) => this.frame(t));
  }

  private bindGlobal(): void {
    window.addEventListener('keydown', (e) => {
      if (this.state === 'playing' && e.code === 'KeyB') this.openShop();
      else if (e.code === 'Escape' && this.state === 'paused' && !this.ui.root.querySelector('#shop.on')) this.resume();
      if (this.state === 'playing' && e.code === 'KeyQ') this.switchWeapon();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) this.hadLock = true;
      else if (this.hadLock && this.state === 'playing') this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        audio.suspend();
      } else audio.resume();
    });
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('backButton', () => {
        if (this.ui.root.querySelector('#shop.on')) this.closeShop();
        else if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        else if (this.state === 'end') this.toMenu();
        else void App.minimizeApp();
      });
    }).catch(() => {});
  }

  // ------------------------------------------------------------------ quality
  applyQuality(): void {
    const q = this.save.settings.quality;
    const r = this.renderer;
    const mobile = this.input.isTouch;
    const maxDpr = q === 'low' ? 1 : q === 'medium' ? (mobile ? 1.25 : 1.5) : 2;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr) * this.dprScale);
    const shadows = q !== 'low';
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    const size = q === 'high' ? 2048 : 1024;
    const sh = this.lights.sun.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      sh.map?.dispose();
      sh.map = null;
    }
    this.lights.sun.castShadow = shadows;
    if (q === 'low') {
      this.composer?.dispose();
      this.composer = null;
      this.bloom = null;
    } else {
      this.composer?.dispose();
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : mobile ? 0 : 2 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.88);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.scene.fog = this.scene.fog; // keep
    this.onResize();
  }

  onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      // bloom at reduced resolution is much cheaper and looks the same
      this.bloom?.setSize(Math.ceil((w * this.renderer.getPixelRatio()) / 2), Math.ceil((h * this.renderer.getPixelRatio()) / 2));
    }
  }

  // ------------------------------------------------------------------ flow
  toMenu(): void {
    if (this.endTimer !== null) { clearTimeout(this.endTimer); this.endTimer = null; }
    this.clearMatch();
    this.state = 'menu';
    this.input.enabled = false;
    this.input.reset();
    this.input.exitPointerLock();
    document.getElementById('touch')!.style.display = 'none';
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this.ui.showMenu(this.save);
  }

  private clearMatch(): void {
    if (!this.match) return;
    for (const c of this.match.combatants) if (c.view) this.scene.remove(c.view.root);
    for (const m of this.projMeshes.values()) this.scene.remove(m);
    this.projMeshes.clear();
    this.effects.clear();
    this.match = null;
  }

  startMatch(): void {
    if (this.endTimer !== null) { clearTimeout(this.endTimer); this.endTimer = null; }
    audio.unlock();
    audio.click();
    this.clearMatch();
    const m = new Match(this.map, this.world, this.nav, this.save.equipped, {
      shot: (c, hit, def) => this.onShot(c, hit, def.projectile ? null : def.tracer, def.id, !!def.projectile),
      projectileFired: (p) => this.onProjectile(p),
      explosion: (pos, r) => this.onExplosion(pos, r),
      damage: (v, a, amt, head) => this.onDamage(v, a, amt, head),
      kill: (e) => this.onKill(e),
      respawn: (c) => { if (c.isPlayer) this.ui.death(false); },
      end: (w) => this.onEnd(w),
    });
    this.match = m;
    for (const c of m.combatants) {
      c.view = new CharacterView(c.team, !c.isPlayer);
      c.view.setWeapon(c.weapon.def);
      c.view.root.position.copy(c.pos);
      this.scene.add(c.view.root);
    }
    this.ctrl.attach(m.player, this.save.owned);
    this.killMoney = 0;
    this.state = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.input.aimToggle = false;
    document.getElementById('touch')!.style.display = 'block';
    this.ui.showHud(this.input.isTouch, m.killLimit);
    this.input.requestPointerLock();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.hadLock = false;
    this.input.exitPointerLock();
    this.ui.openPause(this.save.settings);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.ui.closePause();
    this.ui.closeShop();
    this.state = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.input.requestPointerLock();
    this.last = performance.now();
  }

  openShop(): void {
    audio.unlock();
    audio.click();
    this.shopFrom = this.state;
    if (this.state === 'playing') {
      this.pause();
      this.ui.closePause();
    }
    this.ui.openShop(this.save, this.state === 'paused' || this.state === 'end');
  }

  closeShop(): void {
    audio.click();
    this.ui.closeShop();
    if (this.state === 'paused' && this.shopFrom === 'playing') this.resume();
    else if (this.state === 'menu') this.ui.showMenu(this.save);
  }

  buy(id: string): void {
    const r = buyWeapon(this.save, id);
    if (r === 'ok') {
      writeSave(this.save);
      audio.buy();
      this.ui.toast(`${getWeapon(id).name} senin! Kuşanıldı.`);
      this.applyEquip(id);
    } else if (r === 'no-money') this.ui.toast('Yeterli paran yok!');
    this.ui.renderShop(this.save);
  }

  equip(id: string): void {
    if (equipWeapon(this.save, id)) {
      writeSave(this.save);
      audio.click();
      this.applyEquip(id);
    }
    this.ui.renderShop(this.save);
  }

  private applyEquip(id: string): void {
    if (!this.match) return;
    this.ctrl.owned = [...this.save.owned];
    this.ctrl.equip(this.match.player, id);
  }

  switchWeapon(): void {
    if (this.state !== 'playing' || !this.match) return;
    const id = this.ctrl.cycle(this.match.player);
    audio.click();
    this.ui.popup(getWeapon(id).name, 'kill');
  }

  changeSettings(s: Partial<Settings>): void {
    const prevQ = this.save.settings.quality;
    Object.assign(this.save.settings, s);
    audio.enabled = this.save.settings.sound;
    writeSave(this.save);
    if (s.quality && s.quality !== prevQ) {
      this.dprScale = 1;
      this.applyQuality();
    }
  }

  // ------------------------------------------------------------------ events
  private listenerPan(p: THREE.Vector3): { dist: number; pan: number } {
    const cam = this.camera;
    _v.copy(p).sub(cam.position);
    const dist = _v.length();
    _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    return { dist, pan: dist > 0.01 ? _v.dot(_v2) / dist : 0 };
  }

  private onShot(c: Combatant, hit: HitInfo, tracer: number | null, wid: string, isProjectile: boolean): void {
    if (!isProjectile) {
      const from = c.view ? c.view.muzzle(_v.clone()) : c.aimOrigin.clone();
      // the player's tracer is drawn from the muzzle to the crosshair point
      this.effects.tracer(from, hit.point, tracer ?? 0xffd27a, c.isPlayer ? 0.03 : 0.022, c.isPlayer ? 0.06 : 0.08);
      this.effects.muzzleFlash(from, wid === 'shotgun' || wid === 'sniper' ? 0.7 : 0.45);
      const s = this.listenerPan(from);
      audio.shot(c.weapon.def.sound, c.isPlayer ? 0 : s.dist, c.isPlayer ? 0 : s.pan);
      if (c.isPlayer) {
        this.ctrl.onShot(c);
        this.effects.shake = Math.min(1, this.effects.shake + c.weapon.def.recoil * 2);
        this.lights.flash.position.copy(from);
        this.flashT = 0.05;
      }
    }
    if (hit.victim) {
      this.effects.sparkBurst(hit.point, null, hit.victim.team === 'blue' ? 0x6fb0ff : 0xff6a4a, 7, 4);
    } else if (hit.normal) {
      this.effects.sparkBurst(hit.point, hit.normal, isProjectile ? (tracer ?? 0x6bfffa) : 0xffd27a, isProjectile ? 14 : 5, 6);
      if (Math.random() < 0.6) this.effects.puff(_v.copy(hit.point).addScaledVector(hit.normal, 0.1), 0.35, 0xbdb5a6, 0.6, 0.4);
    }
    if (isProjectile) {
      const s = this.listenerPan(hit.point);
      if (s.dist < 30) audio.hit();
    }
  }

  private onProjectile(p: Projectile): void {
    const spec = p.def.projectile!;
    const mesh = new THREE.Mesh(this.projGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.color).multiplyScalar(4), toneMapped: false }));
    mesh.scale.setScalar(spec.radius);
    mesh.position.copy(p.pos);
    this.scene.add(mesh);
    this.projMeshes.set(p, mesh);
    const from = p.owner.view ? p.owner.view.muzzle(_v.clone()) : p.pos.clone();
    this.effects.muzzleFlash(from, 0.6);
    const s = this.listenerPan(from);
    audio.shot(p.def.sound, p.owner.isPlayer ? 0 : s.dist, p.owner.isPlayer ? 0 : s.pan);
    if (p.owner.isPlayer) {
      this.ctrl.onShot(p.owner);
      this.effects.shake = Math.min(1, this.effects.shake + p.def.recoil * 2);
    }
  }

  private onExplosion(pos: THREE.Vector3, r: number): void {
    this.effects.explosion(pos, r);
    const s = this.listenerPan(pos);
    audio.explosion(s.dist, s.pan);
    if (s.dist < 25) this.effects.shake = Math.min(1.2, this.effects.shake + (1 - s.dist / 25) * 0.8);
    this.lights.flash.position.copy(pos);
    this.lights.flash.position.y += 1;
    this.flashT = 0.15;
  }

  private onDamage(v: Combatant, a: Combatant, _amt: number, head: boolean): void {
    if (v.isPlayer) {
      const ang = Math.atan2(a.pos.x - v.pos.x, a.pos.z - v.pos.z);
      // screen angle relative to view direction (0 = in front, clockwise positive)
      let rel = v.yaw - ang;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      this.ui.damageFrom(rel);
      audio.hurt();
      this.effects.shake = Math.min(1, this.effects.shake + 0.25);
    } else if (a.isPlayer && v.alive) {
      this.ui.hitmark(head ? 'head' : 'hit');
      if (head) audio.headshot();
      else audio.hit();
    }
  }

  private onKill(e: { killer: Combatant; victim: Combatant; head: boolean; weapon: { name: string } }): void {
    const m = this.match!;
    this.ui.feed(e as never, m.player);
    if (e.killer.isPlayer) {
      this.save.money += KILL_REWARD;
      this.save.totalKills++;
      this.killMoney += KILL_REWARD;
      writeSave(this.save);
      this.ui.hitmark('kill');
      this.ui.popup(`+${formatTL(KILL_REWARD)}`);
      this.ui.popup(e.head ? `KAFADAN! ${e.victim.name}` : `LEŞ: ${e.victim.name}`, 'kill');
      audio.kill();
      setTimeout(() => audio.coin(), 120);
    }
  }

  private onEnd(w: 'blue' | 'red' | 'draw'): void {
    const m = this.match!;
    const res = w === 'blue' ? 'win' : w === 'red' ? 'lose' : 'draw';
    const bonus = matchBonus(res);
    this.save.money += bonus;
    this.save.matches++;
    if (res === 'win') this.save.wins++;
    writeSave(this.save);
    if (res === 'win') audio.win();
    else audio.lose();
    this.input.enabled = false;
    this.input.reset();
    m.player.trigger = false;
    this.endTimer = window.setTimeout(() => {
      this.endTimer = null;
      if (this.match !== m) return;
      this.state = 'end';
      this.hadLock = false;
      this.input.exitPointerLock();
      document.getElementById('touch')!.style.display = 'none';
      this.ui.showEnd({
        winner: w, score: { ...m.score }, kills: m.player.kills, deaths: m.player.deaths, killMoney: this.killMoney,
        bonus, rank: m.playerRank(), combatants: m.combatants, player: m.player,
      }, this.save.money);
    }, 1800);
  }

  // ------------------------------------------------------------------ loop
  private frame(t: number): void {
    requestAnimationFrame((tt) => this.frame(tt));
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    try {
      this.tick(dt);
    } catch (err) {
      // never let one bad frame kill the loop; record for diagnostics
      const msg = String((err as Error)?.stack ?? err);
      if (this.errors.length < 20) this.errors.push(msg);
      console.error(err);
    }
  }

  private tick(dt: number): void {
    this.frames++;
    const m = this.match;
    if (m && this.state === 'playing') {
      // after the match ends (end screen pending) this still drives the camera
      this.ctrl.update(dt, m.player, this.input, m, this.save.settings);
      if (this.ctrl.reloaded) audio.reload();
      if (this.ctrl.jumped) audio.jump();
      m.update(dt);
    }
    if (m && this.state !== 'menu') {
      this.syncViews(dt, m);
      if (this.state === 'playing') this.updateHud(dt, m);
    } else {
      // menu: slow cinematic orbit over the city
      this.menuT += dt * 0.05;
      const a = this.menuT + 0.6;
      this.camera.position.set(Math.cos(a) * 62, 26 + Math.sin(this.menuT * 2) * 3, Math.sin(a) * 48);
      this.camera.lookAt(0, 4, 0);
    }
    // shake
    if (this.effects.shake > 0 && this.state === 'playing') {
      const s = this.effects.shake * 0.06;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.3;
    }
    this.effects.update(dt);
    this.flashT -= dt;
    this.lights.flash.intensity = this.flashT > 0 ? 40 : 0;
    const focus = m && this.state !== 'menu' ? m.player.pos : _v.set(0, 0, 0);
    updateSun(this.lights, focus);
    this.render();
    this.measureFps();
  }

  private syncViews(dt: number, m: Match): void {
    const f = _v, r = _v2;
    for (const c of m.combatants) {
      const v = c.view;
      if (!v) continue;
      v.root.position.copy(c.pos);
      v.root.rotation.y = c.yaw;
      const speed = Math.hypot(c.vx, c.vz);
      f.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      r.set(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
      v.setShield(c.shieldT);
      v.update(dt, {
        speed,
        fwd: speed > 0.1 ? (c.vx * f.x + c.vz * f.z) / speed : 0,
        side: speed > 0.1 ? (c.vx * r.x + c.vz * r.z) / speed : 0,
        pitch: c.pitch,
        airborne: !c.onGround,
        kick: c.kick,
        reloading: c.weapon.reloading,
      });
      // hide own body when the scope is up or the camera is squeezed against a wall
      if (c.isPlayer && c.alive) {
        const scoped = c.aiming && c.weapon.def.zoom < 0.5;
        v.root.visible = !scoped && this.camera.position.distanceTo(_v.set(c.pos.x, c.pos.y + 1.5, c.pos.z)) > 0.9;
      }
    }
    // projectiles
    this.trailT -= dt;
    const trail = this.trailT <= 0;
    if (trail) this.trailT = 0.03;
    for (const [p, mesh] of this.projMeshes) {
      if (!p.alive) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.projMeshes.delete(p);
        continue;
      }
      mesh.position.copy(p.pos);
      if (trail) {
        if (p.def.projectile!.splash > 0) this.effects.puff(p.pos, 0.35, 0xd8d0c4, 0.7, 0.2);
        else this.effects.sparkBurst(p.pos, null, p.def.projectile!.color, 2, 1);
      }
    }
  }

  private updateHud(dt: number, m: Match): void {
    const p = m.player;
    this.crossT -= dt;
    if (this.crossT <= 0 && p.alive) {
      this.crossT = 0.1;
      const h = m.hitscan(p, p.aimOrigin, p.aimDir, p.weapon.def.range * 2);
      this.enemyUnderCross = !!h.victim;
    }
    const w = p.weapon;
    this.ui.updateHud({
      blue: m.score.blue, red: m.score.red, limit: m.killLimit, timeLeft: m.duration - m.time,
      hp: p.hp, ammo: w.ammo, mag: w.def.mag, weapon: w.def.name,
      reloadFrac: w.reloading ? 1 - w.reloadT / w.def.reload : 0,
      money: this.save.money, aiming: p.aiming, scope: p.alive && p.aiming && w.def.zoom < 0.5,
      enemyUnderCross: this.enemyUnderCross, owned: this.save.owned.length, dt,
    });
    if (!p.alive) this.ui.death(true, p.lastAttacker?.name ?? '', p.respawnT);
    else this.ui.death(false);
    this.minimap.draw(m, dt);
  }

  private render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private measureFps(): void {
    // wall-clock based: dt is clamped and would hide slow frames
    const now = performance.now();
    if (this.fpsAcc === 0) this.fpsAcc = now;
    this.fpsFrames++;
    if (now - this.fpsAcc >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsAcc);
      this.fpsAcc = now;
      this.fpsFrames = 0;
      // adaptive resolution: drop render scale if the device struggles
      if (this.state === 'playing' && this.fps < 40) this.lowFpsT++;
      else this.lowFpsT = 0;
      if (this.lowFpsT >= 3 && this.dprScale > 0.6) {
        this.dprScale -= 0.15;
        this.lowFpsT = 0;
        this.renderer.setPixelRatio(this.renderer.getPixelRatio() * ((this.dprScale) / (this.dprScale + 0.15)));
        this.onResize();
      }
    }
  }
}

const game = new Game();
// Exposed for automated tests and debugging.
(window as unknown as { __game: Game }).__game = game;
window.addEventListener('error', (e) => game.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => game.errors.push(String(e.reason)));
game.boot().catch((e) => {
  game.errors.push(String(e?.stack ?? e));
  const el = document.getElementById('ldtxt');
  if (el) el.textContent = 'Hata: ' + String(e?.message ?? e);
  console.error(e);
});
