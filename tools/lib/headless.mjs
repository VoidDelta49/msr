// Headless harness: runs the game's REAL physics.js / drivetrain.js / ignition.js / spec.js in Node (no browser, no Rapier, no three.js).
// Ground is flat (hF = hR = 0, nothing to hit). Rapier only owns heave/pitch/walls in the game; speed, rpm, gears, clutch, grip,
// wheelspin, lock-ups, wheelies and steering all come from the code under test, so drivetrain/tyre/spec changes show up here.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TICK = 1 / 120; // rapier.js tick; the bike solver runs 3 substeps of it
export const SUB = TICK / 3;

// browser globals the physics chain touches at import time
const store = {};
globalThis.localStorage ??= { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.addEventListener ??= () => { };
globalThis.sessionStorage ??= globalThis.localStorage;
register('./hooks.mjs', import.meta.url);

const J = rel => pathToFileURL(path.join(ROOT, rel)).href;
const [{ S, ctx }, { computeSpec, withPassenger }, { DRIVES }, phys, ign, conf] = await Promise.all([
  import(J('js/state.js')), import(J('js/spec.js')), import(J('js/drivetrain.js')), import(J('js/physics.js')), import(J('js/ignition.js')), import(J('js/config.js')),
]);
export { S, ctx, computeSpec, withPassenger, DRIVES, ign, conf };
export const cfg = conf.cfg;

export const bikeIds = JSON.parse(readFileSync(path.join(ROOT, 'data/bikes/index.json'), 'utf8'));
export const loadBike = id => JSON.parse(readFileSync(path.join(ROOT, `data/bikes/${id}.json`), 'utf8'));
export const loadAll = () => Object.fromEntries(bikeIds.map(id => [id, loadBike(id)]));

// Put the ridden bike in place (what main.js setBike + reset do): returns the sim handle.
//   opts.parts: { key: optionIndex, ... } and opts.set: { slider/toggle: value } override the bike's defaults
//   opts.spec: raw spec overrides applied after computeSpec (e.g. { mu: 1.6 } for a sticky tyre)
//   opts.cfg: game options to override (wc = wheelie control, tough = tough biker)
//   opts.pax: kg of pillion passenger on the back (spec.js withPassenger: more mass, centre of mass back and up)
export function createSim(id, opts = {}) {
  const bike = typeof id === 'string' ? loadBike(id) : id;
  const bcfg = { ...bike.defaults, ...(opts.parts || {}), ...(opts.set || {}) };
  Object.assign(cfg, { wc: true, tough: false }, opts.cfg || {});
  globalThis.__says = []; globalThis.__blips = {};
  ctx.bike = bike; ctx.bcfg = bcfg; ctx.spec = Object.assign(computeSpec(bike, bcfg), opts.spec || {}); if (opts.pax) withPassenger(ctx.spec, opts.pax); ctx.drive = DRIVES[bike.drivetrain]; ctx.stand = false;
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, {
    x: 0, z: 0, psi: 0, v: 0, rpm: 0, running: false, key: false, kill: false, tip: false, cr: 0, cranking: false, cT: 0, keyT: 0, stT: 0, fi: 0, warm: 0, gear: 0, cl: 0,
    thr: 0, thrEff: 0, brake: 0, steer: 0, delta: 0, lean: 0, leanV: 0, yaw: 0, zH: 0, zV: 0, th: 0, thV: 0, cF: 0, cR: 0, hF: 0, hR: 0, a: 0, c: 0,
    fuel: ctx.spec.fuel.cap, wp: 0, wpv: 0, wA: 0, wAR: 0, ws: 0, lkF: false, lkR: false, ayu: 0, skid: 0, fxr: 0, surf: 1, cutT: 0, act: 0, shCD: 0, lim: false, padT: 0, hits: 0, odo: 0,
  });
  ctx.drive.reset(S);
  const sim = {
    bike, spec: ctx.spec, S, ctx, t: 0, dist: 0,
    // advance by one rapier tick (3 solver substeps), with the same per-frame timers input() runs
    tick() {
      S.shCD -= TICK; S.cutT -= TICK; S.act -= TICK;
      for (let i = 0; i < 3; i++) phys.step(SUB);
      sim.t += TICK; sim.dist = S.odo;
    },
    run(seconds, each) { const n = Math.round(seconds / TICK); for (let i = 0; i < n; i++) { sim.tick(); if (each && each(sim) === false) return false; } return true; },
    shift: d => ctx.drive.shift(ctx.spec, S, d, ctx.bcfg),
    // engine already running and warm (garage / bike-swap shortcut)
    quickStart() { ign.quickStart(); },
    kmh: () => Math.abs(S.v) * 3.6,
    finite() { for (const [k, v] of Object.entries(S)) if (typeof v === 'number' && !Number.isFinite(v)) return k; return null; },
  };
  return sim;
}
