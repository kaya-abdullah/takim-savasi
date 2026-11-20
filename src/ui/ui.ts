import type { Btn, Input } from '../core/input';
import type { SaveData, Settings } from '../core/save';
import { SHOP_WEAPONS, STARTER, getWeapon, weaponStats, type WeaponDef } from '../data/weapons';
import { formatTL, LOSE_PENALTY, sellPrice, UPGRADES, WHEEL, WIN_BONUS, type UpgradeId } from '../game/economy';
import { VEHICLE_LIST, type VehicleKind } from '../data/vehicles';
import { START_GRENADES } from '../data/weapons';
import type { Combatant } from '../game/combatant';
import type { KillEntry } from '../game/match';

const ICON = {
  cart: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5.2 4l.9 2H21l-3.4 7.2a2 2 0 0 1-1.8 1.1H8.1l-.9 1.7h12.3v2H4l2.3-4.3L2.6 4H1V2h3.3z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  fire: '<svg viewBox="0 0 24 24"><path d="M12 2a1 1 0 0 1 1 1v2.06A7 7 0 0 1 18.94 11H21a1 1 0 1 1 0 2h-2.06A7 7 0 0 1 13 18.94V21a1 1 0 1 1-2 0v-2.06A7 7 0 0 1 5.06 13H3a1 1 0 1 1 0-2h2.06A7 7 0 0 1 11 5.06V3a1 1 0 0 1 1-1zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>',
  aim: '<svg viewBox="0 0 24 24"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-1 2h2v2h2v2h-2v2H9v-2H7V9h2z"/></svg>',
  jump: '<svg viewBox="0 0 24 24"><path d="M12 3l8 9h-5v8H9v-8H4z"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 1 7.7 6h-2.1A6 6 0 1 0 18 14h2.1A8 8 0 1 1 12 4zm5-1v6h-6l2.2-2.2A6 6 0 0 1 17 3z"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3 1.4-1.4L21.8 8l-5.4 5.4L15 12l3-3H7zm10 10H6l3 3-1.4 1.4L2.2 16l5.4-5.4L9 12l-3 3h11z"/></svg>',
  grenade: '<svg viewBox="0 0 24 24"><path d="M10 2h4v2h2.5l1.5 2-1.6 1.2A7.5 7.5 0 1 1 7.6 7.2L6 6l1.5-2H10zm2 7a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zm-1 2h2v3h3v2h-3v3h-2v-3H8v-2h3z"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M9 2h6a2 2 0 0 1 2 2v1.2A5 5 0 0 1 20 10v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-9a5 5 0 0 1 3-4.8V4a2 2 0 0 1 2-2zm0 2v1h6V4zm-1.5 9a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1zm1.5 2h6v1H9z"/></svg>',
  knife: '<svg viewBox="0 0 24 24"><path d="M20.5 2.5c.6 3.8-1.4 8-5.3 11.9l-2.1-2.1zM11.7 13.7l2.1 2.1-1.4 1.4 1.1 1.1-2.8 2.8a1.5 1.5 0 0 1-2.1 0l-1.6-1.6a1.5 1.5 0 0 1 0-2.1l2.8-2.8 1.1 1.1z"/></svg>',
  bandage: '<svg viewBox="0 0 24 24"><path d="M3.5 14.1 14.1 3.5a3 3 0 0 1 4.2 0l2.2 2.2a3 3 0 0 1 0 4.2L9.9 20.5a3 3 0 0 1-4.2 0l-2.2-2.2a3 3 0 0 1 0-4.2zM11 9.5l-1.5 1.5 1.5 1.5 1.5-1.5zm2 2-1.5 1.5 1.5 1.5 1.5-1.5zm-4 0L7.5 13 9 14.5l1.5-1.5zm2 2L9.5 15l1.5 1.5 1.5-1.5z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5.2-3.4 9.6-8 11-4.6-1.4-8-5.8-8-11V5z"/></svg>',
  tank: '<svg viewBox="0 0 24 24"><path d="M6 8h7l1.2-1.6H22V8h-7.2L14 9.4V11h3v2H4v-2h1zM3 14h18l-2 4.5H5zm3 1.3a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/></svg>',
  jet: '<svg viewBox="0 0 24 24"><path d="M12 1.5c.9 0 1.5 1.6 1.5 4v3.3l8.5 5.4v2l-8.5-2.6v4.2l2.5 2v1.7L12 20.6l-4 .9v-1.7l2.5-2v-4.2L2 16.2v-2l8.5-5.4V5.5c0-2.4.6-4 1.5-4z"/></svg>',
  crouch: '<svg viewBox="0 0 24 24"><path d="M13 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM9.6 9h5.2l2.6 4.2-1.7 1-1.8-2.9-1.6 2.6 3.1 2.6V22h-2v-4.6l-3.2-2.7-1.6 2.5H4v-2h3.6z"/></svg>',
  rocket: '<svg viewBox="0 0 24 24"><path d="M20.5 3.5c-3.9-.4-7.6 1.2-10.2 4.3L7 8 4 11l3.2.9-1 1.6 4.3 4.3 1.6-1 .9 3.2 3-3 .2-3.3c3.1-2.6 4.7-6.3 4.3-10.2zM15 7.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM5.4 15.5l3.1 3.1-3.9 1.4z"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 4v14h10V5z"/></svg>',
};

export interface UICallbacks {
  play(): void;
  openShop(): void;
  closeShop(): void;
  buy(id: string): void;
  buyUpgrade(id: UpgradeId): void;
  equip(id: string): void;
  settings(s: Partial<Settings>): void;
  pause(): void;
  resume(): void;
  quit(): void;
  again(): void;
  switchWeapon(): void;
  spin(): number;
  openLink(url: string): void;
  selectWeapon(id: string): void;
  buyVehicle(kind: VehicleKind): void;
  sell(id: string): void;
  sellVehicle(kind: VehicleKind): void;
  /** Backpack screen: put a weapon in the chosen slot / choose a slot / close it. */
  bagPick(id: string): void;
  bagSlot(i: number): void;
  bagClose(): void;
}

export interface BagModel {
  slots: ({ id: string; name: string; current: boolean } | null)[];
  selected: number;
  items: { id: string; name: string; temp: boolean; slot: number }[];
}

/** Vehicle state for the HUD (null fields = not owned / not driving). */
export interface VehicleHud {
  driving: { kind: VehicleKind; hp: number; max: number; rocket: number; speed: number } | null;
  /** Seconds until each owned vehicle can be called (0 = ready); undefined = not owned. */
  tank?: number;
  jet?: number;
  /** Own vehicle within reach to get in. */
  near: boolean;
}

export interface InvSlot { id: string; name: string; temp: boolean; current: boolean; }

export interface MenuExtras {
  update?: { version: string; url: string };
  androidUrl?: string;
  iosHint?: boolean;
  canSpin: boolean;
  version: string;
}

export interface EndData {
  winner: 'blue' | 'red' | 'draw';
  score: { blue: number; red: number };
  kills: number;
  deaths: number;
  killMoney: number;
  /** Money change from the result: positive (win/draw) or negative (loss). */
  bonus: number;
  rank: number;
  combatants: Combatant[];
  player: Combatant;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class UI {
  readonly root: HTMLElement;
  private screens: Record<string, HTMLElement> = {};
  icons: Record<string, string> = {};
  private hud!: {
    sb: HTMLElement; sr: HTMLElement; sbBar: HTMLElement; srBar: HTMLElement; time: HTMLElement;
    hp: HTMLElement; hpTxt: HTMLElement; ammo: HTMLElement; wname: HTMLElement; money: HTMLElement;
    feed: HTMLElement; cross: HTMLElement; hit: HTMLElement; vign: HTMLElement; dmg: HTMLElement[];
    death: HTMLElement; deathCd: HTMLElement; deathBy: HTMLElement; popups: HTMLElement; scope: HTMLElement;
    reload: HTMLElement; reloadI: HTMLElement; aimBtn: HTMLElement; switchBtn: HTMLElement; touch: HTMLElement[];
    keys: HTMLElement; gCount: HTMLElement; banner: HTMLElement; warn: HTMLElement; buffs: HTMLElement; nums: HTMLElement;
    inv: HTMLElement; stam: HTMLElement; bag: HTMLElement; knifeBtn: HTMLElement; bandageBtn: HTMLElement;
    crouchBtn: HTMLElement; tankBtn: HTMLElement; jetBtn: HTMLElement; venter: HTMLElement; vhp: HTMLElement;
    level: HTMLElement; target: HTMLElement; jumpBtn: HTMLElement;
  };
  private numPool: HTMLElement[] = [];
  private numIdx = 0;
  readonly minimap: HTMLCanvasElement;
  private last: Record<string, string | number | boolean> = {};
  private hitTimer = 0;
  private dmgIdx = 0;
  /** Item waiting for the second tap that confirms a sale. */
  private sellArm = '';

  constructor(root: HTMLElement, private cb: UICallbacks, private input: Input) {
    this.root = root;
    for (const id of ['loading', 'menu', 'hud', 'shop', 'settings', 'pause', 'end', 'wheel']) {
      const s = el('div', 'screen');
      s.id = id;
      root.appendChild(s);
      this.screens[id] = s;
    }
    this.screens.loading.innerHTML = `<div class="logo"><div class="l1">Takım Savaşı</div><div class="l2">3D</div></div><div class="bar"><i></i></div><div class="hint" id="ldtxt">Şehir inşa ediliyor...</div>`;
    this.minimap = el('canvas');
    this.minimap.id = 'minimap';
    this.minimap.width = 336;
    this.minimap.height = 240;
    this.buildHud();
    const rot = el('div', '', `${ICON.phone}<div>Oynamak için telefonu yan çevir</div>`);
    rot.id = 'rotate';
    document.body.appendChild(rot);
  }

  private show(id: string, on = true): void {
    this.screens[id].classList.toggle('on', on);
  }
  only(...ids: string[]): void {
    for (const k of Object.keys(this.screens)) if (k !== 'loading') this.show(k, ids.includes(k));
  }

  loading(p: number, txt?: string): void {
    const s = this.screens.loading;
    (s.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    if (txt) s.querySelector('#ldtxt')!.textContent = txt;
  }
  hideLoading(): void {
    this.screens.loading.classList.add('hide');
    setTimeout(() => (this.screens.loading.style.display = 'none'), 600);
  }

  toast(msg: string): void {
    this.root.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = el('div', 'toast');
    t.textContent = msg;
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  // ------------------------------------------------------------------ menu
  showMenu(save: SaveData, x: MenuExtras = { canSpin: false, version: '' }): void {
    const w = getWeapon(save.equipped);
    const s = this.screens.menu;
    s.innerHTML = `
      <button class="icon-btn settings-btn" data-a="settings" aria-label="Ayarlar">${ICON.gear}</button>
      <div class="money"><span class="coin">₺</span><span>${formatTL(save.money)}</span></div>
      <div class="left">
        <div class="logo"><div class="l1">Takım<br>Savaşı</div><div class="l2">3D</div>
          <div class="vs"><b class="b">MAVİ</b> VS <b class="r">KIRMIZI</b></div></div>
        <button class="big-play" data-a="play">OYNA</button>
        <div class="equipped">${this.icons[w.id] ? `<img src="${this.icons[w.id]}" alt="">` : ''}<div>Silahın<br><b>${esc(w.name)}</b></div></div>
        <div class="stats">
          <div class="stat">Maç<b>${save.matches}</b></div>
          <div class="stat">Galibiyet<b>${save.wins}</b></div>
          <div class="stat">Toplam leş<b>${save.totalKills}</b></div>
          <div class="stat">Silahlar<b>${save.owned.length - 1}/10</b></div>
        </div>
        <div class="hint">10'a 10 takım savaşı. Her leş <b style="color:var(--gold)">200 TL</b>, kazanırsan <b style="color:var(--gold)">+${formatTL(WIN_BONUS)}</b>, kaybedersen <b style="color:#ff7a6a">−${formatTL(LOSE_PENALTY)}</b>. Binalara gir, çatıya çık, metroya in!</div>
      </div>
      <button class="shop-btn" data-a="shop">${ICON.cart}MAĞAZA</button>
      <button class="wheel-btn ${x.canSpin ? 'ready' : ''}" data-a="wheel"><span class="wico"></span>ŞANS ÇARKI${x.canSpin ? '<b>!</b>' : ''}</button>
      ${x.update ? `<button class="notice update" data-a="link" data-url="${esc(x.update.url)}">🔔 Yeni sürüm v${esc(x.update.version)} çıktı! <b>GÜNCELLE</b></button>`
        : x.androidUrl ? `<button class="notice" data-a="link" data-url="${esc(x.androidUrl)}">📱 Android uygulamasını indir</button>`
        : x.iosHint ? `<div class="notice ios">iPhone: Paylaş → <b>Ana Ekrana Ekle</b> ile uygulama gibi oyna</div>` : ''}
      <div class="ver">v${esc(x.version)}</div>`;
    s.onclick = (e) => {
      const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      const a = t?.getAttribute('data-a');
      if (a === 'play') this.cb.play();
      else if (a === 'shop') this.cb.openShop();
      else if (a === 'settings') this.openSettings(save.settings);
      else if (a === 'wheel') this.openWheel(save, x);
      else if (a === 'link') this.cb.openLink(t!.dataset.url!);
    };
    this.only('menu');
  }

  // ------------------------------------------------------------------ HUD
  private buildHud(): void {
    const s = this.screens.hud;
    s.innerHTML = `
      <div class="top"><div class="sc b"><span id="sb">0</span><i id="sbb"></i></div>
        <div class="timer"><span id="tm">5:00</span><small id="lim">60 LEŞ</small></div>
        <div class="sc r"><span id="sr">0</span><i id="srb"></i></div></div>
      <button class="icon-btn pause" data-a="pause" aria-label="Duraklat">${ICON.pause}</button>
      <div id="killfeed"></div>
      <div class="scope"></div>
      <div class="cross"><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i><i class="dot"></i></div>
      <div class="hitmark"><i></i><i></i><i></i><i></i></div>
      <div class="reloadbar"><i></i></div>
      <div class="popups"></div>
      <div class="vignette"></div>
      <div class="dmgdir"><i></i><i></i><i></i><i></i></div>
      <div class="hpm"><div class="lbl"><span><span id="hpt">100</span> ❤</span><span class="ammo"><span id="am">12</span><small id="wn"></small></span></div><div class="bar"><i id="hpb"></i></div><div class="stam"><i></i></div></div>
      <div class="money"><span class="coin">₺</span><span id="mn">0 TL</span></div>
      <div class="joy-hint">YÜRÜ<br><small>sonuna it: KOŞ</small></div>
      <button class="tc fire" data-b="fire" data-look="1" aria-label="Ateş">${ICON.fire}</button>
      <button class="tc fire2" data-b="fire" aria-label="Ateş">${ICON.fire}</button>
      <button class="tc aim" data-b="aim" aria-label="Nişan">${ICON.aim}</button>
      <button class="tc jump" data-b="jump" aria-label="Zıpla">${ICON.jump}</button>
      <button class="tc reload" data-b="reload" aria-label="Şarjör">${ICON.reload}</button>
      <button class="tc switch" data-b="switch" aria-label="Çanta: silah değiştir">${ICON.bag}</button>
      <button class="tc grenade" data-b="grenade" data-look="1" aria-label="El bombası">${ICON.grenade}<b class="badge" id="gc">3</b></button>
      <button class="tc knife" data-b="knife" data-look="1" aria-label="Bıçak (basılı tut: fırlat)">${ICON.knife}<b class="badge kb"></b></button>
      <button class="tc bandage" data-b="bandage" aria-label="Bandaj sar (+50 can)">${ICON.bandage}<b class="badge bc">0</b><i class="bprog"></i></button>
      <button class="tc crouch" data-b="crouch" aria-label="Eğil">${ICON.crouch}</button>
      <button class="tc vcall tank" data-b="tank" aria-label="Tank çağır">${ICON.tank}<b class="cd"></b></button>
      <button class="tc vcall jet" data-b="jet" aria-label="Uçak çağır">${ICON.jet}<b class="cd"></b></button>
      <button class="venter" data-b="vehicle"></button>
      <div class="vhp"><span class="vn"></span><div class="bar"><i></i></div><div class="rk"><i></i></div></div>
      <div class="lvl"></div>
      <div class="tgt"><span></span><div class="bar"><i></i></div></div>
      <div class="banner"></div>
      <div class="buffs"></div>
      <div class="inv"></div>
      <div class="bagui"></div>
      <div class="nums"></div>
      <div class="gwarn">${ICON.grenade}<span>BOMBA!</span></div>
      <button class="shop-btn" data-a="shop">${ICON.cart}MAĞAZA</button>
      <div class="keys">WASD yürü · Fare nişan · Sol tık ateş · Sağ tık/E dürbün · R şarjör · G bomba (basılı tut) · V bıçak (basılı tut: fırlat) · H bandaj sar · Space zıpla · Shift koş · C eğil · 1-3 silah · Q/Tab çanta · T tank · Y uçak · X bin/in · B mağaza · Esc</div>
      <div class="death"><h2>ÖLDÜN!</h2><p id="dby"></p><div class="cd" id="dcd">3</div></div>`;
    s.prepend(this.minimap);
    const q = <T extends HTMLElement>(sel: string) => s.querySelector(sel) as T;
    this.hud = {
      sb: q('#sb'), sr: q('#sr'), sbBar: q('#sbb'), srBar: q('#srb'), time: q('#tm'),
      hp: q('#hpb'), hpTxt: q('#hpt'), ammo: q('#am'), wname: q('#wn'), money: q('#mn'),
      feed: q('#killfeed'), cross: q('.cross'), hit: q('.hitmark'), vign: q('.vignette'),
      dmg: Array.from(s.querySelectorAll('.dmgdir i')) as HTMLElement[],
      death: q('.death'), deathCd: q('#dcd'), deathBy: q('#dby'), popups: q('.popups'), scope: q('.scope'),
      reload: q('.reloadbar'), reloadI: q('.reloadbar i'), aimBtn: q('.tc.aim'), switchBtn: q('.tc.switch'),
      touch: Array.from(s.querySelectorAll('.tc, .joy-hint')) as HTMLElement[], keys: q('.keys'),
      gCount: q('#gc'), banner: q('.banner'), warn: q('.gwarn'), buffs: q('.buffs'), nums: q('.nums'),
      inv: q('.inv'), stam: q('.stam i'), bag: q('.bagui'), knifeBtn: q('.tc.knife'), bandageBtn: q('.tc.bandage'),
      crouchBtn: q('.tc.crouch'), tankBtn: q('.vcall.tank'), jetBtn: q('.vcall.jet'), venter: q('.venter'), vhp: q('.vhp'),
      level: q('.lvl'), target: q('.tgt'), jumpBtn: q('.tc.jump'),
    };
    this.hud.bag.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      e.preventDefault();
      e.stopPropagation();
      const w = t.closest('[data-bw]') as HTMLElement | null;
      const sl = t.closest('[data-bs]') as HTMLElement | null;
      if (w) this.cb.bagPick(w.dataset.bw!);
      else if (sl) this.cb.bagSlot(Number(sl.dataset.bs));
      else if (t.closest('[data-bc]')) this.cb.bagClose();
    });
    this.hud.inv.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('[data-w]') as HTMLElement | null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      this.cb.selectWeapon(b.dataset.w!);
    });
    for (let i = 0; i < 10; i++) {
      const n = el('div', 'dnum');
      this.hud.nums.appendChild(n);
      this.numPool.push(n);
    }
    s.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'pause') this.cb.pause();
      else if (a === 'shop') this.cb.openShop();
    });
    // touch buttons
    s.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => {
      const name = b.getAttribute('data-b') as Btn;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('on');
        try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        if (name === 'switch') this.cb.switchWeapon();
        else this.input.press(name);
        if (b.dataset.look) this.input.trackLook(e);
      };
      const up = (e: PointerEvent) => {
        b.classList.remove('on');
        if (name !== 'switch') this.input.release(name);
        void e;
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    });
  }

  showHud(isTouch: boolean, killLimit: number): void {
    for (const t of this.hud.touch) t.style.display = isTouch ? '' : 'none';
    this.screens.hud.classList.toggle('touch', isTouch);
    this.hud.keys.style.display = isTouch ? 'none' : '';
    (this.screens.hud.querySelector('#lim') as HTMLElement).textContent = `${killLimit} LEŞ`;
    this.hud.feed.innerHTML = '';
    this.hud.popups.innerHTML = '';
    this.hud.death.classList.remove('on');
    this.hud.vign.style.opacity = '0';
    this.last = {};
    this.only('hud');
  }

  private set(key: string, v: string | number | boolean, fn: () => void): void {
    if (this.last[key] === v) return;
    this.last[key] = v;
    fn();
  }

  updateHud(d: {
    blue: number; red: number; limit: number; timeLeft: number; hp: number; maxHp: number; ammo: number; mag: number; weapon: string;
    reloadFrac: number; money: number; aiming: boolean; scope: boolean; enemyUnderCross: boolean; owned: number; dt: number;
    grenades: number; grenadeWarn: boolean;
    /** -1 = knife in hand, else seconds until it comes back. */
    knife: number; bandages: number; bandageFrac: number; dmgBuff: number; speedBuff: number; stamina: number;
    crouch: boolean; veh: VehicleHud; level: string; target: { name: string; hp: number; max: number } | null;
  }): void {
    const h = this.hud;
    this.set('crouch', d.crouch, () => h.crouchBtn.classList.toggle('active', d.crouch));
    this.set('lvl', d.level, () => { h.level.textContent = d.level; h.level.style.display = d.level ? '' : 'none'; });
    const tk = d.target ? `${d.target.name}|${Math.ceil(d.target.hp)}|${d.target.max}` : '';
    this.set('tgt', tk, () => {
      h.target.classList.toggle('on', !!d.target);
      if (!d.target) return;
      (h.target.firstElementChild as HTMLElement).textContent = d.target.name;
      const pct = Math.max(0, Math.min(100, (100 * d.target.hp) / d.target.max));
      (h.target.querySelector('i') as HTMLElement).style.width = `${pct}%`;
    });
    // vehicles
    const v = d.veh, dr = v.driving;
    const mode = dr ? 'in-' + dr.kind : '';
    this.set('vmode', mode, () => {
      this.screens.hud.classList.toggle('in-tank', mode === 'in-tank');
      this.screens.hud.classList.toggle('in-jet', mode === 'in-jet');
      h.jumpBtn.setAttribute('aria-label', mode === 'in-jet' ? 'Yüksel' : 'Zıpla');
      h.crouchBtn.setAttribute('aria-label', mode === 'in-jet' ? 'Alçal' : 'Eğil');
      h.gCount.parentElement!.innerHTML = (dr ? ICON.rocket : ICON.grenade) + `<b class="badge" id="gc">${d.grenades}</b>`;
      h.gCount = this.screens.hud.querySelector('#gc') as HTMLElement;
      this.last.gc = -1;
    });
    const callKey = (x?: number) => (x === undefined ? 'x' : x > 0 ? String(Math.ceil(x)) : 'r');
    this.set('vcall', `${callKey(v.tank)}|${callKey(v.jet)}|${!!dr}`, () => {
      for (const [btn, cd] of [[h.tankBtn, v.tank], [h.jetBtn, v.jet]] as [HTMLElement, number | undefined][]) {
        btn.classList.toggle('owned', cd !== undefined);
        btn.classList.toggle('wait', !!cd && cd > 0);
        (btn.querySelector('.cd') as HTMLElement).textContent = cd && cd > 0 ? String(Math.ceil(cd)) : '';
      }
    });
    const vtxt = dr ? (this.input.isTouch ? 'İN' : 'İN (X)') : v.near ? (this.input.isTouch ? 'BİN' : 'BİN (X)') : '';
    this.set('venter', vtxt, () => { h.venter.textContent = vtxt; h.venter.classList.toggle('show', !!vtxt); h.venter.classList.toggle('out', !!dr); });
    const vk = dr ? `${dr.kind}|${Math.ceil(dr.hp)}|${Math.round(dr.rocket * 20)}|${Math.round(dr.speed)}` : '';
    this.set('vhp', vk, () => {
      h.vhp.classList.toggle('on', !!dr);
      if (!dr) return;
      (h.vhp.querySelector('.vn') as HTMLElement).textContent = `${dr.kind === 'tank' ? 'TANK' : 'SAVAŞ UÇAĞI'}  ${Math.ceil(dr.hp)}/${dr.max}  ·  ${Math.round(dr.speed * 3.6)} km/s`;
      const bar = h.vhp.querySelector('.bar i') as HTMLElement;
      bar.style.width = `${Math.max(0, (100 * dr.hp) / dr.max)}%`;
      bar.classList.toggle('low', dr.hp / dr.max < 0.3);
      const rk = h.vhp.querySelector('.rk') as HTMLElement;
      rk.style.display = '';
      (rk.firstElementChild as HTMLElement).style.width = `${Math.round((1 - dr.rocket) * 100)}%`;
    });
    const st = Math.round(d.stamina * 50);
    this.set('stam', st, () => {
      h.stam.style.width = `${st * 2}%`;
      h.stam.parentElement!.style.opacity = st >= 50 ? '0' : '1';
    });
    const bkey = `${Math.ceil(d.dmgBuff)}|${Math.ceil(d.speedBuff)}`;
    this.set('buffs', bkey, () => {
      h.buffs.innerHTML = (d.dmgBuff > 0 ? `<div class="buff dmg">2X HASAR <b>${Math.ceil(d.dmgBuff)}</b></div>` : '')
        + (d.speedBuff > 0 ? `<div class="buff spd">SÜPER HIZ <b>${Math.ceil(d.speedBuff)}</b></div>` : '');
    });
    this.set('gc', d.grenades, () => {
      h.gCount.textContent = String(d.grenades);
      h.gCount.parentElement!.classList.toggle('empty', d.grenades === 0);
    });
    this.set('gw', d.grenadeWarn, () => h.warn.classList.toggle('on', d.grenadeWarn));
    this.set('b', d.blue, () => { h.sb.textContent = String(d.blue); h.sbBar.style.width = `${(100 * d.blue) / d.limit}%`; });
    this.set('r', d.red, () => { h.sr.textContent = String(d.red); h.srBar.style.width = `${(100 * d.red) / d.limit}%`; });
    const tl = Math.max(0, Math.ceil(d.timeLeft));
    this.set('t', tl, () => (h.time.textContent = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`));
    const hp = Math.max(0, Math.round(d.hp));
    this.set('hp', hp, () => {
      const pct = (100 * hp) / d.maxHp;
      h.hpTxt.textContent = String(hp);
      h.hp.style.width = `${pct}%`;
      h.hp.classList.toggle('low', pct <= 30);
      h.vign.style.opacity = pct <= 30 && hp > 0 ? '0.8' : '0';
    });
    this.set('am', `${d.ammo}/${d.mag}`, () => {
      h.ammo.textContent = String(d.ammo);
      h.wname.textContent = ` / ${d.mag}`;
    });
    this.set('wn', d.weapon, () => h.ammo.parentElement!.setAttribute('title', d.weapon));
    this.set('mn', d.money, () => (h.money.textContent = formatTL(d.money)));
    this.set('aim', d.aiming, () => h.aimBtn.classList.toggle('active', d.aiming));
    this.set('scope', d.scope, () => { h.scope.classList.toggle('on', d.scope); h.cross.style.display = d.scope ? 'none' : ''; });
    this.set('enemy', d.enemyUnderCross, () => h.cross.classList.toggle('enemy', d.enemyUnderCross));
    this.set('bd', d.bandages, () => {
      (h.bandageBtn.querySelector('.bc') as HTMLElement).textContent = String(d.bandages);
      h.bandageBtn.classList.toggle('has', d.bandages > 0);
    });
    const bf = Math.round(d.bandageFrac * 20);
    this.set('bf', bf, () => {
      h.bandageBtn.classList.toggle('busy', bf > 0);
      (h.bandageBtn.querySelector('.bprog') as HTMLElement).style.setProperty('--p', `${bf * 5}%`);
    });
    const kn = d.knife < 0 ? -1 : Math.ceil(d.knife);
    this.set('kn', kn, () => {
      h.knifeBtn.classList.toggle('empty', kn >= 0);
      (h.knifeBtn.querySelector('.kb') as HTMLElement).textContent = kn >= 0 ? String(kn) : '';
    });
    const rel = d.reloadFrac > 0;
    this.set('rel', rel, () => (h.reload.style.display = rel ? 'block' : 'none'));
    if (rel) h.reloadI.style.width = `${Math.round(d.reloadFrac * 100)}%`;
    if (this.hitTimer > 0) {
      this.hitTimer -= d.dt;
      if (this.hitTimer <= 0) h.hit.classList.remove('on');
    }
  }

  /** Big centred announcer text (kill streaks). */
  banner(text: string, sub = ''): void {
    const b = this.hud.banner;
    b.innerHTML = `<div>${esc(text)}</div>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
  }

  /** Floating damage number at a screen position (pixels). */
  damageNumber(x: number, y: number, amount: number, kind: 'hit' | 'head' | 'kill'): void {
    const n = this.numPool[this.numIdx++ % this.numPool.length];
    n.textContent = String(amount);
    n.className = 'dnum ' + kind;
    n.style.left = `${x + (Math.random() - 0.5) * 30}px`;
    n.style.top = `${y}px`;
    void n.offsetWidth;
    n.classList.add('go');
  }

  /** Bottom inventory bar: owned weapons plus ones picked up this match. */
  inventory(slots: InvSlot[], size = 3): void {
    const key = slots.map((x) => x.id + (x.current ? '*' : '') + (x.temp ? 't' : '')).join(',');
    this.set('inv', key, () => {
      const html = slots.map((x, i) => `<button class="slot ${x.current ? 'on' : ''} ${x.temp ? 'temp' : ''}" data-w="${x.id}" title="${esc(x.name)}">
        <span class="k">${i + 1}</span>${this.icons[x.id] ? `<img src="${this.icons[x.id]}" alt="">` : esc(x.name)}${x.temp ? '<em>GEÇİCİ</em>' : ''}</button>`);
      for (let i = slots.length; i < size; i++) html.push(`<div class="slot empty"><span class="k">${i + 1}</span>BOŞ</div>`);
      this.hud.inv.innerHTML = html.join('');
    });
  }

  /** The backpack screen: three hand slots on top, every weapon in the bag below. */
  openBag(b: BagModel): void {
    const pic = (id: string, name: string) => (this.icons[id] ? `<img src="${this.icons[id]}" alt="">` : `<span>${esc(name)}</span>`);
    const slots = b.slots.map((x, i) => `<button class="bslot ${i === b.selected ? 'sel' : ''} ${x?.current ? 'hand' : ''}" data-bs="${i}">
      <span class="k">${i + 1}</span>${x ? pic(x.id, x.name) + `<b>${esc(x.name)}</b>` : '<em>BOŞ</em>'}${x?.current ? '<i>ELİNDE</i>' : ''}</button>`).join('');
    const items = b.items.map((x) => `<button class="bitem ${x.slot >= 0 ? 'in' : ''}" data-bw="${x.id}">
      ${pic(x.id, x.name)}<b>${esc(x.name)}</b>${x.slot >= 0 ? `<i>SLOT ${x.slot + 1}</i>` : x.temp ? '<i class="t">BULUNDU</i>' : ''}</button>`).join('');
    this.hud.bag.innerHTML = `<div class="bagpanel">
      <div class="bhead">${ICON.bag}<h3>ÇANTA</h3><small>${b.items.length} silah</small><button class="bclose" data-bc="1" aria-label="Kapat">✕</button></div>
      <div class="bslots">${slots}</div>
      <div class="bhint">Bir slot seç, sonra çantadan silaha dokun: o slota girer ve eline alırsın.</div>
      <div class="bitems">${items}</div>
      <button class="btn primary bdone" data-bc="1">KAPAT</button></div>`;
    this.hud.bag.classList.add('on');
  }

  closeBag(): void {
    this.hud?.bag.classList.remove('on');
  }

  /** Short line in the kill feed (events like supply drops). */
  feedText(html: string): void {
    const d = el('div', 'me', html);
    this.hud.feed.prepend(d);
    while (this.hud.feed.children.length > 5) this.hud.feed.lastChild!.remove();
    setTimeout(() => d.remove(), 5000);
  }

  hitmark(kind: 'hit' | 'head' | 'kill'): void {
    const h = this.hud.hit;
    h.className = 'hitmark on ' + (kind === 'hit' ? '' : kind);
    this.hitTimer = kind === 'kill' ? 0.3 : 0.12;
  }

  damageFrom(angle: number): void {
    const i = this.hud.dmg[this.dmgIdx++ % this.hud.dmg.length];
    i.style.transition = 'none';
    i.style.transform = `rotate(${angle}rad)`;
    i.style.opacity = '1';
    void i.offsetWidth;
    i.style.transition = 'opacity .9s';
    i.style.opacity = '0';
  }

  popup(text: string, kind: 'money' | 'kill' = 'money'): void {
    const p = el('div', 'popup' + (kind === 'kill' ? ' kill' : ''));
    p.textContent = text;
    p.style.top = kind === 'kill' ? '34px' : '0';
    this.hud.popups.appendChild(p);
    setTimeout(() => p.remove(), 1250);
  }

  feed(e: KillEntry, player: Combatant): void {
    const d = el('div', e.killer === player || e.victim === player ? 'me' : '');
    const kc = e.killer.team === 'blue' ? 'kb' : 'kr', vc = e.victim.team === 'blue' ? 'kb' : 'kr';
    d.innerHTML = `<span class="${kc}">${esc(e.killer.name)}</span><span class="w">[${esc(e.weapon.name)}${e.head ? ' ☠' : ''}]</span><span class="${vc}">${esc(e.victim.name)}</span>`;
    this.hud.feed.prepend(d);
    while (this.hud.feed.children.length > 5) this.hud.feed.lastChild!.remove();
    setTimeout(() => d.remove(), 6000);
  }

  death(on: boolean, by = '', cd = 0): void {
    this.hud.death.classList.toggle('on', on);
    if (on) {
      this.set('dby', by, () => (this.hud.deathBy.textContent = by ? `${by} seni vurdu` : ''));
      this.set('dcd', Math.ceil(cd), () => (this.hud.deathCd.textContent = String(Math.max(1, Math.ceil(cd)))));
    }
  }

  // ------------------------------------------------------------------ shop
  openShop(save: SaveData, inMatch: boolean): void {
    const s = this.screens.shop;
    s.innerHTML = `<div class="overlay"><div class="ov-head"><h2>MAĞAZA</h2>
      <div class="money"><span class="coin">₺</span><span id="smn">${formatTL(save.money)}</span></div>
      <button class="close" data-a="close" aria-label="Kapat">✕</button></div><div class="grid"></div></div>`;
    s.onclick = (e) => {
      const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!t) return;
      const a = t.dataset.a, id = t.dataset.id!;
      if (a === 'close') this.cb.closeShop();
      else if (a === 'buy') this.cb.buy(id);
      else if (a === 'up') this.cb.buyUpgrade(id as UpgradeId);
      else if (a === 'equip') this.cb.equip(id);
      else if (a === 'veh') this.cb.buyVehicle(id as VehicleKind);
      else if (a === 'sell' || a === 'vsell') {
        // first tap arms, second tap sells (no accidental sales)
        if (this.sellArm !== a + id) { this.sellArm = a + id; this.renderShop(this.lastSave!); return; }
        this.sellArm = '';
        if (a === 'sell') this.cb.sell(id);
        else this.cb.sellVehicle(id as VehicleKind);
      }
    };
    this.renderShop(save);
    this.show('shop');
    if (!inMatch) this.show('menu', false);
  }

  private lastSave: SaveData | null = null;

  /** Small sell button under an owned item (second tap confirms). */
  private sellBtn(kind: 'sell' | 'vsell', id: string, price: number): string {
    const armed = this.sellArm === kind + id;
    return `<button class="sell ${armed ? 'armed' : ''}" data-a="${kind}" data-id="${id}">${armed ? `EMİN MİSİN? +${formatTL(sellPrice(price))}` : `SAT · ${formatTL(sellPrice(price))}`}</button>`;
  }

  renderShop(save: SaveData): void {
    this.lastSave = save;
    const grid = this.screens.shop.querySelector('.grid');
    if (!grid) return;
    (this.screens.shop.querySelector('#smn') as HTMLElement).textContent = formatTL(save.money);
    const all: WeaponDef[] = [STARTER, ...SHOP_WEAPONS];
    grid.innerHTML = all.map((w, i) => {
      const owned = save.owned.includes(w.id);
      const eq = save.equipped === w.id;
      const poor = !owned && save.money < w.price;
      const st = weaponStats(w);
      const bar = (n: number) => `<span><i style="width:${Math.round(Math.max(0.06, n) * 100)}%"></i></span>`;
      let act: string;
      if (eq) act = `<button class="act on" disabled>KUŞANILDI</button>`;
      else if (owned) act = `<button class="act equip" data-a="equip" data-id="${w.id}">KUŞAN</button>`;
      else if (poor) act = `<button class="act buy" disabled>${formatTL(w.price - save.money)} eksik</button>`;
      else act = `<button class="act buy" data-a="buy" data-id="${w.id}">SATIN AL · ${formatTL(w.price)}</button>`;
      const stars = i === 0 ? '' : '★'.repeat(Math.ceil(i / 2)) + '☆'.repeat(5 - Math.ceil(i / 2));
      return `<div class="card ${owned ? 'owned' : ''} ${eq ? 'equipped' : ''} ${poor ? 'poor' : ''}">
        <span class="num">${i === 0 ? 'BAŞLANGIÇ' : `<span class="stars">${stars}</span>`}</span>${owned ? '<span class="tag">SENİN</span>' : ''}
        <div class="pic">${this.icons[w.id] ? `<img src="${this.icons[w.id]}" alt="">` : ''}</div>
        <h3>${esc(w.name)}</h3><p>${esc(w.desc)}</p>
        <div class="bars"><b>Hasar</b>${bar(st.damage)}<b>Hız</b>${bar(st.rate)}<b>Menzil</b>${bar(st.range)}<b>Şarjör</b>${bar(st.mag)}</div>
        ${act}${owned && i > 0 ? this.sellBtn('sell', w.id, w.price) : ''}</div>`;
    }).join('') + this.vehiclesHtml(save) + this.equipmentHtml(save);
  }

  private vehiclesHtml(save: SaveData): string {
    const cards = VEHICLE_LIST.map((v) => {
      const owned = save.vehicles.includes(v.kind);
      const poor = !owned && save.money < v.price;
      const bar = (n: number) => `<span><i style="width:${Math.round(n * 100)}%"></i></span>`;
      const act = owned
        ? `<button class="act on" disabled>SENİN · ${v.kind === 'tank' ? 'T' : 'Y'} TUŞU</button>`
        : poor
          ? `<button class="act buy" disabled>${formatTL(v.price - save.money)} eksik</button>`
          : `<button class="act buy" data-a="veh" data-id="${v.kind}">SATIN AL · ${formatTL(v.price)}</button>`;
      const img = this.icons['veh-' + v.kind];
      return `<div class="card veh ${owned ? 'owned' : ''} ${poor ? 'poor' : ''}"><span class="num">ARAÇ</span>${owned ? '<span class="tag">SENİN</span>' : ''}
        <div class="pic">${img ? `<img src="${img}" alt="">` : ICON[v.kind]}</div>
        <h3>${esc(v.name)}</h3><p>${esc(v.desc)}</p>
        <div class="bars"><b>Hız</b>${bar(v.stats.speed)}<b>Zırh</b>${bar(v.stats.armor)}<b>Silah</b>${bar(v.stats.weapon)}<b>Fiyat</b>${bar(v.price / 50000)}</div>
        ${act}${owned ? this.sellBtn('vsell', v.kind, v.price) : ''}</div>`;
    }).join('');
    return `<div class="sec">ARAÇLAR</div>${cards}`;
  }

  private equipmentHtml(save: SaveData): string {
    const ups = UPGRADES.map((u) => {
      const lvl = save.upgrades[u.id];
      const max = lvl >= u.prices.length;
      const price = max ? 0 : u.prices[lvl];
      const act = max
        ? `<button class="act on" disabled>EN ÜST SEVİYE</button>`
        : save.money < price
          ? `<button class="act buy" disabled>${formatTL(price - save.money)} eksik</button>`
          : `<button class="act buy" data-a="up" data-id="${u.id}">YÜKSELT · ${formatTL(price)}</button>`;
      const pips = u.prices.map((_, k) => `<i class="${k < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="card gear"><span class="num">EKİPMAN</span><div class="pic icon">${u.id === 'bag' ? ICON.grenade : ICON.shield}</div>
        <h3>${esc(u.name)}</h3><p>${esc(u.desc(lvl))}</p><div class="pips">${pips}</div>${act}</div>`;
    }).join('');
    const free = `<div class="card gear free"><span class="num">HERKESTE VAR</span><div class="pic icon">${ICON.knife}</div>
      <h3>Bıçak + ${START_GRENADES} Bomba</h3><p>Bıçakla arkadan tek vuruş: +100 TL bonus. Bombayı basılı tutup nişan al, bırakınca fırlat.</p></div>`;
    return `<div class="sec">EKİPMAN</div>${ups}${free}`;
  }

  closeShop(): void {
    this.show('shop', false);
  }

  // ------------------------------------------------------------------ settings
  openSettings(st: Settings): void {
    const s = this.screens.settings;
    const seg = (key: string, opts: [string, string][], cur: string) =>
      `<div class="seg" data-k="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    s.innerHTML = `<div class="overlay"><div class="panel"><h2>AYARLAR</h2>
      <div class="row">Grafik ${seg('quality', [['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']], st.quality)}</div>
      <div class="row">Hassasiyet <input type="range" min="0.3" max="2" step="0.1" value="${st.sensitivity}"></div>
      <div class="row">Ses ${seg('sound', [['1', 'Açık'], ['0', 'Kapalı']], st.sound ? '1' : '0')}</div>
      <div class="row">Nişan yardımı (dokunmatik) ${seg('aimAssist', [['1', 'Açık'], ['0', 'Kapalı']], st.aimAssist ? '1' : '0')}</div>
      <div class="row">Zorluk ${seg('difficulty', [['normal', 'Normal'], ['hard', 'Zor'], ['extreme', 'Çok Zor']], st.difficulty)}</div>
      <div class="btns"><button class="btn primary" data-a="close">TAMAM</button></div>
      <div class="diag">${esc(this.diagText())}</div></div></div>`;
    s.onclick = (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-a="close"]')) { this.show('settings', false); return; }
      const b = t.closest('.seg button') as HTMLElement | null;
      if (!b) return;
      const k = (b.parentElement as HTMLElement).dataset.k!;
      const v = b.dataset.v!;
      b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (k === 'quality') this.cb.settings({ quality: v as Settings['quality'] });
      else if (k === 'sound') this.cb.settings({ sound: v === '1' });
      else if (k === 'aimAssist') this.cb.settings({ aimAssist: v === '1' });
      else if (k === 'difficulty') this.cb.settings({ difficulty: v as Settings['difficulty'] });
    };
    const range = s.querySelector('input') as HTMLInputElement;
    range.oninput = () => this.cb.settings({ sensitivity: parseFloat(range.value) });
    this.show('settings');
  }

  private diagText(): string {
    try {
      const l = JSON.parse(localStorage.getItem('takim-savasi-diag') || '[]') as string[];
      return l.length ? 'Son hatalar: ' + l.slice(-3).join(' | ') : '';
    } catch { return ''; }
  }

  // ------------------------------------------------------------------ pause
  openPause(st: Settings, quitPenalty = false): void {
    const s = this.screens.pause;
    s.innerHTML = `<div class="overlay"><div class="panel"><h2>DURAKLATILDI</h2>
      <div class="btns" style="flex-direction:column">
        <button class="btn primary" data-a="resume">DEVAM ET</button>
        <button class="btn green" data-a="shop">MAĞAZA</button>
        <button class="btn" data-a="settings">AYARLAR</button>
        <button class="btn" data-a="quit">ANA MENÜ${quitPenalty ? ` <small style="color:#ff8a7a">(yenik sayılırsın: −${formatTL(LOSE_PENALTY)})</small>` : ''}</button></div></div></div>`;
    s.onclick = (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'resume') this.cb.resume();
      else if (a === 'shop') this.cb.openShop();
      else if (a === 'settings') this.openSettings(st);
      else if (a === 'quit') this.cb.quit();
    };
    this.show('pause');
  }
  closePause(): void {
    this.show('pause', false);
    this.show('settings', false);
  }

  // ------------------------------------------------------------------ wheel
  openWheel(save: SaveData, x: MenuExtras): void {
    const s = this.screens.wheel;
    const n = WHEEL.length;
    const cols = ['#ff5a5a', '#ffb800', '#3d8bff', '#9b5cff', '#36d17a', '#ff7ac8', '#2fd3d3', '#ffd84a'];
    const conic = WHEEL.map((_, i) => `${cols[i]} ${(i * 360) / n}deg ${((i + 1) * 360) / n}deg`).join(',');
    // labels sit on the segment centres, counter-rotated so they stay readable
    const labels = WHEEL.map((v, i) => {
      const a = ((i + 0.5) * 2 * Math.PI) / n;
      return `<span style="left:calc(50% + ${Math.sin(a) * 96}px);top:calc(50% - ${Math.cos(a) * 96}px)">${v.toLocaleString('tr-TR')}</span>`;
    }).join('');
    const can = x.canSpin;
    s.innerHTML = `<div class="overlay"><div class="panel wheelp"><h2>GÜNLÜK ŞANS ÇARKI</h2>
      <div class="wheel-wrap"><div class="pointer"></div><div class="wheel" style="background: conic-gradient(${conic})">${labels}<i></i></div></div>
      <div class="wres">${can ? 'Her gün 1 bedava çevirme hakkın var!' : 'Bugünkü hakkını kullandın. Yarın tekrar gel!'}</div>
      <div class="btns"><button class="btn primary" data-a="spin" ${can ? '' : 'disabled'}>ÇEVİR!</button><button class="btn" data-a="close">KAPAT</button></div></div></div>`;
    const wheel = s.querySelector('.wheel') as HTMLElement;
    s.onclick = (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'close') { this.show('wheel', false); this.showMenu(save, { ...x, canSpin: false }); }
      else if (a === 'spin') {
        const btn = s.querySelector('[data-a="spin"]') as HTMLButtonElement;
        if (btn.disabled) return;
        btn.disabled = true;
        const i = this.cb.spin();
        if (i < 0) return;
        // land segment i under the top pointer after 6 full turns
        const target = 360 * 6 + (360 - (i + 0.5) * (360 / n));
        wheel.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.12,1)';
        wheel.style.transform = `rotate(${target}deg)`;
        setTimeout(() => {
          (s.querySelector('.wres') as HTMLElement).innerHTML = `<b class="win">+${formatTL(WHEEL[i])}</b> kazandın!`;
          x.canSpin = false;
        }, 4300);
      }
    };
    this.show('wheel');
  }

  // ------------------------------------------------------------------ end
  showEnd(d: EndData, money: number): void {
    const s = this.screens.end;
    const won = d.winner === 'blue';
    const title = d.winner === 'draw' ? 'BERABERE' : won ? 'KAZANDIN!' : 'KAYBETTİN';
    const table = (team: 'blue' | 'red') => {
      const rows = d.combatants.filter((c) => c.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      return `<table class="${team === 'blue' ? 'tb' : 'tr'}"><tr><th>${team === 'blue' ? 'MAVİ' : 'KIRMIZI'}</th><th>L</th><th>Ö</th></tr>${rows
        .map((c) => `<tr class="${c === d.player ? 'me' : ''}"><td>${esc(c.name)}</td><td>${c.kills}</td><td>${c.deaths}</td></tr>`).join('')}</table>`;
    };
    s.innerHTML = `<div class="overlay"><div class="panel" style="min-width:min(640px,94vw)">
      <h1 class="end-title ${won ? 'win' : d.winner === 'draw' ? '' : 'lose'}">${title}</h1>
      <div class="end-score"><span class="b">${d.score.blue}</span><span>-</span><span class="r">${d.score.red}</span></div>
      <div class="earn"><span>Leşler (${d.kills} × 200 TL)</span><b>+${formatTL(d.killMoney)}</b>
        <span>${won ? 'Galibiyet bonusu' : d.winner === 'draw' ? 'Beraberlik bonusu' : 'Yenilgi cezası'}</span><b class="${d.bonus < 0 ? 'neg' : ''}">${d.bonus < 0 ? '−' + formatTL(-d.bonus) : '+' + formatTL(d.bonus)}</b>
        <span class="tot">Toplam param</span><b class="tot">${formatTL(money)}</b></div>
      <div class="teams">${table('blue')}${table('red')}</div>
      <div class="btns"><button class="btn primary" data-a="again">TEKRAR OYNA</button>
        <button class="btn green" data-a="shop">MAĞAZA</button><button class="btn" data-a="menu">ANA MENÜ</button></div></div></div>`;
    s.onclick = (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'again') this.cb.again();
      else if (a === 'shop') this.cb.openShop();
      else if (a === 'menu') this.cb.quit();
    };
    this.only('end');
  }
}
