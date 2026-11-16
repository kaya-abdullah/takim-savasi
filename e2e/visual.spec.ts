import { expect, test, type Page } from '@playwright/test';

// Visual checks: screenshots of every new space, brightness sanity and a flicker metric.
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function boot(page: Page, quality: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  await g(page, `(g.save.settings.quality = '${quality}', g.applyQuality(), 0)`);
  await page.click('.big-play');
  await g(page, `(() => { const m = g.match; m.brains.clear(); for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; } })()`);
  return errors;
}

/** Puts the player somewhere, lets the frame settle, returns mean luminance (0..255) of the view. */
async function view(page: Page, name: string, x: number, y: number, z: number, yaw: number, pitch: number) {
  await g(page, `(() => { const p = g.match.player; p.pos.set(${x}, ${y}, ${z}); p.velY = 0; p.yaw = ${yaw}; p.pitch = ${pitch}; })()`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/${name}.png` });
  return g(page, `(() => { const gl = g.renderer.getContext(); g.tick(1/60); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight; const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); let s = 0, n = 0; for (let k = 0; k < px.length; k += 64) { s += 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]; n++; } return s / n; })()`) as Promise<number>;
}

const PLACES: [string, number, number, number, number, number][] = [
  ['80-house-outside', -52, 0, 26, Math.PI, 0.05],
  ['81-house-ground', -47.5, 0, 19.5, -2.3, -0.1],
  ['82-house-cafe', -54, 0, 12.5, 0.6, -0.15],
  ['83-house-stairs', -53.5, 0, 14.5, 2.0, 0.05],
  ['84-house-floor1', -48, 3.5, 13, -0.6, -0.15],
  ['85-house-bedroom', -50, 3.5, 16, -1.9, -0.2],
  ['86-house-roof', -54, 7, 15.5, 1.2, -0.15],
  ['87-metro-corridor', -38, -4, 0.8, Math.PI / 2, -0.03],
  ['88-metro-hall', -12, -4, 1.5, Math.PI / 2 + 0.3, 0.02],
  ['89-metro-stairs', -38, -4, -4, Math.PI, 0.15],
  ['91-metro-entrance', -37, 0, -19, -0.15, -0.3],
  ['90-street', -60, 0, -12, Math.PI / 2, 0],
];

for (const q of ['high', 'medium']) {
  test(`screenshots of every space look right (${q})`, async ({ page }) => {
    const errors = await boot(page, q);
    for (const [name, x, y, z, yaw, pitch] of PLACES) {
      const l = await view(page, `${name}-${q}`, x, y, z, yaw, pitch);
      // neither black nor blown out
      expect(l, name).toBeGreaterThan(35);
      expect(l, name).toBeLessThan(215);
    }
    expect(await g(page, 'g.errors')).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`no flicker while walking indoors and outdoors (${q})`, async ({ page }) => {
    const errors = await boot(page, q);
    for (const [x, y, z] of [[-55, 0, 18], [-60, 0, -12], [-38, -4, 0.8], [-50, 3.5, 16]]) {
      const pct = await g(page, `(() => {
        const p = g.match.player; p.view.root.visible = false; g.match.player.view.root.scale.set(0, 0, 0);
        p.pos.set(${x}, ${y}, ${z}); p.yaw = Math.PI / 2; p.pitch = -0.05;
        const gl = g.renderer.getContext(); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const N = 24, frames = [];
        for (let i = 0; i < N; i++) { p.pos.x += 0.03; g.tick(1/60); const px = new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px); frames.push(px); }
        let flick = 0, total = 0;
        for (let i = 2; i < N; i++) { const a = frames[i-2], b = frames[i-1], c = frames[i];
          for (let k = 0; k < a.length; k += 16) { total++; const d1 = b[k]+b[k+1]-a[k]-a[k+1], d2 = c[k]+c[k+1]-b[k]-b[k+1]; if (Math.abs(d1) > 40 && Math.abs(d2) > 40 && Math.sign(d1) !== Math.sign(d2)) flick++; } }
        g.match.player.view.root.scale.set(1, 1, 1);
        return 100 * flick / total; })()`) as number;
      console.log('flicker', q, x, z, pct.toFixed(3) + '%');
      // walking always moves thin texture lines across pixels (the old street scores ~0.22 %);
      // z-fighting or a strobing light scores several percent
      expect(pct, `${x},${z}`).toBeLessThan(0.65);
    }
    expect(errors).toEqual([]);
  });

  test(`standing still: the picture is perfectly stable (${q})`, async ({ page }) => {
    const errors = await boot(page, q);
    for (const [x, y, z] of [[-55, 0, 18], [-38, -4, 0.8], [-50, 3.5, 16], [-60, 0, -12]]) {
      const pct = await g(page, `(() => {
        const p = g.match.player; p.pos.set(${x}, ${y}, ${z}); p.yaw = Math.PI / 2; p.pitch = -0.05;
        const gl = g.renderer.getContext(); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const frames = [];
        for (let i = 0; i < 90; i++) g.tick(1/60); // let the camera settle (it eases back out after touching a wall)
        for (let i = 0; i < 12; i++) { g.tick(1/60); const px = new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px); frames.push(px); }
        let diff = 0, total = 0;
        // compare the last frames only (the camera settles in the first ones); the idle body sway is tiny
        for (let i = 7; i < 12; i++) { const a = frames[i-1], b = frames[i]; for (let k = 0; k < a.length; k += 16) { total++; if (Math.abs(a[k]+a[k+1]+a[k+2]-b[k]-b[k+1]-b[k+2]) > 45) diff++; } }
        return 100 * diff / total; })()`) as number;
      console.log('still', q, x, z, pct.toFixed(3) + '%');
      expect(pct, `${x},${z}`).toBeLessThan(0.05);
    }
    expect(errors).toEqual([]);
  });

  test(`firing a machine gun indoors does not strobe the room (${q})`, async ({ page }) => {
    const errors = await boot(page, q);
    const lum = await g(page, `(() => {
      const m = g.match, p = m.player; g.ctrl.owned.push('smg'); g.ctrl.equip(p, 'smg'); p.weapon.ammo = 999;
      p.pos.set(-55, 0, 18); p.yaw = Math.PI / 2; p.pitch = -0.1;
      const gl = g.renderer.getContext(); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const out = [];
      for (let i = 0; i < 40; i++) {
        p.trigger = true; g.input.press('fire'); g.tick(1/60);
        const px = new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
        let s = 0, n = 0; for (let k = 0; k < px.length; k += 64) { s += px[k] + px[k+1] + px[k+2]; n++; } out.push(s / n / 3);
      }
      g.input.release('fire');
      return out; })()`) as number[];
    // after the first shot the light must hold steady (the old code jumped by ~90 every shot)
    const steady = lum.slice(12);
    const jumps = steady.slice(1).map((v, i) => Math.abs(v - steady[i]));
    console.log('fire luminance', q, Math.min(...lum).toFixed(1), Math.max(...lum).toFixed(1), 'max jump', Math.max(...jumps).toFixed(2), lum.map((v) => v.toFixed(0)).join(' '));
    expect(Math.max(...jumps)).toBeLessThan(3);
    expect(Math.max(...lum) - Math.min(...lum)).toBeLessThan(25);
    expect(errors).toEqual([]);
  });
}
