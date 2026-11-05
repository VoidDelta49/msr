// Inertia-drum chassis dyno (the kind most tuning shops run): the rear tyre spins a heavy steel drum, the bike is held at full
// throttle in one gear (or, on a CVT, left to shift itself) from low revs to the limiter, and power is worked out from how fast the
// drum speeds up. It uses the bike's real spec: the torque curve with every part fitted, power modes, engine friction, chain or belt
// efficiency, clutch, gear ratios and the CVT's own variator code. Like a real inertia dyno it only sees what reaches the drum, so a
// heavy flywheel or crank reads lower here than on paper (part of the power is spent spinning them up) and a lightened one reads higher.
// No wind, so no ram-air boost. Pure function of the spec: the garage plays the result back, tools/sim.mjs reads its numbers.
import { tq } from './spec.js';

export const DRUM = 300;              // drum's equivalent mass at its surface, kg (a 250-series style drum)
const DT = 1 / 400, PS = 735.5;

// the gear a shop would pick: about 1:1 overall, 4th on 5- and 6-speeds, 3rd on a 4-speed
export const dynoGear = s => Math.max(1, s.nG - (s.nG >= 6 ? 2 : 1));

// one full-throttle pull. gear: manual/rotary only. Returns samples and peaks; x is rpm (geared) or km/h (CVT)
export function dynoRun(s, drive, b, gear) {
  const cvt = s.type === 'cvt', r = s.r, mw = (s.Iw || .6) / (r * r), P = [];
  const F = { gear: gear || dynoGear(s), v: 0, rpm: 0, pos: 0, thr: 1, brake: 0, ysh: 0, yOpen: false, yk: 0, yT0: 1, c: 1 };
  const rpmOf = R => F.v / r * R * 30 / Math.PI;
  // start rolling with the clutch locked: geared from ~30% of the redline, CVT just above the clutch's lock-up
  const r0 = cvt ? s.e1 + 150 : Math.max(s.idle + 800, .3 * s.red), R0 = drive.ratio(s, F);
  F.v = r0 * Math.PI / 30 / R0 * r; F.rpm = r0;
  let t = 0, next = 0, hpMax = 0, hpRpm = 0, tqMax = 0, tqRpm = 0, hpKph = 0;
  while (t < 60) {
    const Te0 = tq(s, F.rpm) * s.pow, Te = Math.min(Te0 - (s.fric[0] + s.fric[1] * F.rpm) * .15, s.cap);
    if (cvt) drive.update(s, F, DT, Te0, b);
    const R = drive.ratio(s, F), k1 = R / r, a = Te * k1 * s.eta / (DRUM + mw + s.ie * k1 * k1);
    const hp = DRUM * a * F.v / PS, trq = hp * PS * 30 / (Math.PI * F.rpm), kph = F.v * 3.6;
    if (t >= next) { P.push({ t, rpm: F.rpm, kph, hp, tq: trq }); next += .02; }
    if (hp > hpMax) { hpMax = hp; hpRpm = F.rpm; hpKph = kph; } if (trq > tqMax) { tqMax = trq; tqRpm = F.rpm; }
    F.v += a * DT; F.rpm = rpmOf(drive.ratio(s, F)); t += DT;
    if (F.rpm >= s.red) break;
  }
  const last = P[P.length - 1]; if (last.t < t) P.push({ t, rpm: F.rpm, kph: F.v * 3.6, hp: P[P.length - 1].hp, tq: P[P.length - 1].tq });
  // the engine's own peak at the crank, for the loss figure
  let crank = 0; for (let x = 1000; x <= s.red; x += 50) crank = Math.max(crank, tq(s, x) * s.pow * x / 7023.5);
  return { cvt, gear: cvt ? 0 : F.gear, pts: P, T: t, hp: hpMax, hpRpm, hpKph, tq: tqMax, tqRpm, crank, loss: crank ? 1 - hpMax / crank : 0, kphEnd: F.v * 3.6, rpmEnd: F.rpm };
}
