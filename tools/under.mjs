#!/usr/bin/env node
// Headless checks of Ilalim, the underground cave system (data/cave.json + js/under.js). No browser, no three.js.
//   node tools/under.mjs [-v]     (also part of tools/test.mjs)
// Fails on: a tunnel steeper than 16 % along its middle; less than 3 m of headroom anywhere open; a chamber you can't reach from the
// mouth; floor near the sea level (the splash check); the system overlapping the island's terrain grid; portals that don't work
// (going in at the cave hall's dark passage, coming back out at the mouth, and not landing straight back in a trigger); no walls; a
// walker who gets through a wall in two minutes of random walking (foot.js against the OBB walls on the real floor).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/headless.mjs';
const J = rel => pathToFileURL(path.join(ROOT, rel)).href, verbose = process.argv.includes('-v');
const rdj = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const { makeUnder } = await import(J('js/under.js'));
const { F, footEnv, footStep } = await import(J('js/foot.js'));
const { terrainOf } = await import('./lib/ground.mjs');

export function underTests() {
  const P = [], bad = m => P.push('UNDER ' + m), info = [];
  const D = rdj('data/cave.json'), MAP = rdj('data/map/island.json'), U = makeUnder(D), SEA = MAP.sea;
  const hall = (MAP.buildings || []).find(b => b[0] === 'cave'); if (!hall) bad('the map has no cave hall (building "cave") for the portal');
  else U.setHall(hall[1], hall[2], hall[3] || 0, hall[4] || 56, hall[5] || 44);
  // grade along every tunnel's middle line (skipping 3 m at each end, where it opens into the chamber)
  for (const t of U.T) {
    let worst = 0, prev = null; const n = Math.ceil(t.L);
    for (let i = 0; i <= n; i++) {
      const s = i / n * t.L, f = s < t.l1 ? s / t.l1 : (s - t.l1) / (t.L - t.l1), x = s < t.l1 ? t.A.x + (t.mx - t.A.x) * f : t.mx + (t.B.x - t.mx) * f, z = s < t.l1 ? t.A.z + (t.mz - t.A.z) * f : t.mz + (t.B.z - t.mz) * f;
      if (s < t.A.r * .8 || s > t.L - t.B.r * .8) { prev = null; continue; }
      const y = U.floorL(x, z); if (prev) worst = Math.max(worst, Math.abs(y - prev.y) / Math.hypot(x - prev.x, z - prev.z)); prev = { x, z, y };
    }
    if (worst > .16) bad(`tunnel ${t.A.id}-${t.B.id}: ${(worst * 100).toFixed(0)} % steep`); info.push(`${t.A.id}-${t.B.id} ${t.L.toFixed(0)} m, max ${(worst * 100).toFixed(0)} %`);
  }
  // headroom, sea, open cells (flood fill from the mouth)
  const B = U.BOX, st = 2, NX = Math.ceil((B.x1 - B.x0) / st), NZ = Math.ceil((B.z1 - B.z0) / st), open = new Uint8Array(NX * NZ); let lowRoom = null, lowFloor = 1e9, area = 0;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = B.x0 + i * st, z = B.z0 + j * st, r = U.sampleL(x, z), e = r.e; if (e < 1.5) continue;
    const rr = { ...r }, f = U.floorL(x, z, rr), c = U.ceilL(x, z, rr); open[j * NX + i] = 1; area += st * st; lowFloor = Math.min(lowFloor, f);
    if (c - f < 3 && (!lowRoom || c - f < lowRoom.h)) lowRoom = { x, z, h: c - f };
  }
  if (lowRoom) bad(`only ${lowRoom.h.toFixed(1)} m of headroom at local (${lowRoom.x.toFixed(0)}, ${lowRoom.z.toFixed(0)})`);
  if (lowFloor < SEA + 3) bad(`floor down at ${lowFloor.toFixed(1)} m: H() below the sea level + 0.12 is "rode into the water"`);
  const cell = (x, z) => Math.round((z - B.z0) / st) * NX + Math.round((x - B.x0) / st), seen = new Uint8Array(NX * NZ), q = [cell(U.mouth.x, U.mouth.z)]; seen[q[0]] = 1;
  while (q.length) { const k = q.pop(), i = k % NX, j = (k / NX) | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue; const kk = jj * NX + ii; if (open[kk] && !seen[kk]) { seen[kk] = 1; q.push(kk); } } }
  for (const c of U.C) if (!seen[cell(c.x, c.z)]) bad(`chamber ${c.id} can't be reached from the mouth`);
  // off the island: the system's box must not overlap the terrain grid (there H() is the island's ground)
  const TB = terrainOf(MAP), g0x = TB.GX - TB.TSZ / 2, g1x = TB.GX + TB.TSZ / 2, g0z = TB.GZ - TB.TSZ / 2, g1z = TB.GZ + TB.TSZ / 2;
  if (U.ox + B.x1 > g0x && U.ox + B.x0 < g1x && U.oz + B.z1 > g0z && U.oz + B.z0 < g1z) bad(`the system (${(U.ox + B.x0) | 0}..${(U.ox + B.x1) | 0}, ${(U.oz + B.z0) | 0}..${(U.oz + B.z1) | 0}) overlaps the island's terrain grid: move 'origin'`);
  // portals
  if (U.hall) {
    const p = U.portal, fx = U.hall.ax.x, fz = U.hall.ax.z, f = U.hall.at(p.a - 2, p.d);
    if (!U.enterAt(f.x, f.z, fx, fz, false)) bad('riding into the dark passage does not take you down');
    if (U.enterAt(f.x, f.z, -fx, -fz, false)) bad('riding AWAY from the dark passage takes you down');
    const o = U.outPos(); if (U.enterAt(o.x, o.z, -Math.sin(o.psi), -Math.cos(o.psi), true)) bad('coming back up puts you straight back in the passage trigger');
    const i = U.inPos(); if (U.exitAt(i.x, i.z, -Math.sin(i.psi), -Math.cos(i.psi), true)) bad('arriving below puts you straight in the way-out trigger');
    const m = U.mouth, w = { x: U.ox + m.x + U.outDir.x * m.r * .7, z: U.oz + m.z + U.outDir.z * m.r * .7 };
    if (!U.exitAt(w.x, w.z, U.outDir.x, U.outDir.z, false)) bad('riding up the mouth to the daylight does not bring you back out');
    if (U.sample(i.x, i.z).e < 2) bad('you arrive below inside a wall');
    const hs = U.shelter(hall[1], hall[2]); if (!(hs > .3)) bad(`the middle of the cave hall is not sheltered (${hs.toFixed(2)})`);
  }
  // walls + a walker
  const W = U.walls(); if (W.length < 200) bad(`only ${W.length} wall boxes`);
  const OB = W.map(([cx, cz, hx, hz, ry, y]) => ({ cx, cz, hx, hz, ry, c: Math.cos(ry), s: -Math.sin(ry), y }));
  footEnv({ H: U.floor, SEA, OBBS: OB, noBike: true }); const i0 = U.inPos(); let escaped = null, seed = 7; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  Object.assign(F, { on: true, x: i0.x, z: i0.z, y: U.floor(i0.x, i0.z), vx: 0, vy: 0, vz: 0, psi: i0.psi, cy: i0.psi, gnd: true, spd: 0, t: 0, rs: 0, cp: .25, bp: 0, ba: 0, dip: 0, dv: 0, coy: 0, jb: 0, land: 0 });
  let mx = 0, mz = 1, far = 0;
  for (let k = 0; k < 120 * 60; k++) {
    if (k % 90 === 0) { const a = rnd() * 6.28; mx = Math.sin(a); mz = Math.cos(a); }
    footStep({ mx, mz, run: rnd() < .5 }, 1 / 60); const e = U.sample(F.x, F.z).e; far = Math.max(far, Math.hypot(F.x - i0.x, F.z - i0.z));
    if (e < -.4 && !escaped) escaped = { x: F.x - U.ox, z: F.z - U.oz, e };
  }
  if (escaped) bad(`a walker got into the rock at local (${escaped.x.toFixed(1)}, ${escaped.z.toFixed(1)}), e ${escaped.e.toFixed(2)}`);
  if (far < 15) bad(`the random walker only got ${far.toFixed(0)} m from the mouth (stuck?)`);
  if (verbose) { console.log(info.join('\n')); console.log(`open ${(area / 1e4).toFixed(2)} ha, ${W.length} wall boxes, walker reached ${far.toFixed(0)} m`); }
  return { problems: P, summary: `${U.C.length} chambers, ${U.T.length} tunnels, ${(area / 1e4).toFixed(1)} ha open, ${W.length} wall boxes` };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = underTests(); for (const p of r.problems) console.log('FAIL ' + p);
  console.log(r.problems.length ? '' : 'under: ok (' + r.summary + ')'); process.exit(r.problems.length ? 1 : 0);
}
