// Night lights: lamp heads, light pools on the ground, halos and lit windows. No real lights (those would change the
// shader and cost per pixel): lamp heads are emissive, the "light" on the ground is an additive radial quad, and
// windows use an emissive map on the building materials. Everything is driven by one level (0 day .. 1 night) that
// daynight.js sets every frame, so nothing recompiles when the lights come on.
import * as THREE from 'three';
import { uniform, vec3, uv, float, clamp, smoothstep, mix, positionWorld, cameraPosition } from 'three/tsl';
import { liteOf } from './perf.js';

export const LAMP = uniform(0);
const GLOWM = [];
let lvl = -1;
export function setLamps(v) {
  v = Math.round(v * 200) / 200; if (v === lvl) return; lvl = v; LAMP.value = v;
  for (const m of GLOWM) { m.emissiveIntensity = v * 1.15; const l = liteOf(m); if (l !== m) l.emissiveIntensity = v * 1.15; }
}
// building material with lit windows / signs: emissiveMap = the lit twin of its colour map (intensity 0 by day)
export function glowMat(m, map) { m.emissive.set(0xffffff); m.emissiveMap = map; m.emissiveIntensity = 0; GLOWM.push(m); return m; }

// bulb / lamp lens: dull grey by day, hot warm white at night (values > 1 so the tone mapper burns it out)
export function lampMat(on = [2.3, 1.8, 1], off = [.55, .55, .5]) {
  const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = mix(vec3(...off), vec3(...on), LAMP); return m;
}
const radial = () => { const f = clamp(float(1).sub(uv().sub(.5).length().mul(2)), 0, 1); return f.mul(f); };
// light on the ground: flat quad, tinted per instance (c), strength k. Add sx/sz per instance.
export function poolMat(k = .55) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  m.colorNode = vec3(1, .86, .6); m.opacityNode = radial().mul(LAMP).mul(k); return m;
}
// glow around a lamp seen from afar: two crossed quads, faded out near the camera so it never fills the screen
export function haloMat(k = .6) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
  m.colorNode = vec3(1, .8, .45); m.opacityNode = radial().mul(LAMP).mul(k).mul(smoothstep(4, 18, positionWorld.sub(cameraPosition).length())); return m;
}
export const POOL_GEO = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
// Ground-hugging pools (build 11.36): a flat quad floated over sloped / uneven ground, so each pool is an N x N grid whose
// every vertex sits on the drawn terrain (hf(x, z) + lift). Same footprint as the old quad (centre x/z, yaw ry, size sx x sz),
// tint c as vertex colour, uv 0..1 for the radial falloff. World-space geometry (no instancing); the caller chunks the list.
export function poolPatches(list, hf, N = 8, lift = .07) {
  const V = (N + 1) * (N + 1), pos = new Float32Array(list.length * V * 3), col = new Float32Array(list.length * V * 3), uvs = new Float32Array(list.length * V * 2);
  const idx = new Uint32Array(list.length * N * N * 6), cc = new THREE.Color(); let vi = 0, ii = 0;
  for (const p of list) {
    const cr = Math.cos(p.ry || 0), sr = Math.sin(p.ry || 0); cc.set(p.c ?? 0xffffff); const base = vi;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = i / N - .5, v = j / N - .5, lx = u * p.sx, lz = v * p.sz, x = p.x + lx * cr + lz * sr, z = p.z - lx * sr + lz * cr;
      pos.set([x, hf(x, z) + lift, z], vi * 3); col.set([cc.r, cc.g, cc.b], vi * 3); uvs.set([i / N, 1 - j / N], vi * 2); vi++;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.set([a, c, b, b, c, d], ii); ii += 6; // wound so the top face points up (+y)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere(); return g;
}
export const HALO_GEO = () => { const a = new THREE.PlaneGeometry(1, 1), b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2); return mergeTwo(a, b); };
function mergeTwo(a, b) { // tiny merge (indexed planes) without importing the addons
  const g = new THREE.BufferGeometry(), pa = a.attributes, pb = b.attributes, n = pa.position.count;
  for (const k of ['position', 'normal', 'uv']) { const A = pa[k], B = pb[k], o = new Float32Array(A.array.length * 2); o.set(A.array); o.set(B.array, A.array.length); g.setAttribute(k, new THREE.BufferAttribute(o, A.itemSize)); }
  const ia = a.index.array, ib = b.index.array, I = new Uint16Array(ia.length * 2); I.set(ia); for (let i = 0; i < ib.length; i++) I[ia.length + i] = ib[i] + n; g.setIndex(new THREE.BufferAttribute(I, 1)); return g;
}
