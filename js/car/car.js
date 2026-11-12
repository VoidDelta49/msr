// Wheeled vehicles (cars, later jeepneys / trucks / anything on axles) as ECS entities: the entry point.
//   const w = carWorld({ h: (x, z) => 0 });            // ground: see systems.js
//   const car = spawnCar(w, carJson, { x, z, h });     // one vehicle entity + one entity per wheel, all from data/cars/<id>.json
//   w.get(car, 'Input').thr = 1;  stepCars(w, dt);     // any frame dt: runs whole fixed STEPs, keeps the remainder
// Nothing here knows about three, the DOM, audio or the bikes' solver (physics.js); drawing / sound / HUD read the components.
import { makeWorld } from '../ecs/ecs.js';
import { carSpec } from './spec.js';
import { STEP, frameSys, controlSys, suspSys, powertrainSys, tyreSys, bodySys } from './systems.js';
export { STEP, carSpec };
export { carProblems } from './spec.js';

export function carWorld(ground) {
  const w = makeWorld(); w.res.ground = ground; w.res.acc = 0;
  return w.system('frame', frameSys).system('control', controlSys).system('susp', suspSys).system('powertrain', powertrainSys).system('tyre', tyreSys).system('body', bodySys);
}

// at: { x, z, h } = where the origin of the vehicle frame stands and its heading (0 = facing +z, turning towards +x)
export function spawnCar(w, def, at = {}) {
  const sp = carSpec(def), x = at.x || 0, z = at.z || 0, h = at.h || 0, c = Math.cos(h), s = Math.sin(h), cz = def.body.cg[2], cx = def.body.cg[0];
  const px = x + cx * c + cz * s, pz = z - cx * s + cz * c;
  const car = w.spawn({
    Body: { p: [px, w.res.ground.h(px, pz) + sp.cgY, pz], q: [0, Math.sin(h / 2), 0, Math.cos(h / 2)], v: [0, 0, 0], w: [0, 0, 0], f: [0, 0, 0], t: [0, 0, 0], R: new Float64Array(9), m: sp.m, I: sp.I, drag: sp.drag, box: sp.box, hit: 0 },
    Car: { id: sp.id, sp, wheels: [], steer: 0, v: 0 },
    Engine: { on: 1, w: sp.idle * Math.PI / 30, rpm: sp.idle, thr: 0 },
    Gearbox: { gear: 0, t: 0, ratio: 0, bite: 0 },
    Input: { thr: 0, brk: 0, steer: 0, hb: 0, clutch: 0, sel: 0, up: 0, dn: 0, auto: 0 },
  });
  const K = w.get(car, 'Car'), byAxle = {};
  for (const q of sp.wheels) {
    const id = w.spawn({
      Wheel: { car, axle: q.axle, side: q.side, x: q.x, y: q.y, z: q.z, r: q.r, Iw: q.Iw, L: q.L, drive: q.drive, brake: q.brake, hb: q.hb, pair: 0, w: 0, rot: 0, steer: 0, Td: 0, N: 0, Fx: 0, Fy: 0, slip: 0, sx: 0, c: [0, 0, 0], n: [0, 1, 0] },
      Susp: { N0: q.N0, k: q.k, c: q.c, kb: q.kb, arb: q.arb, bump: q.bump, droop: q.droop, x: 0, F: 0 },
      Tyre: { mu: q.mu, tap: q.tap, ls: q.ls, crr: q.crr, wetg: q.wetg, aqua: q.aqua, N0: q.N0 },
    });
    K.wheels.push(id); (byAxle[q.axle] ||= []).push(id);
  }
  for (const a of Object.values(byAxle)) if (a.length === 2) { w.get(a[0], 'Wheel').pair = a[1]; w.get(a[1], 'Wheel').pair = a[0]; }
  return car;
}

export function killCar(w, car) { for (const id of w.get(car, 'Car').wheels) w.kill(id); w.kill(car); }

export function stepCars(w, dt) {
  let a = w.res.acc + Math.min(dt, .1), n = 0; while (a >= STEP) { w.step(STEP); a -= STEP; n++; } w.res.acc = a; return n;
}
