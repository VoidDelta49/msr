// Rendering performance: distance culling, terrain LOD, static-object freezing, Lambert "lite" materials for the Low
// preset, and adaptive resolution. Frustum culling itself is three's (objects just need tight bounds, see world.js inst()).
import * as THREE from 'three';
import { renderer, baseDPR } from './renderer.js';
import { cfg, Q } from './config.js';

export const DRAW = Q.fog; // draw distance: past the fog end everything is sky-coloured, so hiding it is invisible
// distance classes for props (metres, capped by DRAW). Small props pop out where they are a few pixels tall.
export const FAR = { small: 220, mid: 550, tree: DRAW * .9, big: DRAW };

// Static objects: compute their matrix once instead of every frame.
export function freeze(o) { o.traverse(c => { c.updateMatrix(); c.matrixAutoUpdate = false; }); o.updateMatrixWorld(true); return o; }

// Bake a static group's meshes into one mesh per material (fewer draw calls). Keeps shadow flags.
export function mergeByMaterial(grp, merge) {
  grp.updateMatrixWorld(true); const by = new Map();
  for (const o of [...grp.children]) if (o.isMesh) { if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(o); }
  for (const [mat, L] of by) {
    if (L.length < 2) continue;
    const m = new THREE.Mesh(merge(L.map(o => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.deleteAttribute('uv'); return g.applyMatrix4(o.matrix); })), mat);
    m.castShadow = L.some(o => o.castShadow); m.receiveShadow = L.some(o => o.receiveShadow); grp.add(m); for (const o of L) grp.remove(o);
  }
  return grp;
}

/* ---------- distance culling ---------- */
const ITEMS = [], LODS = [], box = new THREE.Box3(), sph = new THREE.Sphere();
// hide `o` once the camera is further than `far` from its bounding sphere
export function cullFar(o, far) {
  if (o.isInstancedMesh) { o.computeBoundingSphere(); sph.copy(o.boundingSphere); }
  else { o.updateMatrixWorld(true); box.setFromObject(o).getBoundingSphere(sph); }
  ITEMS.push({ o, x: sph.center.x, z: sph.center.z, r: sph.radius, far: Math.min(far, DRAW) });
}
// same for a piece that is not an object (a BatchedMesh instance): o = anything with a visible setter, s = its world sphere
export function cullFarSphere(o, s, far) { ITEMS.push({ o, x: s.center.x, z: s.center.z, r: s.radius, far: Math.min(far, DRAW) }); }
// terrain tile: levels[0] full detail ... levels[n] coarsest, picked by distance to the tile's rectangle
export const LOD_D = [200, 480];
export function addLOD(levels, x0, z0, x1, z1) { LODS.push({ levels, x0, z0, x1, z1, cur: -2 }); }

let frame = 0;
export function cullUpdate(camera) {
  const e = camera.matrixWorld.elements, cx = e[12], cz = e[14];
  if (frame++ & 3) return; // whole-object distance checks: every 4th frame is plenty at bike speeds
  for (const it of ITEMS) { const dx = it.x - cx, dz = it.z - cz, f = it.far + it.r; it.o.visible = dx * dx + dz * dz < f * f; }
  for (const t of LODS) {
    const ex = Math.max(t.x0 - cx, 0, cx - t.x1), ez = Math.max(t.z0 - cz, 0, cz - t.z1), d = Math.sqrt(ex * ex + ez * ez);
    const k = d > DRAW ? -1 : d < LOD_D[0] ? 0 : d < LOD_D[1] ? 1 : 2;
    if (k !== t.cur) { t.cur = k; t.levels.forEach((m, i) => m.visible = i === k); }
  }
}

/* ---------- Low preset: Lambert instead of PBR on the island ---------- */
const LITE = new Map(); export const liteOf = m => LITE.get(m) || m;
export function liteMaterials(root) {
  if (!Q.lite) return;
  root.traverse(o => {
    const m = o.material; if (!o.isMesh || !m || !m.isMeshStandardMaterial) return;
    let l = LITE.get(m);
    if (!l) {
      l = new THREE.MeshLambertMaterial({ color: m.color, map: m.map, vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity });
      LITE.set(m, l);
    }
    o.material = l;
  });
}

/* ---------- adaptive resolution ---------- */
// Called once a second with the measured fps while riding. Drops the pixel ratio in 10% steps when the game can't
// hold the screen's refresh rate, creeps back up after a stable stretch, and stops trying to go up for a while if
// going up immediately made it slow again (avoids see-sawing).
let scale = 1, ref = 0, good = 0, bad = 0, warm = 0, upT = -1e9, blockT = -1e9;
export const resScale = () => scale;
function apply() { renderer._rs = scale; renderer.setPixelRatio(baseDPR * scale); }
export function autoRes(fps, playing) {
  if (!cfg.autoRes) { if (scale !== 1) { scale = 1; apply(); } return; }
  if (!playing || document.hidden) { warm = 0; return; }
  if (++warm < 4) return; // skip shader-compile hitches right after starting / unpausing
  ref = Math.min(cfg.fpsCap || 144, Math.max(ref, fps, 30)); // aim at the FPS cap, not the screen's refresh // highest rate seen ≈ screen refresh
  const now = performance.now();
  // every change resizes the canvas and post-processing targets (a hitch of its own), so one bad second isn't enough
  if (fps < ref * .82 && scale > .55) {
    good = 0; if (++bad < 2) return; bad = 0;
    if (now - upT < 10000) blockT = now; // the last step up didn't fit
    scale = Math.max(.55, Math.round((scale - .1) * 100) / 100); apply();
  } else if (fps >= ref * .95) {
    bad = 0; if (++good >= 8 && scale < 1 && now - blockT > 30000) { scale = Math.min(1, Math.round((scale + .1) * 100) / 100); good = 0; upT = now; apply(); }
  } else { good = 0; bad = 0; }
}

/* ---------- jank meter (Options > Show FPS) ---------- */
// Tells hitches apart on a real device. A frame whose interval is clearly longer than usual counts as a hitch and is filed
// under what the PREVIOUS frame (the one that made it long) was doing: gc = the JS heap dropped by > 0.5 MB, hud = the
// dashboard texture was uploaded, js = our game code (physics, audio, HUD...) took over half the interval, draw = handing the frame to
// three took over half of it (scene traversal + command encoding, and on WebGPU also waiting for a free swap-chain image when the
// GPU is behind, so a slow GPU shows up here too), gpu = the callback was quick, so
// the wait was GPU / vsync / system (thermal throttling, other apps). Chrome only (performance.memory); gc is blank elsewhere.
const JK = { base: 16.7, lastT: 0, n: 0, js: 0, dr: 0, jsMax: 0, c: { gc: 0, hud: 0, js: 0, draw: 0, gpu: 0 }, t0: 0, text: '', pJs: 0, pDr: 0, pHud: false, pGc: false, h: 0, skip: 120 };
const MEM = performance.memory;
export function jankStart(t) { // first thing in the frame callback
  const raw = t - JK.lastT; JK.lastT = t; if (JK.skip > 0) { JK.skip--; return; }
  if (raw <= 0 || raw > 250 || document.hidden) return; // tab was away
  if (raw > JK.base * 1.5 + 1.5) { const k = JK.pGc ? 'gc' : JK.pHud ? 'hud' : JK.pJs - JK.pDr > raw * .5 ? 'js' : JK.pJs > raw * .5 ? 'draw' : 'gpu'; JK.c[k]++; } else JK.base += (raw - JK.base) * .05;
}
export function jankEnd(t, jsMs, hud, drMs = 0) { // after draw(): jsMs = this callback's own time, drMs = the part spent in culling + draw()
  if (JK.skip > 0) return; JK.n++; JK.js += jsMs; JK.dr += drMs; if (jsMs > JK.jsMax) JK.jsMax = jsMs; JK.pJs = jsMs; JK.pDr = drMs; JK.pHud = hud;
  if (MEM) { const h = MEM.usedJSHeapSize; JK.pGc = JK.h - h > 524288; JK.h = h; }
  if (t - JK.t0 > 10000) {
    if (JK.t0) { const c = JK.c, n = c.gc + c.hud + c.js + c.draw + c.gpu; JK.text = 'cpu ' + ((JK.js - JK.dr) / JK.n).toFixed(1) + '+' + (JK.dr / JK.n).toFixed(1) + '/' + JK.jsMax.toFixed(0) + ' ms · ' + (n ? n + ' hitches/10s (gc' + c.gc + ' hud' + c.hud + ' js' + c.js + ' draw' + c.draw + ' gpu' + c.gpu + ')' : 'no hitches'); }
    JK.t0 = t; JK.n = JK.js = JK.dr = JK.jsMax = 0; JK.c = { gc: 0, hud: 0, js: 0, draw: 0, gpu: 0 };
  }
}
export const jankText = () => JK.text;
