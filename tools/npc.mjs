#!/usr/bin/env node
// Headless checks of the pedestrians (js/npc.js brains + js/figlook.js outfits + data/npc.json). No browser, no three.js.
//   node tools/npc.mjs [-v]     (also part of tools/test.mjs)
// Data: every archetype resolves to a full palette (no bad colour, role or part), acts exist, weights sane.
// Synthetic town: people spawn in the ring around you and only on dry, clear ground, never inside walls, stay near the player,
// walk (they actually move), go into and come out of doors, keep apart, dodge a fast bike, get knocked over when clipped,
// walk their dogs (the dog stays within the leash). The ride: a hailing person boards when you stop next to them on a bike
// with a free seat, refuses when busy, gets a drop-off door within the configured range, gets off at it and walks in;
// crashing throws them off; getting off the bike leaves them. Determinism with a seeded rng. A run on the REAL island
// (roads + terrain as tools/roads.mjs builds them) with the time per step.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), J = rel => pathToFileURL(path.join(ROOT, rel)).href, verbose = process.argv.includes('-v');
globalThis.addEventListener ??= () => { };
const { NPC, npcEnv, npcStep, npcClear, poseOf, npcDoors } = await import(J('js/npc.js'));
const { resolveLook, ROLES, PARTS } = await import(J('js/figlook.js'));
const DATA = JSON.parse(readFileSync(path.join(ROOT, 'data/npc.json'), 'utf8'));
const POSES = ['stand', 'walk', 'run', 'phone', 'hail', 'wave', 'chat', 'squat', 'sit', 'stretch', 'sweep', 'look', 'flinch', 'dazed', 'pillion', 'idle']; // js/figure.js POSES (+ idle = stand)

const mul = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const box = (cx, cz, hx, hz, ry = 0) => ({ cx, cz, hx, hz, ry, c: Math.cos(ry), s: -Math.sin(ry) });
function inBox(x, z, b, r) { const dx = x - b.cx, dz = z - b.cz, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c; return Math.abs(lx) < b.hx + r * .5 && Math.abs(lz) < b.hz + r * .5; }

export function npcTests() {
  const P = [], bad = m => P.push('NPC ' + m);
  // ---- data ----
  const archs = Object.entries(DATA.archetypes || {}); if (archs.length < 4) bad('data: fewer than 4 archetypes');
  for (const k of ['sando', 'dogwalker', 'student']) if (!DATA.archetypes[k]) bad('data: archetype ' + k + ' missing');
  for (const k of ['density', 'pool', 'range', 'ride', 'palettes', 'acts', 'dog', 'lines']) if (!DATA[k]) bad('data: top-level ' + k + ' missing');
  for (const [id, A] of archs) {
    const err = []; for (let i = 0; i < 40; i++) { const L = resolveLook(A, DATA.palettes, mul(i + 1), err); if (L.pal.length !== 16 || L.pal.some(v => !Number.isInteger(v) || v < 0 || v > 0xffffff)) err.push('palette has a bad entry'); }
    for (const e of new Set(err)) bad(`data ${id}: ${e}`);
    if (!(A.w > 0)) bad(`data ${id}: weight w must be > 0`);
    for (const k of ['speed', 'h', 'wd']) if (A[k] && !(A[k][0] > 0 && A[k][1] >= A[k][0])) bad(`data ${id}: ${k} should be [min, max] > 0`);
    for (const a of Object.keys(A.acts || {})) { if (!DATA.acts[a]) bad(`data ${id}: act ${a} is not in acts`); if (!POSES.includes(a)) bad(`data ${id}: act ${a} has no pose in figure.js`); }
    if (!A.names || !A.names.length) bad(`data ${id}: no names`);
    if (A.pet && A.pet !== 'dog') bad(`data ${id}: pet ${A.pet} unknown`);
  }
  for (const [a, v] of Object.entries(DATA.acts)) if (!(v.dur && v.dur[1] >= v.dur[0] && v.dur[0] > 0)) bad(`data act ${a}: dur should be [min, max]`);
  for (const p of Object.values(DATA.acts)) for (const q of p.parts || []) if (!PARTS.includes(q)) bad('data act part ' + q + ' unknown');
  const r = DATA.ride; if (!(r.distMax > r.distMin && r.reach > 1 && r.stopR > 2)) bad('data ride: distMin < distMax, reach > 1, stopR > 2');

  // ---- synthetic town: flat island (sea beyond 450 m), a cross of roads, houses with front doors along them ----
  const SEA = -1, H = (x, z) => Math.hypot(x, z) > 450 ? -5 : 0;
  const line = (x0, z0, x1, z1, w, extra = {}) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.5), s = []; for (let i = 0; i <= n; i++) s.push({ x: x0 + (x1 - x0) * i / n, z: z0 + (z1 - z0) * i / n, h: 0 }); return { s, w, ...extra }; };
  const ROADS = [line(-400, 0, 400, 0, 7), line(0, -400, 0, 400, 7), line(-300, 120, 300, 120, 6), line(-300, -120, 300, -120, 6), line(-200, 300, 200, 300, 12, { kind: 'strip' })];
  const OBBS = [], DOORS = [];
  for (let x = -280; x <= 280; x += 14) for (const [z, f] of [[129, -1], [-129, 1], [111, 1], [-111, -1]]) { // houses facing the roads at z = +-120
    if (Math.abs(x) < 10) continue; const b = box(x, z, 4, 4); OBBS.push(b); DOORS.push({ x, z: z + f * 5.2, ix: x, iz: z + f * 3.4, t: 'house', n: 'a house' });
  }
  OBBS.push(box(30, 6.2, 3, .4)); // a wall right on the sidewalk
  const W = (x, z, extra = {}) => ({ x, z, cap: 24, night: false, cam: null, bike: { x: x + 500, z, psi: 0, v: 0, crashed: false, seat: true, busy: '' }, foot: { on: false }, ...extra });
  npcEnv({ H, SEA, OBBS, ROADS, DOORS, data: DATA, rand: mul(7) });
  if (!NPC.ready) bad('npcEnv did not get ready'); if (!(NPC.sp > 100)) bad(`only ${NPC.sp} spawn spots in the synthetic town`); if (npcDoors().length !== DOORS.length) bad(`doors kept ${npcDoors().length} of ${DOORS.length}`);
  const run = (sec, w, dt = 1 / 30, f) => { for (let i = 0; i < sec / dt; i++) { if (f) f(i * dt); npcStep(dt, w); } };
  // fill and wander: everyone on dry ground, outside walls, within range; people really move; the pool is respected
  const w0 = W(0, 60); run(20, w0); let moved = 0; const start = new Map(NPC.list.map(a => [a, [a.x, a.z]]));
  if (NPC.list.length < 12) bad(`only ${NPC.list.length} people after 20 s (cap 24)`); if (NPC.list.length > 26) bad(`${NPC.list.length} people for a cap of 24`);
  run(20, w0, 1 / 30, () => { for (const a of NPC.list) { if (a.st === 'enter' || a.st === 'exit') continue; for (const b of OBBS) if (inBox(a.x, a.z, b, .28)) { bad(`${a.arch} ${a.id} inside a wall at ${a.x.toFixed(1)},${a.z.toFixed(1)} (${a.st})`); return; } if (H(a.x, a.z) < SEA) { bad(`${a.arch} in the sea`); return; } if (!Number.isFinite(a.x + a.z + a.psi + a.y)) { bad('non-finite position'); return; } } });
  for (const a of NPC.list) { const s = start.get(a); if (s && Math.hypot(a.x - s[0], a.z - s[1]) > 5) moved++; }
  if (moved < 3) bad(`only ${moved} people walked more than 5 m in 20 s`);
  for (const a of NPC.list) if (Math.hypot(a.x - w0.x, a.z - w0.z) > DATA.range.despawn * 1.35) bad(`${a.arch} ${a.id} stayed ${Math.hypot(a.x - w0.x, a.z - w0.z).toFixed(0)} m away`);
  const kinds = new Set(NPC.list.map(a => a.st)); if (verbose) console.log('states seen:', [...kinds].join(' '), '· archetypes:', [...new Set(NPC.list.map(a => a.arch))].join(' '));
  for (const a of NPC.list) { const p = poseOf(a); if (p && !POSES.includes(p)) bad(`pose ${p} (${a.st}) has no figure pose`); }
  // over a longer run: doors used both ways, chats and dogs happen, everybody keeps apart
  let entered = 0, exited = 0, chats = 0, dogFar = 0, close = 0; const seenExit = new Set();
  run(120, w0, 1 / 30, () => {
    for (const a of NPC.list) { if (a.st === 'enter') entered++; if (a.st === 'exit' && !seenExit.has(a.id)) { seenExit.add(a.id); exited++; } if (a.act === 'chat') chats++; if (a.dog && Math.hypot(a.dog.x - a.x, a.dog.z - a.z) > 3.2 * a.sx + .2) dogFar++; }
    for (let i = 0; i < NPC.list.length; i++) for (let j = i + 1; j < NPC.list.length; j++) { const a = NPC.list[i], b = NPC.list[j]; if (a.dist < 30 && b.dist < 30 && a.st !== 'ride' && b.st !== 'ride' && Math.hypot(a.x - b.x, a.z - b.z) < .25) close++; }
  });
  if (!entered) bad('nobody went into a building in 2 minutes'); if (!exited) bad('nobody came out of a building in 2 minutes'); if (!chats) bad('nobody chatted in 2 minutes');
  if (dogFar) bad(`a dog was off the leash ${dogFar} times`); if (close > 60) bad(`people overlapped ${close} times`);
  if (verbose) console.log(`doors: in ${entered} frames, out ${exited} people · chat frames ${chats} · overlap ${close}`);
  // determinism: same seed, same everything
  const snap = () => NPC.list.map(a => a.arch + a.x.toFixed(4) + a.z.toFixed(4) + a.st).join('|');
  npcEnv({ H, SEA, OBBS, ROADS, DOORS, data: DATA, rand: mul(3) }); run(15, W(0, 60)); const s1 = snap();
  npcEnv({ H, SEA, OBBS, ROADS, DOORS, data: DATA, rand: mul(3) }); run(15, W(0, 60)); if (snap() !== s1) bad('not deterministic with the same seed');
  // moving away: the crowd follows you (old ones dropped, new ones around the new spot)
  run(10, W(250, 0)); if (NPC.list.some(a => Math.hypot(a.x - 250, a.z) > DATA.range.despawn * 1.35)) bad('people far behind were not removed'); if (NPC.list.length < 8) bad('the crowd did not refill at the new spot');
  // ---- the bike: dodge, bump ----
  npcClear(); npcEnv({ H, SEA, OBBS, ROADS, DOORS, data: DATA, rand: mul(11) }); run(3, W(0, 60));
  const a = NPC.list.find(x => !x.dog && !x.hail) || NPC.list[0]; Object.assign(a, { x: 0, z: 40, st: 'act', act: 'idle', t: 0, dur: 99, dist: 5, mate: null });
  const wb = W(0, 60, { bike: { x: 0, z: 46, psi: 0, v: 9, crashed: false, seat: true, busy: '' } }); // coming at them along -z
  npcStep(1 / 30, wb); if (a.st !== 'dodge') bad(`did not dodge a bike at 9 m/s 6 m away (state ${a.st})`);
  run(.8, wb); if (Math.abs(a.x) < .6) bad(`dodged only to x = ${a.x.toFixed(2)}`);
  Object.assign(a, { x: 0, z: 40, st: 'act', act: 'idle', t: 0, dur: 99, bumpT: 0 }); NPC.ev.length = 0; npcStep(1 / 30, W(0, 60, { bike: { x: 0, z: 40.3, psi: 0, v: 6, crashed: false, seat: true, busy: '' } }));
  if (a.st !== 'fall' || !NPC.ev.some(e => e.k === 'bump')) bad(`clipped at 6 m/s but state ${a.st}, no bump event`);
  // ---- the ride ----
  npcClear(); npcEnv({ H, SEA, OBBS, ROADS, DOORS, data: DATA, rand: mul(5) }); run(1, W(0, 60));
  const h = NPC.list.find(x => !x.dog), hid = h.id; Object.assign(h, { x: 20, z: 4.6, y: 0, st: 'hail', hail: true, seen: false, wt: 0, dist: 3, mate: null }); NPC.ev.length = 0;
  const bk = { x: 20, z: 2, psi: Math.PI / 2, v: 0, crashed: false, seat: true, busy: 'Finish your job first' }, wr = W(20, 2, { bike: bk });
  run(2, wr); if (h.st !== 'hail') bad(`boarded a busy bike (${h.st})`); if (!NPC.ev.some(e => e.k === 'busy')) bad('no busy event'); if (!NPC.ev.some(e => e.k === 'hail')) bad('no hail event when you came close');
  bk.busy = ''; NPC.ev.length = 0; run(4, wr); if (h.st !== 'ride' || !NPC.ride) bad(`did not board after 4 s stopped next to them (state ${h.st})`);
  else {
    const R = NPC.ride, d0 = Math.hypot(R.door.x - bk.x, R.door.z - bk.z); if (d0 < DATA.ride.distMin * .9 || d0 > DATA.ride.distMax * 1.5) bad(`drop-off ${d0.toFixed(0)} m away`);
    if (!NPC.ev.some(e => e.k === 'board' && e.door)) bad('no board event with the door');
    // ride there: the passenger stays aboard while moving, gets off at the door, walks in, and is gone
    bk.v = 10; for (let i = 0; i < 30; i++) { bk.x += (R.door.x - bk.x) * .05; bk.z += (R.door.z - bk.z) * .05; npcStep(1 / 30, { ...wr, x: bk.x, z: bk.z }); }
    if (h.st !== 'ride') bad('passenger got off while riding');
    bk.x = R.door.x + 3; bk.z = R.door.z; bk.v = 0; NPC.ev.length = 0; run(.2, { ...wr, x: bk.x, z: bk.z });
    const ev = NPC.ev.find(e => e.k === 'arrive'); if (!ev) bad('no arrive event when stopped at the door'); else if (!(ev.fare >= DATA.ride.fareBase)) bad('fare ' + ev.fare);
    if (NPC.ride) bad('still riding after arriving'); run(8, { ...wr, x: bk.x, z: bk.z }); if (NPC.list.some(x => x.id === hid)) bad(`passenger did not go in (state ${h.st} ${h.x.toFixed(1)},${h.z.toFixed(1)})`);
  }
  // crash: thrown off; get off the bike: they leave
  for (const how of ['crash', 'foot']) {
    npcClear(); npcEnv({ H, SEA, OBBS, ROADS, DOORS, data: DATA, rand: mul(9) }); run(1, W(0, 60));
    const g = NPC.list.find(x => !x.dog); Object.assign(g, { x: -20, z: 4.6, st: 'hail', hail: true, wt: 0, dist: 3 }); const b2 = { x: -20, z: 2, psi: 0, v: 0, crashed: false, seat: true, busy: '' }, w2 = W(-20, 2, { bike: b2 });
    run(4, w2); if (g.st !== 'ride') { bad(`(${how}) did not board`); continue; } NPC.ev.length = 0;
    if (how === 'crash') b2.crashed = true; else w2.foot = { on: true, x: -21, z: 2 };
    run(.3, w2); if (NPC.ride || g.st === 'ride') bad(`(${how}) passenger still aboard`); if (!NPC.ev.some(e => e.k === (how === 'crash' ? 'thrown' : 'left'))) bad(`(${how}) no event`);
  }

  // ---- the real island (roads + terrain as tools/roads.mjs builds them; no walls, doors along the roads) ----
  try {
    const util = { addEventListener() { } }; void util;
    const { PI, clamp, sstep, fbm, rand, hash2 } = awaitImports.util, { buildRoads } = awaitImports.roads, MD = JSON.parse(readFileSync(path.join(ROOT, 'data/map/island.json'), 'utf8'));
    const src = readFileSync(path.join(ROOT, 'js/world.js'), 'utf8'), b = src.indexOf('// @terrain-begin'), e = src.indexOf('// @terrain-end');
    const TB = new Function('MD', 'PI', 'clamp', 'sstep', 'fbm', 'rand', 'hash2', 'addOBB', src.slice(b, e) + '\nreturn { terrBase, terr };')(MD, PI, clamp, sstep, fbm, rand, hash2, () => { });
    const { ROADS: RR, nearRoad } = buildRoads(MD, TB.terrBase), HR = (x, z) => { const q = nearRoad(x, z); return q && q.d < q.w / 2 ? q.h : TB.terr(x, z); };
    const rg = mul(21), DR = []; for (const r of RR) { if (r.kind === 'strip') continue; for (let i = 5; i < r.s.length - 5; i += 40) { const s = r.s[i], t = r.s[i + 1], l = Math.hypot(t.x - s.x, t.z - s.z) || 1, nx = -(t.z - s.z) / l, nz = (t.x - s.x) / l, sd = rg() < .5 ? -1 : 1, o = r.w / 2 + 6; DR.push({ x: s.x + nx * sd * o, z: s.z + nz * sd * o, ix: s.x + nx * sd * (o + 2), iz: s.z + nz * sd * (o + 2), t: 'house', n: 'a house' }); } }
    const t0 = performance.now(); npcEnv({ H: HR, SEA: MD.sea, OBBS: [], ROADS: RR, DOORS: DR, data: DATA, rand: mul(1) }); const tEnv = performance.now() - t0;
    if (NPC.sp < 1000) bad(`real island: only ${NPC.sp} spawn spots`);
    const spots = [[40, 40], [118, 28], [-40, 40]]; for (let k = 0; k < 3; k++) { const r = RR[(rg() * RR.length) | 0], s = r.s[(rg() * r.s.length) | 0]; if (r.kind !== 'strip') spots.push([s.x, s.z]); } let steps = 0, tt = 0, worst = 0;
    for (const [x, z] of spots) { npcClear(); const w = W(x, z, { cap: 30 }); run(5, w); const t1 = performance.now(); for (let i = 0; i < 300; i++) { const s = performance.now(); npcStep(1 / 60, w); worst = Math.max(worst, performance.now() - s); } tt += performance.now() - t1; steps += 300;
      if (NPC.list.length < 8) bad(`real island at ${x},${z}: only ${NPC.list.length} people`); for (const a of NPC.list) if (a.st !== 'ride' && HR(a.x, a.z) < MD.sea) bad(`real island: ${a.arch} in the sea at ${a.x.toFixed(0)},${a.z.toFixed(0)}`); }
    if (verbose) console.log(`real island: env ${tEnv.toFixed(0)} ms, ${NPC.sp} spawn spots, ${npcDoors().length} doors · step avg ${(tt / steps).toFixed(3)} ms, worst ${worst.toFixed(2)} ms (30 people)`);
    if (tt / steps > 1) bad(`a step takes ${(tt / steps).toFixed(2)} ms on average (budget 1 ms)`);
  } catch (e) { bad('real island run threw: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' / ')); }
  return P;
}
const awaitImports = { util: await import(J('js/util.js')), roads: await import(J('js/roads.js')) };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const P = npcTests(); for (const p of P) console.log('FAIL ' + p);
  console.log(P.length ? `npc: ${P.length} problem(s)` : 'npc: ok'); process.exit(P.length ? 1 : 0);
}
