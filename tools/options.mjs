#!/usr/bin/env node
// Options panel + anti-aliasing in a real browser (headless Chromium, WebGL 2 on swiftshader).  NEEDS playwright-core + chromium like smoke.mjs;
// without them it prints "skipped" and exits 0.   PW=/path/to/node_modules/playwright-core node tools/options.mjs [--quick] [--shot dir]
//  A. panel, from the main menu (fast, no game): fits and scrolls at phone/tablet/desktop sizes (portrait + landscape), every tab renders with
//     no horizontal overflow, tap targets are big enough, switches/segments/sliders write the right keys into localStorage 'cpmme', presets +
//     "Custom", disabled rows, reset-all (two taps), tab memory, and the 11.46 migration of the old `fxaa` boolean to `aa`.
//  B. live game (skipped with --quick; ~1 boot per AA mode): the mode that is really running (renderer.js AA), and that it does what it says:
//     the same still frame is rendered in every mode and the hard luminance steps are counted (all grading/dither filters off); MSAA and FXAA
//     must cut them clearly. Also the reload bar in game: changing a reload-only setting flags it and lists it, changing it back clears the flag,
//     Apply & reload comes back up running the new mode. Swiftshader timings mean nothing, the counts and the states do.
// --shot dir: pictures of every tab at 390x844 and 844x390 (part A) to look at.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('options: skipped (playwright-core not found; see header of tools/smoke.mjs)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, fails = [], notes = [], shots = opt('--shot');
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.log('options: skipped (no chromium: ' + e.message.split('\n')[0] + ')'); srv.close(); process.exit(0); }
const ok = (c, m) => { if (!c) fails.push(m); };
if (shots) fs.mkdirSync(shots, { recursive: true });
const TABS = ['gfx', 'ctl', 'aud', 'game', 'sys'];

// a page whose localStorage starts as `store` on the FIRST load only (a reload keeps what the game saved since)
async function page(vp, store) {
  const pg = await br.newPage({ viewport: { width: vp[0], height: vp[1] } }), errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await pg.addInitScript(s => { sessionStorage.setItem('cpmGL', '1'); if (!sessionStorage.getItem('__t')) { sessionStorage.setItem('__t', '1'); if (s) localStorage.setItem('cpmme', JSON.stringify(s)); else localStorage.removeItem('cpmme'); } }, store || null);
  await pg.goto(url); pg.errs = errs; return pg;
}
const saved = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('cpmme') || '{}'));
const tab = (pg, id) => pg.click(`[data-tab=${id}]`);
const checked = (pg, k) => pg.$$eval(`[data-sg=${k}][aria-checked=true]`, e => e.map(x => x.dataset.v));

/* ---------- A: the panel ---------- */
const VPS = [[390, 844], [360, 640], [844, 390], [640, 360], [1024, 768], [1280, 720]];
for (const vp of VPS) {
  const pg = await page(vp), tag = `${vp[0]}x${vp[1]}`; await pg.click('#mOpt'); await pg.waitForSelector('#opts:not([hidden])');
  for (const id of TABS) {
    await tab(pg, id);
    const m = await pg.evaluate(() => {
      const r = e => e.getBoundingClientRect(), card = r(document.querySelector('.ocard')), body = document.getElementById('oBody'), W = innerWidth, H = innerHeight;
      const small = [...document.querySelectorAll('#oBody .oseg button, #oBody .osw, #oBody .osl')].filter(e => r(e).height < 28 || r(e).width < 28).length;
      const done = r(document.getElementById('oClose')), tabs = [...document.querySelectorAll('#oTabs button')].map(r);
      return { inView: card.left >= 0 && card.right <= W + 1 && card.top >= 0 && card.bottom <= H + 1, hOver: body.scrollWidth - body.clientWidth, rows: body.querySelectorAll('.oi').length, small, doneIn: done.left >= 0 && done.right <= W && done.top >= 0 && done.bottom <= H, tabsIn: tabs.every(t => t.bottom <= H && t.top >= card.top - 1), bodyH: Math.round(r(body).height) };
    });
    ok(m.inView, `${tag} ${id}: card is not inside the screen`); ok(m.hOver <= 1, `${tag} ${id}: body overflows sideways by ${m.hOver}px`); ok(m.rows > 0 || id === 'sys', `${tag} ${id}: no rows rendered`);
    ok(!m.small, `${tag} ${id}: ${m.small} controls smaller than 28px`); ok(m.doneIn, `${tag} ${id}: Done button is not on screen`); ok(m.tabsIn, `${tag} ${id}: tabs run off the card`); ok(m.bodyH >= 120, `${tag} ${id}: only ${m.bodyH}px left for the settings`);
    if (shots && (tag === '390x844' || tag === '844x390')) await pg.screenshot({ path: `${shots}/opt-${tag}-${id}.png` });
  }
  // the long tab scrolls inside the body and the header + tabs stay put
  await tab(pg, 'gfx'); const sc = await pg.evaluate(() => { const b = document.getElementById('oBody'), t0 = document.getElementById('oTabs').getBoundingClientRect().top; b.scrollTop = 99999; return { can: b.scrollHeight > b.clientHeight, moved: b.scrollTop > 0, t1: document.getElementById('oTabs').getBoundingClientRect().top - t0 }; });
  ok(!sc.can || sc.moved, `${tag}: Graphics tab does not scroll`); ok(Math.abs(sc.t1) < 1, `${tag}: tabs moved when the body scrolled`);
  ok(!pg.errs.length, `${tag}: ${pg.errs[0]}`); await pg.close();
}

{ // behaviour at a phone-landscape size
  const pg = await page([844, 390]); await pg.click('#mOpt'); await tab(pg, 'gfx');
  ok((await checked(pg, 'preset')).join() === 'bal', 'defaults should show the Balanced preset'); ok((await checked(pg, 'aa')).join() === 'fxaa', 'default anti-aliasing should be FXAA');
  ok(await pg.$$eval('[data-sg=aa]', e => e.map(x => x.textContent).join('|')) === 'Off|FXAA|MSAA 2×|MSAA 4×|MSAA 4× + FXAA', 'anti-aliasing choices should be Off / FXAA / MSAA 2× / MSAA 4× / MSAA 4× + FXAA');
  await pg.click('[data-sw=grade]'); ok((await saved(pg)).grade === false, 'switch did not save grade=false'); ok(await pg.getAttribute('[data-sw=grade]', 'aria-checked') === 'false', 'switch did not flip');
  ok(await pg.isHidden('#oApply'), 'the reload bar must stay hidden while the game is not loaded');
  await pg.click('[data-sg=aa][data-v=msaa4]'); ok((await saved(pg)).aa === 'msaa4', 'MSAA 4× did not save'); ok((await checked(pg, 'preset')).join() === 'custom', 'a changed preset value should read Custom');
  ok(await pg.isDisabled('[data-sg=preset][data-v=custom]'), 'Custom is a readout, not a button');
  await pg.click('[data-sg=preset][data-v=perf]'); let s = await saved(pg); ok(s.gfx === 'low' && s.aa === 'off' && s.ibl === false && s.autoRes === true, 'Performance preset values wrong: ' + JSON.stringify(s));
  ok(await pg.$eval('[data-sw=ibl]', e => e.disabled), 'sky lighting must be disabled on Low quality'); ok((await checked(pg, 'preset')).join() === 'perf', 'Performance preset should read as active');
  await pg.click('[data-sg=preset][data-v=qual]'); s = await saved(pg); ok(s.gfx === 'high' && s.aa === 'msaa4' && s.ibl === true, 'Quality preset values wrong: ' + JSON.stringify(s));
  await pg.click('[data-sg=retro][data-v="360"]'); ok((await saved(pg)).retro === 360, 'retro resolution did not save as a number'); await pg.click('[data-sg=fpsCap][data-v="0"]'); ok((await saved(pg)).fpsCap === 0, 'uncapped should save 0');
  await tab(pg, 'ctl'); await pg.$eval('[data-sl=fov]', e => { e.value = 90; e.dispatchEvent(new Event('input', { bubbles: true })); }); ok((await saved(pg)).fov === 90, 'FOV slider did not save'); ok(await pg.$eval('[data-sl=fov]', e => e.closest('.oi').querySelector('output').textContent) === '90°', 'FOV readout should say 90°');
  await pg.$eval('[data-sl=ui]', e => { e.value = 12; e.dispatchEvent(new Event('input', { bubbles: true })); }); ok(await pg.evaluate(() => document.body.style.getPropertyValue('--k')) === '1.2', 'touch size slider should apply --k live');
  await pg.click('[data-sw=lefty]'); ok(await pg.evaluate(() => document.body.classList.contains('lefty')), 'left-handed switch should mirror the layout live');
  await tab(pg, 'aud'); await pg.click('[data-sw=sound]'); ok(await pg.$eval('[data-sl=vol]', e => e.disabled), 'volume must be disabled with sound off'); ok(await pg.$eval('[data-sw=amb]', e => e.disabled), 'ambient must be disabled with sound off');
  await tab(pg, 'game'); await pg.click('[data-sg=tod][data-v="17.3"]'); ok((await saved(pg)).tod === 17.3, 'time of day should save a number'); await pg.click('[data-sg=tod][data-v=live]'); ok((await saved(pg)).tod === 'live', 'live time of day should save "live"');
  // tab memory
  await pg.click('#oClose'); await pg.click('#mOpt'); ok(await pg.getAttribute('[data-tab=game]', 'aria-selected') === 'true', 'the last tab should be remembered');
  // reset: first tap only asks
  await tab(pg, 'sys'); await pg.click('[data-act=reset]'); ok((await saved(pg)).aa === 'msaa4', 'first reset tap must not reset'); ok((await pg.textContent('[data-act=reset]')).includes('again'), 'first reset tap should ask to tap again');
  await pg.click('[data-act=reset]'); s = await saved(pg); ok(s.aa === 'fxaa' && s.gfx === 'med' && s.grade === true && s.sound === true && s.fov === 72 && s.retro === 0, 'reset-all did not restore the defaults: ' + JSON.stringify(s));
  ok(await pg.evaluate(() => !document.body.classList.contains('lefty') && document.body.style.getPropertyValue('--k') === '1'), 'reset-all should restore the touch layout live');
  ok(!pg.errs.length, 'panel: ' + pg.errs[0]); await pg.close();
}

{ // the 11.46 migration of the old FXAA toggle
  for (const [store, want] of [[{ fxaa: false, bike: 'click125' }, 'off'], [{ fxaa: true }, 'fxaa'], [{ aa: 'msaa2', fxaa: true }, 'msaa2'], [{ aa: 'bogus' }, 'fxaa'], [null, 'fxaa']]) {
    const pg = await page([844, 390], store), got = await pg.evaluate(async () => { const c = (await import('./js/config.js')).cfg; return { aa: c.aa, fxaa: 'fxaa' in c, bike: c.bike }; });
    ok(got.aa === want, `migration of ${JSON.stringify(store)}: aa is ${got.aa}, wanted ${want}`); ok(!got.fxaa, 'the old fxaa key should be gone from cfg'); if (store && store.bike) ok(got.bike === store.bike, 'migration must keep other settings'); await pg.close();
  }
}

/* ---------- B: the live game ---------- */
const MODES = { off: { ms: 0, fx: false }, fxaa: { ms: 0, fx: true }, msaa2: { ms: 2, fx: false }, msaa4: { ms: 4, fx: false }, msaa4fx: { ms: 4, fx: true } };
const hard = {};
// count hard luminance steps between neighbouring pixels in the PNG (an un-antialiased edge is one hard step, an antialiased one is two or three soft ones)
const EDGES = async b64 => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height, L = i => d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; let hd = 0, sf = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const i = (y * w + x) * 4; for (const j of [i + 4, i + w * 4]) { const q = Math.abs(L(i) - L(j)); if (q >= 40) hd++; else if (q >= 6) sf++; } }
  return { hard: hd, soft: sf };
};
async function boot(mode, extra) {
  const pg = await page([960, 540], { aa: mode, gfx: 'med', grade: false, nightFx: false, n64: false, ibl: false, autoRes: false, fpsCap: 0, retro: 0, tod: 12, ...extra });
  await pg.click('#mPlay'); await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 180000 }); return pg;
}
async function still(pg) { // the same frame every time: bike at the lot, HUD hidden
  await pg.evaluate(async () => { const c = window.__cpm; c.reset(); c.S.v = 0; c.syncBody(); for (const id of ['top', 'perf', 'msg', 'tc', 'gauge', 'mini', 'tags', 'race', 'ride', 'mis', 'rcd']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } await new Promise(r => { let n = 40; const f = () => --n ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); }); });
  const buf = await pg.screenshot({ clip: { x: 160, y: 60, width: 640, height: 300 } }); return pg.evaluate(EDGES, buf.toString('base64'));
}
if (!a.includes('--quick')) {
  for (const mode of Object.keys(MODES)) {
    const pg = await boot(mode), AA = await pg.evaluate(async () => { const r = await import('./js/renderer.js'); return { ...r.AA }; }), want = MODES[mode];
    ok(AA.mode === mode, `${mode}: renderer says mode ${AA.mode}`); ok(AA.fx === want.fx, `${mode}: FXAA is ${AA.fx}, wanted ${want.fx}`);
    if (want.ms && !AA.ms) notes.push(`${mode}: this GPU/driver offers no MSAA here (${AA.why}); that path ran as FXAA`); else ok(AA.ms === want.ms || (want.ms && AA.why), `${mode}: MSAA samples are ${AA.ms}, wanted ${want.ms}`);
    hard[mode] = await still(pg); notes.push(`${mode.padEnd(8)} running as ${AA.label.padEnd(15)} hard steps ${String(hard[mode].hard).padStart(6)}  soft ${String(hard[mode].soft).padStart(6)}`);

    if (mode === 'fxaa') { // the reload bar, in game
      await pg.click('#bOpt'); await pg.waitForSelector('#opts:not([hidden])'); await tab(pg, 'gfx');
      ok(await pg.isHidden('#oApply'), 'live: reload bar visible before any change'); ok((await checked(pg, 'preset')).join() === 'custom' || (await checked(pg, 'preset')).length === 1, 'live: preset readout missing');
      await pg.click('[data-sg=aa][data-v=msaa4]'); ok(await pg.isVisible('#oApply'), 'live: reload bar should show after changing anti-aliasing'); ok((await pg.textContent('#oApplyT')).includes('Anti-aliasing'), 'live: the bar should name what needs the reload'); ok(await pg.$$eval('.oi.pend', e => e.length) === 1, 'live: exactly the changed row should be marked');
      await pg.click('[data-sw=grade]'); ok((await pg.textContent('#oApplyT')).includes('Colour grading'), 'live: a second change should join the same bar');
      await pg.click('[data-sw=grade]'); await pg.click('[data-sg=aa][data-v=fxaa]'); ok(await pg.isHidden('#oApply'), 'live: changing everything back should clear the reload bar');
      await pg.click('[data-sg=fpsCap][data-v="30"]'); ok(await pg.isHidden('#oApply'), 'live: the frame cap applies live and must not ask for a reload');
      await pg.click('[data-sg=fpsCap][data-v="0"]'); await pg.click('[data-sg=aa][data-v=msaa4]');
      await Promise.all([pg.waitForNavigation({ timeout: 60000 }), pg.click('#oReload')]);
      await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 180000 }).catch(async () => { await pg.click('#mPlay'); await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 180000 }); });
      const A2 = await pg.evaluate(async () => ({ ...(await import('./js/renderer.js')).AA }));
      ok(A2.mode === 'msaa4', `Apply & reload: came back as ${A2.mode}, wanted msaa4`); hard.afterReload = await still(pg);
      notes.push(`after Apply & reload: running as ${A2.label}, hard steps ${hard.afterReload.hard}`);
    }
    ok(!pg.errs.length, `${mode}: ${pg.errs[0]}`); await pg.close();
  }
  const off = hard.off.hard, pct = m => ((1 - hard[m].hard / off) * 100).toFixed(0) + '%';
  notes.push(`hard steps removed vs Off: FXAA ${pct('fxaa')}, MSAA 2× ${pct('msaa2')}, MSAA 4× ${pct('msaa4')}, MSAA 4× + FXAA ${pct('msaa4fx')}`);
  ok(hard.fxaa.hard < off * .9, 'FXAA should remove at least 10% of the hard steps'); ok(hard.msaa4.hard < off * .9, 'MSAA 4× should remove at least 10% of the hard steps');
  ok(hard.msaa2.hard < off * .95, 'MSAA 2× should remove at least 5% of the hard steps'); ok(hard.msaa4.hard <= hard.msaa2.hard * 1.02, 'MSAA 4× should not be rougher than 2×'); ok(hard.msaa4fx.hard <= hard.msaa4.hard * 1.02, 'MSAA 4× + FXAA should not be rougher than MSAA 4× alone');
  ok(hard.afterReload.hard < off * .9, 'the mode picked in the reload bar should really be running after the reload');
}

for (const n of notes) console.log('  ' + n);
for (const f of fails) console.log('FAIL  ' + f);
if (!fails.length) console.log(`options: ok (${VPS.length} viewports x ${TABS.length} tabs, behaviour, migration${a.includes('--quick') ? '' : ', ' + Object.keys(MODES).length + ' anti-aliasing modes in the live game'})`);
await br.close(); srv.close(); process.exit(fails.length ? 1 : 0);
