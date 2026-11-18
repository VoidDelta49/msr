#!/usr/bin/env node
// Accuracy pass for a Model Maker bike (data/models/<id>.json): the model's parts drawn over a real SIDE photo, each part its own
// colour (see-through fill + edges + legend), in an orthographic side view scaled through the two axle centres, plus the frame
// guides in cyan (tyre + rim circles, steering axis, pivot, seat). Move the parts until their edges sit on the photo.
//   node tools/overlay.mjs --id pcx160 --photo side.png --axles rearX,rearY,frontX,frontY [--out dir] [--grid]
// --axles: the wheel centres in photo pixels (measure them: e.g. tyre outer edge and bottom minus the radius in px). Use a true side
// view (a maker's 360 / colour-picker frame is best); front of the bike on the RIGHT (the right-hand side; flip a left-side photo first).
// --grid also writes <id>-grid.png: the photo with a model-coordinate grid (z every 0.1 m labelled, 0.05 m lines, y the same) to
// read part outlines off as [z, y] points. Out: <dir>/<id>-overlay.png (default dir = .). Needs playwright (as tools/smoke.mjs).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), a = process.argv.slice(2), opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const id = opt('--id'), photo = opt('--photo'), ax = (opt('--axles') || '').split(',').map(Number), out = opt('--out') || '.';
if (!id || !photo || ax.length !== 4 || ax.some(isNaN)) { console.log('usage: node tools/overlay.mjs --id <model> --photo <side.png> --axles rearX,rearY,frontX,frontY [--out dir] [--grid]'); process.exit(1); }
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright'); } catch { console.log('overlay: skipped (no playwright, see tools/smoke.mjs)'); process.exit(0); }
const M = JSON.parse(readFileSync(path.join(ROOT, 'data/models', id + '.json'), 'utf8')), f = M.frame;
if (M.kind !== 'bike') { console.log('overlay: bike models only'); process.exit(1); }
const img = 'data:image/' + (photo.toLowerCase().endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + readFileSync(photo).toString('base64');
const { serve } = await import('./serve.mjs'), srv = await serve(0), br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await br.newPage(); pg.on('pageerror', e => console.log('FAIL page: ' + e.message));
await pg.goto(`http://localhost:${srv.address().port}/maker/model.html?m=${id}&shot=side`); await pg.waitForFunction(() => window.READY, null, { timeout: 30000 });
const res = await pg.evaluate(async ({ M, img, ax, grid }) => {
  const THREE = await import('three'), { buildMdl } = await import('/js/mdl.js'), f = M.frame;
  const pic = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = img; });
  const S = Math.hypot(ax[2] - ax[0], ax[3] - ax[1]) / f.wb, k = Math.min(1, 1100 / pic.width), W = Math.round(pic.width * k), H = Math.round(pic.height * k);
  const zF = f.rearZ - f.wb, uF = ax[2], vA = (ax[1] + ax[3]) / 2, X = z => (uF - (z - zF) * S) * k, Y = y => (vA - (y - f.rw) * S) * k;
  document.body.innerHTML = ''; const R = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL: true }); await R.init(); R.setSize(W, H); R.setClearColor(0, 0);
  const sc = new THREE.Scene(), oc = new THREE.OrthographicCamera(-(zF + uF / S), -(zF - (pic.width - uF) / S), f.rw + vA / S, f.rw - (pic.height - vA) / S, -50, 50);
  oc.position.set(5, 0, 0); oc.lookAt(0, 0, 0);                                                                // looking at the right side: screen right = front (-z)
  const { root } = buildMdl(THREE, M, () => new THREE.MeshBasicMaterial()); sc.add(root); const leg = [], col = {};
  let n = 0; root.traverse(o => { if (!o.isMesh) return; const q = o.userData.part.n || o.userData.part.t;
    if (!(q in col)) { col[q] = new THREE.Color().setHSL((n++ * .618) % 1, .95, .5); leg.push([q, '#' + col[q].getHexString()]); }
    o.material = new THREE.MeshBasicMaterial({ color: col[q], transparent: true, opacity: .18, depthWrite: false });
    o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), new THREE.LineBasicMaterial({ color: col[q] }))); });
  const G = new THREE.LineBasicMaterial({ color: 0x00c8ff }), line = p => sc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.map(v => new THREE.Vector3(.3, v[1], v[0]))), G));
  const ring = (z, y, r) => line(Array.from({ length: 65 }, (_, i) => [z + r * Math.cos(i / 10.186), y + r * Math.sin(i / 10.186)]));
  for (const z of [f.rearZ, zF]) { ring(z, f.rw, f.rw); ring(z, f.rw, f.rw * .7); }                             // tyre outside + about where the rim is
  const [hz, hy] = f.head; line([[hz, hy], [hz - hy * Math.tan(f.rake * Math.PI / 180), 0]]); for (const p of [f.pivot, f.seat]) ring(p[0], p[1], .02);
  R.render(sc, oc); await new Promise(r => requestAnimationFrame(r)); R.render(sc, oc);
  const cv = document.createElement('canvas'), c = cv.getContext('2d'), png = []; cv.width = W; cv.height = H;
  const bg = (dim) => { c.globalAlpha = 1; c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.filter = dim ? 'contrast(.6) brightness(1.25)' : 'none'; c.drawImage(pic, 0, 0, W, H); c.filter = 'none'; };
  bg(true); c.drawImage(R.domElement, 0, 0); c.font = '11px sans-serif';
  leg.forEach(([q, h], i) => { c.fillStyle = h; c.fillRect(6, 6 + i * 13, 9, 9); c.fillStyle = '#000'; c.fillText(q, 19, 14 + i * 13); });
  png.push(cv.toDataURL());
  if (grid) { bg(false); for (let i = -30; i <= 30; i++) for (const [v, ver] of [[i / 20, 1], [i / 20 + 1.5, 0]]) {               // z -1.5..1.5, y 0..3 (clipped)
      const t = Math.round(v * 20) % 2 === 0; c.strokeStyle = t ? (Math.round(v * 10) % 5 ? '#2a8cff' : '#ff3030') : '#b4d4ff'; c.lineWidth = t ? 1 : .5; c.beginPath();
      if (ver) { c.moveTo(X(v), 0); c.lineTo(X(v), H); } else { c.moveTo(0, Y(v)); c.lineTo(W, Y(v)); } c.stroke();
      if (t) { c.fillStyle = '#0050c8'; if (ver) for (let y = 0; y < 1.4; y += .2) c.fillText(v.toFixed(1), X(v) + 2, Y(y) - 2); else c.fillText('y' + v.toFixed(1), 4, Y(v) - 2); } }
    png.push(cv.toDataURL()); }
  return { png, S };
}, { M, img, ax, grid: a.includes('--grid') });
await br.close(); srv.close(); mkdirSync(out, { recursive: true });
res.png.forEach((d, i) => { const p = path.join(out, `${id}-${i ? 'grid' : 'overlay'}.png`); writeFileSync(p, Buffer.from(d.split(',')[1], 'base64')); console.log(p); });
console.log(`overlay: ${id}, ${res.S.toFixed(1)} photo px per m (check: the tyres should sit on the cyan circles)`);
