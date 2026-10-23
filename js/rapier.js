// Rapier3D chassis (phase 3). The bike is a dynamic Rapier body: Rapier integrates heave, pitch, gravity, airtime and
// contacts with the island's boxes. The bike solver in physics.js still owns engine, drivetrain, speed along the
// ground and steering (yaw + visual lean); Rapier gets that speed as the body's horizontal velocity, and wall
// contacts feed back into it. Suspension = two ground probes at the axles against the exact drawn surface (world H()),
// spring-dampers applied as forces, inelastic bump stops at full travel.
// Crashes (phase 4, only with Tough Biker mode OFF): hitting a wall hard, asking more grip than the tyres have, or a
// bad landing turns the bike into a free-tumbling box on a temporary ground patch and throws the rider off as a
// second body. Once it stops sliding (2-4 s) the bike is stood back up where it ended, engine off.
// Rapier is loaded before the game starts; if it can't load, the start screen says so.
import { clamp, angd } from './util.js';
import { S, ctx } from './state.js';
import { H, OBBS } from './world.js';
import { blip } from './audio.js';
import { say } from './hud.js';
import * as THREE from 'three';
import { step, bumpStop } from './physics.js';
import { cfg } from './config.js';
import { B } from './model.js';
import { scene } from './renderer.js';

export const TICK = 1 / 120;             // fixed physics tick; the bike solver runs 3 substeps inside each
export const RP = { ok: false, err: '' };
const Y0 = .6;                           // body origin above the chassis reference height S.zH
// collision groups: high 16 bits = membership, low 16 = what it collides with
const G_STATIC = 0x0002ffff, G_BIKE = 0x00010002, G_GROUND = 0x0004ffff, G_CRASH = 0x00010006;
export let world, body; let R, cap, box, loading, inC = false, wasAir = false;
// Static boxes are streamed: Rapier's step cost grows with every collider in the world (~0.2 ms for all 1,240), so only
// the ones in the 3 x 3 block of 25 m cells around the bike (at least 25 m in every direction) exist. Boxes are footprints only (world.js has no heights): they are made
// tall, from below the ground to well above.
const CELL = 25, CELLS = new Map(), live = new Set(); let lastCell = null, stamp = 0;
const cellKey = (i, j) => i * 10000 + j;
// world.step() also runs mapNewSoftBodies() (wraps pieces the engine tore off soft bodies), which allocates ~5 KB of
// JS garbage per step even with no soft bodies: ~0.6 MB/s at 120 Hz, i.e. more GC pauses. We have no soft bodies or
// engine-made objects, so step the pipeline directly; fall back to world.step() if the internals ever change.
let fastStep = null;
function stepWorld() { if (fastStep) fastStep(); else world.step(); }
function stream(force) {
  const ci = Math.floor(S.x / CELL), cj = Math.floor(S.z / CELL), key = cellKey(ci, cj); if (!force && key === lastCell) return; lastCell = key; stamp++;
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const b of CELLS.get(cellKey(i, j)) || []) {
    b.st = stamp; if (b.col) continue;
    b.col = world.createCollider(R.ColliderDesc.cuboid(b.hx, 4, b.hz).setTranslation(b.cx, H(b.cx, b.cz) + 1, b.cz).setRotation(qYX(b.ry, 0)).setCollisionGroups(G_STATIC).setFriction(.4)); live.add(b);
  }
  for (const b of live) if (b.st !== stamp) { world.removeCollider(b.col, false); b.col = null; live.delete(b); }
}

// rotation = yaw psi about world up, then pitch th about the bike's lateral axis (nose up = +th), never roll
const qYX = (psi, th) => { const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2), cx = Math.cos(th / 2), sx = Math.sin(th / 2); return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx }; };
const qmul = (a, b) => ({ w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w });
const qZ = a => ({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) });

export function initRapier() {
  return loading || (loading = (async () => {
    try {
      R = (await import('@dimforge/rapier3d-compat')).default; await R.init();
      world = new R.World({ x: 0, y: -9.81, z: 0 }); world.timestep = TICK; world.numSolverIterations = 2; // one dynamic body and simple box contacts: 2 is plenty
      for (const b of OBBS) { const k = cellKey(Math.floor(b.cx / CELL), Math.floor(b.cz / CELL)); (CELLS.get(k) || CELLS.set(k, []).get(k)).push(b); }
      const W = world, PP = W.physicsPipeline;
      if (PP && PP.step && W.integrationParameters && W.softBodies) fastStep = () => PP.step(W.gravity, W.integrationParameters, W.islands, W.broadPhase, W.narrowPhase, W.bodies, W.colliders, W.softBodies, W.impulseJoints, W.multibodyJoints, W.ccdSolver);
      body = world.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false));
      // same footprint as Classic (3 circles r .3 over ±.75 m), as a capsule lying along the bike; mass comes from the spec
      cap = world.createCollider(R.ColliderDesc.capsule(.75, .3).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(0).setFriction(0).setCollisionGroups(G_BIKE), body);
      // while crashed the bike is a rounded box (a capsule on its side would roll like a log; sharp edges catch and flip it),
      // metal/plastic-on-asphalt friction, touching the ground patch too
      box = world.createCollider(R.ColliderDesc.roundCuboid(.14, .37, .87, .08).setTranslation(0, -.15, 0).setDensity(0).setFriction(.35).setRestitution(0).setCollisionGroups(G_CRASH), body); box.setEnabled(false);
      RP.ok = true; syncBody();
    } catch (e) { RP.err = String(e && e.message || e); console.warn('Rapier failed to load', e); }
    return RP.ok;
  })());
}

// Put the body where S says (reset, bike switch, leaving the garage, turning Rapier on), at rest.
export function syncBody() {
  if (!RP.ok || !ctx.spec) return; const sp = ctx.spec; if (S.crashed) endCrash();
  body.setAdditionalMassProperties(sp.m, { x: 0, y: 0, z: 0 }, { x: sp.I, y: sp.I * 1.2, z: sp.I * .4 }, { x: 0, y: 0, z: 0, w: 1 }, true);
  stream(true); body.setTranslation({ x: S.x, y: S.zH + Y0, z: S.z }, true); body.setRotation(qYX(S.psi, S.th || 0), true);
  S.hF = H(S.x - Math.sin(S.psi) * sp.lf, S.z - Math.cos(S.psi) * sp.lf); S.hR = H(S.x + Math.sin(S.psi) * sp.lr, S.z + Math.cos(S.psi) * sp.lr);
  body.setLinvel({ x: -Math.sin(S.psi) * S.v, y: 0, z: -Math.cos(S.psi) * S.v }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

// garage BOUNCE button: push the chassis down and pitch it
export function bounce() { const lv = body.linvel(); body.setLinvel({ x: lv.x, y: -.9, z: lv.z }, true); body.setAngvel({ x: Math.cos(S.psi) * .6, y: 0, z: -Math.sin(S.psi) * .6 }, true); }

// One fixed tick.
export function tickR() {
  if (S.crashed) return crashTick();
  const sp = ctx.spec, m = sp.m, lf = sp.lf, lr = sp.lr, g = 9.81;
  // read the chassis
  const t = body.translation(), q = body.rotation(), lv = body.linvel(), av = body.angvel();
  const th = Math.asin(clamp(2 * (q.y * q.z - q.w * q.x) * -1, -1, 1)); // forward = q·(0,0,-1); its y = sin(pitch)
  S.x = t.x; S.z = t.z; S.zH = t.y - Y0; S.th = th;
  let fx = -Math.sin(S.psi), fz = -Math.cos(S.psi), lx = Math.cos(S.psi), lz = -Math.sin(S.psi);
  let w = av.x * lx + av.z * lz, vy = lv.y;
  // ground under each axle, and how fast it rises under it (clamped: a kerb is a step, not a 30 m/s ram)
  const hF = H(S.x + fx * lf, S.z + fz * lf), hR = H(S.x - fx * lr, S.z - fz * lr);
  const dhF = clamp((hF - S.hF) / TICK, -3, 3), dhR = clamp((hR - S.hR) / TICK, -3, 3); S.hF = hF; S.hR = hR;
  // bump stops first (position + velocity), so the springs below never see more than full travel
  const st = bumpStop(sp, S.zH, th, vy, w, hF, hR, dhF, dhR);
  if (st[0] !== S.zH || st[1] !== th) { S.zH = st[0]; S.th = st[1]; vy = st[2]; w = st[3]; body.setTranslation({ x: S.x, y: S.zH + Y0, z: S.z }, true); }
  // springs measure from static sag, so add the static load; a wheel can push but never pull
  const cF = hF + sp.yf - (S.zH + lf * S.th), cR = hR + sp.yr - (S.zH - lr * S.th), vF = dhF - (vy + lf * w), vR = dhR - (vy - lr * w);
  const mF = m * lr / sp.wb, mR = m * lf / sp.wb;
  const Ff = Math.max(0, mF * g + sp.kf * (cF + sp.pf) + sp.damp * 2 * Math.sqrt(sp.kf * mF) * vF), Fr = Math.max(0, mR * g + sp.kr * (cR + sp.pr) + sp.damp * 2 * Math.sqrt(sp.kr * mR) * vR);
  S.cF = cF; S.cR = cR; S.Ff = Ff; S.Fr = Fr; S.air = Ff <= 0 && Fr <= 0;
  // drivetrain + steering. In the air the wheel is unloaded: engine free-revs, speed and heading carry on.
  const v0 = S.v, p0 = S.psi, stand = ctx.stand; if (S.air) ctx.stand = true;
  for (let i = 0; i < 3; i++) step(TICK / 3);
  ctx.stand = stand; if (S.air) { S.v = v0; S.psi = p0; S.yaw = 0; }
  if (!cfg.tough) {
    // landing hard or nose/tail first
    if (wasAir && !S.air && (vy < -6.5 || Math.abs(S.th) > .5)) { wasAir = false; return crash('landing'); }
    // low-side: steering asks clearly more grip than there is, for a moment
    S.slideT = !S.air && Math.abs(S.v) > 5 && S.over > 1.3 ? (S.slideT || 0) + TICK : 0;
    if (S.slideT > .3) return crash('lowside');
  }
  wasAir = S.air;
  fx = -Math.sin(S.psi); fz = -Math.cos(S.psi); lx = Math.cos(S.psi); lz = -Math.sin(S.psi);
  // forces: suspension lift, pitch from the springs plus load transfer under accel/braking
  const tau = Ff * lf - Fr * lr + (S.air ? 0 : m * S.a * sp.h);
  // applied straight to the velocities we set anyway (same as a force over one tick, 4 fewer calls into WASM)
  vy += (Ff + Fr) / m * TICK; w += tau / sp.I * TICK;
  // velocity: on the ground the tyres set horizontal speed along the heading (no side slip); vertical stays Rapier's
  if (!S.air) body.setLinvel({ x: fx * S.v, y: vy, z: fz * S.v }, true); else body.setLinvel({ x: lv.x, y: vy, z: lv.z }, true);
  body.setRotation(qYX(S.psi, S.th), true); body.setAngvel({ x: lx * w, y: S.yaw, z: lz * w }, true);
  stream(); stepWorld();
  // walls. Contacts remove the velocity going into the wall; the bike keeps the rest and gets deflected along it.
  if (S.air) { inC = false; return; }
  const nv = body.linvel(), sp2 = Math.hypot(nv.x, nv.z), dv = Math.abs(S.v) - sp2;
  if (dv < .02) { inC = false; return; }
  if (!inC && dv > 7 && !cfg.tough) { S.v = v0; return crash('wall', dv); }
  if (!inC && dv > 1.2) { blip('thud', dv); S.hits++; say(dv > 7 ? 'CRASH!' : 'Bump!', 900); body.applyTorqueImpulse({ x: -lx * dv * 3, y: 0, z: -lz * dv * 3 }, true); }
  let v = sp2; if (inC) v = Math.max(0, v - 6 * TICK * Math.min(1, dv / Math.max(.1, sp2) * 4)); // scraping: wall friction
  const sg = Math.sign(S.v) || 1;
  if (sp2 > .5) { // turn the heading toward the slide direction (backwards when reversing)
    const pt = Math.atan2(-nv.x * sg, -nv.z * sg), d = angd(pt, S.psi);
    if (Math.abs(d) < 1.4) S.psi += d * .5;
  }
  S.v = sg * v; inC = true;
}

/* ---------- crashes ---------- */
export let rider = null; let ground = null, crashT = 0, kept = null;
const RG = new THREE.Group(), tq = new THREE.Quaternion(), tv = new THREE.Vector3();
function makeGround(cx, cz) { // 64 x 64 m trimesh of the drawn ground, 1 m grid, centred ahead of the crash
  const n = 65, v = new Float32Array(n * n * 3), ix = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = cx - 32 + i, z = cz - 32 + j, k = (j * n + i) * 3; v[k] = x; v[k + 1] = H(x, z); v[k + 2] = z; }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; ix.push(a, c, b, b, c, d); }
  ground = world.createCollider(R.ColliderDesc.trimesh(v, new Uint32Array(ix)).setFriction(.7).setCollisionGroups(G_GROUND));
}
function crash(kind, imp = 0) {
  S.crashed = true; crashT = 0; S.running = false; S.lim = false; S.issOff = false; inC = false; S.slideT = 0;
  blip('thud', 9); say(kind === 'wall' ? 'CRASH!' : kind === 'landing' ? 'Bad landing!' : 'Lost the front! Low-side', 1600); S.hits++;
  const fx = -Math.sin(S.psi), fz = -Math.cos(S.psi), lx = Math.cos(S.psi), lz = -Math.sin(S.psi), zx = -fx, zz = -fz, v = S.v, lv = body.linvel();
  makeGround(S.x + fx * v * .7, S.z + fz * v * .7);
  cap.setEnabled(false); box.setEnabled(true);
  // hand the bike over with its current lean, and set it falling/tumbling the way this kind of crash goes
  body.setRotation(qmul(qYX(S.psi, S.th), qZ(-S.lean)), true);
  const sl = Math.sign(S.lean) || (Math.random() < .5 ? -1 : 1);
  if (kind === 'wall') { body.setLinvel({ x: lv.x, y: lv.y + 1, z: lv.z }, true); body.setAngvel({ x: -lx * imp * .5 + zx * sl, y: 0, z: -lz * imp * .5 + zz * sl }, true); }
  else { body.setLinvel({ x: fx * v + lx * sl * 1.5, y: lv.y, z: fz * v + lz * sl * 1.5 }, true); body.setAngvel({ x: -zx * sl * 1.5, y: 0, z: -zz * sl * 1.5 }, true); }
  // rider: thrown off at the bike's speed (over the bars into a wall)
  const rv = kind === 'wall' ? Math.max(imp, Math.abs(v)) * Math.sign(v || 1) : v * .85;
  rider = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(S.x, S.zH + 1.15, S.z).setRotation(qYX(S.psi, 0)).setLinvel(fx * rv, kind === 'wall' ? 2.5 : 1.2, fz * rv).setAngvel({ x: lx * 4, y: 0, z: lz * 4 }));
  world.createCollider(R.ColliderDesc.roundCuboid(.18, .35, .08, .07).setMass(70).setFriction(.6).setCollisionGroups(G_CRASH), rider);
  // move the rider meshes onto their own body
  B.root.position.set(S.x, S.zH, S.z); B.root.rotation.set(0, S.psi, 0); B.lean.rotation.z = -S.lean; B.body.rotation.x = S.th; // pose as drawn, now
  B.root.updateMatrixWorld(true); scene.add(RG); poseRG(); RG.updateMatrixWorld(true);
  kept = B.rider.map(m => ({ m, p: m.parent, pos: m.position.clone(), q: m.quaternion.clone(), s: m.scale.clone() })); for (const m of B.rider) RG.attach(m);
}
function poseRG() { const t = rider.translation(), q = rider.rotation(); RG.position.set(t.x, t.y - 1.15, t.z); RG.quaternion.set(q.x, q.y, q.z, q.w); tv.set(0, 1.15, 0).applyQuaternion(RG.quaternion); RG.position.set(t.x - tv.x, t.y - tv.y, t.z - tv.z); }
function crashTick() {
  stream(); stepWorld(); crashT += TICK;
  const t = body.translation(), lv = body.linvel(); S.x = t.x; S.z = t.z; S.zH = t.y - Y0; S.v = Math.hypot(lv.x, lv.z); S.rpm = Math.max(0, S.rpm - 5000 * TICK); S.thrEff = 0;
  if (crashT > 2 && Math.hypot(lv.x, lv.y, lv.z) < 1.5 || crashT > 4 || t.y < H(t.x, t.z) - 3) standUp(); // once it has stopped sliding
}
// stand the bike back up where it ended, facing the way it points, engine off
function standUp() {
  const q = body.rotation(), f = new THREE.Vector3(0, 0, -1).applyQuaternion(tq.set(q.x, q.y, q.z, q.w));
  if (Math.hypot(f.x, f.z) > .2) S.psi = Math.atan2(-f.x, -f.z);
  endCrash(); Object.assign(S, { v: 0, lean: 0, th: 0, thV: 0, zV: 0, yaw: 0, delta: 0, rpm: 0, running: false, gear: 0, padT: 0 }); ctx.drive.reset(S);
  S.zH = H(S.x, S.z) + (ctx.spec.yf + ctx.spec.yr + ctx.spec.pf + ctx.spec.pr) / 2; syncBody(); say('Picked the bike up. Press START', 1800);
}
function endCrash() {
  S.crashed = false; if (ground) { world.removeCollider(ground, false); ground = null; }
  if (rider) { world.removeRigidBody(rider); rider = null; }
  if (kept) { for (const k of kept) { k.p.add(k.m); k.m.position.copy(k.pos); k.m.quaternion.copy(k.q); k.m.scale.copy(k.s); } kept = null; scene.remove(RG); }
  box.setEnabled(false); cap.setEnabled(true); wasAir = false;
  // back on the bike: every node the crash pose touched goes back upright (main.js redraws the heading next frame)
  B.root.quaternion.identity(); B.root.rotation.set(0, S.psi, 0); B.lean.rotation.set(0, 0, 0); B.body.rotation.set(0, 0, 0);
  RP.onUp && RP.onUp();
}
// drawing while crashed: the whole bike follows the tumbling body, the rider follows his own
export function crashVisual() {
  if (!S.crashed) return; const t = body.translation(), q = body.rotation();
  B.root.quaternion.set(q.x, q.y, q.z, q.w); tv.set(0, Y0, 0).applyQuaternion(B.root.quaternion); B.root.position.set(t.x - tv.x, t.y - tv.y, t.z - tv.z);
  B.lean.rotation.z = 0; B.body.rotation.x = 0; if (rider) poseRG();
}
