// Bike solver: engine, clutch-slip drivetrain, steering/lean, plus the bump-stop helper the Rapier chassis uses.
// Everything bike-specific comes from ctx.spec (data) and ctx.drive (manual / cvt).
import { PI, clamp, sstep } from './util.js';
import { S, ctx } from './state.js';
import { tq } from './spec.js';
import { say } from './hud.js';
import { igPre, igPost } from './ignition.js';
import { KP, KS, MUX, BRK, tyreF } from './tyre.js';
import { cfg } from './config.js';

// Wheelie / stoppie: the bike pitches as a rigid body about the contact patch of the wheel still on the ground (rear for a wheelie,
// front for a stoppie). Net longitudinal acceleration a acts at the CG height h, gravity pulls it back; wp is the angle off the ground
// (+ front up, - rear up), wpv its rate. It only starts once the load transfer has unloaded the other wheel (a > g lr / h, or
// a < -g lf / h); the balance point is unstable, so it needs throttle / rear brake to hold, and a light rider damping.
const WMAX = 1.25;
function pitchUp(sp, a, dt) {
  let p = S.wp || 0, pv = S.wpv || 0;
  if (S.air || ctx.stand) { S.wp = S.wpv = 0; return; }
  // the trigger looks at a smoothed acceleration with a margin, so a one-step spike (clutch dump, grip returning after wheelspin,
  // brake release) can't tip the bike up; once it is up the real acceleration drives it
  const g = 9.81, h = sp.h, af = S.af = (S.af || 0) + (a - (S.af || 0)) * Math.min(1, dt / .15), M = 1.12;
  const up = p > 0 || p === 0 && af * h > M * g * sp.lr, dn = !up && (p < 0 || -af * h > M * g * sp.lf);
  if (!up && !dn) return;
  const L = up ? sp.lr : sp.lf, sg = up ? 1 : -1, q0 = Math.abs(p), sn = Math.sin(q0), cs = Math.cos(q0);
  let qv = pv * sg;
  qv += ((sg * a * (L * sn + h * cs) - g * (L * cs - h * sn)) / (sp.I / sp.m + L * L + h * h) - 1.5 * qv) * dt;
  let q = q0 + qv * dt;
  if (q <= 0) { S.wpHit = Math.max(0, -qv); q = qv = 0; } else if (q > WMAX) { q = WMAX; qv = Math.min(qv, 0); }
  S.wp = sg * q; S.wpv = sg * qv;
}

// net force along the ground for drive force Fd at speed vv (module-level instead of a closure: no allocation per substep)
const NF = { sp: null, Fg: 0, Fb: 0 };
function netF(Fd, vv) { const sp = NF.sp, Fb = NF.Fb; let F = Fd + NF.Fg - (sp.drag * vv * vv + (vv > .02 ? sp.roll : 0)); if (vv > .02) F -= Fb; else F = F > 0 ? Math.max(0, F - Fb - sp.roll) : 0; return F; }
// Engine, drivetrain, speed along the ground and steering. Rapier (rapier.js) owns position, heave and pitch.
export function step(dt) {
  const sp = ctx.spec, D = ctx.drive, b = ctx.bcfg, m = sp.m, r = sp.r, v = S.v, av = Math.abs(v);
  D.pre(sp, S, dt, b); igPre(dt);
  // engine
  if (S.running && S.lim && S.rpm < sp.red - 150) S.lim = false; if (S.rpm >= sp.red) S.lim = true;
  const thr = S.running && !S.lim && S.cutT <= 0 ? S.thr : 0;
  // idle control: opens the throttle just enough to cover the engine's own friction at the idle target (x0 = zero net torque), with
  // only ~30% spare below it. Enough to catch the revs and creep in 1st, not enough to pull the bike along in the higher gears
  const fr0 = sp.fric[0] + sp.fric[1] * S.rpm, x0 = fr0 / (tq(sp, S.rpm) * sp.pow + .85 * fr0);
  const idleT = S.running ? Math.min(1, x0 * clamp(1 + (sp.idle + (S.fi || 0) - S.rpm) / 150, 0, 1.3)) : 0;
  S.thrEff = Math.max(thr, idleT);
  // wheelie limiter: the balance point is unstable, so drive fades out as the nose rises and the bike settles instead of running away
  let wl = 1 - .92 * sstep(.12, .55, S.wp || 0); const sl = 1 - .92 * sstep(.12, .5, -(S.wp || 0));
  // wheelie control (Options, on by default): the ECU trims torque as the acceleration nears the lift point and cuts it once the
  // front leaves the ground. Cuts fast, gives drive back gently, so the front stays down or only skims up
  if (cfg.wc !== false && !ctx.stand) {
    const aw = 9.81 * sp.lr / sp.h, tgt = clamp((1.04 * aw - (S.af || 0)) / (.14 * aw), 0, 1) * (1 - sstep(0, .04, S.wp || 0));
    S.wcF = (S.wcF ?? 1) + (tgt - (S.wcF ?? 1)) * Math.min(1, dt / (tgt < (S.wcF ?? 1) ? .03 : .3)); wl *= S.wcF;
  } else S.wcF = 1;
  const we = S.rpm * PI / 30, Tdrive = S.running ? S.thrEff * tq(sp, S.rpm) * sp.pow * wl : 0;
  // published torque is already net at the crank, so friction/pumping loss mostly shows with the throttle shut
  // (engine braking, rev decay); at full throttle only a small part is left
  const Te = Tdrive - (we > .5 ? (sp.fric[0] + sp.fric[1] * S.rpm) * (1 - .85 * S.thrEff) + (S.running ? 0 : 1.5) : 0);
  // drivetrain: variator / gearbox state, then clutch capacity and overall ratio
  D.update(sp, S, dt, Tdrive, b);
  const cap = D.clutch(sp, S, b, av), c = S.c;
  // on the garage stand the rear wheel is off the ground: free-rev, no drive
  const R = ctx.stand ? 0 : D.ratio(sp, S);
  // tyres. Axle loads = static split + load transfer under accel/braking; peak tyre force = grip (bike x surface) x load.
  // Load transfer is not capped: past a = g lr / h the front is unloaded (wheelie, wp > 0), past -g lf / h the rear is (stoppie, wp < 0).
  const g = 9.81, mu = sp.mu * (S.surf || 1), mt = mu * MUX, mw = (sp.Iw || .6) / (r * r), wp = S.wp || 0, offF = wp > .04, offR = wp < -.04;
  const Nr = offF ? .97 * m * g : offR ? .03 * m * g : clamp(m * g * sp.lf / sp.wb + clamp(m * (S.a || 0) * sp.h / sp.wb, -m * g, m * g), .03 * m * g, .97 * m * g), Pr = mt * Nr, Pf = mt * (m * g - Nr);
  const ayu = S.ayu || 0, Pxr = Pr * Math.sqrt(1 - ayu * ayu); // rear force left once cornering has taken its share (friction circle)
  // brakes: lever force split front/rear (bf). Past a tyre's peak the wheel locks and only slides (KS x peak) until the
  // brake is eased well off; ABS bikes hold each wheel at its peak instead. Standing still nothing locks.
  const Fc = S.brake * sl * sp.brake * sp.mu * BRK * m * g, Fcf = Fc * (sp.bf ?? .85), Fcr = Fc - Fcf, rolling = av > .8 && !S.air;
  // a wheel that is in the air (wheelie / stoppie) can't lock and only passes what little load it has
  const lkF = rolling && !sp.abs && !offF && (S.lkF ? Fcf > .9 * KS * Pf : Fcf > 1.05 * Pf), lkR = rolling && !sp.abs && !offR && (S.lkR ? Fcr > .9 * KS * Pr : Fcr > 1.05 * Pr);
  S.lkF = lkF; S.lkR = lkR;
  const Fbf = lkF ? KS * Pf : rolling && (sp.abs || offF) ? Math.min(Fcf, .97 * Pf) : Fcf, Fbr = lkR ? KS * Pr : rolling && (sp.abs || offR) ? Math.min(Fcr, .97 * Pr) : Fcr, Fb = Fbf + Fbr;
  const Fg = -m * 9.81 * Math.sin(Math.atan((S.hF - S.hR) / sp.wb));
  NF.sp = sp; NF.Fg = Fg; NF.Fb = Fb;
  // BACK: bikes have no reverse gear, so the rider paddles it backwards with his feet (~3 km/h). Only when (nearly)
  // stopped, throttle shut, and nothing driving the rear wheel (neutral / clutch pulled; the CVT clutch is open at idle).
  const canBack = S.back && v <= .3 && S.thr < .05 && (R === 0 || c < .15);
  if (S.back && !canBack && !S.backWarned) { S.backWarned = true; say(v > .3 ? 'Stop first to walk it back' : S.thr >= .05 ? 'Let go of the throttle' : 'Shift to N or pull the clutch to walk it back', 1400); }
  if (!S.back) S.backWarned = false;
  let a = 0, fxr = 0;
  if (canBack || v < 0 || !(R > 0 && cap > .05)) S.ws = 0; // rear wheel speed minus ground speed, only while it spins / skids
  if (canBack) { S.v = Math.max(-.9, Math.min(v, 0) - 1.2 * dt); S.rpm = Math.max(0, (we + Te / sp.ie * dt) * 30 / PI); }
  else if (v < 0) { S.v = Math.min(0, v + 4 * dt); S.rpm = Math.max(0, (we + Te / sp.ie * dt) * 30 / PI); }
  else if (R > 0 && cap > .05) {
    const capB = sp.slipper ? Math.min(cap, sp.slipper) : cap; // slipper clutch: less capacity when the wheel drives the engine
    const k1 = R / r, Me = sp.ie * k1 * k1, RL = (sp.red + 300) * PI / 30;
    let ws = S.ws || 0, vw = Math.max(0, v + ws), over = vw * k1 > RL, slip = we - vw * k1, spin = ws !== 0, Tc = 0, locked = false;
    if (!spin) { // wheel gripping: wheel speed = ground speed, the existing locked / slipping-clutch solution
      const aL = netF(Te * k1 * sp.eta, v) / (m + mw + Me), TcL = Te - sp.ie * aL * k1;
      locked = !over && Math.abs(slip) < 3 && (TcL >= 0 ? TcL <= cap : -TcL <= capB);
      Tc = locked ? TcL : over ? -Math.min(cap, 8) : Math.sign(slip || TcL) > 0 ? cap : Math.sign(slip || TcL) < 0 ? -capB : 0;
      fxr = Tc * k1 * sp.eta;
      if (Math.abs(fxr) > Pxr) { spin = true; ws = Math.sign(fxr) * KP * Math.max(v, 1.5) * 1.001; vw = v + ws; } // more than the tyre can hand over: it lets go
      else if (locked) { a = aL; S.v = Math.max(0, v + a * dt); S.rpm = S.v * k1 * 30 / PI; }
      else {
        let nwe = we + (Te - Tc) / sp.ie * dt; a = netF(fxr, v) / m; const nv = Math.max(0, v + a * dt), nwl = nv * k1;
        if (!over && slip && Math.sign(nwe - nwl) !== Math.sign(slip)) nwe = nwl; nwe = Math.min(nwe, RL); S.v = nv; S.rpm = Math.max(0, nwe * 30 / PI);
      }
    }
    if (spin) { // wheelspin (ws > 0) or an engine-braking skid (ws < 0): tyre force from the slip curve, wheel speed its own state
      const sg = Math.sign(ws), vs = Math.max(v, 1.5), Fx = sg * Pxr * tyreF(Math.abs(ws) / vs / KP);
      let aw = (Te * k1 * sp.eta - Fx) / (mw + Me), Tcs = Te - sp.ie * aw * k1;
      const lk = !over && Math.abs(slip) < 3 && (Tcs >= 0 ? Tcs <= cap : -Tcs <= capB);
      if (!lk) { Tcs = over ? -Math.min(cap, 8) : slip > 0 ? cap : slip < 0 ? -capB : 0; aw = (Tcs * k1 * sp.eta - Fx) / mw; }
      a = netF(Fx, v) / m; fxr = Fx;
      const nv = Math.max(0, v + a * dt), nvw = Math.max(0, vw + aw * dt), nws = nvw - nv;
      let nwe = lk ? nvw * k1 : we + (Te - Tcs) / sp.ie * dt;
      if (!lk && !over && slip && Math.sign(nwe - nvw * k1) !== Math.sign(slip)) nwe = nvw * k1;
      S.v = nv; S.rpm = Math.max(0, Math.min(nwe, RL) * 30 / PI);
      // grips again once the slip is back under the peak and what the clutch passes fits the tyre (the clutch then pulls rpm to the wheel)
      S.ws = sg * nws < 0 || sg * nws < KP * vs && Math.abs(Tcs * k1 * sp.eta) < .95 * Pxr ? 0 : nws;
      // regrip with the clutch locked: the engine is tied to that wheel, so it comes back to ground speed with it. Otherwise it kept
      // the spinning wheel's rpm, the next step saw a big clutch slip, pushed full clutch torque into the tyre and spun it up again:
      // a loop that kept driving the bike with the throttle shut
      if (!S.ws && lk) S.rpm = Math.min(nv * k1, RL) * 30 / PI;
    }
  } else { S.rpm = clamp((we + Te / sp.ie * dt) * 30 / PI, 0, sp.red + 100); a = netF(0, v) / m; S.v = Math.max(0, v + a * dt); }
  S.fxr = fxr; S.a = a; S.odo += Math.abs(S.v) * dt;
  pitchUp(sp, a, dt);
  if (S.running && S.rpm < 650) { S.running = false; S.rpm = 0; say('Stalled. Press START (R)'); }
  if (!S.running && S.rpm < 200 && !(R > 0 && c > .5)) S.rpm = Math.max(0, S.rpm - 3000 * dt);
  if (S.running) { S.fuel -= dt * (sp.fuel.idle + sp.fuel.k * S.thrEff * S.rpm / sp.red0); if (S.fuel <= 0) { S.fuel = 0; S.running = false; S.issOff = false; say('Out of fuel!'); } }
  igPost(dt);
  // steering, lean, yaw
  const vv = S.v, sv = Math.abs(vv), si = Math.sign(S.steer) * Math.pow(Math.abs(S.steer), 1.4) * (offF ? 1 - .8 * sstep(.04, .3, wp) : 1), md = .6 / (1 + Math.pow(sv * .3, 1.5));
  // friction circle: braking / driving force uses up grip the corner needs; a locked or spinning tyre has little left
  const spun = (lkR || S.ws) && !offR, fl = lkF ? .3 : Math.sqrt(1 - Math.min(.85, Fbf / Math.max(Pf, 1)) ** 2), rl = spun ? .5 : Math.sqrt(1 - Math.min(.85, (Math.abs(fxr) + Fbr) / Math.max(Pr, 1)) ** 2);
  // asked curvature: steering geometry at walking pace; at speed the bar asks for a share of the grip (full lock = 90% of it, the
  // rider backing off by half of what braking / drive takes from the corner), so only hard braking, a locked front or wheelspin
  // mid-corner at full lock asks clearly more than the tyres have
  const hb = sstep(3, 8, sv), gc = Math.min(fl, rl), v2 = Math.max(vv * vv, .01);
  let kk = Math.tan(si * md) / sp.wb * (1 - hb) + si * .9 * (.5 + .5 * gc) * mu * g / v2 * hb; const kl = mu * g * .95 * gc / v2; S.over = Math.abs(kk) / kl; kk = clamp(kk, -kl, kl); // over > 1: asking more grip than the tyres have
  S.ayu = Math.min(.95, vv * vv * Math.abs(kk) / (mu * g * .95)); S.skid = lkF || spun ? Math.min(1, (v + (S.ws || 0)) / 3) : 0; // skid: tyre noise
  const tl = Math.atan(vv * vv * kk / 9.81);
  // lean is a damped roll: the bike swings toward the lean the steering / corner asks for with roll inertia (heavy bikes are slower,
  // a bit of overshoot when flicked), and the faster it goes the stiffer and more damped it gets (gyro effect). Roll rate is capped.
  const wn = 6.5 / (1 + sv * .02) * clamp(Math.sqrt(40 / sp.I), .7, 1.2), zt = .75 + Math.min(.35, sv * .012);
  S.leanV = clamp((S.leanV || 0) + (wn * wn * (tl - S.lean) - 2 * zt * wn * (S.leanV || 0)) * dt, -2.2, 2.2); S.lean += S.leanV * dt;
  const kd = 9.81 * Math.tan(S.lean) / Math.max(vv * vv, .01), bl = sstep(2, 6, sv), k = kk * (1 - bl) + kd * bl; S.delta = Math.atan(k * sp.wb);
  S.yaw = -vv * k; if (spun) S.yaw -= Math.sign(S.lean) * .5 * Math.min(1, Math.abs(S.lean) * 4) * sstep(2, 8, sv); // rear steps out into the turn
  S.psi += S.yaw * dt;
  const fx = -Math.sin(S.psi), fz = -Math.cos(S.psi); S.x += fx * vv * dt; S.z += fz * vv * dt; S.wA += (lkF ? 0 : vv / r) * dt; S.wAR = (S.wAR || 0) + (lkR ? 0 : (vv + (S.ws || 0)) / r) * dt;
}


// Hard limit at full travel: lift the chassis at that axle (pivoting on the other one) until it is back at the stop,
// and remove the velocity still compressing it. Shared by Classic and Rapier. Returns [zH, th, zV, thV].
const BS = [0, 0, 0, 0], BT = .5; // BT: share of the ground's rise speed the chassis takes on (the tyre soaks up the rest)
export function bumpStop(sp, zH, th, zV, thV, hF, hR, dhF, dhR) {
  const wb = sp.wb, lf = sp.lf, lr = sp.lr;
  let e = hF + sp.yf - (zH + lf * th) - sp.travel[0]; // yf/yr: ride height, the whole stroke sits that much higher
  if (e > 0) { zH += e * lr / wb; th += e / wb; const vr = dhF - (zV + lf * thV); if (vr > 0) { zV += vr * BT * lr / wb; thV += vr * BT / wb; } }
  e = hR + sp.yr - (zH - lr * th) - sp.travel[1];
  if (e > 0) { zH += e * lf / wb; th -= e / wb; const vr = dhR - (zV - lr * thV); if (vr > 0) { zV += vr * BT * lf / wb; thV -= vr * BT / wb; } }
  BS[0] = zH; BS[1] = th; BS[2] = zV; BS[3] = thV; return BS;
}
