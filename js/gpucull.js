// WebGPU only: GPU-driven culling of the island's instanced props (Options > GPU culling, default on).
// Each prop type is ONE InstancedMesh for the whole island (no 700 m chunks). Every frame a compute pass tests every
// instance against the camera frustum and its distance class, and copies the survivors' matrices (and colours) into
// a compact buffer; the mesh is then drawn with drawIndexedIndirect, so the instance count never comes back to JS.
// Shadow casters near the bike pass too, so a tree behind you still casts its shadow into view.
// Instance order changes from frame to frame, so flat decals (lane lines) stay on the CPU path (they would z-fight).
// WebGL keeps the chunked path in world.js; nothing here runs there.
import * as THREE from 'three';
import { Fn, If, storage, uniform, instanceIndex, atomicAdd, atomicStore, uint, float, dot } from 'three/tsl';
import { renderer, sun } from './renderer.js';

const TYPES = [];
export const gpuInst = (geo, mat, list, shadow, far) => TYPES.push({ geo, mat, list, shadow, far });

const PL = [0, 1, 2, 3, 4, 5].map(() => uniform(new THREE.Vector4())); // frustum planes (normal, constant)
const CAM = uniform(new THREE.Vector2()), SHC = uniform(new THREE.Vector2());
const SH_R = 46; // shadow camera is ±28 m around the bike; + diagonal + tall casters leaning in from outside
let run = null;
export const G = { args: null, n: 0 }; // debug: G.args = indirect args (5 u32 per type, [1] = drawn instances)
const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), dummy = new THREE.Object3D(), v = new THREE.Vector3(), col = new THREE.Color();

export function finishGpuInst(scene) {
  if (!TYPES.length) return 0;
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

// every frame, right before drawing
export function gpuCull(camera) {
  if (!run) return;
  camera.updateWorldMatrix(true, false); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm, camera.coordinateSystem);
  fr.planes.forEach((p, i) => PL[i].value.set(p.normal.x, p.normal.y, p.normal.z, p.constant));
  const e = camera.matrixWorld.elements; CAM.value.set(e[12], e[14]); SHC.value.set(sun.target.position.x, sun.target.position.z);
  renderer.compute(run);
}
