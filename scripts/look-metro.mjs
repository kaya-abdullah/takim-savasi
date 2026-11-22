// Dev helper: screenshots of the metro train and the roof bridges. Usage: node scripts/look-metro.mjs <outDir> [url]
import { chromium } from '@playwright/test';
const out = process.argv[2] || 'test-results/look';
const url = process.argv[3] || 'http://localhost:5174/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--use-angle=gl', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const g = (fn) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__game?.state === 'menu', null, { timeout: 120000 });
await g("(g.save.settings.quality = 'high', g.applyQuality(), 0)");
await page.click('.big-play');
await page.waitForFunction(() => window.__game?.state === 'playing');
await g(`(g.match.player.maxHp = g.match.player.hp = 1e6, g.match.combatants.forEach(c => { if (!c.isPlayer) { g.match.brains.get(c).update = () => {}; c.pos.set(0, 0, 90); } }), 0)`);
const shot = async (name, x, y, z, yaw, pitch, wait = 900) => {
  await g(`(() => { const p = g.match.player; p.pos.set(${x}, ${y}, ${z}); p.velY = 0; p.yaw = ${yaw}; p.pitch = ${pitch}; return 0; })()`);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
};
const views = (process.env.VIEWS || 'platform,inside,inside2,insideMove,bridgeRoof,bridgeRoof2,bridgeAvenue,bridgeUnder,bridgeOn').split(',');
for (const v of views) {
  if (v === 'platform') await shot(v, -35 - 9, -4, 1.9, Math.PI / 2 + 0.25, -0.05);
  if (v === 'inside') await shot(v, -35 - 1, -4, 0, Math.PI / 2, -0.05, 1500);
  if (v === 'inside2') await shot(v, -35 + 4, -4, 0.3, -Math.PI / 2, 0.0, 900);
  if (v === 'insideMove') { await shot('insideWait', -35, -4, 0, Math.PI / 2, 0.0, 300); await page.waitForFunction(() => window.__game.match.train.state === 'moving', null, { timeout: 40000 }); await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/${v}.png` }); console.log('CAM', JSON.stringify(await g('[g.camera.position.toArray().map(n=>+n.toFixed(2)), g.match.player.pos.toArray().map(n=>+n.toFixed(2)), g.match.train.x, g.ctrl.camDist]'))); await g('(g.match.player.yaw = 0, 0)'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${v}Side.png` }); }
  if (v === 'bridgeRoof') await shot(v, -50, 7, 19.1, Math.PI / 2, -0.05);
  if (v === 'bridgeRoof2') await shot(v, -36, 7, 19.1, Math.PI / 2, -0.15);
  if (v === 'bridgeAvenue') await shot(v, 62, 0, -3, -Math.PI / 2 + 0.2, 0.25);
  if (v === 'bridgeUnder') await shot(v, 49.5, 0, 0, Math.PI, 0.5);
  if (v === 'bridgeOn') await shot(v, 49.5, 7, -2, Math.PI, -0.1);
}
console.log('errors', JSON.stringify(errors.slice(0, 10)), JSON.stringify(await g('g.errors')));
await browser.close();
