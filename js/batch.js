// Draw-call batching (Build 11.43). Two tools, both on three's BatchedMesh (one geometry buffer + per-instance matrices in a
// texture, drawn with ONE multi-draw call when the GPU has WEBGL_multi_draw):
//  - staticBatch(): many static meshes with one material (terrain tiles at every LOD, road chunks) become one object.
//    Per-piece frustum culling + front-to-back sorting is three's own (cheap: only a few hundred pieces).
//  - props (batchInst / finishBatches / batchCull): every instanced prop list of the island goes into one BatchedMesh per
//    MATERIAL, not per prop type and 700 m chunk. Plain untextured standard materials (rails, poles, stalls, parked bikes,
//    trikes, cars, huts...) all become ONE material: their colour moves into the per-instance colour and their roughness /
//    metalness into a vertex attribute, so they are a single draw. Textured materials with the same settings are merged too
//    (both tin roofs). All shadow casters share one shadow-only proxy batch on layer 1 (one draw for the whole shadow pass).
//    Culling is per 140 m cell and distance class (small / mid / tree / big, as before), done here every frame, so three's
//    per-instance loop only runs when a cell's visibility flips.
// Props use this on WebGL 2 with WEBGL_multi_draw only: on WebGPU three issues one draw per instance for a BatchedMesh, and
// without multi-draw WebGL does the same; there world.js keeps its chunked InstancedMesh path (and gpucull.js on WebGPU).
import * as THREE from 'three';
import { attribute } from 'three/tsl';
import { Q } from './config.js';
import { renderer, GPU, sun } from './renderer.js';
import { DRAW } from './perf.js';
import { glowTrack, isGlow, isNight, lampsOn } from './lights.js';

export const MULTI = !GPU && !!(renderer.backend.extensions && renderer.backend.extensions.has('WEBGL_multi_draw'));

/* ---------- static batches ---------- */
// geos: BufferGeometries already in world space, all with the same attributes and all indexed (or all not). Returns the batch
// and the instance id of each geometry (same order), so callers can switch pieces with setVisibleAt (terrain LOD).
export function staticBatch(geos, mat, { sort = true } = {}) {
  let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : 0; }
  const b = new THREE.BatchedMesh(geos.length, nv, Math.max(ni, 1), mat); b.sortObjects = sort; b.perObjectFrustumCulled = true;
  const ids = geos.map(g => { const id = b.addInstance(b.addGeometry(g)); g.dispose(); return id; });
  b.computeBoundingBox(); b.computeBoundingSphere(); b.matrixAutoUpdate = false; b.updateMatrixWorld(true);
  return { b, ids };
}

/* ---------- props ---------- */
const REQ = [];
export function batchInst(geo, mat, list, shadow, far) { if (list.length) REQ.push({ geo, mat, list, shadow, far: Math.min(far, DRAW) }); }
const SHM = new THREE.MeshBasicMaterial(); // shadow-only proxy material (only the shadow pass draws layer 1)

// The material a prop list is drawn with, plus what moves out of it: mul = colour that goes into every instance's colour,
// rm = [roughness, metalness] for the per-vertex attribute (the shared untextured material), pair = per-vertex rm from 'tsel'.
let UNTEX = null, UNLIT = null; const CANON = new Map();
const plainStd = m => m.type === 'MeshStandardMaterial' && !m.map && !m.emissiveMap && !m.transparent && m.side === THREE.FrontSide && !m.polygonOffset && m.emissive.r + m.emissive.g + m.emissive.b === 0 && !isGlow(m);
function untex() {
  if (!UNTEX) {
    UNTEX = Q.lite ? new THREE.MeshLambertNodeMaterial({ vertexColors: true }) : new THREE.MeshStandardNodeMaterial({ vertexColors: true });
    if (!Q.lite) { const rm = attribute('rm', 'vec2'); UNTEX.roughnessNode = rm.x; UNTEX.metalnessNode = rm.y; }
  }
  return UNTEX;
}
function canon(m) {
  const P = m.userData.pair;
  if (P && P.every(plainStd)) return { mat: untex(), mul: null, pair: P }; // untextured pair (trike, hut, car): colours already in the vertices
  if (plainStd(m)) return { mat: untex(), mul: m.color, rm: [m.roughness, m.metalness] };
  if (m.type === 'MeshBasicMaterial' && !m.map && !m.transparent) {
    if (!UNLIT) UNLIT = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
    return { mat: UNLIT, mul: m.color };
  }
  if (m.type === 'MeshStandardMaterial' && !m.transparent) { // textured: share one copy per identical setup, colour per instance
    const k = [m.map && m.map.uuid, m.emissiveMap && m.emissiveMap.uuid, m.roughness, m.metalness, m.vertexColors, m.side, isGlow(m), m.emissive.getHex()].join('|');
    let c = CANON.get(k); if (!c) { c = m.clone(); c.color.set(0xffffff); if (isGlow(m)) glowTrack(c); CANON.set(k, c); }
    return { mat: c, mul: m.color };
  }
  return { mat: m, mul: null }; // node materials (lamps, halos, textured pairs) and transparent ones: as they are
}

// every geometry of one batch must have the same attributes (BatchedMesh): non-indexed, missing ones filled with neutral values
const SIZE = { position: 3, normal: 3, uv: 2, color: 3, rm: 2, tsel: 1 };
function norm(g, names, fill) {
  g = g.index ? g.toNonIndexed() : g.clone(); const n = g.attributes.position.count;
  if (names.includes('normal') && !g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (!names.includes(k)) g.deleteAttribute(k);
  for (const k of names) if (!g.attributes[k]) { const a = new Float32Array(n * SIZE[k]); if (k === 'color') a.fill(1); g.setAttribute(k, new THREE.BufferAttribute(a, SIZE[k])); }
  if (fill) fill(g, n);
  for (const k of names) { const a = g.attributes[k]; if (a.normalized || !(a.array instanceof Float32Array)) { const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j); g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize)); } }
  return g;
}

const CELL = 140, SHCELL = 70, SH_R = 46; // shadow camera: ±28 m around the bike, + diagonal + tall casters leaning in (gpucull.js)
const BATCHES = [];
const dummy = new THREE.Object3D(), col = new THREE.Color(), sph = new THREE.Sphere();

// cells: instances grouped by grid cell (+ distance class); one bounding sphere each; vis flips call setVisibleAt
function cellsOf(b, items, size) {
  const M = new Map();
  for (const it of items) {
    const k = it.far + '|' + Math.floor(it.x / size) + '|' + Math.floor(it.z / size); let c = M.get(k);
    if (!c) M.set(k, c = { ids: [], far: it.far, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9, vis: true });
    c.ids.push(it.id); c.x0 = Math.min(c.x0, it.x - it.r); c.x1 = Math.max(c.x1, it.x + it.r); c.y0 = Math.min(c.y0, it.y - it.r); c.y1 = Math.max(c.y1, it.y + it.r); c.z0 = Math.min(c.z0, it.z - it.r); c.z1 = Math.max(c.z1, it.z + it.r);
  }
  return [...M.values()].map(c => ({ ids: Int32Array.from(c.ids), far: c.far, vis: true, x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, z: (c.z0 + c.z1) / 2, r: Math.hypot(c.x1 - c.x0, c.y1 - c.y0, c.z1 - c.z0) / 2 }));
}

function build(scene, mat, entries, names, cellSize, opt) {
  let nv = 0, ni = 0; const geos = entries.map(e => { const g = norm(e.geo, names, e.fill); nv += g.attributes.position.count; ni += e.list.length; return g; });
  const b = new THREE.BatchedMesh(ni, nv, 0, mat); b.sortObjects = false; b.perObjectFrustumCulled = false; b.matrixAutoUpdate = false;
  const items = [], tint = entries.some(e => e.mul || e.list.some(o => o.c !== undefined));
  entries.forEach((e, gi) => {
    const gid = b.addGeometry(geos[gi]); geos[gi].computeBoundingSphere(); const gs = geos[gi].boundingSphere;
    for (const o of e.list) {
      const id = b.addInstance(gid), sx = o.sx || 1, sy = o.sy || 1, sz = o.sz || 1;
      dummy.position.set(o.x, o.y || 0, o.z); dummy.rotation.set(0, o.ry || 0, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); b.setMatrixAt(id, dummy.matrix);
      if (tint) { col.set(o.c !== undefined && opt.color ? o.c : 0xffffff); if (e.mul) col.multiply(e.mul); b.setColorAt(id, col); }
      sph.copy(gs).applyMatrix4(dummy.matrix); items.push({ id, x: sph.center.x, y: sph.center.y, z: sph.center.z, r: sph.radius, far: e.far });
    }
    geos[gi].dispose();
  });
  b.computeBoundingBox(); b.computeBoundingSphere(); b.updateMatrixWorld(true); scene.add(b);
  Object.assign(b, opt.flags); if (opt.layer) b.layers.set(opt.layer);
  BATCHES.push({ b, cells: cellsOf(b, items, cellSize), shadow: !!opt.layer, night: isNight(mat), n: ni });
  return b;
}

export function finishBatches(scene) {
  if (!REQ.length) return 0;
  const G = new Map(), SH = [];
  for (const r of REQ) {
    const c = canon(r.mat); let g = G.get(c.mat); if (!g) G.set(c.mat, g = []);
    let fill = null;
    if (c.rm) { const [ro, me] = c.rm; fill = (geo, n) => { const a = geo.attributes.rm.array; for (let i = 0; i < n; i++) { a[i * 2] = ro; a[i * 2 + 1] = me; } }; }
    else if (c.pair) { const P = c.pair; fill = (geo, n) => { const a = geo.attributes.rm.array, t = geo.attributes.tsel.array; for (let i = 0; i < n; i++) { const m = P[t[i] > .5 ? 1 : 0]; a[i * 2] = m.roughness; a[i * 2 + 1] = m.metalness; } }; }
    g.push({ geo: r.geo, list: r.list, mul: c.mul, far: r.far, fill });
    if (r.shadow && Q.shadow > 0) SH.push({ geo: r.geo, list: r.list, far: r.far });
  }
  for (const [mat, E] of G) {
    const names = ['position', 'normal'];
    if (mat === UNTEX) names.push('color', 'rm', 'tsel'); // tsel only feeds the rm fill of the untextured pairs (unused by the shader)
    else { if (E.some(e => e.geo.attributes.uv)) names.push('uv'); if (mat.vertexColors || mat.userData.pair) names.push('color'); if (mat.userData.pair) names.push('tsel'); }
    const fl = { castShadow: false, receiveShadow: true, name: 'batch' };
    build(scene, mat, E, names, CELL, { color: true, flags: fl });
  }
  if (SH.length) build(scene, SHM, SH, ['position', 'normal'], SHCELL, { color: false, layer: 1, flags: { castShadow: true, receiveShadow: false, name: 'batchShadow' } });
  REQ.length = 0;
  return BATCHES.length;
}

// every frame, from gpucull.cull(): main batches against the camera frustum + each cell's draw distance, the shadow batch by
// distance to the shadow camera's centre. Only flipped cells touch their instances. A batch with no cell in view (or a night-only
// one by day: halos) is hidden as a whole, so three skips it instead of setting up an empty multi-draw.
const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), sp = new THREE.Sphere();
export function batchCull(camera) {
  if (!BATCHES.length) return;
  pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm, camera.coordinateSystem);
  const e = camera.matrixWorld.elements, cx = e[12], cz = e[14], tx = sun.target.position.x, tz = sun.target.position.z;
  const night = lampsOn();
  for (const B of BATCHES) {
    let n = 0;
    for (const c of B.cells) {
      let v;
      if (B.shadow) { const dx = c.x - tx, dz = c.z - tz, f = SH_R + c.r; v = dx * dx + dz * dz < f * f; }
      else { const dx = c.x - cx, dz = c.z - cz, f = c.far + c.r; v = dx * dx + dz * dz < f * f && fr.intersectsSphere(sp.set(sp.center.set(c.x, c.y, c.z), c.r)); }
      if (v !== c.vis) { c.vis = v; for (const id of c.ids) B.b.setVisibleAt(id, v); }
      if (v) n++;
    }
    B.b.visible = n > 0 && (!B.night || night);
  }
}
export const batchStats = () => BATCHES.map(B => ({ name: B.b.name, mat: B.b.material.type, n: B.n, cells: B.cells.length, vis: B.cells.filter(c => c.vis).length }));
