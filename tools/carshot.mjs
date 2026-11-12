#!/usr/bin/env node
// Cars in a real browser (needs playwright, skips itself otherwise): get off the bike, walk to the car, DRIVE, pictures of it from
// four sides + the driver's seat (hold them against reference photos), then with --drive: gear, gas, steering, brake, GET OUT.
//   PW=/opt/node22/lib/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/carshot.mjs [--shot dir] [--drive] [--car id] [--touch]
import { wxRoute } from './lib/wxroute.mjs';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; }, dir = opt('--shot'), touch = a.includes('--touch');
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('carshot: skipped (playwright-core not found; see tools/smoke.mjs)'); process.exit(0); }
if (dir) mkdirSync(dir, { recursive: true });
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [];
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.log('carshot: skipped (no chromium)'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: touch ? { width: 844, height: 390 } : { width: 900, height: 560 }, deviceScaleFactor: 1, hasTouch: touch });
await wxRoute(pg); pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const wait = ms => new Promise(r => setTimeout(r, ms)), bad = m => errs.push(m);
try {
  await pg.addInitScript(() => { sessionStorage.setItem('cpmGL', '1'); localStorage.setItem('cpmme', JSON.stringify({ tod: 12, wx: 'clear', gfx: 'low' })); });
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok && window.__cpm.CAR && window.__cpm.CAR.list.length, null, { timeout: 180000 });
  const id = opt('--car'), st = () => pg.evaluate(id => { const c = window.__cpm, v = c.CAR.list.find(x => !id || x.def.id === id); return { id: v.def.id, x: v.x, z: v.z, h: v.h, kmh: v.K.v * 3.6, gear: v.X.gear, rpm: v.E.rpm, on: v.E.on, cur: c.CAR.cur === v, foot: c.F.on, car: document.body.classList.contains('car'), fuel: v.fuel }; }, id);
  await pg.evaluate(id => { const c = window.__cpm, v = c.CAR.list.find(x => !id || x.def.id === id); c.getOff(); c.F.x = v.x + 2.2 * Math.cos(v.h); c.F.z = v.z - 2.2 * Math.sin(v.h); c.F.y = c.H(c.F.x, c.F.z); }, id);
  await wait(1500); const lab = await pg.evaluate(() => document.getElementById('bFoot').textContent); if (lab !== 'DRIVE') bad(`next to the car the button says "${lab}", not DRIVE`);
  await pg.keyboard.press('KeyF'); await wait(1500); let s = await st(); if (!s.cur || !s.car || !s.on) bad('DRIVE did not put us in the car with the engine on: ' + JSON.stringify(s));
  if (dir) {
    for (const [n, ang, cp] of [['side', Math.PI / 2, .02], ['left', -Math.PI / 2, .02], ['front34', Math.PI - .65, .1], ['rear34', .7, .1], ['front', Math.PI, .03], ['rear', 0, .03], ['top', .01, 1.05]]) {
      await pg.evaluate(({ ang, cp, id }) => { const c = window.__cpm, v = c.CAR.list.find(x => !id || x.def.id === id); c.F.fp = false; c.F.cy = v.h + Math.PI + ang; c.F.cp = cp; }, { ang, cp, id }); await wait(2600); await pg.screenshot({ path: `${dir}/${s.id}-${n}.png` });
    }
    await pg.evaluate(() => { const c = window.__cpm; c.F.fp = true; c.F.cp = .12; c.F.cy = c.CAR.cur.h + Math.PI; }); await wait(2600); await pg.screenshot({ path: `${dir}/${s.id}-seat.png` });
    await pg.evaluate(() => { const c = window.__cpm; c.F.cy = c.CAR.cur.h + Math.PI + 2.3; c.F.cp = .2; }); await wait(2600); await pg.screenshot({ path: `${dir}/${s.id}-cabin.png` });
    await pg.evaluate(() => { const c = window.__cpm; c.F.fp = false; c.F.cp = .22; c.F.cy = c.CAR.cur.h + Math.PI; });
  }
  if (a.includes('--drive')) {
    const s0 = s; await pg.keyboard.press('ShiftLeft'); await pg.keyboard.down('KeyW'); await wait(9000); s = await st();
    if (!(s.gear === 1 && s.kmh > 8)) bad('1st gear + gas: ' + JSON.stringify(s)); if (!(Math.hypot(s.x - s0.x, s.z - s0.z) > 4)) bad('the car did not move');
    await pg.keyboard.down('KeyA'); await wait(5000); await pg.keyboard.up('KeyA'); const s2 = await st(); if (!(Math.abs(Math.atan2(Math.sin(s2.h - s.h), Math.cos(s2.h - s.h))) > .15)) bad('steering did not turn the car');
    if (dir) await pg.screenshot({ path: `${dir}/${s.id}-driving.png` });
    await pg.keyboard.up('KeyW'); await pg.keyboard.down('KeyS'); await wait(7000); await pg.keyboard.up('KeyS'); s = await st(); if (!(Math.abs(s.kmh) < 3)) bad('the brake did not stop it: ' + s.kmh.toFixed(1) + ' km/h');
    await pg.keyboard.press('KeyF'); await wait(1500); s = await st(); if (s.cur || s.car || s.on || !s.foot) bad('GET OUT: ' + JSON.stringify(s));
    console.log(`carshot: ${s.id} drove ${Math.hypot(s.x - s0.x, s.z - s0.z).toFixed(0)} m, turned ${(Math.abs(Math.atan2(Math.sin(s2.h - s0.h), Math.cos(s2.h - s0.h))) * 57.3).toFixed(0)} deg, stopped, got out`);
  }
} catch (e) { bad('threw: ' + e.message); }
for (const e of errs) console.log('FAIL ' + e); console.log(errs.length ? '' : 'carshot: ok'); await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
