// Lamp light near the player (13.0), the headless half: which street lamps get a real light this frame and how strongly, and the
// numbers for their bounce. No three.js / DOM: node tools/lamps.mjs. The game glue (three lights, pools, headlight bounce) is lampfig.js.
//
// The island has hundreds of lamps (world.js LAMPS). Far away they stay what they were: an emissive head, an additive pool on the ground
// and a halo. Near the player the K nearest become real point lights (fixed count per graphics preset, so no shader ever recompiles;
// unused ones sit at intensity 0) that light the bike, the rider, walkers, cars, posts and walls, and the lamp's own pool fades out as
// its real light fades in (lights.js poolMat reads the slots).
//
// No popping. Lamps are ranked by q = horizontal distance - half the pool radius (a big floodlight counts from further). With q1 = the
// (K+1)-th smallest q, a selected lamp's fade is sstep(q1, FADE * q1, q): the lamp about to drop out of the set (rank K, q -> q1) is
// already at 0, and the one coming in (rank K+1) starts from 0. q1 is a continuous function of the player's position, so every lamp's
// light is continuous while riding: a set change is never visible. (Fewer than K+1 lamps in reach: q1 = the reach R.)
//
// Bounce (one bounce, analytic). A lamp of intensity I (cd-like) hanging h over the ground puts a flux of 2 pi I into the ground plane;
// a Lambertian ground of albedo rho re-emits rho of it, and a disc emitter of flux F has intensity F / pi along its normal: 2 rho I.
// That disc is drawn as a virtual point light BELOW the ground (depth ~0.6 h): everything above it (the bike's underside, the rider,
// the post, the walls round the pool) gets the warm up-light, while the ground itself faces away from it (n.l < 0) and so is not
// lit twice. The headlight's bounce is the same thing for the patch the beam hits ahead (flux = I x the cone's solid angle).
export const LAMPK = { E0: 5, reach: 70, fade: .7, bounce: 1, depth: .6, cell: 32 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// spatial hash of the lamp list (cells of LAMPK.cell m)
export function lampIndex(list, cell = LAMPK.cell) {
  const map = new Map(), key = (i, k) => (i + 32768) * 65536 + k + 32768; // exact (no collisions) for cells within ±1000 km
  list.forEach((l, n) => { const k = key(Math.floor(l.x / cell), Math.floor(l.z / cell)); let a = map.get(k); if (!a) map.set(k, a = []); a.push(n); });
  return { list, cell, map, key, cand: [], q: new Float64Array(64) };
}
// the light a lamp gives at full fade: intensity so the ground right under it gets E0, reach of the light, height over its pool
export const lampH = l => Math.max(1.2, l.y - l.gy);
export const lampI = l => LAMPK.E0 * lampH(l) * lampH(l);
export const lampRange = l => Math.max(l.r * 2.6, lampH(l) * 3.2, 8);

// Select up to K lamps round (px, pz). out[n] = { i (index in the list), f (fade 0..1), q }, nearest first; returns the count.
// Allocation-free once warm (out entries are reused).
export function selectLamps(I, px, pz, K, out, R = LAMPK.reach) {
  const { list, cell, map, key } = I, C = I.cand; C.length = 0;
  const i0 = Math.floor((px - R) / cell), i1 = Math.floor((px + R) / cell), k0 = Math.floor((pz - R) / cell), k1 = Math.floor((pz + R) / cell);
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
    const a = map.get(key(i, k)); if (!a) continue;
    for (const n of a) { const l = list[n], q = Math.hypot(l.x - px, l.z - pz) - l.r * .5; if (q < R) C.push(n); }
  }
  if (I.q.length < C.length) I.q = new Float64Array(C.length * 2);
  const Q = I.q; for (let n = 0; n < C.length; n++) { const l = list[C[n]]; Q[n] = Math.hypot(l.x - px, l.z - pz) - l.r * .5; }
  // partial selection sort: the K + 1 smallest q (C is short: tens of lamps)
  const m = Math.min(K + 1, C.length);
  for (let a = 0; a < m; a++) { let b = a; for (let c = a + 1; c < C.length; c++) if (Q[c] < Q[b]) b = c; if (b !== a) { const t = Q[a]; Q[a] = Q[b]; Q[b] = t; const u = C[a]; C[a] = C[b]; C[b] = u; } }
  const q1 = C.length > K ? Q[K] : R, lo = q1 - Math.max(q1 * (1 - LAMPK.fade), 10); let n = 0;
  for (let a = 0; a < Math.min(K, C.length); a++) {
    const f = sstep(q1, lo, Q[a]); if (f <= 0) continue;
    const o = out[n] || (out[n] = { i: 0, f: 0, q: 0 }); o.i = C[a]; o.f = f; o.q = Q[a]; n++;
  }
  return n;
}
// bounce of a lamp (virtual point light under its pool): intensity (times the ground's albedo colour), depth below the ground
export const bounceI = l => 2 * lampI(l) * LAMPK.bounce;
export const bounceDepth = l => Math.min(5, Math.max(1.5, lampH(l) * LAMPK.depth));
// headlight bounce: a spot of intensity I and cone half-angle a puts I x 2 pi (1 - cos a) into the patch it hits; re-emitted / pi
export const headBounceI = (I, a) => I * 2 * Math.PI * (1 - Math.cos(a)) / Math.PI * LAMPK.bounce;
