#!/usr/bin/env node
// Bike mesh budget in a real browser (WebGL 2): for every bike (or --bike id) the triangles, vertices and meshes of the drawn bike
// model (B.root, rider included) and how many of them are draw calls, plus the budget of just the wheels (front+rear).
//   PW=/opt/npm-tools/node_modules/playwright-core PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/bikemesh.mjs [--bike id] [--shot dir] [--json]
// --look '{"cfw":1,"wc":16755200,"rim":43775}': merged into the bike's spec and applied (applyLook) before measuring / the screenshots.
// --shot dir: opens the garage and writes dir/<bike>-side.png (wheel close-up from the side) and dir/<bike>-3q.png (3/4 view).
// Used to compare model changes: run before and after, diff the table. Counts are exact; the screenshots are for eyes.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('bikemesh: skipped (playwright-core not found; see tools/smoke.mjs)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [], shot = opt('--shot');
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.log('bikemesh: skipped (no chromium)'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
if (shot) mkdirSync(shot, { recursive: true });
const rows = [];
try {
  await pg.addInitScript(() => { sessionStorage.setItem('cpmGL', '1'); localStorage.setItem('cpmme', JSON.stringify({ tod: 12 })); });
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
  const ids = opt('--bike') ? [opt('--bike')] : await pg.evaluate(() => Object.keys(window.__cpm.ctx.bikes));
  for (const id of ids) {
    await pg.evaluate(async id => { window.__cpm.setBike(id); await new Promise(r => setTimeout(r, 250)); }, id);
    if (opt('--look')) await pg.evaluate(async l => { const M = await import('./js/model.js'); M.applyLook({ ...window.__cpm.spec(), ...JSON.parse(l) }); }, opt('--look'));
    rows.push({ id, ...await pg.evaluate(() => {
      const B = window.__cpm.B, out = { tri: 0, vert: 0, meshes: 0, draws: 0, wTri: 0, wMeshes: 0 }, wheels = new Set();
      B.frontW.traverse(o => wheels.add(o)); B.rearW.traverse(o => wheels.add(o));
      B.root.traverse(o => {
        if (!o.isMesh || !o.geometry.attributes.position) return; const g = o.geometry, n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        const m = Array.isArray(o.material) ? o.material.length : 1; out.tri += n; out.vert += g.attributes.position.count; out.meshes++; out.draws += m;
        if (wheels.has(o)) { out.wTri += n; out.wMeshes++; }
      });
      return out;
    }) });
    if (shot) {
      await pg.evaluate(() => document.getElementById('bGar').click()); await pg.waitForTimeout(2500); await pg.addStyleTag({ content: '#garage{visibility:hidden!important} #wheelHint{display:none}' });
      const S = await import('node:path');
      for (const [name, v] of [['side', { az: Math.PI / 2, el: .03, r: 1.3, ty: .35, tz: 0 }], ['3q', { az: 2.2, el: .18, r: 1.4, ty: .35, tz: 0 }]]) {
        await pg.evaluate(async v => (await import('./js/studio.js')).view(v), v); await pg.waitForTimeout(5000);
        await pg.screenshot({ path: S.join(shot, `${id}-${name}.png`), timeout: 120000 });
      }
      await pg.evaluate(() => document.getElementById('gClose').click()); await pg.waitForTimeout(400);
    }
  }
} catch (e) { errs.push('harness: ' + e.message.split('\n')[0]); }
if (a.includes('--json')) console.log(JSON.stringify(rows)); else {
  console.log('bike'.padEnd(12) + 'tris'.padStart(7) + 'verts'.padStart(8) + 'meshes'.padStart(8) + 'draws'.padStart(7) + '  wheel tris/meshes');
  for (const r of rows) console.log(r.id.padEnd(12) + String(r.tri).padStart(7) + String(r.vert).padStart(8) + String(r.meshes).padStart(8) + String(r.draws).padStart(7) + `  ${r.wTri} / ${r.wMeshes}`);
  const t = rows.reduce((s, r) => s + r.tri, 0); console.log('total'.padEnd(12) + String(t).padStart(7));
}
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
