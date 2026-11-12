// Wheeled-vehicle systems for the ECS (js/ecs/ecs.js). Headless and deterministic: `node tools/car.mjs`.
// Components (all plain objects, made by spawnCar in car.js):
//   on the vehicle entity   Body (rigid body, 6 DOF)  Car (spec + wheel ids + speed)  Engine  Gearbox  Input
//   on each wheel entity    Wheel (where it is, spin, steer angle, load, contact)  Susp  Tyre
// Resource: world.res.ground = { h(x, z), n?(x, z, out), mu?(x, z), slick?(x, z), wet? } (the game passes world.js H / tyre.js surfaceMu).
// Order per fixed step (STEP): frame -> control -> susp -> powertrain -> tyre -> body.
// Same tyre curve and wet grip as the bikes (js/tyre.js), so a car and a bike agree on what a road is.
import { clamp, lerpTable } from '../util.js';
import { tyreF, KP, wetGrip } from '../tyre.js';

export const STEP = 1 / 240, G = 9.81, RPM = 30 / Math.PI;
const V0 = .3, UP = [0, 1, 0], N = [0, 0, 0], sgn = Math.sign, abs = Math.abs;

// world = p + R * local (R row-major, columns = the body's left / up / forward)
const toW = (B, x, y, z, o) => { const R = B.R, p = B.p; o[0] = p[0] + R[0] * x + R[1] * y + R[2] * z; o[1] = p[1] + R[3] * x + R[4] * y + R[5] * z; o[2] = p[2] + R[6] * x + R[7] * y + R[8] * z; return o; };
const velAt = (B, P, o) => { const rx = P[0] - B.p[0], ry = P[1] - B.p[1], rz = P[2] - B.p[2], w = B.w; o[0] = B.v[0] + w[1] * rz - w[2] * ry; o[1] = B.v[1] + w[2] * rx - w[0] * rz; o[2] = B.v[2] + w[0] * ry - w[1] * rx; return o; };
const push = (B, fx, fy, fz, P) => { const rx = P[0] - B.p[0], ry = P[1] - B.p[1], rz = P[2] - B.p[2], f = B.f, t = B.t; f[0] += fx; f[1] += fy; f[2] += fz; t[0] += ry * fz - rz * fy; t[1] += rz * fx - rx * fz; t[2] += rx * fy - ry * fx; };
const A = [0, 0, 0], C = [0, 0, 0], VC = [0, 0, 0];

// rotation matrix from the quaternion, forces reset to gravity + air drag
export function frameSys(w) {
  w.each(['Body'], (e, B) => {
    const [x, y, z, s] = B.q, R = B.R, v = B.v, sp = Math.hypot(v[0], v[1], v[2]), k = -B.drag * sp;
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * s); R[2] = 2 * (x * z + y * s);
    R[3] = 2 * (x * y + z * s); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * s);
    R[6] = 2 * (x * z - y * s); R[7] = 2 * (y * z + x * s); R[8] = 1 - 2 * (x * x + y * y);
    B.f[0] = k * v[0]; B.f[1] = k * v[1] - B.m * G; B.f[2] = k * v[2]; B.t[0] = B.t[1] = B.t[2] = 0;
  });
}

// driver input -> steering angle of every steered wheel (Ackermann: both front wheels aim at one turn centre), less lock at speed
export function controlSys(w, dt) {
  w.each(['Car', 'Input', 'Body'], (e, K, I, B) => {
    const sp = K.sp, R = B.R; K.v = B.v[0] * R[2] + B.v[1] * R[5] + B.v[2] * R[8];
    const tgt = clamp(I.steer, -1, 1) * sp.lock / (1 + (K.v / sp.steerV) ** 2), d = clamp(tgt - K.steer, -sp.rate * dt, sp.rate * dt); K.steer += d;
    const t = Math.tan(K.steer);
    for (const id of K.wheels) { const W = w.get(id, 'Wheel'); if (W.L) W.steer = abs(t) < 1e-5 ? 0 : Math.atan(W.L / (W.L / t - W.x)); }
  });
}

// each wheel: ray down the body's own "down" from the wheel's full-bump position to the ground; preloaded spring + damper + bump stop,
// then the anti-roll bar across the axle. Leaves the load (W.N), contact point and ground normal on the wheel.
export function suspSys(w) {
  const g = w.res.ground;
  w.each(['Wheel', 'Susp'], (e, W, S) => {
    const B = w.get(W.car, 'Body'), R = B.R, uy = R[4]; S.x = 0; S.F = 0; W.N = 0; if (uy < .2) return; // on its side / roof: no wheel contact
    toW(B, W.x, W.y + S.bump, W.z, A);
    let t = (A[1] - g.h(A[0], A[2])) / uy; for (let i = 0; i < 2; i++) t += (A[1] - R[4] * t - g.h(A[0] - R[1] * t, A[2] - R[7] * t)) / uy;
    const x = S.bump + S.droop + W.r - t; if (x <= 0) return;
    const c = W.c; c[0] = A[0] - R[1] * t; c[1] = A[1] - R[4] * t; c[2] = A[2] - R[7] * t;
    const n = W.n; if (g.n) g.n(c[0], c[2], n); else { n[0] = 0; n[1] = 1; n[2] = 0; }
    velAt(B, c, VC); const xd = -(VC[0] * n[0] + VC[1] * n[1] + VC[2] * n[2]), tr = S.bump + S.droop;
    S.x = Math.min(x, tr); S.F = S.N0 + S.k * (x - S.droop) + S.c * xd + (x > tr ? S.kb * (x - tr) : 0);
  });
  w.each(['Wheel', 'Susp'], (e, W, S) => {
    if (!S.x) return; let F = S.F; if (W.pair) F += S.arb * (S.x - w.get(W.pair, 'Susp').x);
    if (F <= 0) return; W.N = F; push(w.get(W.car, 'Body'), F * W.n[0], F * W.n[1], F * W.n[2], W.c);
  });
}

// engine -> clutch -> gearbox -> open differential(s): leaves a drive torque on every driven wheel (W.Td) and spins the engine
export function powertrainSys(w, dt) {
  w.each(['Car', 'Engine', 'Gearbox', 'Input'], (e, K, E, X, I) => {
    const sp = K.sp, ng = sp.gears.length;
    // gear lever: sel -1 R / 0 N / 1 D. In D an automatic (or I.auto) shifts by rpm; I.up / I.dn are one-shot manual shifts
    if (I.sel <= 0) X.gear = I.sel; else if (X.gear < 1) X.gear = 1;
    let wm = 0, inv = 0; for (const id of K.wheels) { const W = w.get(id, 'Wheel'); if (W.drive) { wm += W.drive * W.w; inv += W.drive * W.drive / W.Iw; } }
    if (X.t > 0) X.t -= dt;
    else if (X.gear > 0) { // rg = the revs the road speed gives in this gear (not the engine's: the clutch may be slipping)
      const up = sp.upRpm * (.45 + .55 * I.thr), auto = sp.auto || I.auto, rg = abs(wm) * sp.gears[X.gear - 1] * sp.final * RPM; let d = 0;
      if (I.up) d = 1; else if (I.dn) d = -1; else if (auto && rg > up) d = 1; else if (auto && X.gear > 1 && rg * sp.gears[X.gear - 2] / sp.gears[X.gear - 1] < .8 * up && rg < .5 * up) d = -1;
      I.up = I.dn = 0; const g = clamp(X.gear + d, 1, ng); if (g !== X.gear) { X.gear = g; X.t = sp.shiftT; }
    }
    const ratio = X.gear > 0 ? sp.gears[X.gear - 1] * sp.final : X.gear < 0 ? -sp.rev * sp.final : 0; X.ratio = ratio;
    // engine torque: published curve x throttle, friction mostly with the throttle shut, idle governor, rev limiter
    const rpm = E.w * RPM, fr = sp.fric[0] + sp.fric[1] * rpm, T = lerpTable(sp.TQ, rpm);
    let th = E.on ? Math.max(I.thr, rpm < 1.3 * sp.idle ? clamp(fr / (T + .85 * fr) + (sp.idle - rpm) * .004, 0, 1) : 0) : 0; if (rpm > sp.red || X.t > 0 && rpm > 1.3 * sp.idle) th = 0; // limiter; throttle lifted during a shift
    E.thr = th; let Te = T * th - (E.w > 1 ? fr * (1 - .85 * th) : 0), Tc = 0;
    if (ratio) {
      const wg = wm * ratio;
      // clutch: bites as the revs rise off idle (anti-stall), locked once the car is rolling faster than idle in this gear; open while shifting
      const bite = X.t > 0 ? 0 : (1 - I.clutch) * (abs(wg) * RPM > 1.1 * sp.idle ? 1 : clamp((rpm - 1.05 * sp.idle) / (.6 * sp.idle), 0, 1));
      Tc = clamp(.5 * (E.w - wg) / (dt * (1 / sp.ie + ratio * ratio * inv)), -sp.cap * bite, sp.cap * bite);
      const Tw = Tc * ratio * (Tc > 0 ? sp.eta : 1); for (const id of K.wheels) { const W = w.get(id, 'Wheel'); W.Td = Tw * W.drive; }
    } else for (const id of K.wheels) w.get(id, 'Wheel').Td = 0;
    X.bite = Tc; E.w = Math.max(0, E.w + (Te - Tc) * dt / sp.ie); E.rpm = E.w * RPM;
  });
}

// each wheel: combined-slip tyre force on the body at the contact point, then the wheel's own spin (drive, brake, tyre reaction)
export function tyreSys(w, dt) {
  const g = w.res.ground, wet = g.wet || 0;
  w.each(['Wheel', 'Tyre'], (e, W, T) => {
    const I = w.get(W.car, 'Input'), B = w.get(W.car, 'Body'), R = B.R, k = dt / W.Iw;
    const Tb = (I.brk * W.brake + I.hb * W.hb) * k; // brake as the spin it can take off this step
    let wf = W.w + W.Td * k, used = Math.min(abs(wf), Tb); wf -= sgn(wf) * used; const held = Tb - used; // held > 0: the brake has stopped the wheel
    W.Fx = W.Fy = 0;
    if (W.N > 0) {
      const n = W.n, cs = Math.cos(W.steer), sn = Math.sin(W.steer);
      let fx = R[0] * sn + R[2] * cs, fy = R[3] * sn + R[5] * cs, fz = R[6] * sn + R[8] * cs; const d = fx * n[0] + fy * n[1] + fz * n[2];
      fx -= d * n[0]; fy -= d * n[1]; fz -= d * n[2]; const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
      const sx = n[1] * fz - n[2] * fy, sy = n[2] * fx - n[0] * fz, sz = n[0] * fy - n[1] * fx; // left = normal x forward
      velAt(B, W.c, VC); const vx = VC[0] * fx + VC[1] * fy + VC[2] * fz, vy = VC[0] * sx + VC[1] * sy + VC[2] * sz, av = abs(vx) + V0;
      const surf = g.mu ? g.mu(W.c[0], W.c[2]) : 1;
      const Fm = T.mu * surf * clamp(1 - T.ls * (W.N / T.N0 - 1), .6, 1.15) * W.N * wetGrip(wet, vx, T, surf, wet && g.slick ? g.slick(W.c[0], W.c[2]) : 0);
      const ax = (wf * W.r - vx) / av / KP, ay = vy / av / T.tap, a = Math.hypot(ax, ay), F = a > 1e-9 ? Fm * tyreF(a) / a : 0, stop = W.N / G / dt;
      let Fx = F * ax, Fy = clamp(-F * ay, -stop * abs(vy), stop * abs(vy)); // never more than stops the slide within the step
      // a braked-to-a-stop wheel that is barely moving sticks: the contact patch winds up (1 cm = full grip), so a parked car does not creep downhill
      if (held > 0 && abs(vx) < .5) { W.sx = clamp(W.sx + vx * dt, -.01, .01); Fx = clamp(-Fm * W.sx * 100 - 2 * Math.sqrt(Fm * 100 * W.N / G) * vx, -Fm, Fm); }
      else if (held > 0) { W.sx = 0; Fx = clamp(Fx, -stop * abs(vx), stop * abs(vx)); }
      else { W.sx = 0; const Fs = (wf * W.r - vx) / (W.r * W.r * k); if (Fx * Fs <= 0 || abs(Fs) < abs(Fx)) Fx = clamp(Fs, -Fm, Fm); } // rolling: at most what brings the wheel to road speed
      const Fr = -T.crr * W.N * vx / av; W.Fx = Fx; W.Fy = Fy; W.slip = ax * KP;
      push(B, (Fx + Fr) * fx + Fy * sx, (Fx + Fr) * fy + Fy * sy, (Fx + Fr) * fz + Fy * sz, W.c);
      const dw = -Fx * W.r * k; wf = held > 0 ? (abs(dw) <= held ? 0 : dw - sgn(dw) * held) : wf + dw;
    }
    W.w = wf; W.rot += wf * dt;
  });
}

// body shell against the ground (8 corners, so a rolled car lies on its roof instead of falling through), then integrate
export function bodySys(w, dt) {
  const g = w.res.ground;
  w.each(['Body'], (e, B) => {
    const m = B.m, R = B.R, f = B.f, t = B.t, v = B.v, o = B.w, I = B.I;
    for (const c of B.box) {
      toW(B, c[0], c[1], c[2], C); const pen = g.h(C[0], C[2]) - C[1]; if (pen <= 0) continue;
      velAt(B, C, VC); const Fn = Math.max(0, m * (400 * pen - 20 * VC[1])), vt = Math.hypot(VC[0], VC[2]), Ft = vt > 1e-6 ? -Math.min(.6 * Fn, m * vt / (8 * dt)) / vt : 0;
      push(B, Ft * VC[0], Fn, Ft * VC[2], C); B.hit = 1;
    }
    for (let i = 0; i < 3; i++) v[i] += f[i] / m * dt;
    const bx = (R[0] * t[0] + R[3] * t[1] + R[6] * t[2]) / I[0], by = (R[1] * t[0] + R[4] * t[1] + R[7] * t[2]) / I[1], bz = (R[2] * t[0] + R[5] * t[1] + R[8] * t[2]) / I[2];
    o[0] += (R[0] * bx + R[1] * by + R[2] * bz) * dt; o[1] += (R[3] * bx + R[4] * by + R[5] * bz) * dt; o[2] += (R[6] * bx + R[7] * by + R[8] * bz) * dt;
    for (let i = 0; i < 3; i++) B.p[i] += v[i] * dt;
    const q = B.q, [x, y, z, s] = q, h = .5 * dt;
    q[0] += h * (o[0] * s + o[1] * z - o[2] * y); q[1] += h * (o[1] * s + o[2] * x - o[0] * z); q[2] += h * (o[2] * s + o[0] * y - o[1] * x); q[3] -= h * (o[0] * x + o[1] * y + o[2] * z);
    const l = Math.hypot(q[0], q[1], q[2], q[3]); q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  });
}
