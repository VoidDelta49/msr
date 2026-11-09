#!/usr/bin/env node
// Blueprint shots of the bike models for comparing against real photos (accuracy rounds): the bike alone (no rider unless
// --rider), flat grey backdrop, even light, ORTHOGRAPHIC camera, so proportions can be measured straight off the picture.
//   PW=/opt/node22/lib/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/bikeref.mjs --shot dir [--bike id[,id]] [--views right,left,front,rear,top,q] [--var n] [--paint n] [--rider] [--grid]
// Writes dir/<bike>-<view>.png (default views: right,left,q). --grid: 10 cm grid lines (thicker every 50 cm) through the ground / rear axle.
// The scale is the same for every bike (2.6 m across the picture), so two bikes can be compared too.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('bikeref: skipped (playwright-core not found; see tools/smoke.mjs)'); process.exit(0); }
const dir = opt('--shot'); if (!dir) { console.log('usage: bikeref.mjs --shot dir [--bike id] [--views right,left,front,rear,top,q]'); process.exit(1); }
mkdirSync(dir, { recursive: true });
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [];
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.log('bikeref: skipped (no chromium)'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 1300, height: 800 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
try {
  await pg.addInitScript(() => { sessionStorage.setItem('cpmGL', '1'); localStorage.setItem('cpmme', JSON.stringify({ tod: 12 })); });
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
  const ids = opt('--bike') ? opt('--bike').split(',') : await pg.evaluate(() => Object.keys(window.__cpm.ctx.bikes));
  const views = opt('--views', 'right,left,q').split(',');
  for (const id of ids) {
    await pg.evaluate(async id => { window.__cpm.setBike(id); await new Promise(r => setTimeout(r, 300)); }, id);
    if (opt('--var')) await pg.evaluate(async v => { const M = await import('./js/model.js'), c = window.__cpm; M.buildModel(c.ctx.bike, { var: +v }); M.applyLook(c.spec()); }, opt('--var'));
    if (opt('--paint')) await pg.evaluate(async n => { const M = await import('./js/model.js'), c = window.__cpm, o = c.ctx.bike.parts.paint?.o; if (o) M.applyLook({ ...c.spec(), ...o[Math.min(+n, o.length - 1)] }); }, opt('--paint'));
    // size of the model as drawn (m), to hold against the real L x W x H (H and W include the mirrors); the skin is built in ct space, bind pose = as drawn at rest
    const bb = await pg.evaluate(async () => { const THREE = await import('three'), B = window.__cpm.B, b = new THREE.Box3(), inv = new THREE.Matrix4(); B.root.updateMatrixWorld(true); inv.copy(B.ct.matrixWorld).invert();
      const v = new THREE.Vector3(), rd = new Set(B.rider); B.ct.traverse(o => { if (!o.isMesh || rd.has(o) || !o.geometry.attributes.position) return; const p = o.geometry.attributes.position;
        if (o.isSkinnedMesh) { o.geometry.computeBoundingBox(); b.union(o.geometry.boundingBox); } else { const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); for (let i = 0; i < p.count; i += 3) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m)); } });
      return { L: b.max.z - b.min.z, W: b.max.x - b.min.x, H: b.max.y }; });
    console.log(`bikeref: ${id} L ${bb.L.toFixed(3)} W ${bb.W.toFixed(3)} H ${bb.H.toFixed(3)} (model, mirrors included)`);
    const out = await pg.evaluate(async ({ views, rider, grid }) => {
      // drawn in the game's own scene (the skinned bike only draws where it was bound): everything else hidden, fog and sky off
      const THREE = await import('three'), c = window.__cpm, B = c.B, R = c.renderer, sc = c.scene, W = 1300, Hh = 800, ct = B.ct;
      const keep = { bg: sc.background, bgn: sc.backgroundNode, fog: sc.fog, fogn: sc.fogNode, env: sc.environment, vis: sc.children.map(o => o.visible), rv: B.rider.map(o => o.visible) };
      for (const o of sc.children) o.visible = o === B.root; sc.background = new THREE.Color(0xb9c2cc); sc.backgroundNode = null; sc.fog = null; sc.fogNode = null;
      const rig = new THREE.Group(); sc.add(rig); B.root.updateMatrixWorld(true); ct.matrixWorld.decompose(rig.position, rig.quaternion, rig.scale);
      rig.add(new THREE.HemisphereLight(0xffffff, 0x8c8f96, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 2.2); rig.add(d, d.target);
      if (!rider) for (const o of B.rider) o.visible = false;
      const gr = new THREE.Group(); rig.add(gr); // grid: one wall beside the bike (moved to the far side of each view) + none for the other views
      if (grid) for (const big of [0, 1]) {
        const p = []; for (let i = -15; i <= 16; i++) { if ((i % 5 === 0) !== !!big) continue; const v = i * .1; p.push(0, 0, v, 0, 1.6, v); if (v >= 0) p.push(0, v, -1.5, 0, v, 1.6); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); gr.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: big ? 0x55606c : 0x8d98a4 })));
      }
      const cam = new THREE.OrthographicCamera(-1.3, 1.3, .8, -.8, .1, 20), G = B.G, zc = (G.rearZ + (B.skin.geometry.boundingBox?.min.z ?? -G.rearZ) + G.rw) / 2; rig.add(cam);
      const P = { right: [6, .7, zc], left: [-6, .7, zc], front: [0, .7, -6 + zc], rear: [0, .7, 6 + zc], top: [0, 6, zc], q: [4, 2.2, -4.2 + zc] }, res = {};
      const cv = R.domElement, tmp = document.createElement('canvas'); tmp.width = W; tmp.height = Hh; rig.updateMatrixWorld(true);
      const wp = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(rig.matrixWorld), up = new THREE.Vector3();
      for (const v of views) {
        const p = P[v]; cam.position.set(...p); gr.position.x = v === 'left' ? .6 : -.6; gr.visible = v === 'right' || v === 'left'; cam.up.copy(up.set(v === 'top' ? 1 : 0, v === 'top' ? 0 : 1, 0).transformDirection(rig.matrixWorld));
        cam.lookAt(wp(0, v === 'top' ? 0 : v === 'q' ? .55 : .7, zc)); d.position.set(p[0], p[1] + 6, p[2]); d.target.position.set(0, .5, zc); rig.updateMatrixWorld(true);
        await R.renderAsync(sc, cam); tmp.getContext('2d').drawImage(cv, 0, 0, W, Hh); res[v] = tmp.toDataURL('image/png');
      }
      sc.remove(rig); sc.children.forEach((o, i) => o.visible = keep.vis[i]); B.rider.forEach((o, i) => o.visible = keep.rv[i]);
      sc.background = keep.bg; sc.backgroundNode = keep.bgn; sc.fog = keep.fog; sc.fogNode = keep.fogn;
      return res;
    }, { views, rider: a.includes('--rider'), grid: a.includes('--grid') });
    for (const v of views) writeFileSync(join(dir, `${id}-${v}.png`), Buffer.from(out[v].split(',')[1], 'base64'));
    console.log('bikeref: ' + id + ' ' + views.join(','));
  }
} catch (e) { errs.push('harness: ' + e.message.split('\n')[0]); }
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
