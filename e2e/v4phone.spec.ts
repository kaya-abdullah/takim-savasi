import { expect, test, type CDPSession, type Page } from '@playwright/test';

// v4 on a phone: every new on-screen control driven with real touch events.
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

async function touch(cdp: CDPSession, page: Page, sel: string, ms = 60) {
  const b = (await page.locator(sel).boundingBox())!;
  expect(b, sel).toBeTruthy();
  const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 3 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
}

/** Pushes the virtual joystick forward for ms while optionally holding a second button. */
async function joystick(cdp: CDPSession, page: Page, ms: number, holdSel?: string) {
  const start = { x: 150, y: 290, id: 1 };
  const pts = [start];
  let hb: { x: number; y: number; id: number } | null = null;
  if (holdSel) {
    const b = (await page.locator(holdSel).boundingBox())!;
    hb = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 2 };
    pts.push(hb);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y - 70 }, ...(hb ? [hb] : [])] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
}

async function inViewport(page: Page, sel: string) {
  const b = (await page.locator(sel).first().boundingBox())!;
  expect(b, sel).toBeTruthy();
  expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(0);
  expect(b.x, `${sel} left`).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, `${sel} bottom inside screen`).toBeLessThanOrEqual(391);
  expect(b.x + b.width, `${sel} right inside screen`).toBeLessThanOrEqual(845);
}

/** No two visible controls may overlap (a finger would hit the wrong one). */
async function noOverlap(page: Page) {
  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('#hud .tc, #hud .venter.show, #hud .shop-btn, #hud .icon-btn, #hud .hpm, #minimap'))
    .filter((e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; })
    .map((e) => { const r = e.getBoundingClientRect(); return { n: e.className, x: r.x, y: r.y, w: r.width, h: r.height }; })
    .filter((r) => r.w > 0));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ov = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2;
      expect(ov, `${a.n} overlaps ${b.n}`).toBe(false);
    }
}

test('phone: crouch button, vehicle buttons, driving and flying by touch', async ({ page }) => {
  const errors = await boot(page);
  const cdp = await page.context().newCDPSession(page);
  // own both vehicles
  await g(page, "(g.save.money = 80000, g.toMenu(), 0)");
  await page.tap('#menu .shop-btn');
  await page.locator('.card.veh').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/60-phone-shop-vehicles.png` });
  await page.locator('.card.veh [data-a="veh"]').first().tap();
  await page.locator('.card.veh [data-a="veh"]').first().tap();
  expect(await g(page, 'g.save.vehicles')).toEqual(['tank', 'jet']);
  await page.tap('#shop [data-a="close"]');
  await page.tap('.big-play');
  await expect(page.locator('#hud')).toHaveClass(/on/);
  await g(page, `(() => { const m = g.match; m.brains.clear(); for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; } const p = m.player; p.pos.set(-66, 0, -5); p.yaw = Math.PI / 2; p.pitch = -0.1; })()`);
  for (const sel of ['.tc.crouch', '.tc.vcall.tank', '.tc.vcall.jet', '.tc.fire', '.tc.jump', '.tc.grenade']) {
    await expect(page.locator(sel)).toBeVisible();
    await inViewport(page, sel);
  }
  await noOverlap(page);
  await page.screenshot({ path: `${shots}/61-phone-hud.png` });

  // crouch toggles on and off
  await touch(cdp, page, '.tc.crouch');
  expect(await g(page, 'g.match.player.crouch')).toBe(true);
  await expect(page.locator('.tc.crouch')).toHaveClass(/active/);
  await touch(cdp, page, '.tc.crouch');
  expect(await g(page, 'g.match.player.crouch')).toBe(false);

  // tank: tap the tank button, drive with the joystick, tap İN
  await touch(cdp, page, '.tc.vcall.tank');
  expect(await g(page, 'g.match.player.vehicle && g.match.player.vehicle.kind')).toBe('tank');
  await expect(page.locator('#hud')).toHaveClass(/in-tank/);
  await expect(page.locator('.tc.knife')).toBeHidden();
  const x0 = await g(page, 'g.match.player.pos.x');
  await joystick(cdp, page, 1200);
  expect(await g(page, 'g.match.player.pos.x')).toBeGreaterThan(x0 + 5);
  await page.screenshot({ path: `${shots}/62-phone-tank.png` });
  await noOverlap(page);
  await touch(cdp, page, '.venter');
  expect(await g(page, 'g.match.player.vehicle')).toBeNull();
  await expect(page.locator('.venter')).toHaveText('BİN');
  await touch(cdp, page, '.venter');
  expect(await g(page, 'g.match.player.vehicle.kind')).toBe('tank');
  await touch(cdp, page, '.venter');

  // jet: tap, hold ▲ (jump) to climb, fire, bomb, hold ▼ (crouch) to come down
  await g(page, '(g.match.vehicleCd.jet = 0, 0)');
  await touch(cdp, page, '.tc.vcall.jet');
  expect(await g(page, 'g.match.player.vehicle.kind')).toBe('jet');
  await expect(page.locator('#hud')).toHaveClass(/in-jet/);
  await touch(cdp, page, '.tc.jump', 2500);
  const alt = await g(page, 'g.match.player.pos.y');
  expect(alt).toBeGreaterThan(8);
  await expect(page.locator('#hud .lvl')).toContainText('İRTİFA');
  const ammo = await g(page, 'g.match.player.vehicle.gun.ammo');
  await touch(cdp, page, '.tc.fire', 600);
  expect(await g(page, 'g.match.player.vehicle.gun.ammo')).toBeLessThan(ammo);
  // aimed at the sky: nothing within half the map, so the rocket stays and the screen says so
  await g(page, '(g.match.player.pitch = 0.3, 0)');
  await touch(cdp, page, '.tc.grenade');
  expect(await g(page, 'g.match.player.vehicle.rocketCd')).toBe(0);
  await expect(page.getByText('ÇOK UZAK')).toBeVisible();
  // aimed at the ground nearby: it fires
  await g(page, '(g.match.player.pitch = -0.7, 0)');
  await touch(cdp, page, '.tc.grenade');
  expect(await g(page, 'g.match.player.vehicle.rocketCd')).toBeGreaterThan(0);
  await joystick(cdp, page, 800);
  await page.screenshot({ path: `${shots}/63-phone-jet.png` });
  await noOverlap(page);
  await touch(cdp, page, '.tc.crouch', 1500);
  expect(await g(page, 'g.match.player.pos.y')).toBeLessThan(alt);
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
