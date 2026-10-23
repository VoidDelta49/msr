// Bike solver: engine, clutch-slip drivetrain, steering/lean, plus the bump-stop helper the Rapier chassis uses.
// Everything bike-specific comes from ctx.spec (data) and ctx.drive (manual / cvt).
import { PI, clamp, sstep } from './util.js';
import { S, ctx } from './state.js';
import { tq } from './spec.js';
import { say } from './hud.js';

// Engine, drivetrain, speed along the ground and steering. Rapier (rapier.js) owns position, heave and pitch.
export function step(dt) {
  const sp = ctx.spec, D = ctx.drive, b = ctx.bcfg, m = sp.m, r = sp.r, v = S.v, av = Math.abs(v);
  D.pre(sp, S, dt, b);
  // engine
  if (S.running && S.lim && S.rpm < sp.red - 150) S.lim = false; if (S.rpm >= sp.red) S.lim = true;
  const thr = S.running && !S.lim && S.cutT <= 0 ? S.thr : 0;
  const idleT = S.running ? clamp((sp.idle + 100 - S.rpm) / 400, 0, 1) * .35 : 0;
  S.thrEff = Math.max(thr, idleT);
  const we = S.rpm * PI / 30, Tdrive = S.running ? S.thrEff * tq(sp, S.rpm) * sp.pow : 0;
  // published torque is already net at the crank, so friction/pumping loss mostly shows with the throttle shut
  // (engine braking, rev decay); at full throttle only a small part is left
  const Te = Tdrive - (we > .5 ? (sp.fric[0] + sp.fric[1] * S.rpm) * (1 - .85 * S.thrEff) + (S.running ? 0 : 1.5) : 0);
  // drivetrain: variator / gearbox state, then clutch capacity and overall ratio
  D.update(sp, S, dt, Tdrive, b);
  const cap = D.clutch(sp, S, b, av), c = S.c;
  // on the garage stand the rear wheel is off the ground: free-rev, no drive
  const R = ctx.stand ? 0 : D.ratio(sp, S), Fb = S.brake * sp.mu * m * 9.81 * sp.brake;
  const Fg = -m * 9.81 * Math.sin(Math.atan((S.hF - S.hR) / sp.wb));
  const netF = (Fd, vv) => { let F = Fd + Fg - (sp.drag * vv * vv + (vv > .02 ? sp.roll : 0)); if (vv > .02) F -= Fb; else F = F > 0 ? Math.max(0, F - Fb - sp.roll) : 0; return F; };
  // BACK: bikes have no reverse gear, so the rider paddles it backwards with his feet (~3 km/h). Only when (nearly)
  // stopped, throttle shut, and nothing driving the rear wheel (neutral / clutch pulled; the CVT clutch is open at idle).
  const canBack = S.back && v <= .3 && S.thr < .05 && (R === 0 || c < .15);
  if (S.back && !canBack && !S.backWarned) { S.backWarned = true; say(v > .3 ? 'Stop first to walk it back' : S.thr >= .05 ? 'Let go of the throttle' : 'Shift to N or pull the clutch to walk it back', 1400); }
  if (!S.back) S.backWarned = false;
  let a = 0;
  if (canBack) { S.v = Math.max(-.9, Math.min(v, 0) - 1.2 * dt); S.rpm = Math.max(0, (we + Te / sp.ie * dt) * 30 / PI); }
  else if (v < 0) { S.v = Math.min(0, v + 4 * dt); S.rpm = Math.max(0, (we + Te / sp.ie * dt) * 30 / PI); }
  else if (R > 0 && cap > .05) {
    const RL = (sp.red + 300) * PI / 30, over = v / r * R > RL, slip = we - v / r * R, M = m + sp.ie * R * R / (r * r);
    const aL = netF(Te * R / r * sp.eta, v) / M, TcL = Te - sp.ie * aL * R / r;
    if (!over && Math.abs(slip) < 3 && Math.abs(TcL) <= cap) { a = aL; S.v = Math.max(0, v + a * dt); S.rpm = S.v / r * R * 30 / PI; }
    else {
      const Tc = over ? -Math.min(cap, 8) : cap * Math.sign(slip || TcL); let nwe = we + (Te - Tc) / sp.ie * dt; a = netF(Tc * R / r * sp.eta, v) / m; const nv = Math.max(0, v + a * dt), nwl = nv / r * R;
      if (!over && slip && Math.sign(nwe - nwl) !== Math.sign(slip)) nwe = nwl; nwe = Math.min(nwe, RL); S.v = nv; S.rpm = Math.max(0, nwe * 30 / PI);
    }
  } else { S.rpm = clamp((we + Te / sp.ie * dt) * 30 / PI, 0, sp.red + 100); a = netF(0, v) / m; S.v = Math.max(0, v + a * dt); }
  S.a = a; S.odo += Math.abs(S.v) * dt;
  if (S.running && S.rpm < 650) { S.running = false; S.rpm = 0; say('Stalled. Press START (R)'); }
  if (!S.running && S.rpm < 200 && !(R > 0 && c > .5)) S.rpm = Math.max(0, S.rpm - 3000 * dt);
  if (S.running) { S.fuel -= dt * (sp.fuel.idle + sp.fuel.k * S.thrEff * S.rpm / sp.red0); if (S.fuel <= 0) { S.fuel = 0; S.running = false; S.issOff = false; say('Out of fuel!'); } }
  // steering, lean, yaw
  const vv = S.v, sv = Math.abs(vv), si = Math.sign(S.steer) * Math.pow(Math.abs(S.steer), 1.4), md = .6 / (1 + Math.pow(sv * .3, 1.5));
  let kk = Math.tan(si * md) / sp.wb; const kl = sp.mu * 9.81 * .95 / Math.max(vv * vv, .01); S.over = Math.abs(kk) / kl; kk = clamp(kk, -kl, kl); // over > 1: asking more grip than the tyres have
  const hb = sstep(3, 8, sv), tl = Math.atan(vv * vv * kk / 9.81) * (1 - hb) + si * Math.atan(sp.mu * .9) * hb; S.lean += (tl - S.lean) * Math.min(1, dt * 4);
  const kd = 9.81 * Math.tan(S.lean) / Math.max(vv * vv, .01), bl = sstep(2, 6, sv), k = kk * (1 - bl) + kd * bl; S.delta = Math.atan(k * sp.wb);
  S.yaw = -vv * k; S.psi += S.yaw * dt;
  const fx = -Math.sin(S.psi), fz = -Math.cos(S.psi); S.x += fx * vv * dt; S.z += fz * vv * dt; S.wA += vv / r * dt;
}


// Hard limit at full travel: lift the chassis at that axle (pivoting on the other one) until it is back at the stop,
// and remove the velocity still compressing it. Shared by Classic and Rapier. Returns [zH, th, zV, thV].
const BS = [0, 0, 0, 0], BT = .5; // BT: share of the ground's rise speed the chassis takes on (the tyre soaks up the rest)
export function bumpStop(sp, zH, th, zV, thV, hF, hR, dhF, dhR) {
  const wb = sp.wb, lf = sp.lf, lr = sp.lr;
  let e = hF - (zH + lf * th) - sp.travel[0];
  if (e > 0) { zH += e * lr / wb; th += e / wb; const vr = dhF - (zV + lf * thV); if (vr > 0) { zV += vr * BT * lr / wb; thV += vr * BT / wb; } }
  e = hR - (zH - lr * th) - sp.travel[1];
  if (e > 0) { zH += e * lf / wb; th -= e / wb; const vr = dhR - (zV - lr * thV); if (vr > 0) { zV += vr * BT * lf / wb; thV -= vr * BT / wb; } }
  BS[0] = zH; BS[1] = th; BS[2] = zV; BS[3] = thV; return BS;
}
