import { expect, test, type Page } from '@playwright/test';
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);
test('free play: real-time match with heli and car against live bots', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  await g(page, "(g.save.vehicles = ['car', 'heli'], g.save.settings.quality = 'medium', g.applyQuality(), 0)");
  await page.click('.big-play');
  // on foot: run toward the enemy and shoot for 15 s
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.down('KeyF');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyF');
    await page.waitForTimeout(400);
  }
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${shots}/70-play-foot.png` });
  // helicopter over the battle, strafing with the cannon
  await page.keyboard.press('KeyY');
  await page.waitForTimeout(300);
  const inHeli = await g(page, "!!(g.match.player.vehicle && g.match.player.vehicle.kind === 'heli')");
  if (inHeli) {
    await page.keyboard.down('Space');
    await page.waitForTimeout(2500);
    await page.keyboard.up('Space');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyF');
    for (let i = 0; i < 10; i++) { await page.keyboard.press('KeyG'); await page.waitForTimeout(1000); }
    await page.keyboard.up('KeyF');
    await page.keyboard.up('KeyW');
    await page.screenshot({ path: `${shots}/71-play-heli.png` });
  }
  const st = await g(page, `({ fps: g.fps, score: { ...g.match.score }, kills: g.match.player.kills, deaths: g.match.player.deaths, vehicles: g.match.vehicles.map(v => [v.kind, v.hp, v.alive]), heliDamaged: g.match.vehicles.some(v => v.kind === 'heli' && v.hp < v.maxHp) })`);
  console.log('STATE', JSON.stringify(st));
  // let it run 20 s more in real time
  await page.waitForTimeout(20_000);
  await page.screenshot({ path: `${shots}/72-play-late.png` });
  console.log('STATE2', JSON.stringify(await g(page, `({ fps: g.fps, score: { ...g.match.score }, kills: g.match.player.kills, deaths: g.match.player.deaths, money: g.save.money })`)));
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
