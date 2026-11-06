// The on-foot character's body and camera (logic is in foot.js). The body is the biker already on the bike, built by the character
// system (figure.js: the same body, shader and pose library the pedestrians use) with this bike's rider limb sizes and outfit, helmet on.
// Animated on the GPU from foot.js's state: walk / run cycle locked to the view-bob stride (F.bp), a tuck in the air, breathing when idle.
// Rebuilt on every get-off, so it always matches the current bike's rider. If that isn't available the seated copy of B.rider is used. Camera: smoothed look angles, eased ground steps, view bob and the take-off / landing dip.
import * as THREE from 'three';
import { B, blobAdd } from './model.js';
import { Crowd, humanGeo, riderPal, optMask, POSES } from './figure.js';
import { Q } from './config.js';
import { scene } from './renderer.js';
import { F } from './foot.js';

const G = new THREE.Group(); G.visible = false; scene.add(G);
// contact shadow like the bike's (model.js blobs): nothing here casts into the sun's shadow map
blobAdd({ b: G, p: new THREE.Vector3(0, .5, 0), h0: .5, d: .7, w: .6, cores: 0, spread: 0, vis: () => G.visible, ground: null, off: false });

const box = new THREE.Box3(), bb = new THREE.Box3(), PAL = riderPal(), MASK = optMask(['helmet']), pose = new Float32Array(8);
let ME = null, dims = null; // the walker: a one-figure crowd (rebuilt when the bike's rider has other limb sizes)
export function figBuild() {
  G.clear(); box.makeEmpty();
  if (B.riderDims) {
    if (!ME || dims !== B.riderDims) { if (ME) ME.mesh.geometry.dispose(); dims = B.riderDims; ME = new Crowd(humanGeo(dims), 1, { name: 'walker', lite: !!Q.lite }); }
    G.add(ME.mesh); F.eye = ME.J.hy; figAnim(0); return;
  }
  for (const s of B.rider) { // fallback: the seated pose copied as is (meshes parented to B.ct: s.matrix is their pose in the bike's frame)
    s.updateMatrix(); const m = new THREE.Mesh(s.geometry, s.material); m.matrixAutoUpdate = false; m.matrix.copy(s.matrix); G.add(m);
    if (!s.geometry.boundingBox) s.geometry.computeBoundingBox(); box.union(bb.copy(s.geometry.boundingBox).applyMatrix4(s.matrix));
  }
  F.eye = Math.max(.9, box.max.y - box.min.y - .1); // first person: just below the helmet's top
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2; // feet on the ground, centred on the body
  for (const m of G.children) { m.matrix.premultiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz)); m.matrixWorldNeedsUpdate = true; }
}
export const figShow = on => { G.visible = on; figBody(true); if (on) footCamSnap(); };
export const figBody = on => { for (const m of G.children) m.visible = on; }; // first person hides the body but keeps the contact shadow
export function figPose() { G.position.set(F.x, F.y, F.z); G.rotation.set(0, F.psi, 0); if (ME && ME.mesh.parent === G) figAnim(F.t); }
// this frame's pose from the walker's state (foot.js): idle / walk / run blend by speed, the jump tuck, the landing squash (F.dip)
// F.anim / F.animT: a one-off action pose playing (drinking, a shot, cheers: main.js); F.dk: how drunk (effects.js drunkK)
function figAnim(t) {
  const k = Math.min(1, F.spd / 2.8), dk = F.dk || 0;
  if (F.animT > 0 && POSES[F.anim]) POSES[F.anim](pose, F.anim === 'drink' ? 1.2 - F.animT * .8 : t, 1);
  else if (!F.gnd) POSES.jump(pose, t, Math.min(1, .4 + Math.abs(F.vy) * .12));
  else if (dk > .2 && F.spd > .2) POSES.stagger(pose, t, dk, F.bp);
  else if (dk > .2) { POSES.stand(pose, t); pose[6] += -.2 * dk + .15 * Math.sin(t * 1.9) * dk; pose[7] += .12 * Math.sin(t * 1.3) * dk; pose[0] += .3 * dk; pose[1] += .25 * dk; }
  else if (F.rs > .3 && F.spd > 3.2) POSES.run(pose, t, 1, F.bp);
  else if (F.spd > .2) POSES.walk(pose, t, k, F.bp);
  else POSES.stand(pose, t);
  ME.clear(); ME.push(0, 0, 0, 0, 1, 1, MASK, pose, PAL, Math.max(0, -F.dip) * .5); ME.commit();
}

// ---- camera ----
// C = what the camera has actually settled on: look angles, ground height (so ledge steps glide), orbit focus and distance.
// F.cy / F.cp are the raw targets (main.js changes them while dragging); frame-rate independent exponential smoothing everywhere.
const C = { cy: 0, cp: 0, y: 0, fx: 0, fz: 0, d: 3.8 }, DIST = 3.8, tg = new THREE.Vector3();
export function footCamSnap() { C.cy = F.cy; C.cp = F.cp; C.y = F.y; C.fx = F.x; C.fz = F.z; C.d = DIST; }
const ease = (k, dt) => 1 - Math.exp(-k * dt);
// fit(tx, ty, tz, cx, cy, cz) -> 0..1: inside a building (interior.js camFit) the orbit is shortened so the camera stays in the room
export function footCam(camera, dt, H, fit) {
  const dk = F.dk || 0, roll = dk * (.09 * Math.sin(F.t * .9) + .04 * Math.sin(F.t * 2.3)); // drunk: the horizon tilts back and forth
  dt = Math.min(dt, .1);
  const ka = ease(F.fp ? 55 : 22, dt); C.cy += (F.cy - C.cy) * ka; C.cp += (F.cp - C.cp) * ka; // a whisper of smoothing in first person (removes touch / mouse stair-stepping), more in orbit
  C.y += (F.y - C.y) * (F.gnd ? ease(12, dt) : 1);  // steps and slope kinks glide; in the air the camera follows exactly
  if (F.fp) {
    C.fx = F.x; C.fz = F.z;
    // Half-Life 1 style bob: vertical only (no sway, no roll, no pitch wobble), one slow up-down per stride, height proportional to ground speed (HL: cl_bob = speed * 0.01)
    const by = Math.sin(F.bp) * Math.min(F.spd, 6.2) * .0036 * F.ba;
    camera.position.set(F.x, C.y + F.eye + F.dip + by, F.z);
    camera.rotation.set(-(C.cp - F.dip * .45) + dk * .05 * Math.sin(F.t * 1.3), C.cy, roll); // cp > 0 looks down, cy turns left; landing nods the view down
    return;
  }
  C.fx += (F.x - C.fx) * ease(13, dt); C.fz += (F.z - C.fz) * ease(13, dt); C.d += (DIST + F.rs * .5 - C.d) * ease(4, dt); // the focus trails the walker a little, sprinting pulls the camera back
  tg.set(C.fx, C.y + F.eye * .78 + F.dip * .3, C.fz); const cp = C.cp, k = Math.cos(cp);
  camera.position.set(tg.x + Math.sin(C.cy) * k * C.d, tg.y + Math.sin(cp) * C.d, tg.z + Math.cos(C.cy) * k * C.d); // straight on the orbit: turning is smooth because the angles are
  camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + .45);
  if (fit) { const p = camera.position, f = fit(tg.x, tg.y, tg.z, p.x, p.y, p.z); if (f < 1) p.set(tg.x + (p.x - tg.x) * f, tg.y + (p.y - tg.y) * f, tg.z + (p.z - tg.z) * f); }
  camera.lookAt(tg); if (roll) camera.rotateZ(roll);
}
