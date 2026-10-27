#!/usr/bin/env node
// Real-browser layout check: loads the game's real index.html + css/style.css + js/layout.js in headless Chromium (menu script and
// game NOT started, the HUD elements are just there), then for every phone viewport (tools/lib/phones.mjs) x control scheme x
// left-handed x gauge x touch size x notch x banner scenario it runs the layout and measures the actual DOM boxes. Fails when
//   - two visible controls overlap, or one leaves the safe area            (what the solver promises, checked on the real elements)
//   - a button / readout label is cut off (scrollWidth > clientWidth)        (the label widths the solver assumes are wrong)
//   - a quest / race / ride banner grows beyond the zone the solver reserved (bannerH() no longer matches the CSS)
//   - the solver reports a viewport as not ok
// Needs playwright (Chromium); exits 0 with "skipped" without it, like smoke.mjs.
//   node tools/layout-dom.mjs [--size WxH] [--shot dir]      --shot writes PNGs of a few scenarios (of --size, else six common viewports) into dir
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
import { PHONES, NO_NOTCH, insFor } from './lib/phones.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright'); } catch { try { pw = createRequire(import.meta.url)('playwright-core'); } catch { console.log('layout-dom: skipped (playwright not found; see tools/smoke.mjs)'); process.exit(0); } }
const srv = await serve(0), base = `http://localhost:${srv.address().port}/`;
let br; try { br = await pw.chromium.launch(); } catch (e) { console.log('layout-dom: skipped (no chromium: ' + e.message.split('\n')[0] + ')'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 400, height: 800 } }), errs = [];
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
// serve index.html without the title menu / game script, plus a stand-in look for the canvases and a handle on layout.js
await pg.route('**/index.html*', async r => {
  let html = (await (await r.fetch()).text()).replace(/<script type="module" src="js\/menu\.js[^>]*><\/script>/, '').replace(/<link rel="(modulepreload|preload)"[^>]*>/g, '');
  html = html.replace('</body>', `<style>#menu{display:none!important}#mini{background:#2b4a6b}#gauge{background:#41322b}#gl{background:#111}</style>
<script type="module">import { relayout, LAYOUT } from './js/layout.js'; import { cfg } from './js/config.js'; window.__L = { relayout, LAYOUT, cfg }; window.__ready = true;</script></body>`);
  r.fulfill({ response: await r.fetch(), body: html, contentType: 'text/html' });
});
await pg.goto(base + 'index.html'); await pg.waitForFunction(() => window.__ready, null, { timeout: 15000 });

// everything below runs inside the page: one pass over all combinations for the current viewport
const PASS = async ({ notchOpts, only }) => {
  const $ = id => document.getElementById(id), body = document.body, { relayout, LAYOUT, cfg } = window.__L, out = [];
  const W = innerWidth, H = innerHeight;
  const SC = { manual: [], scooter: ['cvt'], rotary: ['nocl'] }, BAN = ['race', 'ride', 'mis'];
  const TEXT = { raceT: 'Waiting for Alexander (parcel race)…', rideT: 'Alexander wants to ride in your sidecar', misT: 'FOOD 100% · HEAT 100% · 1234 m · STOP' };
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const vis = el => el.getClientRects().length > 0;
  const shown = (el, on) => { el.hidden = !on; };
  $('perf').textContent = 'WebGPU · 60 fps · phys 8.3 ms · 1234 draws · res 75% · jank 3 (12%)';
  for (const notch of notchOpts) for (const [sc, cls] of Object.entries(SC)) for (const lefty of [false, true]) for (const cam3 of [false, true]) for (const k of [7, 10, 14]) for (const perf of [true, false]) for (const ban of BAN) {
    if (only && (only.sc !== sc || only.cam3 !== cam3 || only.ban !== ban || lefty || k !== 10 || !perf || notch)) continue; // screenshots: exactly one scenario, left on screen
    cfg.ui = k; cfg.lefty = lefty; LAYOUT.ins = notch ? (W <= H ? { l: 0, r: 0, t: 47, b: 34 } : { l: 47, r: 47, t: 0, b: 21 }) : { l: 0, r: 0, t: 0, b: 0 };
    body.classList.add('touch'); body.classList.toggle('lefty', lefty); body.classList.toggle('cam3', cam3); body.classList.toggle('cvt', cls[0] === 'cvt'); body.classList.toggle('nocl', cls[0] === 'nocl');
    shown($('perf'), perf);
    for (const b of BAN) shown($(b), b === ban);
    // worst-case content per banner
    $('raceT').textContent = TEXT.raceT; $('rideT').textContent = TEXT.rideT; $('misT').textContent = TEXT.misT;
    $('raceY').textContent = 'ACCEPT'; $('raceP').textContent = '📦 PARCEL'; $('raceF').textContent = '🍔 FOOD'; $('raceX').textContent = '✕'; shown($('raceY'), true); shown($('raceP'), true); shown($('raceF'), true);
    $('rideY').textContent = 'GET OFF'; $('rideB').textContent = 'RACE'; $('rideX').textContent = '✕'; shown($('rideY'), true); shown($('rideB'), true); shown($('rideX'), true);
    $('misNext').textContent = 'Next'; $('misX').textContent = 'OK'; shown($('misNext'), true);
    $('bCam').textContent = 'CAM: 3RD'; $('bFoot').textContent = 'GET OFF'; shown($('bFoot'), true);
    LAYOUT.key = ''; const res = relayout();
    const tag = `${W}x${H}${notch ? ' notch' : ''} ${sc}${lefty ? ' lefty' : ''}${cam3 ? ' cam3' : ''} k=${k / 10}${perf ? '' : ' noperf'} banner=${ban}`;
    if (!res.ok) { out.push(`${tag}: solver not ok: ${res.why}`); continue; }
    const ids = ['mini', 'top', 'perf', 'bFoot', ban, 'wheel', 'lb', 'thr', 'brk', 'clu', 'shift', 'gauge'].filter(id => vis($(id))), R = {};
    for (const id of ids) R[id] = rect($(id));
    const ins = LAYOUT.ins;
    for (const id of ids) { const r = R[id]; if (r.x < ins.l - .6 || r.y < ins.t - .6 || r.x + r.w > W - ins.r + .6 || r.y + r.h > H - ins.b + .6) out.push(`${tag}: ${id} outside the safe area (${[r.x, r.y, r.w, r.h].map(Math.round)})`); }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const p = R[ids[i]], q = R[ids[j]]; if (p.x < q.x + q.w - .6 && q.x < p.x + p.w - .6 && p.y < q.y + q.h - .6 && q.y < p.y + p.h - .6) out.push(`${tag}: ${ids[i]} overlaps ${ids[j]} (${[p.x, p.y, p.w, p.h].map(Math.round)} vs ${[q.x, q.y, q.w, q.h].map(Math.round)})`); }
    // the banner has to stay inside the zone the solver reserved for it
    const z = res.rects.banner, bb = R[ban]; if (bb.x < z.x - 1 || bb.y < z.y - 1 || bb.x + bb.w > z.x + z.w + 1 || bb.y + bb.h > z.y + z.h + 1) out.push(`${tag}: banner grew out of its zone (${[bb.x, bb.y, bb.w, bb.h].map(Math.round)} vs ${[z.x, z.y, z.w, z.h].map(Math.round)})`);
    // the banner clips at its zone (overflow:hidden), so check its content really fits instead of trusting its clipped box
    { const el = $(ban); if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) out.push(`${tag}: banner content is clipped (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`); }
    // cut-off labels
    const boxes = [...document.querySelectorAll('#top .b, #lb button, #shift button, #' + ban + ' .b, #brk small, #clu small, #thr small')].filter(vis);
    for (const b of boxes) if (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1) out.push(`${tag}: label "${b.textContent.trim().slice(0, 20)}" is cut off (${b.id || b.parentElement.id}: ${b.scrollWidth}x${b.scrollHeight} in ${b.clientWidth}x${b.clientHeight})`);
    if (perf) { const p = $('perf'); if (p.scrollHeight > p.clientHeight + 1) out.push(`${tag}: perf readout is cut off (${p.scrollHeight} > ${p.clientHeight})`); }
  }
  LAYOUT.ins = null;
  return out;
};

const one = opt('--size'), shotDir = opt('--shot'), views = [];
if (one) views.push([one, ...one.split('x').map(Number)]); else for (const [n, [w, h]] of Object.entries(PHONES)) { views.push([n + ' P', w, h]); views.push([n + ' L', h, w]); }
let combos = 0; const fails = [];
for (const [name, W, H] of views) {
  await pg.setViewportSize({ width: W, height: H });
  const notchOpts = NO_NOTCH.has(name.slice(0, -2)) ? [false] : [false, true];
  const out = await pg.evaluate(PASS, { notchOpts, only: null });
  combos += notchOpts.length * 3 * 2 * 2 * 3 * 2 * 3; for (const f of out) fails.push(`${name} ${f}`);
}
if (shotDir) { // one picture per banner scenario for a few viewports, to look at
  mkdirSync(shotDir, { recursive: true });
  for (const [W, H] of (one ? [one.split('x').map(Number)] : [[393, 873], [873, 393], [360, 640], [667, 375], [320, 568], [568, 320]])) {
    await pg.setViewportSize({ width: W, height: H });
    for (const [sc, cam3, ban] of [['manual', true, 'race'], ['scooter', false, 'mis'], ['manual', false, 'ride']]) {
      await pg.evaluate(PASS, { notchOpts: [false], only: { sc, cam3, ban } }); await pg.screenshot({ path: `${shotDir}/${W}x${H}-${sc}-${ban}.png` });
    }
  }
}
await br.close(); srv.close();
for (const e of [...new Set(errs)].slice(0, 5)) fails.push('page: ' + e);
for (const f of fails.slice(0, +(process.env.LIM || 30))) console.log('FAIL  ' + f); if (fails.length > +(process.env.LIM || 30)) console.log(`...and ${fails.length - +(process.env.LIM || 30)} more`);
console.log(fails.length ? `layout-dom: ${fails.length} problem(s)` : `layout-dom: ok (${combos} DOM layouts over ${views.length} viewports)`);
process.exit(fails.length ? 1 : 0);
