import { expect, test, type Page } from '@playwright/test';

/** Metro train ride, the new entrances and the roof bridges in the real game. */
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function play(page: Page): Promise<void> {
  await page.goto(`${process.env.ONLINE_URL ?? ''}/`); // ONLINE_URL: test the live site
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 120_000 });
  await g(page, "(g.save.settings.quality = 'medium', g.applyQuality(), 0)");
  await page.click('.big-play');
  await page.waitForFunction(() => (window as G).__game?.state === 'playing');
  // the fight goes on elsewhere: keep the player safe and the bots away
  await g(page, `(g.match.player.maxHp = g.match.player.hp = 1e6, g.match.combatants.forEach(c => { if (!c.isPlayer) { g.match.brains.get(c).update = () => {}; c.pos.set(0, 0, 90); } }), 0)`);
}

/** Puts the player at (x, y, z) facing yaw. */
const place = (page: Page, x: number, y: number, z: number, yaw: number) =>
  g(page, `(() => { const p = g.match.player; p.pos.set(${x}, ${y}, ${z}); p.velY = 0; p.yaw = ${yaw}; p.pitch = -0.05; return 0; })()`);

test('ride the metro from one station to the next', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await play(page);
  const t0 = await g(page, '({ x: g.match.train.x, at: g.match.train.at, state: g.match.train.state })');
  expect(t0).toEqual({ x: -35, at: 1, state: 'stopped' });
  // on the platform beside the waiting train
  await place(page, -35 - 9, -4, 1.9, Math.PI / 2 + 0.25);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/v7-train-station.png` });
  // nobody aboard: it stays
  await page.waitForTimeout(3000);
  expect(await g(page, 'g.match.train.state')).toBe('stopped');
  // walk in through the door (door at x - 3.5 on the +z side)
  // (both doors are open: walking too long goes straight out the other side)
  await place(page, -35 - 3.5, -4, 2.0, Math.PI);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => { const p = (window as G).__game.match.player.pos; return p.z < 0.6; }, null, { timeout: 5000 });
  await page.keyboard.up('KeyW');
  console.log('BOARD', JSON.stringify(await g(page, '({ st: g.state, p: [g.match.player.pos.x, g.match.player.pos.y, g.match.player.pos.z], t: g.match.train.x })')));
  expect(await g(page, 'g.match.train.aboard(g.match.player)')).toBe(true);
  await page.waitForFunction(() => (window as G).__game.match.train.state === 'moving', null, { timeout: 40_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/v7-train-riding.png` });
  // try to walk out through the wall while it runs: no way
  await g(page, '(g.match.player.yaw = 0, 0)');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  expect(await g(page, 'g.match.train.aboard(g.match.player)')).toBe(true);
  await page.waitForFunction(() => { const t = (window as G).__game.match.train; return t.state === 'stopped' && t.x === 35; }, null, { timeout: 90_000 });
  const p = await g(page, '[g.match.player.pos.x, g.match.player.pos.z, g.match.train.aboard(g.match.player)]');
  expect(p[2]).toBe(true);
  expect(Math.abs(p[0] - 35)).toBeLessThan(7);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/v7-train-arrived.png` });
  // get off through a door
  await place(page, 35 + 3.5, -4, 0.5, 0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  expect(await g(page, 'g.match.train.aboard(g.match.player)')).toBe(false);
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('new entrances on the street and the roof bridges', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await play(page);
  // a far-east entrance (north side) seen from the street
  await place(page, 106, 0, 22, Math.PI + 0.3);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/v7-entrance-east.png` });
  // walk down it into the tunnel
  // (keep walking and you come up the south entrance on the other side)
  await place(page, 102, 0, 15, Math.PI);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => (window as G).__game.match.player.pos.y < -3.5, null, { timeout: 8000 });
  await page.keyboard.up('KeyW');
  console.log('DOWN', JSON.stringify(await g(page, '({ st: g.state, p: [g.match.player.pos.x, g.match.player.pos.y, g.match.player.pos.z] })')));
  const y = await g(page, 'g.match.player.pos.y');
  expect(y).toBeLessThan(-3);
  // the centre's plaza: the stairwell east of the north-south street is gone, the west one stays
  expect(await g(page, 'g.map.structures.pits.some(p => p.x0 < 6.5 && p.x1 > 6.5 && p.z0 > 0)')).toBe(false);
  // on the west house's roof, looking along the bridge to the house by the plaza
  await place(page, -50, 7, 19.1, Math.PI / 2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/v7-bridge-roof.png` });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(6500);
  await page.keyboard.up('KeyW');
  const end = await g(page, '[g.match.player.pos.x, g.match.player.pos.y]');
  expect(end[0]).toBeGreaterThan(-25); // crossed onto the other roof
  expect(end[1]).toBeCloseTo(7, 0);
  // the bridge over the avenue, from the street
  await place(page, 62, 0, -3, -Math.PI / 2 + 0.2);
  await g(page, '(g.match.player.pitch = 0.25, 0)');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/v7-bridge-avenue.png` });
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
