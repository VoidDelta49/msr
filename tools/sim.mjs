#!/usr/bin/env node
// Headless physics scenarios on the game's real solver (see lib/headless.mjs). No browser, a few seconds for all bikes.
//   node tools/sim.mjs [bike|all] [scenario|all] [--json] [--part exhaust=1 ...] [--set kf=14 ...] [--no-wc] [--tough]
// scenarios: launch start brake corner wheelie stall idle iss pillion      (default: all, every bike)
// Output is one compact line per bike+scenario. Numbers are comparable between runs, so use them to see what a change did:
//   node tools/sim.mjs all launch > /tmp/before; (edit) ; node tools/sim.mjs all launch | diff /tmp/before -
import { createSim, bikeIds, TICK, S, ign, withPassenger } from './lib/headless.mjs';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const appr = (v, t, s) => v < t ? Math.min(t, v + s) : Math.max(t, v - s);
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, deg = r => r * 180 / Math.PI;

// Scripted rider: first gear, full throttle, shifts up near the redline (clutch + throttle cut on manual, pedal only on rotary).
function rider(sim, { rate = 2.5, thr = 1 } = {}) {
  const sp = sim.spec, type = sp.type; let ph = 'init', tm = 0;
  return () => {
    S.brake = 0; S.steer = 0; S.thr = thr;
    if (type === 'cvt') { S.cl = 0; return; }
    if (type === 'rotary') {
      if (ph === 'init') { sim.shift(1); ph = 'drive'; }
      else if (S.rpm >= sp.red - 500 && S.gear < sp.nG && S.shCD <= 0) sim.shift(1);
      return;
    }
    if (ph === 'init') { S.cl = 1; S.thr = 0; if (S.gear !== 1 && S.shCD <= 0) sim.shift(S.gear === 0 && sp.pat === 'down' ? 1 : -1); if (S.gear === 1) ph = 'launch'; }
    else if (ph === 'launch') { S.cl = appr(S.cl, 0, rate * TICK); if (S.cl === 0) ph = 'drive'; }
    else if (ph === 'drive') { if (S.rpm >= sp.red - 500 && S.gear < sp.nG && S.v > .5) ph = 'pull'; }
    else if (ph === 'pull') { S.thr = 0; S.cl = appr(S.cl, 1, 10 * TICK); if (S.cl >= .99 && S.shCD <= 0) { sim.shift(1); ph = 'wait'; tm = .12; } }
    else if (ph === 'wait') { S.thr = 0; tm -= TICK; if (tm <= 0) ph = 'rel'; }
    else if (ph === 'rel') { S.cl = appr(S.cl, 0, 6 * TICK); if (S.cl === 0) ph = 'drive'; }
  };
}

const SC = {
  // full-throttle standing start to the plateau: times to 60 / 100 km/h and 100 m, top speed, gears used
  launch(o) {
    const sim = createSim(o.bike, o); sim.quickStart(); const go = rider(sim, { rate: o.rate }), m = { top: 0, wpMax: 0, shifts: 0 }; let last = 0, g0 = 0;
    sim.run(100, s => {
      go(); const k = s.kmh();
      if (S.gear !== g0) { g0 = S.gear; m.shifts++; }
      if (k >= 60 && m.t60 == null) m.t60 = r2(s.t); if (k >= 100 && m.t100 == null) m.t100 = r2(s.t); if (S.odo >= 100 && m.t100m == null) m.t100m = r2(s.t); if (S.odo >= 400 && m.t400m == null) m.t400m = r2(s.t);
      if (k > m.top + .05) { m.top = k; last = s.t; } m.wpMax = Math.max(m.wpMax, S.wp || 0);
      if (s.t - last > 6 && s.t > 8) return false;
    });
    m.top = r1(m.top); m.gear = S.gear; m.rpmEnd = Math.round(S.rpm); m.wpMax = r1(deg(m.wpMax)); m.nan = sim.finite();
    return m;
  },
  // key on, hold START: when does it catch, where does it idle, does it stay running
  start(o) {
    const sim = createSim(o.bike, o), m = {}; ign.keySwitch(); S.brake = 1; ign.starter(1);
    sim.run(8, s => { if (S.running) { m.catch = r2(s.t); return false; } });
    ign.starter(0); S.brake = 0; if (S.running) { sim.run(6); m.idle = Math.round(S.rpm); m.warm = r2(S.warm); }
    m.ok = !!S.running; m.nan = sim.finite(); return m;
  },
  // 60 km/h to a stop, lever fully on (clutch pulled / in neutral so the engine doesn't help): distance, time, locks, nose lift
  brake(o) {
    const m = {};
    for (const [name, b] of [['full', 1], ['half', .5]]) {
      const sim = createSim(o.bike, o); sim.quickStart(); S.v = 60 / 3.6; S.gear = sim.spec.type === 'cvt' ? 0 : 3; S.cl = 1; S.thr = 0; S.brake = b;
      let lk = 0, wp = 0, aMax = 0, d0 = S.odo;
      sim.run(12, s => { if (S.lkF || S.lkR) lk++; wp = Math.min(wp, S.wp || 0); aMax = Math.max(aMax, -S.a); if (S.v < .05) return false; });
      m[name + 'M'] = r1(S.odo - d0); m[name + 'T'] = r2(sim.t); m[name + 'G'] = r2(aMax / 9.81); if (name === 'full') { m.lockMs = Math.round(lk * TICK * 1000); m.stoppie = r1(deg(-wp)); m.abs = sim.spec.abs ? 1 : 0; }
      m.nan = m.nan || sim.finite();
    }
    return m;
  },
  // constant speed (neutral/coasting, speed pinned), bars over: lean, turn radius, how much grip is being asked for
  corner(o) {
    const m = {};
    for (const v of [5, 10, 15]) {
      const sim = createSim(o.bike, o); sim.quickStart(); S.gear = 0; S.cl = 1; let rad = 0;
      sim.run(4, s => { S.v = v; S.steer = .6; S.thr = 0; S.brake = 0; });
      rad = Math.abs(S.yaw) > 1e-3 ? v / Math.abs(S.yaw) : 0; m['lean' + v] = r1(deg(Math.abs(S.lean))); m['r' + v] = r1(rad); m['over' + v] = r2(S.over); m.nan = m.nan || sim.finite();
    }
    return m;
  },
  // 1st gear, clutch dumped at 5 km/h with full throttle on a synthetic setup (spec.mu 1.6, pow x8: stock bikes can't lift the front, wheelie-control logic only shows when forced):
  // peak nose-up angle in degrees with wheelie control on and off
  wheelie(o) {
    const m = {};
    for (const [name, wc] of [['wcOn', true], ['wcOff', false]]) {
      const sim = createSim(o.bike, { ...o, spec: { mu: 1.6, pow: 8, ...o.spec }, set: { autoClutch: false, ...o.set }, cfg: { ...o.cfg, wc } }); sim.quickStart(); S.v = 5 / 3.6; let wp = 0;
      if (sim.spec.type === 'manual') { S.gear = 1; S.cl = 1; } else if (sim.spec.type === 'rotary') S.gear = 1;
      sim.run(6, s => { S.thr = 1; S.brake = 0; S.steer = 0; if (sim.spec.type === 'manual') S.cl = appr(S.cl, 0, 6 * TICK); wp = Math.max(wp, S.wp || 0); });
      m[name] = r1(deg(wp)); m.nan = m.nan || sim.finite();
    }
    return m;
  },
  // manual bikes, anti-stall off: dump the clutch in 1st at idle, no throttle. Characterisation only: some bikes stall, some creep (idle control)
  stall(o) {
    if (createSim(o.bike, o).spec.type !== 'manual') return { na: 1 };
    const sim = createSim(o.bike, { ...o, set: { ...o.set, autoClutch: false } }); sim.quickStart(); S.gear = 1; S.cl = 0; S.thr = 0; S.brake = 0;
    sim.run(4, () => { if (!S.running) return false; });
    return { stalled: S.running ? 0 : 1, t: r2(sim.t), msg: (globalThis.__says || []).some(t => /Stalled/.test(t)) ? 1 : 0 };
  },
  // Idling Stop (scooters with the iss toggle): engine cuts after ~3 s stopped at idle once warm, restarts on throttle
  iss(o) {
    const b0 = createSim(o.bike, o); if (!b0.bike.toggles?.some(t => t.k === 'iss')) return { na: 1 };
    const sim = createSim(o.bike, { ...o, set: { iss: true, ...o.set } }); sim.quickStart(); S.warm = 1; S.brake = 0; let off = null;
    sim.run(8, s => { S.thr = 0; if (!S.running && off == null) { off = r2(s.t); return false; } });
    const m = { offAt: off }; S.thr = .6; S.key = true; sim.run(1.5, () => { S.thr = .6; }); m.restarted = S.running ? 1 : 0; m.nan = sim.finite(); return m;
  },
  // a 65 kg pillion passenger (spec.js withPassenger): what the extra weight, further back and higher, does to launch, braking, nose lift and the
  // load on the rear tyre. Trikes carry people in the sidecar instead (na). idem = adding then removing the passenger gives the bike back exactly
  pillion(o) {
    const b0 = createSim(o.bike, o), sp = b0.spec; if (sp.sc || !sp.pil) return { na: 1 };
    const w = { ...o, pax: 65 }, a = SC.launch(o), l = SC.launch(w), k0 = SC.brake(o), k1 = SC.brake(w), wh = SC.wheelie(w), m = {};
    m.t60 = l.t60; m.dT60 = r2(l.t60 - a.t60); m.top = l.top; m.dTop = r1(l.top - a.top); m.wpMax = l.wpMax;
    m.fullM = k1.fullM; m.dFullM = r1(k1.fullM - k0.fullM); m.stoppie = k1.stoppie; m.wcOn = wh.wcOn;
    const p = createSim(o.bike, w).spec, q = p.base; m.lrPct = r1(p.lr / p.wb * 100); m.dLrPct = r1((p.lr - q.lr) / p.wb * 100); m.hCm = r1(p.h * 100); m.dHCm = r1((p.h - q.h) * 100); m.I = r1(p.I); m.kg = r1(p.m - q.m);
    const s = createSim(o.bike, o).spec, was = JSON.stringify([s.m, s.ms, s.lf, s.lr, s.h, s.I]); withPassenger(s, 65); withPassenger(s, 65); withPassenger(s, 0);
    m.idem = JSON.stringify([s.m, s.ms, s.lf, s.lr, s.h, s.I]) === was ? 1 : 0; m.nan = a.nan || l.nan || k1.nan || wh.nan; return m;
  },
  // neutral, nothing touched: stays running near its idle speed, doesn't roll, burns a little fuel
  idle(o) {
    const sim = createSim(o.bike, { ...o, set: { iss: false, ...o.set } }); sim.quickStart(); const f0 = S.fuel, sp = sim.spec; S.thr = 0; S.brake = 0; S.gear = 0; S.cl = 0;
    sim.run(30, () => { S.thr = 0; S.brake = 0; });
    return { ok: S.running ? 1 : 0, rpm: Math.round(S.rpm), idleSpec: sp.idle, v: r2(Math.abs(S.v)), fuelPerH: r2((f0 - S.fuel) / 30 * 3600), nan: sim.finite() };
  },
};
export const SCENARIOS = Object.keys(SC);
export function runScenario(name, bike, o = {}) { return SC[name]({ ...o, bike }); }

// ---- CLI ----
if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('sim.mjs')) {
  const a = process.argv.slice(2), flags = a.filter(x => x.startsWith('--')), pos = a.filter(x => !x.startsWith('--') && !/^\w+=/.test(x)), kv = a.filter(x => /^\w+=/.test(x));
  const o = { parts: {}, set: {}, cfg: {} }, json = flags.includes('--json');
  for (let i = 0; i < a.length; i++) if (a[i] === '--part' || a[i] === '--set') { const [k, v] = a[++i].split('='); (a[i - 1] === '--part' ? o.parts : o.set)[k] = v === 'true' ? true : v === 'false' ? false : +v; }
  if (flags.includes('--no-wc')) o.cfg.wc = false; if (flags.includes('--tough')) o.cfg.tough = true;
  const skip = new Set(); for (let i = 0; i < a.length; i++) if (a[i] === '--part' || a[i] === '--set') skip.add(a[i + 1]);
  const names = pos.filter(x => !skip.has(x)), bikes = !names[0] || names[0] === 'all' ? bikeIds : names[0].split(','), scs = !names[1] || names[1] === 'all' ? SCENARIOS : names[1].split(',');
  for (const b of bikes) if (!bikeIds.includes(b)) { console.error('unknown bike ' + b + ' (have: ' + bikeIds.join(', ') + ')'); process.exit(2); }
  for (const s of scs) if (!SC[s]) { console.error('unknown scenario ' + s + ' (have: ' + SCENARIOS.join(', ') + ')'); process.exit(2); }
  const out = {};
  for (const b of bikes) for (const s of scs) {
    let m; try { m = runScenario(s, b, o); } catch (e) { m = { error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; process.exitCode = 1; }
    (out[b] ||= {})[s] = m;
    if (!json) console.log(b.padEnd(10), s.padEnd(8), Object.entries(m).map(([k, v]) => k + '=' + v).join(' '));
  }
  if (json) console.log(JSON.stringify(out));
}
