import { expect, test, type Browser, type Page } from '@playwright/test';

/** Own name from the menu, name tags over soldiers, names reaching the other device online. */
type G = any;
const shots = 'test-results/shots';
const BASE = process.env.ONLINE_URL ?? '';
const room = `name${Date.now().toString(36)}`;
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function open(browser: Browser, errors: string[], query = ''): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 620 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 120_000 });
  await g(page, "(g.save.settings.quality = 'medium', g.applyQuality(), 0)");
  return page;
}

test('typing a name in the menu; tags over the soldiers', async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const p = await open(browser, errors);
  await expect(p.locator('.name-btn')).toContainText('İsim koy');
  await p.click('.name-btn');
  const inp = p.locator('.name-ask input');
  await expect(inp).toBeFocused();
  // WASD and the rest must type letters, not move or open menus
  await p.keyboard.type('Swat Kaya');
  await p.click('.name-ask [data-a="ok"]');
  await expect(p.locator('.name-btn')).toContainText('Swat Kaya');
  expect(await g(p, 'JSON.parse(localStorage.getItem("takim-savasi-save-v1")).name')).toBe('Swat Kaya');
  // too short is refused
  await p.click('.name-btn');
  await inp.fill('a');
  await p.keyboard.press('Enter');
  await expect(p.locator('.name-ask .err')).toContainText('En az 2');
  await p.click('.name-ask [data-a="cancel"]');
  await expect(p.locator('.name-btn')).toContainText('Swat Kaya');

  // after a reload the name is still there and the match uses it
  await p.reload();
  await p.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 120_000 });
  await expect(p.locator('.name-btn')).toContainText('Swat Kaya');
  await p.click('.big-play');
  await p.waitForFunction(() => (window as G).__game?.state === 'playing');
  expect(await g(p, 'g.match.player.name')).toBe('Swat Kaya');
  // a teammate in front of the camera: its tag is drawn with its name; ours has none
  await g(p, `(() => { const m = g.match, me = m.player, t = m.combatants[1];
    m.brains.get(t).update = () => {};
    t.pos.set(me.pos.x + Math.sin(me.yaw) * 6, me.pos.y, me.pos.z + Math.cos(me.yaw) * 6); t.yaw = me.yaw + Math.PI; return 0; })()`);
  await p.waitForTimeout(500);
  const tag = await g(p, '({ name: g.match.combatants[1].name, vis: g.match.combatants[1].view.tag.visible, map: !!g.match.combatants[1].view.tag.material.map, mine: g.match.player.view.tag })');
  expect(tag).toEqual({ name: 'Kartal', vis: true, map: true, mine: null });
  // far away fighters carry no tag
  const far = await g(p, `g.match.combatants.filter(c => c.alive && !c.isPlayer && c.view.tag.visible && g.camera.position.distanceTo(c.pos) > 60).length`);
  expect(far).toBe(0);
  await p.screenshot({ path: `${shots}/names-offline.png` });
  expect(await g(p, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('online: the first online press asks for a name; the other device sees it over the soldier', async ({ browser }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const a = await open(browser, errors, `?oda=${room}`);
  await a.click('.online-play');
  await expect(a.locator('.name-ask')).toBeVisible();
  await a.keyboard.type('Ali');
  await a.keyboard.press('Enter');
  await a.waitForFunction(() => (window as G).__game.state === 'playing', null, { timeout: 30_000 });

  const b = await open(browser, errors, `?oda=${room}`);
  await b.click('.name-btn');
  await b.keyboard.type('Veli');
  await b.keyboard.press('Enter');
  await b.click('.online-play');
  await b.waitForFunction(() => (window as G).__game.state === 'playing', null, { timeout: 60_000 });
  await a.waitForFunction(() => (window as G).__game.match.combatants[1].name === 'Veli', null, { timeout: 20_000 });
  expect(await g(b, 'g.match.combatants[0].name')).toBe('Ali');
  expect(await g(a, 'g.match.player.name')).toBe('Ali');

  // B stands in front of A: A sees "Veli" above that soldier
  const at = await g(a, '[g.match.player.pos.x, g.match.player.pos.y, g.match.player.pos.z, g.match.player.yaw]');
  await g(b, `(() => { const p = g.match.player; p.pos.set(${at[0]} + Math.sin(${at[3]}) * 6, ${at[1]}, ${at[2]} + Math.cos(${at[3]}) * 6); p.yaw = ${at[3]} + Math.PI; g.input.enabled = false; return 0; })()`);
  await a.waitForFunction(() => { const c = (window as G).__game.match.combatants[1]; return c.view.tag.visible; }, null, { timeout: 10_000 });
  await a.bringToFront();
  await a.waitForTimeout(400);
  await a.screenshot({ path: `${shots}/names-online.png` });
  for (const p of [a, b]) expect(await g(p, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
