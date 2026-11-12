// Hollow vehicle body from data-like tables: a side silhouette swept across the width with rounded edges, window holes in the
// sides, glass in them, an inside face in trim colour (so first person looks OUT through real windows). Used by the car models
// (hiace.js); a new van / car / jeepney body = a new silhouette + window list, not new mesh code.
// Vehicle frame as in js/car/spec.js: +z forward, +x LEFT, +y up, origin on the ground under the middle of the wheelbase.
import * as THREE from 'three';

// sil: [[z, y, kind?], ...] closed outline, any winding; kind tags the segment that STARTS at the point:
//   undefined body · 'g' glass (windscreen / rear window, inset from the edges by o.gin) · 'a' wheel arch (only a lip, the tub is open)
// o: { w width, c edge radius, gin, wins: [[[z, y], ...], ...] side-window polygons, warp(v) optional in-place vertex shaper }
// -> { body, glass }: two non-indexed geometries with normals
export function shell(sil, o) {
  const n = sil.length, hw = o.w / 2, c = o.c, B = { p: [], n: [] }, Gl = { p: [], n: [] };
  let area = 0; for (let i = 0; i < n; i++) { const a = sil[i], b = sil[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sg = area > 0 ? 1 : -1; // outward normal of segment (dz, dy) = sg * (dy, -dz)
  const sn = sil.map((a, i) => { const b = sil[(i + 1) % n], dz = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dz, dy) || 1; return [sg * dy / l, -sg * dz / l]; });
  // point normals: smooth where the outline bends gently, split at real corners
  const pn = sil.map((a, i) => { const p = sn[(i + n - 1) % n], q = sn[i], d = p[0] * q[0] + p[1] * q[1]; if (d < .62) return null; const l = Math.hypot(p[0] + q[0], p[1] + q[1]); return [(p[0] + q[0]) / l, (p[1] + q[1]) / l]; });
  const av = sil.map((a, i) => { const p = sn[(i + n - 1) % n], q = sn[i], l = Math.hypot(p[0] + q[0], p[1] + q[1]) || 1; return [(p[0] + q[0]) / l, (p[1] + q[1]) / l]; });
  const Q = sil.map((a, i) => [a[0] - av[i][0] * c, a[1] - av[i][1] * c]); // the side panel's outline: in by the edge radius
  const tri = (T, a, b, d, na, nb, nd) => { T.p.push(...a, ...b, ...d); T.n.push(...na, ...nb, ...nd); };
  const quad = (T, a, b, d, e, na, nb, nd, ne, flip) => { if (flip) { tri(T, a, d, b, na, nd, nb); tri(T, a, e, d, na, ne, nd); } else { tri(T, a, b, d, na, nb, nd); tri(T, a, d, e, na, nd, ne); } };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = sil[i], b = sil[j], k = a[2], na = pn[i] || sn[i], nb = pn[j] || sn[i], x1 = hw - c;
    const P = (p, x) => [x, p[1], p[0]], N = (m, x) => [x, m[1], m[0]], fl = sg < 0;
    const strip = (T, xa, xb) => quad(T, P(a, xa), P(b, xa), P(b, xb), P(a, xb), N(na, 0), N(nb, 0), N(nb, 0), N(na, 0), fl);
    if (k === 'a') { strip(B, x1, x1 - .1); strip(B, -x1 + .1, -x1); }
    else if (k === 'g') { const xi = x1 - o.gin; strip(Gl, xi, -xi); strip(B, x1, xi); strip(B, -xi, -x1); }
    else strip(B, x1, -x1);
    for (const s of [1, -1]) { // rounded edge between the swept surface and the side panel
      const m = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
      quad(B, P(a, s * x1), P(b, s * x1), [s * hw, Q[j][1], Q[j][0]], [s * hw, Q[i][1], Q[i][0]], N(na, 0), N(nb, 0), m([s, nb[1] * .15, nb[0] * .15]), m([s, na[1] * .15, na[0] * .15]), s > 0 ? !fl : fl);
    }
  }
  // side panels with the window holes, and the panes
  const V2 = p => new THREE.Vector2(p[0], p[1]), cw = P => THREE.ShapeUtils.isClockWise(P), con = Q.map(V2); if (cw(con)) con.reverse();
  const holes = (o.wins || []).map(w => { const h = w.map(V2); if (!cw(h)) h.reverse(); return h; }), all = con.concat(...holes);
  const side = (T, pts, idx, s) => { for (const f of idx) { const [a, b, d] = s > 0 ? [f[0], f[2], f[1]] : f; tri(T, ...[a, b, d].map(q => [s * hw, pts[q].y, pts[q].x]), [s, 0, 0], [s, 0, 0], [s, 0, 0]); } };
  const fi = THREE.ShapeUtils.triangulateShape(con, holes);
  for (const s of [1, -1]) { side(B, all, fi, s); for (const h of holes) { const hh = h.slice().reverse(); side(Gl, hh, THREE.ShapeUtils.triangulateShape(hh, []), s); } }
  const geo = T => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(T.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(T.n, 3)); if (o.warp) warp(g, o.warp); return g; };
  return { body: geo(B), glass: geo(Gl) };
}
// run a vertex shaper over a geometry (tumblehome, the nose narrowing in plan): keeps add-on parts glued to the shaped body
export function warp(g, f) { const p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); f(v); p.setXYZ(i, v.x, v.y, v.z); } p.needsUpdate = true; return g; }
// a circular wheel-arch run for a silhouette: points from angle a0 to a1 (degrees, 0 = +z, 90 = up) around (z, y)
export const arch = (z, y, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [z + r * Math.cos(a), y + r * Math.sin(a), i < n ? 'a' : undefined]; });
