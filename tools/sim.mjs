#!/usr/bin/env node
// Headless physics scenarios on the game's real solver (see lib/headless.mjs). No browser, a few seconds for all bikes.
//   node tools/sim.mjs [bike|all] [scenario|all] [--json] [--part exhaust=1 ...] [--set kf=14 ...] [--no-wc] [--tough]
// scenarios: launch start brake grade corner wheelie stall idle iss pillion dyno      (default: all, every bike)
// Output is one compact line per bike+scenario. Numbers are comparable between runs, so use them to see what a change did:
//   node tools/sim.mjs all launch > /tmp/before; (edit) ; node tools/sim.mjs all launch | diff /tmp/before -
import { createSim, bikeIds, TICK, S, ign, withPassenger, ROOT } from './lib/headless.mjs';
import { pathToFileURL } from 'node:url';
const { wetGrip } = await import(pathToFileURL(ROOT + '/js/tyre.js').href);
const { dynoRun } = await import(pathToFileURL(ROOT + '/js/dyno.js').href);
const { tuneRead, sliderOn } = await import(pathToFileURL(ROOT + '/js/tune.js').href), { tq } = await import(pathToFileURL(ROOT + '/js/spec.js').href);

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
      else if ((tm -= TICK) <= 0 && S.rpm >= sp.red - 500 && S.gear < sp.nG && S.shCD <= 0) { sim.shift(1); tm = .5; } // wait for the gear to bite: the revs flare while the pedal is down
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
  // what presses the tyres on the road (physics.js: slope, the wind, the suspension's push S.nf). rear*: share of the load on the rear
  // tyre standing on the flat, on a 15% climb / descent, and flat out (the drive against the air drag carries weight back);
  // up60 / dn60: 0-60 km/h up and down the 15% hill; dnM: full-lever stop from 60 km/h down it (m) and dnStop its nose-down angle;
  // wUp / wDn: the synthetic wheelie (see wheelie, control off) up and down the hill; lightM: the same stop on the flat with the
  // tyres carrying 60% of the weight (over a crest), heavyM with 130% (in a dip); lightLean / heavyLean: lean at 15 m/s, bars at 0.6
  grade(o) {
    const m = {}, G = .15, hill = (sim, g) => { S.hF = g * sim.spec.wb / 2; S.hR = -g * sim.spec.wb / 2; };
    const rest = g => { const sim = createSim(o.bike, o); sim.quickStart(); hill(sim, g); S.brake = 1; sim.run(.5, () => { S.brake = 1; S.thr = 0; }); m.nan = m.nan || sim.finite(); return r1(S.lr * 100); };
    m.rear = rest(0); m.rearUp = rest(G); m.rearDn = rest(-G);
    for (const [k, g] of [['up60', G], ['dn60', -G], ['top', 0]]) {
      const sim = createSim(o.bike, o); sim.quickStart(); hill(sim, g); const go = rider(sim, { rate: o.rate }); let top = 0, last = 0, t = null;
      sim.run(k === 'top' ? 100 : 40, s => { go(); const v = s.kmh(); if (v > top + .05) { top = v; last = s.t; } if (k !== 'top' && v >= 60) { t = r2(s.t); return false; } if (s.t - last > 6 && s.t > 8) return false; });
      if (k === 'top') m.rearTop = r1(S.lr * 100); else if (t != null) m[k] = t; m.nan = m.nan || sim.finite();
    }
    const stop = (g, nf) => { const sim = createSim(o.bike, o); sim.quickStart(); hill(sim, g); S.v = 60 / 3.6; S.gear = sim.spec.type === 'cvt' ? 0 : 3; S.cl = 1; S.thr = 0; S.brake = 1; if (nf) S.nf = nf; let wp = 0; const d0 = S.odo;
      sim.run(12, () => { wp = Math.min(wp, S.wp || 0); if (S.v < .05) return false; }); m.nan = m.nan || sim.finite(); return [r1(S.odo - d0), r1(deg(-wp))]; };
    [m.dnM, m.dnStop] = stop(-G); m.lightM = stop(0, .6)[0]; m.heavyM = stop(0, 1.3)[0];
    for (const [k, g] of [['wUp', G], ['wDn', -G]]) {
      const sim = createSim(o.bike, { ...o, spec: { mu: 1.6, pow: 8, ...o.spec }, set: { autoClutch: false, ...o.set }, cfg: { ...o.cfg, wc: false } }); sim.quickStart(); hill(sim, g); S.v = 5 / 3.6; let wp = 0;
      if (sim.spec.type === 'manual') { S.gear = 1; S.cl = 1; } else if (sim.spec.type === 'rotary') S.gear = 1;
      sim.run(6, () => { S.thr = 1; S.brake = 0; S.steer = 0; if (sim.spec.type === 'manual') S.cl = appr(S.cl, 0, 6 * TICK); wp = Math.max(wp, S.wp || 0); });
      m[k] = r1(deg(wp)); m.nan = m.nan || sim.finite();
    }
    for (const [k, nf] of [['lightLean', .6], ['heavyLean', 1.3]]) { const sim = createSim(o.bike, o); sim.quickStart(); S.gear = 0; S.cl = 1; S.nf = nf; sim.run(4, () => { S.v = 15; S.steer = .6; S.thr = 0; S.brake = 0; }); m[k] = r1(deg(Math.abs(S.lean))); m.nan = m.nan || sim.finite(); }
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
  // YECVT (cvt.ye + a part option yec: 1): T vs S full-throttle rpm and 0-60, Y-Shift at a 60 km/h part-throttle cruise (rpm per level,
  // drops out on throttle release), engine braking 80 -> 40 km/h shut throttle with Y-Shift 3 vs none, brake cancels it. na without YECVT
  yshift(o) {
    const yo = { ...o, parts: { ...o.parts } }, b0 = createSim(o.bike, o), vk = Object.entries(b0.bike.parts || {}).find(([, p]) => p.o.some(x => x.yec));
    if (!vk) return { na: 1 }; if (!b0.spec.yec) yo.parts[vk[0]] = vk[1].o.findIndex(x => x.yec);
    const go = (set, f) => { const sim = createSim(o.bike, { ...yo, set: { ...yo.set, ...set } }); sim.quickStart(); S.brake = 0; return f(sim); }, m = {};
    for (const [k, set] of [['T', { ysp: false }], ['S', { ysp: true }]]) go(set, sim => { S.thr = 1; let r = 0; sim.run(30, s => { if (s.kmh() > 50 && !r) r = S.rpm; return s.kmh() < 60; }); m['rpm50' + k] = Math.round(r); m['t60' + k] = r2(sim.t); });
    go({}, sim => {
      S.thr = .5; sim.run(30, s => s.kmh() < 60); S.thr = .35; sim.run(3); m.rpm0 = Math.round(S.rpm);
      for (let i = 1; i <= 3; i++) { S.shCD = 0; sim.shift(-1); sim.run(1.5); m['rpmY' + i] = Math.round(S.rpm); } m.kmhY3 = r2(sim.kmh());
      S.thr = 0; sim.run(.3); m.relCancel = S.ysh ? 0 : 1;
    });
    for (const lv of [0, 3]) go({}, sim => { S.thr = 1; sim.run(40, s => s.kmh() < 80); S.thr = 0; sim.run(.3); for (let i = 0; i < lv; i++) { S.shCD = 0; sim.shift(-1); } const t0 = sim.t; sim.run(60, s => s.kmh() > 40); m['coast' + lv] = r2(sim.t - t0); });
    go({}, sim => { S.thr = 1; sim.run(10, s => s.kmh() < 50); sim.shift(-1); S.brake = .5; sim.run(.2); m.brkCancel = S.ysh ? 0 : 1; m.nan = sim.finite(); });
    return m;
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
  // the garage's inertia-drum dyno (js/dyno.js) in its default gear: rear-wheel PS / Nm peaks, loss below the crank figure, pull time
  dyno(o) {
    const sim = createSim(o.bike, o), d = dynoRun(sim.spec, sim.ctx.drive, sim.ctx.bcfg);
    const ok = d.pts.every(q => Number.isFinite(q.hp) && Number.isFinite(q.rpm)) && d.hp > 0 && d.hp < d.crank;
    return { whp: r1(d.hp), whpRpm: Math.round(d.hpRpm / 50) * 50, wtq: r1(d.tq), crank: r1(d.crank), loss: r1(d.loss * 100), pull: r1(d.T), ok: ok ? 1 : 0 };
  },
  // garage > DYNO fine tuning (js/tune.js): crank peak against the untuned engine for a sensible tune (a little richer, a little more
  // advance), a bad one (lean and far too much advance: knock) and a retarded cam; stock AFR; idle and limiter offsets reach the spec
  tune(o) {
    const sim = createSim(o.bike, o), bk = sim.bike, sp0 = sim.spec, carb = bk.sliders.some(s => s.k === 'mj' && sliderOn(s, sp0)), has = k => bk.sliders.some(s => s.k === k && sliderOn(s, sp0));
    // one sim at a time: createSim reuses the shared ctx, so each variant is measured before the next is made
    const meas = set => { const s = createSim(o.bike, { ...o, set: { ...o.set, ...set } }), r = tuneRead(bk, s.spec, s.ctx.bcfg); return { crank: dynoRun(s.spec, s.ctx.drive, s.ctx.bcfg).crank, low: tq(s.spec, .3 * s.spec.red0), kn: Math.max(...r.knock), afr: r.afr, any: r.any, idle: s.spec.idle, red: s.spec.red, fk: s.spec.fuel.k }; };
    const z = meas({}), good = meas(carb ? { mj: 1, ig: 2 } : { fl: 3, fm: 3, fh: 3, il: 1, ih: 2 }), bad = meas(carb ? { mj: -3, nc: 1, ig: 6 } : { fl: -10, fm: -10, fh: -10, il: 6, ih: 6 });
    const cam = meas({ ct: -4 }), lim = meas({ idl: 200, ...(has('rl') && { rl: -500 }) }), pct = (a, k = 'crank') => r1((a[k] / z[k] - 1) * 100);
    return { good: pct(good), bad: pct(bad), badKnock: r1(bad.kn), camTop: pct(cam), camLow: pct(cam, 'low'), afrLo: r1(z.afr[0]), afrMid: r1(z.afr[1]), afrTop: r1(z.afr[2]),
      dIdle: lim.idle - z.idle, dRed: lim.red - z.red, fuelGood: pct(good, 'fk'), ok: bad.crank < z.crank && bad.kn > 0 && cam.low < z.low && !z.any && z.kn === 0 ? 1 : 0 };
  },
  // neutral, nothing touched: stays running near its idle speed, doesn't roll, burns a little fuel
  idle(o) {
    const sim = createSim(o.bike, { ...o, set: { iss: false, ...o.set } }); sim.quickStart(); const f0 = S.fuel, sp = sim.spec; S.thr = 0; S.brake = 0; S.gear = 0; S.cl = 0;
    sim.run(30, () => { S.thr = 0; S.brake = 0; });
    return { ok: S.running ? 1 : 0, rpm: Math.round(S.rpm), idleSpec: sp.idle, v: r2(Math.abs(S.v)), fuelPerH: r2((f0 - S.fuel) / 30 * 3600), nan: sim.finite() };
  },
};
// wet road (weather.js -> ctx.wet, tyre.js wetGrip): the same full-lever stop from 60 km/h dry, on a damp road (wet 0.5), soaked (1) and
// soaked on paint (slick 1); 0-60 soaked; lean held at 15 m/s soaked; grip x at 60 and at 130 km/h soaked (hydroplaning)
SC.wet = o => {
  const m = {}, stop = set => { const sim = createSim(o.bike, { ...o, set: { ...o.set, ...set } }); sim.quickStart(); S.v = 60 / 3.6; S.gear = sim.spec.type === 'cvt' ? 0 : 3; S.cl = 1; S.thr = 0; S.brake = 1; const d0 = S.odo; sim.run(20, () => { if (S.v < .05) return false; }); m.nan = m.nan || sim.finite(); return r1(S.odo - d0); };
  m.dryM = stop({ wet: 0 }); m.dampM = stop({ wet: .5 }); m.wetM = stop({ wet: 1 }); m.paintM = stop({ wet: 1, slick: 1 });
  { const sim = createSim(o.bike, { ...o, set: { ...o.set, wet: 1 } }); sim.quickStart(); const go = rider(sim, { rate: o.rate }); sim.run(60, s => { go(); if (s.kmh() >= 60) { m.t60 = r2(s.t); return false; } }); m.nan = m.nan || sim.finite(); }
  for (const [k, w] of [['leanDry', 0], ['leanWet', 1]]) { const sim = createSim(o.bike, { ...o, set: { ...o.set, wet: w } }); sim.quickStart(); S.gear = 0; S.cl = 1; sim.run(4, () => { S.v = 15; S.steer = .6; S.thr = 0; S.brake = 0; }); m[k] = r1(deg(Math.abs(S.lean))); m.nan = m.nan || sim.finite(); }
  const sp = createSim(o.bike, o).spec; m.g60 = r2(wetGrip(1, 60 / 3.6, sp)); m.g130 = r2(wetGrip(1, 130 / 3.6, sp));
  return m;
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
