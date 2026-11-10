#!/usr/bin/env node
// CPU profile of the real frame loop: where the JavaScript time of a frame goes, by function and by file.
// Runs the in-game benchmark's scripted ride (js/bench.js: town, highway, first person) in headless Chromium with the V8
// sampling profiler on, then prints self time per function / per file as ms per frame.  NEEDS playwright like smoke.mjs:
//   PW=/path/to/playwright node tools/prof.mjs [--webgpu] [--top 40] [--secs 45] [--file world.js] [--json out.json] [--alloc]
// Swiftshader makes the GPU side meaningless, but JS self time (physics, culling, three's scene walk, HUD, audio) is real
// and comparable before / after a change on the same machine. --alloc: the sampling heap profiler instead: bytes allocated
// per frame by function (garbage = GC pauses on a phone; swiftshader runs ~1 fps, so timer-driven code looks bigger per frame).
// (program)/(idle)/(garbage collector) rows are V8's own.
import { wxRoute } from './lib/wxroute.mjs';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('prof: skipped (playwright-core not found; see header of tools/smoke.mjs)'); process.exit(0); }
const gpu = a.includes('--webgpu'), top = +opt('--top', 40), secs = +opt('--secs', 45), only = opt('--file');
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`;
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', ...(gpu ? ['--enable-features=Vulkan', '--use-vulkan=swiftshader'] : [])] }); } catch (e) { console.log('prof: skipped (no chromium: ' + e.message.split('\n')[0] + ')'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 640, height: 360 } }); let bad = 0;
await wxRoute(pg); // live weather answered locally (tools/lib/wxroute.mjs)
pg.on('pageerror', e => { bad++; console.log('pageerror: ' + e.message.slice(0, 200)); });
try {
  await pg.addInitScript(([g]) => { if (g) sessionStorage.setItem('cpmGL', '1'); sessionStorage.setItem('cpmBench', String(Date.now())); localStorage.removeItem('cpmBench'); }, [!gpu]);
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => !document.getElementById('bench').hidden, null, { timeout: 240000 });
  await pg.waitForTimeout(3000); // past the first phase's warm-up (shader compiles)
  const cdp = await pg.context().newCDPSession(pg);
  if (a.includes('--alloc')) {
    await cdp.send('HeapProfiler.enable'); const f0 = await pg.evaluate(() => window.__cpm.renderer.info.frame);
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await pg.waitForTimeout(secs * 1000);
    const { profile } = await cdp.send('HeapProfiler.stopSampling'), frames = await pg.evaluate(() => window.__cpm.renderer.info.frame) - f0, fn = new Map(); let tot = 0;
    const walk = n => { const c = n.callFrame, k = (c.functionName || '(anon)') + '  ' + (c.url.replace(/^.*\/(js|vendor)\//, '$1/').replace(/\?.*$/, '') || '(native)') + (c.url ? ':' + (c.lineNumber + 1) : ''); if (n.selfSize) { fn.set(k, (fn.get(k) || 0) + n.selfSize); tot += n.selfSize; } n.children.forEach(walk); }; walk(profile.head);
    console.log(`prof --alloc: ${frames} frames in ${secs} s, ${(tot / frames / 1024).toFixed(1)} KB allocated per frame`);
    console.log([...fn].filter(([k]) => !only || k.includes(only)).sort((x, y) => y[1] - x[1]).slice(0, top).map(([k, b]) => (b / frames / 1024).toFixed(2).padStart(8) + ' KB/frame ' + (b / tot * 100).toFixed(1).padStart(5) + '%  ' + k).join('\n'));
    await br.close(); srv.close(); process.exit(bad ? 1 : 0);
  }
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  const f0 = await pg.evaluate(() => window.__cpm.renderer.info.frame); await cdp.send('Profiler.start');
  await pg.waitForTimeout(secs * 1000);
  const { profile } = await cdp.send('Profiler.stop'), frames = await pg.evaluate(() => window.__cpm.renderer.info.frame) - f0;
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(profile));
  const self = new Map(), N = new Map(profile.nodes.map(n => [n.id, n])); let prev = 0, total = 0;
  profile.samples.forEach((id, i) => { const dt = profile.timeDeltas[i] / 1000; self.set(id, (self.get(id) || 0) + dt); total += dt; });
  const fn = new Map(), file = new Map(), short = u => u.replace(/^.*\/(js|vendor)\//, '$1/').replace(/\?.*$/, '') || '(native)';
  for (const [id, ms] of self) { const c = N.get(id).callFrame, f = short(c.url), k = (c.functionName || '(anon)') + '  ' + f + (c.url ? ':' + (c.lineNumber + 1) : ''); fn.set(k, (fn.get(k) || 0) + ms); file.set(f, (file.get(f) || 0) + ms); }
  const busy = total - (fn.get('(idle)  (native)') || 0), row = ([k, ms]) => (ms / frames).toFixed(3).padStart(8) + ' ms/frame ' + (ms / busy * 100).toFixed(1).padStart(5) + '%  ' + k;
  console.log(`prof: ${frames} frames in ${secs} s (${gpu ? 'WebGPU' : 'WebGL 2'}), JS busy ${(busy / frames).toFixed(2)} ms/frame`);
  console.log('-- by file'); console.log([...file].filter(([k]) => k !== '(native)').sort((x, y) => y[1] - x[1]).slice(0, 16).map(row).join('\n'));
  console.log('-- by function (self time)'); console.log([...fn].filter(([k]) => !/^\((idle|program)\)/.test(k) && (!only || k.includes(only))).sort((x, y) => y[1] - x[1]).slice(0, top).map(row).join('\n'));
} catch (e) { bad++; console.log('FAIL  harness: ' + e.message.split('\n')[0]); }
await br.close(); srv.close(); process.exit(bad ? 1 : 0);
