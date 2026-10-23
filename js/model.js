// Bike 3D models. Each builder fills the same handles (B.rearH, B.swing, B.steer, B.slider, B.thrG, levers,
// B.rider, B.cam, B.exh) and sets B.G, the geometry the animation in main.js reads.
// Front of the bike is -z; ct coordinates are ground-relative at static sag.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PI } from './util.js';
import { scene, std } from './renderer.js';
import { cluTex } from './hud.js';

const MP = std(0x888888, .32, .35), MB = std(0x141518, .6, .2), MR = std(0x0d0d0d, .95), MC = std(0xd5dae0, .22, 1), ME = std(0x45484d, .45, .7),
  MS = std(0x1b1b1b, .85), MG = std(0x2b2e33, .8), MRd = std(0x223344, .7), MTail = std(0x330000, .4, 0, 0xff1a1a), MHead = std(0xfff8e0, .2, 0, 0xfff4d0),
  MAmb = std(0x3a2400, .4, 0, 0xff9a1a);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (a, b, h, s = 12) => new THREE.CylinderGeometry(a, b, h, s);
function mk(geo, m, par, x, y, z, rx = 0, ry = 0, rz = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; par.add(o); return o; }
function wheelG(R, t, rim, spokes, sw) {
  const g = new THREE.Group(); mk(new THREE.TorusGeometry(R, t, 10, 30), MR, g, 0, 0, 0, 0, PI / 2); mk(new THREE.TorusGeometry(rim, .012, 6, 30), MC, g, 0, 0, 0, 0, PI / 2);
  for (let i = 0; i < spokes; i++) mk(box(.012, rim * 2, sw), MB, g, 0, 0, 0, i * PI / spokes); mk(cyl(.11, .11, .01, 20), MC, g, .05, 0, 0, 0, 0, PI / 2); return g;
}
export const B = { root: new THREE.Group(), lean: new THREE.Group(), body: new THREE.Group(), ct: new THREE.Group(), MP };
B.root.add(B.lean); B.lean.add(B.body); B.body.add(B.ct); B.ct.position.y = -.6; scene.add(B.root);

function clusterPlane(par, x, y, z, rx, w = .25) { const p = mk(new THREE.PlaneGeometry(w, w * 224 / 512), new THREE.MeshBasicMaterial({ map: cluTex }), par, x, y, z, rx); p.castShadow = false; }

/* ---------- sport underbone (Raider) ---------- */
function sport(ct) {
  B.G = { rw: .29, rearZ: .65, fork: .728, rake: .436, pivotY: .42, pivotZ: .08, swingX: 0 };
  B.rearH = new THREE.Group(); B.rearH.position.set(0, .29, .65); ct.add(B.rearH); B.rearW = wheelG(.245, .048, .2, 5, .03); B.rearH.add(B.rearW);
  B.swing = mk(box(.05, .06, 1), MB, ct, 0, .36, .37);
  mk(box(.24, .3, .4), ME, ct, 0, .44, -.04); mk(box(.2, .12, .18), MG, ct, 0, .28, -.12); mk(box(.07, .07, .9), MB, ct, 0, .8, -.02, -.35);
  const tank = mk(new THREE.SphereGeometry(1, 18, 12), MP, ct, 0, .9, -.1); tank.scale.set(.17, .13, .3);
  mk(box(.27, .15, .34), MP, ct, 0, .72, .18); mk(box(.24, .07, .5), MS, ct, 0, .86, .36, -.06); mk(box(.19, .1, .38), MP, ct, 0, .88, .66, .22);
  mk(box(.12, .04, .03), MTail, ct, 0, .91, .86); mk(box(.5, .03, .05), MB, ct, 0, .33, .05);
  const tilt = new THREE.Group(); tilt.position.set(0, .95, -.32); tilt.rotation.x = .436; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.02, .02, .46), MC, st, s * .08, -.18, 0);
  mk(box(.22, .03, .08), MB, st, 0, .04, 0);
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -.728;
  for (const s of [-1, 1]) mk(cyl(.028, .028, .32), MB, B.slider, s * .08, .16, 0);
  B.frontW = wheelG(.245, .048, .2, 5, .03); B.slider.add(B.frontW); mk(box(.11, .025, .42), MP, B.slider, 0, .31, -.02, .05);
  mk(box(.3, .22, .14), MP, st, 0, .02, -.16, .3); mk(box(.16, .07, .03), MHead, st, 0, 0, -.235, .3);
  clusterPlane(st, 0, .2, -.08, -.9);
  mk(cyl(.011, .011, .62), MC, st, 0, .16, .07, 0, 0, PI / 2); mk(cyl(.018, .018, .12), MR, st, -.29, .16, .07, 0, 0, PI / 2);
  B.thrG = new THREE.Group(); B.thrG.position.set(.29, .16, .07); st.add(B.thrG); mk(cyl(.019, .019, .12), MR, B.thrG, 0, 0, 0, 0, 0, PI / 2); mk(box(.1, .006, .04), std(0x888888, .5), B.thrG, 0, .019, 0);
  B.brkL = new THREE.Group(); B.brkL.position.set(.2, .165, .04); st.add(B.brkL); mk(box(.15, .012, .02), MC, B.brkL, .08, 0, -.05);
  B.cluL = new THREE.Group(); B.cluL.position.set(-.2, .165, .04); st.add(B.cluL); mk(box(.15, .012, .02), MC, B.cluL, -.08, 0, -.05);
  for (const s of [-1, 1]) { mk(cyl(.005, .005, .22), MB, st, s * .25, .25, 0, 0, 0, -s * .6); mk(cyl(.042, .042, .012, 16), MG, st, s * .34, .31, -.02, PI / 2 - .2); }
  for (const s of [-1, 1]) mk(box(.08, .07, .1), MG, st, s * .255, .17, .075);
  B.rider = [mk(box(.36, .52, .24), MRd, ct, 0, 1.13, .3, -.35), mk(new THREE.SphereGeometry(.14, 14, 10), MB, ct, 0, 1.48, .14)];
  for (const s of [-1, 1]) B.rider.push(mk(box(.08, .08, .45), MRd, ct, s * .22, 1.18, 0, .6), mk(box(.13, .13, .45), MRd, ct, s * .15, .9, .2, .2), mk(box(.11, .42, .11), MRd, ct, s * .18, .58, .02, -.2));
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.36, .1); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  B.buildExh = s => {
    B.exh.clear(); const L = [.48, .4, .34][s], R = [.065, .06, .055][s], col = [0x2a2c30, 0x111111, 0x6f7fa8][s];
    mk(cyl(.025, .025, .6), MC, B.exh, .12, .3, .15, PI / 2 - .3); mk(cyl(R, R * .85, L, 16), std(col, .35, .8), B.exh, .16, .44, .62, PI / 2 - .3);
  };
}

/* ---------- step-through scooter (Click 125i) ---------- */
// 14" wheels (100/80-14 rear ≈ 0.258 m radius), 1.28 m wheelbase, ~26.5° rake, unit-swing engine/CVT case on the left
function scooter(ct) {
  const rw = .258, rake = .46, headY = .86, fork = (headY - rw) / Math.cos(rake), headZ = -.64 + fork * Math.sin(rake);
  B.G = { rw, rearZ: .64, fork, rake, pivotY: .34, pivotZ: .02, swingX: -.1 };
  B.rearH = new THREE.Group(); B.rearH.position.set(0, rw, .64); ct.add(B.rearH); B.rearW = wheelG(.215, .043, .175, 5, .045); B.rearH.add(B.rearW);
  // unit swing: engine + CVT case pivots with the rear wheel (stretched between pivot and axle each frame)
  B.swing = mk(box(.12, .2, 1), ME, ct, -.1, .3, .33);
  mk(box(.14, .18, .2), MG, ct, -.02, .3, .0);                          // cylinder + head, forward of the case
  mk(cyl(.015, .015, .3), MC, ct, .12, .5, .52, -.5);                    // rear shock (right side)
  mk(box(.3, .05, .46), MB, ct, 0, .3, -.12); mk(box(.29, .012, .44), MS, ct, 0, .33, -.12);   // floorboard
  mk(box(.42, .44, .05), MB, ct, 0, .55, -.33, .2);                      // inner leg shield
  mk(box(.46, .52, .07), MP, ct, 0, .56, -.39, .2);                      // front apron
  mk(box(.2, .07, .03), MAmb, ct, 0, .4, -.44, .2);                      // front signal strip
  mk(box(.3, .26, .62), MP, ct, 0, .6, .36); mk(box(.26, .14, .5), MG, ct, 0, .43, .38);       // rear body + lower cover
  mk(box(.28, .09, .62), MS, ct, 0, .78, .32, -.04);                     // seat
  mk(box(.2, .08, .2), MP, ct, 0, .7, .72, .3); mk(box(.15, .04, .03), MTail, ct, 0, .72, .81, .3);
  mk(box(.26, .025, .16), MB, ct, 0, .8, .62);                           // grab rail
  const tilt = new THREE.Group(); tilt.position.set(0, headY, headZ); tilt.rotation.x = rake; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.019, .019, .42), MC, st, s * .07, -.22, 0);
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -fork;
  for (const s of [-1, 1]) mk(cyl(.026, .026, .28), MB, B.slider, s * .07, .14, 0);
  B.frontW = wheelG(.215, .043, .175, 5, .045); B.slider.add(B.frontW); mk(box(.1, .025, .36), MP, B.slider, 0, .27, -.02, .05);
  // handlebar cover with headlight, cluster on top
  mk(box(.52, .1, .2), MP, st, 0, .1, -.02); mk(box(.34, .06, .05), MHead, st, 0, .09, -.13);
  clusterPlane(st, 0, .16, .04, -1.05, .26);
  mk(cyl(.018, .018, .12), MR, st, -.31, .12, .02, 0, 0, PI / 2);
  B.thrG = new THREE.Group(); B.thrG.position.set(.31, .12, .02); st.add(B.thrG); mk(cyl(.019, .019, .12), MR, B.thrG, 0, 0, 0, 0, 0, PI / 2); mk(box(.1, .006, .04), std(0x888888, .5), B.thrG, 0, .019, 0);
  // both levers are brakes (right = front, left = rear/CBS)
  B.brkL = new THREE.Group(); B.brkL.position.set(.23, .125, -.01); st.add(B.brkL); mk(box(.15, .012, .02), MC, B.brkL, .08, 0, -.05);
  B.cluL = new THREE.Group(); B.cluL.position.set(-.23, .125, -.01); st.add(B.cluL); mk(box(.15, .012, .02), MC, B.cluL, -.08, 0, -.05);
  for (const s of [-1, 1]) { mk(cyl(.005, .005, .2), MB, st, s * .22, .22, -.02, 0, 0, -s * .5); mk(cyl(.04, .04, .012, 16), MG, st, s * .29, .31, -.04, PI / 2 - .2); }
  // rider: upright, feet flat on the floorboard
  B.rider = [mk(box(.36, .52, .24), MRd, ct, 0, 1.1, .3, -.1), mk(new THREE.SphereGeometry(.14, 14, 10), MB, ct, 0, 1.46, .25)];
  for (const s of [-1, 1]) B.rider.push(mk(box(.08, .08, .66), MRd, ct, s * .25, 1.14, 0, -.58), mk(box(.13, .13, .42), MRd, ct, s * .14, .88, .12, -.05), mk(box(.11, .44, .11), MRd, ct, s * .16, .58, -.12, .08));
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.38, .2); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  B.buildExh = s => {
    B.exh.clear(); const L = [.42, .36, .32][s], R = [.07, .062, .056][s], col = [0x2a2c30, 0x111111, 0x6f7fa8][s];
    mk(cyl(.022, .022, .4), MC, B.exh, .1, .22, .18, PI / 2 - .15); mk(cyl(R, R * .85, L, 16), std(col, .35, .8), B.exh, .15, .34, .52, PI / 2 - .2);
  };
}

// Draw-call diet: meshes that share a parent and a material are baked into one mesh (a bike drew ~50 meshes, each twice
// with its shadow). Animated groups (wheels, steering, fork slider, levers, throttle) keep their own transforms; their
// static children are merged inside them. The swingarm is skipped (it is rescaled every frame).
function mergeList(L, par) {
  const g = mergeGeometries(L.map(o => { o.updateMatrix(); return o.geometry.clone().applyMatrix4(o.matrix); }));
  const m = new THREE.Mesh(g, L[0].material); m.castShadow = true; par.add(m); for (const o of L) { par.remove(o); o.geometry.dispose(); } return m;
}
function mergeStatic(par, skip) {
  const by = new Map();
  for (const o of [...par.children]) {
    if (o.isGroup) { if (o !== B.exh) mergeStatic(o, skip); continue; }
    if (!o.isMesh || skip.has(o) || o.material.map === cluTex) continue;
    if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(o);
  }
  for (const L of by.values()) if (L.length > 1) mergeList(L, par);
}
const MODELS = { sport, scooter };
export function buildModel(bike) {
  B.ct.clear(); MODELS[bike.model](B.ct);
  // rider: one mesh per material, still listed in B.rider (camera toggles visibility, crashes move them)
  const rm = new Map(); for (const o of B.rider) { if (!rm.has(o.material)) rm.set(o.material, []); rm.get(o.material).push(o); }
  B.rider = [...rm.values()].map(L => L.length > 1 ? mergeList(L, B.ct) : L[0]);
  mergeStatic(B.ct, new Set([B.swing, ...B.rider]));
  // Shadows: the bike's static + steering parts cast through ONE proxy (position + normal: WebGPU's shadow pass needs normals) on layer 1 (only the shadow camera
  // sees it), instead of ~25 separate shadow draws. Rider, swingarm and exhaust still cast their own (they move/swap).
  const keep = new Set([B.swing, ...B.rider]), parts = [], inv = new THREE.Matrix4(); B.ct.updateMatrixWorld(true); inv.copy(B.ct.matrixWorld).invert();
  B.ct.traverse(o => {
    if (!o.isMesh || o.material.map === cluTex) return; o.castShadow = keep.has(o);
    if (!keep.has(o)) { const g = new THREE.BufferGeometry(); g.setAttribute('position', o.geometry.attributes.position.clone()); g.setAttribute('normal', o.geometry.attributes.normal.clone()); if (o.geometry.index) g.setIndex(o.geometry.index.clone()); parts.push(g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); }
  });
  const px = new THREE.Mesh(mergeGeometries(parts), MB); px.castShadow = true; px.layers.set(1); B.ct.add(px);
}
export function applyLook(spec) { MP.color.set(spec.c); B.buildExh(spec.snd); }
