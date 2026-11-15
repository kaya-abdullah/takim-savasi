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

test('no NaN/Inf pixels at high quality with power-up beams on screen (black-block bug)', async ({ page }) => {
  // The v3.1 build fails this in 17 of 24 views; NaN only shows at some angles, so sweep the camera.
  await page.setViewportSize({ width: 1000, height: 480 });
  await page.goto('/');
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  const bad = await page.evaluate(async () => {
    const g = (window as G).__game;
    g.save.settings.quality = 'high'; g.applyQuality(); g.startMatch();
    const m = g.match, p = m.player;
    m.brains.clear();
    for (const [k, x, z] of [['health', -40, 0], ['damage', -30, 6], ['speed', -20, -6], ['airdrop', -12, 0], ['health', 0, 9], ['speed', -45, 26]] as const) {
      const q = m.spawnPickup(k, p.pos.clone().set(x, 0, z)); if (q) { q.falling = false; q.pos.y = 0; }
    }
    await new Promise((r) => setTimeout(r, 300));
    g.pause();
    const rt = g.composer.renderTarget1; const buf = new Uint16Array(rt.width * rt.height * 4);
    let views = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r = 8 + (i % 3) * 10;
      g.camera.position.set(-25 + Math.cos(a) * r, 1.6 + (i % 4), 3 + Math.sin(a) * r);
      g.camera.lookAt(-25, 2, 3);
      g.camera.updateMatrixWorld();
      g.renderer.setRenderTarget(rt); g.renderer.render(g.scene, g.camera); g.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf); g.renderer.setRenderTarget(null);
      for (let j = 0; j < buf.length; j++) if ((j & 3) !== 3 && (buf[j] & 0x7c00) === 0x7c00) { views++; break; }
    }
    return views;
  });
  expect(bad).toBe(0);
});
