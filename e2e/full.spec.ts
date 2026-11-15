import { expect, test, type CDPSession, type Page } from '@playwright/test';

// Every on-screen control, driven with real touch events at phone size.
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

test.use({
  viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
});

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  return errors;
}

async function hold(cdp: CDPSession, page: Page, sel: string, ms: number) {
  const b = (await page.locator(sel).boundingBox())!;
  const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
}

async function inViewport(page: Page, sel: string) {
  const b = (await page.locator(sel).first().boundingBox())!;
  expect(b, sel).toBeTruthy();
  expect(b.y + b.height, `${sel} bottom inside screen`).toBeLessThanOrEqual(390 + 1);
  expect(b.x + b.width, `${sel} right inside screen`).toBeLessThanOrEqual(844 + 1);
}

test('phone: every menu, shop, wheel and settings control', async ({ page }) => {
  const errors = await boot(page);
  // Android browser visitors get the app download link
  await expect(page.locator('#menu .notice')).toContainText('Android uygulamasını indir');
  for (const sel of ['.big-play', '#menu .shop-btn', '#menu .wheel-btn', '#menu .settings-btn']) await inViewport(page, sel);
  await page.screenshot({ path: `${shots}/20-phone-menu.png` });

  // daily wheel
  await page.locator('#menu .wheel-btn').tap({ force: true }); // it wobbles to attract attention
  await expect(page.locator('#wheel')).toHaveClass(/on/);
  await inViewport(page, '#wheel [data-a="spin"]');
  await page.tap('#wheel [data-a="spin"]');
  await page.waitForTimeout(4600);
  const won = await g(page, 'g.save.money');
  expect(won).toBeGreaterThan(0);
  await expect(page.locator('#wheel .wres')).toContainText('kazandın');
  await page.screenshot({ path: `${shots}/21-wheel.png` });
  await page.tap('#wheel [data-a="close"]');
  await expect(page.locator('#menu .wheel-btn b')).toHaveCount(0); // no "!" badge after spinning

  // settings: every option
  await page.tap('#menu .settings-btn');
  await page.tap('#settings [data-k="quality"] [data-v="low"]');
  await page.tap('#settings [data-k="sound"] [data-v="0"]');
  await page.tap('#settings [data-k="aimAssist"] [data-v="0"]');
  await page.locator('#settings input[type=range]').fill('1.5');
  await inViewport(page, '#settings [data-a="close"]');
  await page.tap('#settings [data-a="close"]');
  expect(await g(page, 'JSON.stringify(g.save.settings)')).toBe(JSON.stringify({ quality: 'low', sensitivity: 1.5, sound: false, aimAssist: false }));
  await page.tap('#menu .settings-btn');
  await page.tap('#settings [data-k="quality"] [data-v="medium"]');
  await page.tap('#settings [data-k="sound"] [data-v="1"]');
  await page.tap('#settings [data-k="aimAssist"] [data-v="1"]');
  await page.tap('#settings [data-a="close"]');

  // shop: scroll to the bottom with a finger, buy equipment and two weapons
  await g(page, '(g.save.money = 9000, g.toMenu())');
  await page.tap('#menu .shop-btn');
  const cdp = await page.context().newCDPSession(page);
  for (let k = 0; k < 4; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 420, y: 330 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 420, y: 330 - i * 28 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
  }
  expect(await page.evaluate(() => document.querySelector('#shop .grid')!.scrollTop)).toBeGreaterThan(300);
  await page.locator('#shop [data-a="up"][data-id="bag"]').tap();
  await page.locator('#shop [data-a="buy"][data-id="smg"]').tap();
  await page.locator('#shop [data-a="buy"][data-id="revolver"]').tap();
  expect(await g(page, 'g.save.owned')).toEqual(['pistol', 'smg', 'revolver']);
  expect(await g(page, 'g.save.money')).toBe(9000 - 1500 - 1500 - 2000);
  await page.locator('#shop [data-a="equip"][data-id="smg"]').tap();
  expect(await g(page, 'g.save.equipped')).toBe('smg');
  await page.tap('#shop .close');
  await expect(page.locator('#menu')).toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test('phone: every in-match control, pause flow, death and end screen', async ({ page }) => {
  const errors = await boot(page);
  await g(page, "(g.save.owned = ['pistol', 'smg'], g.save.equipped = 'smg', g.toMenu())");
  await page.tap('.big-play');
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  for (const sel of ['.tc.fire', '.tc.fire2', '.tc.aim', '.tc.jump', '.tc.reload', '.tc.switch', '.tc.grenade', '.tc.knife', '#hud .shop-btn', '#hud .pause']) {
    await expect(page.locator(sel), sel).toBeVisible();
    await inViewport(page, sel);
  }
  // fire (right) and fire (left) both shoot
  await hold(cdp, page, '.tc.fire', 600);
  const a1 = await g(page, 'g.match.player.weapon.ammo');
  expect(a1).toBeLessThan(30);
  await hold(cdp, page, '.tc.fire2', 400);
  expect(await g(page, 'g.match.player.weapon.ammo')).toBeLessThan(a1);
  // reload
  await hold(cdp, page, '.tc.reload', 60);
  expect(await g(page, 'g.match.player.weapon.reloading')).toBe(true);
  // aim toggles on and off
  await hold(cdp, page, '.tc.aim', 60);
  expect(await g(page, 'g.match.player.aiming')).toBe(true);
  await hold(cdp, page, '.tc.aim', 60);
  expect(await g(page, 'g.match.player.aiming')).toBe(false);
  // jump leaves the ground
  await hold(cdp, page, '.tc.jump', 60);
  expect(await g(page, 'g.match.player.pos.y')).toBeGreaterThan(0.05);
  await page.waitForTimeout(800);
  // switch weapon cycles smg -> pistol
  await hold(cdp, page, '.tc.switch', 60);
  expect(await g(page, 'g.match.player.weapon.def.id')).toBe('pistol');
  // grenade: hold shows the arc, release throws
  const b = (await page.locator('.tc.grenade').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(300);
  expect(await g(page, 'g.arcDots.visible')).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  expect(await g(page, 'g.match.player.grenades')).toBe(2);
  // knife swings
  await hold(cdp, page, '.tc.knife', 60);
  expect(await g(page, 'g.match.player.meleeCd')).toBeGreaterThan(0);
  // look: drag on the right half turns the view
  const yaw0 = await g(page, 'g.match.player.yaw');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 560, y: 140 }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 560 + i * 15, y: 140 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  expect(Math.abs((await g(page, 'g.match.player.yaw')) - yaw0)).toBeGreaterThan(0.1);
  await page.screenshot({ path: `${shots}/22-phone-controls.png` });

  // pause -> settings -> back -> shop -> back -> resume
  await page.tap('#hud .pause');
  expect(await g(page, 'g.state')).toBe('paused');
  await page.tap('#pause [data-a="settings"]');
  await page.tap('#settings [data-a="close"]');
  await expect(page.locator('#pause')).toHaveClass(/on/);
  await page.tap('#pause [data-a="shop"]');
  await expect(page.locator('#shop')).toHaveClass(/on/);
  await page.tap('#shop .close');
  await page.tap('#pause [data-a="resume"]');
  expect(await g(page, 'g.state')).toBe('playing');

  // a power-up under the player is collected and shown
  await g(page, "(() => { const m = g.match, p = m.player; m.spawnPickup('damage', p.pos.clone()); })()");
  await page.waitForTimeout(200);
  expect(await g(page, 'g.match.player.dmgBuffT')).toBeGreaterThan(5);
  await expect(page.locator('#hud .buffs')).toContainText('2X HASAR');
  // supply drop gives a premium weapon for this life only
  await g(page, "(() => { const m = g.match, p = m.player; const d = m.spawnPickup('airdrop', p.pos.clone()); d.pos.y = 0.2; })()");
  await page.waitForTimeout(300);
  expect(['minigun', 'rocket', 'plasma', 'sniper', 'lmg']).toContain(await g(page, 'g.match.player.weapon.def.id'));
  await page.screenshot({ path: `${shots}/23-airdrop.png` });

  // death overlay, then respawn with the owned weapon back
  await g(page, "(() => { const m = g.match; const e = m.combatants.find(c => c.team === 'red'); m.player.shieldT = 0; m.damage(m.player, e, 999, false, e.weapon.def); })()");
  await expect(page.locator('#hud .death')).toHaveClass(/on/);
  await page.waitForFunction(() => (window as G).__game.match.player.alive, null, { timeout: 8000 });
  await page.waitForTimeout(200);
  await expect(page.locator('#hud .death')).not.toHaveClass(/on/);
  expect(['smg', 'pistol']).toContain(await g(page, 'g.match.player.weapon.def.id'));

  // win -> end screen buttons are reachable on a phone
  await g(page, "(() => { const m = g.match; m.score.blue = m.killLimit - 1; const e = m.combatants.find(c => c.team === 'red' && c.alive); e.shieldT = 0; m.damage(e, m.player, 999, false, m.player.weapon.def); m.update(0.016); })()");
  await expect(page.locator('#end')).toHaveClass(/on/, { timeout: 5000 });
  for (const sel of ['#end [data-a="again"]', '#end [data-a="shop"]', '#end [data-a="menu"]']) await inViewport(page, sel);
  await page.screenshot({ path: `${shots}/24-phone-end.png` });
  await page.tap('#end [data-a="shop"]');
  await page.tap('#shop .close');
  await page.tap('#end [data-a="menu"]');
  await expect(page.locator('#menu')).toHaveClass(/on/);
  await page.tap('.big-play');
  expect(await g(page, 'g.state')).toBe('playing');
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('phone portrait shows the rotate hint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#rotate')).toBeVisible();
});

test('version.json matches the app version', async ({ page }) => {
  const r = await page.request.get('/version.json');
  const v = await r.json();
  await page.goto('/');
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  await expect(page.locator('#menu .ver')).toHaveText('v' + v.version);
});
