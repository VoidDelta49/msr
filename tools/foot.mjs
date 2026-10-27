#!/usr/bin/env node
// Headless checks of js/foot.js (the on-foot character): walls, bike, water, ledges, jumping, get off / on, determinism. No browser, no three.js.
//   node tools/foot.mjs        (also part of tools/test.mjs)
import { S, ctx, createSim } from './lib/headless.mjs';
import { ROOT } from './lib/headless.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const J = rel => pathToFileURL(path.join(ROOT, rel)).href;
const foot = await import(J('js/foot.js')), { F, FC, footEnv, footStep, dismount, mount, bikeBoxes } = foot;

const box = (cx, cz, hx, hz, ry = 0) => ({ cx, cz, hx, hz, ry, c: Math.cos(ry), s: -Math.sin(ry) });
export function footTests() {
  const P = [], bad = m => P.push('FOOT ' + m);
  // world: flat ground at 0 except a sea (x > 40 at -5), a 3 m cliff (z < -40), a 1 m hill ramp, and walls: an axis-aligned one and a rotated one
  const OBBS = [box(10, 0, .5, 5), box(0, 20, 4, .5, .6)];
  const H = (x, z) => x > 40 ? -5 : z < -40 ? 3 : x > 20 && x < 30 ? (x - 20) * .1 : 0;
  footEnv({ H, SEA: -1, OBBS });
  createSim('raider150'); Object.assign(S, { x: -500, z: -500, psi: 0, v: 0, crashed: false, wet: false, air: false });
  const run = (inp, sec, dt = 1 / 60) => { for (let i = 0; i < sec / dt; i++) footStep(inp, dt); };
  const reset = (x, z, cy = 0) => Object.assign(F, { on: true, x, z, y: H(x, z), vx: 0, vy: 0, vz: 0, psi: 0, cy, gnd: true });
  // get off puts the walker beside the parked bike, free of it, on the left (bike's left = -x at psi 0)
  Object.assign(S, { x: 0, z: 0 }); const why = dismount(); if (why) bad('dismount refused: ' + why); else { if (!(F.on && F.x < -.5 && Math.abs(F.z) < 1)) bad(`dismount spot ${F.x.toFixed(2)},${F.z.toFixed(2)} is not on the left`); }
  // can't get off while the bike moves or is crashed
  F.on = false; S.v = 8; if (!dismount().length || F.on) bad('got off a moving bike'); S.v = 0; S.crashed = true; if (!dismount().length || F.on) bad('got off a crashed bike'); S.crashed = false; Object.assign(S, { x: -500, z: -500 }); // bike far away for the walking tests
  // walk forward (camera cy = 0 looks toward -z): speed settles at walk speed; run is faster
  reset(0, 10); run({ mx: 0, mz: 1, run: false, jump: false }, 2); const w = F.spd; if (Math.abs(w - FC.WALK) > .1) bad(`walk speed ${w.toFixed(2)}`); if (!(F.z < 10 - 4)) bad('did not move forward (-z)');
  run({ mx: 0, mz: 1, run: true, jump: false }, 2); if (Math.abs(F.spd - FC.RUN) > .1) bad(`run speed ${F.spd.toFixed(2)}`);
  // camera-relative: with the camera turned a quarter (cy = -pi/2) W walks toward +x
  reset(-30, 10, -Math.PI / 2); run({ mx: 0, mz: 1 }, 1); if (!(F.x > -28 && Math.abs(F.z - 10) < .2)) bad(`camera-relative walk went to ${F.x.toFixed(2)},${F.z.toFixed(2)}`);
  // walls: running at the axis-aligned and the rotated wall never gets inside; sliding along keeps moving
  for (const [x0, z0, cy, name] of [[0, 0, -Math.PI / 2, 'wall A'], [0, 12, Math.PI, 'wall B']]) {
    reset(x0, z0, cy); let deep = 0; for (let i = 0; i < 240; i++) { footStep({ mx: 0, mz: 1, run: true }, 1 / 60); for (const b of OBBS) { const dx = F.x - b.cx, dz = F.z - b.cz, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c, d = Math.hypot(lx - Math.max(-b.hx, Math.min(b.hx, lx)), lz - Math.max(-b.hz, Math.min(b.hz, lz))); deep = Math.max(deep, FC.R - .02 - d); } }
    if (deep > 0) bad(name + ': walked into the wall'); if (name === 'wall A' && !(F.x < 9.3)) bad('wall A: not stopped in front (x=' + F.x.toFixed(2) + ')'); // B is rotated: the walker slides along it, only penetration is checked
  }
  // a huge frame (a hitch) can't tunnel through the thin wall: 0.3 s at run speed in one call
  reset(7, 0, -Math.PI / 2); for (let i = 0; i < 10; i++) footStep({ mx: 0, mz: 1, run: true }, .3); if (F.x > 9.5) bad(`tunnelled through the wall (x=${F.x.toFixed(2)})`);
  // the parked bike is solid (2 m long along -z at psi 0): walk into its side and its nose
  S.x = 0; S.z = 0; S.psi = 0; reset(-4, 0, -Math.PI / 2); run({ mx: 0, mz: 1, run: true }, 2); if (!(F.x < -.4)) bad(`walked through the bike (x=${F.x.toFixed(2)})`);
  // water: the sea edge stops you (x = 40) and ledges taller than a step do too (z = -40)
  reset(30, 0, -Math.PI / 2); run({ mx: 0, mz: 1, run: true }, 6); if (!(F.x < 40.01)) bad(`walked into the sea (x=${F.x.toFixed(2)})`);
  reset(0, -30, 0); run({ mx: 0, mz: 1, run: true }, 6); if (!(F.z > -40.01)) bad(`climbed the cliff (z=${F.z.toFixed(2)})`);
  // slopes: follows the ground up a ramp and stays on it going down
  reset(18, 0, -Math.PI / 2); run({ mx: 0, mz: 1 }, 3); if (Math.abs(F.y - H(F.x, F.z)) > .02) bad('left the ground on the ramp'); if (!(F.gnd)) bad('not grounded on a gentle slope');
  // jump: leaves the ground, apex ~1 m, lands again, can't jump in the air
  reset(0, 30); let top = 0, air = 0; footStep({ mx: 0, mz: 0, jump: true }, 1 / 60); for (let i = 0; i < 120; i++) { footStep({ mx: 0, mz: 0, jump: false }, 1 / 60); top = Math.max(top, F.y); if (!F.gnd) air++; }
  if (!(top > .8 && top < 1.2)) bad(`jump apex ${top.toFixed(2)} m`); if (!(F.gnd && Math.abs(F.y) < 1e-6)) bad('did not land'); if (!(air > 30 && air < 60)) bad(`air time ${air} frames`);
  // feel (build 11.38): speed eases in with a push and out with friction, sprint ramps, the jump is forgiving and variable
  const W = { mx: 0, mz: 1, run: true }, still = { mx: 0, mz: 0 };
  reset(0, 30); footStep(W, 1 / 60); if (!(F.spd > 0 && F.spd < FC.RUN * .5)) bad(`start is not eased (${F.spd.toFixed(2)} m/s after one frame)`); if (!(F.rs > 0 && F.rs < .2)) bad(`sprint did not ramp (rs=${F.rs.toFixed(2)} after one frame)`);
  run(W, 1); if (!(F.rs > .99)) bad('sprint never fully built up');
  footStep(still, 1 / 60); if (!(F.spd > FC.RUN * .7)) bad(`let go and stopped dead (${F.spd.toFixed(2)} m/s after one frame)`); run(still, .6); if (F.spd > .01) bad(`friction never stopped the walker (${F.spd.toFixed(2)} m/s after 0.6 s)`); if (F.rs > .01) bad('sprint stuck on after stopping');
  reset(0, 30); run({ mx: 0, mz: 1, run: true }, 1); const stopT = (() => { let n = 0; while (F.spd > .01 && n < 600) { footStep(still, 1 / 60); n++; } return n / 60; })(); if (!(stopT > .1 && stopT < .5)) bad(`sprint stop took ${stopT.toFixed(2)} s`);
  // quick turn-around beats the plain push (reversal boost): from full speed to going the other way within a second
  reset(0, 30); run(W, 1); run({ mx: 0, mz: -1, run: true }, .6); if (!(F.vz > FC.RUN * .9)) bad(`could not reverse at speed (vz=${F.vz.toFixed(2)})`);
  // jump: a tap is a short hop, a held jump goes the full height
  const apex = held => { reset(0, 30); footStep({ mx: 0, mz: 0, jump: true, held }, 1 / 60); let t = 0; for (let i = 0; i < 120; i++) { footStep({ mx: 0, mz: 0, jump: held, held }, 1 / 60); t = Math.max(t, F.y); } return t; };
  const aTap = apex(false), aHold = apex(true); if (!(aTap > .3 && aTap < aHold - .2)) bad(`tap hop ${aTap.toFixed(2)} m vs held jump ${aHold.toFixed(2)} m`); if (!(aHold > .8 && aHold < 1.2)) bad(`held jump apex ${aHold.toFixed(2)} m`);
  // coyote time: a jump a moment after leaving the ground works; much later it doesn't; no jump from high up
  reset(0, 30); F.gnd = false; F.y = .05; F.vy = -1; F.coy = .08; footStep({ mx: 0, mz: 0, jump: true, held: true }, 1 / 60); if (!(F.vy > 3)) bad('coyote jump refused');
  reset(0, 30); F.gnd = false; F.y = 2; F.vy = 0; F.coy = 0; footStep({ mx: 0, mz: 0, jump: true, held: true }, 1 / 60); if (F.vy > 0) bad('double jump in mid air');
  // jump buffer: pressed just before touching down = jumps on landing
  reset(0, 30); F.gnd = false; F.y = .1; F.vy = -3; F.coy = 0; footStep({ mx: 0, mz: 0, jump: true, held: false }, 1 / 60); for (let i = 0; i < 6; i++) footStep(still, 1 / 60); if (!(F.vy > 3 || F.y > .3)) bad('buffered jump was lost');
  // landing: the camera spring dips, then settles; a hard landing bleeds some speed
  reset(0, 30); footStep({ mx: 0, mz: 0, jump: true, held: true }, 1 / 60); let minDip = 0; for (let i = 0; i < 80; i++) { footStep({ mx: 0, mz: 0, jump: false, held: false }, 1 / 60); minDip = Math.min(minDip, F.dip); } if (!(minDip < -.03 && minDip >= -.3)) bad(`landing dip ${minDip.toFixed(3)} m`);
  run(still, 2.5); if (!(Math.abs(F.dip) < .003 && Math.abs(F.dv) < .02)) bad(`camera spring did not settle (dip ${F.dip.toFixed(4)}, dv ${F.dv.toFixed(4)})`);
  // view bob: amplitude builds while walking on the ground and the phase advances with distance; none while standing
  reset(0, 30); run({ mx: 0, mz: 1 }, 1); const ph0 = F.bp; if (!(F.ba > .8)) bad(`bob amplitude ${F.ba.toFixed(2)} while walking`); run({ mx: 0, mz: 1 }, .3); if (F.bp === ph0) bad('bob phase stuck'); run(still, 1.5); if (!(F.ba < .05)) bad(`bob amplitude ${F.ba.toFixed(2)} while standing`);
  if (![F.rs, F.bp, F.ba, F.dip, F.dv, F.coy, F.jb].every(Number.isFinite)) bad('non-finite feel state');
  // first person: backpedalling is slower than walking forward and can't sprint
  reset(0, 30); F.fp = true; run({ mx: 0, mz: -1, run: true }, 2); if (!(F.spd < FC.WALK * .8)) bad(`first-person backpedal speed ${F.spd.toFixed(2)}`); F.fp = false;
  // get on: only close to the bike
  S.x = 0; S.z = 0; reset(8, 30); if (!mount().length || !F.on) bad('got on from 30 m away'); reset(1.2, 0); if (mount() || F.on) bad('could not get on next to the bike');
  // determinism + finite
  const a = (() => { reset(0, 30, .3); run({ mx: .4, mz: .9, run: true, jump: false }, 3); return [F.x, F.y, F.z, F.psi]; })(), b = (() => { reset(0, 30, .3); run({ mx: .4, mz: .9, run: true, jump: false }, 3); return [F.x, F.y, F.z, F.psi]; })();
  if (JSON.stringify(a) !== JSON.stringify(b)) bad('not deterministic'); if (!a.every(Number.isFinite)) bad('non-finite state');
  F.on = false; return P;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) { const P = footTests(); for (const p of P) console.log('FAIL  ' + p); console.log(P.length ? `foot: ${P.length} problem(s)` : 'foot: ok'); process.exit(P.length ? 1 : 0); }
