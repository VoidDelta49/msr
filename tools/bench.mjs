#!/usr/bin/env node
// In-game benchmark (js/bench.js, Options > System > BENCHMARK) in a real browser: arms it the way the button does, taps PLAY, waits
// for the 10 phases, then checks the run and the saved report. NEEDS playwright-core + chromium like smoke.mjs (skips, exit 0, without):
//   PW=/path/to/playwright-core node tools/bench.mjs [--gl] [--cancel | --menu] [--print]
// Default: WebGPU on swiftshader's Vulkan (as smoke.mjs --webgpu), --gl = WebGL 2. ~2 min: the software renderer runs at 2-6 fps, so the
// timings are meaningless here, but counts, events and the harness are exact. --cancel / --menu: only start a run and stop it (Cancel button / opening Options) (~50 s each).
// --print: write the report to stdout. Checks: menu says START BENCHMARK, all 10 phases, no page/console errors, no shadow-map
// refresh while parked (a negative first-frame dt once froze physics and made the interpolated bike glide, refreshing every frame),
// none in the "shadow-map updates off" phases, post-processing / resolution restored afterwards, options open on System, flag cleared.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const a = process.argv.slice(2), gl = a.includes('--gl');
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('bench: skipped (playwright-core not found; see header of tools/bench.mjs)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [];
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', ...(gl ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader'])] }); } catch (e) { console.log('bench: skipped (no chromium: ' + e.message.split('\n')[0] + ')'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 640, height: 360 } });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200))); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
const ok = (c, m) => { if (!c) errs.push(m); };
try {
  await pg.addInitScript(([g]) => { if (g) sessionStorage.setItem('cpmGL', '1'); sessionStorage.setItem('cpmBench', String(Date.now())); localStorage.removeItem('cpmBench'); }, [gl]);
  await pg.goto(url);
  ok(/START BENCHMARK/.test(await pg.textContent('#mPlayT')), 'the menu button should say START BENCHMARK when the benchmark is armed');
  await pg.click('#mPlay');
  if (a.includes('--cancel') || a.includes('--menu')) {
    await pg.waitForFunction(() => !document.getElementById('bench').hidden, null, { timeout: 240000 });
    await pg.click(a.includes('--menu') ? '#bOpt' : '#benchX'); await pg.waitForTimeout(1500); // --menu: opening Options mid-run must stop it too
    const s = await pg.evaluate(() => ({ hid: document.getElementById('bench').hidden, saved: !!localStorage.getItem('cpmBench'), flag: sessionStorage.getItem('cpmBench'), opts: !document.getElementById('opts').hidden, run: document.body.classList.contains('benching') }));
    ok(s.hid && !s.run, 'cancel should hide the overlay'); ok(!s.saved, 'a cancelled run must not save a report'); ok(s.flag === null, 'the armed flag should be cleared once the run started');
  } else {
    await pg.waitForFunction(() => !!localStorage.getItem('cpmBench'), null, { timeout: 420000, polling: 1000 });
    const j = JSON.parse(await pg.evaluate(() => localStorage.getItem('cpmBench'))), P = j.data.phases, by = Object.fromEntries(P.map(p => [p.id, p]));
    ok(P.length === 10, `expected 10 phases, got ${P.length}`);
    for (const p of P) ok(p.frames >= 8 && p.iv.avg > 0 && p.cpu.avg > 0, `phase ${p.id}: too few frames / empty stats (${p.frames})`);
    ok(by.park.flagged.shadow <= 1, `parked: the shadow map was redrawn on ${by.park.flagged.shadow} of ${by.park.frames} frames (the pose must be stable while parked)`);
    ok(by.a1.flagged.shadow === 0 && by.a4.flagged.shadow === 0, 'the "shadow-map updates off" phases still redrew the shadow map');
    ok(by.hwy.flagged.shadow >= 1, 'no shadow-map refresh at all on the highway (the flag is not being recorded)');
    ok(by.fp.flagged.dash >= 1, 'no dash upload in the first-person phase');
    for (const p of P) ok(!p.cut && p.secs >= 2, `phase ${p.id}: cut short (${p.secs} s recorded): it never settled, or the end condition is counting warm-up time again`);
    ok(/VERDICT/.test(j.text) && /== Parked in town/.test(j.text), 'report text is missing its sections');
    const s = await pg.evaluate(async () => { const c = window.__cpm, R = await import('./js/renderer.js'); return { hid: document.getElementById('bench').hidden, flag: sessionStorage.getItem('cpmBench'), opts: !document.getElementById('opts').hidden, tab: document.querySelector('#oTabs [aria-selected=true]')?.textContent, post: R.BX.post, noShadow: R.BX.noShadow, rs: c.renderer._rs, tod: c.cfg.tod, tough: c.cfg.tough, run: document.body.classList.contains('benching'), shown: document.getElementById('oBench')?.textContent.length > 500 }; });
    ok(s.hid && !s.run, 'the overlay should be gone when the run ends'); ok(s.flag === null, 'the armed flag should be cleared'); ok(s.opts && s.tab === 'System', 'the report should open in Options > System');
    ok(s.post && !s.noShadow && s.rs === 1, 'post-processing / shadow updates / resolution were not restored'); ok(s.shown, 'the System tab does not show the report');
    ok(s.tod === 'live' && !s.tough, `settings the run changes were not restored (tod ${s.tod}, tough ${s.tough})`);
    if (a.includes('--print')) console.log(j.text);
    else console.log(`bench: ${j.data.device.api} · GPU timer ${j.data.device.timer} · ${P.length} phases · ` + P.map(p => `${p.id} ${p.frames}f`).join(' '));
  }
} catch (e) { errs.push('harness: ' + e.message.split('\n')[0]); }
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); if (!errs.length) console.log(`bench: ok (${gl ? 'WebGL 2' : 'WebGPU'}${a.includes('--menu') ? ', menu abort' : a.includes('--cancel') ? ', cancel' : ''})`); process.exit(errs.length ? 1 : 0);
