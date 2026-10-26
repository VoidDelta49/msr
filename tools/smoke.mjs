#!/usr/bin/env node
// Browser smoke test: serves the repo, opens it in headless Chromium, taps PLAY, waits for the game to start, then drives it through
// window.__cpm (the debug hook) and fails on any console error / page error.  NEEDS a browser, which the other tools don't:
//   npm i playwright-core && npx playwright-core install chromium-headless-shell     (in a scratch dir, NOT in the repo)
//   PW=/path/to/node_modules/playwright-core node tools/smoke.mjs [--bike click125] [--shot out.png]
// Without playwright it exits 0 with "skipped" so it never blocks tools/test.mjs workflows. NOTE: written without being able to run it
// in the session that created it (no browser could be downloaded there): if it fails for a harness reason, fix the harness, not the game.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('smoke: skipped (playwright-core not found; see header of tools/smoke.mjs)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [];
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] }); } catch (e) { console.log('smoke: skipped (no chromium: ' + e.message.split('\n')[0] + ')'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 900, height: 500 } });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
try {
  const bike = opt('--bike'); if (bike) await pg.addInitScript(b => localStorage.setItem('cpmme', JSON.stringify({ bike: b })), bike);
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
  const r = await pg.evaluate(async () => {
    const c = window.__cpm, S = c.S, out = {}; c.reset && c.reset();
    for (const id of Object.keys(c.ctx.bikes)) { c.setBike(id); await new Promise(r => setTimeout(r, 150)); out[id] = { v: +S.v.toFixed(2), x: Number.isFinite(S.x) }; }
    return { bikes: out, build: document.getElementById('mFoot').textContent };
  });
  const bad = Object.entries(r.bikes).filter(([, v]) => !v.x).map(([k]) => k); if (bad.length) errs.push('non-finite position after switching to ' + bad.join(', '));
  if (opt('--shot')) await pg.screenshot({ path: opt('--shot') });
  console.log(errs.length ? '' : `smoke: ok (${Object.keys(r.bikes).length} bikes switched, ${r.build})`);
} catch (e) { errs.push('harness: ' + e.message.split('\n')[0]); }
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
