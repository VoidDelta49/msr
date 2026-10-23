// Rapier3D physics (phase 1-2 of the migration). The island's collision boxes become static Rapier colliders and the
// bike collides through a kinematic character controller (capsule, slides along walls). Engine, drivetrain, steering
// and suspension still come from physics.js; this only decides where the bike is allowed to go.
// Loaded lazily so a CDN or WASM failure falls back to Classic physics.
import { S } from './state.js';
import { H, OBBS } from './world.js';
import { blip } from './audio.js';
import { say } from './hud.js';

export const TICK = 1 / 120;             // fixed physics tick (bike solver runs 3 substeps inside each)
export const RP = { ok: false, err: '', on: false };
// collision groups: high 16 bits = membership, low 16 = what it collides with
const G_STATIC = 0x0002ffff, G_BIKE = 0x00010002;
let R, world, body, col, kcc, loading, inC = false;

const qY = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

export function initRapier() {
  return loading || (loading = (async () => {
    try {
      R = (await import('@dimforge/rapier3d-compat')).default; await R.init();
      world = new R.World({ x: 0, y: -9.81, z: 0 }); world.timestep = TICK;
      // boxes are footprints only (world.js has no heights): make them tall, from below the ground to well above
      for (const b of OBBS) world.createCollider(R.ColliderDesc.cuboid(b.hx, 4, b.hz).setTranslation(b.cx, H(b.cx, b.cz) + 1, b.cz).setRotation(qY(b.ry)).setCollisionGroups(G_STATIC));
      body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(S.x, 0, S.z));
      // same footprint as Classic (3 circles r .3 over ±.75 m), as a capsule lying along the bike
      col = world.createCollider(R.ColliderDesc.capsule(.75, .3).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setCollisionGroups(G_BIKE), body);
      kcc = world.createCharacterController(.02); kcc.setSlideEnabled(true); kcc.setUp({ x: 0, y: 1, z: 0 });
      world.step(); // builds the broad phase for the statics
      RP.ok = true;
    } catch (e) { RP.err = String(e && e.message || e); console.warn('Rapier failed, using Classic physics', e); }
    return RP.ok;
  })());
}

// After the bike solver has moved S.x/S.z from (x0, z0), let Rapier clip that move against the world.
export function collideR(x0, z0) {
  const dx = S.x - x0, dz = S.z - z0;
  body.setTranslation({ x: x0, y: H(x0, z0) + .6, z: z0 }, false); body.setRotation(qY(S.psi), false);
  world.propagateModifiedBodyPositionsToColliders();
  kcc.computeColliderMovement(col, { x: dx, y: 0, z: dz }, undefined, G_BIKE);
  const m = kcc.computedMovement(); S.x = x0 + m.x; S.z = z0 + m.z;
  const n = kcc.numComputedCollisions(); if (!n) { inC = false; return; }
  // how squarely the bike's direction of travel hits the wall: 1 = head-on, 0 = scraping along it
  const sg = Math.sign(S.v) || 1, fx = -Math.sin(S.psi) * sg, fz = -Math.cos(S.psi) * sg; let k = 0;
  for (let i = 0; i < n; i++) { const c = kcc.computedCollision(i); if (c) k = Math.max(k, Math.abs(fx * c.normal1.x + fz * c.normal1.z)); }
  k = Math.min(1, Math.max(0, k)); if (k < .05) { inC = false; return; }
  const av = Math.abs(S.v), imp = av * k;
  if (!inC) { // new impact: lose the speed going into the wall (all of it if nearly head-on)
    if (imp > 1.2) { blip('thud', imp); S.hits++; say(imp > 7 ? 'CRASH!' : 'Bump!', 900); S.thV -= imp * .05; }
    S.v *= k > .7 ? 0 : 1 - k;
  } else S.v -= Math.sign(S.v) * Math.min(Math.abs(S.v), k * 6 * TICK); // scraping along it: wall friction
  inC = true;
}
