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
// terrain tile: levels[0] full detail ... levels[n] coarsest, picked by distance to the tile's rectangle
export const LOD_D = [200, 480];
export function addLOD(levels, x0, z0, x1, z1) { LODS.push({ levels, x0, z0, x1, z1, cur: -2 }); }

/* ---------- per-instance culling ---------- */
// Props spread over the whole island (trees, palms, houses, poles...) stay ONE InstancedMesh per type (one draw call),
// and only the instances in view and within draw distance are packed into the front of the instance buffer.
// Shadow casters near the camera are always kept: they can throw a shadow into view from behind it.
const POOLS = [], fr = new THREE.Frustum(), pv = new THREE.Matrix4(), SHADOW_KEEP = 60;
export function instCull(m, far, shadow) {
  const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
  const gs = g.boundingSphere, n = m.count, M = m.instanceMatrix.array.slice(0, n * 16), C = m.instanceColor ? m.instanceColor.array.slice(0, n * 3) : null, B = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const e = M.subarray(i * 16), c = gs.center, s = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    B[i * 4] = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12]; B[i * 4 + 1] = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13]; B[i * 4 + 2] = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14]; B[i * 4 + 3] = gs.radius * s;
  }
  m.frustumCulled = false; POOLS.push({ m, M, C, B, n, far: Math.min(far, DRAW), shadow, key: -1 });
}
function cullPool(p, cx, cy, cz) {
  const { m, M, C, B, n, far, shadow } = p, dst = m.instanceMatrix.array, dc = C && m.instanceColor.array, P = fr.planes; let j = 0, key = 0;
  for (let i = 0; i < n; i++) {
    const x = B[i * 4], y = B[i * 4 + 1], z = B[i * 4 + 2], r = B[i * 4 + 3], d = Math.hypot(x - cx, z - cz) - r;
    if (d > far) continue;
    if (!(shadow && d < SHADOW_KEEP)) {
      const mr = -(r + 2 + d * .04); let out = false; // margin: the camera keeps moving until the next update
      for (let k = 0; k < 6; k++) { const pl = P[k], nn = pl.normal; if (nn.x * x + nn.y * y + nn.z * z + pl.constant < mr) { out = true; break; } }
      if (out) continue;
    }
    if (j !== i) { dst.set(M.subarray(i * 16, i * 16 + 16), j * 16); if (C) dc.set(C.subarray(i * 3, i * 3 + 3), j * 3); }
    key = (key * 31 + i) | 0; j++;
  }
  if (key === p.key && j === m.count) return; p.key = key; m.count = j;
  const im = m.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, j * 16); im.needsUpdate = true;
  if (C) { const ic = m.instanceColor; ic.clearUpdateRanges(); ic.addUpdateRange(0, j * 3); ic.needsUpdate = true; }
}

let frame = 0; const last = { x: 1e9, y: 0, z: 0, fx: 0, fy: 0, fz: 0, fov: 0 };
export function cullUpdate(camera) {
  const e = camera.matrixWorld.elements, cx = e[12], cy = e[13], cz = e[14];
  // instance pools: only when the camera has moved / turned enough since the last pass
  if (Math.hypot(cx - last.x, cy - last.y, cz - last.z) > 1.5 || e[8] * last.fx + e[9] * last.fy + e[10] * last.fz < .9995 || camera.fov !== last.fov) {
    Object.assign(last, { x: cx, y: cy, z: cz, fx: e[8], fy: e[9], fz: e[10], fov: camera.fov });
    fr.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse.copy(camera.matrixWorld).invert()));
    for (const p of POOLS) cullPool(p, cx, cy, cz);
  }
  if (frame++ & 3) return; // whole-object distance checks: every 4th frame is plenty at bike speeds
  for (const it of ITEMS) { const d = Math.hypot(it.x - cx, it.z - cz) - it.r; it.o.visible = d < it.far; }
  for (const t of LODS) {
    const d = Math.hypot(Math.max(t.x0 - cx, 0, cx - t.x1), Math.max(t.z0 - cz, 0, cz - t.z1));
    const k = d > DRAW ? -1 : d < LOD_D[0] ? 0 : d < LOD_D[1] ? 1 : 2;
    if (k !== t.cur) { t.cur = k; t.levels.forEach((m, i) => m.visible = i === k); }
  }
}

/* ---------- Low preset: Lambert instead of PBR on the island ---------- */
const LITE = new Map();
export function liteMaterials(root) {
  if (!Q.lite) return;
  root.traverse(o => {
    const m = o.material; if (!o.isMesh || !m || !m.isMeshStandardMaterial) return;
    let l = LITE.get(m);
    if (!l) {
      l = new THREE.MeshLambertMaterial({ color: m.color, map: m.map, vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity });
      LITE.set(m, l);
    }
    o.material = l;
  });
}

/* ---------- adaptive resolution ---------- */
// Called once a second with the measured fps while riding. Drops the pixel ratio in 10% steps when the game can't
// hold the screen's refresh rate, creeps back up after a stable stretch, and stops trying to go up for a while if
// going up immediately made it slow again (avoids see-sawing).
let scale = 1, ref = 0, good = 0, warm = 0, upT = -1e9, blockT = -1e9;
export const resScale = () => scale;
function apply() { renderer.setPixelRatio(baseDPR * scale); }
export function autoRes(fps, playing) {
  if (!cfg.autoRes) { if (scale !== 1) { scale = 1; apply(); } return; }
  if (!playing || document.hidden) { warm = 0; return; }
  if (++warm < 4) return; // skip shader-compile hitches right after starting / unpausing
  ref = Math.min(144, Math.max(ref, fps, 30)); // highest rate seen ≈ screen refresh
  const now = performance.now();
  if (fps < ref * .82 && scale > .55) {
    if (now - upT < 5000) blockT = now; // the last step up didn't fit
    scale = Math.max(.55, Math.round((scale - .1) * 100) / 100); good = 0; apply();
  } else if (fps >= ref * .95) {
    if (++good >= 6 && scale < 1 && now - blockT > 30000) { scale = Math.min(1, Math.round((scale + .1) * 100) / 100); good = 0; upT = now; apply(); }
  } else good = 0;
}
