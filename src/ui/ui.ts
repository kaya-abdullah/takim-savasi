import type { Btn, Input } from '../core/input';
import type { SaveData, Settings } from '../core/save';
import { SHOP_WEAPONS, STARTER, getWeapon, weaponStats, type WeaponDef } from '../data/weapons';
import { formatTL } from '../game/economy';
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
  phone: '<svg viewBox="0 0 24 24"><path d="M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 4v14h10V5z"/></svg>',
};

export interface UICallbacks {
  play(): void;
  openShop(): void;
  closeShop(): void;
  buy(id: string): void;
  equip(id: string): void;
  settings(s: Partial<Settings>): void;
  pause(): void;
  resume(): void;
  quit(): void;
  again(): void;
  switchWeapon(): void;
}

export interface EndData {
  winner: 'blue' | 'red' | 'draw';
  score: { blue: number; red: number };
  kills: number;
  deaths: number;
  killMoney: number;
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
    keys: HTMLElement;
  };
  readonly minimap: HTMLCanvasElement;
  private last: Record<string, string | number | boolean> = {};
  private hitTimer = 0;
  private dmgIdx = 0;

  constructor(root: HTMLElement, private cb: UICallbacks, private input: Input) {
    this.root = root;
    for (const id of ['loading', 'menu', 'hud', 'shop', 'settings', 'pause', 'end']) {
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
    const t = el('div', 'toast');
    t.textContent = msg;
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  // ------------------------------------------------------------------ menu
  showMenu(save: SaveData): void {
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
        <div class="hint">10'a 10 takım savaşı. Her leş <b style="color:var(--gold)">200 TL</b>, kazanırsan <b style="color:var(--gold)">+1000 TL</b>. Mağazada her silah 7.000 TL.</div>
      </div>
      <button class="shop-btn" data-a="shop">${ICON.cart}MAĞAZA</button>`;
    s.onclick = (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'play') this.cb.play();
      else if (a === 'shop') this.cb.openShop();
      else if (a === 'settings') this.openSettings(save.settings);
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
      <div class="hpm"><div class="lbl"><span><span id="hpt">100</span> ❤</span><span class="ammo"><span id="am">12</span><small id="wn"></small></span></div><div class="bar"><i id="hpb"></i></div></div>
      <div class="money"><span class="coin">₺</span><span id="mn">0 TL</span></div>
      <div class="joy-hint">YÜRÜ</div>
      <button class="tc fire" data-b="fire" data-look="1" aria-label="Ateş">${ICON.fire}</button>
      <button class="tc fire2" data-b="fire" aria-label="Ateş">${ICON.fire}</button>
      <button class="tc aim" data-b="aim" aria-label="Nişan">${ICON.aim}</button>
      <button class="tc jump" data-b="jump" aria-label="Zıpla">${ICON.jump}</button>
      <button class="tc reload" data-b="reload" aria-label="Şarjör">${ICON.reload}</button>
      <button class="tc switch" data-b="switch" aria-label="Silah değiştir">${ICON.swap}</button>
      <button class="shop-btn" data-a="shop">${ICON.cart}MAĞAZA</button>
      <div class="keys">WASD yürü · Fare nişan · Sol tık ateş · Sağ tık/E dürbün · R şarjör · Space zıpla · Q silah · B mağaza · Esc duraklat</div>
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
    };
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
    blue: number; red: number; limit: number; timeLeft: number; hp: number; ammo: number; mag: number; weapon: string;
    reloadFrac: number; money: number; aiming: boolean; scope: boolean; enemyUnderCross: boolean; owned: number; dt: number;
  }): void {
    const h = this.hud;
    this.set('b', d.blue, () => { h.sb.textContent = String(d.blue); h.sbBar.style.width = `${(100 * d.blue) / d.limit}%`; });
    this.set('r', d.red, () => { h.sr.textContent = String(d.red); h.srBar.style.width = `${(100 * d.red) / d.limit}%`; });
    const tl = Math.max(0, Math.ceil(d.timeLeft));
    this.set('t', tl, () => (h.time.textContent = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`));
    const hp = Math.max(0, Math.round(d.hp));
    this.set('hp', hp, () => {
      h.hpTxt.textContent = String(hp);
      h.hp.style.width = `${hp}%`;
      h.hp.classList.toggle('low', hp <= 30);
      h.vign.style.opacity = hp <= 30 && hp > 0 ? '0.8' : '0';
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
    this.set('sw', d.owned > 1, () => (h.switchBtn.style.visibility = d.owned > 1 ? '' : 'hidden'));
    const rel = d.reloadFrac > 0;
    this.set('rel', rel, () => (h.reload.style.display = rel ? 'block' : 'none'));
    if (rel) h.reloadI.style.width = `${Math.round(d.reloadFrac * 100)}%`;
    if (this.hitTimer > 0) {
      this.hitTimer -= d.dt;
      if (this.hitTimer <= 0) h.hit.classList.remove('on');
    }
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
      else if (a === 'equip') this.cb.equip(id);
    };
    this.renderShop(save);
    this.show('shop');
    if (!inMatch) this.show('menu', false);
  }

  renderShop(save: SaveData): void {
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
      return `<div class="card ${owned ? 'owned' : ''} ${eq ? 'equipped' : ''} ${poor ? 'poor' : ''}">
        <span class="num">${i === 0 ? 'BAŞLANGIÇ' : '#' + i}</span>${owned ? '<span class="tag">SENİN</span>' : ''}
        <div class="pic">${this.icons[w.id] ? `<img src="${this.icons[w.id]}" alt="">` : ''}</div>
        <h3>${esc(w.name)}</h3><p>${esc(w.desc)}</p>
        <div class="bars"><b>Hasar</b>${bar(st.damage)}<b>Hız</b>${bar(st.rate)}<b>Menzil</b>${bar(st.range)}<b>Şarjör</b>${bar(st.mag)}</div>
        ${act}</div>`;
    }).join('');
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
      <div class="row">Nişan yardımı ${seg('aimAssist', [['1', 'Açık'], ['0', 'Kapalı']], st.aimAssist ? '1' : '0')}</div>
      <div class="btns"><button class="btn primary" data-a="close">TAMAM</button></div></div></div>`;
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
    };
    const range = s.querySelector('input') as HTMLInputElement;
    range.oninput = () => this.cb.settings({ sensitivity: parseFloat(range.value) });
    this.show('settings');
  }

  // ------------------------------------------------------------------ pause
  openPause(st: Settings): void {
    const s = this.screens.pause;
    s.innerHTML = `<div class="overlay"><div class="panel"><h2>DURAKLATILDI</h2>
      <div class="btns" style="flex-direction:column">
        <button class="btn primary" data-a="resume">DEVAM ET</button>
        <button class="btn green" data-a="shop">MAĞAZA</button>
        <button class="btn" data-a="settings">AYARLAR</button>
        <button class="btn" data-a="quit">ANA MENÜ</button></div></div></div>`;
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
        <span>${won ? 'Galibiyet bonusu' : d.winner === 'draw' ? 'Beraberlik bonusu' : 'Katılım bonusu'}</span><b>+${formatTL(d.bonus)}</b>
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
