#!/usr/bin/env node
// Browser smoke test: serves the repo, opens it in headless Chromium, taps PLAY, waits for the game to start, then drives it through
// window.__cpm (the debug hook) and fails on any console error / page error.  NEEDS a browser, which the other tools don't:
//   npm i playwright-core && npx playwright-core install chromium-headless-shell     (in a scratch dir, NOT in the repo)
//   PW=/path/to/node_modules/playwright-core node tools/smoke.mjs [--bike click125] [--shot out.png] [--webgpu] [--perf [--top N]] [--gfx low|med|high] [--tod 0-23]
// Default renderer is WebGL 2 (sessionStorage cpmGL, like the game's own fallback). --webgpu tries WebGPU, but on swiftshader the
// device is lost mid-load and the game reloads into WebGL (seen in 11.43, before and after the batching): WebGPU needs a real device.
// --perf: also teleports the bike to 5 spots (with --shot x.png: one screenshot each, x-0.png...) and prints draw calls / triangles per frame (renderer.info: main + shadow + post
// passes) plus the biggest groups of visible objects (what to batch next). Swiftshader timings are meaningless; counts are exact.
// Without playwright it exits 0 with "skipped" so it never blocks tools/test.mjs workflows. First run for real in 11.43 (playwright-core +
// a chromium build were already on that machine). If it fails for a harness reason, fix the harness, not the game.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('smoke: skipped (playwright-core not found; see header of tools/smoke.mjs)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [];
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] }); } catch (e) { console.log('smoke: skipped (no chromium: ' + e.message.split('\n')[0] + ')'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 900, height: 500 } });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
try {
  const bike = opt('--bike'), gfx = opt('--gfx'), tod = opt('--tod'), set = { ...(bike && { bike }), ...(gfx && { gfx }), ...(tod && { tod: +tod }) };
  if (Object.keys(set).length) await pg.addInitScript(o => localStorage.setItem('cpmme', JSON.stringify(o)), set);
  if (!a.includes('--webgpu')) await pg.addInitScript(() => sessionStorage.setItem('cpmGL', '1'));
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
  const r = await pg.evaluate(async () => {
    const c = window.__cpm, S = c.S, out = {}; c.reset && c.reset();
    for (const id of Object.keys(c.ctx.bikes)) { c.setBike(id); await new Promise(r => setTimeout(r, 150)); out[id] = { v: +S.v.toFixed(2), x: Number.isFinite(S.x) }; }
    return { bikes: out, build: document.getElementById('mFoot').textContent };
  });
  const bad = Object.entries(r.bikes).filter(([, v]) => !v.x).map(([k]) => k); if (bad.length) errs.push('non-finite position after switching to ' + bad.join(', '));
  if (a.includes('--perf')) for (let i = 0; i < 5; i++) { console.log(await pg.evaluate(perfProbe, [i, +(opt('--top') || 14)])); if (opt('--shot')) await pg.screenshot({ path: opt('--shot').replace(/(\.png)?$/, '-' + i + '.png') }); }
  else if (opt('--shot')) await pg.screenshot({ path: opt('--shot') });
  console.log(errs.length ? '' : `smoke: ok (${Object.keys(r.bikes).length} bikes switched, ${r.build})`);
} catch (e) { errs.push('harness: ' + e.message.split('\n')[0]); }
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);

// runs in the page (--perf): draw calls at a few spots, then the visible objects grouped by geometry+material
async function perfProbe([only, top]) {
  const c = window.__cpm, S = c.S, r = c.renderer, THREE = await import('three'), W = await import('./js/world.js'), out = [];
  const frames = n => new Promise(res => { const f = () => --n ? requestAnimationFrame(f) : res(); requestAnimationFrame(f); });
  const T = W.ROADS.find(q => q.hwy), mid = T.s[(T.s.length / 3) | 0];
  const spots = [['lot', null], ['town', [0, -6, 0]], ['highway', [mid.x, mid.z, Math.atan2(mid.tx, mid.tz)]], ['town edge', [-150, -3, Math.PI / 2]], ['plaza', [124, 8, Math.PI]]];
  const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), sp = new THREE.Sphere();
  for (const [name, p] of [spots[only]]) {
    c.reset(); if (p) { S.x = p[0]; S.z = p[1]; S.psi = p[2]; S.v = 0; S.zH = W.H(S.x, S.z) + 1; c.syncBody(); }
    await frames(30); let dc = 0, tri = 0; for (let i = 0; i < 10; i++) { await frames(1); dc += r.info.render.drawCalls; tri += r.info.render.triangles; }
    const cam = c.camera; cam.updateMatrixWorld(); fr.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const G = new Map(); let objs = 0;
    c.scene.traverseVisible(o => {
      if (!(o.isMesh || o.isLine || o.isPoints) || !o.layers.test(cam.layers)) return;
      if (o.frustumCulled) { if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); sp.copy(o.boundingSphere).applyMatrix4(o.matrixWorld); } else { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); sp.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); } if (!fr.intersectsSphere(sp)) return; }
      const m = Array.isArray(o.material) ? o.material.length : 1; objs += m;
      let n = o, path = ''; while (n && n !== c.scene && !path) { path = n.name; n = n.parent; }
      const mt = Array.isArray(o.material) ? o.material[0] : o.material, pos = o.geometry.attributes.position;
      const k = (path || o.parent && o.parent.type) + ' ' + (o.isInstancedMesh ? 'Inst' : o.type) + ' ' + mt.type + '#' + mt.id;
      const g = G.get(k) || { n: 0, v: 0, ex: o.geometry.type + (o.isInstancedMesh ? ' ×' + o.count : '') + ' @' + o.matrixWorld.elements[12].toFixed(0) + ',' + o.matrixWorld.elements[14].toFixed(0) }; g.n += m; g.v += pos ? pos.count * (o.isInstancedMesh ? o.count : 1) : 0; G.set(k, g);
    });
    const BT = await import('./js/batch.js'), bs = BT.batchStats(), t0 = performance.now(); for (let i = 0; i < 200; i++) BT.batchCull(cam); const bc = (performance.now() - t0) / 200;
    out.push(`${name.padEnd(10)} prop batches ${bs.length}: ${bs.reduce((a, b) => a + b.n, 0)} instances in ${bs.reduce((a, b) => a + b.cells, 0)} cells (${bs.reduce((a, b) => a + b.vis, 0)} shown), batchCull ${(bc * 1000).toFixed(0)} us/frame on this machine's CPU`);
    out.push(`${name.padEnd(10)} drawCalls ${(dc / 10).toFixed(0).padStart(4)}  tris ${(tri / 10 / 1000).toFixed(0)}k  main-camera objects ${objs}` + '\n' + [...G].sort((a, b) => b[1].n - a[1].n).slice(0, top).map(([k, g]) => '    ' + String(g.n).padStart(4) + '  ' + k + '  (' + (g.v / 1000).toFixed(0) + 'k verts; e.g. ' + g.ex + ')').join('\n'));
  }
  return out.join('\n');
}
