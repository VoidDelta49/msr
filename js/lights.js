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
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  m.colorNode = vec3(1, .86, .6); m.opacityNode = radial().mul(LAMP).mul(k); return m;
}
// glow around a lamp seen from afar: two crossed quads, faded out near the camera so it never fills the screen
export function haloMat(k = .6) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
  m.colorNode = vec3(1, .8, .45); m.opacityNode = radial().mul(LAMP).mul(k).mul(smoothstep(4, 18, positionWorld.sub(cameraPosition).length())); return m;
}
export const POOL_GEO = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export const HALO_GEO = () => { const a = new THREE.PlaneGeometry(1, 1), b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2); return mergeTwo(a, b); };
function mergeTwo(a, b) { // tiny merge (indexed planes) without importing the addons
  const g = new THREE.BufferGeometry(), pa = a.attributes, pb = b.attributes, n = pa.position.count;
  for (const k of ['position', 'normal', 'uv']) { const A = pa[k], B = pb[k], o = new Float32Array(A.array.length * 2); o.set(A.array); o.set(B.array, A.array.length); g.setAttribute(k, new THREE.BufferAttribute(o, A.itemSize)); }
  const ia = a.index.array, ib = b.index.array, I = new Uint16Array(ia.length * 2); I.set(ia); for (let i = 0; i < ib.length; i++) I[ia.length + i] = ib[i] + n; g.setIndex(new THREE.BufferAttribute(I, 1)); return g;
}
