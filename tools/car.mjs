// Headless four-wheel (any-wheel) vehicles: js/ecs/ecs.js + js/car/ on data/cars/*.json. Part of test.mjs.
//   node tools/car.mjs [id] [-v]     -v prints every car's numbers
// Checks: the ECS itself, each car's data (carProblems, torque curve vs peakPS), sits still on its springs with the static
// axle loads, 0-100 / top speed / gears, full stop from 100 km/h (dry and soaked), holds a straight line, steady circle (lateral g,
// no rollover), handbrake on a 15 % hill, reverse, same run twice = same numbers; the sample as a 3-wheeler and a 6-wheeler;
// a car dropped on its roof stays on the ground. Flat or constant-slope ground only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
globalThis.addEventListener ??= () => { };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), rdj = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const { makeWorld } = await import('../js/ecs/ecs.js');
const { carWorld, spawnCar, killCar, stepCars, carProblems, carSpec, STEP } = await import('../js/car/car.js');
const verbose = process.argv.includes('-v');
export const carIds = rdj('data/cars/index.json');

const flat = { h: () => 0 };
function rig(def, ground = flat, at) {
  const w = carWorld(ground), car = spawnCar(w, def, at), o = { w, car, B: w.get(car, 'Body'), I: w.get(car, 'Input'), K: w.get(car, 'Car'), E: w.get(car, 'Engine'), X: w.get(car, 'Gearbox') };
  o.W = o.K.wheels.map(id => w.get(id, 'Wheel')); o.run = (s, fn) => { for (let i = 0, n = Math.round(s / STEP); i < n; i++) { w.step(STEP); if (fn && fn(i * STEP) === false) return i * STEP; } return s; };
  o.fin = () => [...o.B.p, ...o.B.v, ...o.B.w, ...o.B.q, o.E.w, ...o.W.map(q => q.w)].every(Number.isFinite);
  return o;
}
const r1 = v => Math.round(v * 10) / 10;

export function carMetrics(def, wet = 0) {
  const M = {}, sp = carSpec(def), mg = sp.m * 9.81;
  { // rest: 3 s untouched
    const r = rig(def); r.run(3); M.restV = Math.hypot(...r.B.v); M.restY = r.B.p[1] - sp.cgY; M.load = r.W.reduce((t, q) => t + q.N, 0) / mg;
    M.front = r.W.filter(q => q.z > 0).reduce((t, q) => t + q.N, 0) / mg; M.idle = r.E.rpm; M.ok = r.fin();
  }
  { // launch in D with automatic shifting, then the full stop
    const r = rig(def, { h: () => 0, wet }); r.I.sel = 1; r.I.auto = 1; r.I.thr = 1; let top = 0, gmax = 0;
    r.run(70, t => { const v = r.K.v * 3.6; if (M.t60 == null && v >= 60) M.t60 = t; if (M.t100 == null && v >= 100) M.t100 = t; top = Math.max(top, v); gmax = Math.max(gmax, r.X.gear); });
    M.top = top; M.gears = gmax; M.drift = Math.abs(r.B.p[0]); M.ok &&= r.fin();
    const b = rig(def, { h: () => 0, wet }); b.I.sel = 1; b.I.auto = 1; b.I.thr = 1; b.run(60, () => b.K.v < 100 / 3.6); b.I.thr = 0; b.I.brk = 1; const z0 = b.B.p[2];
    M.brakeT = b.run(20, () => b.K.v > .1); M.brakeM = b.B.p[2] - z0; M.brakeYaw = Math.abs(b.B.q[1]); M.ok &&= b.fin();
  }
  { // steady circle: hold 40 km/h-ish with half lock for 12 s
    const r = rig(def); r.I.sel = 1; r.I.auto = 1; r.I.steer = .5; let up = 1;
    r.run(14, t => { r.I.thr = r.K.v < 11 ? .6 : .1; up = Math.min(up, r.B.R[4]); });
    const v = Math.hypot(r.B.v[0], r.B.v[2]), yr = Math.abs(r.B.w[1]); M.circR = v / yr; M.circG = v * yr / 9.81; M.circUp = up; M.ok &&= r.fin();
  }
  { // handbrake on a 15 % hill, nose up, 6 s; then reverse on the flat
    const s = .15, l = Math.hypot(1, s), r = rig(def, { h: (x, z) => s * z, n: (x, z, o) => { o[0] = 0; o[1] = 1 / l; o[2] = -s / l; } }); r.B.q[0] = -Math.sin(Math.atan(s) / 2); r.B.q[3] = Math.cos(Math.atan(s) / 2);
    r.I.hb = 1; r.run(2); const z0 = r.B.p[2]; r.run(6); M.hillM = Math.abs(r.B.p[2] - z0); M.ok &&= r.fin();
    const v = rig(def); v.I.sel = -1; v.I.thr = .5; v.run(4); M.rev = v.K.v * 3.6; M.ok &&= v.fin();
  }
  return M;
}

export function carTests() {
  const P = [], bad = m => P.push('CAR ' + m), info = [];
  { // the ECS
    const w = makeWorld(), a = w.spawn({ A: { v: 1 }, B: { v: 2 } }), b = w.spawn({ A: { v: 3 } }); let n = 0, sum = 0, order = '';
    w.each(['A', 'B'], (e, x, y) => { n++; sum += x.v + y.v; }); if (n !== 1 || sum !== 3) bad('ecs: each() over two components');
    w.add(b, 'B', { v: 4 }); w.remove(a, 'B'); n = 0; w.each(['A', 'B'], e => { n += e; }); if (n !== b) bad('ecs: add / remove');
    w.kill(b); if (w.has(b, 'A') || w.count('A') !== 1 || w.alive.size !== 1) bad('ecs: kill');
    w.system('one', () => { order += '1'; }).system('two', (_, dt) => { order += dt; }); w.step(2); if (order !== '12' || w.time !== 2) bad('ecs: systems run in the order added');
  }
  for (const id of carIds) {
    let def; try { def = rdj(`data/cars/${id}.json`); } catch (e) { bad(`${id}: ${e.message}`); continue; }
    const pr = carProblems(def); if (def.id !== id) pr.push(`id "${def.id}" is not the file name`); if (pr.length) { for (const p of pr) bad(`${id}: ${p}`); continue; }
    const e = def.engine, ps = Math.max(...e.torque.map(([r, t]) => r <= e.red ? r * t / 7023.5 : 0)); if (Math.abs(ps / e.peakPS - 1) > .06) bad(`${id}: torque curve peaks at ${r1(ps)} PS, peakPS says ${e.peakPS}`);
    const M = carMetrics(def), W = carMetrics(def, 1), f = (c, m) => { if (!c) bad(`${id}: ${m}`); };
    f(M.ok && W.ok, 'a state value went non-finite');
    f(M.restV < .02 && Math.abs(M.restY) < .01 && Math.abs(M.load - 1) < .02, `does not sit still on its springs (v ${M.restV.toFixed(3)} m/s, height ${M.restY.toFixed(3)} m, load ${M.load.toFixed(3)} x weight)`);
    f(Math.abs(M.idle - e.idle) < .2 * e.idle, `idles at ${M.idle | 0} rpm, not ${e.idle}`);
    f(M.t60 > 2 && M.t100 > M.t60 && M.t100 < 40, `0-60 ${M.t60} s, 0-100 ${M.t100} s`); f(M.top > 90 && M.top < 400, `top speed ${r1(M.top)} km/h`); f(M.gears >= Math.min(3, def.gearbox.gears.length), `only reached gear ${M.gears}`);
    f(M.drift < .5 && M.brakeYaw < .02, `does not run / stop straight (${M.drift.toFixed(2)} m off line, yaw ${M.brakeYaw.toFixed(3)})`);
    f(M.brakeM > 30 && M.brakeM < 75, `100-0 km/h in ${r1(M.brakeM)} m`); f(W.brakeM > 1.15 * M.brakeM, `soaked road stops no longer (${r1(W.brakeM)} m vs ${r1(M.brakeM)} m dry)`);
    f(M.circG > .15 && M.circG < 1.3 && M.circR > 3 && M.circR < 200 && M.circUp > .9, `steady circle: ${M.circG.toFixed(2)} g, radius ${r1(M.circR)} m, leaned to ${M.circUp.toFixed(2)}`);
    f(M.hillM < .25, `handbrake lets it roll ${M.hillM.toFixed(2)} m in 6 s on a 15 % hill`); f(M.rev < -3 && M.rev > -60, `reverse: ${r1(M.rev)} km/h`);
    f(JSON.stringify(carMetrics(def)) === JSON.stringify(M), 'not deterministic (two identical runs differ)');
    info.push(`${id}: 0-60 ${r1(M.t60)} s, 0-100 ${r1(M.t100)} s, top ${r1(M.top)} km/h, 100-0 ${r1(M.brakeM)} m (soaked ${r1(W.brakeM)} m), front ${Math.round(M.front * 100)} %, circle ${M.circG.toFixed(2)} g r ${r1(M.circR)} m, hill creep ${(M.hillM * 100).toFixed(1)} cm, reverse ${r1(M.rev)} km/h`);
  }
  // any number of wheels is data: the sample as a tricycle (one rear wheel) and with a third axle; then dropped on its roof
  const base = carIds[0] && rdj(`data/cars/${carIds[0]}.json`);
  if (base && !carProblems(base).length) {
    const rear = base.axles[base.axles.length - 1], kinds = { '3-wheel': { ...base, axles: [base.axles[0], { ...rear, track: 0 }] }, '6-wheel': { ...base, axles: [...base.axles, { ...rear, z: rear.z - .9 }] } };
    for (const [k, def] of Object.entries(kinds)) {
      const pr = carProblems(def); if (pr.length) { bad(`${k}: ${pr[0]}`); continue; }
      const r = rig(def); r.run(2); const still = Math.hypot(...r.B.v), load = r.W.reduce((t, q) => t + q.N, 0) / (r.B.m * 9.81); r.I.sel = 1; r.I.auto = 1; r.I.thr = 1; r.I.steer = .2; r.run(8);
      if (!r.fin() || still > .05 || Math.abs(load - 1) > .03 || r.K.v < 8 || r.B.R[4] < .9) bad(`${k} variant: rest v ${still.toFixed(3)}, load ${load.toFixed(2)}, then ${r1(r.K.v * 3.6)} km/h, upright ${r.B.R[4].toFixed(2)}`);
      if (r.W.length !== (k === '3-wheel' ? 3 : 6)) bad(`${k}: ${r.W.length} wheels`);
    }
    const r = rig(base); r.B.p[1] = 2.2; r.B.q = [0, 0, 1, 0]; r.run(5); if (!r.fin() || r.B.p[1] < .3 || r.B.p[1] > 2 || Math.hypot(...r.B.v) > 1) bad(`dropped on its roof: ends at height ${r.B.p[1].toFixed(2)} m, ${Math.hypot(...r.B.v).toFixed(2)} m/s`);
    const w = r.w, n = w.alive.size; killCar(w, r.car); if (w.alive.size !== n - 1 - base.axles.reduce((t, a) => t + (a.track > 0 ? 2 : 1), 0)) bad('killCar left entities behind');
    const s = rig(base); if (stepCars(s.w, .05) !== 12) bad('stepCars(0.05 s) should run 12 fixed steps');
  }
  if (verbose) console.log(info.join('\n'));
  return { problems: P, summary: `${carIds.length} car${carIds.length === 1 ? '' : 's'}, ${info.length} driven` };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = carTests(); for (const p of r.problems) console.log('FAIL ' + p);
  console.log(r.problems.length ? '' : 'car: ok (' + r.summary + ')'); process.exit(r.problems.length ? 1 : 0);
}
