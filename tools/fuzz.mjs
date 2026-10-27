#!/usr/bin/env node
// Robustness fuzzer: random rider inputs, random garage setups, slopes, surfaces and stand/air flips on the real solver, checking
// invariants every tick (finite state, sane speed/rpm/lean/gear/fuel, no exceptions). Seeded, so a failure is reproducible.
//   node tools/fuzz.mjs [bike|all] [--seeds 3] [--seed N] [--secs 40]
// Failure line ends with the exact command to replay it. Covers every bike in index.json automatically, including new ones.
import { createSim, bikeIds, loadBike, S, ctx, ign, TICK, withPassenger } from './lib/headless.mjs';

export const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// random garage setup for a bike: every part option, every slider inside its range, every toggle
export function randomSetup(bike, rnd) {
  const parts = {}, set = {};
  for (const [k, p] of Object.entries(bike.parts || {})) parts[k] = Math.floor(rnd() * p.o.length);
  for (const sl of bike.sliders || []) set[sl.k] = Math.round(sl.min + rnd() * (sl.max - sl.min));
  for (const t of bike.toggles || []) set[t.k] = rnd() < .5;
  return { parts, set };
}

export function fuzzOne(id, seed, secs = 40) {
  const rnd = mulberry(seed * 7919 + 13), bike = loadBike(id), setup = randomSetup(bike, rnd);
  const sim = createSim(bike, { ...setup, cfg: { wc: rnd() < .7, tough: rnd() < .3 } }), sp = sim.spec;
  if (rnd() < .5) sim.quickStart(); else { ign.keySwitch(); }
  let next = 0, slope = 0, fail = null, ticks = 0, chaos = false, maxV = 0, runT = 0;
  const pick = a => a[Math.floor(rnd() * a.length)];
  try {
    sim.run(secs, s => {
      ticks++; maxV = Math.max(maxV, Math.abs(S.v)); if (S.running) runT += TICK;
      // "drive" segments: engine kept running, first gear picked, shifted up near the redline, so speeds, lean and load transfer get exercised;
      // "chaos" segments (25%): the fully random key / kill / starter / shift / clutch mess below
      if (!chaos) {
        if (!S.running && S.fuel > 0 && s.t - (S.lastQs || -9) > 2) { ign.quickStart(); S.lastQs = s.t; }
        if (sp.type === 'rotary') { if (S.shCD <= 0 && (S.gear === 0 || S.rpm > sp.red - 600 && S.gear < sp.nG)) sim.shift(1); }
        else if (sp.type === 'manual') {
          if (S.shCD <= 0 && S.gear === 0) { S.cl = 1; sim.shift(-1); } else if (S.shCD <= 0 && S.rpm > sp.red - 600 && S.gear < sp.nG) { S.cl = 1; sim.shift(1); }
          else if (S.gear > 0 && S.cl > 0 && S.shCD < .1) S.cl = Math.max(0, S.cl - 5 * TICK);
        }
      }
      if (s.t >= next) {
        chaos = rnd() < .25; next = s.t + .1 + rnd() * 1.4; ctx.stand = rnd() < .04;
        S.thr = chaos ? pick([0, 0, .3, .6, 1, 1, rnd()]) : pick([.4, .7, 1, 1, 1, rnd()]); S.brake = pick([0, 0, 0, .3, 1, rnd()]); S.steer = pick([0, 0, 0, .5, -.5, 1, -1, rnd() * 2 - 1]); if (sp.type === 'manual' && chaos) S.cl = pick([0, 0, 1, rnd()]); else if (sp.type !== 'manual') S.cl = 0;
        S.back = rnd() < .05; S.surf = .4 + rnd() * .6; slope = pick([0, 0, 0, .05, -.05, .2, -.2]); S.hF = slope * sp.wb / 2; S.hR = -slope * sp.wb / 2;
        if (sp.sc) S.paxM = pick([0, 0, 70, 150]); else withPassenger(sp, pick([0, 0, 65])); // sidecar passengers / a pillion passenger (ride.js), on and off at random
        const r = chaos ? rnd() : 1; if (r < .35) sim.shift(pick([1, 1, -1])); else if (r < .38) ign.keySwitch(); else if (r < .41) ign.killSwitch(); else if (r < .55) ign.starter(1); else if (r < .62) ign.starter(0);
        if (rnd() < .03) S.air = true; else if (rnd() < .3) S.air = false;
      }
      for (const [k, v] of Object.entries(S)) if (typeof v === 'number' && !Number.isFinite(v)) { fail = `S.${k} = ${v}`; return false; }
      if (Math.abs(S.v) > 120) { fail = `speed ${S.v.toFixed(1)} m/s`; return false; }
      if (S.rpm < 0 || S.rpm > sp.red + 1500) { fail = `rpm ${S.rpm.toFixed(0)} (red ${sp.red})`; return false; }
      if (Math.abs(S.lean) > 1.7) { fail = `lean ${S.lean.toFixed(2)} rad`; return false; }
      if (S.gear < 0 || (sp.nG && S.gear > sp.nG)) { fail = `gear ${S.gear}`; return false; }
      if (S.fuel < -1e-6 || S.fuel > sp.fuel.cap + 1e-6) { fail = `fuel ${S.fuel}`; return false; }
      if (Math.abs(S.wp || 0) > 1.4) { fail = `wheelie angle ${(S.wp).toFixed(2)} rad`; return false; }
    });
  } catch (e) { fail = 'threw ' + (e && e.stack || e).toString().split('\n').slice(0, 2).join(' | '); }
  return { fail, t: +sim.t.toFixed(2), ticks, setup, maxKmh: Math.round(maxV * 3.6), runFrac: +(runT / Math.max(sim.t, 1e-9)).toFixed(2) };
}

if (process.argv[1]?.endsWith('fuzz.mjs')) {
  const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? +a[i + 1] : d; }, pos = a.filter((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--'));
  const bikes = !pos[0] || pos[0] === 'all' ? bikeIds : pos[0].split(','), one = opt('--seed', null), n = opt('--seeds', 3), secs = opt('--secs', 40);
  let bad = 0, vmin = 1e9, rmin = 1; const peak = {};
  for (const b of bikes) for (const seed of one != null ? [one] : Array.from({ length: n }, (_, i) => i + 1)) {
    const r = fuzzOne(b, seed, secs); peak[b] = Math.max(peak[b] || 0, r.maxKmh); rmin = Math.min(rmin, r.runFrac);
    if (r.fail) { bad++; console.log(`FAIL  ${b} seed ${seed} at t=${r.t}s: ${r.fail}\n      replay: node tools/fuzz.mjs ${b} --seed ${seed} --secs ${secs}   setup=${JSON.stringify(r.setup)}`); }
  }
  console.log(bad ? `fuzz: ${bad} failure(s)` : `fuzz: ok (${bikes.length} bikes x ${one != null ? 1 : n} seeds x ${secs}s; peak km/h ${Object.entries(peak).map(([k, v]) => k + ' ' + v).join(', ')}; engine running >= ${Math.round(rmin * 100)}% of the time)`);
  process.exit(bad ? 1 : 0);
}
