#!/usr/bin/env node
// Night lighting pictures (13.0 lamp lights + bounce): the bike under street lamps in town at night, the headlight on, and in Ilalim.
// Needs playwright (skips itself otherwise). node tools/nightshot.mjs --shot dir [--tod 21] [--webgpu] [--gfx med] [--spot town,plaza,cave]
// Prints the active lamp lights / bounce lights per spot and fails on page errors.
import { wxRoute } from './lib/wxroute.mjs';
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { try { pw = createRequire(import.meta.url)('playwright'); } catch { console.log('nightshot: skipped (no playwright)'); process.exit(0); } }
const dir = opt('--shot'), tod = +opt('--tod', 21), only = (opt('--spot') || 'town,plaza,cave').split(','), errs = [];
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`;
const br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', ...(a.includes('--webgpu') ? ['--enable-features=Vulkan', '--use-vulkan=swiftshader'] : [])] });
const pg = await br.newPage({ viewport: { width: 960, height: 540 } });
await wxRoute(pg);
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
await pg.addInitScript(o => localStorage.setItem('cpmme', JSON.stringify(o)), { tod, wx: 'clear', ...(opt('--gfx') && { gfx: opt('--gfx') }) });
if (!a.includes('--webgpu')) await pg.addInitScript(() => sessionStorage.setItem('cpmGL', '1'));
await pg.goto(url + (opt('--q') ? '?' + opt('--q') : '')); await pg.click('#mPlay');
await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
for (const spot of only) {
  const r = await pg.evaluate(async spot => {
    const c = window.__cpm, S = c.S, W = await import('./js/world.js'), frames = n => new Promise(res => { const f = () => --n ? requestAnimationFrame(f) : res(); requestAnimationFrame(f); });
    c.reset();
    if (spot.startsWith('cave')) { const U = W.UG, C = U.C.find(q => q.id === (spot.split(':')[1] || 'entry')) || U.C[1], L = U.lights && U.lights.find(l => l.k === 'lamp' && Math.hypot(l.x - U.ox - C.x, l.z - U.oz - C.z) < C.r * 1.2);
      S.x = L ? L.x + 3 : U.ox + C.x; S.z = L ? L.z + 3 : U.oz + C.z; S.psi = 2.2; S.v = 0; S.zH = W.H(S.x, S.z) + .3; c.syncBody && c.syncBody(); }
    else { const L = W.LAMPS || [], P = spot === 'plaza' ? [124, 8, Math.PI] : [0, -6, 0];
      let x = P[0], z = P[1], psi = P[2];
      if (spot === 'lamp' || spot === 'town') { let b = 1e9, best = null; const ref = spot === 'lamp' ? [124, 8] : [0, -6]; for (const l of L) { const d = Math.hypot(l.x - ref[0], l.z - ref[1]); if (d < b && l.y - l.gy > 4) { b = d; best = l; } }
        if (best) { x = best.x + 2.2; z = best.z + 2.6; const fx = x - best.x, fz = z - best.z, fl = Math.hypot(fx, fz); psi = Math.atan2(-fx / fl, -fz / fl) + .5; } }
      S.x = x; S.z = z; S.psi = psi; S.v = 0; S.zH = W.H(S.x, S.z) + 0.3; c.syncBody && c.syncBody(); }
    if (c.ctx.camMode === 0) c.toggleCam(); c.startEngine && c.startEngine(); await frames(120);
    const LL = c.LAMPL || null; return { spot, x: S.x, z: S.z, lights: LL ? LL.stats : null };
  }, spot);
  console.log(JSON.stringify(r));
  if (dir) await pg.screenshot({ path: `${dir}/${spot}.png` });
  if (dir && a.includes('--ab')) { await pg.evaluate(async () => { const c = window.__cpm; c.LAMPL.on = false; c.probes.enabled = false; await new Promise(r => setTimeout(r, 1500)); }); await pg.screenshot({ path: `${dir}/${spot}-off.png` }); await pg.evaluate(() => { const c = window.__cpm; c.LAMPL.on = true; c.probes.enabled = true; }); }
}
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
