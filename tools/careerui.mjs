#!/usr/bin/env node
// Career mode in a real browser (needs playwright, skips itself otherwise): a clean profile, MENU > CAREER shows the starter bikes,
// picking one loads the game on it with the start money; the garage has DEALER instead of BUILDS, a part you don't own shows a price,
// the first tap only arms it, the second buys and fits it; the dealer refuses a bike you can't afford and sells one you can; a paid
// quest and a fare land in the same wallet the shop uses; the menu's bike list only shows your bikes; FREE RIDE reloads into the
// free-ride bike and settings, untouched by the career. Fails on any console / page error.
//   node tools/careerui.mjs [--shot dir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { wxRoute } from './lib/wxroute.mjs';
import { serve } from './serve.mjs';
const a = process.argv.slice(2), shot = a.includes('--shot') ? a[a.indexOf('--shot') + 1] : '';
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('careerui: skipped (playwright-core not found)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [], P = [], bad = m => P.push(m);
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.log('careerui: skipped (no chromium)'); srv.close(); process.exit(0); }
if (shot) mkdirSync(shot, { recursive: true });
const pg = await br.newPage({ viewport: { width: 1280, height: 720 } });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await wxRoute(pg);
const snap = async n => { if (shot) await pg.screenshot({ path: `${shot}/${n}.png` }); };
// the second tap of a buy goes straight in: on swiftshader (~1 fps) one playwright click takes longer than the 2.5 s the first tap stays armed
const tap2 = async sel => { await pg.click(sel); await pg.evaluate(s => document.querySelector(s).click(), sel); };
try {
  await pg.goto(url); await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('cpmme', JSON.stringify({ bike: 'raider150', bikes: { raider150: { exhaust: 2 } } })); }); await pg.reload();
  await pg.click('#mCar'); await pg.waitForSelector('#mCarS .bc'); await snap('1-starters');
  const starters = await pg.$$eval('#mCarS .bc', e => e.map(x => x.dataset.start)); if (starters.length !== 3) bad('starters shown: ' + starters);
  await pg.click('#mCarS .bc[data-start=beat]');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 180000 });
  let r = await pg.evaluate(async () => { const c = window.__cpm, K = await import('./js/career.js'), Sh = await import('./js/shop.js'); return { bike: c.ctx.bike.id, mode: c.cfg.mode, money: K.money(), shop: Sh.SHOP.money }; });
  if (r.bike !== 'beat' || r.mode !== 'career' || r.money !== 600 || r.shop !== 600) bad('career start: ' + JSON.stringify(r));
  // garage
  await pg.evaluate(() => document.getElementById('bGar').click()); await pg.waitForSelector('#garage:not([hidden])');
  const tabs = await pg.$$eval('#gTabs .gt', e => e.map(x => x.dataset.tab)); if (!tabs.includes('dealer') || tabs.includes('builds')) bad('garage tabs: ' + tabs);
  const sel = await pg.evaluate(() => { const o = document.querySelector('#gBody .opt.lk'); return o && `#gBody .opt[data-k="${o.dataset.k}"][data-i="${o.dataset.i}"]`; });
  if (!sel) bad('no priced (locked) part option on the first tab');
  else {
    const [k, i] = await pg.evaluate(s => { const o = document.querySelector(s); return [o.dataset.k, +o.dataset.i]; }, sel), price = await pg.evaluate(async ([k, i]) => (await import('./js/career.js')).partPrice('beat', k, i), [k, i]);
    r = await pg.evaluate(([s, k]) => { document.querySelector(s).click(); return { fit: window.__cpm.ctx.bcfg[k], arm: document.querySelector(s).classList.contains('arm') }; }, [sel, k]); // (one call: see tap2)
    if (r.fit === i) bad('one tap fitted an unbought part'); if (!r.arm) bad('first tap did not arm the buy');
    await pg.evaluate(s => document.querySelector(s).click(), sel); await snap('2-bought');
    r = await pg.evaluate(async k => ({ fit: window.__cpm.ctx.bcfg[k], money: (await import('./js/career.js')).money() }), k);
    if (r.fit !== i || r.money !== 600 - price) bad(`buying ${k}[${i}] for ${price}: ${JSON.stringify(r)}`);
  }
  await pg.click('#gTabs .gt-dealer'); await snap('3-dealer');
  await tap2('#gBody [data-deal=buy][data-id=ninjah2]');
  if (await pg.evaluate(async () => (await import('./js/career.js')).ownsBike('ninjah2'))) bad('bought a bike without the money');
  await pg.evaluate(async () => { const K = await import('./js/career.js'); K.payJob('parcel', 3, false); K.payFare(5000); }); // a paid quest + a (big) fare
  r = await pg.evaluate(async () => ({ k: (await import('./js/career.js')).money(), s: (await import('./js/shop.js')).SHOP.money })); if (r.k !== r.s) bad('career and shop wallets differ: ' + JSON.stringify(r));
  await pg.click('#gTabs .gt-dealer'); await tap2('#gBody [data-deal=buy][data-id=macho125]');
  r = await pg.evaluate(async () => ({ own: (await import('./js/career.js')).ownsBike('macho125'), bike: window.__cpm.ctx.bike.id }));
  if (!r.own || r.bike !== 'macho125') bad('dealer buy + ride: ' + JSON.stringify(r));
  await tap2('#gBody [data-deal=sell][data-id=beat]');
  if (await pg.evaluate(async () => (await import('./js/career.js')).ownsBike('beat'))) bad('sell did not sell'); await snap('4-sold');
  await pg.click('#gClose');
  // menu: only your bikes; then free ride
  await pg.keyboard.press('Escape'); await pg.waitForSelector('#mMain:not([hidden])'); await pg.click('#mBike');
  const mine = await pg.$$eval('#mCards .bc', e => e.map(x => x.dataset.id)); if (mine.join() !== 'macho125') bad('menu bike list in career: ' + mine);
  await pg.click('#mBikes [data-back]'); await pg.click('#mCar'); await snap('5-career-pane');
  await Promise.all([pg.waitForNavigation(), pg.click('#mCarFree')]);
  r = await pg.evaluate(() => { const c = JSON.parse(localStorage.getItem('cpmme')); return { mode: c.mode, bike: c.bike, ex: c.bikes.raider150 && c.bikes.raider150.exhaust, macho: !!c.bikes.macho125 }; });
  if (r.mode !== 'free' || r.bike !== 'raider150' || r.ex !== 2 || r.macho) bad('free ride save after a career: ' + JSON.stringify(r));
  const t = await pg.textContent('#mPlayT'); if (t !== 'PLAY') bad('PLAY label in free ride: ' + t);
} catch (e) { bad('run: ' + e.message.split('\n')[0]); }
for (const e of errs) bad(e);
await br.close(); srv.close();
for (const p of P) console.log('FAIL ' + p);
console.log(P.length ? `careerui: ${P.length} problem(s)` : 'careerui: ok'); process.exit(P.length ? 1 : 0);
