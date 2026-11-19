// Dev helper: screenshots of fixed viewpoints. Usage: node scripts/shoot.mjs <outDir> [quality] [url]
import { chromium } from '@playwright/test';

const out = process.argv[2] || 'test-results/look';
const quality = process.argv[3] || 'high';
const url = process.argv[4] || 'http://localhost:5174/';
const VIEWS = [
  ['street', -60, 0, -12, Math.PI / 2, 0],
  ['avenue', -20, 0, 2, Math.PI / 2 + 0.25, 0.02],
  ['plaza', -14, 0, -10, 1.0, -0.05],
  ['house', -52, 0, 26, Math.PI, 0.05],
  ['room', -47.5, 0, 19.5, -2.3, -0.1],
  ['sky', -40, 0, 0, 2.2, 0.45],
  ['metro', -12, -4, 1.5, Math.PI / 2 + 0.3, 0.02],
];
const only = process.env.VIEWS ? process.env.VIEWS.split(',') : null;
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--use-angle=gl', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__game?.state === 'menu', null, { timeout: 120000 });
await page.evaluate((q) => { const g = window.__game; g.save.settings.quality = q; g.applyQuality(); }, quality);
await page.screenshot({ path: `${out}/menu-${quality}.png` });
if (process.env.SHOP) {
  await page.evaluate(() => { const g = window.__game; g.save.money = 99999; g.openShop(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/shop-${quality}.png` });
  await page.evaluate(() => window.__game.closeShop());
}
await page.click('.big-play');
await page.evaluate(() => {
  const m = window.__game.match;
  m.brains.clear();
  let k = 0;
  for (const c of m.combatants) if (!c.isPlayer) {
    // a few soldiers standing in view of the street shot, the rest hidden
    if (k < 3) { c.pos.set(-52 + k * 3, 0, -12 + k * 1.5); k++; }
    else { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; }
  }
}).catch(() => {});
if (process.env.PEOPLE) {
  // a line-up: six fighters (both teams) a few metres in front of the camera, facing it
  await page.evaluate(async () => {
    const W = await import('/src/data/weapons.ts');
    const m = window.__game.match;
    m.brains.clear();
    m.player.shieldT = 0;
    const pick = [...m.combatants.filter((c) => !c.isPlayer && c.team === 'blue').slice(0, 3), ...m.combatants.filter((c) => c.team === 'red').slice(0, 3)];
    const guns = ['rifle', 'sniper', 'pistol', 'smg', 'shotgun', 'lmg'];
    for (const c of m.combatants) if (!c.isPlayer && !pick.includes(c)) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; }
    pick.forEach((c, k) => {
      c.alive = true; c.respawnT = 0; c.hp = 1e9; c.shieldT = 0; c.view.revive(); c.view.root.visible = true;
      c.pos.set(-49.5 + (k % 3) * 1.3, 0, -6.2 + (k < 3 ? 0 : 2.4) + (k % 3) * 0.2);
      c.yaw = -Math.PI / 2 + (k - 2.5) * 0.25;
      c.view.setWeapon(W.getWeapon(guns[k]));
    });
  });
  // face close-ups: the player (hidden) stands right in front of each fighter in turn
  if (process.env.FACES) {
    for (let k = 0; k < 6; k++) {
      await page.evaluate((k) => {
        const m = window.__game.match, p = m.player;
        const pick = [...m.combatants.filter((c) => !c.isPlayer && c.team === 'blue').slice(0, 3), ...m.combatants.filter((c) => c.team === 'red').slice(0, 3)];
        const c = pick[k];
        c.pos.set(-30, 0, 20 + k * 0.001); c.yaw = Math.PI; c.view.revive();
        pick.forEach((o, j) => { if (j !== k) o.view.root.visible = false; else o.view.root.visible = true; });
        p.view.root.visible = false;
        p.pos.set(-30, 0, 18.2); p.yaw = 0; p.pitch = 0.12;
      }, k);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/face${k + 1}-${quality}.png`, clip: { x: 440, y: 120, width: 400, height: 520 } });
    }
  }
  for (const [name, x, z, pitch] of [['people', -54.5, -5, 0.0], ['people-close', -51.6, -6.0, 0.1]]) {
    await page.evaluate(([x, z, pitch]) => { const p = window.__game.match.player; p.pos.set(x, 0, z); p.velY = 0; p.yaw = Math.PI / 2; p.pitch = pitch; }, [x, z, pitch]);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${name}-${quality}.png` });
  }
}
for (const [name, x, y, z, yaw, pitch] of VIEWS) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(([x, y, z, yaw, pitch]) => { const p = window.__game.match.player; p.pos.set(x, y, z); p.velY = 0; p.yaw = yaw; p.pitch = pitch; }, [x, y, z, yaw, pitch]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}-${quality}.png` });
}
const fps = await page.evaluate(() => window.__game.fps);
console.log('fps', fps, 'errors', JSON.stringify(errors.slice(0, 10)));
await browser.close();
