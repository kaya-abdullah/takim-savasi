import { expect, test, type Page } from '@playwright/test';

// v5.7: FPS limit in settings (30 / 60 / 100); the loop never runs faster than the chosen cap.
type G = any;

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

const framesIn = (page: Page, ms: number) => page.evaluate(async (ms) => {
  const g = (window as G).__game; const f0 = g.frames;
  await new Promise((r) => setTimeout(r, ms));
  return ((g.frames - f0) * 1000) / ms;
}, ms);

test('settings: FPS limit row defaults to 100, 30 caps the loop and is saved', async ({ page }) => {
  const errors = await boot(page);
  await page.click('.settings-btn');
  const row = page.locator('.seg[data-k="fpsLimit"]');
  await expect(row).toBeVisible();
  await expect(row.locator('button.on')).toHaveText('100');
  await row.locator('button[data-v="30"]').click();
  await expect(row.locator('button.on')).toHaveText('30');
  expect(await page.evaluate(() => (window as G).__game.save.settings.fpsLimit)).toBe(30);
  const fps30 = await framesIn(page, 2000);
  expect(fps30).toBeLessThanOrEqual(32);
  expect(fps30).toBeGreaterThan(10);
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  expect(await page.evaluate(() => (window as G).__game.save.settings.fpsLimit)).toBe(30);
  await page.click('.settings-btn');
  await page.locator('.seg[data-k="fpsLimit"] button[data-v="100"]').click();
  expect(await framesIn(page, 2000)).toBeLessThanOrEqual(102);
  expect(errors).toEqual([]);
});
