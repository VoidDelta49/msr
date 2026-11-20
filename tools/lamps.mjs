#!/usr/bin/env node
// Headless checks of the street lamps as real lights near the player (js/lamps.js; game glue js/lampfig.js). No browser.
//   node tools/lamps.mjs [-v]     (also part of tools/test.mjs)
// Fails on: the world's lamp list (world.js LAMPS) not reconstructible here, so on a synthetic street + plaza: a lamp's light jumping
// while riding past (every lamp's fade is continuous along the path: no popping when the set of K lit lamps changes), the nearest
// lamp not lit at full strength, more than K lamps lit, the lamp under the player missing, lamps far away lit, the bounce numbers
// (flux 2 pi I x albedo re-emitted, depth under the pool), or the selection allocating once warm.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), J = rel => pathToFileURL(path.join(ROOT, rel)).href;
const L = await import(J('js/lamps.js'));
const verbose = process.argv.includes('-v');

export function lampTests() {
  const P = [], bad = m => P.push('LAMPS ' + m), info = [];
  // a street of poles every 28 m on both sides (staggered), a plaza of floodlights, nipa lanterns
  const list = [];
  for (let i = 0; i < 40; i++) list.push({ x: (i % 2 ? 6 : -6), z: i * 28, y: 7.4, gy: 0, r: 8, c: 0xffc070 });
  for (let i = 0; i < 6; i++) list.push({ x: 60 + (i % 3) * 25, z: 300 + Math.floor(i / 3) * 30, y: 9, gy: 0, r: 12, c: 0xe8f0ff });
  for (let i = 0; i < 8; i++) list.push({ x: -40 - i * 9, z: 500, y: 1.7, gy: 0, r: 5, c: 0xffb870 });
  const I = L.lampIndex(list);
  for (const K of [2, 4, 6]) {
    const out = [], prev = new Map(); let worst = 0, wz = 0, maxN = 0;
    for (let z = -50; z <= 1200; z += .25) {
      const x = z > 450 && z < 560 ? -30 : 0, n = L.selectLamps(I, x, z, K, out), now = new Map(); maxN = Math.max(maxN, n);
      for (let a = 0; a < n; a++) now.set(out[a].i, out[a].f);
      for (const id of new Set([...prev.keys(), ...now.keys()])) { const d = Math.abs((now.get(id) || 0) - (prev.get(id) || 0)); if (d > worst && z > -50 && !(z > 449 && z < 451) && !(z > 559 && z < 561)) { worst = d; wz = z; } }
      prev.clear(); for (const [k, v] of now) prev.set(k, v);
      if (n) { let best = 0; for (let a = 1; a < n; a++) if (out[a].q < out[best].q) best = a; if (z > 0 && z < 1000 && out[best].q < 15 && out[best].f < .95 && K >= 4) { bad(`K=${K}: the nearest lamp at z=${z} is only at ${out[best].f.toFixed(2)}`); break; } }
    }
    info.push(`K=${K}: largest fade step per 25 cm ${worst.toFixed(3)} (at z ${wz})`);
    if (worst > .1) bad(`K=${K}: a lamp's light jumps by ${worst.toFixed(2)} in 25 cm at z=${wz} (popping)`);
    if (maxN > K) bad(`K=${K}: ${maxN} lamps lit`);
  }
  // under a lamp: it is lit; 500 m from everything: nothing
  const out = [];
  let n = L.selectLamps(I, -6, 280, 4, out); if (!n || list[out[0].i].z !== 280) bad('the lamp right over the player is not the first lit');
  n = L.selectLamps(I, 3000, 3000, 4, out); if (n) bad(`${n} lamps lit 3 km from any lamp`);
  // bounce numbers
  const l = list[0]; if (Math.abs(L.bounceI(l) - 2 * L.lampI(l) * L.LAMPK.bounce) > 1e-9) bad('bounce intensity is not 2 I (x albedo in the glue)');
  if (!(L.bounceDepth(l) >= 1.5 && L.bounceDepth(l) <= 5)) bad(`bounce depth ${L.bounceDepth(l)}`);
  if (Math.abs(L.lampI(l) / (7.4 * 7.4) - L.LAMPK.E0) > 1e-9) bad('a lamp does not give E0 on the ground under it');
  const hb = L.headBounceI(900, .42); if (!(hb > 100 && hb < 400)) bad(`headlight bounce intensity ${hb.toFixed(0)}`);
  // allocation-free once warm: the out entries are reused
  const o2 = []; L.selectLamps(I, 0, 100, 4, o2); const a0 = o2[0]; L.selectLamps(I, 0, 130, 4, o2); if (o2[0] !== a0) bad('selectLamps makes new output objects every call');
  return { problems: P, info };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = lampTests(); if (verbose) r.info.forEach(l => console.log('  ' + l));
  r.problems.forEach(p => console.log('FAIL  ' + p)); console.log(r.problems.length ? `lamps: ${r.problems.length} problem(s)` : 'lamps: ok'); process.exit(r.problems.length ? 1 : 0);
}
