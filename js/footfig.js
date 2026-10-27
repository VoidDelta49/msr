// The on-foot character's body and camera (logic is in foot.js). The body is the biker already on the bike: B.rider's geometry is
// reused (same materials, no new draws beyond the one per material) in its own group and put in a STANDING pose, no animation:
// legs straight down on the shoes, torso upright, arms hanging. Rebuilt on every get-off, so it always matches the current bike's
// rider (limb lengths differ per bike). Camera: smoothed look angles, eased ground steps, view bob and the take-off / landing dip.
import * as THREE from 'three';
import { B, blobAdd } from './model.js';
import { scene } from './renderer.js';
import { F } from './foot.js';

const G = new THREE.Group(); G.visible = false; scene.add(G);
// contact shadow like the bike's (model.js blobs): nothing here casts into the sun's shadow map
blobAdd({ b: G, p: new THREE.Vector3(0, .5, 0), h0: .5, d: .7, w: .6, cores: 0, spread: 0, vis: () => G.visible, ground: null, off: false });

const box = new THREE.Box3(), bb = new THREE.Box3(), v3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
const size = g => { if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox.getSize(v3); };
const put = (g, mat, x, y, z, rx = 0) => { // a mesh with its own pose (m.matrix); matrixAutoUpdate off like the seated copy
  const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; m.matrix.compose(new THREE.Vector3(x, y, z), q4.setFromEuler(e3.set(rx, 0, 0)), one); G.add(m); return m;
};
// model.js rider(): [0] torso, [1] helmet, [2] visor, then per side (left, right) arm, glove, thigh, shin, shoe = 13 meshes.
// Returns false if the rider isn't that shape (a future model): the caller falls back to the seated copy.
function standUp(R) {
  if (R.length !== 13) return false;
  const [T, Hm, V] = R, A = R[3], Th = R[5], Sh = R[6]; // measured on the left side's limbs (both sides are the same size)
  const al = size(A.geometry).z, lt = size(Th.geometry).z, ls = size(Sh.geometry).y; if (!(al > .05 && lt > .05 && ls > .05)) return false;
  if (!T.geometry.boundingBox) T.geometry.computeBoundingBox(); const tb = T.geometry.boundingBox, th = tb.max.y - tb.min.y;
  const shinTop = .065 + ls, hipTop = shinTop - .02 + lt;       // shoe sole -> shin -> thigh, a little overlap at each joint
  const tcy = hipTop - .03 - tb.min.y, torsoTop = tcy + tb.max.y; // torso sits on the thighs (its profile is centred on its own origin)
  const hy = torsoTop + .12, shY = tcy + th * .38;              // helmet centre (overlaps the neck), shoulder height
  put(T.geometry, T.material, 0, tcy, 0);
  put(Hm.geometry, Hm.material, 0, hy, -.02); put(V.geometry, V.material, 0, hy - .01, -.02 - .13);
  for (const s of [-1, 1]) {
    const o = s < 0 ? 0 : 5, a = R[3 + o], g = R[4 + o], t = R[5 + o], k = R[6 + o], f = R[7 + o];
    put(a.geometry, a.material, s * .23, shY - al / 2, 0, Math.PI / 2);          // arm: its long axis (z) turned to hang down
    put(g.geometry, g.material, s * .23, shY - al - .01, 0);
    put(t.geometry, t.material, s * .09, shinTop - .02 + lt / 2, 0, Math.PI / 2); // thigh: long axis z turned vertical
    put(k.geometry, k.material, s * .09, .065 + ls / 2, 0);
    put(f.geometry, f.material, s * .09, .035, -.04);
  }
  F.eye = hy; // first person: eyes at the visor
  return true;
}
export function figBuild() {
  G.clear(); box.makeEmpty();
  if (standUp(B.rider)) return;
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
