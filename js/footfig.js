// The on-foot character's body and camera (logic is in foot.js). The body is the biker already on the bike, but STANDING (model.js
// riderStand(): same material, one draw, no animation): legs straight down on the shoes, torso upright, arms hanging. Rebuilt on every
// get-off, so it always matches the current bike's rider (limb lengths differ per bike). If that isn't available the seated copy of B.rider is used. Camera: smoothed look angles, eased ground steps, view bob and the take-off / landing dip.
import * as THREE from 'three';
import { B, blobAdd, riderStand } from './model.js';
import { scene } from './renderer.js';
import { F } from './foot.js';

const G = new THREE.Group(); G.visible = false; scene.add(G);
// contact shadow like the bike's (model.js blobs): nothing here casts into the sun's shadow map
blobAdd({ b: G, p: new THREE.Vector3(0, .5, 0), h0: .5, d: .7, w: .6, cores: 0, spread: 0, vis: () => G.visible, ground: null, off: false });

const box = new THREE.Box3(), bb = new THREE.Box3();
export function figBuild() {
  for (const m of G.children) if (m.userData.own) m.geometry.dispose(); // the standing body's geometry is built per get-off
  G.clear(); box.makeEmpty();
  const st = riderStand(); // standing pose, built from this bike's rider limb sizes (B.rider itself is one merged, seated mesh)
  if (st) { const m = new THREE.Mesh(st.geo, st.mat); m.userData.own = true; G.add(m); F.eye = st.eye; return; }
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
export function figPose() { G.position.set(F.x, F.y, F.z); G.rotation.set(0, F.psi, 0); }

// ---- camera ----
// C = what the camera has actually settled on: look angles, ground height (so ledge steps glide), orbit focus and distance.
// F.cy / F.cp are the raw targets (main.js changes them while dragging); frame-rate independent exponential smoothing everywhere.
const C = { cy: 0, cp: 0, y: 0, fx: 0, fz: 0, d: 3.8 }, DIST = 3.8, tg = new THREE.Vector3();
export function footCamSnap() { C.cy = F.cy; C.cp = F.cp; C.y = F.y; C.fx = F.x; C.fz = F.z; C.d = DIST; }
const ease = (k, dt) => 1 - Math.exp(-k * dt);
export function footCam(camera, dt, H) {
  dt = Math.min(dt, .1);
  const ka = ease(F.fp ? 55 : 22, dt); C.cy += (F.cy - C.cy) * ka; C.cp += (F.cp - C.cp) * ka; // a whisper of smoothing in first person (removes touch / mouse stair-stepping), more in orbit
  C.y += (F.y - C.y) * (F.gnd ? ease(12, dt) : 1);  // steps and slope kinks glide; in the air the camera follows exactly
  if (F.fp) {
    C.fx = F.x; C.fz = F.z;
    // Half-Life 1 style bob: vertical only (no sway, no roll, no pitch wobble), one slow up-down per stride, height proportional to ground speed (HL: cl_bob = speed * 0.01)
    const by = Math.sin(F.bp) * Math.min(F.spd, 6.2) * .0036 * F.ba;
    camera.position.set(F.x, C.y + F.eye + F.dip + by, F.z);
    camera.rotation.set(-(C.cp - F.dip * .45), C.cy, 0); // cp > 0 looks down, cy turns left; landing nods the view down
    return;
  }
  C.fx += (F.x - C.fx) * ease(13, dt); C.fz += (F.z - C.fz) * ease(13, dt); C.d += (DIST + F.rs * .5 - C.d) * ease(4, dt); // the focus trails the walker a little, sprinting pulls the camera back
  tg.set(C.fx, C.y + F.eye * .78 + F.dip * .3, C.fz); const cp = C.cp, k = Math.cos(cp);
  camera.position.set(tg.x + Math.sin(C.cy) * k * C.d, tg.y + Math.sin(cp) * C.d, tg.z + Math.cos(C.cy) * k * C.d); // straight on the orbit: turning is smooth because the angles are
  camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + .45);
  camera.lookAt(tg);
}
