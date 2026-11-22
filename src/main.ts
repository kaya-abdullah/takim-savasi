import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { audio } from './core/audio';
import { Input } from './core/input';
import { FrameCap } from './core/framecap';
import { LOADOUT_SIZE, cleanName, loadSave, writeSave, type SaveData, type Settings } from './core/save';
import { ALL_WEAPONS, getWeapon } from './data/weapons';
import { makeWeaponMesh } from './render/weaponModel';
import { canSpin, spinWheel, applyMatchResult, putInLoadout, buyUpgrade, buyVehicle, buyWeapon, sellVehicle, sellWeapon, equipWeapon, formatTL, grenadeCount, killReward, maxHp, streakReward, UPGRADES, type UpgradeId } from './game/economy';
import { BANDAGE_CARRY, BANDAGE_HEAL, BANDAGE_TIME, Match, type Drop, type Grenade, type HitInfo, type PickupKind, type Projectile, type ThrownKnife } from './game/match';
import { HEAVY_CD, VEHICLE_DEFS, type VehicleKind } from './data/vehicles';
import type { WeaponDef } from './data/weapons';
import type { Vehicle } from './game/vehicle';
import { VehicleView } from './render/vehicleModel';
import { TrainView } from './render/trainModel';
import { TUNNEL } from './world/structures';
import type { Combatant } from './game/combatant';
import { PlayerController } from './game/player';
import { CharacterView, loadHumans, makeKnife } from './render/character';
import { Effects } from './render/effects';
import { ambient, makeEnvMap, makeLights, makeSky, setupToneMapping, updateSun, type Lights } from './render/env';
import { renderWeaponIcons } from './render/icons';
import { UI, type MenuExtras } from './ui/ui';
import { PickupViews, PICKUP_NAMES } from './render/pickups';
import { APK_URL, SITE_URL, VERSION, VERSION_CODE } from './version';
import { Capacitor } from '@capacitor/core';
import { Minimap } from './ui/minimap';
import { Online, type StartInfo } from './net/online';
import { TrysteroTransport } from './net/trystero';
import { buildWorld, updateInteriors } from './world/build3d';
import type { CollisionWorld } from './world/collision';
import { buildPhysics, createMap, type MapData } from './world/map';
import type { NavWorld } from './world/navworld';

type State = 'loading' | 'menu' | 'playing' | 'paused' | 'end';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

class Game {
  state: State = 'loading';
  save: SaveData = loadSave();
  readonly canvas = document.getElementById('c') as HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 900);
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  private finish: ShaderPass | null = null;
  /** Ambient motion clock (clouds, leaves); tests freeze it. */
  readonly ambient = ambient;
  lights!: Lights;
  effects = new Effects();
  input: Input;
  ui: UI;
  map!: MapData;
  world!: CollisionWorld;
  nav!: NavWorld;
  match: Match | null = null;
  ctrl: PlayerController;
  minimap!: Minimap;
  envMap: THREE.Texture | null = null;
  private last = performance.now();
  private menuT = 0;
  private projMeshes = new Map<Projectile, THREE.Mesh>();
  private projGeo = new THREE.SphereGeometry(1, 12, 8);
  private grenadeMeshes = new Map<Grenade, THREE.Group>();
  private grenadeGeo = new THREE.SphereGeometry(0.09, 14, 10);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3f5a2a, roughness: 0.5, metalness: 0.4 });
  private arcDots!: THREE.InstancedMesh;
  private arcPts = Array.from({ length: 44 }, () => new THREE.Vector3());
  private arcRing!: THREE.Mesh;
  private pickupViews = new PickupViews();
  private dropViews = new Map<Drop, THREE.Group>();
  private vehicleViews = new Map<Vehicle, VehicleView>();
  private trainView: TrainView | null = null;
  /** The player was told the doors are closing (once per boarding). */
  private trainWarned = false;
  /** Last enemy the player hurt, for the target health bar. */
  private target: { c: Combatant; t: number } | null = null;
  /** Weapons picked up during the current match (lost when it ends): they sit in the backpack. */
  private matchInv: string[] = [];
  /** The three hand slots in this match (may hold picked-up weapons). */
  private loadout: string[] = [];
  /** Backpack: being taken off / open on screen / being put back. */
  bagState: 'opening' | 'open' | 'closing' | null = null;
  /** Slot the next weapon chosen in the backpack goes into. */
  private bagSlot = 0;
  private knifeMeshes = new Map<ThrownKnife, THREE.Group>();
  private worldRoot: THREE.Object3D | null = null;
  private update: MenuExtras['update'];
  private readonly native = Capacitor.isNativePlatform();
  private killMoney = 0;
  /** Explosion flash: time left and its peak. */
  private flashT = 0;
  private flashDur = 0.1;
  private flashPeak = 0;
  /** Gunfire glow: a held trigger keeps a steady, softly rising light instead of a per-shot strobe. */
  private fireGlowT = 0;
  private fireGlow = 0;

  /** Explosion light; a stronger flash is never cut short by a weaker one. */
  private flash(dur: number, peak: number): void {
    const now = this.flashPeak * (this.flashT / this.flashDur) ** 2;
    if (now > peak) return;
    this.flashT = this.flashDur = dur;
    this.flashPeak = peak;
  }
  private crossT = 0;
  private enemyUnderCross = false;
  private frameCap = new FrameCap();
  /** Online room (null: playing alone against bots). */
  online: Online | null = null;
  private onlineRoom = 1;
  private netBox: HTMLDivElement | null = null;
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
  private shadowEvery = 1;
  errors: string[] = [];

  constructor() {
    // Native MSAA is the cheapest anti-aliasing on phones (used when post-processing is off).
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    setupToneMapping(this.renderer);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new Input(document.getElementById('touch')!, this.canvas);
    this.ctrl = new PlayerController(this.camera);
    this.ui = new UI(document.getElementById('ui')!, {
      play: () => this.startMatch(),
      online: () => this.startOnline(),
      setName: (n) => this.setName(n),
      again: () => {
        // online: join the room's next match (nobody is pulled in without pressing this)
        if (this.online) { this.showNet('Yeni maç bekleniyor…'); this.online.again(); }
        else this.startMatch();
      },
      openShop: () => this.openShop(),
      closeShop: () => this.closeShop(),
      buy: (id) => this.buy(id),
      buyUpgrade: (id) => this.buyUpgrade(id),
      equip: (id) => this.equip(id),
      settings: (s) => this.changeSettings(s),
      pause: () => this.pause(),
      resume: () => this.resume(),
      quit: () => this.quit(),
      switchWeapon: () => this.toggleBag(),
      bagPick: (id) => this.bagPick(id),
      bagSlot: (i) => this.bagSelectSlot(i),
      bagClose: () => this.closeBag(),
      spin: () => {
        const i = spinWheel(this.save);
        if (i >= 0) { writeSave(this.save); audio.unlock(); audio.siren(); setTimeout(() => audio.buy(), 4300); }
        return i;
      },
      openLink: (url) => { window.location.href = url; },
      selectWeapon: (id) => this.selectWeapon(id),
      buyVehicle: (kind) => this.buyVehicle(kind),
      sell: (id) => this.sell(id),
      sellVehicle: (kind) => this.sellVehicle(kind),
    }, this.input);
    audio.enabled = this.save.settings.sound;
  }

  async boot(): Promise<void> {
    const step = () => new Promise((r) => setTimeout(r, 0));
    this.ui.loading(0.1, 'Harita hazırlanıyor...');
    await step();
    this.map = createMap();
    const phys = buildPhysics(this.map);
    this.world = phys.world;
    this.nav = phys.nav;
    this.ui.loading(0.3, 'Şehir inşa ediliyor...');
    await step();
    this.scene.add(makeSky());
    this.lights = makeLights(this.scene);
    this.worldRoot = buildWorld(this.map);
    this.scene.add(this.worldRoot);
    this.scene.add(this.effects.group);
    this.arcDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.6), toneMapped: false }), this.arcPts.length);
    this.arcDots.frustumCulled = false;
    this.arcDots.visible = false;
    this.scene.add(this.arcDots);
    this.scene.add(this.pickupViews.group);
    const ringGeo = new THREE.RingGeometry(5.1, 5.5, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.arcRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.5, 0.3), transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
    this.arcRing.visible = false;
    this.scene.add(this.arcRing);
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
    this.ui.loading(0.82, 'Askerler hazırlanıyor...');
    await loadHumans();
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
    void this.checkUpdate();
    this.ui.hideLoading();
    requestAnimationFrame((t) => this.frame(t));
  }

  private wakeLock: { release(): Promise<void> } | null = null;

  /** Keeps the phone screen from dimming/locking during a match (web; the APK uses a window flag). */
  private async keepAwake(on: boolean): Promise<void> {
    try {
      const nav = navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
      if (on && !this.wakeLock && nav.wakeLock && document.visibilityState === 'visible') {
        this.wakeLock = await nav.wakeLock.request('screen');
        (this.wakeLock as unknown as EventTarget).addEventListener?.('release', () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch { /* not supported or refused: harmless */ }
  }

  private bindGlobal(): void {
    // Phones can drop the WebGL context under memory pressure: the canvas turns black.
    // Progress is saved, so the safest recovery is a quick reload.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      diag('webglcontextlost');
      if (this.state === 'playing') this.pause();
      this.ui.toast('Grafik yeniden başlatılıyor...');
      setTimeout(() => location.reload(), 1500);
    });
    window.addEventListener('keydown', (e) => {
      if (this.state === 'playing' && e.code === 'KeyB') this.openShop();
      else if (e.code === 'Escape' && this.state === 'paused' && !this.ui.root.querySelector('#shop.on')) this.resume();
      if (this.state === 'playing' && (e.code === 'KeyQ' || e.code === 'Tab')) { e.preventDefault(); this.toggleBag(); }
      else if (this.state === 'playing' && e.code === 'Escape' && this.bagState) this.closeBag();
      if (this.state === 'playing' && /^Digit[1-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5)) - 1;
        if (this.bagState === 'open') this.bagSelectSlot(n);
        else {
          const id = this.inventoryIds()[n];
          if (id) this.selectWeapon(id);
        }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) this.hadLock = true;
      else if (this.hadLock && this.state === 'playing' && !this.bagState) this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        audio.suspend();
      } else {
        audio.resume();
        if (this.match) void this.keepAwake(true);
      }
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

  /** Installed app: ask the website which version is current. */
  private async checkUpdate(): Promise<void> {
    if (!this.native) return;
    try {
      const r = await fetch(SITE_URL + 'version.json?t=' + Date.now(), { cache: 'no-store' });
      const v = (await r.json()) as { version: string; code: number; apk: string };
      if (typeof v.code === 'number' && v.code > VERSION_CODE) {
        this.update = { version: String(v.version), url: String(v.apk || APK_URL) };
        if (this.state === 'menu') this.ui.showMenu(this.save, this.menuExtras());
      }
    } catch { /* offline: try again next launch */ }
  }

  private menuExtras(): MenuExtras {
    const ua = navigator.userAgent;
    return {
      update: this.update,
      androidUrl: !this.native && /Android/i.test(ua) ? APK_URL : undefined,
      iosHint: !this.native && /iPhone|iPad/i.test(ua) && !(navigator as unknown as { standalone?: boolean }).standalone,
      canSpin: canSpin(this.save),
      version: VERSION,
    };
  }

  // ------------------------------------------------------------------ quality
  applyQuality(): void {
    const q = this.save.settings.quality;
    const r = this.renderer;
    const mobile = this.input.isTouch;
    // low: 1x, no shadows. medium (phone default): native MSAA, no post-processing,
    // shadows refreshed every other frame. high: bloom + 4x MSAA post chain.
    const maxDpr = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr) * this.dprScale);
    const shadows = q !== 'low';
    const soft = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (r.shadowMap.enabled !== shadows || r.shadowMap.type !== soft) {
      r.shadowMap.enabled = shadows;
      r.shadowMap.type = soft;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    const size = q === 'high' && !mobile ? 4096 : 2048;
    const sh = this.lights.sun.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      sh.map?.dispose();
      sh.map = null;
    }
    this.lights.sun.castShadow = shadows;
    this.shadowEvery = q === 'high' ? 1 : 2;
    sh.autoUpdate = this.shadowEvery === 1;
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.finish = null;
    if (q === 'high') {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Safety net: a single NaN/Inf pixel would be smeared into big black blocks by bloom.
      this.composer.addPass(new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv);
            if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
            gl_FragColor = min(c, vec4(64.0)); }`,
      }));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.55, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      // camera finish in display space: faint lens fringing towards the edges and fine film grain
      this.finish = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          void main(){
            vec2 d = vUv - 0.5;
            vec2 off = d * dot(d, d) * 0.006;
            vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
            float n = h(vUv * 1024.0 + fract(time) * 97.0) - 0.5;
            c += n * 0.022 * (1.0 - dot(c, vec3(0.3)));
            gl_FragColor = vec4(c, 1.0); }`,
      });
      this.composer.addPass(this.finish);
    }
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
    this.leaveOnline();
    void this.keepAwake(false);
    if (this.endTimer !== null) { clearTimeout(this.endTimer); this.endTimer = null; }
    this.clearMatch();
    this.state = 'menu';
    this.input.enabled = false;
    this.input.reset();
    this.input.exitPointerLock();
    document.getElementById('touch')!.style.display = 'none';
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this.ui.showMenu(this.save, this.menuExtras());
  }

  private clearMatch(): void {
    if (!this.match) return;
    for (const c of this.match.combatants) {
      if (!c.view) continue;
      this.scene.remove(c.view.root);
      c.view.dispose();
    }
    for (const mesh of this.projMeshes.values()) (mesh.material as THREE.Material).dispose();
    for (const m of this.projMeshes.values()) this.scene.remove(m);
    this.projMeshes.clear();
    for (const g of this.grenadeMeshes.values()) this.scene.remove(g);
    this.grenadeMeshes.clear();
    for (const g of this.knifeMeshes.values()) this.scene.remove(g);
    this.knifeMeshes.clear();
    this.forceCloseBag();
    this.arcDots.visible = this.arcRing.visible = false;
    this.pickupViews.clear();
    for (const g of this.dropViews.values()) this.scene.remove(g);
    this.dropViews.clear();
    for (const v of this.vehicleViews.values()) { this.scene.remove(v.root); v.dispose(); }
    this.vehicleViews.clear();
    if (this.trainView) { this.scene.remove(this.trainView.root); this.trainView.dispose(); this.trainView = null; }
    audio.engine(null, 0);
    this.target = null;
    this.effects.clear();
    this.match = null;
  }

  // ------------------------------------------------------------------ online
  /** The name chosen in the menu; before one is chosen: MUSTAFA alone, a numbered soldier online. */
  private onlineName(): string {
    if (this.save.name) return this.save.name;
    let n = '';
    try { n = localStorage.getItem('ts3d-name') ?? ''; } catch { /* private mode */ }
    if (!n) {
      n = `Asker${100 + Math.floor(Math.random() * 900)}`;
      try { localStorage.setItem('ts3d-name', n); } catch { /* private mode */ }
    }
    return n;
  }

  setName(name: string): void {
    this.save.name = cleanName(name);
    writeSave(this.save);
    if (this.state === 'menu') this.ui.showMenu(this.save, this.menuExtras());
  }

  startOnline(): void {
    // the first time online: choose a name others will see
    if (!this.save.name) {
      this.ui.askName('', (n) => { this.setName(n); if (this.save.name) this.startOnline(); });
      return;
    }
    audio.unlock();
    audio.click();
    this.leaveOnline();
    this.showNet('Oda aranıyor…');
    // ?oda=isim in the address: a private room for friends (and the tests)
    let priv = '';
    try { priv = (new URLSearchParams(location.search).get('oda') ?? '').replace(/[^\w-]/g, '').slice(0, 24); } catch { /* no location */ }
    const tr = new TrysteroTransport(priv ? `${priv}-${this.onlineRoom}` : String(this.onlineRoom));
    // the constructor already reports its status: `on` must exist before it runs
    let on: Online | null = null;
    on = new Online(tr, this.onlineName(), {
      start: (info) => {
        if (this.online !== on) return;
        this.hideNet();
        this.startMatch(info);
      },
      end: () => {},
      status: (t) => { if ((!on || this.online === on) && !this.match) this.showNet(t); },
      full: () => {
        // this room holds 20 people: try the next one
        if (this.online !== on || this.onlineRoom >= 5) return;
        this.onlineRoom++;
        this.startOnline();
      },
    });
    this.online = on;
  }

  private leaveOnline(): void {
    this.hideNet();
    if (!this.online) return;
    this.online.leave();
    this.online = null;
    this.onlineRoom = 1;
  }

  private showNet(text: string): void {
    if (!this.netBox) {
      const d = document.createElement('div');
      d.className = 'net-wait';
      d.innerHTML = '<div class="panel"><div class="spin"></div><p></p><button class="btn" data-a="cancel">VAZGEÇ</button></div>';
      d.querySelector('button')!.onclick = () => this.toMenu();
      document.getElementById('ui')!.appendChild(d);
      this.netBox = d;
    }
    this.netBox.querySelector('p')!.textContent = text;
    this.netBox.style.display = '';
  }

  private hideNet(): void {
    if (this.netBox) this.netBox.style.display = 'none';
  }

  startMatch(net?: StartInfo): void {
    if (this.endTimer !== null) { clearTimeout(this.endTimer); this.endTimer = null; }
    audio.unlock();
    audio.click();
    // the offline "play" button leaves any room
    if (!net) this.leaveOnline();
    this.ui.closePause();
    this.ui.closeShop();
    this.clearMatch();
    const m = new Match(this.map, this.world, this.nav, this.save.equipped, {
      pickupSpawned: (p) => {
        if (p.kind !== 'airdrop') return;
        this.ui.banner('HAVA İKMALİ!', 'Haritadaki ★ işaretine koş');
        audio.siren();
      },
      pickedUp: (c, p, w) => this.onPickup(c, p.kind, w),
      bandage: (c, done) => {
        if (!c.isPlayer) return;
        if (done) { audio.powerup(); this.ui.popup(`+${BANDAGE_HEAL} CAN`, 'kill'); }
        else this.ui.popup('BANDAJ SARILIYOR…', 'kill');
      },
      weaponFound: (c, d) => {
        const have = this.bagIds().includes(d.def.id);
        const better = d.def.price > c.weapon.def.price;
        const where = this.addToInventory(d.def.id, !have && better);
        this.ctrl.refill(d.def.id);
        audio.pickupGun();
        this.ui.popup(have ? `${d.def.name}: mermi doldu` : where === 'bag' ? `+ ${d.def.name} · ÇANTADA` : `+ ${d.def.name}`, 'kill');
      },
      knifeThrown: (k) => {
        k.owner.view?.knifeThrowAnim();
        const s = this.listenerPan(k.pos);
        if (s.dist < 25) audio.whoosh();
      },
      knifeLanded: (k, v) => {
        const s = this.listenerPan(k.pos);
        if (v) {
          if (s.dist < 30) audio.stab();
          this.effects.sparkBurst(_v.set(k.pos.x, v.pos.y + 1.2, k.pos.z), null, v.team === 'blue' ? 0x6fb0ff : 0xff6a4a, 10, 3);
        } else {
          audio.clink(s.dist, s.pan);
          this.effects.sparkBurst(k.pos, null, 0xffe0a0, 6, 2);
        }
      },
      knifeBack: (c, picked) => {
        if (!c.isPlayer) return;
        if (picked) { audio.pickupGun(); this.ui.popup('BIÇAĞINI ALDIN', 'kill'); }
        else this.ui.popup('YENİ BIÇAK', 'kill');
      },
      grenadeThrown: (g) => { g.owner.view?.throwAnim(); const s = this.listenerPan(g.pos); if (s.dist < 25) audio.whoosh(); },
      grenadeBounce: (g) => { const s = this.listenerPan(g.pos); audio.clink(s.dist, s.pan); },
      melee: (c, v, back) => this.onMelee(c, v, back),
      shot: (c, hit, def) => this.onShot(c, hit, def),
      projectileFired: (p) => this.onProjectile(p),
      explosion: (pos, r) => this.onExplosion(pos, r),
      damage: (v, a, amt, head) => this.onDamage(v, a, amt, head),
      kill: (e) => this.onKill(e),
      respawn: (c) => {
        if (!c.isPlayer) return;
        this.forceCloseBag();
        this.ui.death(false);
        this.ctrl.refillAll();
      },
      end: (w) => this.onEnd(w),
      vehicleSpawned: (v) => { if (v.owner.isPlayer) audio.horn(); },
      vehicleDamaged: (v, a, amt) => {
        if (v.driver?.isPlayer) {
          const ang = Math.atan2(a.pos.x - v.pos.x, a.pos.z - v.pos.z);
          let rel = v.driver.yaw - ang;
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          this.ui.damageFrom(rel);
          if (amt >= 20) this.effects.shake = Math.min(1, this.effects.shake + 0.15);
        }
      },
      vehicleDestroyed: (v, a) => {
        const at = v.center(new THREE.Vector3());
        this.effects.explosion(at, 6);
        for (let i = 0; i < 6; i++) this.effects.puff(_v.set(at.x + (Math.random() - 0.5) * 3, at.y + Math.random() * 2, at.z + (Math.random() - 0.5) * 3), 1.6, 0x2a2622, 2.5, 3);
        if (v.owner.isPlayer) {
          this.ui.banner(v.kind === 'tank' ? 'TANKIN PATLADI!' : 'UÇAĞIN DÜŞTÜ!', `${a.name} vurdu · ${VEHICLE_DEFS[v.kind].respawn} sn sonra yeniden çağır`);
          audio.lose();
        }
      },
      vehicleCrash: (v, imp) => {
        if (!v.driver?.isPlayer) return;
        audio.crash(imp);
        this.effects.shake = Math.min(1.2, this.effects.shake + Math.min(0.8, imp * 0.05));
      },
      runOver: (v) => { if (v.driver?.isPlayer) this.ui.popup('EZDİN!', 'kill'); },
      trainDepart: () => {
        const mm = this.match;
        if (mm && mm.train.aboard(mm.player)) { this.ui.popup('METRO KALKTI', 'kill'); audio.horn(); }
      },
      trainArrive: (i) => {
        const mm = this.match;
        this.trainWarned = false;
        if (mm && mm.train.aboard(mm.player)) this.ui.banner(`DURAK ${i + 1}`, 'Kapılar açıldı · inmek için kapıdan çık');
      },
    }, {
      playerGrenades: grenadeCount(this.save), playerHp: maxHp(this.save), difficulty: this.save.settings.difficulty,
      playerName: net ? this.online!.name : this.save.name || 'MUSTAFA',
      ...(net ? { slot: net.slot, seed: net.seed } : {}),
    });
    this.match = m;
    if (net) this.joinRunning(m, net);
    this.trainView = new TrainView();
    this.scene.add(this.trainView.root);
    this.trainWarned = false;
    for (const c of m.combatants) {
      c.view = new CharacterView(c.team, !c.isPlayer);
      c.view.setWeapon(c.weapon.def);
      c.view.root.position.copy(c.pos);
      this.scene.add(c.view.root);
    }
    this.matchInv = [];
    this.loadout = this.save.loadout.filter((id) => this.save.owned.includes(id)).slice(0, LOADOUT_SIZE);
    if (!this.loadout.includes(this.save.equipped)) {
      if (this.loadout.length < LOADOUT_SIZE) this.loadout.push(this.save.equipped);
      else this.loadout[0] = this.save.equipped;
    }
    this.bagState = null;
    this.bagSlot = 0;
    this.ctrl.attach(m.player, this.inventoryIds());
    this.killMoney = 0;
    this.state = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.input.aimToggle = false;
    document.getElementById('touch')!.style.display = 'block';
    this.ui.showHud(this.input.isTouch, m.killLimit);
    void this.keepAwake(true);
    this.input.requestPointerLock();
    if (net) {
      const team = m.player.team === 'blue' ? 'MAVİ' : 'KIRMIZI';
      this.ui.banner(`ÇEVRİMİÇİ · ${team} TAKIM`, `Odada ${this.online!.humans()} oyuncu · boş yerlerde botlar var`);
    }
  }

  /** Hooks the match into the room and catches up with a match already running. */
  private joinRunning(m: Match, net: StartInfo): void {
    this.online!.attach(m);
    m.time = net.time;
    m.score.blue = net.score.blue;
    m.score.red = net.score.red;
    net.kd.forEach(([k, d], i) => { const c = m.combatants[i]; if (c) { c.kills = k; c.deaths = d; } });
    for (const [id, kind, x, y, z] of net.pk) m.spawnPickup(kind, new THREE.Vector3(x, y, z), id, true);
    for (const id of net.gone) m.pickupTaken(id, null);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.hadLock = false;
    this.input.exitPointerLock();
    audio.engine(null, 0);
    this.ui.openPause(this.save.settings, this.quitCountsAsLoss());
  }

  /** Leaving while the enemy leads counts as a defeat (no dodging the penalty). */
  private quitCountsAsLoss(): boolean {
    const m = this.match;
    if (!m || m.over) return false;
    const mine = m.player.team, theirs = mine === 'blue' ? 'red' : 'blue';
    return m.score[theirs] > m.score[mine];
  }

  /** Pause-menu "main menu": applies the defeat penalty if the enemy was ahead. */
  quit(): void {
    if (this.quitCountsAsLoss()) {
      const d = applyMatchResult(this.save, 'lose');
      this.save.matches++;
      writeSave(this.save);
      this.ui.toast(`Maçtan çıktın: yenik sayıldın (${d < 0 ? '−' + formatTL(-d) : '0 TL'})`);
    }
    this.toMenu();
  }

  /** Sells a bought weapon; in a match the player switches to another gun if holding it. */
  sell(id: string): void {
    const got = sellWeapon(this.save, id);
    if (got > 0) {
      writeSave(this.save);
      audio.coin();
      this.ui.toast(`${getWeapon(id).name} satıldı: +${formatTL(got)}`);
      if (this.match) {
        const p = this.match.player;
        this.loadout = this.loadout.filter((x) => x !== id);
        if (!this.loadout.length) this.loadout = [this.save.loadout[0]];
        this.ctrl.owned = this.inventoryIds();
        if (p.weapon.def.id === id) this.ctrl.equip(p, this.loadout[0]);
      }
    }
    this.ui.renderShop(this.save);
  }

  sellVehicle(kind: VehicleKind): void {
    const m = this.match;
    if (m?.player.vehicle?.kind === kind) m.exitVehicle(m.player);
    const got = sellVehicle(this.save, kind);
    if (got > 0) {
      writeSave(this.save);
      audio.coin();
      this.ui.toast(`${VEHICLE_DEFS[kind].name} satıldı: +${formatTL(got)}`);
      // a parked one disappears from the match too
      if (m) {
        const v = m.vehicleOf(kind, m.player);
        if (v) m.vehicles.splice(m.vehicles.indexOf(v), 1);
      }
    }
    this.ui.renderShop(this.save);
  }

  buyVehicle(kind: VehicleKind): void {
    const r = buyVehicle(this.save, kind);
    if (r === 'ok') {
      writeSave(this.save);
      audio.buy();
      this.ui.toast(`${VEHICLE_DEFS[kind].name} senin! Maçta ${kind === 'tank' ? 'tank (T)' : 'uçak (Y)'} tuşuyla çağır.`);
    } else if (r === 'no-money') this.ui.toast('Yeterli paran yok!');
    this.ui.renderShop(this.save);
  }

  /** Call a vehicle (and jump in), or get in/out of the nearest one. */
  vehicleAction(kind: VehicleKind | 'toggle'): void {
    const m = this.match;
    if (!m || this.state !== 'playing') return;
    const p = m.player;
    if (!p.alive) return;
    if (this.online) { this.ui.popup('Çevrimiçi maçta tank ve uçak yok', 'kill'); return; }
    if (kind === 'toggle') {
      if (p.vehicle) { m.exitVehicle(p); audio.click(); return; }
      const v = m.nearbyVehicle(p);
      if (v && m.enterVehicle(p, v)) { audio.click(); return; }
      this.ui.popup('Yakında aracın yok', 'kill');
      return;
    }
    if (!this.save.vehicles.includes(kind)) {
      this.ui.popup(`${VEHICLE_DEFS[kind].name}: mağazadan al`, 'kill');
      return;
    }
    if (p.vehicle) {
      const was = p.vehicle.kind;
      m.exitVehicle(p);
      if (was === kind) return;
    }
    const near = m.vehicleOf(kind, p);
    if (near && !near.driver && Math.hypot(near.pos.x - p.pos.x, near.pos.z - p.pos.z) < 6 && Math.abs(near.pos.y - p.pos.y) < 2.5) {
      m.enterVehicle(p, near);
      return;
    }
    const r = m.spawnVehicle(kind, p);
    if (r === 'ok') {
      m.enterVehicle(p, m.vehicleOf(kind, p)!);
      this.ui.popup(kind === 'tank' ? 'TANKA BİNDİN' : 'UÇAĞA BİNDİN', 'kill');
    } else if (r === 'cooldown') this.ui.popup(`${Math.ceil(m.vehicleCd[kind])} sn sonra hazır`, 'kill');
    else if (r === 'blocked') this.ui.popup('Burada çağrılamaz: açık alana çık', 'kill');
    else if (r === 'busy') this.ui.popup('Önce araçtan in', 'kill');
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
    else if (this.state === 'menu') this.ui.showMenu(this.save, this.menuExtras());
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

  buyUpgrade(id: UpgradeId): void {
    const r = buyUpgrade(this.save, id);
    if (r === 'ok') {
      writeSave(this.save);
      audio.buy();
      this.ui.toast(`${UPGRADES.find((u) => u.id === id)!.name} yükseltildi!`);
      // takes effect from the next spawn / match
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

  /** Test/debug helper. */
  weaponDef(id: string) {
    return getWeapon(id);
  }

  /** The hand slots (at most three weapons). */
  inventoryIds(): string[] {
    return this.match ? [...this.loadout] : [...this.save.loadout];
  }

  /** Everything in the backpack: owned weapons in shop order, then this match's pick-ups. */
  bagIds(): string[] {
    const owned = ALL_WEAPONS.filter((w) => this.save.owned.includes(w.id)).map((w) => w.id);
    return [...owned, ...this.matchInv.filter((id) => !owned.includes(id))];
  }

  selectWeapon(id: string): void {
    if (this.state !== 'playing' || !this.match) return;
    const p = this.match.player;
    if (!this.ctrl.owned.includes(id) || p.weapon.def.id === id) return;
    this.ctrl.equip(p, id);
    audio.click();
  }

  /**
   * A weapon found in the match goes into a free hand slot, else into the
   * backpack. `toHand` (supply drops) puts it in the hand slot in use instead.
   */
  private addToInventory(id: string, autoEquip: boolean, toHand = false): 'slot' | 'bag' {
    const m = this.match!;
    if (!this.bagIds().includes(id)) this.matchInv.push(id);
    let where: 'slot' | 'bag' = 'bag';
    if (this.loadout.includes(id)) where = 'slot';
    else if (this.loadout.length < LOADOUT_SIZE) { this.loadout.push(id); where = 'slot'; }
    else if (toHand) {
      this.loadout[Math.max(0, this.loadout.indexOf(m.player.weapon.def.id))] = id;
      where = 'slot';
    }
    this.ctrl.owned = this.inventoryIds();
    if (where === 'slot' && (autoEquip || toHand)) this.ctrl.equip(m.player, id);
    if (this.bagState === 'open') this.renderBag();
    return where;
  }

  /** Shop purchase or KUŞAN during a match: the hand slots follow the saved ones. */
  private applyEquip(id: string): void {
    if (!this.match) return;
    const temps = this.loadout.filter((x) => !this.save.owned.includes(x));
    this.loadout = [...this.save.loadout];
    for (const t of temps) if (this.loadout.length < LOADOUT_SIZE) this.loadout.push(t);
    this.ctrl.owned = this.inventoryIds();
    this.ctrl.equip(this.match.player, id);
  }

  /** Quick switch to the next hand slot. */
  switchWeapon(): void {
    if (this.state !== 'playing' || !this.match || this.bagState) return;
    const id = this.ctrl.cycle(this.match.player);
    audio.click();
    this.ui.popup(getWeapon(id).name, 'kill');
  }

  // ------------------------------------------------------------------ backpack
  /** The weapon button: take the backpack off and open it, or close it again. */
  toggleBag(): void {
    if (this.bagState === 'open' || this.bagState === 'opening') this.closeBag();
    else this.openBag();
  }

  openBag(): void {
    const m = this.match;
    if (!m || this.state !== 'playing' || m.over) return;
    const p = m.player;
    if (!p.alive || p.vehicle || this.bagState === 'opening' || this.bagState === 'open') return;
    p.inBag = true;
    p.view?.setBag(true);
    this.bagState = 'opening';
    this.bagSlot = Math.max(0, this.loadout.indexOf(p.weapon.def.id));
    audio.zip();
  }

  closeBag(): void {
    const m = this.match;
    if (!m || !this.bagState || this.bagState === 'closing') return;
    this.ui.closeBag();
    m.player.view?.setBag(false);
    this.bagState = 'closing';
    audio.zip();
    this.input.requestPointerLock();
  }

  /** Instantly back to normal (death, respawn, leaving the match). */
  private forceCloseBag(): void {
    this.ui.closeBag();
    this.bagState = null;
    const p = this.match?.player;
    if (p) { p.inBag = false; p.view?.setBag(false); }
  }

  /** Advances the backpack animation and shows / hides the bag screen at its ends. */
  private updateBag(m: Match): void {
    const p = m.player;
    if (!this.bagState) return;
    if (!p.alive || m.over) { this.forceCloseBag(); return; }
    const k = p.view?.bagProgress ?? (this.bagState === 'closing' ? 0 : 1);
    if (this.bagState === 'opening' && k >= 0.999) {
      this.bagState = 'open';
      this.input.exitPointerLock();
      this.renderBag();
    } else if (this.bagState === 'closing' && k <= 0.001) {
      this.bagState = null;
      p.inBag = false;
    }
  }

  private renderBag(): void {
    const m = this.match;
    if (!m) return;
    const p = m.player;
    this.ui.openBag({
      slots: Array.from({ length: LOADOUT_SIZE }, (_, i) => {
        const id = this.loadout[i];
        return id ? { id, name: getWeapon(id).name, current: p.weapon.def.id === id } : null;
      }),
      selected: this.bagSlot,
      items: this.bagIds().map((id) => ({ id, name: getWeapon(id).name, temp: !this.save.owned.includes(id), slot: this.loadout.indexOf(id) })),
    });
  }

  /** Chooses the hand slot to fill, and takes its weapon in hand. */
  bagSelectSlot(i: number): void {
    if (this.bagState !== 'open' || i < 0 || i >= LOADOUT_SIZE) return;
    this.bagSlot = i;
    const id = this.loadout[i];
    if (id && this.match) this.ctrl.equip(this.match.player, id);
    audio.click();
    this.renderBag();
  }

  /** Puts a weapon from the backpack into the chosen slot (swapping if it is in another one) and takes it in hand. */
  bagPick(id: string): void {
    const m = this.match;
    if (!m || this.bagState !== 'open' || !this.bagIds().includes(id)) return;
    const lo = this.loadout;
    const slot = Math.min(this.bagSlot, lo.length);
    const at = lo.indexOf(id);
    if (at >= 0 && at !== slot && slot < lo.length) [lo[at], lo[slot]] = [lo[slot], lo[at]];
    else if (at < 0) {
      if (slot < lo.length) lo[slot] = id;
      else lo.push(id);
    }
    this.bagSlot = lo.indexOf(id);
    this.ctrl.owned = this.inventoryIds();
    this.ctrl.equip(m.player, id);
    // the saved hand slots follow, for weapons the player owns
    if (this.save.owned.includes(id)) {
      const keep = lo.filter((x) => this.save.owned.includes(x));
      this.save.loadout = keep.length ? keep : [this.save.owned[0]];
      putInLoadout(this.save, id);
      writeSave(this.save);
    }
    audio.pickupGun();
    this.renderBag();
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

  /** Where a fighter's shots visibly come from (gun muzzle, or the vehicle's gun/window). */
  private muzzleOf(c: Combatant, out: THREE.Vector3): THREE.Vector3 {
    const v = c.vehicle;
    if (v) {
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      if (v.kind === 'jet') return out.set(v.pos.x + fx * 2.2, v.pos.y + 0.5, v.pos.z + fz * 2.2);
      // tank: the turret follows the driver's aim, so the gun sits at its barrel tip
      return out.set(v.pos.x + Math.sin(c.yaw) * 2.4, v.pos.y + 1.75, v.pos.z + Math.cos(c.yaw) * 2.4);
    }
    return c.view ? c.view.muzzle(out) : out.copy(c.aimOrigin);
  }

  private onShot(c: Combatant, hit: HitInfo, def: WeaponDef): void {
    const isProjectile = !!def.projectile;
    const tracer = isProjectile ? null : def.tracer;
    const wid = def.id;
    if (!isProjectile) {
      const from = this.muzzleOf(c, new THREE.Vector3());
      // the player's tracer is drawn from the muzzle to the crosshair point
      this.effects.tracer(from, hit.point, tracer ?? 0xffd27a, c.isPlayer ? 0.03 : 0.022, c.isPlayer ? 0.06 : 0.08);
      this.effects.muzzleFlash(from, wid === 'shotgun' || wid === 'sniper' ? 0.7 : 0.45);
      const dir = _v2.copy(hit.point).sub(from).normalize();
      this.effects.muzzleStar(from, dir, wid === 'shotgun' || wid === 'sniper' || wid === 'lmg' ? 0.55 : 0.38);
      const s = this.listenerPan(from);
      if (s.dist < 30 && Math.random() < 1 / def.pellets && wid !== 'revolver' && !c.vehicle) {
        // brass flies out of the ejection port to the shooter's right
        const port = _v3.copy(from).addScaledVector(dir, -0.3);
        this.effects.casing(port, _v4.set(-Math.cos(c.yaw), 0, Math.sin(c.yaw)));
      }
      audio.shot(def.sound, c.isPlayer ? 0 : s.dist, c.isPlayer ? 0 : s.pan);
      if (c.isPlayer) {
        if (!c.vehicle) this.ctrl.onShot(c);
        this.effects.shake = Math.min(1, this.effects.shake + def.recoil * 2);
        // keep the light a little in front of the barrel so it never sits inside a surface
        this.lights.flash.position.copy(from).addScaledVector(dir, 0.35);
        this.fireGlowT = 0.12;
      }
    }
    if (hit.vehicle) {
      this.effects.sparkBurst(hit.point, null, 0xffd27a, 8, 5);
      if (c.isPlayer) this.ui.hitmark('hit');
    } else if (hit.victim) {
      this.effects.sparkBurst(hit.point, null, hit.victim.team === 'blue' ? 0x6fb0ff : 0xff6a4a, 7, 4);
    } else if (hit.normal) {
      this.effects.sparkBurst(hit.point, hit.normal, isProjectile ? (tracer ?? 0x6bfffa) : 0xffd27a, isProjectile ? 14 : 5, 6);
      if (!isProjectile) this.effects.decal(hit.point, hit.normal);
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
    const from = this.muzzleOf(p.owner, new THREE.Vector3());
    this.effects.muzzleFlash(from, 0.6);
    const s = this.listenerPan(from);
    audio.shot(p.def.sound, p.owner.isPlayer ? 0 : s.dist, p.owner.isPlayer ? 0 : s.pan);
    if (p.owner.isPlayer) {
      if (!p.owner.vehicle) this.ctrl.onShot(p.owner);
      this.effects.shake = Math.min(1, this.effects.shake + p.def.recoil * 2);
    }
  }

  private onExplosion(pos: THREE.Vector3, r: number): void {
    this.effects.explosion(pos, r);
    const s = this.listenerPan(pos);
    audio.explosion(s.dist, s.pan);
    if (s.dist < 25) this.effects.shake = Math.min(1.2, this.effects.shake + (1 - s.dist / 25) * 0.8);
    // A soft, short glow that fades with distance: at full strength (30) every
    // grenade on the avenue lit the road up white and read as a flashing light.
    const k = Math.max(0, 1 - s.dist / 35);
    if (k > 0 && k * 6 >= this.flashPeak * (this.flashT / Math.max(1e-3, this.flashDur)) ** 2) {
      this.lights.flash.position.copy(pos);
      this.lights.flash.position.y += 1;
      this.flash(0.3, 6 * k);
    }
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
    }
    if (a.isPlayer) {
      _v.set(v.pos.x, v.pos.y + 2.0, v.pos.z).project(this.camera);
      if (_v.z < 1) this.ui.damageNumber((_v.x * 0.5 + 0.5) * innerWidth, (-_v.y * 0.5 + 0.5) * innerHeight, _amt, v.alive ? (head ? 'head' : 'hit') : 'kill');
    }
    if (a.isPlayer && v.team !== a.team) this.target = { c: v, t: performance.now() };
    if (a.isPlayer && v.alive) {
      this.ui.hitmark(head ? 'head' : 'hit');
      if (head) audio.headshot();
      else audio.hit();
    }
  }

  private onPickup(c: Combatant, kind: PickupKind, w?: { id: string; name: string }): void {
    const s = this.listenerPan(c.pos);
    if (c.isPlayer) {
      audio.powerup();
      if (kind === 'airdrop' && w) {
        this.addToInventory(w.id, true, true);
        c.weapon.refill();
        this.ui.banner(w.name.toUpperCase() + '!', 'Süper silah · bu maç boyunca envanterinde');
      } else if (kind === 'bandage') this.ui.popup(`+1 BANDAJ (${c.bandages}/${BANDAGE_CARRY}) · ${this.input.isTouch ? 'bandaj düğmesi' : 'H'} ile sar`, 'kill');
      else this.ui.banner(PICKUP_NAMES[kind]);
    } else if (s.dist < 25) audio.powerup();
    if (kind === 'airdrop' && !c.isPlayer && w) {
      const cls = c.team === 'blue' ? 'kb' : 'kr';
      this.ui.feedText(`<span class="${cls}">${c.name}</span><span class="w">ikmalden aldı:</span>${w.name}`);
    }
    this.effects.sparkBurst(_v.set(c.pos.x, c.pos.y + 1, c.pos.z), _v2.set(0, 1, 0), kind === 'health' ? 0x3dff7a : kind === 'damage' ? 0xff3b3b : kind === 'speed' ? 0x3dd8ff : kind === 'bandage' ? 0xff6b6b : 0xffc533, kind === 'bandage' ? 14 : 30, 7);
  }

  private onMelee(c: Combatant, v: Combatant | null, back: boolean): void {
    c.view?.slash();
    const s = this.listenerPan(c.pos);
    if (s.dist < 20) audio.whoosh();
    if (v) {
      if (s.dist < 25) audio.stab();
      this.effects.sparkBurst(_v.set(v.pos.x, v.pos.y + 1.2, v.pos.z), null, v.team === 'blue' ? 0x6fb0ff : 0xff6a4a, 10, 3);
      if (c.isPlayer && back) this.ui.popup('ARKADAN!', 'kill');
    }
  }

  private onKill(e: { killer: Combatant; victim: Combatant; head: boolean; weapon: { id: string; name: string } }): void {
    const m = this.match!;
    this.ui.feed(e as never, m.player);
    // celebratory burst where the fighter fell
    const at = _v.set(e.victim.pos.x, e.victim.pos.y + 1.1, e.victim.pos.z);
    for (const col of [0xffd84a, 0xff5a5a, 0x5ad1ff, 0x7dff6a, 0xff7ac8]) this.effects.sparkBurst(at, _v2.set(0, 1, 0), col, e.killer.isPlayer ? 10 : 4, 7);
    if (e.killer.isPlayer && e.killer.team !== e.victim.team) {
      const knife = e.weapon.id === 'knife';
      const reward = killReward(e.head, knife);
      const st = streakReward(e.killer.streak);
      const total = reward + (st?.bonus ?? 0);
      this.save.money += total;
      this.save.totalKills++;
      this.killMoney += total;
      writeSave(this.save);
      this.ui.hitmark('kill');
      this.ui.popup(`+${formatTL(reward)}`);
      this.ui.popup(knife ? `BIÇAKLADIN! ${e.victim.name}` : e.weapon.id === 'tank' ? `EZDİN! ${e.victim.name}` : e.head ? `KAFADAN! ${e.victim.name}` : `LEŞ: ${e.victim.name}`, 'kill');
      audio.kill();
      setTimeout(() => audio.coin(), 120);
      if (st) {
        this.ui.banner(st.text, st.bonus ? `+${formatTL(st.bonus)} SERİ BONUSU` : '');
        audio.streak(Math.min(4, Math.floor(e.killer.streak / 2)));
      }
    }
  }

  private onEnd(w: 'blue' | 'red' | 'draw'): void {
    const m = this.match!;
    const res = w === 'draw' ? 'draw' : w === m.player.team ? 'win' : 'lose';
    const bonus = applyMatchResult(this.save, res);
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
    this.frameCap.limit = this.save.settings.fpsLimit;
    if (!this.frameCap.shouldRun(t)) return;
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    try {
      this.tick(dt);
    } catch (err) {
      // never let one bad frame kill the loop; record for diagnostics
      const msg = String((err as Error)?.stack ?? err);
      if (this.errors.length < 20) { this.errors.push(msg); diag(msg); }
      console.error(err);
    }
  }

  private tick(dt: number): void {
    this.frames++;
    const m = this.match;
    // online the match never stops for one person's pause menu (the others play on)
    if (m && this.online && this.state === 'paused') {
      this.online.tick(dt);
      m.update(dt);
    }
    if (m && this.state === 'playing') {
      if (this.input.consume('tank')) this.vehicleAction('tank');
      if (this.input.consume('jet')) this.vehicleAction('jet');
      if (this.input.consume('vehicle')) this.vehicleAction('toggle');
      // after the match ends (end screen pending) this still drives the camera
      this.updateBag(m);
      this.ctrl.update(dt, m.player, this.input, m, this.save.settings);
      const pv = m.player.vehicle;
      audio.engine(pv && !m.over ? pv.kind : null, pv ? (pv.kind === 'tank' ? Math.abs(pv.speed) / 12 : 0.3 + pv.vel.length() / 25) : 0);
      if (this.ctrl.rocket && m.player.vehicle?.kind === 'jet') this.ui.popup(m.lastLock ? `ROKET KİLİTLENDİ: ${m.lastLock.name}` : 'ROKET ATILDI', 'kill');
      if (this.ctrl.rocketFar) this.ui.popup('ÇOK UZAK', 'kill');
      if (this.ctrl.bandageNo) this.ui.popup(this.ctrl.bandageNo === 'none' ? 'BANDAJIN YOK · binalarda bulunur' : 'CANIN ZATEN DOLU', 'kill');
      if (this.ctrl.reloaded) audio.reload();
      if (this.ctrl.jumped) audio.jump();
      if (this.ctrl.stepped) audio.step(m.player.sprinting);
      this.online?.tick(dt);
      m.update(dt);
    }
    if (m && this.state !== 'menu') {
      this.syncViews(dt, m);
      this.syncGrenades(m);
      this.syncKnives(m, dt);
      this.syncDrops(m, dt);
      this.pickupViews.sync(m.pickups, dt, (pos) => this.effects.puff(_v.set(pos.x + (Math.random() - 0.5), 0.3, pos.z + (Math.random() - 0.5)), 0.9, 0xff4a3a, 2.2, 1.6));
      if (this.state === 'playing') this.updateHud(dt, m);
    } else {
      // menu: slow cinematic orbit over the city
      this.menuT += dt * 0.05;
      const a = this.menuT + 0.6;
      // high enough to clear the tallest roofs of the centre (26 m plus water tanks and antennas)
      this.camera.position.set(Math.cos(a) * 62, 36 + Math.sin(this.menuT * 2) * 3, Math.sin(a) * 48);
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
    // the flash fades instead of switching on/off (a hard strobe looks like flickering lights)
    this.flashT = Math.max(0, this.flashT - dt);
    this.fireGlowT = Math.max(0, this.fireGlowT - dt);
    this.fireGlow += ((this.fireGlowT > 0 ? 3 : 0) - this.fireGlow) * Math.min(1, dt * (this.fireGlowT > 0 ? 10 : 8));
    this.lights.flash.intensity = Math.max(this.fireGlow, this.flashPeak * (this.flashT / this.flashDur) ** 2);
    const focus = m && this.state !== 'menu' ? m.player.pos : _v.set(0, 0, 0);
    // With a shadow map refreshed every other frame, the sun may only move on
    // refresh frames: moving it in between makes indoor shadows jump each frame.
    if (this.shadowEvery === 1 || this.frames % this.shadowEvery === 0) {
      updateSun(this.lights, focus);
      if (this.shadowEvery > 1) this.lights.sun.shadow.needsUpdate = true;
    }
    if (this.worldRoot) updateInteriors(this.worldRoot, this.camera.position);
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
      if (c.vehicle) { v.root.visible = false; continue; }
      const speed = Math.hypot(c.vx, c.vz);
      f.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      r.set(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
      v.setShield(c.shieldT);
      if (c.isPlayer) v.setKnifeReady(this.ctrl.knifeAiming && c.alive);
      v.setBandaging(c.bandageT > 0 && c.alive);
      v.setName(c.name);
      v.setDistance(c.isPlayer ? 0 : this.camera.position.distanceTo(c.pos));
      v.update(dt, {
        speed,
        fwd: speed > 0.1 ? (c.vx * f.x + c.vz * f.z) / speed : 0,
        side: speed > 0.1 ? (c.vx * r.x + c.vz * r.z) / speed : 0,
        pitch: c.pitch,
        airborne: !c.onGround,
        kick: c.kick,
        reloading: c.weapon.reloading,
        sprint: c.sprinting,
        crouch: c.crouchK,
      });
      // hide own body when the scope is up or the camera is squeezed against a wall
      if (c.isPlayer && c.alive) {
        const scoped = c.aiming && c.weapon.def.zoom < 0.5;
        v.root.visible = !scoped && this.camera.position.distanceTo(_v.set(c.pos.x, c.pos.y + 1.5, c.pos.z)) > 0.9;
      }
    }
    // metro
    if (this.trainView) {
      const riding = m.player.alive && m.train.aboard(m.player);
      this.trainView.sync(m.train, dt);
      if (riding && m.train.doorsOpen && m.train.boardT > 0.2 && !this.trainWarned) {
        this.trainWarned = true;
        this.ui.popup('KAPILAR KAPANIYOR…', 'kill');
      }
      if (!riding) this.trainWarned = false;
    }
    // vehicles
    for (const veh of m.vehicles) {
      let vv = this.vehicleViews.get(veh);
      if (!vv) {
        vv = new VehicleView(veh.kind, veh.owner.team);
        this.scene.add(vv.root);
        this.vehicleViews.set(veh, vv);
      }
      vv.sync(veh, dt);
    }
    for (const [veh, vv] of this.vehicleViews) {
      if (veh.alive && m.vehicles.includes(veh)) continue;
      this.scene.remove(vv.root);
      vv.dispose();
      this.vehicleViews.delete(veh);
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

  private syncDrops(m: Match, dt: number): void {
    for (const d of m.drops) {
      let g = this.dropViews.get(d);
      if (!g) {
        g = new THREE.Group();
        const gun = makeWeaponMesh(d.def);
        gun.rotation.set(0, 0, Math.PI / 2); // lying on its side
        gun.position.y = 0.06;
        g.add(gun);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2, 0.6), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        g.add(ring);
        this.scene.add(g);
        this.dropViews.set(d, g);
      }
      g.position.set(d.pos.x, d.pos.y, d.pos.z);
      g.rotation.y += dt * 1.5;
      // drop in from waist height, then blink before vanishing
      g.position.y = d.pos.y + Math.max(0, 0.9 - d.age * 3);
      g.visible = d.age < 20 || Math.sin(d.age * 14) > 0;
    }
    for (const [d, g] of this.dropViews) {
      if (d.alive && m.drops.includes(d)) continue;
      this.scene.remove(g);
      ((g.children[1] as THREE.Mesh).material as THREE.Material).dispose();
      (g.children[1] as THREE.Mesh).geometry.dispose();
      this.dropViews.delete(d);
    }
  }

  /** Thrown knives: spinning end over end in flight, lying flat once down. */
  private syncKnives(m: Match, dt: number): void {
    for (const k of m.knives) {
      let g = this.knifeMeshes.get(k);
      if (!g) {
        g = new THREE.Group();
        const kn = makeKnife();
        kn.visible = true;
        kn.scale.setScalar(1.6); // reads better at a distance
        kn.traverse((o) => { o.castShadow = true; });
        g.add(kn);
        this.scene.add(g);
        this.knifeMeshes.set(k, g);
      }
      g.position.copy(k.pos);
      if (k.flying) {
        g.rotation.set(0, Math.atan2(k.vel.x, k.vel.z), 0);
        g.children[0].rotation.set(k.spin, 0, 0);
      } else {
        g.children[0].rotation.set(Math.PI / 2, 0, 0.4);
        g.rotation.y += dt * 0.8;
      }
    }
    for (const [k, g] of this.knifeMeshes) {
      if (k.alive && m.knives.includes(k)) continue;
      this.scene.remove(g);
      g.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) { mm.geometry.dispose(); (mm.material as THREE.Material).dispose(); }
      });
      this.knifeMeshes.delete(k);
    }
  }

  private syncGrenades(m: Match): void {
    for (const g of m.grenades) {
      let mesh = this.grenadeMeshes.get(g);
      if (!mesh) {
        mesh = new THREE.Group();
        const body = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
        body.castShadow = true;
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.2), toneMapped: false }));
        led.position.y = 0.09;
        mesh.add(body, led);
        this.scene.add(mesh);
        this.grenadeMeshes.set(g, mesh);
      }
      mesh.position.copy(g.pos);
      if (!g.resting) mesh.rotation.x += 0.4;
      // LED blinks faster as the fuse runs out
      mesh.children[1].visible = Math.sin(g.fuse * (6 + (2.2 - g.fuse) * 14)) > 0;
    }
    for (const [g, mesh] of this.grenadeMeshes) {
      if (!g.alive) {
        this.scene.remove(mesh);
        (mesh.children[1] as THREE.Mesh).geometry.dispose();
        this.grenadeMeshes.delete(g);
      }
    }
    // aiming arc
    const p = m.player;
    const knife = this.ctrl.knifeAiming && p.alive && this.state === 'playing';
    const show = (this.ctrl.grenadeAiming || knife) && p.alive && this.state === 'playing';
    this.arcDots.visible = show;
    this.arcRing.visible = show && !knife;
    if (show) {
      const n = knife ? this.ctrl.knifeArc(p, m, this.arcPts) : this.ctrl.grenadeArc(p, m, this.arcPts);
      const mat = new THREE.Matrix4();
      for (let i = 0; i < this.arcPts.length; i++) {
        const q = this.arcPts[Math.min(i, n - 1)];
        mat.makeTranslation(q.x, q.y, q.z);
        this.arcDots.setMatrixAt(i, mat);
      }
      this.arcDots.count = n;
      this.arcDots.instanceMatrix.needsUpdate = true;
      this.arcRing.position.copy(this.arcPts[n - 1]);
      this.arcRing.position.y += 0.05;
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
    // the vehicle's gun replaces the hand gun on the ammo counter
    const w = p.vehicle?.gun ?? p.weapon;
    this.ui.updateHud({
      blue: m.score.blue, red: m.score.red, limit: m.killLimit, timeLeft: m.duration - m.time,
      hp: p.hp, maxHp: p.maxHp, ammo: w.ammo, mag: w.def.mag, weapon: w.def.name,
      reloadFrac: w.reloading ? 1 - w.reloadT / w.def.reload : 0,
      money: this.save.money, aiming: p.aiming, scope: p.alive && p.aiming && w.def.zoom < 0.5,
      enemyUnderCross: this.enemyUnderCross, owned: this.save.owned.length, dt,
      grenades: p.grenades,
      knife: p.hasKnife ? -1 : Math.max(0, p.knifeBackT),
      bandages: p.bandages, bandageFrac: p.bandageT > 0 ? 1 - p.bandageT / BANDAGE_TIME : 0,
      dmgBuff: p.dmgBuffT, speedBuff: p.speedBuffT, stamina: p.stamina,
      grenadeWarn: p.alive && m.grenades.some((g) => g.owner.team !== p.team && g.pos.distanceTo(p.pos) < 7),
      crouch: p.crouch,
      veh: {
        driving: p.vehicle ? {
          kind: p.vehicle.kind, hp: p.vehicle.hp, max: p.vehicle.maxHp, speed: p.vehicle.groundSpeed,
          rocket: p.vehicle.rocketCd / HEAVY_CD[p.vehicle.kind],
        } : null,
        tank: this.save.vehicles.includes('tank') ? m.vehicleCd.tank : undefined,
        jet: this.save.vehicles.includes('jet') ? m.vehicleCd.jet : undefined,
        near: p.alive && !p.vehicle && !!m.nearbyVehicle(p),
      },
      level: p.alive ? this.levelLabel(m, p) : '',
      target: this.targetInfo(),
    });
    this.ui.inventory(this.ctrl.owned.map((id) => ({ id, name: getWeapon(id).name, temp: !this.save.owned.includes(id), current: p.weapon.def.id === id })), LOADOUT_SIZE);
    if (!p.alive) this.ui.death(true, p.lastAttacker?.name ?? '', p.respawnT);
    else this.ui.death(false);
    this.minimap.draw(m, dt);
  }

  /** Short label of where the player is: METRO, ÇATI, 1. KAT, BİNA. */
  private levelLabel(m: Match, p: Combatant): string {
    if (p.vehicle) return p.vehicle.kind === 'jet' ? `İRTİFA ${Math.round(p.pos.y)} m` : '';
    const name = m.nav.levelName(p.pos.x, p.pos.y, p.pos.z);
    if (name === TUNNEL) return 'METRO';
    if (name.endsWith('-roof') || name.endsWith('-roofm')) return p.pos.y > 1 ? 'ÇATI' : '';
    const k = /-(\d+)m?$/.exec(name);
    if (k && p.pos.y > 1) return `${k[1]}. KAT`;
    if (this.map.structures.houses.some((h) => p.pos.x > h.x0 && p.pos.x < h.x1 && p.pos.z > h.z0 && p.pos.z < h.z1)) return 'ZEMİN KAT';
    return '';
  }

  private targetInfo(): { name: string; hp: number; max: number } | null {
    const t = this.target;
    if (!t || performance.now() - t.t > 2500) return null;
    return { name: t.c.name, hp: t.c.alive ? t.c.hp : 0, max: t.c.maxHp };
  }

  private render(): void {
    if (this.finish) this.finish.uniforms.time.value = ambient.frozen ? 0 : performance.now() / 1000;
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
      if (this.state === 'playing' && this.fps < Math.min(40, this.save.settings.fpsLimit * 0.66)) this.lowFpsT++;
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

/** Keeps the last few problems in storage so they survive the reload after a crash. */
function diag(msg: string): void {
  try {
    const k = 'takim-savasi-diag';
    const list = JSON.parse(localStorage.getItem(k) || '[]') as string[];
    list.push(new Date().toISOString().slice(0, 19) + ' ' + msg.slice(0, 200));
    localStorage.setItem(k, JSON.stringify(list.slice(-8)));
  } catch { /* ignore */ }
}

const game = new Game();
// Exposed for automated tests and debugging.
(window as unknown as { __game: Game }).__game = game;
window.addEventListener('error', (e) => { game.errors.push(String(e.message)); diag(String(e.message)); });
window.addEventListener('unhandledrejection', (e) => game.errors.push(String(e.reason)));
game.boot().catch((e) => {
  game.errors.push(String(e?.stack ?? e));
  const el = document.getElementById('ldtxt');
  if (el) el.textContent = 'Hata: ' + String(e?.message ?? e);
  console.error(e);
});
