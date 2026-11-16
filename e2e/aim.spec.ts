import { expect, test, type Page } from '@playwright/test';

// The crosshair must stay put when the player does not move the mouse/finger.
type G = any;
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  expect(await g(page, 'g.save.settings.aimAssist')).toBe(true); // the default stays on
  await page.tap('.big-play').catch(() => page.click('.big-play'));
  await page.waitForFunction(() => (window as G).__game?.state === 'playing', null, { timeout: 30_000 });
  // alone on the avenue, then one enemy walking past 4 degrees right of the crosshair, 15 m away
  await g(page, `(() => { const m = g.match; m.brains.clear(); const p = m.player; p.maxHp = p.hp = 1e9; p.shieldT = 0; p.pos.set(-20, 0, 0); p.yaw = Math.PI / 2; p.pitch = 0;
    for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; }
    const e = m.combatants.find(c => c.team === 'red'); e.alive = true; e.respawnT = 0; e.hp = 1e9; e.shieldT = 0; e.view.revive(); e.view.root.visible = true;
    e.pos.set(-5, 0, -1.0); window.__iv = setInterval(() => { e.pos.z -= 0.01; }, 16); })()`);
  return errors;
}

const aim = (page: Page) => g(page, '[g.match.player.yaw, g.match.player.pitch]') as Promise<number[]>;
const deg = (a: number[], b: number[]) => [(b[0] - a[0]) * 57.3, (b[1] - a[1]) * 57.3];

test('mouse: the crosshair does not drift toward an enemy on its own', async ({ page }) => {
  const errors = await boot(page);
  const a = await aim(page);
  await page.waitForTimeout(2000);
  const [dy, dp] = deg(a, await aim(page));
  console.log('mouse drift', dy.toFixed(3), dp.toFixed(3));
  expect(Math.abs(dy)).toBeLessThan(0.01);
  expect(Math.abs(dp)).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  test('idle aim stays put; aim assist helps only while firing', async ({ page }) => {
    const errors = await boot(page);
    expect(await g(page, 'g.input.isTouch')).toBe(true);
    const a = await aim(page);
    await page.waitForTimeout(2000);
    const [dy] = deg(a, await aim(page));
    console.log('touch idle drift', dy.toFixed(3));
    expect(Math.abs(dy)).toBeLessThan(0.01);
    // hold the fire button with the enemy back at 4 degrees off (-z here = higher yaw): the view is pulled toward it
    await g(page, `(() => { clearInterval(window.__iv); const p = g.match.player; p.yaw = Math.PI / 2; p.pitch = 0; g.match.combatants.find(c => c.team === 'red').pos.set(-5, 0, -1.05); })()`);
    const cdp = await page.context().newCDPSession(page);
    const b = (await page.locator('.tc.fire').boundingBox())!;
    const before = await aim(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 4 }] });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const [fy] = deg(before, await aim(page));
    console.log('touch firing pull', fy.toFixed(3));
    expect(fy).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
});
