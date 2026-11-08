// Render bundles for the static island (WebGPU only). On a phone, most of the CPU frame is three.js work per object
// (projection, sorting, pipeline / bind group / vertex buffer setup, the draw call: ~100 µs each on a 4-core Android).
// A BundleGroup records its children's draw commands once into a GPURenderBundle and replays it every frame with one
// executeBundles; with `static` set (three's default) its objects also skip three's per-object change check.
//
// The island's frozen, opaque objects (freeze() in perf.js: buildings, props in 700 m / 140 m chunks, signs, wires, the
// GPU-culled prop meshes...) are moved into bundle groups by area. What a recording cannot follow, and how it is handled:
// - Frustum culling: a recording keeps whatever was in view when it was made, so the objects inside have frustumCulled
//   off and each CELL is culled as a whole instead (its members' bounding spheres), for every camera that renders the
//   scene (main view, shadow map), in scene.onBeforeRender. A cell is one 250 m square for small objects and a 1000 m
//   square for big ones, so a cell's sphere stays close to its members'. Objects three never culled (GPU-culled props:
//   the compute pass culls per instance) go into one cell that is always drawn.
// - Anything else that changes what is drawn (distance culling and night-only objects toggling `visible`, an instance
//   count, a material swap or recompile, edited instances or geometry, a moved object): a cheap signature per cell is
//   compared every render, and a changed cell is recorded again (one ordinary render of that cell). An object that keeps
//   changing for other reasons than `visible` is moved back out of the bundle for good.
// - Material values changed in place: lit windows (emissive intensity follows the lamps). A lamp-level change bumps the cells
//   holding one, so three compares those objects again and uploads the new value.
// - Order: three runs all bundles at the END of the pass (after transparents and the sky). Here each bundle runs where
//   three handles it, before the opaque list: the island first, then terrain and the rest, the sky last at the far plane
//   (it skips every pixel already covered), then the transparents over everything, as without bundles.
import * as THREE from 'three';
import { BundleGroup } from 'three';
import { renderer, GPU, scene } from './renderer.js';
import { cfg } from './config.js';
import { glowing, LAMP_HOOKS } from './lights.js';

export const BUNDLE = { on: false, cells: [], objects: 0, records: 0, ejected: 0, rebinds: 0, texResets: 0 };
const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), box = new THREE.Box3(), v = new THREE.Vector3();

// executeBundles where three asks for the bundle (start of the pass, before the opaques), not at the end. Running a bundle
// clears the pass's pipeline, bind groups and vertex / index buffers (WebGPU spec), so three's cache of what is bound is
// cleared with it (blend constant, stencil reference, viewport and scissor survive a bundle and keep their cache).
// Stale bind groups: a recording holds the GPU bind groups of the moment. When three replaces one while replaying (a texture
// it points at was re-created, e.g. the shadow map), the old recording would use a destroyed texture (a validation error,
// and three of those fall back to WebGL). So during a replay the bundle is held back; if any bind group was rebuilt meanwhile,
// it is dropped and recorded again on the spot, then run.
let hold = null, rebind = false;
function patchBackend() {
  const b = renderer.backend, run = (d, g) => { d.currentPass.executeBundles([g]); d.currentSets = { attributes: {}, bindingGroups: [], pipeline: null, index: null }; };
  b.addBundle = function (rc, bundle) {
    const d = this.get(rc), g = this.get(bundle).bundleGPU;
    if (hold) hold.push([d, g]); else run(d, g);
  };
  // a texture re-created under a recording (the shadow map's depth texture once, early on; render targets on a resize): its
  // bind group points at the destroyed one, and a static replay never looks. Rare, so every cell is simply recorded again.
  const dt = b.destroyTexture; b.destroyTexture = function (...a) { for (const c of BUNDLE.cells) c.g.needsUpdate = true; BUNDLE.texResets++; return dt.apply(this, a); };
  for (const k of ['createBindings', 'updateBindings']) { const f = b[k]; b[k] = function (...a) { rebind = true; return f.apply(this, a); }; }
  const R = renderer, orig = R._renderBundle;
  R._renderBundle = function (bundle, sceneRef, lightsNode) {
    const rb = this._bundles.get(bundle.bundleGroup, bundle.camera, this._currentRenderContext), rec = this._bundleNeedsUpdate(bundle.bundleGroup, this.backend.get(rb));
    const outer = hold, rb0 = rebind; // (a recording can render something else on the way: keep the outer call's state)
    hold = []; rebind = false; orig.call(this, bundle, sceneRef, lightsNode); let h = hold;
    if (rebind && !rec) { bundle.bundleGroup.needsUpdate = true; BUNDLE.rebinds++; hold = []; orig.call(this, bundle, sceneRef, lightsNode); h = hold; }
    else if (!rec) { const ro = this.backend.get(rb).renderObjects; if (ro) this.info.render.drawCalls += ro.length; } // a replay draws without three counting it (HUD, benchmark)
    hold = outer; rebind = rb0 || rebind;
    for (const [d, g] of h) run(d, g);
  };
}

const TEX = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap'];
const mats = o => o.material ? [].concat(o.material) : [];
// can this scene child live in a recording? frozen (it and everything under it), drawable, opaque, no special order
function eligible(o) {
  if (o.isBundleGroup || o.isLight || o.isCamera || o.isBatchedMesh || o.isSkinnedMesh || o.isSprite || o.isPoints || o.isLOD) return false;
  let ok = true, any = false;
  o.traverse(c => {
    if (!ok) return;
    if (c.matrixAutoUpdate || c.renderOrder || c.isBatchedMesh || c.isSkinnedMesh || c.isSprite || c.isPoints || c.isLOD || c.isLight || c.isCamera || c.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) { ok = false; return; }
    if (c.isMesh || c.isLine) { any = true; for (const m of mats(c)) if (m.transparent || m.blending !== THREE.NormalBlending) ok = false; }
  });
  return ok && any;
}
// world-space bounding sphere of a member; null = never culled (draw always)
function sphereOf(o) {
  if (o.frustumCulled === false && !o.isGroup) return null;
  if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); return o.boundingSphere.clone().applyMatrix4(o.matrixWorld); }
  if ((o.isMesh || o.isLine) && !o.children.length) { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); return g.boundingSphere.clone().applyMatrix4(o.matrixWorld); }
  box.setFromObject(o); return box.isEmpty() ? null : box.getBoundingSphere(new THREE.Sphere());
}
// everything about a member that a recording depends on, folded into one number
function sig(o) {
  let s = 0;
  o.traverse(c => {
    s = s * 31 + (c.visible ? 1 : 2);
    if (!(c.isMesh || c.isLine)) return;
    const e = c.matrixWorld.elements, g = c.geometry;
    s = s * 31 + e[0] + e[5] * 3 + e[10] * 5 + e[12] * 7 + e[13] * 11 + e[14] * 13 + (c.layers.mask * 17) + (c.castShadow ? 19 : 0);
    if (c.isInstancedMesh) s = s * 31 + c.count + c.instanceMatrix.version * 3 + (c.instanceColor ? c.instanceColor.version * 5 : 0);
    for (const m of mats(c)) { s = s * 31 + m.id + m.version * 7 + (m.visible ? 0 : 3); for (const k of TEX) if (m[k]) s = s * 31 + m[k].id + m[k].version * 3; } // (a replayed static object never uploads an edited texture: record again)
    s = s * 31 + g.id + (g.index ? g.index.version : 0) + (g.attributes.position ? g.attributes.position.version * 3 : 0) + g.drawRange.start * 5 + Math.min(g.drawRange.count, 1e9) * 7;
    s %= 1e15; // (only ever compared with its own previous value: same inputs, same number)
  });
  return s;
}
const visSig = o => { let s = 0; o.traverse(c => { s = s * 3 + (c.visible ? 1 : 2); s %= 1e15; }); return s; };

// move the static island into bundle groups; call once after the world is built, before the shader warm-up
export function bundleStatic() {
  if (!GPU || cfg.bundles === false || BUNDLE.on || !renderer.backend.beginBundle) return 0;
  patchBackend(); scene.updateMatrixWorld(true);
  const by = new Map();
  for (const o of [...scene.children]) {
    if (!eligible(o)) continue;
    const s = sphereOf(o), big = s && s.radius > 120, sz = big ? 1000 : 250;
    const k = !s ? 'all' : (big ? 'L' : 'S') + Math.floor(s.center.x / sz) + ',' + Math.floor(s.center.z / sz);
    let c = by.get(k); if (!c) by.set(k, c = { g: new BundleGroup(), members: [], box: new THREE.Box3(), always: !s });
    if (s) c.box.union(new THREE.Box3(v.copy(s.center).subScalar(s.radius), s.center.clone().addScalar(s.radius)));
    const fc = []; o.traverse(x => { fc.push([x, x.frustumCulled]); x.frustumCulled = false; });
    c.members.push({ o, fc, vs: 0, s: 0, n: 0 });
  }
  for (const [k, c] of by) {
    c.g.name = 'bundle ' + k; c.g.matrixAutoUpdate = false; c.g.updateMatrix();
    c.sphere = c.always ? null : c.box.getBoundingSphere(new THREE.Sphere());
    for (const m of c.members) { scene.remove(m.o); c.g.add(m.o); m.vs = visSig(m.o); m.s = sig(m.o); }
    c.glow = c.members.some(m => { let gl = false; m.o.traverse(x => { for (const q of mats(x)) if (glowing(q)) gl = true; }); return gl; });
    c.sig = c.members.reduce((a, m) => (a * 31 + m.s) % 1e15, 0);
    scene.add(c.g); BUNDLE.cells.push(c); BUNDLE.objects += c.members.length;
  }
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, cam, rt) { prev.call(this, r, s, cam, rt); check(cam); };
  // lit windows: the lamp level changes their emissive intensity in place, which a static replay doesn't look at. A new version
  // makes three compare those objects once more (and upload the new value) and re-records the cell: only while the lamps fade
  // (up to ~200 steps across dusk), never in daylight or at night.
  LAMP_HOOKS.push(() => { for (const c of BUNDLE.cells) if (c.glow) c.g.needsUpdate = true; });
  BUNDLE.on = true; return BUNDLE.objects;
}

// every render of the scene, for the camera it is rendered with: cull whole cells, re-record changed ones
function check(cam) {
  cam.updateMatrixWorld(); pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm, cam.coordinateSystem);
  for (const c of BUNDLE.cells) {
    let s = 0, out = null;
    for (const m of c.members) {
      const x = sig(m.o);
      if (x !== m.s) { const vs = visSig(m.o); if (vs === m.vs && ++m.n > 3) (out || (out = [])).push(m); m.s = x; m.vs = vs; }
      s = (s * 31 + x) % 1e15;
    }
    if (out) for (const m of out) eject(c, m); // keeps changing for reasons other than visibility: a recording can't keep up
    if (s !== c.sig) { c.sig = s; c.g.needsUpdate = true; BUNDLE.records++; }
    // warm() (renderer.js) turns frustumCulled off on everything while it compiles: then every cell is drawn
    c.g.visible = c.members.length > 0 && (!c.sphere || !c.g.frustumCulled || fr.intersectsSphere(c.sphere));
  }
}
function eject(c, m) {
  c.members.splice(c.members.indexOf(m), 1); c.g.remove(m.o); scene.add(m.o);
  for (const [x, f] of m.fc) x.frustumCulled = f;
  c.g.needsUpdate = true; BUNDLE.ejected++; BUNDLE.objects--;
}
