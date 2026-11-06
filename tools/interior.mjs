#!/usr/bin/env node
// Headless checks of building interiors, shops, consumables and being drunk. No browser, no three.js.
//   node tools/interior.mjs [-v]     (also part of tools/test.mjs)
// Data: data/interiors.json (interiors on building types the map really has, known props, shops / items / people / poses exist),
// data/shop.json (prices, effects that exist, shops sell real items). Logic: js/shop.js (buy, money, bag, gifts), js/effects.js
// (a ginbilog makes you drunk, it wears off, coffee helps; sober input passes untouched; drunk riding can't be fought: the best possible
// counter-steer still leaves the bike weaving), js/foot.js drunk (you veer off a straight line, slower, no sprint, deterministic),
// js/pool.js (a break scatters the rack, balls stay on the table, energy only goes down, balls get potted, a scratch comes back),
// js/interior.js (the pocket room sits above its building, you appear inside facing in and leave at the door step facing out, a
// minute of random walking never leaves the room, EXIT / ORDER / SHOOT are offered where they should be, the camera stays in the
// room, friends' walkers are found in the right room).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { S, createSim, ROOT } from './lib/headless.mjs';
const J = rel => pathToFileURL(path.join(ROOT, rel)).href, verbose = process.argv.includes('-v');
const rdj = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const { EF, FX, applyFx, effTick, effReset, drunkK, drunkRide, drunkWalk } = await import(J('js/effects.js'));
const { SHOP, shopEnv, buy, use, gift, pay, earn, next, walkup } = await import(J('js/shop.js'));
const { newTable, rack, shoot, poolStep, moving, left, PC } = await import(J('js/pool.js'));
const { IN, interiorEnv, interiorFor, pocket, enterPos, exitPos, interact, camFit, pocketKey, toL, PROPS, POCKET } = await import(J('js/interior.js'));
const { F, footEnv, footStep } = await import(J('js/foot.js'));
const ID = rdj('data/interiors.json'), SD = rdj('data/shop.json'), ND = rdj('data/npc.json'), MAP = rdj('data/map/island.json');
// poses: the keys of POSES in js/figure.js (read as text: figure.js needs three.js)
const FIG = readFileSync(path.join(ROOT, 'js/figure.js'), 'utf8'), PB = FIG.slice(FIG.indexOf('export const POSES'), FIG.indexOf('function set('));
const POSES = [...PB.matchAll(/^\s+(\w+): \(o/gm)].map(m => m[1]);
const WORLD = readFileSync(path.join(ROOT, 'js/world.js'), 'utf8'), DOORT = (WORLD.match(/DOORN=\{([^}]*)\}/) || ['', ''])[1];

export function interiorTests() {
  const P = [], bad = m => P.push('INTERIOR ' + m), mapTypes = new Set((MAP.buildings || []).map(b => b[0]));
  // ---- data ----
  if (!(ID.pocket > 50)) bad('data: pocket height should be well above the island (> 50 m)');
  for (const [id, I] of Object.entries(ID.interiors || {})) {
    for (const t of I.at || []) { if (!DOORT.includes(t + ':')) bad(`${id}: building type ${t} has no front door in world.js (DOORN)`); if (!mapTypes.has(t)) bad(`${id}: no '${t}' building on the island map`); }
    if (!(I.w > 3 && I.d > 3 && I.h > 2.4)) bad(`${id}: room too small`);
    for (const p of I.props || []) { if (!PROPS.includes(p.k)) bad(`${id}: unknown prop ${p.k}`); if (Math.abs(p.x) > I.w / 2 || Math.abs(p.z) > I.d / 2) bad(`${id}: ${p.k} at ${p.x},${p.z} is outside the room`); if (p.k === 'board' && !SD.shops[p.shop]) bad(`${id}: board for unknown shop ${p.shop}`); }
    for (const s of I.shops || []) if (!SD.shops[s.shop]) bad(`${id}: counter sells for unknown shop ${s.shop}`);
    for (const q of I.people || []) { if (!ND.archetypes[q.arch]) bad(`${id}: person archetype ${q.arch} unknown`); if (!POSES.includes(q.pose)) bad(`${id}: pose ${q.pose} is not in figure.js POSES`); }
  }
  if (POSES.length < 10) bad(`only ${POSES.length} poses read from figure.js`);
  for (const [k, I] of Object.entries(SD.items)) {
    if (!(I.price > 0) || !I.name || !I.icon) bad(`shop item ${k}: needs name, icon, price > 0`);
    const err = []; effReset(); applyFx(I.fx, err); for (const e of err) bad(`shop item ${k}: ${e}`); if (!Object.keys(I.fx || {}).length) bad(`shop item ${k}: no effects`);
  }
  for (const [k, S0] of Object.entries(SD.shops)) { if (!S0.items || !S0.items.length) bad(`shop ${k}: sells nothing`); for (const i of S0.items || []) if (!SD.items[i]) bad(`shop ${k}: unknown item ${i}`); for (const t of S0.doors || []) if (!DOORT.includes(t + ':')) bad(`shop ${k}: door type ${t} unknown`); }
  for (const i of SD.treat || []) if (!SD.items[i]) bad(`treat: unknown item ${i}`);

  // ---- money and the bag ----
  shopEnv(SD, { money: 100, bag: {} });
  if (buy('bar', 'ginbilog')) bad('could not buy a ginbilog with ₱100'); if (SHOP.money !== 100 - SD.items.ginbilog.price) bad('wrong change after buying');
  if (!buy('bar', 'ginbilog')) bad('bought a second ginbilog without the money'); if (!buy('bar', 'kape')) bad('bought something the bar does not sell');
  if (next() !== 'ginbilog') bad('the bag does not hold the ginbilog'); earn(50); if (SHOP.money !== 75) bad('earn did not add the fare');
  gift('beer'); if (SHOP.bag.beer !== 1) bad('a gift did not land in the bag'); if (gift('nosuch')) bad('a gift of an unknown item was accepted');
  if (pay(1e6) === '') bad('paid more than we have'); if (walkup('sari') !== 'sari') bad('the sari-sari store front does not sell');

  // ---- effects ----
  effReset(); const r = use('ginbilog'); if (!r.ok) bad('could not drink the ginbilog'); if (SHOP.bag.ginbilog) bad('the drink is still in the bag');
  if (!(drunkK() > .9)) bad(`one ginbilog only makes you ${drunkK().toFixed(2)} drunk (want > .9: it should be strong)`);
  let tSober = 0; while (EF.drunk > 0 && tSober < 3600) { effTick(1); tSober++; } if (!(tSober > 90 && tSober < 600)) bad(`a ginbilog wears off in ${tSober} s (want 1.5-10 min)`);
  effReset(); applyFx({ drunk: .8 }); applyFx(SD.items.kape.fx); if (!(EF.drunk < .8)) bad('coffee did not help'); applyFx({ drunk: 9 }); if (EF.drunk > 1.5001) bad('drunk is not capped');
  const o = {}; for (const t of [0, 3.3, 77]) { drunkRide(.37, .5, .2, 0, t, o); if (o.steer !== .37 || o.thr !== .5 || o.brake !== .2) bad('sober riding input is changed'); }
  // drunk riding: at full drunk, the best counter-steer a rider could possibly give (chosen per instant from -1..1) still leaves it weaving
  let worst = 0, n = 0, cur = 0, thrSurge = 0, grabs = 0;
  for (let t = 0; t < 120; t += .05) {
    let best = 9; for (let s = -1; s <= 1.0001; s += .05) { drunkRide(s, 0, 0, 1, t, o); best = Math.min(best, Math.abs(o.steer)); }
    worst += best; n++; drunkRide(0, 0, 0, 1, t, o); if (o.thr > .3) thrSurge++; if (o.brake > .5) grabs++;
  }
  if (!(worst / n > .2)) bad(`drunk riding can be fought: best counter-steer leaves only ${(worst / n).toFixed(3)} mean steer (want > .2)`);
  if (!thrSurge || !grabs) bad(`drunk: the throttle never surges (${thrSurge}) or the brake is never grabbed (${grabs})`);
  { let mild = 0; for (let t = 0; t < 60; t += .05) { let best = 9; for (let s = -1; s <= 1.0001; s += .05) { drunkRide(s, 0, 0, .1, t, o); best = Math.min(best, Math.abs(o.steer)); } mild += best; } if (mild / 1200 > .02) bad('a sip (k .1) can not be held straight'); }
  if (verbose) console.log(`drunk riding: mean |steer| left after the best counter-steer ${(worst / n).toFixed(2)}, throttle surges ${thrSurge}, brake grabs ${grabs} in 120 s · ginbilog wears off in ${tSober} s`);

  // ---- drunk walking (js/foot.js) ----
  createSim('raider150'); Object.assign(S, { x: -500, z: -500, psi: 0, v: 0, crashed: false, wet: false, air: false });
  footEnv({ H: () => 0, SEA: -10, OBBS: [] });
  const walk = (dk, run, sec = 10) => { Object.assign(F, { on: true, x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0, psi: 0, cy: 0, gnd: true, t: 0, rs: 0 }); let maxSpd = 0; for (let i = 0; i < sec * 60; i++) { footStep({ mx: 0, mz: 1, run, drunk: dk }, 1 / 60); maxSpd = Math.max(maxSpd, F.spd); } return { x: F.x, z: F.z, maxSpd }; };
  const w0 = walk(0, false), w1 = walk(1, false), w2 = walk(1, true), w1b = walk(1, false);
  if (Math.abs(w0.x) > .01) bad('sober walking drifts sideways');
  if (!(Math.abs(w1.x) > 1)) bad(`drunk walking stays on a straight line (sideways ${w1.x.toFixed(2)} m in 10 s)`);
  if (!(-w1.z < -w0.z * .9)) bad('drunk walking is not slower');
  if (w2.maxSpd > 4.2) bad(`drunk you can still sprint (${w2.maxSpd.toFixed(1)} m/s)`);
  if (w1.x !== w1b.x || w1.z !== w1b.z) bad('drunk walking is not deterministic');
  if (verbose) console.log(`walking 10 s: sober ${(-w0.z).toFixed(1)} m ahead, drunk ${(-w1.z).toFixed(1)} m ahead and ${w1.x.toFixed(1)} m sideways, drunk sprint top ${w2.maxSpd.toFixed(1)} m/s`);

  // ---- pool ----
  const T = newTable(), e0 = T.balls.length; if (e0 !== 10 || left(T) !== 9) bad('the rack is not cue + 9 balls');
  const KE = () => T.balls.reduce((a, b) => a + (b.on ? b.vx * b.vx + b.vz * b.vz : 0), 0);
  shoot(T, 0, -1, 5.2); let ke = KE(), up = 0, out = 0, steps = 0, potted = 0;
  while (moving(T) && steps < 4000) { const ev = poolStep(T, 1 / 60); steps++; potted += ev.filter(e => e.k === 'pot').length; const k = KE(); if (k > ke * 1.0001 + 1e-9) up++; ke = k;
    for (const b of T.balls) if (b.on && (Math.abs(b.x) > PC.W / 2 + 1e-6 || Math.abs(b.z) > PC.L / 2 + 1e-6)) out++; }
  if (moving(T)) bad('balls still rolling after a minute'); if (up) bad(`kinetic energy went up ${up} times`); if (out) bad(`a ball left the table ${out} times`);
  const spread = T.balls.filter(b => b.on && b.n).reduce((a, b) => a + Math.abs(b.z + PC.L / 4), 0); if (!(spread > .5 || potted)) bad('the break did not scatter the rack');
  let shots = 0; while (left(T) && shots < 400) { const c = T.balls[0], tgt = T.balls.find(b => b.on && b.n); shoot(T, tgt.x - c.x, tgt.z - c.z, 2.6); shots++; let k = 0; while (moving(T) && k++ < 6000) poolStep(T, 1 / 60); poolStep(T, 1 / 60); }
  if (left(T)) bad(`aiming at the nearest ball, the table was not cleared in 400 shots (${left(T)} left)`); if (!T.balls[0].on) bad('the cue ball did not come back after a scratch');
  rack(T); if (left(T) !== 9 || T.shots) bad('rack did not reset the table');
  if (verbose) console.log(`pool: break settles in ${(steps / 60).toFixed(1)} s, table cleared in ${shots} shots`);

  // ---- the room ----
  interiorEnv(ID); const id = interiorFor('bar'); if (!id) bad('no interior for the bar');
  const H0 = 2, door = { x: 10, z: 20, ix: 10, iz: 17.1, t: 'bar' }; // a building at (10, 12) facing +z, its door step at z = 20
  if (id) {
    const Pk = pocket(id, door, H0), I = ID.interiors[id], e = enterPos(Pk), x = exitPos(Pk);
    if (Math.abs(Pk.oy - (H0 + POCKET())) > 1e-9) bad('the room is not POCKET above the ground');
    if (Math.abs(Pk.ry) > 1e-9) bad('a door facing +z should give ry 0, got ' + Pk.ry);
    const le = toL(Pk, e.x, e.z); if (!(Math.abs(le.x) < I.w / 2 && le.z > I.d / 2 - 2 && le.z < I.d / 2)) bad(`entering puts you at ${le.x.toFixed(2)},${le.z.toFixed(2)} (local)`);
    if (Math.abs(e.psi - Pk.ry) > 1e-9 || Math.abs(x.psi - Pk.ry - Math.PI) > 1e-9 || x.x !== door.x || x.z !== door.z) bad('enter / exit positions or headings are wrong');
    const p2 = pocket(id, { x: 0, z: 0, ix: 0, iz: 0, t: 'bar' }, 0); if (p2 === Pk) bad('two doors share one room');
    if (pocket(id, door, H0) !== Pk) bad('the same door gives a new room (pool tables would reset)');
    // walk it like the island: the room's floor and walls
    footEnv({ H: () => Pk.oy, SEA: -1e9, OBBS: Pk.boxes, noBike: true }); Object.assign(F, { on: true, x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0, psi: e.psi, cy: e.psi, gnd: true });
    let esc = 0, seed = 5; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296; let mx = 0, mz = 1;
    for (let i = 0; i < 60 * 60; i++) { if (i % 90 === 0) { mx = rnd() * 2 - 1; mz = rnd() * 2 - 1; } footStep({ mx, mz, run: rnd() < .5, jump: rnd() < .02, drunk: i > 1800 ? 1 : 0 }, 1 / 60); const l = toL(Pk, F.x, F.z); if (Math.abs(l.x) > I.w / 2 || Math.abs(l.z) > I.d / 2 || Math.abs(F.y - Pk.oy) > 2) esc++; }
    if (esc) bad(`walked out of the room ${esc} times in a minute`);
    const at = (lx, lz) => { const w = { x: Pk.ox + lx * Pk.c + lz * Pk.s, z: Pk.oz - lx * Pk.s + lz * Pk.c }; return interact(Pk, w.x, w.z); };
    const ex = at((I.door && I.door.x) || 0, I.d / 2 - .8); if (!ex || ex.k !== 'exit') bad('no EXIT by the door inside');
    for (const s of I.shops || []) { const a = at(s.x, s.z + .3); if (!a || a.k !== 'shop' || a.shop !== s.shop) bad(`no ORDER at the ${s.shop} counter`); }
    for (const t of Pk.tables) { const a = at(t.p.x + 1.1, t.p.z); if (!a || a.k !== 'pool' || a.label !== 'SHOOT') bad('no SHOOT beside a pool table'); }
    const mid = at(0, 3.2); if (mid && mid.k === 'exit') bad('EXIT offered in the middle of the room');
    // camera: an orbit behind you can't leave the room
    const tg = { x: e.x, y: Pk.oy + 1.3, z: e.z }, f = camFit(Pk, tg.x, tg.y, tg.z, tg.x, tg.y + 1, tg.z + 6), cz = tg.z + 6 * f, lc = toL(Pk, tg.x, cz); if (!(lc.z < I.d / 2)) bad('the camera can leave the room');
    // friends: a walker inside is in this room, one on the street is not
    const DS = [door], Hf = () => H0; if (pocketKey(e.x, Pk.oy, e.z, DS, Hf) !== Pk.key) bad('a friend inside the room is not found in it'); if (pocketKey(door.x, H0, door.z, DS, Hf) !== '') bad('a friend on the street is placed inside');
    footEnv({ H: () => 0, SEA: -10, OBBS: [] });
  }
  return P;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t0 = performance.now(), P = interiorTests();
  for (const p of P) console.log('FAIL ' + p);
  console.log(`interior: ${P.length ? P.length + ' problem(s)' : 'ok'} (${(performance.now() - t0).toFixed(0)} ms)`);
  process.exit(P.length ? 1 : 0);
}
