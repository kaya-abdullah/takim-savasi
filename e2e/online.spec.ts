import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Real online test: three separate browsers meet over the public relays and
 * WebRTC in a private room. Runs against the local build, or the live site
 * with ONLINE_URL=https://… (the room name is random, so real players are never touched).
 */
type G = any;
const shots = 'test-results/shots';
const BASE = process.env.ONLINE_URL ?? '';
const room = `test${Date.now().toString(36)}`;
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function player(browser: Browser, errors: string[]): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE || ''}/?oda=${room}`);
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 120_000 });
  await g(page, "(g.save.settings.quality = 'low', g.applyQuality(), 0)");
  return page;
}

test('three devices share one room: blue fills in order, hits and kills reach everyone', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const a = await player(browser, errors);
  await a.click('.online-play');
  await expect(a.locator('.net-wait')).toBeVisible();
  await a.waitForFunction(() => (window as G).__game?.online?.isHost() && (window as G).__game.state === 'playing', null, { timeout: 30_000 });

  const b = await player(browser, errors);
  await b.click('.online-play');
  await b.waitForFunction(() => (window as G).__game?.state === 'playing', null, { timeout: 60_000 });
  const c = await player(browser, errors);
  await c.click('.online-play');
  await c.waitForFunction(() => (window as G).__game?.state === 'playing', null, { timeout: 60_000 });

  const info = (p: Page) => g(p, '({ slot: g.match.player.id, team: g.match.player.team, host: g.online.isHost(), mid: g.online.mid, humans: g.online.humans(), names: g.match.combatants.slice(0, 3).map(c => c.name) })');
  const [ia, ib, ic] = [await info(a), await info(b), await info(c)];
  console.log('ROOM', JSON.stringify({ ia, ib, ic }));
  expect([ia.slot, ib.slot, ic.slot]).toEqual([0, 1, 2]);
  expect([ia.team, ib.team, ic.team]).toEqual(['blue', 'blue', 'blue']);
  expect([ia.host, ib.host, ic.host]).toEqual([true, false, false]);
  expect(new Set([ia.mid, ib.mid, ic.mid]).size).toBe(1);
  await a.waitForFunction(() => (window as G).__game.online.humans() === 3);
  // everyone sees the same three names in slots 0..2
  const na = (await info(a)).names;
  expect((await info(b)).names).toEqual(na);
  expect((await info(c)).names).toEqual(na);

  // B walks: A and C see B move
  await b.bringToFront();
  await b.keyboard.down('KeyW');
  await b.waitForTimeout(1500);
  await b.keyboard.up('KeyW');
  await b.waitForTimeout(600);
  const posB = await g(b, '[g.match.player.pos.x, g.match.player.pos.z]');
  for (const p of [a, c]) {
    const seen = await g(p, '[g.match.combatants[1].pos.x, g.match.combatants[1].pos.z]');
    expect(Math.hypot(seen[0] - posB[0], seen[1] - posB[1])).toBeLessThan(1.5);
  }

  // C kills a red bot (run by host A): the kill and the score reach all three
  const before = await g(a, 'g.match.combatants[14].deaths');
  await g(c, '(g.match.combatants[14].shieldT = 0, g.match.combatants.forEach(x => x.shieldT = 0), g.match.damage(g.match.combatants[14], g.match.player, 999, true, g.match.player.weapon.def), 0)');
  await a.waitForFunction((d) => (window as G).__game.match.combatants[14].deaths > d, before, { timeout: 10_000 });
  await c.waitForFunction(() => (window as G).__game.match.player.kills >= 1, null, { timeout: 10_000 });
  await b.waitForFunction(() => (window as G).__game.match.combatants[2].kills >= 1, null, { timeout: 10_000 });
  const blue = await Promise.all([a, b, c].map((p) => g(p, 'g.match.score.blue')));
  console.log('BLUE SCORE', blue);
  expect(blue[0]).toBeGreaterThanOrEqual(1);
  expect(new Set(blue).size).toBe(1);

  await a.screenshot({ path: `${shots}/online-host.png` });
  await c.screenshot({ path: `${shots}/online-guest.png` });

  // the host leaves: B (oldest guest) takes over and the bots keep running
  await g(a, '(g.toMenu(), 0)');
  await b.waitForFunction(() => (window as G).__game.online.isHost(), null, { timeout: 30_000 });
  await c.waitForFunction(() => (window as G).__game.online.hostId === (window as G).__game.online.self ? false : true);
  const botBefore = await g(c, '[g.match.combatants[15].pos.x, g.match.combatants[15].pos.z, g.match.combatants[15].alive]');
  await c.waitForTimeout(4000);
  const botAfter = await g(c, '[g.match.combatants[15].pos.x, g.match.combatants[15].pos.z, g.match.combatants[15].alive]');
  console.log('BOT MOVES AFTER HOST LEFT', JSON.stringify({ botBefore, botAfter }));
  expect(Math.hypot(botAfter[0] - botBefore[0], botAfter[1] - botBefore[1]) > 0.5 || botAfter[2] !== botBefore[2]).toBe(true);
  expect(await g(c, 'g.match.combatants[0].name')).not.toBe(ia.names[0]);

  for (const p of [a, b, c]) expect(await g(p, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
