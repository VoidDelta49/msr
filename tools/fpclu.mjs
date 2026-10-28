#!/usr/bin/env node
// First-person dash check (real browser, WebGL 2): for every bike (or --bike id), sits in first person with the key on and casts rays
// from the camera to a 7x5 grid over the in-world cluster plane. A point counts as seen when nothing is hit before the plane. Fails
// when a bike sees less than --min of its grid (default 0.9), or the plane faces away / is off screen. Catches meters buried inside
// bodywork or hidden behind a hood / bar riser (11.53: the H2 meter sat inside its solid screen wedge, the NMAX hood + riser hid its own).
// Rays only test the parked, straight-ahead pose; steering lock and lean are not covered.
//   PW=/opt/npm-tools/node_modules/playwright-core PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/fpclu.mjs [--bike id] [--min 0.9] [--shot dir] [--json]
// --shot dir: one first-person screenshot per bike (dir/<bike>.png). ~25 s per bike on swiftshader. Skips (exit 0) without a browser.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const shot = opt('--shot'), only = opt('--bike'), min = +opt('--min', .9), json = a.includes('--json');
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('fpclu: skipped (playwright-core not found)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [];
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.log('fpclu: skipped (no chromium)'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 900, height: 420 } });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
await pg.addInitScript(() => { sessionStorage.setItem('cpmGL', '1'); localStorage.setItem('cpmme', JSON.stringify({ tod: 12 })); });
await pg.goto(url); await pg.click('#mPlay');
await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
const ids = (await pg.evaluate(() => Object.keys(window.__cpm.ctx.bikes))).filter(id => !only || id === only);
if (only && !ids.length) errs.push('unknown bike ' + only);
for (const id of ids) {
  const r = await pg.evaluate(async id => {
    const c = window.__cpm, THREE = await import('three'), H = await import('./js/hud.js');
    const fr = n => new Promise(res => { const f = () => --n ? requestAnimationFrame(f) : res(); requestAnimationFrame(f); });
    c.setBike(id); await fr(5); c.reset(); if (c.ctx.camMode !== 0) c.toggleCam(); c.S.key = 1; await fr(40);
    const cam = c.camera; c.scene.updateMatrixWorld(true);
    let P = null; c.scene.traverse(o => { if (!P && o.isMesh && o.material && o.material.map === H.cluTex) P = o; });
    if (!P) return { id, err: 'no cluster mesh' };
    const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), pc = new THREE.Vector3().setFromMatrixPosition(P.matrixWorld);
    const facing = new THREE.Vector3(0, 0, 1).transformDirection(P.matrixWorld).dot(cp.clone().sub(pc).normalize());
    const inv = new THREE.Matrix4().copy(c.B.ct.matrixWorld).invert(), { width: w, height: h } = P.geometry.parameters, p = new THREE.Vector3(), q = new THREE.Vector3();
    let seen = 0, n = 0, onScr = 0; const occ = [];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) {
      n++; p.set((i / 6 - .5) * w * .9, (j / 4 - .5) * h * .9, 0).applyMatrix4(P.matrixWorld); q.copy(p).project(cam);
      if (Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z < 1) onScr++;
      const d = cp.distanceTo(p), hit = new THREE.Raycaster(cp, p.clone().sub(cp).normalize(), 0, d - .002).intersectObjects(c.scene.children, true).find(x => x.object.visible && x.object !== P);
      if (!hit) seen++; else occ.push(hit.point.clone().applyMatrix4(inv).toArray().map(x => +x.toFixed(3)));
    }
    return { id, seen: seen / n, onScreen: onScr / n, facing: +facing.toFixed(2), dist: +cp.distanceTo(pc).toFixed(3), occluders: occ.slice(0, 3) };
  }, id);
  if (shot) await pg.screenshot({ path: `${shot}/${id}.png` });
  const bad = r.err || (r.seen < min ? `only ${Math.round(r.seen * 100)}% of the meter visible (blocked at ct-local ${JSON.stringify(r.occluders)})` : r.onScreen < min ? `meter ${Math.round(r.onScreen * 100)}% on screen` : r.facing < .3 ? `meter faces away (${r.facing})` : '');
  if (bad) errs.push(id + ': ' + bad);
  console.log(json ? JSON.stringify(r) : `${(bad ? 'FAIL ' : 'ok   ') + id.padEnd(12)} seen ${Math.round((r.seen || 0) * 100)}%  on screen ${Math.round((r.onScreen || 0) * 100)}%  facing ${r.facing}  dist ${r.dist} m`);
}
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
