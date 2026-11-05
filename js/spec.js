// Turns a bike definition + its garage settings into the flat spec the physics reads.
import { lerpTable } from './util.js';
import { DRIVES } from './drivetrain.js';

// part option keys that multiply instead of replace (capx: clutch torque capacity, etax: chain/belt efficiency; drivetrain.js applies both;
// frx: engine friction, e.g. oil; fux: fuel use; ccx: displacement, e.g. a bore-up kit)
const MUL = new Set(['pow', 'ie', 'csp', 'brake', 'capx', 'etax', 'frx', 'fux', 'ccx']);
// ... and keys that add (dm: mass change in kg, e.g. carbon parts; tqs: torque-curve tilt toward the top end, e.g. a cam;
// redd: rpm added to the rev limit, e.g. valve springs or a racing CDI; crd: compression ratio points, e.g. a high-comp piston;
// evo: degrees earlier the exhaust valve opens, e.g. a racing cam). Exhaust options replace muf (muffler volume vs stock, 0 = open
// pipe) and hdr (header length vs A. G. Bell's tuned length: stock headers are packaged short, 0.85). audio.js reads these + geo
const ADD = new Set(['dm', 'tqs', 'redd', 'crd', 'evo']);

export function computeSpec(bike, b) {
  const ch = bike.chassis, en = bike.engine;
  const s = {
    type: bike.drivetrain, ...ch,
    ie: en.Ie, ie0: en.Ie, idle: en.idle, red: en.red, red0: en.red, TQ: en.torque, fric: en.fric, fuel: en.fuel,
    peakPS: en.peakPS, tachMax: en.tachMax, ram: en.ram || 0, sound: bike.sound, geo: en.geo,
    pow: 1, mu: .85, snd: 0, csp: 1, eng: 0, c: '#888888', capx: 1, etax: 1, frx: 1, fux: 1, tqs: 0, redd: 0, dm: 0, ccx: 1, crd: 0, evo: 0, muf: 1, hdr: .85, cfb: 0, cff: 0, cfw: 0, cfx: 0,
  };
  for (const [k, p] of Object.entries(bike.parts)) {
    const o = p.o[b[k]] || p.o[0];
    for (const [kk, v] of Object.entries(o)) { if (kk === 'n') continue; if (MUL.has(kk)) s[kk] *= v; else if (ADD.has(kk)) s[kk] += v; else s[kk] = v; }
  }
  // engine internals: tilt the torque curve about 60% of the stock redline (tqs 0.05 = 5% less at idle-ish revs, ~2% more at the top),
  // raise the limiter (never past the end of the torque table), scale friction and fuel use
  if (s.tqs) s.TQ = s.TQ.map(([r, t]) => [r, t * Math.max(.5, 1 + s.tqs * (r / s.red0 - .6))]);
  if (s.redd) s.red = Math.min(s.red + s.redd, s.TQ[s.TQ.length - 1][0]);
  if (s.frx !== 1) s.fric = [s.fric[0] * s.frx, s.fric[1] * s.frx];
  if (s.fux !== 1) s.fuel = { ...s.fuel, idle: s.fuel.idle * s.fux, k: s.fuel.k * s.fux };
  if (b.cc) s.c = b.cc; if (b.cw) s.wc = b.cw; // custom body / wheel colours from the garage's pickers
  s.m0 = s.m; s.m += s.dm;
  s.kf = b.kf * 1000; s.kr = b.kr * 1000; s.damp = b.damp / 100;
  // preload: spring pre-compressed by pf/pr metres, so the bike sits that much higher (CG too) with more bump travel left
  s.pf = (b.pf || 0) / 1000; s.pr = (b.pr || 0) / 1000; s.h += (s.pf + s.pr) / 2;
  // ride height (fork tubes slid in the clamps / shock length): chassis sits yf/yr higher, same travel and sag
  s.yf = (b.yf || 0) / 1000; s.yr = (b.yr || 0) / 1000; s.h += (s.yf + s.yr) / 2;
  // a sidecar's own wheel carries scW of the rig, the bike's springs only the rest
  s.ms = s.sc ? s.m * (1 - s.scW) : s.m;
  s.sag = (s.ms * s.lr / s.wb * 9.81 / s.kf + s.ms * s.lf / s.wb * 9.81 / s.kr) / 2;
  s.tqMax = Math.max(...s.TQ.map(p => p[1]));
  DRIVES[bike.drivetrain].spec(s, bike, b);
  return s;
}
// tqc (power modes): torque ceiling as a fraction of peak torque, so the low end stays and the top end is cut
export const tq = (s, rpm) => s.tqc ? Math.min(lerpTable(s.TQ, rpm), s.tqc * s.tqMax) : lerpTable(s.TQ, rpm);

// A pillion passenger (ride.js): kg sitting sp.pil.x metres ahead of the rear axle with their centre of mass sp.pil.h metres above the
// road. Adds the mass, moves the bike's centre of mass back and up (wheelies come earlier, stoppies later, the rear tyre carries more)
// and adds pitch inertia about the new centre (parallel axis + the person's own swing). Always worked out from the unloaded values kept
// in sp.base, so it is idempotent and kg = 0 gives the bike back exactly. A new computeSpec() starts unloaded again (ride.js re-applies).
// Trikes carry people in the sidecar instead (S.paxM, physics.js). Returns true when the spec changed.
export function withPassenger(sp, kg) {
  const b = sp.base || (sp.base = { m: sp.m, ms: sp.ms, lf: sp.lf, lr: sp.lr, h: sp.h, I: sp.I });
  if (!(kg > 0) || !sp.pil || sp.sc) kg = 0;
  if ((sp.pk || 0) === kg) return false; sp.pk = kg;
  if (!kg) { Object.assign(sp, b); return true; }
  const M = b.m + kg, p = sp.pil, lr = Math.min(.88 * sp.wb, Math.max(.12 * sp.wb, (b.m * b.lr + kg * p.x) / M)), h = (b.m * b.h + kg * p.h) / M;
  sp.m = M; sp.ms = b.ms + kg; sp.lr = lr; sp.lf = sp.wb - lr; sp.h = h;
  sp.I = b.I + b.m * ((lr - b.lr) ** 2 + (h - b.h) ** 2) + kg * ((p.x - lr) ** 2 + (p.h - h) ** 2 + .09); // .09 = the person's own (0.3 m radius of gyration)^2
  return true;
}

// ---- engine acoustics from the real engine (engine.geo: bore / stroke mm, compression ratio, peak-power rpm) ----
// Header: A. Graham Bell's tuned primary length P[in] = 850 ED / N - 3 (ED = 180 deg + exhaust opening BBDC, 55 stock; N = peak-power
//   rpm) and inside diameter ID[in] = 2.1 sqrt(cc per cylinder / ((P + 3) 25)). Stock headers are packaged shorter (sp.hdr 0.85);
//   an aftermarket system is cut for the engine as built (bore-up, cam). Open-end correction 0.6 r.
// Muffler: Helmholtz f = c / 2pi sqrt(A / (V (L + 1.7 r))): can ~20x the swept volume (one can shared on multis: x cyl^0.65), times
//   sp.muf for slip-ons; 10 cm tailpipe with 60% of the header area per cylinder (wider on freer cans). The worklet adds c(T).
// Intake: runner length by the Engelman / Bell tuning formula L[in] = ECD 0.25 V 2 / (N RV) + D/2 (ECD = 720 - 250 deg - 30,
//   V = 1300 ft/s, RV = 3, runner D ~ 0.45 bore), quarter-wave at 293 K.
const IN = .0254;
export function acoustics(sp) {
  const s = sp.sound, g = sp.geo, cyl = s.cyl || 1, af = sp.hdr >= 1, cc0 = Math.PI / 4 * g.bore ** 2 * g.stroke / 1000;
  const P = 850 * (235 + (af ? sp.evo : 0)) / g.peak - 3, lh = P * IN * sp.hdr, dh = 2.1 * Math.sqrt(cc0 * (af ? sp.ccx : 1) / ((P + 3) * 25)) * IN;
  const V = 20 * cc0 * cyl ** .65 * 1e-6 * sp.muf, At = .6 * Math.PI / 4 * dh * dh * Math.sqrt(cyl) * (2 - sp.muf), rt = Math.sqrt(At / Math.PI);
  const Li = (440 * .25 * 1300 * 2 / (g.peak * 3) + .45 * g.bore / 25.4 / 2) * IN;
  return { lh: lh + .3 * dh, kH: sp.muf > 0 ? Math.sqrt(At / (V * (.1 + 1.7 * rt))) / (2 * Math.PI) : 0, fin: 343 / (4 * (Li + .135 * g.bore / 1000)),
    cr: g.cr + sp.crd, upk: 2 * g.stroke / 1000 / 60 / 17, evo: sp.evo, peak: g.peak, muf: sp.muf };
}
