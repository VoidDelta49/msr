// Turns a bike definition + its garage settings into the flat spec the physics reads.
import { lerpTable } from './util.js';
import { DRIVES } from './drivetrain.js';

// part option keys that multiply instead of replace
const MUL = new Set(['pow', 'ie', 'csp', 'brake']);
// ... and keys that add (dm: mass change in kg, e.g. carbon parts)
const ADD = new Set(['dm']);

export function computeSpec(bike, b) {
  const ch = bike.chassis, en = bike.engine;
  const s = {
    type: bike.drivetrain, ...ch,
    ie: en.Ie, idle: en.idle, red: en.red, red0: en.red, TQ: en.torque, fric: en.fric, fuel: en.fuel,
    peakPS: en.peakPS, tachMax: en.tachMax, sound: bike.sound,
    pow: 1, mu: .85, snd: 0, csp: 1, eng: 0, c: '#888888', dm: 0, cfb: 0, cff: 0, cfw: 0, cfx: 0,
  };
  for (const [k, p] of Object.entries(bike.parts)) {
    const o = p.o[b[k]] || p.o[0];
    for (const [kk, v] of Object.entries(o)) { if (kk === 'n') continue; if (MUL.has(kk)) s[kk] *= v; else if (ADD.has(kk)) s[kk] += v; else s[kk] = v; }
  }
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
export const tq = (s, rpm) => lerpTable(s.TQ, rpm);

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
