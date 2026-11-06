// Drawing an interior (logic: interior.js, data: data/interiors.json). Built the first time you go in, then kept and moved to whichever
// building's pocket you enter. Draw calls for a whole room: the shell and every prop are ONE vertex-coloured mesh, the lamps / neon / EXIT
// glow ONE more, the floor, signs, menu board, tv and jukebox face a few textured quads, the billiard balls ONE instanced mesh, the people
// ONE crowd (figure.js). Nothing casts into the sun's shadow map; daynight.js gives the room its own warm light while you're in it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './renderer.js';
import { Q } from './config.js';
import { Crowd, humanGeo, POSES, DIMS, packPal } from './figure.js';
import { resolveLook } from './figlook.js';
import { NPCD } from './npcfig.js';
import { item, shopOf, peso } from './shop.js';
import { PC, newTable } from './pool.js';
const ORDER = newTable().balls.map(b => b.n); // ball numbers in rack order (instance i draws ball ORDER[i % 10])

const G = new THREE.Group(); G.name = 'interior'; G.visible = false; scene.add(G);
const built = new Map(); // interior id -> { root, crowd, people, balls, fans }
let cur = null, curP = null;
const C = new THREE.Color();
// a piece of geometry, coloured, moved by matrix m, into list L
function put(L, g, col, m) {
  g = g.index ? g.toNonIndexed() : g; for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
  if (m) g.applyMatrix4(m); const n = g.attributes.position.count, a = new Float32Array(n * 3); C.set(col);
  for (let i = 0; i < n; i++) { a[i * 3] = C.r; a[i * 3 + 1] = C.g; a[i * 3 + 2] = C.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); L.push(g);
}
const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), YA = new THREE.Vector3(0, 1, 0);
// a box standing on y (bottom at y) in the frame `f` (prop transform)
const at = (f, x, y, z, ry = 0) => M2.multiplyMatrices(f, M.compose(V.set(x, y, z), Q4.setFromAxisAngle(YA, ry), S1));
const box = (L, f, x, y, z, w, h, d, col, ry = 0) => put(L, new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), col, at(f, x, y, z, ry));
const cyl = (L, f, x, y, z, r0, r1, h, col, seg = 10) => put(L, new THREE.CylinderGeometry(r0, r1, h, seg).translate(0, h / 2, 0), col, at(f, x, y, z));
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const quad = (root, tex, w, h, f, x, y, z, ry, glow) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: !!glow, toneMapped: !glow, fog: false, depthWrite: !glow })); m.applyMatrix4(at(f, x, y, z, ry)); m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m); return m; };

function neon(text, col) {
  return canvasTex(512, 128, (g, w, h) => {
    g.font = '900 78px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; for (const b of [28, 14, 6]) { g.shadowBlur = b; g.fillStyle = col; g.fillText(text, w / 2, h / 2); }
    g.shadowBlur = 0; g.fillStyle = '#fff'; g.globalAlpha = .75; g.fillText(text, w / 2, h / 2);
  });
}
function menuTex(shop) {
  const S = shopOf(shop), its = (S ? S.items : []).map(item).filter(Boolean);
  return canvasTex(512, 640, (g, w, h) => {
    g.fillStyle = '#1b2a1f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c79a4a'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = '#f4ead2'; g.font = '800 54px system-ui'; g.textAlign = 'center'; g.fillText('MENU', w / 2, 76);
    g.font = '600 36px system-ui'; its.slice(0, 9).forEach((I, i) => { const y = 150 + i * 54; g.textAlign = 'left'; g.fillText(I.icon + ' ' + I.name.replace(/ \(.*\)/, ''), 34, y); g.textAlign = 'right'; g.fillStyle = '#ffd166'; g.fillText(peso(I.price), w - 34, y); g.fillStyle = '#f4ead2'; });
  });
}
const planks = (a, b) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 8; y++) { const o = (y * 97) % 256; g.fillStyle = y % 2 ? b : a; g.fillRect(0, y * 32, w, 31); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y * 32 + 31, w, 1); g.fillRect(o, y * 32, 1, 32); g.fillRect((o + 128) % 256, y * 32, 1, 32);
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},.05)`; g.fillRect(Math.random() * w, y * 32 + Math.random() * 30, 12 + Math.random() * 30, 1); } }
});
const tvTex = () => canvasTex(256, 144, (g, w, h) => { g.fillStyle = '#c98a4a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(10, 10, w - 20, h - 20); g.beginPath(); g.moveTo(w / 2, 10); g.lineTo(w / 2, h - 10); g.stroke(); g.beginPath(); g.arc(w / 2, h / 2, 22, 0, 7); g.stroke(); g.fillStyle = '#d11'; g.fillRect(0, 0, 90, 22); g.fillStyle = '#fff'; g.font = '700 15px system-ui'; g.fillText('PBA  88 - 84', 6, 16); for (let i = 0; i < 8; i++) { g.fillStyle = i < 4 ? '#e33' : '#33e'; g.beginPath(); g.arc(40 + Math.random() * (w - 80), 30 + Math.random() * (h - 60), 5, 0, 7); g.fill(); } });
const jukeTex = () => canvasTex(128, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ff3fa4'); gr.addColorStop(.5, '#ffd166'); gr.addColorStop(1, '#38e0ff'); g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, 70, 58, 66, 0, Math.PI, 0); g.lineTo(w - 6, h - 6); g.lineTo(6, h - 6); g.fill(); g.fillStyle = 'rgba(20,10,30,.7)'; g.fillRect(22, 90, w - 44, 90); g.fillStyle = '#fff'; for (let i = 0; i < 5; i++) g.fillRect(30, 100 + i * 16, w - 60, 4); });
const BALL = [0xf4f1e6, 0xf2c200, 0x1f4fc2, 0xd02424, 0x5b2a86, 0xf07a10, 0x157a3a, 0x7a1414, 0x111111, 0xf2c200];

function build(id, def) {
  const root = new THREE.Group(), L = [], E = [], I0 = new THREE.Matrix4(), W2 = def.w / 2, D2 = def.d / 2, H = def.h, T = .2;
  // shell: walls (lower wainscot + trim + upper), ceiling, skirting; the floor is a textured quad
  const wall = (x, z, len, ry) => { const f = at(I0, x, 0, z, ry).clone(); box(L, f, 0, 0, 0, len, 1.1, T, def.wall2 || def.wall); box(L, f, 0, 1.1, 0, len, .08, T + .04, def.trim || '#c79a4a'); box(L, f, 0, 1.18, 0, len, H - 1.18, T, def.wall); };
  wall(-W2 - T / 2, 0, def.d + 2 * T, Math.PI / 2); wall(W2 + T / 2, 0, def.d + 2 * T, Math.PI / 2); wall(0, -D2 - T / 2, def.w, 0); wall(0, D2 + T / 2, def.w, 0);
  box(L, I0, 0, H, 0, def.w + 2 * T, .15, def.d + 2 * T, def.ceil || '#202024');
  const fl = quad(root, planks(def.floor || '#6e4a32', def.floor2 || '#5a3a26'), def.w, def.d, I0, 0, .005, 0, 0); fl.material.toneMapped = true; fl.material.map.wrapS = fl.material.map.wrapT = THREE.RepeatWrapping; fl.material.map.repeat.set(def.w / 3, def.d / 3);
  fl.geometry.rotateX(-Math.PI / 2); fl.material.dispose(); fl.material = new THREE.MeshStandardMaterial({ map: fl.material.map, roughness: .7 });
  // the front door (closed: EXIT walks you out) and its green EXIT light
  const dx = (def.door && def.door.x) || 0, dw = (def.door && def.door.w) || 1.6;
  box(L, I0, dx, 0, D2 - .06, dw + .2, 2.35, .1, '#3a2616'); box(L, I0, dx, 0, D2 - .1, dw, 2.2, .06, '#6b4426'); box(L, I0, dx - dw * .35, 1.05, D2 - .16, .06, .06, .08, '#d9c27a');
  box(E, I0, dx, 2.5, D2 - .14, .5, .18, .05, '#2bff6a');
  const balls = [], fans = [];
  for (const p of def.props || []) {
    const f = at(I0, p.x, 0, p.z, p.ry || 0).clone();
    switch (p.k) {
      case 'pool': {
        for (const [a, b] of [[-.6, -1.15], [.6, -1.15], [-.6, 1.15], [.6, 1.15]]) box(L, f, a, 0, b, .14, .62, .14, '#3a2414');
        box(L, f, 0, .62, 0, 1.46, .14, 2.58, '#4a2c18'); box(L, f, 0, .76, 0, PC.W, .01, PC.L, '#1d7a4a');
        for (const s of [-1, 1]) { box(L, f, s * (PC.W / 2 + .07), .76, 0, .14, .07, PC.L + .28, '#5a3420'); box(L, f, 0, .76, s * (PC.L / 2 + .07), PC.W, .07, .14, '#5a3420'); }
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]) cyl(L, f, a * PC.W / 2, .765, b * PC.L / 2, .055, .055, .012, '#0a0a0a', 8);
        box(L, f, 0, 2.6, 0, .34, .16, 1.7, '#14301e'); box(E, f, 0, 2.58, 0, .26, .02, 1.6, '#fff1c8'); box(L, f, 0, 2.76, 0, .02, H - 2.76, .02, '#111');
        balls.push(p); break;
      }
      case 'counter': box(L, f, 0, 0, 0, p.w, 1.02, p.d, '#5c3a22'); box(L, f, 0, 1.02, 0, p.w + .12, .06, p.d + .14, '#8a5a32'); box(L, f, 0, .1, p.d / 2 + .02, p.w, .06, .05, '#c79a4a');
        for (let i = 0; i < 6; i++) { const x = -p.w / 2 + .6 + i * (p.w - 1.2) / 5; cyl(L, f, x, 1.08, -.1, .035, .035, .14, i % 2 ? '#f2f0e8' : '#c9e8ff', 6); } break;
      case 'shelf': {
        box(L, f, 0, 0, 0, p.w, .95, .4, '#4a2c18'); for (const y of [1.45, 1.95, 2.45]) box(L, f, 0, y, -.05, p.w, .05, .3, '#6b4426');
        const bc = ['#2e7d32', '#b71c1c', '#f9f3e3', '#6d4c41', '#1565c0', '#c9a227', '#9be7ff'];
        for (const y of [1.5, 2, 2.5]) for (let x = -p.w / 2 + .2; x < p.w / 2 - .1; x += .19) { const c = bc[(Math.abs(Math.round(x * 13 + y * 7))) % bc.length], hh = .2 + ((x * 31 + y) % .1 + .1) * .6; cyl(L, f, x, y + .025, -.05, .035, .04, hh, c, 6); }
        box(E, f, 0, 2.95, .05, p.w, .03, .05, '#ffcf8a'); break;
      }
      case 'stool': cyl(L, f, 0, 0, 0, .18, .2, .03, '#333'); cyl(L, f, 0, .03, 0, .03, .03, .62, '#9aa0a6', 6); cyl(L, f, 0, .65, 0, .2, .18, .08, '#b3261e'); break;
      case 'table': cyl(L, f, 0, 0, 0, .25, .3, .04, '#333'); cyl(L, f, 0, .04, 0, .04, .04, .7, '#777', 6); cyl(L, f, 0, .74, 0, .5, .5, .04, '#7a4b2a', 14);
        cyl(L, f, .12, .78, -.05, .07, .07, .2, '#e8e4d8', 10); cyl(L, f, .12, .98, -.05, .02, .03, .07, '#e8e4d8', 6); cyl(L, f, -.15, .78, .12, .035, .03, .07, '#d9f0ff', 6); break; // a ginbilog and a shot glass
      case 'chair': box(L, f, 0, 0, 0, .44, .44, .44, '#3b5d8a'); box(L, f, 0, .44, .2, .44, .45, .06, '#3b5d8a'); break;
      case 'jukebox': box(L, f, 0, 0, 0, .8, 1.5, .55, '#5a2c3a'); quad(root, jukeTex(), .62, 1.25, f, 0, .8, .281, 0, true); break;
      case 'rack': box(L, f, 0, 1, 0, 1.1, .08, .1, '#4a2c18'); box(L, f, 0, 1.8, 0, 1.1, .08, .1, '#4a2c18'); for (let i = 0; i < 6; i++) box(L, f, -.45 + i * .18, .5, .06, .025, 1.45, .025, '#d8b47a'); break;
      case 'sign': quad(root, neon(p.text || 'BAR', p.color || '#ff3fa4'), 3.2, .8, f, 0, p.y || 2.8, .05, 0, true); break;
      case 'board': box(L, f, 0, (p.y || 1.9) - .78, 0, 1.3, 1.56, .05, '#2a1a10'); quad(root, menuTex(p.shop), 1.2, 1.5, f, 0, p.y || 1.9, .03, 0, false); break;
      case 'tv': box(L, f, 0, (p.y || 2.3) - .45, 0, 1.6, .92, .08, '#111'); quad(root, tvTex(), 1.5, .84, f, 0, p.y || 2.3, .045, 0, true); break;
      case 'plant': cyl(L, f, 0, 0, 0, .2, .16, .4, '#a0522d', 8); for (let i = 0; i < 7; i++) { const a = i * .9; put(L, new THREE.ConeGeometry(.09, .9, 4).translate(0, .45, 0).rotateZ(.35 + (i % 3) * .1).rotateY(a), '#2e7d32', at(f, 0, .38, 0)); } break;
      case 'fan': { const g = new THREE.Group(), FL = []; box(FL, I0, 0, -.25, 0, .04, .25, .04, '#222'); cyl(FL, I0, 0, -.32, 0, .1, .1, .08, '#ddd'); for (let i = 0; i < 4; i++) box(FL, I0, 0, -.3, 0, .12, .015, 1.1, '#8a6a4a', i * Math.PI / 2 + .3);
        const m = new THREE.Mesh(mergeGeometries(FL.map(g => g.translate(0, 0, 0))), VMAT); m.position.set(p.x, H, p.z); g.add(m); root.add(g); fans.push(m); break; }
    }
  }
  const room = new THREE.Mesh(mergeGeometries(L), VMAT); room.name = 'interiorRoom'; root.add(room);
  const glow = new THREE.Mesh(mergeGeometries(E), EMAT); glow.name = 'interiorGlow'; root.add(glow);
  // billiard balls: one instanced mesh for every table
  const bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(PC.R, 1), new THREE.MeshStandardMaterial({ roughness: .25, metalness: 0 }), Math.max(1, balls.length * 10));
  bm.name = 'poolBalls'; bm.frustumCulled = false; for (let i = 0; i < bm.count; i++) bm.setColorAt(i, C.setHex(BALL[ORDER[i % ORDER.length]])); bm.instanceColor.needsUpdate = true; root.add(bm);
  // the people: one crowd, outfits from the pedestrians' archetypes (seeded, so the same faces every visit)
  const people = (def.people || []).filter(q => NPCD.archetypes[q.arch]), crowd = new Crowd(humanGeo(DIMS), Math.max(1, people.length), { name: 'interiorPeople', lite: !!Q.lite });
  let seed = 7; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const looks = people.map(q => { const A = NPCD.archetypes[q.arch], lk = resolveLook(A, NPCD.palettes, rnd); return { q, pal: packPal(lk.pal), mask: lk.mask, h: A.h ? A.h[0] + (A.h[1] - A.h[0]) * rnd() : 1, ph: rnd() * 9 }; });
  root.add(crowd.mesh);
  for (const o of [room, glow, bm, crowd.mesh, ...root.children]) { o.castShadow = false; o.receiveShadow = false; }
  return { root, crowd, looks, bm, fans };
}
const VMAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .02 });
const EMAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

// show the room for pocket P (interior.js) / hide it
export function showRoom(P) {
  let R = built.get(P.id); if (!R) { R = build(P.id, P.def); built.set(P.id, R); G.add(R.root); }
  for (const r of built.values()) r.root.visible = r === R;
  G.position.set(P.ox, P.oy, P.oz); G.rotation.set(0, P.ry, 0); G.visible = true; cur = R; curP = P; roomFrame(0, 0);
}
export function hideRoom() { G.visible = false; cur = null; curP = null; }
const pose = new Float32Array(8), m4 = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export function roomFrame(dt, t) {
  if (!cur) return; const R = cur, P = curP;
  for (const f of R.fans) f.rotation.y += dt * 5;
  R.crowd.clear();
  for (const L of R.looks) { const q = L.q, fn = POSES[q.pose] || POSES.stand; fn(pose, t + L.ph, 1, t * 3); R.crowd.push(q.x, q.y || 0, q.z, q.ry || 0, 1, L.h, L.mask, pose, L.pal); }
  R.crowd.commit();
  let i = 0;
  P.tables.forEach(tb => {
    const p = tb.p, c = Math.cos(p.ry || 0), s = Math.sin(p.ry || 0);
    for (const b of tb.T.balls) { if (i >= R.bm.count) break; // instance i keeps its colour (ORDER), the balls never change order
      R.bm.setMatrixAt(i, b.on ? m4.makeTranslation(p.x + b.x * c + b.z * s, .766 + PC.R, p.z - b.x * s + b.z * c) : ZERO); i++; }
  });
  R.bm.instanceMatrix.needsUpdate = true;
}
