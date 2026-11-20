#!/usr/bin/env node
// Headless checks of Ilalim's baked light (js/cavebake.js on data/cave.json + js/under.js; drawn by js/underfig.js). No browser.
//   node tools/cavebake.mjs [-v]     (also part of tools/test.mjs)
// Fails on: the bake taking too long for the first trip down (it runs under the black veil), the visibility ray letting light through
// rock or blocking open air, a lamp not lighting the floor under it / the ceiling over it, light leaking to a far chamber, the bounce
// not adding light, the daylight layer reaching where no daylight emitter is, probes not pointing at the lamp next to them, or the
// bake not being deterministic.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), J = rel => pathToFileURL(path.join(ROOT, rel)).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(J('vendor/three/build/three.core.js'))}, shortCircuit: true } : n(s, c); }`));
await import('./lib/headless.mjs'); // browser globals the game modules expect
const { makeUnder } = await import(J('js/under.js'));
const CB = await import(J('js/cavebake.js'));
const { evalSH } = await import(J('js/probes.js'));
const { Vector3 } = await import(J('vendor/three/build/three.core.js'));
const verbose = process.argv.includes('-v');

export function caveBakeTests() {
  const P = [], bad = m => P.push('CAVEBAKE ' + m), info = [];
  const U = makeUnder(JSON.parse(readFileSync(path.join(ROOT, 'data/cave.json'), 'utf8'))), G = CB.caveGrid(U), byId = id => U.C.find(c => c.id === id);
  const alb = (k, ceil, o) => { o[0] = o[1] = o[2] = .4; return o; };
  const ent = byId('entry'), far = byId('lake'), W = c => ({ x: U.ox + c.x, z: U.oz + c.z });
  const lamp = { ...W(ent), y: U.floorL(ent.x, ent.z) + 2.4, c: [1, .78, .45], I: 40, R: 20, layer: 0 };
  const day = { x: U.ox + U.mouth.x, z: U.oz + U.mouth.z, y: U.floorL(U.mouth.x, U.mouth.z) + 3, c: [1, 1, .95], I: 300, R: 40, layer: 1 };
  const t0 = Date.now(), B = CB.bakeCave(G, [lamp, day], alb, { U }), ms = Date.now() - t0;
  info.push(`bake ${ms} ms, ${G.NX}x${G.NZ} cells, ${B.probes.count} probes`);
  if (ms > 4000) bad(`bake takes ${ms} ms (it runs once on the way down, under the veil: keep it short)`);
  const cell = (lx, lz) => Math.round((lz - G.z0) / G.st) * G.NX + Math.round((lx - G.x0) / G.st), lum = (A, k) => A[k * 3] + A[k * 3 + 1] + A[k * 3 + 2];
  const kE = cell(ent.x, ent.z), kF = cell(far.x, far.z);
  if (!(lum(B.F[0], kE) > 1)) bad(`the floor under the lamp gets ${lum(B.F[0], kE).toFixed(2)} (expected > 1)`);
  if (!(lum(B.C[0], kE) > .3)) bad(`the ceiling over the lamp gets ${lum(B.C[0], kE).toFixed(2)}`);
  if (lum(B.F[0], kF) > 1e-6 || lum(B.C[0], kF) > 1e-6) bad(`lamp light reaches the lake chamber, ${far.r} m radius, far away`);
  if (lum(B.F[1], kE) > 1e-6 && Math.hypot(ent.x - U.mouth.x, ent.z - U.mouth.z) > 45) bad('daylight layer reaches the entry chamber');
  if (!(lum(B.F[1], cell(U.mouth.x, U.mouth.z)) > .5)) bad('the mouth floor gets no daylight');
  // visibility: through open air inside a chamber yes, across the rock between two chambers no
  const clearT = CB._clear;
  if (clearT) {
    const yE = U.floorL(ent.x, ent.z) + 2, yF = U.floorL(far.x, far.z) + 2;
    if (!clearT(G, ent.x - 3, yE, ent.z, ent.x + 3, yE, ent.z, .1)) bad('a ray across the open entry chamber is blocked');
    if (clearT(G, ent.x, yE, ent.z, far.x, yF, far.z, .1)) bad('a ray from the entry chamber straight to the lake goes through the rock');
  }
  // bounce adds light: a bake with bounce 0 is darker on the ceiling
  const kb = CB.CAVEK.bounce; CB.CAVEK.bounce = 0; const B0 = CB.bakeCave(G, [lamp], alb, { probes: false }); CB.CAVEK.bounce = kb;
  if (!(lum(B.C[0], kE) > lum(B0.C[0], kE) * 1.02)) bad('the bounce adds nothing to the ceiling over the lamp');
  // probes: next to the lamp, a surface facing it gets more than one facing away
  const pr = new Vector3(), V = new Vector3(), g = B.probes.g0, pos = new Vector3(lamp.x + 3, U.floorL(ent.x + 3, ent.z) + 1, lamp.z);
  g.sampleAt(pos, g.sample); const s = g.sample, to = evalSH(s, -1, 0, 0, V).x, away = evalSH(s, 1, 0, 0, pr).x;
  info.push(`probe beside the lamp: toward ${to.toFixed(3)}, away ${away.toFixed(3)}`);
  if (!(to > .02) || !(to > away * 1.3)) bad(`the probe beside the lamp does not point at it (toward ${to.toFixed(3)}, away ${away.toFixed(3)})`);
  // prop light: next to the lamp > 0, at the lake 0
  const o = new Float32Array(6); B.at(lamp.x + 2, lamp.y - 1, lamp.z, o); if (!(o[0] > .1)) bad(`a prop next to the lamp gets ${o[0].toFixed(3)}`);
  B.at(U.ox + far.x, U.floorL(far.x, far.z) + 1, U.oz + far.z, o); if (o[0] + o[1] + o[2] > 1e-6) bad('a prop in the lake chamber gets lamp light');
  // deterministic
  const B2 = CB.bakeCave(G, [lamp, day], alb, { probes: false }); for (let k = 0; k < B.F[0].length; k += 97) if (B2.F[0][k] !== B.F[0][k] || B2.C[1][k] !== B.C[1][k]) { bad('two bakes differ'); break; }
  return { problems: P, info };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = caveBakeTests(); if (verbose) r.info.forEach(l => console.log('  ' + l));
  r.problems.forEach(p => console.log('FAIL  ' + p)); console.log(r.problems.length ? `cavebake: ${r.problems.length} problem(s)` : `cavebake: ok (${r.info[0]})`); process.exit(r.problems.length ? 1 : 0);
}
