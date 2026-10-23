// Bike 3D models. Each builder fills the same handles (B.rearH, B.swing, B.steer, B.slider, B.thrG, levers,
// B.rider, B.cam, B.exh) and sets B.G, the geometry the animation in main.js reads.
// Front of the bike is -z; ct coordinates are ground-relative at static sag.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PI } from './util.js';
import { scene, std } from './renderer.js';
import * as T from './tex.js';
import { mkTex } from './tex.js';
import { cluTex } from './hud.js';

const MP = std(0x888888, .32, .35), MB = std(0x141518, .6, .2), MR = std(0x0d0d0d, .95), MC = std(0xd5dae0, .22, 1), ME = std(0x45484d, .45, .7),
  MS = std(0x1b1b1b, .85), MG = std(0x2b2e33, .8), MRd = std(0x223344, .7), MTail = std(0x330000, .4, 0, 0xff1a1a), MHead = std(0xfff8e0, .2, 0, 0xfff4d0),
  MAmb = std(0x3a2400, .4, 0, 0xff9a1a);
// Carbon fiber: one 2x2 twill canvas texture shared by every carbon part. Fenders (MF) and wheel spokes (MW) have their own
// materials so each garage option can switch just its parts; MCF is plain carbon (fenders, wheels, muffler cover).
const MF = std(0x888888, .32, .35), MW = std(0x50545b, .4, .6);
const CF = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const h = (x + y) % 4 < 2, gr = h ? g.createLinearGradient(0, y * 8, 0, y * 8 + 8) : g.createLinearGradient(x * 8, 0, x * 8 + 8, 0);
    gr.addColorStop(0, h ? '#5a5a5a' : '#262626'); gr.addColorStop(.5, h ? '#c4c4c4' : '#6a6a6a'); gr.addColorStop(1, h ? '#5a5a5a' : '#262626');
    g.fillStyle = gr; g.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
})();
const MCF = new THREE.MeshStandardMaterial({ color: 0x8a9099, map: CF, roughness: .22, metalness: .1 });
// switch a material between its stock look and carbon (needsUpdate only when the map changes: that recompiles the shader)
function carbon(m, on, col, tint) {
  if (!!m.map !== on) { m.map = on ? CF : null; m.needsUpdate = true; }
  if (on) { m.color.set(tint ? col : 0x8a9099); if (tint) m.color.lerp(MCF.color, .25); m.roughness = .22; m.metalness = .1; } else { m.color.set(col); m.roughness = m.userData.r; m.metalness = m.userData.mt; }
}
for (const m of [MP, MF, MW]) m.userData = { r: m.roughness, mt: m.metalness };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (a, b, h, s = 8) => new THREE.CylinderGeometry(a, b, h, s);
function mk(geo, m, par, x, y, z, rx = 0, ry = 0, rz = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; par.add(o); return o; }
// Low-poly panels: a side profile [[z, y], ...] (a 4-number entry = quadratic curve: control z,y then end z,y) extruded
// to width w, centred on x = 0, with a one-step chamfer b. Chunky bevelled slabs = the cute N64 toy look.
function prof(pts, w, b = .012, seg = 3) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) p.length === 4 ? s.quadraticCurveTo(p[0], p[1], p[2], p[3]) : s.lineTo(p[0], p[1]);
  const d = Math.max(.002, w - 2 * b), g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: seg });
  return g.rotateY(-PI / 2).translate(d / 2, 0, 0);
}
// fender: annulus sector around the axle (angles from +z = rear, PI/2 = top, PI = front), width w
function arc(r1, r2, a0, a1, w, seg = 5) {
  const s = new THREE.Shape(); s.absarc(0, 0, r2, a0, a1, false); s.absarc(0, 0, r1, a1, a0, true);
  const d = w - .012, g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: .006, bevelSize: .006, bevelSegments: 1, curveSegments: seg });
  return g.rotateY(-PI / 2).translate(d / 2, 0, 0);
}
// wheel: chunky low-poly tyre, rim lip, spokes (y = twin "Y" arms), hub, brake disc on the right
function wheelG(R, t, rim, spokes, sw, y, disc = .11) {
  const g = new THREE.Group(); mk(new THREE.TorusGeometry(R, t, 6, 18), MR, g, 0, 0, 0, 0, PI / 2); mk(new THREE.TorusGeometry(rim, .014, 4, 18), MW, g, 0, 0, 0, 0, PI / 2);
  for (let i = 0; i < spokes; i++) for (const o of y ? [-.17, .17] : [0]) { const a = i * 2 * PI / spokes + o; mk(box(.018, rim, sw).translate(0, rim / 2 + .02, 0), MW, g, 0, 0, 0, a); }
  mk(cyl(.05, .05, .1, 8), MW, g, 0, 0, 0, 0, 0, PI / 2); mk(cyl(disc, disc, .008, 14), MC, g, .055, 0, 0, 0, 0, PI / 2);
  return g;
}
const MVis = std(0x0c0f14, .1, .6), MAlu = std(0xb6bbc1, .35, .7), MPl = new THREE.MeshStandardMaterial({ map: mkTex(T.plate()), roughness: .5 }), MDec = new THREE.MeshStandardMaterial({ map: mkTex(T.stripes(0xd8262c, 0xf2f2f2), [1 / .26, 1 / .26]), roughness: .35, metalness: .2 });
MDec.map.offset.set(.34 / .26, -.58 / .26);
// cute rider: chunky jacket, jeans, white sneakers, round helmet with a dark visor. All one vertex-coloured material, so
// the whole rider is one draw (+1 shadow). legs: [thigh, shin] as [x, y, z, rx, len, width]
const MRider = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .1 });
const tint = (g, c) => { const k = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const JACKET = 0x2a3a52, JEAN = 0x2d3d63, HELM = 0x1d2b4f, VISOR = 0x0c0f14, SHOE = 0xe9e6df, GLOVE = 0x18191b;
function rider(ct, torso, head, arms, legs) {
  const r = (g, c, ...p) => mk(tint(g, c), MRider, ct, ...p);
  B.rider = [r(prof([[-.12, -.26], [.12, -.26], [.13, .2], [.04, .27], [-.08, .26], [-.13, .2]], .36, .03), JACKET, 0, torso[0], torso[1], torso[2]),
    r(new THREE.IcosahedronGeometry(.15, 1), HELM, 0, head[0], head[1]), r(box(.2, .085, .05), VISOR, 0, head[0] - .01, head[1] - .13)];
  for (const s of [-1, 1]) {
    const [ax, ay, az, arx, al] = arms, [th, sh] = legs;
    B.rider.push(r(box(.09, .09, al), JACKET, s * ax, ay, az, arx), r(box(.08, .07, .08), GLOVE, s * (ax + .02), ay + Math.sin(arx) * al / 2, az - Math.cos(arx) * al / 2));
    B.rider.push(r(box(th[5], th[5], th[4]), JEAN, s * th[0], th[1], th[2], th[3]), r(box(sh[5], sh[4], sh[5]), JEAN, s * sh[0], sh[1], sh[2], sh[3]));
    B.rider.push(r(box(.1, .07, .17), SHOE, s * sh[0], sh[1] - Math.cos(sh[3]) * sh[4] / 2, sh[2] - Math.sin(sh[3]) * sh[4] / 2 - .04));
  }
}
export const B = { root: new THREE.Group(), lean: new THREE.Group(), body: new THREE.Group(), ct: new THREE.Group(), MP };
B.root.add(B.lean); B.lean.add(B.body); B.body.add(B.ct); B.ct.position.y = -.6; scene.add(B.root);

function clusterPlane(par, x, y, z, rx, w = .25) { const p = mk(new THREE.PlaneGeometry(w, w * 224 / 512), new THREE.MeshBasicMaterial({ map: cluTex }), par, x, y, z, rx); p.castShadow = false; }

/* ---------- sport underbone (Suzuki Raider R150 Fi) ---------- */
// Hyper-underbone: sharp handlebar cowl with twin headlamps, high spine cover ("tank") flowing into angular front
// shrouds over the radiator, stepped seat, upswept tail with LED lamp, skinny 17" tyres on Y-spoke mags.
function sport(ct) {
  B.G = { rw: .29, rearZ: .65, fork: .728, rake: .436, pivotY: .42, pivotZ: .08, swingX: 0 };
  B.rearH = new THREE.Group(); B.rearH.position.set(0, .29, .65); ct.add(B.rearH); B.rearW = wheelG(.25, .042, .2, 5, .022, true, .09); B.rearH.add(B.rearW);
  mk(arc(.305, .33, 1.25, 2.55, .1), MF, B.rearH, 0, 0, 0);                                                // rear hugger
  B.swing = mk(box(.05, .06, 1), MB, ct, 0, .36, .37);
  // engine: crankcase, forward-tilted cylinder with fins, radiator, covers
  mk(prof([[-.05, .52], [.18, .52], [.22, .40], [.17, .23], [-.02, .21], [-.11, .32]], .26, .02), ME, ct, 0, 0, 0);
  mk(prof([[-.25, .50], [-.04, .54], [-.04, .33], [-.23, .36]], .17, .015), MG, ct, 0, 0, 0);
  for (const z of [-.09, -.14, -.19]) mk(box(.2, .19, .012), MG, ct, 0, .44, z);
  mk(box(.25, .19, .04), MB, ct, 0, .47, -.285, .12); mk(box(.21, .15, .01), MC, ct, 0, .47, -.307, .12);  // radiator + chrome grille
  mk(cyl(.085, .085, .03, 10), MC, ct, .14, .36, .06, 0, 0, PI / 2); mk(prof([[-.02, .4], [.16, .42], [.18, .3], [.02, .28]], .02, .005), MC, ct, -.14, 0, 0);
  // bodywork: spine cover / "tank", front shrouds with graphic, frame cover, side panels, seat, tail
  mk(prof([[-.31, .99], [-.12, 1.06, .1, .96], [.13, .89], [.06, .79], [-.10, .77], [-.27, .83]], .25, .025), MP, ct, 0, 0, 0);
  mk(prof([[-.32, .9], [-.13, .85], [-.03, .7], [-.09, .55], [-.25, .52], [-.34, .66]], .32, .02), MP, ct, 0, 0, 0);
  mk(prof([[-.3, .79], [-.12, .75], [-.07, .66], [-.13, .59], [-.27, .6]], .335, .006), MDec, ct, 0, 0, 0);
  mk(prof([[.06, .82], [.34, .84], [.30, .6], [.08, .55]], .2, .01), MG, ct, 0, 0, 0);
  mk(prof([[.1, .93], [.42, .92], [.4, .78], [.14, .72]], .24, .02), MP, ct, 0, 0, 0);
  mk(prof([[.08, .96], [.12, .995], [.36, .985], [.45, 1.04], [.63, 1.06], [.65, 1.02], [.42, .94], [.1, .925]], .24, .025, 2), MS, ct, 0, 0, 0);
  mk(prof([[.38, .95], [.6, 1.01], [.84, 1.07], [.87, 1.035], [.72, .92], [.48, .85], [.38, .86]], .2, .02), MP, ct, 0, 0, 0);
  mk(box(.13, .035, .05), MTail, ct, 0, 1.045, .855, .55); for (const s of [-1, 1]) mk(box(.05, .025, .04), MAmb, ct, s * .1, .96, .84);
  mk(box(.03, .03, .2), MB, ct, 0, .9, .83, -.9); mk(box(.17, .1, .008), MPl, ct, 0, .8, .91, .25);      // plate bracket + plate
  for (const s of [-1, 1]) { mk(box(.09, .02, .035), MB, ct, s * .17, .34, .2); mk(box(.07, .02, .03), MB, ct, s * .14, .43, .48); } // pegs
  const tilt = new THREE.Group(); tilt.position.set(0, .95, -.32); tilt.rotation.x = .436; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.021, .021, .46), MC, st, s * .08, -.18, 0);
  mk(box(.22, .03, .08), MB, st, 0, .04, 0);
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -.728;
  for (const s of [-1, 1]) mk(cyl(.03, .028, .32), MB, B.slider, s * .08, .16, 0);
  B.frontW = wheelG(.25, .04, .2, 5, .022, true); B.slider.add(B.frontW);
  mk(arc(.3, .325, 1.0 + .436, 2.45 + .436, .1), MF, B.slider, 0, 0, 0);                                     // front fender
  mk(box(.045, .06, .09), MB, B.slider, .085, .02, .06);                                                     // caliper
  // headlight cowl: sharp V face with twin lamps, smoked visor, signals
  mk(prof([[-.07, .15], [-.2, .11], [-.31, -.04], [-.26, -.13], [-.11, -.11], [-.04, .02]], .29, .02), MP, st, 0, 0, 0);
  mk(prof([[-.08, .14], [-.2, .105], [-.215, .14], [-.1, .21]], .2, .008), MVis, st, 0, 0, 0);
  for (const s of [-1, 1]) { mk(box(.1, .055, .02), MHead, st, s * .062, .052, -.282, .62, 0, s * .22); mk(box(.04, .03, .06), MAmb, st, s * .16, -.02, -.19); }
  clusterPlane(st, 0, .2, -.08, -.9);
  mk(cyl(.011, .011, .62), MC, st, 0, .16, .07, 0, 0, PI / 2); mk(cyl(.019, .019, .12), MR, st, -.29, .16, .07, 0, 0, PI / 2);
  B.thrG = new THREE.Group(); B.thrG.position.set(.29, .16, .07); st.add(B.thrG); mk(cyl(.02, .02, .12), MR, B.thrG, 0, 0, 0, 0, 0, PI / 2); mk(box(.1, .006, .04), std(0x888888, .5), B.thrG, 0, .02, 0);
  B.brkL = new THREE.Group(); B.brkL.position.set(.2, .165, .04); st.add(B.brkL); mk(box(.15, .014, .022), MC, B.brkL, .08, 0, -.05);
  B.cluL = new THREE.Group(); B.cluL.position.set(-.2, .165, .04); st.add(B.cluL); mk(box(.15, .014, .022), MC, B.cluL, -.08, 0, -.05);
  for (const s of [-1, 1]) { mk(cyl(.006, .006, .22, 5), MB, st, s * .25, .25, 0, 0, 0, -s * .6); mk(cyl(.045, .045, .016, 8), MB, st, s * .34, .31, -.02, PI / 2 - .2); }
  for (const s of [-1, 1]) mk(box(.08, .07, .1), MG, st, s * .255, .17, .075);
  // rider: sporty tuck, feet on the pegs
  rider(ct, [1.12, .3, -.35], [1.48, .14], [.22, 1.18, 0, .6, .45], [[.15, .9, .2, .2, .45, .14], [.18, .58, .02, -.2, .42, .11]]);
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.36, .1); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  // stock: header under the engine into a heat-shielded can; aftermarket: shorter, louder cans
  B.buildExh = (s, cf) => {
    B.exh.clear(); const L = [.46, .4, .34][s], Rr = [.065, .06, .055][s], col = [0x2a2c30, 0x111111, 0x6f7fa8][s], m = cf ? MCF : std(col, .35, .8);
    mk(cyl(.022, .022, .34, 6), MC, B.exh, .1, .2, -.06, PI / 2 + .25); mk(cyl(.024, .024, .3, 6), MC, B.exh, .12, .25, .22, PI / 2 - .35);
    mk(cyl(Rr, Rr * .85, L, 8), m, B.exh, .16, .42, .6, PI / 2 - .3); mk(cyl(Rr * .6, Rr * .6, .04, 8), MC, B.exh, .16, .48, .6 + L / 2 * .96, PI / 2 - .3);
    if (s === 0) mk(box(.02, .08, L * .7), MB, B.exh, .16 + Rr, .43, .58, -.3);
    mergeStatic(B.exh, new Set());
  };
}

/* ---------- step-through scooter (Honda Click 125i) ---------- */
// 14" wheels (100/80-14 rear ≈ 0.258 m radius), 1.28 m wheelbase, ~26.5° rake, unit-swing engine/CVT case on the left.
// Tall front apron with a V of LED headlamps, body-colour handlebar cover with the meter, flat floor, big rear body
// sweeping up to a sharp tail lamp, silver CVT cover, muffler on the right.
function scooter(ct) {
  const rw = .258, rake = .46, headY = .86, fork = (headY - rw) / Math.cos(rake), headZ = -.64 + fork * Math.sin(rake);
  B.G = { rw, rearZ: .64, fork, rake, pivotY: .34, pivotZ: .02, swingX: -.1 };
  B.rearH = new THREE.Group(); B.rearH.position.set(0, rw, .64); ct.add(B.rearH); B.rearW = wheelG(.215, .045, .175, 5, .04, false, .0); B.rearH.add(B.rearW);
  mk(arc(.27, .295, 1.3, 2.5, .1), MF, B.rearH, 0, 0, 0);                                                  // rear hugger
  // unit swing: engine + CVT case pivots with the rear wheel (stretched between pivot and axle each frame)
  B.swing = mk(prof([[-.5, -.07], [-.5, .06], [-.2, .1], [.42, .08], [.5, .02], [.46, -.06], [.2, -.09]], .12, .015), MAlu, ct, -.1, .3, .33);
  mk(prof([[-.12, .2], [.06, .2], [.08, .38], [-.1, .4]], .16, .015), MG, ct, -.02, 0, 0);                 // cylinder + head
  mk(cyl(.016, .016, .32, 6), MC, ct, .12, .5, .52, -.5); mk(cyl(.028, .028, .14, 6), std(0xc22a2a, .5), ct, .12, .52, .5, -.5); // rear shock + red spring
  mk(prof([[-.3, .27], [.1, .27], [.12, .33], [-.3, .33]], .32, .012), MB, ct, 0, 0, 0); mk(box(.29, .012, .4), MS, ct, 0, .335, -.1); // floorboard + mat
  mk(prof([[-.27, .95], [-.2, .92], [-.15, .62], [-.12, .33], [-.21, .33], [-.24, .65]], .38, .015), MB, ct, 0, 0, 0); // inner leg shield
  mk(prof([[-.47, .55], [-.40, .8], [-.36, .96], [-.26, .98], [-.22, .7], [-.17, .36], [-.3, .3], [-.37, .42]], .43, .03), MP, ct, 0, 0, 0); // front apron
  for (const s of [-1, 1]) { mk(box(.13, .032, .02), MHead, ct, s * .08, .76, -.448, .275, 0, s * .38); mk(box(.06, .025, .02), MAmb, ct, s * .17, .88, -.41, .275, 0, s * .2); }
  mk(prof([[-.03, .08], [.03, .08], [0, -.04]], .015, .004), MB, ct, 0, .74, -.45, .275);                   // centre V garnish
  mk(prof([[.04, .34], [.07, .62], [.1, .73], [.7, .79], [.84, .76], [.87, .7], [.78, .6], [.52, .48], [.3, .4], [.14, .33]], .3, .03), MP, ct, 0, 0, 0); // rear body
  mk(prof([[.1, .32], [.3, .38], [.52, .46], [.55, .3], [.12, .27]], .26, .01), MG, ct, 0, 0, 0);            // lower cover
  mk(prof([[.02, .74], [.08, .81], [.32, .835], [.4, .825], [.68, .845], [.75, .8], [.7, .765], [.05, .72]], .29, .025, 2), MS, ct, 0, 0, 0); // seat
  mk(box(.17, .05, .03), MTail, ct, 0, .72, .865, .4); for (const s of [-1, 1]) mk(box(.04, .03, .04), MAmb, ct, s * .12, .7, .84);
  mk(box(.26, .025, .16), MB, ct, 0, .8, .64); for (const s of [-1, 1]) mk(box(.025, .05, .03), MB, ct, s * .12, .78, .57); // grab rail
  mk(box(.03, .03, .16), MB, ct, 0, .56, .83, .6); mk(box(.17, .1, .008), MPl, ct, 0, .5, .9, .2);         // plate bracket + plate
  const tilt = new THREE.Group(); tilt.position.set(0, headY, headZ); tilt.rotation.x = rake; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.02, .02, .42), MC, st, s * .07, -.22, 0);
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -fork;
  for (const s of [-1, 1]) mk(cyl(.028, .026, .28), MB, B.slider, s * .07, .14, 0);
  B.frontW = wheelG(.215, .043, .175, 5, .04, false, .1); B.slider.add(B.frontW);
  mk(arc(.265, .29, 1.0 + rake, 2.4 + rake, .1), MF, B.slider, 0, 0, 0); mk(box(.045, .06, .08), MB, B.slider, .08, .02, .06);
  // handlebar cover (body colour) with the meter on top, dark switch pods
  mk(prof([[-.14, .04], [.11, .04], [.13, .1], [.06, .15], [-.08, .16], [-.15, .1]], .54, .025), MP, st, 0, 0, 0);
  mk(box(.3, .05, .16), MB, st, 0, .03, 0);
  clusterPlane(st, 0, .19, .035, -1.05, .26);
  mk(cyl(.019, .019, .12), MR, st, -.31, .12, .02, 0, 0, PI / 2);
  B.thrG = new THREE.Group(); B.thrG.position.set(.31, .12, .02); st.add(B.thrG); mk(cyl(.02, .02, .12), MR, B.thrG, 0, 0, 0, 0, 0, PI / 2); mk(box(.1, .006, .04), std(0x888888, .5), B.thrG, 0, .02, 0);
  // both levers are brakes (right = front, left = rear/CBS)
  B.brkL = new THREE.Group(); B.brkL.position.set(.23, .125, -.01); st.add(B.brkL); mk(box(.15, .014, .022), MC, B.brkL, .08, 0, -.05);
  B.cluL = new THREE.Group(); B.cluL.position.set(-.23, .125, -.01); st.add(B.cluL); mk(box(.15, .014, .022), MC, B.cluL, -.08, 0, -.05);
  for (const s of [-1, 1]) { mk(cyl(.006, .006, .2, 5), MB, st, s * .22, .22, -.02, 0, 0, -s * .5); mk(cyl(.043, .043, .016, 8), MB, st, s * .29, .31, -.04, PI / 2 - .2); }
  // rider: upright, feet flat on the floorboard
  rider(ct, [1.1, .3, -.1], [1.46, .25], [.25, 1.14, 0, -.58, .66], [[.14, .88, .12, -.05, .42, .14], [.16, .58, -.12, .08, .44, .11]]);
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.38, .2); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  B.buildExh = (s, cf) => {
    B.exh.clear(); const L = [.42, .36, .32][s], Rr = [.07, .062, .056][s], col = [0x2a2c30, 0x111111, 0x6f7fa8][s], m = cf ? MCF : std(col, .35, .8);
    mk(cyl(.022, .022, .4, 6), MC, B.exh, .1, .22, .18, PI / 2 - .15); mk(cyl(Rr, Rr * .85, L, 8), m, B.exh, .15, .34, .52, PI / 2 - .2);
    mk(cyl(Rr * .55, Rr * .55, .04, 8), MC, B.exh, .15, .38, .52 + L / 2 * .98, PI / 2 - .2);
    if (s === 0) mk(box(.02, .09, L * .75), MB, B.exh, .15 + Rr, .35, .5, -.2);
    mergeStatic(B.exh, new Set());
  };
}

// Draw-call diet: meshes that share a parent and a material are baked into one mesh (a bike drew ~50 meshes, each twice
// with its shadow). Animated groups (wheels, steering, fork slider, levers, throttle) keep their own transforms; their
// static children are merged inside them. The swingarm is skipped (it is rescaled every frame).
function mergeList(L, par) {
  const g = mergeGeometries(L.map(o => { o.updateMatrix(); return (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix); }));
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
    if (!keep.has(o)) { const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, g = new THREE.BufferGeometry(); g.setAttribute('position', src.attributes.position.clone()); g.setAttribute('normal', src.attributes.normal.clone()); parts.push(g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); }
  });
  const px = new THREE.Mesh(mergeGeometries(parts), MB); px.castShadow = true; px.layers.set(1); B.ct.add(px);
}
// cfb: body 0 paint / 1 carbon / 2 paint-tinted carbon · cff fenders · cfw wheels · cfx muffler cover
export function applyLook(spec) {
  carbon(MP, !!spec.cfb, spec.c, spec.cfb === 2); carbon(MF, !!spec.cff, spec.c, spec.cfb === 2); carbon(MW, !!spec.cfw, 0x50545b);
  B.buildExh(spec.snd, !!spec.cfx);
}
