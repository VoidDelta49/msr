#!/usr/bin/env node
// Road junction check: "are the only bumps in the road the intentional ones?"
//   node tools/roads.mjs [-v] [map.json]     (default data/map/island.json; -v lists every junction and the hairpin report)
// Runs the game's REAL js/roads.js on the map, with the REAL terrain (the block between the @terrain markers in js/world.js), and fails when
//   SEAM       a closed road does not close exactly (first height != last height)
//   OVERLAP    two road surfaces overlap but disagree on the height there (the old step at crossings / branches, up to 0.5 m)
//   GRADE      a road is steeper than its own grade limit (levelling a junction must not create a ramp)
//   STEP       the ground height jumps between two points 25 cm apart that belong to different roads (intentional speed bumps excluded)
// Also reports (not a failure): grade along the INNER edge of tight hairpins, where the height follows the nearest centre-line point.
// Exit 0 = pass. Used by tools/test.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), verbose = process.argv.includes('-v');
const mapArg = process.argv.slice(2).find(a => a.endsWith('.json'));
globalThis.addEventListener ??= () => { }; // js/util.js touches it at import time
const { PI, clamp, sstep, fbm, rand, hash2 } = await import(pathToFileURL(path.join(ROOT, 'js/util.js')).href);
const { buildRoads } = await import(pathToFileURL(path.join(ROOT, 'js/roads.js')).href);
const MD = JSON.parse(readFileSync(mapArg ? path.resolve(mapArg) : path.join(ROOT, 'data/map/island.json'), 'utf8'));

// terrBase(): the terrain block of world.js, evaluated here (it needs only MD + a few maths helpers)
const src = readFileSync(path.join(ROOT, 'js/world.js'), 'utf8'), b = src.indexOf('// @terrain-begin'), e = src.indexOf('// @terrain-end');
if (b < 0 || e < b) { console.log('FAIL roads: the // @terrain-begin / // @terrain-end markers are missing from js/world.js (tools/roads.mjs needs them)'); process.exit(1); }
const terrBase = new Function('MD', 'PI', 'clamp', 'sstep', 'fbm', 'rand', 'hash2', 'addOBB', src.slice(b, e) + '\nreturn terrBase;')(MD, PI, clamp, sstep, fbm, rand, hash2, () => { });

const { ROADS, nearRoad, roadsAt, BUMPS, JUNCTIONS } = buildRoads(MD, terrBase);
const problems = [], name = r => `r${r.id}${MD.roads[r.id].id ? ' (' + MD.roads[r.id].id + ')' : ''}`;
const f2 = v => v.toFixed(1), f3 = v => v.toFixed(3);
const nearBump = (x, z) => BUMPS.some(k => { const al = k.ax === 'z' ? z - k.z : x - k.x, cr = k.ax === 'z' ? x - k.x : z - k.z; return Math.abs(al) < .8 && Math.abs(cr) < 4.5 });

// SEAM
for (const r of ROADS) if (r.closed && Math.abs(r.s[0].h - r.s[r.s.length - 1].h) > 1e-6) problems.push(`SEAM ${name(r)}: closed road starts at ${f3(r.s[0].h)} m and ends at ${f3(r.s[r.s.length - 1].h)} m`);

// GRADE
for (const r of ROADS) {
  let worst = 0, at = 0; for (let i = 1; i < r.s.length; i++) { const A = r.s[i - 1], B = r.s[i], g = Math.abs(B.h - A.h) / Math.max(1e-6, Math.hypot(B.x - A.x, B.z - A.z)); if (g > worst) { worst = g; at = i } }
  // the original profile is clamped to the grade, but Math.max(h, .05) can lift a sample, so allow 1 cm per sample of slack
  if (worst > r.G * 1.02 + .01 / 2) problems.push(`GRADE ${name(r)}: ${(worst * 100).toFixed(1)}% at (${f2(r.s[at].x)}, ${f2(r.s[at].z)}), limit ${(r.G * 100).toFixed(0)}%`);
}

// OVERLAP + STEP: walk every road's surface (lateral offsets inside the strip)
let overlaps = 0, worstOv = { d: 0 }, stepHits = [];
const D = .25;
for (const r of ROADS) for (let i = 0; i < r.s.length; i++) {
  const s = r.s[i], nx = -s.tz, nz = s.tx;
  for (let o = -r.w / 2 + .3; o <= r.w / 2 - .3 + 1e-6; o += .5) {
    const x = s.x + nx * o, z = s.z + nz * o, list = roadsAt(x, z);
    if (list.length > 1) { overlaps++; const hs = list.map(q => q.h), d = Math.max(...hs) - Math.min(...hs); if (d > worstOv.d) worstOv = { d, x, z, ids: list.map(q => q.id) } }
    if (nearBump(x, z)) continue;
    const q0 = nearRoad(x, z); if (!q0 || q0.d >= q0.w / 2) continue; const id0 = q0.i, h0 = q0.h;
    for (const [dx, dz] of [[D, 0], [0, D], [D, D], [D, -D]]) {
      const x2 = x + dx, z2 = z + dz, q1 = nearRoad(x2, z2); if (!q1 || q1.d >= q1.w / 2 || nearBump(x2, z2)) continue;
      const dh = Math.abs(q1.h - h0), gap = Math.hypot(dx, dz);
      if (q1.i !== id0 && dh > .02 + .13 * gap) stepHits.push({ x, z, dh, ids: [id0, q1.i] });
    }
  }
}
if (worstOv.d > .012) problems.push(`OVERLAP surfaces of ${worstOv.ids.map(i => name(ROADS[i])).join(' and ')} differ by ${f3(worstOv.d)} m at (${f2(worstOv.x)}, ${f2(worstOv.z)})`);
if (stepHits.length) {
  stepHits.sort((a, b) => b.dh - a.dh); const w = stepHits[0], spots = new Set(stepHits.map(h => Math.round(h.x / 10) + ',' + Math.round(h.z / 10))).size;
  problems.push(`STEP ${stepHits.length} points in ${spots} spots where neighbouring road points 25 cm apart differ by more than a grade allows; worst ${f3(w.dh)} m between ${w.ids.map(i => name(ROADS[i])).join(' and ')} at (${f2(w.x)}, ${f2(w.z)})`);
}

// report: hairpin inner edge (same road, informational)
let hair = 0; for (const r of ROADS) for (let i = 0; i < r.s.length; i++) { const s = r.s[i], nx = -s.tz, nz = s.tx; for (const o of [-r.w / 2 + .6, r.w / 2 - .6]) { const x = s.x + nx * o, z = s.z + nz * o, q0 = nearRoad(x, z); if (!q0 || q0.d >= q0.w / 2 || nearBump(x, z)) continue; const q1 = nearRoad(x + D, z); if (q1 && q1.d < q1.w / 2 && q1.i === q0.i && Math.abs(q1.h - q0.h) / D > .3) hair++ } }

if (verbose) {
  console.log(`junctions (${JUNCTIONS.length}):`);
  for (const j of JUNCTIONS) console.log(`  (${f2(j.x)}, ${f2(j.z)}) level ${f3(j.h0)} m, set by ${name(ROADS[j.primary])}; ` + j.members.map(m => `${name(ROADS[m.road])} ${m.len} samples, blend ${m.T.map(x => x ? x + ' m' : 'grade ramp').join(' / ')}`).join('; '));
}
console.log(`roads: ${ROADS.length} roads, ${JUNCTIONS.length} junctions levelled, ${overlaps} overlap points checked, worst overlap mismatch ${f3(worstOv.d)} m` + (hair ? `; info: ${hair} samples on the inner edge of tight hairpins climb over 30% (one road, not a junction)` : ''));
for (const p of problems) console.log('FAIL ' + p);
process.exit(problems.length ? 1 : 0);
