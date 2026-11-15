import { expect, test } from '@playwright/test';

type G = any;
const g = (page: import('@playwright/test').Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

test('replaying many matches does not leak GPU textures', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  const counts: number[] = [];
  for (let i = 0; i < 6; i++) {
    await g(page, 'g.startMatch()');
    await page.waitForTimeout(700);
    counts.push(await g(page, 'g.renderer.info.memory.textures'));
  }
  // after the first match the texture count must stay flat
  expect(Math.max(...counts.slice(1)) - counts[1]).toBeLessThanOrEqual(2);
});

test('a lost WebGL context recovers by reloading with progress kept', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  await g(page, '(g.save.money = 4321, g.startMatch(), 0)');
  await page.waitForTimeout(500);
  await g(page, 'g.onKillSave ? 0 : (localStorage.setItem("takim-savasi-save-v1", JSON.stringify(g.save)), 0)');
  await page.evaluate(() => (window as G).__game.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => (window as G).__game?.state === 'menu' && (window as G).__game.frames > 5, null, { timeout: 30_000 });
  expect(await g(page, 'g.save.money')).toBe(4321);
  const diag = await page.evaluate(() => localStorage.getItem('takim-savasi-diag'));
  expect(diag).toContain('webglcontextlost');
});
