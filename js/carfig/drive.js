// Cars in the game: the glue between the headless vehicle sim (js/car, an ECS world) and the island. Loads data/cars, parks every
// car that has a `model` at the lot, lets the walker get in (the on-foot context button: DRIVE / GET OUT), runs the sim on the real
// ground, keeps cars out of walls and the sea, draws them, and moves the camera. While driving, the walker (foot.js F) rides
// along hidden, so the minimap, friends, weather and doors all still know where you are. main.js calls carTick / carFrame.
import * as THREE from 'three';
import { scene, camera } from '../renderer.js';
import { H, roadH, SEA, OBBS, LMF, atGas } from '../world.js';
import { ctx, S } from '../state.js';
import { BUILD } from '../config.js';
import { F, nearBoxes } from '../foot.js';
import { K } from '../controls.js';
import { figShow } from '../footfig.js';
import { addAct } from '../act.js';
import { say } from '../hud.js';
import { blip } from '../audio.js';
import { blobAdd, snapshot, B, BLOB_ME } from '../model.js';
import { syncBody } from '../rapier.js';
import { surfaceMu, slickAt } from '../tyre.js';
import { clamp, appr, lerpTable, angd } from '../util.js';
import { carWorld, spawnCar, STEP } from '../car/car.js';
import { build as hiace } from './hiace.js';
import { PAD, WH, WMAX, hudShow, hudDraw, hudWheel, cluTex } from './hud.js';
import { fitOf, cabBoxes, cabFloor, inCab, slotNear, cargoWhy, slotFree } from '../car/cabin.js';
import { fitout, fitDispose } from './fitout.js';

const MODELS = { hiace }; // data `model` -> builder(def, cluTex) -> { root, wheels: [{ g, sp, y0 }], steer, M, size }
const GR = { h: H, mu: surfaceMu, slick: slickAt, wet: 0, n(x, z, o) { const e = .35, h = H(x, z), dx = (H(x + e, z) - h) / e, dz = (H(x, z + e) - h) / e, l = Math.hypot(dx, 1, dz); o[0] = -dx / l; o[1] = 1 / l; o[2] = -dz / l; } };
const W = carWorld(GR), CARS = [], REACH = 3.2, q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v3 = new THREE.Vector3(), e3 = new THREE.Euler(0, 0, 0, 'YXZ');
let cur = null, acc = 0, awake = 2, camSnap = true;
export const CAR = { list: CARS, get cur() { return cur; }, W };

export async function carsInit() {
  const ids = await (await fetch('data/cars/index.json?v=' + BUILD)).json(), defs = (await Promise.all(ids.map(id => fetch(`data/cars/${id}.json?v=${BUILD}`).then(r => r.json())))).filter(d => MODELS[d.model]);
  const lot = LMF.lot[0];
  defs.forEach((def, i) => {
    const a = lot.W(66, 40 + i * 4), b = lot.W(66, 39 + i * 4), at = { x: a.x, z: a.z, h: Math.atan2(b.x - a.x, b.z - a.z) }, id = spawnCar(W, def, at);
    const m = MODELS[def.model](def, cluTex); scene.add(m.root); blobAdd({ b: m.root, p: new THREE.Vector3(0, .5, 0), h0: .5, d: m.size[2] * .6, w: m.size[0] * 1.05, cores: 1, vis: () => true, ground: null, off: false });
    const c = { def, id, m, at, B: W.get(id, 'Body'), I: W.get(id, 'Input'), K: W.get(id, 'Car'), E: W.get(id, 'Engine'), X: W.get(id, 'Gearbox'), wh: W.get(id, 'Car').wheels.map(w => ({ W: W.get(w, 'Wheel'), S: W.get(w, 'Susp') })),
      pp: [0, 0, 0], pq: [0, 0, 0, 1], fuel: def.fuel.cap * .8, odo: 0, auto: 0, st: 0, lit: 0, x: at.x, y: 0, z: at.z, h: at.h, snd: null };
    c.E.on = 0; c.I.hb = 1; c.pp = [...c.B.p]; c.pq = [...c.B.q];
    if (def.cabin) { c.fit = fitOf(def.cabin, FITS[def.id]); refit(c); }
    // the engine voice (audio.js engineCfg / acoustics): the car's geometry + levels in the shape a bike spec has
    const sp = c.K.sp, s = def.sound; c.snd = { run: 0, rpm: 0, load: 0, cut: 0, sp: { sound: s, geo: sp.geo, snd: 0, evo: 0, crd: 0, ccx: 1, muf: s.muf, hdr: s.hdr, ie: sp.ie, ie0: sp.ie, red: sp.red, idle: sp.idle, sPun: 0, sRgh: 0, sMech: 0, sIn: 0, sBri: 0, sCrk: 0 } };
    CARS.push(c);
  });
  // the on-foot context button: DRIVE next to a car, GET OUT inside one
  addAct(() => { if (!F.on || ctx.inside) return null; if (cur) return { label: 'GET OUT', pri: -1, d: 0, run: () => carExit() }; const c = near(); return c ? { label: 'DRIVE', pri: 2, d: Math.hypot(F.x - c.x, F.z - c.z), run: () => enter(c) } : null; }, 'car');
  ctx.carExit = () => { if (cur) carExit(true); };
  // inside a van: take a seat row out / put it back (cycles the slot's options: data cabin.slots[].fit)
  addAct(() => {
    if (!F.on || cur || ctx.inside) return null; const v = inVan(); if (!v) return null; const { c, lz } = v, cab = c.def.cabin, s = slotNear(cab, lz); if (!s) return null;
    const nx = s.fit[(s.fit.indexOf(c.fit[s.id]) + 1) % s.fit.length], it = cab.items[nx];
    return { label: nx ? 'FIT ' + it.name.toUpperCase() : 'REMOVE SEAT', pri: 1, d: Math.abs(lz - s.z), run: () => {
      if (!slotFree(cab, s, nx, c.bike && c.bike.span)) return say('The bike is in the way', 1500);
      c.fit[s.id] = nx; FITS[c.def.id] = c.fit; saveFits(); refit(c); blip('thud', .4);
    } };
  }, 'carfit');
  // at the tailgate (or inside, by the cargo floor): load your parked bike, as it is set up, or roll it back out
  addAct(() => {
    if (!F.on || cur || ctx.inside) return null; const c = atTail(); if (!c) return null;
    if (c.bike) return { label: 'UNLOAD BIKE', pri: 1, d: 1, run: () => unload(c) };
    if (ctx.bikeIn || ctx.ride || Math.hypot(S.x - c.x, S.z - c.z) > 14) return null;
    return { label: 'LOAD BIKE', pri: 1, d: 1, run: () => load(c) };
  }, 'carbike');
  ctx.vanReset = () => { for (const c of CARS) if (c.bike) dropBike(c); };
}

// ---- walking around a van: its floor, walls and fitted seats join the walker's world (foot.js env: H + extra boxes) ----
const FITS = (() => { try { return JSON.parse(localStorage.getItem('isla.carfit')) || {}; } catch (e) { return {}; } })();
const saveFits = () => { try { localStorage.setItem('isla.carfit', JSON.stringify(FITS)); } catch (e) { } };
function refit(c) { if (c.m.fit) { c.m.root.remove(c.m.fit); fitDispose(c.m.fit); } c.m.fit = fitout(c.def.cabin, c.fit, c.m.M); c.m.root.add(c.m.fit); c.box = cabBoxes(c.def.cabin, c.fit); }
const toL = (c, x, z) => { const dx = x - c.x, dz = z - c.z, k = Math.cos(c.h), s = Math.sin(c.h); return [dx * k - dz * s, dx * s + dz * k]; };
const base = c => c.y - c.def.body.cg[1]; // the ground under the van, at ride height (the cabin frame's y = 0)
const inVan = () => { for (const c of CARS) { const cab = c.def.cabin; if (!cab) continue; const [lx, lz] = toL(c, F.x, F.z); if (inCab(cab, lx, lz) && F.y > base(c) + cab.floor - .2) return { c, lx, lz }; } return null; };
const atTail = () => { for (const c of CARS) { const cab = c.def.cabin; if (!cab) continue; const [lx, lz] = toL(c, F.x, F.z); if (Math.abs(lx) < cab.x + .4 && lz > cab.tail - 2 && lz < cab.z[0] + (c.bike ? c.bike.L + .6 : 1.2)) return c; } return null; };
const XB = [];
// main.js: footEnv(carEnv({ H, SEA, OBBS }))
export function carEnv(e) {
  const H0 = e.H; return { ...e, xb: () => XB, H(x, z) {
    for (const c of CARS) { const cab = c.def.cabin; if (!cab || Math.abs(x - c.x) > 4 || Math.abs(z - c.z) > 4) continue; const [lx, lz] = toL(c, x, z), f = cabFloor(cab, lx, lz); if (f != null) return Math.max(H0(x, z), base(c) + f); }
    return H0(x, z);
  } };
}
// the third-person camera stays inside the van while the walker is (footfig.js fit: 0..1 along target -> camera)
export function vanFit() {
  const v = F.on && !cur && inVan(); if (!v) return null; const { c } = v, cab = c.def.cabin, y0 = base(c);
  return (tx, ty, tz, cx, cy, cz) => {
    const [ax, az] = toL(c, tx, tz), [bx, bz] = toL(c, cx, cz); let t = 1;
    const clip = (p0, p1, lo, hi) => { const d = p1 - p0; if (p1 > hi && d > 0) t = Math.min(t, (hi - p0) / d); if (p1 < lo && d < 0) t = Math.min(t, (lo - p0) / d); };
    clip(ax, bx, -cab.x + .1, cab.x - .1); clip(az, bz, cab.z[0] + .1, cab.nose - .5); clip(ty, cy, y0 + cab.floor + .2, y0 + cab.roof - .08); return Math.max(0, t);
  };
}

// ---- your bike in the cargo bay: a snapshot of the model as it is set up (parts, paint, tune), the real one hidden and parked ----
function load(c) {
  const cab = c.def.cabin; if (ctx.spec && ctx.spec.sc) return say('Take the sidecar off first', 1800);
  const snap = snapshot(), o = snap.o; snap.h.rider.forEach(r => r.visible = false); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.updateMatrixWorld(true);
  const bb = new THREE.Box3(), tb = new THREE.Box3(); o.traverseVisible(m => { if (m.isMesh && m.geometry) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb.union(tb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)); } });
  const L = bb.max.z - bb.min.z, why = cargoWhy(cab, c.fit, L, bb.max.y - bb.min.y); if (why) { snap.dispose(); return say(why, 1800); }
  const g = new THREE.Group(), z0 = cab.z[0] + .04; g.add(o); g.rotation.y = Math.PI; g.position.set(cab.cargo.x + (bb.min.x + bb.max.x) / 2, cab.floor - bb.min.y, z0 + bb.max.z); c.m.root.add(g);
  c.bike = { g, snap, L, span: [z0, z0 + L] }; ctx.bikeIn = c; B.root.visible = false; BLOB_ME.off = true; blip('thud', .8); say('Bike loaded. Strap it down and drive', 1800);
}
function dropBike(c) { c.m.root.remove(c.bike.g); c.bike.snap.dispose(); c.bike = null; ctx.bikeIn = null; if (!ctx.ride) B.root.visible = true; BLOB_ME.off = false; }
function unload(c) {
  const cab = c.def.cabin, d = cab.tail - 1.35, sn = Math.sin(c.h), cs = Math.cos(c.h), x = c.x + d * sn, z = c.z + d * cs;
  for (const b of nearBoxes(OBBS, x, z)) { const ax = x - b.cx, az = z - b.cz, lx = ax * b.c + az * b.s, lz = -ax * b.s + az * b.c; if (Math.abs(lx) < b.hx + .4 && Math.abs(lz) < b.hz + 1.1) return say('No room behind the van', 1500); }
  if (H(x, z) < SEA + .15) return say('Not into the sea', 1500);
  dropBike(c); const sp = ctx.spec;
  Object.assign(S, { x, z, psi: c.h, v: 0, lean: 0, leanV: 0, th: 0, thV: 0, yaw: 0, steer: 0, delta: 0, zV: 0 }); S.hF = S.hR = roadH(x, z); S.zH = S.hF + (sp.yf + sp.yr + sp.pf + sp.pr) / 2; syncBody();
  blip('thud', .6); say('Bike unloaded', 1200);
}
const near = () => { let b = null, bd = REACH; for (const c of CARS) { const d = Math.hypot(F.x - c.x, F.z - c.z); if (d < bd && Math.abs(F.y - (c.y - c.def.body.cg[1])) < 2) { bd = d; b = c; } } return b; };
export const carDriving = () => !!cur;

function enter(c) {
  cur = c; awake = 2; c.E.on = c.fuel > 0 ? 1 : 0; c.I.hb = 0; c.I.sel = 0; c.I.auto = c.auto; hudShow(true); figShow(false); blip('start'); camSnap = true;
  F.cy = c.h + Math.PI; F.cp = F.fp ? 0 : .22; document.getElementById('bCam').textContent = F.fp ? 'CAM: 1ST' : 'CAM: 3RD'; F.vx = F.vy = F.vz = 0; say(c.fuel <= 0 ? 'Out of fuel' : document.body.classList.contains('touch') ? 'Tap ▲ for 1st gear, then GAS. ▼ twice from a stop = reverse' : c.def.hint, 5200);
}
export function carExit(force) {
  const c = cur; if (!c) return; if (!force && Math.abs(c.K.v) > 1.5) return say('Stop first');
  cur = null; awake = 3; c.E.on = 0; c.I.thr = c.I.brk = c.I.steer = 0; c.I.hb = 1; c.I.sel = 0; hudShow(false); ctx.car = null;
  // step out of the driver's door (left-hand drive), or the other side if a wall is there
  const [dx, dz] = c.def.cab.door, sn = Math.sin(c.h), cs = Math.cos(c.h), free = s => { const x = c.x + s * dx * cs + dz * sn, z = c.z - s * dx * sn + dz * cs; for (const b of nearBoxes(OBBS, x, z)) { const ax = x - b.cx, az = z - b.cz, lx = ax * b.c + az * b.s, lz = -ax * b.s + az * b.c; if (Math.abs(lx) < b.hx + .35 && Math.abs(lz) < b.hz + .35) return null; } return { x, z }; };
  const p = free(1) || free(-1) || { x: c.x + dx * cs, z: c.z - dx * sn };
  Object.assign(F, { x: p.x, z: p.z, y: H(p.x, p.z), vx: 0, vy: 0, vz: 0, psi: c.h + Math.PI, cy: c.h + Math.PI, gnd: true, spd: 0 }); if (!force) figShow(true);
}

const GEARS = c => c.X.gear < 0 ? 'R' : c.X.gear === 0 ? 'N' : String(c.X.gear);
function drive(c, dt) {
  const I = c.I, v = c.K.v, kb = (K.KeyA || K.ArrowLeft ? 1 : 0) - (K.KeyD || K.ArrowRight ? 1 : 0);
  if (WH.id === null) WH.a = appr(WH.a, 0, (2.5 + Math.min(4, Math.abs(v) * .25)) * dt); // let go: the wheel unwinds, faster when rolling (caster)
  const wt = WH.id !== null || WH.a !== 0; c.st = wt ? -WH.a / WMAX() : appr(c.st, kb, (kb ? 2.2 : 4) * dt); I.steer = c.st;
  I.thr = K.KeyW || K.ArrowUp ? 1 : PAD.gas; I.brk = K.KeyS || K.ArrowDown ? 1 : PAD.brk; I.hb = K.Space || PAD.hb ? 1 : 0;
  if (PAD.auto) { c.auto ^= 1; I.auto = c.auto; say(c.auto ? 'Automatic shifting' : 'Manual shifting', 1200); }
  if (PAD.up) { if (I.sel < 0) I.sel = 0; else if (I.sel === 0) { if (v > -2) I.sel = 1; else say('Stop first'); } else I.up = 1; }
  if (PAD.dn) { if (I.sel > 0 && c.X.gear > 1) I.dn = 1; else if (I.sel > 0) I.sel = 0; else if (I.sel === 0) { if (v < 2) I.sel = -1; else say('Stop first'); } }
  PAD.up = PAD.dn = PAD.auto = 0;
  // fuel: brake-specific consumption of the power being made + the idle flow; the pumps at a gas station fill a stopped car
  const sp = c.K.sp, f = c.def.fuel, kW = c.E.on ? Math.max(0, lerpTable(sp.TQ, c.E.rpm) * c.E.thr * c.E.w) / 1000 : 0;
  c.fuel = Math.max(0, c.fuel - (kW * f.bsfc / 835 + (c.E.on ? f.idle : 0)) / 3600 * dt); if (c.fuel <= 0 && c.E.on) { c.E.on = 0; say('Out of fuel'); }
  if (atGas(c.x, c.z) && Math.abs(v) < .2 && c.fuel < f.cap) { c.fuel = Math.min(f.cap, c.fuel + 2.5 * dt); if (!c.E.on) c.E.on = 1; say('Refueling... ' + (c.fuel / f.cap * 100 | 0) + '%', 400); }
  c.odo += Math.abs(v) * dt / 1000;
}

// buildings (world.js OBBS): the body's footprint must stay out of them. Push the car out through the nearest face and kill the speed into it.
const FP = [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]];
function walls(c) {
  const B = c.B, R = B.R, [bw, , bl] = c.def.body.size, cz = (c.def.body.off || 0) - c.def.body.cg[2]; let hit = 0;
  for (const [sx, sz] of FP) {
    const lx = sx * bw / 2, lz = cz + sz * bl / 2, x = B.p[0] + R[0] * lx + R[2] * lz, z = B.p[2] + R[6] * lx + R[8] * lz;
    for (const b of nearBoxes(OBBS, x, z)) {
      const ax = x - b.cx, az = z - b.cz, px = ax * b.c + az * b.s, pz = -ax * b.s + az * b.c, ox = b.hx - Math.abs(px), oz = b.hz - Math.abs(pz); if (ox <= 0 || oz <= 0) continue;
      let nx, nz, d; if (ox < oz) { nx = Math.sign(px) || 1; nz = 0; d = ox; } else { nx = 0; nz = Math.sign(pz) || 1; d = oz; }
      const wx = b.c * nx - b.s * nz, wz = b.s * nx + b.c * nz; B.p[0] += wx * d; B.p[2] += wz * d;
      const rx = x - B.p[0], rz = z - B.p[2], vx = B.v[0] - B.w[1] * rz, vz = B.v[2] + B.w[1] * rx, vn = vx * wx + vz * wz;
      if (vn < 0) { const tq = rx * wz - rz * wx, j = -1.15 * vn / (1 / B.m + tq * tq / B.I[1]); B.v[0] += j * wx / B.m; B.v[2] += j * wz / B.m; B.w[1] -= j * tq / B.I[1]; B.v[0] *= .96; B.v[2] *= .96; hit = Math.max(hit, -vn); }
    }
  }
  if (hit > 2.5) blip('thud', Math.min(3, hit / 4));
}
function home(c) { const p = spawnPose(c); Object.assign(c.B, { p: p.p, q: p.q, v: [0, 0, 0], w: [0, 0, 0] }); for (const w of c.wh) w.W.w = 0; c.pp = [...p.p]; c.pq = [...p.q]; camSnap = true; }
const spawnPose = c => { const cg = c.def.body.cg, s = Math.sin(c.at.h), k = Math.cos(c.at.h), x = c.at.x + cg[0] * k + cg[2] * s, z = c.at.z - cg[0] * s + cg[2] * k; return { p: [x, H(x, z) + cg[1], z], q: [0, Math.sin(c.at.h / 2), 0, Math.cos(c.at.h / 2)] }; };

// physics: whole 240 Hz steps, the remainder kept for drawing between the last two (like the bike's 120 Hz ticks)
export function carTick(dt) {
  if (cur) { drive(cur, dt); awake = 2; } else if (awake <= 0) return; else awake -= dt;
  GR.wet = ctx.wet || 0; acc += Math.min(dt, .05);
  while (acc >= STEP) { for (const c of CARS) { c.pp[0] = c.B.p[0]; c.pp[1] = c.B.p[1]; c.pp[2] = c.B.p[2]; c.pq[0] = c.B.q[0]; c.pq[1] = c.B.q[1]; c.pq[2] = c.B.q[2]; c.pq[3] = c.B.q[3]; } W.step(STEP); acc -= STEP; }
  for (const c of CARS) {
    walls(c);
    if (H(c.B.p[0], c.B.p[2]) < SEA + .1 || !Number.isFinite(c.B.p[1]) || c.B.p[1] < H(c.B.p[0], c.B.p[2]) - 3) { if (c === cur) { say('Splash! Towed back to the lot', 2000); blip('splash'); } home(c); }
  }
}

// drawing + camera, every frame (also parked, also while paused)
export function carFrame(dt) {
  const a = clamp(acc / STEP, 0, 1);
  for (const c of CARS) {
    const B = c.B, m = c.m, cg = c.def.body.cg;
    q.set(c.pq[0], c.pq[1], c.pq[2], c.pq[3]); q2.set(B.q[0], B.q[1], B.q[2], B.q[3]); q.slerp(q2, a); m.root.quaternion.copy(q);
    v3.set(-cg[0], -cg[1], -cg[2]).applyQuaternion(q); m.root.position.set(c.pp[0] + (B.p[0] - c.pp[0]) * a + v3.x, c.pp[1] + (B.p[1] - c.pp[1]) * a + v3.y, c.pp[2] + (B.p[2] - c.pp[2]) * a + v3.z);
    c.x = m.root.position.x; c.z = m.root.position.z; c.y = m.root.position.y + cg[1]; c.h = Math.atan2(B.R[2], B.R[8]);
    c.wh.forEach((w, i) => { const o = m.wheels[i]; o.g.position.y = o.y0 + (w.S.x ? w.S.x - w.S.droop : -w.S.droop); o.g.rotation.y = w.W.steer; o.sp.rotation.x = w.W.rot; });
    m.steer.rotation.z = c.K.steer * 16; // steering ratio: about 3.2 turns lock to lock
    const on = c === cur && (c.E.on || c.E.rpm > 200), night = ctx.night ?? 0; c.lit = on ? 1 : 0;
    m.M.lamp.emissiveIntensity = on ? .6 + 2.4 * night : 0; m.M.tail.emissiveIntensity = on ? (c.I.brk > .05 ? 2.6 : .35 + .5 * night) : 0; m.M.rev.emissiveIntensity = on && c.X.gear < 0 ? 2 : 0;
  }
  // the walker's world: walls + fitted items of vans nearby; first person ducks under the roof inside
  XB.length = 0;
  if (F.on && !cur) for (const c of CARS) { if (!c.box || Math.abs(F.x - c.x) > 12 || Math.abs(F.z - c.z) > 12) continue; const k = Math.cos(c.h), s = Math.sin(c.h); for (const b of c.box) XB.push({ cx: c.x + b.x * k + b.z * s, cz: c.z - b.x * s + b.z * k, hx: b.hx, hz: b.hz, c: k, s: -s }); }
  const iv = F.on && !cur && inVan(); if (iv && F.eye0 == null) { F.eye0 = F.eye; F.eye = Math.min(F.eye, iv.c.def.cabin.roof - iv.c.def.cabin.floor - .2); } else if (!iv && F.eye0 != null) { F.eye = F.eye0; F.eye0 = null; }
  const c = cur; if (!c) return;
  hudWheel(-c.st * WMAX());
  const sp = c.K.sp, cs = Math.cos(c.h), sn = Math.sin(c.h);
  hudDraw({ kmh: Math.abs(c.K.v) * 3.6, rpm: c.E.rpm, vmax: c.def.cab.vmax, rmax: sp.tachMax, red: sp.red, fuel: c.fuel / c.def.fuel.cap, gear: GEARS(c), hb: c.I.hb, auto: c.auto, lit: c.lit, odo: c.odo });
  c.snd.run = c.E.on ? 1 : 0; c.snd.rpm = c.E.rpm; c.snd.load = c.E.thr; c.snd.cut = c.E.rpm > sp.red ? 1 : 0;
  ctx.car = { x: c.x, y: c.y - c.def.body.cg[1], z: c.z, fx: sn, fz: cs, lit: c.lit, snd: c.snd, v: c.K.v };
  Object.assign(F, { x: c.x, z: c.z, y: c.y - c.def.body.cg[1], psi: c.h + Math.PI, spd: Math.abs(c.K.v), gnd: true, vx: 0, vy: 0, vz: 0 });
  // camera: F.cy / F.cp are the look angles the screen drag turns (main.js). They ride with the car's heading, and ease back behind it when rolling.
  const dh = angd(c.h, c.hc ?? c.h); c.hc = c.h; F.cy += dh;
  const off = angd(F.cy, c.h + Math.PI), back = Math.min(1, Math.abs(c.K.v) / 6) * (1 - Math.exp(-dt * 2.2)); F.cy -= off * back;
  if (F.fp) {
    const e = c.def.cab.eye; v3.set(e[0], e[1], e[2]).applyQuaternion(c.m.root.quaternion).add(c.m.root.position); camera.position.copy(v3);
    e3.set(-clamp(F.cp, -1, 1), Math.PI + clamp(angd(F.cy, c.h + Math.PI), -2.5, 2.5), 0); camera.quaternion.copy(c.m.root.quaternion).multiply(q.setFromEuler(e3));
  } else {
    const cp = clamp(F.cp, -.1, 1.1), k = Math.cos(cp), d = 7.4 + Math.abs(c.K.v) * .04, tx = c.x, ty = c.y + .55, tz = c.z;
    v3.set(tx + Math.sin(F.cy) * k * d, ty + Math.sin(cp) * d + .9, tz + Math.cos(F.cy) * k * d); v3.y = Math.max(v3.y, H(v3.x, v3.z) + .5);
    if (camSnap) camera.position.copy(v3); else camera.position.lerp(v3, 1 - Math.exp(-dt * 9)); camera.lookAt(tx, ty + .5, tz);
  }
  camSnap = false;
}
