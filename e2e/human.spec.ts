import { expect, test, type Page } from '@playwright/test';

// v4.4/v5.1: realistic people (rigged MakeHuman models driven by our animation rig, hands on the gun by IK).
type G = any;
const shots = 'test-results/shots';
const g = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game; return ${fn}; })()`);

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as G).__game?.state === 'menu', null, { timeout: 90_000 });
  await page.click('.big-play');
  return errors;
}

/** One red soldier 2.5 m in front of the player holding a rifle; everyone else removed. */
async function stage(page: Page) {
  await g(page, `(() => { const m = g.match; m.brains.clear(); const p = m.player; p.pos.set(-20, 0, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.shieldT = 0;
    for (const c of m.combatants) if (!c.isPlayer) { c.alive = false; c.respawnT = 1e9; c.view.root.visible = false; }
    const r = m.combatants.find(c => c.team === 'red'); r.alive = true; r.respawnT = 0; r.hp = 1e9; r.shieldT = 0; r.view.revive(); r.view.root.visible = true;
    r.pos.set(-17.6, 0, 0.6); r.yaw = -Math.PI / 2 + 1.3; r.view.setWeapon({ ...p.weapon.def, id: 'rifle' }); window.__r = r; })()`);
  await page.waitForTimeout(500);
}

test('soldiers are the realistic model, hold the gun with both hands, in team colours', async ({ page }) => {
  const errors = await boot(page);
  await stage(page);
  const r = await g(page, `(() => {
    const v = window.__r.view; const V = v.root.position.constructor;
    v.root.updateMatrixWorld(true);
    const gun = v.gun; const mz = gun.userData.muzzle.z;
    const hand = (s) => v.arms[s][2].getWorldPosition(new V());
    const grip = gun.localToWorld(new V(-0.01, -0.07, -0.03));
    // the left wrist in gun space: under the gun, somewhere between the grip and the muzzle
    const l = gun.worldToLocal(hand('l'));
    const head = v.drive.find(d => d.bone.name.endsWith('Head')).bone.getWorldPosition(new V());
    return { driven: v.drive.length, meshes: v.meshes.length, right: hand('r').distanceTo(grip), lx: Math.abs(l.x), ly: Math.abs(l.y + 0.04), lz: l.z, mz, headY: head.y,
      blue: g.match.player.view.vestMat.map.uuid, red: v.vestMat.map.uuid }; })()`) as Record<string, number | string>;
  console.log('soldier', JSON.stringify(r));
  expect(r.driven).toBe(12);
  expect(r.meshes).toBeGreaterThanOrEqual(1);
  // IK puts the wrists on the grip and the forend
  expect(r.right as number).toBeLessThan(0.06);
  expect(r.lx as number).toBeLessThan(0.06);
  expect(r.ly as number).toBeLessThan(0.06);
  expect(r.lz as number).toBeGreaterThan(0.05);
  expect(r.lz as number).toBeLessThan(r.mz as number);
  // a full-height person, not a crumpled one
  expect(r.headY as number).toBeGreaterThan(1.45);
  expect(r.headY as number).toBeLessThan(1.8);
  // each team wears its own vest colour
  expect(r.blue).not.toBe(r.red);
  await page.screenshot({ path: `${shots}/95-soldiers.png` });
  // crouched: the head comes down
  await g(page, `(() => { window.__r.crouch = true; })()`);
  await page.waitForTimeout(700);
  const crouchY = await g(page, `(() => { const v = window.__r.view, V = v.root.position.constructor; v.root.updateMatrixWorld(true); return v.drive.find(d => d.bone.name.endsWith('Head')).bone.getWorldPosition(new V()).y; })()`) as number;
  expect(crouchY).toBeLessThan((r.headY as number) - 0.3);
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});

test('without the model files the game falls back to the simple figure and still plays', async ({ page }) => {
  await page.route('**/models/soldier.glb', (rt) => rt.abort());
  await page.route('**/models/people/*.glb', (rt) => rt.abort());
  const errors = await boot(page);
  await stage(page);
  expect(await g(page, 'window.__r.view.drive.length')).toBe(0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  expect(await g(page, 'g.errors')).toEqual([]);
  // the only error is the blocked download itself
  expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
});

test('six different people in civilian clothes, team shown by the vest; real guns', async ({ page }) => {
  const errors = await boot(page);
  const r = await g(page, `(() => {
    const cs = g.match.combatants;
    const variants = new Set(cs.map((c) => c.view.variant));
    const vest = (t) => cs.filter((c) => c.team === t).map((c) => { const m = c.view.vestMat; return m && m.map ? m.map.uuid : null; });
    const parts = cs[0].view.meshes.map((m) => m.name);
    return { variants: variants.size, minVariant: Math.min(...variants), blue: [...new Set(vest('blue'))], red: [...new Set(vest('red'))], parts };
  })()`) as G;
  console.log('people', JSON.stringify(r));
  expect(r.variants).toBe(6);
  expect(r.minVariant).toBe(0);
  // one vest texture per team, different between the teams
  expect(r.blue.length).toBe(1);
  expect(r.red.length).toBe(1);
  expect(r.blue[0]).not.toBe(r.red[0]);
  expect(r.blue[0]).not.toBeNull();
  // body + hair cut-outs + vest, nothing else (draw calls)
  expect(r.parts.length).toBe(3);
  const real = await g(page, `(() => { const v = g.match.player.view; return { pistol: !!v.gun.userData.real, muzzle: v.gun.userData.muzzle.z }; })()`) as G;
  expect(real.pistol).toBe(true);
  await page.screenshot({ path: `${shots}/96-people.png` });
  expect(await g(page, 'g.errors')).toEqual([]);
  expect(errors).toEqual([]);
});
