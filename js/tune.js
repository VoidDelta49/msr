// Fine tuning (garage > DYNO): the adjustments a tuner makes with the bike strapped to the drum, none of them a part.
//   Fuel-injected bikes: fuel trim at low / mid / high rpm (fl fm fh, % fuel against the fitted map: a piggyback fuel controller or a
//     flash), ignition timing below and above the torque peak (il ih, crank degrees), rev limit (rl, rpm).
//   Carburetted bikes: main jet (mj, sizes up or down the carb's real jet series: top end), needle clip (nc, 1 = top groove = leanest:
//     mid range), pilot / air screw (ps, turns out: idle and low revs), ignition timing (ig, the slotted pickup plate moves the whole curve).
//   All of them: cam timing (ct, slotted cam sprocket: advanced = more bottom end, retarded = more top end), idle speed (idl, rpm).
// Every slider is an offset from stock, and with all of them at stock the spec is exactly the untuned one.
//
// The model, per bike from engine.tune:
//   fuel [low, mid, high]: % more fuel than the stock setting that best power wants (emission maps and factory jetting are lean; the
//     supercharged H2 is rich on top for safety, so its number is negative there). Parts that flow more air (pipe, filter, throttle
//     body / carb, ports, cam, bore-up) add to it: an injected engine corrects part of that itself, a carburettor none (ak).
//     Power falls off steeply on the lean side and gently on the rich side. Shown as the wideband AFR (13.0 = best power).
//   ign [low, high]: degrees of advance the stock curve leaves on the table (MBT). knock [low, high]: degrees before it pings.
//     Compression pulls the knock limit down (2 deg per point), a lean mixture too (0.15 deg per %), a rich one cools the charge and
//     buys margin; a long-duration cam bleeds cylinder pressure at low revs. Past the limit power drops and the engine rattles.
// What the tune changes: the torque curve (so the drum, the road and the stats all see it), fuel use (rich drinks, lean saves), the
// idle, the limiter, and the sound (lean or retarded: overrun crackle; advanced: harder pulse; knock: rattle; low idle: lumpier).
import { clamp, sstep } from './util.js';

// part keys that change how much air the engine moves (their pow factor raises the fuel it needs); a bore-up anywhere counts by ccx
const AIR = new Set(['exhaust', 'intake', 'tb', 'carb', 'port', 'cam', 'cyl']);
export const airOf = (k, o) => AIR.has(k) ? (o.pow || 1) : (o.ccx || 1);
const KEYS = ['fl', 'fm', 'fh', 'il', 'ih', 'ig', 'ct', 'idl', 'rl', 'mj', 'nc', 'ps'];
const lerp = (a, b, t) => a + (b - a) * t, k_in = k => KEYS.includes(k);

// a slider with on: 'carb' / 'fi' only exists while that fuel system is fitted (the Smash is sold both ways)
export const sliderOn = (sl, s) => !sl.on || (sl.on === 'carb') === !!s.carb;
// the jet a main-jet setting stands for: v sizes up or down the carb's series from the one it came with (a carb option can bring its own)
export function jetOf(bike, s, v) {
  const J = bike.engine.tune.jets, j0 = s.jet || bike.engine.tune.jet; let i0 = 0;
  for (let i = 1; i < J.length; i++) if (Math.abs(J[i] - j0) < Math.abs(J[i0] - j0)) i0 = i;
  return [J[clamp(i0 + v, 0, J.length - 1)], J[i0]];
}

// slider offsets from stock -> what they mean for the engine: fuel % per band, timing per band, cam, idle, limiter
function read(bike, s, b) {
  const T = bike.engine.tune, df = bike.defaults, d = {}; let any = false;
  for (const k of KEYS) d[k] = 0;
  for (const sl of bike.sliders) if (k_in(sl.k) && sliderOn(sl, s)) { const v = (b[sl.k] ?? df[sl.k]) - df[sl.k]; if (Number.isFinite(v) && v) { d[sl.k] = v; any = true; } }
  const f = [d.fl, d.fm, d.fh];
  if (d.mj) { const [j, j0] = jetOf(bike, s, d.mj), p = ((j / j0) ** 2 - 1) * 100; f[2] += p; f[1] += .3 * p; }  // flow ~ jet area
  if (d.nc) { f[1] += 4.5 * d.nc; f[2] += 1.5 * d.nc; f[0] += d.nc; }                                           // one groove ~ 4.5% in the mid range
  if (d.ps) { const p = 10 * d.ps * (T.scr || 1); f[0] += p; f[1] += .2 * p; }                                    // one turn ~ 10% off idle; scr -1 = air screw (out = leaner)
  const ak = T.ak ?? (s.carb || T.jets ? .8 : .45), air = clamp(((s.air || 1) - 1) * 100 * ak, 0, 4);
  return { any, f, need: [T.fuel[0] + .3 * air, T.fuel[1] + .7 * air, T.fuel[2] + air], i: [d.il + d.ig, d.ih + d.ig], ct: d.ct, idl: d.idl, rl: d.rl, T };
}

// power factors. Mixture: d = % fuel away from best power (lean < 0). Timing: i degrees from stock, MBT and knock limit likewise
const pMix = d => Math.max(.6, 1 - (d < 0 ? .0004 : .0002) * d * d);
const pIgn = (i, mbt, kl) => Math.max(.6, (1 - .0012 * (i - mbt) ** 2) * (i > kl ? 1 - .015 * (i - kl) : 1));
// at u = rpm / stock redline: mixture error, knock limit and torque factor for fuel trims f and timing i
function at(R, s, u, f, i) {
  const wl = 1 - sstep(.25, .5, u), wh = sstep(.6, .85, u), wm = 1 - wl - wh, w = sstep(.35, .7, u), T = R.T;
  const d = wl * (f[0] - R.need[0]) + wm * (f[1] - R.need[1]) + wh * (f[2] - R.need[2]);
  const kl = lerp(T.knock[0], T.knock[1], w) - 2 * s.crd + .1 * s.evo * (1 - w) + .15 * clamp(d, -10, 10), ig = lerp(i[0], i[1], w);
  return { d, kl, ig, p: pMix(d) * pIgn(ig, lerp(T.ign[0], T.ign[1], w), kl) };
}
const Z3 = [0, 0, 0], Z2 = [0, 0], BAND = [.2, .55, .9];

// what the dyno operator reads off the wideband and hears through the det-cans: AFR at low / mid / top, degrees past the knock limit
export function tuneRead(bike, s, b) {
  if (!bike.engine.tune) return null; const R = read(bike, s, b), a = BAND.map(u => at(R, s, u, R.f, R.i));
  return { afr: a.map(x => 13 / (1 + x.d / 100)), knock: a.map(x => Math.max(0, x.ig - x.kl)), any: R.any };
}

// computeSpec calls this once the parts are in: reshapes s.TQ and sets idle, limiter, fuel use and sound levels
export function applyTune(bike, s, b) {
  if (!bike.engine.tune) return; const R = read(bike, s, b); if (!R.any) return;
  // torque curve: resampled every 250 rpm (the bands and the cam tilt are finer than the table), each point scaled by tuned / untuned
  const end = s.TQ[s.TQ.length - 1][0], xs = new Set(s.TQ.map(p => p[0])); for (let x = 250; x < end; x += 250) xs.add(x);
  const tilt = -.015 * R.ct, camP = 1 - .0003 * R.ct * R.ct; let kn = 0;
  const old = s.TQ, val = x => { let i = 1; while (i < old.length - 1 && x > old[i][0]) i++; const p = old[i - 1], q = old[i]; return p[1] + (q[1] - p[1]) * clamp((x - p[0]) / (q[0] - p[0]), 0, 1); };
  s.TQ = [...xs].sort((a, c) => a - c).map(x => {
    const u = x / s.red0, a = at(R, s, u, R.f, R.i), a0 = at(R, s, u, Z3, Z2); if (x >= s.idle && x <= s.red) kn = Math.max(kn, a.ig - a.kl);
    return [x, val(x) * clamp(a.p / a0.p, .6, 1.12) * camP * Math.max(.5, 1 + tilt * (u - .6))];
  });
  if (R.rl) s.red = clamp(s.red + R.rl, s.idle + 2500, end);
  if (R.idl) { const i0 = s.idle; s.idle += R.idl; s.fuel = { ...s.fuel, idle: s.fuel.idle * s.idle / i0 }; }
  const fa = .25 * R.f[0] + .45 * R.f[1] + .3 * R.f[2];
  if (fa) { const k = clamp(1 + fa / 100, .7, 1.4); s.fuel = { ...s.fuel, idle: s.fuel.idle * k, k: s.fuel.k * k }; }
  const ia = (R.i[0] + R.i[1]) / 2;
  s.sCrk += Math.min(1.2, .1 * Math.max(0, -fa)) + .15 * Math.max(0, -ia); s.sPun += .015 * Math.max(0, ia);
  s.sMech += Math.min(1.5, .35 * kn); s.sRgh += Math.min(.8, .15 * kn) + .3 * Math.max(0, -R.idl) / 200 + .03 * Math.max(0, -R.f[0]);
  s.tuned = 1;
}
