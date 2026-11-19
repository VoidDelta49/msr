// Runs the game's Rapier usage (js/rapier.js) against a rapier.mjs + wasm pair and prints a hash of every state.
// usage: node rtest.mjs <dir with rapier.mjs + rapier.wasm>
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';
const dir = path.resolve(process.argv[2]);
globalThis.fetch = async u => { const b = readFileSync(new URL(u)); return new Response(b, { headers: { 'content-type': 'application/wasm' } }); };
const R = (await import(pathToFileURL(path.join(dir, 'rapier.mjs')).href)).default; await R.init();
const TICK = 1 / 120, G_STATIC = 0x0002ffff, G_BIKE = 0x00010002, G_GROUND = 0x0004ffff, G_CRASH = 0x00010006;
const qYX = (psi, th) => { const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2), cx = Math.cos(th / 2), sx = Math.sin(th / 2); return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx }; };
let h = 0; const mix = v => { const f = new Float64Array([v]), u = new Uint32Array(f.buffer); h = Math.imul(h ^ u[0], 2654435761) >>> 0; h = Math.imul(h ^ u[1], 2246822519) >>> 0; };
const rec = b => { const t = b.translation(), r = b.rotation(), l = b.linvel(), a = b.angvel(); [t.x, t.y, t.z, r.x, r.y, r.z, r.w, l.x, l.y, l.z, a.x, a.y, a.z].forEach(mix); };
const world = new R.World({ x: 0, y: -9.81, z: 0 }); world.timestep = TICK; world.numSolverIterations = 2;
const W = world, PP = W.physicsPipeline;
if (!(PP && PP.step && W.integrationParameters && W.softBodies)) throw new Error('fastStep internals missing');
const fastStep = () => PP.step(W.gravity, W.integrationParameters, W.islands, W.broadPhase, W.narrowPhase, W.bodies, W.colliders, W.softBodies, W.impulseJoints, W.multibodyJoints, W.ccdSolver);
const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false));
body.setAdditionalMassProperties(130, { x: 0, y: -.1, z: 0 }, { x: 20, y: 20, z: 8 }, { x: 0, y: 0, z: 0, w: 1 }, true);
const cap = world.createCollider(R.ColliderDesc.capsule(.75, .3).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(0).setFriction(0).setCollisionGroups(G_BIKE), body);
const scap = world.createCollider(R.ColliderDesc.capsule(.6, .45).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(0).setFriction(0).setCollisionGroups(G_BIKE), body); scap.setEnabled(false);
const sbox = world.createCollider(R.ColliderDesc.roundCuboid(.45, .45, .95, .06).setDensity(0).setFriction(.35).setRestitution(0).setCollisionGroups(G_CRASH), body); sbox.setEnabled(false);
const box = world.createCollider(R.ColliderDesc.roundCuboid(.14, .37, .87, .08).setTranslation(0, -.15, 0).setDensity(0).setFriction(.35).setRestitution(0).setCollisionGroups(G_CRASH), body); box.setEnabled(false);
body.setTranslation({ x: 0, y: 1, z: 0 }, true); body.setRotation(qYX(.3, 0), true);
// walls, streamed in and out
const walls = [];
for (let i = 0; i < 12; i++) walls.push(world.createCollider(R.ColliderDesc.cuboid(2 + i % 3, 4, 1.5).setTranslation(-10 + i * 2, 1, -6 - i).setRotation(qYX(i * .4, 0)).setCollisionGroups(G_STATIC).setFriction(.4)));
for (let s = 0; s < 600; s++) {
  body.setLinvel({ x: Math.sin(s * .01) * 6, y: body.linvel().y, z: -8 }, true); body.setAngvel({ x: 0, y: .2, z: 0 }, true);
  if (s % 2) fastStep(); else world.step();
  if (s === 300) { scap.setEnabled(true); cap.setEnabled(false); scap.setTranslationWrtParent({ x: 0, y: .1, z: .2 }); sbox.setTranslationWrtParent({ x: .3, y: 0, z: 0 }); }
  if (s % 97 === 0 && walls.length) world.removeCollider(walls.pop(), false);
  rec(body);
}
// crash: tumbling box on a ground patch + rider body
cap.setEnabled(false); scap.setEnabled(false); box.setEnabled(true); sbox.setEnabled(true);
const v = [], ix = []; const N = 8;
for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) v.push(-20 + i * 5, Math.sin(i) * .3 + Math.cos(j) * .2 - 1, -60 + j * 5);
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j; ix.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1); }
const ground = world.createCollider(R.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(ix)).setFriction(.7).setCollisionGroups(G_GROUND));
const rider = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(1, 2, -40).setRotation(qYX(.5, 0)).setLinvel(3, 7.5, -4).setAngvel({ x: 11, y: 6, z: 4 }));
world.createCollider(R.ColliderDesc.roundCuboid(.18, .35, .08, .07).setMass(70).setFriction(.6).setCollisionGroups(G_CRASH), rider);
body.setTranslation({ x: 0, y: 1, z: -40 }, true); body.setLinvel({ x: 2, y: 3, z: -12 }, true); body.applyTorqueImpulse({ x: 40, y: 10, z: 60 }, true);
for (let s = 0; s < 480; s++) { if (s % 2) fastStep(); else world.step(); rec(body); rec(rider); }
world.removeRigidBody(rider); world.removeCollider(ground, false);
box.setEnabled(false); sbox.setEnabled(false); cap.setEnabled(true);
for (let s = 0; s < 120; s++) { world.step(); rec(body); }
console.log(h.toString(16));
