import { expect, test, type Page } from '@playwright/test';

// v4: crouch, walk-in buildings, metro, vehicles, economy, difficulty — played with real keys.
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function boot(page: Page, money = 0) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  if (money) await g(page, `(g.save.money = ${money}, g.toMenu(), 0)`);
  return errors;
}

/** Starts a match with every bot frozen far away, so scripted moves are not disturbed. */
async function quietMatch(page: Page) {
  await page.click('.big-play');
  await expect(page.locator('#hud')).toHaveClass(/on/);
  await g(page, `(() => { const m = g.match; m.brains.clear(); for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; } })()`);
}

async function place(page: Page, x: number, y: number, z: number, yaw: number, pitch = 0) {
  await g(page, `(() => { const p = g.match.player; p.pos.set(${x}, ${y}, ${z}); p.velY = 0; p.vx = p.vz = 0; p.yaw = ${yaw}; p.pitch = ${pitch}; })()`);
}

async function holdKey(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

const pos = (page: Page) => g(page, 'g.match.player.pos.toArray()') as Promise<[number, number, number]>;

test('crouch: C lowers the fighter, jump stands back up', async ({ page }) => {
  const errors = await boot(page);
  await quietMatch(page);
  await place(page, -40, 0, 26, Math.PI / 2, -0.15);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  expect(await g(page, 'g.match.player.crouch')).toBe(true);
  expect(await g(page, 'g.match.player.crouchK')).toBeGreaterThan(0.9);
  await page.screenshot({ path: `${shots}/40-crouch.png` });
  // walking crouched is slower than standing
  const a = await pos(page);
  await holdKey(page, 'KeyW', 1000);
  const b = await pos(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await g(page, 'g.match.player.crouch')).toBe(false);
  const c = await pos(page);
  await holdKey(page, 'KeyW', 1000);
  const d = await pos(page);
  expect(b[0] - a[0]).toBeGreaterThan(1);
  expect(d[0] - c[0]).toBeGreaterThan((b[0] - a[0]) * 1.5);
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('building: walk in through the door, climb the stairs to the roof', async ({ page }) => {
  const errors = await boot(page);
  await quietMatch(page);
  // blue-side walk-in building x -58..-46, z 9..21; its z1 door is at x = -52
  await place(page, -52, 0, 23.5, Math.PI, 0);
  await page.screenshot({ path: `${shots}/41-door.png` });
  await holdKey(page, 'KeyW', 1200);
  let p = await pos(page);
  expect(p[2]).toBeLessThan(20); // inside
  await page.screenshot({ path: `${shots}/42-inside.png` });
  expect(await page.locator('#hud .lvl').textContent()).toBe('ZEMİN KAT');
  // stair run 1 (ground -> 1st floor) goes +x
  const l1 = await g(page, 'g.map.structures.links[0].pts');
  await place(page, l1[0].x - 0.3, 0, l1[0].z, Math.PI / 2, -0.1);
  await holdKey(page, 'KeyW', 1900);
  p = await pos(page);
  expect(p[1]).toBeCloseTo(3.5, 1);
  await page.waitForTimeout(150);
  expect(await page.locator('#hud .lvl').textContent()).toBe('1. KAT');
  await page.screenshot({ path: `${shots}/43-floor1.png` });
  // run 2 (1st floor -> roof) goes -x
  const l2 = await g(page, 'g.map.structures.links[1].pts');
  await place(page, l2[0].x + 0.3, 3.5, l2[0].z, -Math.PI / 2, -0.1);
  await holdKey(page, 'KeyW', 1900);
  p = await pos(page);
  expect(p[1]).toBeCloseTo(7, 1);
  await page.waitForTimeout(150);
  expect(await page.locator('#hud .lvl').textContent()).toBe('ÇATI');
  // turn to look over the city from the roof
  await g(page, '(g.match.player.yaw = 0, g.match.player.pitch = -0.2, 0)');
  await holdKey(page, 'KeyW', 600);
  expect((await pos(page))[1]).toBeCloseTo(7, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/44-roof.png` });
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('metro: walk down the stairs and fight underground', async ({ page }) => {
  const errors = await boot(page);
  await quietMatch(page);
  await place(page, -48, 0, 0, Math.PI / 2, -0.25);
  await page.screenshot({ path: `${shots}/45-metro-entrance.png` });
  await holdKey(page, 'KeyW', 2600);
  const p = await pos(page);
  expect(p[1]).toBeCloseTo(-4, 1);
  expect(p[0]).toBeGreaterThan(-40);
  await page.waitForTimeout(150);
  expect(await page.locator('#hud .lvl').textContent()).toBe('METRO');
  await page.screenshot({ path: `${shots}/46-metro.png` });
  // an enemy in the tunnel can be shot (bullets work underground)
  await g(page, `(() => { const m = g.match, p = m.player; const e = m.combatants.find(c => c.team === 'red'); p.yaw = Math.PI / 2; p.pitch = -0.05; e.alive = true; e.hp = e.maxHp; e.respawnT = 0; e.shieldT = 0; e.view.revive(); e.pos.set(p.pos.x + 8, -4, p.pos.z + 0.95); })()`);
  await page.waitForTimeout(200);
  await holdKey(page, 'KeyF', 1500);
  expect(await g(page, "g.match.combatants.find(c => c.team === 'red').hp")).toBeLessThan(await g(page, "g.match.combatants.find(c => c.team === 'red').maxHp"));
  await page.screenshot({ path: `${shots}/47-metro-fight.png` });
  // and back up the east stairs to the street
  await place(page, 38.5, -4, 0, Math.PI / 2, 0);
  await holdKey(page, 'KeyW', 2600);
  expect((await pos(page))[1]).toBeCloseTo(0, 1);
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('car: buy in the shop, call with T, drive, run over, get out with X', async ({ page }) => {
  const errors = await boot(page, 100000);
  await page.click('#menu .shop-btn');
  const card = page.locator('.card.veh').first();
  await expect(card).toContainText('Spor Araba');
  await expect(card).toContainText('30.000 TL');
  await page.screenshot({ path: `${shots}/48-shop-vehicles.png` });
  await card.locator('[data-a="veh"]').click();
  expect(await g(page, 'g.save.vehicles')).toEqual(['car']);
  expect(await g(page, 'g.save.money')).toBe(70000);
  await expect(card).toContainText('SENİN');
  await page.click('#shop [data-a="close"]');
  await quietMatch(page);
  await place(page, -66, 0, -5, Math.PI / 2, -0.1);
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(200);
  expect(await g(page, "g.match.player.vehicle && g.match.player.vehicle.kind")).toBe('car');
  await expect(page.locator('#hud .vhp')).toHaveClass(/on/);
  // an enemy stands in the road ahead
  await g(page, `(() => { const m = g.match, v = m.player.vehicle; const e = m.combatants.find(c => c.team === 'red'); e.alive = true; e.hp = e.maxHp; e.shieldT = 0; e.view.revive(); e.pos.set(v.pos.x + 14, 0, v.pos.z); })()`);
  const x0 = (await pos(page))[0];
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/49-car.png` });
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  expect((await pos(page))[0] - x0).toBeGreaterThan(10);
  expect(await g(page, 'g.match.player.kills')).toBe(1);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(200);
  expect(await g(page, 'g.match.player.vehicle')).toBeNull();
  expect(await g(page, 'g.match.vehicles.length')).toBe(1);
  await expect(page.locator('#hud .venter')).toHaveClass(/show/);
  // X again gets back in
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(200);
  expect(await g(page, "g.match.player.vehicle.kind")).toBe('car');
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('helicopter: buy, call with Y, climb, shoot cannon and rockets, land on a roof', async ({ page }) => {
  const errors = await boot(page, 50000);
  await page.click('#menu .shop-btn');
  await page.locator('.card.veh').nth(1).locator('[data-a="veh"]').click();
  expect(await g(page, 'g.save.vehicles')).toEqual(['heli']);
  expect(await g(page, 'g.save.money')).toBe(0);
  await page.click('#shop [data-a="close"]');
  await quietMatch(page);
  await place(page, -63, 0, -16, Math.PI / 2, -0.2);
  await page.keyboard.press('KeyY');
  await page.waitForTimeout(200);
  expect(await g(page, "g.match.player.vehicle.kind")).toBe('heli');
  await holdKey(page, 'Space', 3500);
  const alt = (await pos(page))[1];
  expect(alt).toBeGreaterThan(10);
  await page.screenshot({ path: `${shots}/50-heli-air.png` });
  // cannon
  await g(page, '(g.match.player.pitch = -0.5, 0)');
  const before = await g(page, 'g.match.player.vehicle.gun.ammo');
  await holdKey(page, 'KeyF', 800);
  expect(await g(page, 'g.match.player.vehicle.gun.ammo')).toBeLessThan(before);
  // rocket
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(100);
  expect(await g(page, 'g.match.player.vehicle.rocketCd')).toBeGreaterThan(0);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/51-heli-rocket.png` });
  // fly over the walk-in building and land on its roof
  await g(page, `(() => { const v = g.match.player.vehicle; v.pos.set(-52, 14, 15); v.vel.set(0, 0, 0); })()`);
  await holdKey(page, 'KeyC', 3500);
  const p = await pos(page);
  expect(p[1]).toBeCloseTo(7, 0);
  expect(await g(page, 'g.match.player.vehicle.onGround')).toBe(true);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(300);
  expect(await g(page, 'g.match.player.vehicle')).toBeNull();
  expect((await pos(page))[1]).toBeCloseTo(7, 0);
  await page.screenshot({ path: `${shots}/52-heli-roof.png` });
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('economy: win pays +1400 TL, a loss costs 400 TL, quitting while behind counts as a loss', async ({ page }) => {
  const errors = await boot(page, 1000);
  await quietMatch(page);
  await g(page, "(g.match.score.blue = 60, g.match.update(0.016), 0)");
  await expect(page.locator('#end')).toHaveClass(/on/, { timeout: 5000 });
  await expect(page.locator('#end .earn')).toContainText('+1.400 TL');
  expect(await g(page, 'g.save.money')).toBe(2400);
  await page.screenshot({ path: `${shots}/53-win.png` });
  await page.click('#end [data-a="again"]');
  await g(page, "(g.match.score.red = 60, g.match.update(0.016), 0)");
  await expect(page.locator('#end')).toHaveClass(/on/, { timeout: 5000 });
  await expect(page.locator('#end .earn')).toContainText('Yenilgi cezası');
  await expect(page.locator('#end .earn')).toContainText('−400 TL');
  expect(await g(page, 'g.save.money')).toBe(2000);
  await page.screenshot({ path: `${shots}/54-lose.png` });
  // quitting a match the enemy is winning costs the same
  await page.click('#end [data-a="again"]');
  await g(page, '(g.match.score.red = 5, g.pause(), 0)');
  await expect(page.locator('#pause [data-a="quit"]')).toContainText('−400 TL');
  await page.click('#pause [data-a="quit"]');
  expect(await g(page, 'g.state')).toBe('menu');
  expect(await g(page, 'g.save.money')).toBe(1600);
  // quitting while ahead is free
  await page.click('.big-play');
  await g(page, '(g.match.score.blue = 5, g.pause(), 0)');
  await page.click('#pause [data-a="quit"]');
  expect(await g(page, 'g.save.money')).toBe(1600);
  expect(errors).toEqual([]);
});

test('shop: sell a bought weapon (two taps), money comes back, the starter is equipped again', async ({ page }) => {
  const errors = await boot(page, 3500);
  await page.click('#menu .shop-btn');
  const card = page.locator('#shop .card', { hasText: 'Kartal Tüfek' });
  await card.locator('[data-a="buy"]').click();
  expect(await g(page, 'g.save.money')).toBe(0);
  const sell = card.locator('[data-a="sell"]');
  await expect(sell).toHaveText('SAT · 2.450 TL');
  await sell.click();
  await expect(card.locator('[data-a="sell"]')).toContainText('EMİN MİSİN?');
  expect(await g(page, 'g.save.money')).toBe(0); // first tap only arms
  await page.screenshot({ path: `${shots}/56-sell-confirm.png` });
  await card.locator('[data-a="sell"]').click();
  expect(await g(page, 'g.save.money')).toBe(2450);
  expect(await g(page, 'g.save.owned')).toEqual(['pistol']);
  expect(await g(page, 'g.save.equipped')).toBe('pistol');
  await expect(card.locator('[data-a="sell"]')).toHaveCount(0);
  // the starter has no sell button
  await expect(page.locator('#shop .card').first().locator('[data-a="sell"]')).toHaveCount(0);
  // selling in a match switches the player off the sold gun
  await g(page, '(g.save.money = 3500, g.ui.renderShop(g.save), 0)');
  await card.locator('[data-a="buy"]').click();
  await page.click('#shop [data-a="close"]');
  await page.click('.big-play');
  expect(await g(page, 'g.match.player.weapon.def.id')).toBe('rifle');
  await page.keyboard.press('KeyB');
  await card.locator('[data-a="sell"]').click();
  await card.locator('[data-a="sell"]').click();
  expect(await g(page, 'g.match.player.weapon.def.id')).toBe('pistol');
  expect(await g(page, 'g.ctrl.owned')).toEqual(['pistol']);
  expect(errors).toEqual([]);
});

test('difficulty setting changes bot toughness', async ({ page }) => {
  const errors = await boot(page);
  await page.click('#menu .settings-btn');
  await expect(page.locator('#settings [data-k="difficulty"] .on')).toHaveText('Zor');
  await page.click('#settings [data-k="difficulty"] [data-v="extreme"]');
  await page.click('#settings [data-a="close"]');
  await page.click('.big-play');
  expect(await g(page, "g.match.combatants.filter(c => !c.isPlayer).every(c => c.maxHp === 250)")).toBe(true);
  await g(page, 'g.toMenu()');
  await page.click('#menu .settings-btn');
  await page.click('#settings [data-k="difficulty"] [data-v="normal"]');
  await page.click('#settings [data-a="close"]');
  await page.click('.big-play');
  expect(await g(page, "g.match.combatants.filter(c => !c.isPlayer).every(c => c.maxHp === 100)")).toBe(true);
  // the setting survives a reload
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  expect(await g(page, 'g.save.settings.difficulty')).toBe('normal');
  expect(errors).toEqual([]);
});

test('full match on hard: bots fight across streets, roofs and the metro without errors', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  // fast-forward the simulation (the renderer keeps drawing every frame)
  let up = 0, down = 0;
  for (let i = 0; i < 20; i++) {
    const r = await g(page, `(() => { const m = g.match; let up = 0, down = 0; for (let k = 0; k < 90; k++) { m.update(1/30); for (const c of m.combatants) { if (c.alive && c.pos.y > 3.2) up++; if (c.alive && c.pos.y < -3.5) down++; } } return [up, down]; })()`) as [number, number];
    up += r[0];
    down += r[1];
    await page.waitForTimeout(50);
  }
  expect(await g(page, 'g.match.score.blue + g.match.score.red')).toBeGreaterThan(3);
  expect(up + down).toBeGreaterThan(0);
  await page.screenshot({ path: `${shots}/55-battle.png` });
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
