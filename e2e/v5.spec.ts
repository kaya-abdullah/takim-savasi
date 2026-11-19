import { expect, test, type Page } from '@playwright/test';

// v5 realistic graphics: grade, sky, wet ground, facades, trees, soldiers, post chain.
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function boot(page: Page): Promise<{ errors: string[]; ms: number }> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  const t0 = Date.now();
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  return { errors, ms: Date.now() - t0 };
}

test('cinematic grade, sky and fog are installed', async ({ page }) => {
  const { errors, ms } = await boot(page);
  console.log('boot ms', ms);
  expect(ms).toBeLessThan(30_000);
  const r = await g(page, `(() => {
    const THREE = g.scene.constructor;
    const sky = g.scene.getObjectByName('sky');
    return {
      tone: g.renderer.toneMapping,
      fog: g.scene.fog && g.scene.fog.isFogExp2 === true,
      skyClouds: sky.material.uniforms.clouds.value,
      skyFog: sky.material.fog,
    };
  })()`) as G;
  expect(r.tone).toBe(5); // THREE.CustomToneMapping
  expect(r.fog).toBe(true);
  expect(r.skyClouds).toBe(1);
  expect(r.skyFog).toBe(true);
  expect(errors).toEqual([]);
});

test('world materials: wet ground, PBR facades, trees with leaf cards, sandbags', async ({ page }) => {
  const { errors } = await boot(page);
  const r = await g(page, `(() => {
    const o = (n) => g.scene.getObjectByName(n);
    const ground = o('ground').material;
    const facades = [0, 1, 2, 3].map((i) => o('facade' + i)).filter(Boolean);
    const leaves = o('leaves');
    return {
      groundRough: !!ground.roughnessMap && ground.roughnessMap.image.width > 1000,
      groundMap: ground.map.image.width,
      facadeNormals: facades.every((f) => !!f.material.normalMap && !!f.material.metalnessMap),
      facadeCount: facades.length,
      leafTris: leaves.geometry.attributes.position.count / 3,
      leafAlpha: leaves.material.alphaTest,
      leafShadow: leaves.castShadow,
      bark: !!o('bark'),
      sandbag: !!o('sandbag'),
      oldFoliage: !!o('foliage'),
    };
  })()`) as G;
  expect(r.groundRough).toBe(true);
  expect(r.groundMap).toBe(140 * 16);
  expect(r.facadeCount).toBe(4);
  expect(r.facadeNormals).toBe(true);
  // 14 trees x 120 cards x 2 triangles plus shrubs
  expect(r.leafTris).toBeGreaterThan(14 * 120 * 2);
  expect(r.leafAlpha).toBeGreaterThan(0);
  expect(r.leafShadow).toBe(true);
  expect(r.bark).toBe(true);
  expect(r.sandbag).toBe(true);
  expect(r.oldFoliage).toBe(false);
  expect(errors).toEqual([]);
});

/** Mean luminance and mean saturation of the drawing buffer. */
const stats = (page: Page) => g(page, `(() => { const gl = g.renderer.getContext(); g.tick(1/60); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight; const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); let s = 0, sat = 0, n = 0; for (let k = 0; k < px.length; k += 64) { const r = px[k], gg = px[k+1], b = px[k+2]; s += 0.2126 * r + 0.7152 * gg + 0.0722 * b; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); sat += mx ? (mx - mn) / mx : 0; n++; } return { lum: s / n, sat: sat / n }; })()`) as Promise<{ lum: number; sat: number }>;

for (const q of ['high', 'medium', 'low']) {
  test(`street and sky render well exposed (${q})`, async ({ page }) => {
    const { errors } = await boot(page);
    await g(page, `(g.save.settings.quality = '${q}', g.applyQuality(), 0)`);
    await page.click('.big-play');
    await g(page, `(() => { const m = g.match; m.brains.clear(); for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; } })()`);
    for (const [name, x, z, yaw, pitch] of [['street', -20, 2, Math.PI / 2 + 0.25, 0.02], ['skyline', -40, 0, 2.2, 0.45], ['plaza', -14, -10, 1.0, -0.05]] as [string, number, number, number, number][]) {
      await g(page, `(() => { const p = g.match.player; p.pos.set(${x}, 0, ${z}); p.velY = 0; p.yaw = ${yaw}; p.pitch = ${pitch}; })()`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${shots}/v5-${name}-${q}.png` });
      const s = await stats(page);
      expect(s.lum, name).toBeGreaterThan(55);
      expect(s.lum, name).toBeLessThan(200);
      // graded, not washed out grey
      expect(s.sat, name).toBeGreaterThan(0.12);
    }
    expect(await g(page, 'g.errors')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('high quality keeps 30+ fps in a full match with bots', async ({ page }) => {
  const { errors } = await boot(page);
  await g(page, `(g.save.settings.quality = 'high', g.applyQuality(), 0)`);
  await page.click('.big-play');
  await page.waitForTimeout(6000);
  const fps = await g(page, 'g.fps') as number;
  console.log('fps', fps);
  expect(fps).toBeGreaterThan(30);
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
