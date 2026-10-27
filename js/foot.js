// On-foot character: walk / sprint / jump, collide with the island's footprint boxes and the parked bike, stay out of the
// water, follow the ground. No animation. Pure logic (no three.js, no DOM) so tools/test.mjs can run it headless: the ground,
// the sea level and the collision boxes are injected with footEnv() (main.js passes world.js's H, SEA and OBBS).
// S (state.js) stays the BIKE's state the whole time: the bike is parked where it was (main.js holds it still) and the walker has
// its own state F. Conventions match the bike's: psi 0 faces -z, forward = (-sin psi, -cos psi), the bike's right = (cos psi, -sin psi).
// F.cy is the camera's azimuth (the camera sits at F + (sin cy, cos cy) * dist): W walks away from it.
// Feel (build 11.38): speed eases in with a push (ACC) and out with friction (FRIC0 + FRICK * speed), sprint ramps in and out (F.rs 0..1),
// the jump has coyote time + an input buffer + variable height, and the camera state (view bob F.bp / F.ba, landing / take-off spring
// F.dip) lives here so it is deterministic and testable; footfig.js only reads it.
import { S, ctx } from './state.js';

export const F = { on: false, fp: false, eye: 1.4, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, psi: 0, cy: 0, cp: .25, gnd: true, spd: 0,
  rs: 0,             // sprint amount 0..1 (eased)
  bp: 0, ba: 0,      // view-bob phase (advances with distance walked, radians) and amplitude 0..1
  dip: 0, dv: 0,     // camera spring (m, m/s): kicked down by take-off and landing, settles back to 0
  coy: 0, jb: 0,     // coyote time left (s), jump buffer left (s)
  land: 0, t: 0 };   // fall speed of the last touchdown (m/s), walker clock (s)
export const FC = {
  R: .3,        // body radius (m)
  WALK: 2.8, RUN: 6.2, // m/s
  ACC: 22,      // m/s^2 pushing toward the wanted velocity on the ground
  REV: 1.6,     // extra push when the wanted direction opposes the current one (quick turn-around)
  FRIC0: 7, FRICK: 6, // let go of the stick: drag = FRIC0 + FRICK * speed (m/s^2): a firm stop with a soft tail, not a dead halt
  AIR: 5,       // m/s^2 steering in the air (no drag in the air)
  RS_IN: .28, RS_OUT: .18, // seconds for sprint to build up / drop off
  G: 20, JUMP: 6.2,    // snappier than real gravity; apex ~0.96 m when the jump is held
  CUT: 1.7,     // gravity multiplier while rising with the jump released (a tap = a short hop, ~0.56 m)
  COY: .1, JBUF: .12,  // jump still works this long after walking off an edge / when pressed this early before landing (s)
  TURN: 16, TK: 14,    // the body turns toward the walking direction: eased (TK) and capped at TURN rad/s
  STEP: .55,           // highest ledge walked up in one go (m)
  DROP: .4,            // ground-following: a drop bigger than this is a fall
  STRIDE: 3.7,         // view-bob phase per metre walked (rad): one full cycle = left + right step = 1.7 m
  DK: 150, DC: 12,     // camera spring stiffness / damping (~0.5 damping ratio: one soft overshoot)
  REACH: 2.2,          // get on the bike from within this distance of its middle
  MAXV: 1.5,           // get off only when the bike is slower than this (m/s)
};
let env = null;
export const footEnv = e => { env = e; };

// bike footprint(s) as boxes in the OBB format of world.js: a lying capsule is ~.6 x 1.8 m; a sidecar adds a second box on the right
export function bikeBoxes(b, sc) {
  const c = Math.cos(b.psi), s = -Math.sin(b.psi), lx = Math.cos(b.psi), lz = -Math.sin(b.psi), out = [{ cx: b.x, cz: b.z, hx: .32, hz: .95, c, s }];
  if (sc) out.push({ cx: b.x + lx * sc * .95, cz: b.z + lz * sc * .95, hx: .5, hz: 1, c, s });
  return out;
}
const bikeNow = () => bikeBoxes(S, ctx.spec && ctx.spec.sc);

// push the circle (P.x, P.z, r) out of box b; false if it didn't touch. Removes the velocity going into the surface.
function resolve(P, b, r) {
  const dx = P.x - b.cx, dz = P.z - b.cz;
  if (Math.abs(dx) > b.hx + b.hz + r || Math.abs(dz) > b.hx + b.hz + r) return false; // far (hx + hz bounds the half-diagonal)
  const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;                           // into the box's frame
  if (Math.abs(lx) >= b.hx + r || Math.abs(lz) >= b.hz + r) return false;
  const qx = Math.max(-b.hx, Math.min(b.hx, lx)), qz = Math.max(-b.hz, Math.min(b.hz, lz));
  let nx = lx - qx, nz = lz - qz, push;
  const d = Math.hypot(nx, nz);
  if (d > 1e-6) { if (d >= r) return false; push = r - d; nx /= d; nz /= d; }
  else { const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz); if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; } } // centre inside: out through the nearest face
  const wx = b.c * nx - b.s * nz, wz = b.s * nx + b.c * nz;                            // normal back in world axes
  P.x += wx * push; P.z += wz * push;
  const vn = P.vx * wx + P.vz * wz; if (vn < 0) { P.vx -= vn * wx; P.vz -= vn * wz; }
  return true;
}
// is a standing circle at (x, z) clear of every box (walls, bike)?
function clear(x, z, bikes) {
  const P = { x, z, vx: 0, vz: 0 };
  for (const b of env.OBBS) if (Math.abs(b.cx - x) < 60 && Math.abs(b.cz - z) < 60 && resolve(P, b, FC.R)) return false;
  for (const b of bikes) if (resolve(P, b, FC.R)) return false;
  return true;
}
// walkable ground: not the sea, not a wall of earth taller than a step above where we are
const blocked = (x, z, y) => { const h = env.H(x, z); return h < env.SEA + .15 || h > y + FC.STEP; };

// Why you can't get off right now ('' = you can).
export function offBlock() {
  if (!env) return 'Not ready';
  if (S.crashed) return 'Wait for the bike to get up';
  if (S.wet) return 'Not in the water';
  if (Math.abs(S.v) > FC.MAXV || S.air) return 'Stop the bike first';
  return '';
}
// Get off on the bike's left (the sidecar is on the right), else the right / behind / in front: first spot that is free.
export function dismount() {
  const why = offBlock(); if (why) return why;
  const bk = bikeNow(), lx = Math.cos(S.psi), lz = -Math.sin(S.psi), fx = -Math.sin(S.psi), fz = -Math.cos(S.psi), sc = ctx.spec && ctx.spec.sc ? 1 : 0;
  const C = [[-lx * .95, -lz * .95], [-lx * 1.1 - fx * .6, -lz * 1.1 - fz * .6], [lx * (sc ? 2.4 : .95), lz * (sc ? 2.4 : .95)], [fx * 1.7, fz * 1.7], [-fx * 1.7, -fz * 1.7], [-lx * 1.6, -lz * 1.6]];
  const gy = env.H(S.x, S.z);
  for (const [ox, oz] of C) {
    const x = S.x + ox, z = S.z + oz; if (blocked(x, z, gy) || !clear(x, z, bk)) continue;
    Object.assign(F, { on: true, x, z, y: env.H(x, z), vx: 0, vy: 0, vz: 0, psi: S.psi, cy: S.psi, cp: .25, gnd: true, spd: 0, rs: 0, bp: 0, ba: 0, dip: 0, dv: 0, coy: 0, jb: 0, land: 0, t: 0 }); return '';
  }
  return 'No room to get off here';
}
export const nearBike = () => Math.hypot(F.x - S.x, F.z - S.z) < FC.REACH && F.gnd;
// Get back on if close enough; the bike is exactly where it was parked.
export function mount() { if (!F.on) return ''; if (!nearBike()) return 'Walk up to the bike first'; F.on = false; return ''; }

const TAU = 2 * Math.PI, wrap = a => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
// inp: { mx, mz } stick (mx right, mz forward, camera-relative, length <= 1; shorter = slower), run, jump (pressed this frame OR held),
// held (jump button still down; only false cuts a rising jump short, undefined = don't cut)
function sub(inp, h) {
  const L = Math.hypot(inp.mx, inp.mz), mag = Math.min(1, L), sy = Math.sin(F.cy), cy = Math.cos(F.cy);
  const ux = L > 1e-6 ? inp.mx / L : 0, uz = L > 1e-6 ? inp.mz / L : 0;           // stick direction, camera-relative
  const dx = -sy * uz + cy * ux, dz = -cy * uz - sy * ux;                           // forward = (-sin cy, -cos cy), right = (cos cy, -sin cy)
  F.t += h;
  // sprint builds up and drops off smoothly; in first person walking backwards can't sprint and strafing / backpedalling are slower
  const canRun = !!inp.run && mag > .3 && !(F.fp && uz < -.3);
  F.rs += Math.max(-h / FC.RS_OUT, Math.min(h / FC.RS_IN, (canRun ? 1 : 0) - F.rs));
  const sc = F.fp ? 1 - .3 * Math.max(0, -uz) - .12 * Math.abs(ux) : 1;
  const tsp = (FC.WALK + (FC.RUN - FC.WALK) * F.rs) * mag * sc, tx = dx * tsp, tz = dz * tsp, vsp = Math.hypot(F.vx, F.vz);
  if (F.gnd) {
    if (mag < .05) { // stick released: friction (constant + speed-proportional) brings you to a firm stop with a soft tail
      const k = vsp > 1e-6 ? Math.max(0, vsp - (FC.FRIC0 + FC.FRICK * vsp) * h) / vsp : 0; F.vx *= k; F.vz *= k;
    } else {
      const ex = tx - F.vx, ez = tz - F.vz, el = Math.hypot(ex, ez), st = Math.min(el, FC.ACC * (F.vx * tx + F.vz * tz < 0 ? FC.REV : 1) * h);
      if (el > 1e-6) { F.vx += ex / el * st; F.vz += ez / el * st; }
    }
  } else if (mag > .05) { // in the air: weak steering, momentum carries
    const ex = tx - F.vx, ez = tz - F.vz, el = Math.hypot(ex, ez), st = Math.min(el, FC.AIR * h);
    if (el > 1e-6) { F.vx += ex / el * st; F.vz += ez / el * st; }
  }
  if (mag > .05) { const d = wrap(Math.atan2(-dx, -dz) - F.psi), stp = d * (1 - Math.exp(-FC.TK * h)); F.psi = wrap(F.psi + Math.max(-FC.TURN * h, Math.min(FC.TURN * h, stp))); }
  // jump: coyote time after walking off an edge, a short input buffer before landing, and holding the button keeps hopping
  F.coy = F.gnd ? FC.COY : F.coy - h; F.jb = inp.jump ? FC.JBUF : F.jb - h;
  if (F.jb > 0 && (F.gnd || F.coy > 0)) { F.vy = FC.JUMP; F.gnd = false; F.coy = 0; F.jb = 0; F.dv -= .7; } // the dv kick: the camera dips as the legs push off
  // move one axis at a time: sliding along water's edge / ledges instead of stopping dead
  const nx = F.x + F.vx * h, nz = F.z + F.vz * h;
  if (blocked(nx, F.z, F.y)) F.vx = 0; else F.x = nx;
  if (blocked(F.x, nz, F.y)) F.vz = 0; else F.z = nz;
  const bk = bikeNow();
  for (let i = 0; i < 2; i++) { for (const b of env.OBBS) if (Math.abs(b.cx - F.x) < 60 && Math.abs(b.cz - F.z) < 60) resolve(F, b, FC.R); for (const b of bk) resolve(F, b, FC.R); }
  // ground: follow slopes while walking, fall off real drops, land (a hard landing jars the camera and bleeds some speed)
  const gh = env.H(F.x, F.z);
  if (F.gnd && F.vy <= 0) { if (F.y - gh < FC.DROP) F.y = gh; else F.gnd = false; }
  if (!F.gnd) {
    F.vy -= FC.G * (F.vy > 0 && inp.held === false ? FC.CUT : 1) * h; F.y += F.vy * h;
    if (F.y <= gh && F.vy <= 0) {
      const imp = -F.vy; F.y = gh; F.vy = 0; F.gnd = true; F.land = imp;
      if (imp > 2) { F.dv -= Math.min(2.2, imp * .2); const k = Math.max(.6, 1 - Math.max(0, imp - 3) * .05); F.vx *= k; F.vz *= k; }
    }
  }
  // view bob (read by footfig.js): the phase advances with distance on the ground, the amplitude eases in / out
  const v2 = Math.hypot(F.vx, F.vz);
  if (F.gnd) F.bp = (F.bp + v2 * h * FC.STRIDE) % TAU;
  const bt = F.gnd && v2 > .3 ? 1 : 0; F.ba += (bt - F.ba) * (1 - Math.exp(-(bt > F.ba ? 10 : 6) * h));
  F.dv += (-FC.DK * F.dip - FC.DC * F.dv) * h; F.dip += F.dv * h;
  if (F.dip < -.3) { F.dip = -.3; if (F.dv < 0) F.dv = 0; } else if (F.dip > .12) { F.dip = .12; if (F.dv > 0) F.dv = 0; }
}
// one frame (substeps of at most 1/60 s so a slow frame can't tunnel through a thin box)
export function footStep(inp, dt) {
  if (!F.on || !env) return; const n = Math.max(1, Math.min(6, Math.ceil(dt * 60))), h = dt / n;
  for (let i = 0; i < n; i++) sub(inp, h);
  F.spd = Math.hypot(F.vx, F.vz);
}
// the position the HUD / sun / ambience should follow: the walker while on foot, else the bike
export const at = () => F.on ? F : S;
