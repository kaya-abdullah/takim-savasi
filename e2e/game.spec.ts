import { expect, test, type Page } from '@playwright/test';

type G = any;
const shots = 'test-results/shots';

async function boot(page: Page, clear = true) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  if (clear) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  return errors;
}

const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

test('menu shows play and shop buttons', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.big-play')).toHaveText('OYNA');
  await expect(page.locator('#menu .shop-btn')).toBeVisible();
  await expect(page.locator('#menu .money')).toContainText('0 TL');
  await page.screenshot({ path: `${shots}/01-menu.png` });
  expect(errors).toEqual([]);
});

test('match: 10 vs 10, player moves and shoots, bots fight', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  await expect(page.locator('#hud')).toHaveClass(/on/);
  expect(await g(page, 'g.match.combatants.length')).toBe(20);
  expect(await g(page, "g.match.combatants.filter(c => c.team === 'blue').length")).toBe(10);
  expect(await g(page, 'g.match.player.team')).toBe('blue');
  const x0 = await g(page, 'g.match.player.pos.x');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyF');
  await page.keyboard.up('KeyW');
  const x1 = await g(page, 'g.match.player.pos.x');
  expect(x1).toBeGreaterThan(x0 + 3); // walked toward the enemy (east)
  const ammo = await g(page, 'g.match.player.weapon.ammo');
  const reloading = await g(page, 'g.match.player.weapon.reloading');
  expect(ammo < 12 || reloading).toBe(true);
  await page.screenshot({ path: `${shots}/02-ingame.png` });
  // let the bots fight for a while
  await page.waitForFunction(() => { const m = (window as G).__game.match; return m.score.blue + m.score.red >= 3; }, null, { timeout: 90_000 });
  await page.screenshot({ path: `${shots}/03-fight.png` });
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('headshot kill gives 200 + 50 TL and shows popup', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  await page.waitForTimeout(300);
  await g(page, "(() => { const m = g.match; const e = m.combatants.find(c => c.team === 'red'); e.shieldT = 0; m.damage(e, m.player, 999, true, m.player.weapon.def); })()");
  expect(await g(page, 'g.save.money')).toBe(250);
  await expect(page.locator('.popup').first()).toContainText('250 TL');
  await expect(page.locator('#killfeed')).toContainText('MUSTAFA');
  expect(await g(page, 'JSON.parse(localStorage.getItem("takim-savasi-save-v1")).money')).toBe(250);
  expect(errors).toEqual([]);
});

test('shop: tiered prices, buy rifle for 3500 TL, equip in match', async ({ page }) => {
  const errors = await boot(page);
  await page.click('#menu .shop-btn');
  await expect(page.locator('#shop .card:not(.gear):not(.veh)')).toHaveCount(11);
  await expect(page.locator('#shop .card.veh')).toHaveCount(2);
  await expect(page.locator('#shop .card').nth(1)).toContainText('1.500 TL eksik');
  await expect(page.locator('#shop .card').nth(10)).toContainText('10.000 TL eksik');
  await page.screenshot({ path: `${shots}/04-shop-empty.png` });
  await page.click('#shop .close');
  await g(page, '(g.save.money = 3800, g.toMenu())');
  await page.click('#menu .shop-btn');
  await page.click('#shop [data-a="buy"][data-id="rifle"]');
  expect(await g(page, 'g.save.money')).toBe(300);
  expect(await g(page, 'g.save.equipped')).toBe('rifle');
  await expect(page.locator('#shop .card.equipped')).toContainText('Kartal Tüfek');
  await page.screenshot({ path: `${shots}/05-shop-bought.png` });
  await page.click('#shop .close');
  await page.click('.big-play');
  expect(await g(page, 'g.match.player.weapon.def.id')).toBe('rifle');
  // in-match shop (B key on desktop; mouse is pointer-locked) pauses the game
  await page.keyboard.press('KeyB');
  await expect(page.locator('#shop')).toHaveClass(/on/);
  expect(await g(page, 'g.state')).toBe('paused');
  await page.click('#shop [data-a="equip"][data-id="pistol"]');
  await page.click('#shop .close');
  expect(await g(page, 'g.state')).toBe('playing');
  expect(await g(page, 'g.match.player.weapon.def.id')).toBe('pistol');
  // progress survives a restart
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  expect(await g(page, 'g.save.owned')).toEqual(['pistol', 'rifle']);
  expect(await g(page, 'g.save.money')).toBe(300);
  expect(errors).toEqual([]);
});

test('match end: win screen and bonus', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  await page.waitForTimeout(300);
  await g(page, "(() => { const m = g.match; m.score.blue = m.killLimit - 1; const e = m.combatants.find(c => c.team === 'red'); e.shieldT = 0; m.damage(e, m.player, 999, false, m.player.weapon.def); m.update(0.016); })()");
  await expect(page.locator('#end')).toHaveClass(/on/, { timeout: 5000 });
  await expect(page.locator('.end-title')).toHaveText('KAZANDIN!');
  expect(await g(page, 'g.save.money')).toBe(200 + 1400);
  expect(await g(page, 'g.save.wins')).toBe(1);
  await page.screenshot({ path: `${shots}/06-end.png` });
  await page.click('[data-a="again"]');
  expect(await g(page, 'g.state')).toBe('playing');
  expect(errors).toEqual([]);
});

test('settings: switching quality keeps the game running', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.settings-btn');
  await page.click('#settings [data-k="quality"] [data-v="low"]');
  await page.click('#settings [data-a="close"]');
  await page.click('.big-play');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/07-low.png` });
  expect(await g(page, 'g.save.settings.quality')).toBe('low');
  expect(await g(page, 'g.frames')).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test.describe('touch device', () => {
  test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  test('touch controls are shown and work', async ({ page }) => {
    const errors = await boot(page);
    await page.screenshot({ path: `${shots}/08-mobile-menu.png` });
    await page.tap('.big-play');
    await expect(page.locator('.tc.fire')).toBeVisible();
    await expect(page.locator('.tc.grenade')).toBeVisible();
    await expect(page.locator('.tc.knife')).toBeVisible();
    await expect(page.locator('#hud .shop-btn')).toBeVisible();
    // shop button sits in the bottom-right corner
    const box = (await page.locator('#hud .shop-btn').boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(915 - 40);
    expect(box.y + box.height).toBeGreaterThan(412 - 40);
    // hold fire via pointer events on the button
    const fire = page.locator('.tc.fire');
    const fb = (await fire.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const pt = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const ammo = await g(page, 'g.match.player.weapon.ammo');
    expect(ammo).toBeLessThan(12);
    // joystick: drag on the left side moves the player
    const x0 = await g(page, 'g.match.player.pos.x');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300 }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 300 - i * 12 }] });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/09-mobile-game.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const x1 = await g(page, 'g.match.player.pos.x');
    expect(Math.abs(x1 - x0)).toBeGreaterThan(2);
    // tapping the bottom-right MAĞAZA button opens the shop and pauses
    await page.tap('#hud .shop-btn');
    await expect(page.locator('#shop')).toHaveClass(/on/);
    expect(await g(page, 'g.state')).toBe('paused');
    await page.screenshot({ path: `${shots}/10-mobile-shop.png` });
    await page.tap('#shop .close');
    expect(await g(page, 'g.state')).toBe('playing');
    expect(errors).toEqual([]);
  });
});

test('grenade: hold G to aim, release to throw; knife with V', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  await page.waitForTimeout(500);
  expect(await g(page, 'g.match.player.grenades')).toBe(3);
  await page.keyboard.down('KeyG');
  await page.waitForTimeout(300);
  expect(await g(page, 'g.ctrl.grenadeAiming')).toBe(true);
  expect(await g(page, 'g.arcDots.visible')).toBe(true);
  await page.keyboard.up('KeyG');
  await page.waitForTimeout(200);
  expect(await g(page, 'g.match.player.grenades')).toBe(2);
  expect(await g(page, 'g.match.grenades.length')).toBe(1);
  await page.waitForTimeout(2500);
  expect(await g(page, 'g.match.grenades.length')).toBe(0); // exploded
  // knife: put an enemy right in front, turned away -> backstab kill + knife bonus
  await g(page, `(() => { const m = g.match, p = m.player; const e = m.combatants.find(c => c.team === 'red' && c.alive);
    e.shieldT = 0; g.__e = e; m.brains.delete(e); p.yaw = Math.PI / 2; e.yaw = Math.PI / 2;
    e.pos.set(p.pos.x + 1.2, 0, p.pos.z); })()`);
  const money0 = await g(page, 'g.save.money');
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(200);
  expect(await g(page, 'g.__e.alive')).toBe(false);
  expect(await g(page, 'g.save.money')).toBe(money0 + 300);
  await expect(page.locator('#killfeed')).toContainText('Bıçak');
  expect(errors).toEqual([]);
});

test('kill streak shows banner and pays bonus; equipment upgrade gives more grenades and HP', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  await page.waitForTimeout(300);
  await g(page, `(() => { const m = g.match; for (const e of m.combatants.filter(c => c.team === 'red').slice(0, 3)) { e.shieldT = 0; m.damage(e, m.player, 999, false, m.player.weapon.def); } })()`);
  await expect(page.locator('.banner')).toContainText('ÜÇLÜ LEŞ!');
  expect(await g(page, 'g.save.money')).toBe(3 * 200 + 100);
  await page.screenshot({ path: `${shots}/11-streak.png` });
  await g(page, '(g.save.money = 5000, g.toMenu())');
  await page.click('#menu .shop-btn');
  await page.click('#shop [data-a="up"][data-id="bag"]');
  await page.click('#shop [data-a="up"][data-id="armor"]');
  expect(await g(page, 'g.save.upgrades')).toEqual({ bag: 1, armor: 1 });
  expect(await g(page, 'g.save.money')).toBe(5000 - 1500 - 2500);
  await page.locator('#shop .sec').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/12-equipment.png` });
  await page.click('#shop .close');
  await page.click('.big-play');
  expect(await g(page, 'g.match.player.grenades')).toBe(4);
  expect(await g(page, 'g.match.player.maxHp')).toBe(125);
  expect(errors).toEqual([]);
});

test('sprint drains stamina; dropped gun goes to the inventory bar and can be selected', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  await page.waitForTimeout(400);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(1200);
  expect(await g(page, 'g.match.player.sprinting')).toBe(true);
  expect(await g(page, 'g.match.player.stamina')).toBeLessThan(0.95);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  // kill a bot carrying an LMG right next to the player: the gun drops at the player's feet
  await g(page, `(() => { const m = g.match, p = m.player; const e = m.combatants.find(c => c.team === 'red' && c.alive);
    m.brains.delete(e); e.setWeapon(g.weaponDef('lmg')); e.shieldT = 0;
    e.pos.set(p.pos.x + 0.5, 0, p.pos.z); m.damage(e, p, 999, false, p.weapon.def); })()`);
  await page.waitForTimeout(1200);
  await expect(page.locator('#hud .inv .slot')).toHaveCount(2);
  await expect(page.locator('#hud .inv .slot.temp')).toHaveCount(1);
  await page.screenshot({ path: `${shots}/13-inventory.png` });
  await page.keyboard.press('Digit1');
  expect(await g(page, 'g.match.player.weapon.def.id')).toBe('pistol');
  await page.keyboard.press('Digit2');
  expect(await g(page, 'g.match.player.weapon.def.id')).not.toBe('pistol');
  expect(errors).toEqual([]);
});
