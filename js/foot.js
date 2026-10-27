// On-foot character, barebones: walk / run / jump, collide with the island's footprint boxes and the parked bike, stay out of the
// water, follow the ground. No animation. Pure logic (no three.js, no DOM) so tools/test.mjs can run it headless: the ground,
// the sea level and the collision boxes are injected with footEnv() (main.js passes world.js's H, SEA and OBBS).
// S (state.js) stays the BIKE's state the whole time: the bike is parked where it was (main.js holds it still) and the walker has
// its own state F. Conventions match the bike's: psi 0 faces -z, forward = (-sin psi, -cos psi), the bike's right = (cos psi, -sin psi).
// F.cy is the camera's azimuth (the camera sits at F + (sin cy, cos cy) * dist): W walks away from it.
import { S, ctx } from './state.js';

export const F = { on: false, fp: false, eye: 1.4, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, psi: 0, cy: 0, cp: .25, gnd: true, spd: 0 };
export const FC = {
  R: .3,        // body radius (m)
  WALK: 2.8, RUN: 6.2, // m/s
  ACC: 32, AIR: 5,     // m/s^2 on the ground / in the air
  G: 20, JUMP: 6.2,    // snappier than real gravity; apex ~0.96 m
  TURN: 14,            // rad/s the body turns toward the walking direction
  STEP: .55,           // highest ledge walked up in one go (m)
  DROP: .4,            // ground-following: a drop bigger than this is a fall
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
    Object.assign(F, { on: true, x, z, y: env.H(x, z), vx: 0, vy: 0, vz: 0, psi: S.psi, cy: S.psi, cp: .25, gnd: true, spd: 0 }); return '';
  }
  return 'No room to get off here';
}
export const nearBike = () => Math.hypot(F.x - S.x, F.z - S.z) < FC.REACH && F.gnd;
// Get back on if close enough; the bike is exactly where it was parked.
export function mount() { if (!F.on) return ''; if (!nearBike()) return 'Walk up to the bike first'; F.on = false; return ''; }

const wrap = a => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };
// inp: { mx, mz } stick (mx right, mz forward, camera-relative, length <= 1; shorter = slower), run, jump
function sub(inp, h) {
  const L = Math.hypot(inp.mx, inp.mz), mag = Math.min(1, L), sy = Math.sin(F.cy), cy = Math.cos(F.cy);
  const dx = L > 1e-6 ? (-sy * inp.mz + cy * inp.mx) / L : 0, dz = L > 1e-6 ? (-cy * inp.mz - sy * inp.mx) / L : 0; // forward = (-sin cy, -cos cy), right = (cos cy, -sin cy)
  const sp = (inp.run ? FC.RUN : FC.WALK) * mag, tx = dx * sp, tz = dz * sp, ex = tx - F.vx, ez = tz - F.vz, el = Math.hypot(ex, ez), st = Math.min(el, (F.gnd ? FC.ACC : FC.AIR) * h);
  if (el > 1e-6) { F.vx += ex / el * st; F.vz += ez / el * st; }
  if (mag > .05) { const d = wrap(Math.atan2(-dx, -dz) - F.psi); F.psi = wrap(F.psi + Math.max(-FC.TURN * h, Math.min(FC.TURN * h, d))); }
  if (inp.jump && F.gnd) { F.vy = FC.JUMP; F.gnd = false; }
  // move one axis at a time: sliding along water's edge / ledges instead of stopping dead
  const nx = F.x + F.vx * h, nz = F.z + F.vz * h;
  if (blocked(nx, F.z, F.y)) F.vx = 0; else F.x = nx;
  if (blocked(F.x, nz, F.y)) F.vz = 0; else F.z = nz;
  const bk = bikeNow();
  for (let i = 0; i < 2; i++) { for (const b of env.OBBS) if (Math.abs(b.cx - F.x) < 60 && Math.abs(b.cz - F.z) < 60) resolve(F, b, FC.R); for (const b of bk) resolve(F, b, FC.R); }
  // ground: follow slopes while walking, fall off real drops, land
  const gh = env.H(F.x, F.z);
  if (F.gnd && F.vy <= 0) { if (F.y - gh < FC.DROP) F.y = gh; else F.gnd = false; }
  if (!F.gnd) { F.vy -= FC.G * h; F.y += F.vy * h; if (F.y <= gh && F.vy <= 0) { F.y = gh; F.vy = 0; F.gnd = true; } }
}
// one frame (substeps of at most 1/60 s so a slow frame can't tunnel through a thin box)
export function footStep(inp, dt) {
  if (!F.on || !env) return; const n = Math.max(1, Math.min(6, Math.ceil(dt * 60))), h = dt / n;
  for (let i = 0; i < n; i++) sub(inp, h);
  F.spd = Math.hypot(F.vx, F.vz);
}
// the position the HUD / sun / ambience should follow: the walker while on foot, else the bike
export const at = () => F.on ? F : S;
