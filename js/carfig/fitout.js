// Draws a van's fit-out (js/car/cabin.js slots + items): one group, rebuilt when a slot changes. A new item kind (a camper's bed,
// kitchen, cupboard...) = one entry in KINDS returning geometries in the car frame at the slot's z; data picks it with `kind`.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const box = (w, h, d, x, y, z, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); return g.translate(x, y, z); };
const strip = g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; };
// it = the item's data, z = the slot, f = the cabin floor -> { mat key: [geometries] }
const KINDS = {
  bench: (it, z, f) => {
    const y = f + .115; return {
      seat: [box(it.w, .1, .44, it.x, y, z), box(it.w, .52, .09, it.x, y + .3, z - .24, -.12), box(it.w * .5, .14, .07, it.x, y + .63, z - .29)],
      dark: [box(.04, y - f, .04, it.x - it.w / 2 + .08, f + (y - f) / 2, z), box(.04, y - f, .04, it.x + it.w / 2 - .08, f + (y - f) / 2, z), box(it.w - .1, .03, .04, it.x, f + .02, z - .15)],
    };
  },
};
export function fitout(cab, fit, M) {
  const G = new THREE.Group(), by = {};
  for (const s of cab.slots) { const it = cab.items[fit[s.id]]; const k = it && KINDS[it.kind]; if (!k) continue; for (const [m, L] of Object.entries(k(it, s.z, cab.floor))) (by[m] = by[m] || []).push(...L.map(strip)); }
  for (const [m, L] of Object.entries(by)) { const o = new THREE.Mesh(mergeGeometries(L), M[m]); o.castShadow = false; G.add(o); }
  return G;
}
export const fitDispose = G => G.traverse(o => { if (o.geometry) o.geometry.dispose(); });
