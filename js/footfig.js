// The on-foot character's body and camera (logic is in foot.js). The body is the biker already on the bike: B.rider's meshes are
// copied (same geometry + material, no new draws beyond the one per material) into their own group and stood on the ground in
// the bike-seat pose, no animation. Rebuilt on every get-off, so it always matches the current bike's model.
import * as THREE from 'three';
import { B, blobAdd } from './model.js';
import { scene } from './renderer.js';
import { F } from './foot.js';

const G = new THREE.Group(); G.visible = false; scene.add(G);
// contact shadow like the bike's (model.js blobs): nothing here casts into the sun's shadow map
blobAdd({ b: G, p: new THREE.Vector3(0, .5, 0), h0: .5, d: .7, w: .6, cores: 0, spread: 0, vis: () => G.visible, ground: null, off: false });

const box = new THREE.Box3(), bb = new THREE.Box3();
export function figBuild() {
  G.clear(); box.makeEmpty();
  for (const s of B.rider) { // meshes parented to B.ct: s.matrix is their pose in the bike's frame
    s.updateMatrix(); const m = new THREE.Mesh(s.geometry, s.material); m.matrixAutoUpdate = false; m.matrix.copy(s.matrix); G.add(m);
    if (!s.geometry.boundingBox) s.geometry.computeBoundingBox(); box.union(bb.copy(s.geometry.boundingBox).applyMatrix4(s.matrix));
  }
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2; // feet on the ground, centred on the body
  for (const m of G.children) { m.matrix.premultiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz)); m.matrixWorldNeedsUpdate = true; }
}
export const figShow = on => { G.visible = on; };
export function figPose() { G.position.set(F.x, F.y, F.z); G.rotation.set(0, F.psi, 0); }

// third-person camera orbiting the walker: F.cy azimuth, F.cp pitch (drag in main.js)
const tg = new THREE.Vector3(), want = new THREE.Vector3(); const DIST = 3.8;
export function footCam(camera, dt, H) {
  tg.set(F.x, F.y + 1.15, F.z); const cp = F.cp, k = Math.cos(cp);
  want.set(tg.x + Math.sin(F.cy) * k * DIST, tg.y + Math.sin(cp) * DIST, tg.z + Math.cos(F.cy) * k * DIST);
  want.y = Math.max(want.y, H(want.x, want.z) + .5);
  camera.position.lerp(want, 1 - Math.exp(-dt * 14)); camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + .4);
  camera.lookAt(tg);
}
