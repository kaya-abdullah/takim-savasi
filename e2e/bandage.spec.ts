import { expect, test, type Page } from '@playwright/test';

// v5.6: bandages found in buildings go into the pocket and are wrapped later (H / bandage button).
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

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

/** Quiet match: no enemies; the player stands on the first bandage found indoors. */
async function onBandage(page: Page) {
  await g(page, `(() => { const m = g.match; m.brains.clear();
    for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; }
    const p = m.player, b = m.pickups.find((q) => q.kind === 'bandage');
    p.shieldT = 0; p.hp = p.maxHp; p.pos.copy(b.pos); return 0; })()`);
  await page.waitForTimeout(300);
}

test('desktop: walk over a bandage, it goes in the pocket; H wraps it and heals 50', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.big-play');
  await expect(page.locator('#hud')).toHaveClass(/on/);
  await onBandage(page);
  expect(await g(page, 'g.match.player.bandages')).toBe(1);
  expect(await g(page, 'g.match.player.hp')).toBe(100);
  // full health: H does nothing but says so
  await page.keyboard.press('KeyH');
  await expect(page.getByText('CANIN ZATEN DOLU')).toBeVisible();
  expect(await g(page, 'g.match.player.bandages')).toBe(1);
  await g(page, '(g.match.player.hp = 30, g.match.player.lastHurtT = g.match.time + 100, 0)');
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(500);
  expect(await g(page, 'g.match.player.bandageT')).toBeGreaterThan(0);
  await page.screenshot({ path: `${shots}/90-bandage-wrap.png` });
  await page.waitForFunction(() => (window as G).__game.match.player.bandageT === 0, null, { timeout: 5000 });
  expect(await g(page, 'Math.round(g.match.player.hp)')).toBe(80);
  expect(await g(page, 'g.match.player.bandages')).toBe(0);
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  test('the bandage button shows with one in the pocket, does not cover other buttons, and wraps it', async ({ page }) => {
    const errors = await boot(page);
    await page.tap('.big-play');
    await expect(page.locator('#hud')).toHaveClass(/on/);
    const btn = page.locator('.tc.bandage');
    await expect(btn).toBeHidden();
    await onBandage(page);
    await expect(btn).toBeVisible();
    await expect(btn.locator('.bc')).toHaveText('1');
    // inside the screen and clear of every other visible control
    const box = (await btn.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height).toBe(true);
    const others = await page.evaluate(() => Array.from(document.querySelectorAll('#hud .tc, #hud .venter, #minimap, #hud .inv, #hud .joy-hint'))
      .filter((e) => !e.classList.contains('bandage') && (e as HTMLElement).offsetParent !== null)
      .map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, x: r.x, y: r.y, w: r.width, h: r.height }; }));
    for (const o of others) {
      const hit = box.x < o.x + o.w && box.x + box.width > o.x && box.y < o.y + o.h && box.y + box.height > o.y;
      expect(hit, `overlaps ${o.c}`).toBe(false);
    }
    await g(page, '(g.match.player.hp = 40, g.match.player.lastHurtT = g.match.time + 100, 0)');
    await btn.tap();
    await page.waitForTimeout(600);
    await expect(btn).toHaveClass(/busy/);
    await page.screenshot({ path: `${shots}/91-phone-bandage.png` });
    await page.waitForFunction(() => (window as G).__game.match.player.bandageT === 0, null, { timeout: 5000 });
    expect(await g(page, 'Math.round(g.match.player.hp)')).toBe(90);
    await expect(btn).toBeHidden();
    expect(errors).toEqual([]);
  });
});
