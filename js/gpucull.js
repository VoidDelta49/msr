// WebGPU only: GPU-driven culling of the island's instanced props (Options > GPU culling, default on).
// Each prop type is ONE InstancedMesh for the whole island (no 700 m chunks). Every frame a compute pass tests every
// instance against the camera frustum and its distance class, and copies the survivors' matrices (and colours) into
// a compact buffer; the mesh is then drawn with drawIndexedIndirect, so the instance count never comes back to JS.
// Shadow casters near the bike pass too, so a tree behind you still casts its shadow into view.
// Instance order changes from frame to frame, so flat decals (lane lines) stay on the CPU path (they would z-fight).
// WebGL keeps the chunked path in world.js; nothing here runs there.
import * as THREE from 'three';
import { Fn, If, storage, uniform, uniformArray, instanceIndex, atomicAdd, atomicStore, uint, float, dot } from 'three/tsl';
import { renderer, sun } from './renderer.js';
import { cullUpdate } from './perf.js';

const TYPES = [];
export const gpuInst = (geo, mat, list, shadow, far) => TYPES.push({ geo, mat, list, shadow, far });

const PL = [0, 1, 2, 3, 4, 5].map(() => uniform(new THREE.Vector4())); // frustum planes (normal, constant)
const CAM = uniform(new THREE.Vector2()), SHC = uniform(new THREE.Vector2());
const SH_R = 46; // shadow camera is ±28 m around the bike; + diagonal + tall casters leaning in from outside
let run = null, resetArgs = null, still = 0; const LAST = new Float64Array(26).fill(NaN);
export const G = { args: null, n: 0 }; // debug: G.args = indirect args (5 u32 per type, [1] = drawn instances)
const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), dummy = new THREE.Object3D(), v = new THREE.Vector3(), col = new THREE.Color();

export function finishGpuInst(scene) {
  if (!TYPES.length) return 0;
  const dev = renderer.backend && renderer.backend.device;
  if (dev && dev.features && dev.features.has('indirect-first-instance')) return finishOnePass(scene);
  return finishPerType(scene);
}

// One pass (Build 11.26): every type's instances live in ONE source buffer and ONE destination buffer, each type owning a fixed slice
// of the destination (its offset goes in the indirect args' firstInstance, so the draw reads from its own slice). A single compute
// dispatch culls all instances of all types; the counters are reset by re-uploading the 20-byte-per-type args each frame instead of a
// separate clear dispatch. Before, it was one clear dispatch + one dispatch per type, each with its own bind group, uniform updates and
// pipeline switch, i.e. ~20 compute nodes for three to walk every frame. Needs 'indirect-first-instance' (most GPUs; without it a
// non-zero firstInstance makes indirect draws no-ops), else finishPerType below.
function finishOnePass(scene) {
  const n = TYPES.length, ARGS = new THREE.IndirectStorageBufferAttribute(new Uint32Array(n * 5), 5);
  const T = TYPES.reduce((a, t) => a + t.list.length, 0), hasC = TYPES.some(t => t.list.some(o => o.c !== undefined));
  const sM = new Float32Array(T * 16), sS = new Float32Array(T * 4), sT = new Uint32Array(T), sC = hasC ? new Float32Array(T * 3).fill(1) : null;
  const dM = new THREE.StorageInstancedBufferAttribute(T, 16), dC = hasC ? new THREE.StorageInstancedBufferAttribute(T, 3) : null;
  const par = [], cast = sun.castShadow; let off = 0;
  TYPES.forEach((t, k) => {
    const L = t.list, N = L.length, g = new THREE.BufferGeometry();
    for (const [a, b] of Object.entries(t.geo.attributes)) g.setAttribute(a, b); if (t.geo.index) g.setIndex(t.geo.index);
    t.geo.computeBoundingSphere(); const bs = t.geo.boundingSphere, tc = L.some(o => o.c !== undefined);
    L.forEach((o, j) => {
      const i = off + j, sx = o.sx || 1, sy = o.sy || 1, sz = o.sz || 1;
      dummy.position.set(o.x, o.y || 0, o.z); dummy.rotation.set(0, o.ry || 0, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); dummy.matrix.toArray(sM, i * 16);
      v.copy(bs.center).applyMatrix4(dummy.matrix); sS[i * 4] = v.x; sS[i * 4 + 1] = v.y; sS[i * 4 + 2] = v.z; sS[i * 4 + 3] = bs.radius * Math.max(sx, sy, sz);
      sT[i] = k; if (hasC && o.c !== undefined) col.set(o.c).toArray(sC, i * 3);
    });
    const m = new THREE.InstancedMesh(g, t.mat, N); m.instanceMatrix = dM; if (tc) m.instanceColor = dC;
    ARGS.array[k * 5] = g.index ? g.index.count : g.attributes.position.count; // firstInstance: indexed layout [count, inst, firstIndex, baseVertex, firstInst], non-indexed [count, inst, firstVertex, firstInst]
    ARGS.array[k * 5 + (g.index ? 4 : 3)] = off; g.setIndirect(ARGS, k * 20);
    m.frustumCulled = false; m.castShadow = t.shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m);
    par.push(new THREE.Vector4(t.far, t.shadow && cast ? 1 : 0, off, 0)); off += N;
  });
  const A = storage(ARGS, 'uint', n * 5).toAtomic(), P = uniformArray(par, 'vec4');
  const src = storage(new THREE.StorageBufferAttribute(sM, 16), 'mat4', T).toReadOnly(), sph = storage(new THREE.StorageBufferAttribute(sS, 4), 'vec4', T).toReadOnly();
  const typ = storage(new THREE.StorageBufferAttribute(sT, 1), 'uint', T).toReadOnly(), dst = storage(dM, 'mat4', T);
  const srcC = hasC && storage(new THREE.StorageBufferAttribute(sC, 3), 'vec3', T).toReadOnly(), dstC = hasC && storage(dC, 'vec3', T);
  const kern = Fn(() => {
    const i = instanceIndex;
    If(i.lessThan(uint(T)), () => {
      const k = typ.element(i).toVar(), q = P.element(k).toVar(), s = sph.element(i).toVar(), p = s.xyz, r = s.w, d = p.xz.sub(CAM), f = q.x.add(r);
      const ok = dot(d, d).lessThan(f.mul(f)).toVar();
      for (const L of PL) ok.assign(ok.and(dot(L.xyz, p).add(L.w).greaterThan(r.negate())));
      const e = p.xz.sub(SHC), sr = float(SH_R).add(r); ok.assign(ok.or(q.y.greaterThan(.5).and(dot(e, e).lessThan(sr.mul(sr)))));
      If(ok, () => {
        const slot = uint(q.z).add(atomicAdd(A.element(k.mul(5).add(1)), uint(1))).toVar();
        dst.element(slot).assign(src.element(i)); if (hasC) dstC.element(slot).assign(srcC.element(i));
      });
    });
  })().compute(T, [64]);
  run = kern; resetArgs = ARGS; G.args = ARGS; G.n = n; G.total = T; G.onePass = true;
  return n;
}

// fallback without 'indirect-first-instance': one destination buffer per type, a clear dispatch + one dispatch per type
function finishPerType(scene) {
  const n = TYPES.length, ARGS = new THREE.IndirectStorageBufferAttribute(new Uint32Array(n * 5), 5); // 5 u32 per draw (indexed layout; non-indexed uses the first 4)
  const A = storage(ARGS, 'uint', n * 5).toAtomic(), kern = [];
  TYPES.forEach((t, k) => {
    const L = t.list, N = L.length, g = new THREE.BufferGeometry(); // own geometry (shares the attributes): setIndirect is per geometry
    for (const [a, b] of Object.entries(t.geo.attributes)) g.setAttribute(a, b); if (t.geo.index) g.setIndex(t.geo.index);
    t.geo.computeBoundingSphere(); const bs = t.geo.boundingSphere, hasC = L.some(o => o.c !== undefined);
    const sM = new Float32Array(N * 16), sS = new Float32Array(N * 4), sC = hasC ? new Float32Array(N * 3).fill(1) : null;
    L.forEach((o, i) => {
      const sx = o.sx || 1, sy = o.sy || 1, sz = o.sz || 1;
      dummy.position.set(o.x, o.y || 0, o.z); dummy.rotation.set(0, o.ry || 0, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); dummy.matrix.toArray(sM, i * 16);
      v.copy(bs.center).applyMatrix4(dummy.matrix); sS[i * 4] = v.x; sS[i * 4 + 1] = v.y; sS[i * 4 + 2] = v.z; sS[i * 4 + 3] = bs.radius * Math.max(sx, sy, sz);
      if (hasC && o.c !== undefined) col.set(o.c).toArray(sC, i * 3);
    });
    const dM = new THREE.StorageInstancedBufferAttribute(N, 16), dC = hasC ? new THREE.StorageInstancedBufferAttribute(N, 3) : null;
    const m = new THREE.InstancedMesh(g, t.mat, N); m.instanceMatrix = dM; if (dC) m.instanceColor = dC;
    ARGS.array[k * 5] = g.index ? g.index.count : g.attributes.position.count; g.setIndirect(ARGS, k * 20);
    m.frustumCulled = false; m.castShadow = t.shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m);
    const src = storage(new THREE.StorageBufferAttribute(sM, 16), 'mat4', N).toReadOnly(), sph = storage(new THREE.StorageBufferAttribute(sS, 4), 'vec4', N).toReadOnly();
    const dst = storage(dM, 'mat4', N), srcC = hasC && storage(new THREE.StorageBufferAttribute(sC, 3), 'vec3', N).toReadOnly(), dstC = hasC && storage(dC, 'vec3', N);
    const far = float(t.far), cast = t.shadow && sun.castShadow;
    kern.push(Fn(() => {
      const i = instanceIndex;
      If(i.lessThan(uint(N)), () => {
        const s = sph.element(i).toVar(), p = s.xyz, r = s.w, d = p.xz.sub(CAM), f = far.add(r);
        const ok = dot(d, d).lessThan(f.mul(f)).toVar();
        for (const P of PL) ok.assign(ok.and(dot(P.xyz, p).add(P.w).greaterThan(r.negate())));
        if (cast) { const e = p.xz.sub(SHC), q = float(SH_R).add(r); ok.assign(ok.or(dot(e, e).lessThan(q.mul(q)))); }
        If(ok, () => {
          const slot = atomicAdd(A.element(uint(k * 5 + 1)), uint(1)).toVar();
          dst.element(slot).assign(src.element(i)); if (hasC) dstC.element(slot).assign(srcC.element(i));
        });
      });
    })().compute(N, [64]));
  });
  const clear = Fn(() => { If(instanceIndex.lessThan(uint(n)), () => { atomicStore(A.element(instanceIndex.mul(5).add(1)), uint(0)); }); })().compute(n, [64]);
  run = [clear, ...kern]; G.args = ARGS; G.n = n; G.total = TYPES.reduce((a, t) => a + t.list.length, 0);
  return n;
}

// every frame, right before drawing: all culling in one place. The camera matrix is brought up to date once, then the CPU side
// (perf.js: distance culling of single objects + terrain LOD, every 4th frame) and the GPU side (one dispatch for every instanced prop)
export function cull(camera) {
  camera.updateWorldMatrix(true, false); cullUpdate(camera);
  if (!run) return;
  pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm, camera.coordinateSystem);
  // nothing moved (parked, paused, garage, menus): last frame's result still stands, skip the dispatch and its queue submit
  let same = LAST[0] === sun.target.position.x && LAST[1] === sun.target.position.z;
  fr.planes.forEach((p, i) => { const j = 2 + i * 4; if (LAST[j] !== p.normal.x || LAST[j + 1] !== p.normal.y || LAST[j + 2] !== p.normal.z || LAST[j + 3] !== p.constant) { same = false; LAST[j] = p.normal.x; LAST[j + 1] = p.normal.y; LAST[j + 2] = p.normal.z; LAST[j + 3] = p.constant; } });
  if (same && ++still < 120) return; still = 0; LAST[0] = sun.target.position.x; LAST[1] = sun.target.position.z; // (still re-runs every 2 s anyway)
  fr.planes.forEach((p, i) => PL[i].value.set(p.normal.x, p.normal.y, p.normal.z, p.constant));
  const e = camera.matrixWorld.elements; CAM.value.set(e[12], e[14]); SHC.value.set(sun.target.position.x, sun.target.position.z);
  if (resetArgs) resetArgs.needsUpdate = true; // counters back to 0 (the CPU copy never changes; the GPU wrote the counts)
  renderer.compute(run);
}
export const gpuCull = cull;
