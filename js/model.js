// Bike 3D models. Each builder fills the same handles (B.rearH, B.swing, B.steer, B.slider, B.thrG, levers,
// B.rider, B.cam, B.exh) and sets B.G, the geometry the animation in main.js reads.
// Front of the bike is -z; ct coordinates are ground-relative at static sag.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as skelClone } from 'three/addons/utils/SkeletonUtils.js';
import { attribute, uniformArray, texture, uv, vec2, vec3, select, instancedBufferAttribute, smoothstep } from 'three/tsl';
import { PI } from './util.js';
import { scene, std, sun } from './renderer.js';
import * as T from './tex.js';
import { mkTex } from './tex.js';
import { cluTex } from './hud.js';

// MP = painted panels (white in the paint colour + the livery texture), MK = glossy black panels (the real bikes are two-tone)
const MP = std(0xffffff, .3, .2), MK = std(0x15161a, .28, .3), MB = std(0x141518, .6, .2), MR = std(0x0d0d0d, .95), MC = std(0xd5dae0, .22, 1), ME = std(0x2a2c30, .45, .6),
  MS = std(0x1b1b1b, .85), MG = std(0x2b2e33, .8), MRd = std(0x223344, .7), MTail = std(0x330000, .4, 0, 0xff1a1a), MHead = std(0xfff8e0, .2, 0, 0xfff4d0),
  MAmb = std(0x3a2400, .4, 0, 0xff9a1a);
// Carbon fiber: one 2x2 twill canvas texture shared by every carbon part. Fenders (MF) and wheel spokes (MW) have their own
// materials so each garage option can switch just its parts; MCF is plain carbon (fenders, wheels, muffler cover).
const MF = std(0x15161a, .28, .3), MW = std(0x50545b, .4, .6);
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
// switch a material between its stock look and carbon (needsUpdate only when the map changes: that recompiles the shader).
// MP's stock map is the livery (paint colour baked in), so its colour stays white.
function carbon(m, on, col, tint) {
  const want = on ? CF : (m.userData.base || null);
  if (m.map !== want) { if (!!m.map !== !!want) m.needsUpdate = true; m.map = want; }
  if (on) { m.color.set(tint ? col : 0x8a9099); if (tint) m.color.lerp(MCF.color, .25); m.roughness = .22; m.metalness = .1; }
  else { m.color.set(m.userData.base ? 0xffffff : col); m.roughness = m.userData.r; m.metalness = m.userData.mt; }
}
for (const m of [MP, MF, MW, MK]) m.userData = { r: m.roughness, mt: m.metalness };
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
// scale a centred profile's width along z (and optionally y): stops [[z, s], ...] ascending. Fairings narrow to the
// nose and the tail to its tip; ys makes a panel narrower at the bottom or top (a V-shaped nose, a tucked belly pan)
const lerpSt = (st, v) => { if (v <= st[0][0]) return st[0][1]; for (let k = 1; k < st.length; k++) if (v <= st[k][0]) { const [a0, s0] = st[k - 1], [a1, s1] = st[k]; return s0 + (s1 - s0) * (v - a0) / (a1 - a0); } return st[st.length - 1][1]; };
function taper(g, zs, ys) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (zs ? lerpSt(zs, p.getZ(i)) : 1) * (ys ? lerpSt(ys, p.getY(i)) : 1));
  g.computeVertexNormals(); return g;
}
// cylinder from point a to point b ([x, y, z]), for pipes and rails
const UP = new THREE.Vector3(0, 1, 0);
function tube(a, b, r, m, par, seg = 6) {
  const A = new THREE.Vector3(...a), D = new THREE.Vector3(...b).sub(A), L = D.length(), o = mk(cyl(r, r, L, seg), m, par, 0, 0, 0);
  o.position.copy(A).addScaledVector(D, .5); o.quaternion.setFromUnitVectors(UP, D.normalize()); return o;
}
// Steering parts are drawn in bike (ct) coordinates and converted into the tilted steering frame, so profiles can be
// laid out against the side view. T0 = steering-head pivot (z, y), R = rake.
let T0 = [0, 0], RK = 0;
const toSt = (z, y) => { const dz = z - T0[0], dy = y - T0[1], c = Math.cos(RK), s = Math.sin(RK); return [-dy * s + dz * c, dy * c + dz * s]; };
const profSt = (pts, w, b, seg) => prof(pts.map(p => p.length === 4 ? [...toSt(p[0], p[1]), ...toSt(p[2], p[3])] : toSt(p[0], p[1])), w, b, seg);
function mkSt(geo, m, x, z, y, rx = 0, ry = 0, rz = 0) { const [lz, ly] = toSt(z, y); return mk(geo, m, B.steer, x, ly, lz, rx - RK, ry, rz); }
// wheel: chunky low-poly tyre, rim lip, spokes (twin = "Y" pairs), hub, brake disc (petal-ish, 12 sides) on the right
function wheelG(R, t, rim, spokes, sw, twin, disc = .11) {
  const g = new THREE.Group(); mk(new THREE.TorusGeometry(R, t, 6, 20), MR, g, 0, 0, 0, 0, PI / 2); mk(new THREE.TorusGeometry(rim, .013, 4, 20), MW, g, 0, 0, 0, 0, PI / 2);
  for (let i = 0; i < spokes; i++) for (const o of twin ? [-.15, .15] : [0]) mk(box(.02, rim - .03, sw).translate(0, rim / 2 + .03, 0), MW, g, 0, 0, 0, i * 2 * PI / spokes + o);
  mk(cyl(.05, .05, .11, 8), MW, g, 0, 0, 0, 0, 0, PI / 2);
  if (disc) { mk(cyl(disc, disc, .006, 12), MC, g, .058, 0, 0, 0, 0, PI / 2); mk(cyl(disc * .55, disc * .55, .01, 8), MB, g, .058, 0, 0, 0, 0, PI / 2); }
  return g;
}
// sport wheel: fat tyre (torus squashed to width wx), rim with paint pinstripes (MRS), 5 split "Y" spokes, floating discs
// (front: twin 310 mm, rear: 240 mm on the right)
const MRS = std(0x15161a, .4, .3), MGold = std(0xc39a45, .3, .85), MEng = std(0x3e4249, .5, .6), MCov = std(0x60656d, .4, .7);
function wheelS(R, t, wx, rim, front) {
  const g = new THREE.Group(); mk(new THREE.TorusGeometry(R, t, 6, 22).scale(1, 1, wx), MR, g, 0, 0, 0, 0, PI / 2);
  mk(new THREE.TorusGeometry(rim, .014, 4, 22), MW, g, 0, 0, 0, 0, PI / 2);
  for (const x of [-.045, .045]) mk(new THREE.TorusGeometry(rim - .002, .006, 3, 22), MRS, g, x, 0, 0, 0, PI / 2);
  for (let i = 0; i < 5; i++) for (const o of [-.14, .14]) mk(box(.024, rim - .05, .028).translate(0, (rim - .05) / 2 + .045, 0), MW, g, 0, 0, 0, i * 2 * PI / 5 + o);
  mk(cyl(.055, .055, front ? .13 : .15, 8), MW, g, 0, 0, 0, 0, 0, PI / 2);
  const dr = front ? .155 : .12;
  for (const x of front ? [-.075, .075] : [.072]) { mk(cyl(dr, dr, .005, 16), MC, g, x, 0, 0, 0, 0, PI / 2); mk(cyl(dr * .6, dr * .6, .008, 10), MB, g, x, 0, 0, 0, 0, PI / 2); }
  return g;
}
const MVis = std(0x0c0f14, .1, .6), MVisG = std(0x2c3036, .15, .5), MAlu = std(0xb9bec4, .32, .75), MCop = std(0xb8682c, .35, .6),
  MPl = new THREE.MeshStandardMaterial({ map: mkTex(T.plate()), roughness: .5 }),
  MGrl = new THREE.MeshStandardMaterial({ map: mkTex(T.grille(), 18), roughness: .5, metalness: .5 }),
  MRib = new THREE.MeshStandardMaterial({ map: mkTex(T.ribs(), [8, 14]), roughness: .9 });

/* ---------- livery ---------- */
// One small texture per bike holds the paint colour AND the factory graphics (black areas, stripes), drawn in side-view
// metres: painted panels get planar UVs u = z, v = y (setLiveryUV), so a polygon drawn at (z, y) lands on the bike there.
// Seen from the left the graphics are mirrored, so they're shapes, not lettering. Redrawn only when the paint changes.
const LZ0 = -.9, LZ1 = 1.1, LY0 = .1, LY1 = 1.3, LW = 224, LH = 128;
const LIV = (() => { const c = document.createElement('canvas'); c.width = LW; c.height = LH; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / (LZ1 - LZ0), 1 / (LY1 - LY0)); t.offset.set(-LZ0 / (LZ1 - LZ0), -LY0 / (LY1 - LY0)); t.anisotropy = 4; return { c, t, g: c.getContext('2d'), key: '' }; })();
MP.userData.base = LIV.t; MP.map = LIV.t;
function drawLivery(kind, paint, lv = '') {
  const k = kind + paint + lv; if (LIV.key === k) return; LIV.key = k; const g = LIV.g;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = paint; g.fillRect(0, 0, LW, LH);
  g.setTransform(LW / (LZ1 - LZ0), 0, 0, -LH / (LY1 - LY0), -LZ0 * LW / (LZ1 - LZ0), LY1 * LH / (LY1 - LY0)); // draw in (z, y) metres
  const poly = (col, ...p) => { g.fillStyle = col; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); };
  const K = '#15161a';
  if (kind === 'supersport') { // CBR650R: graphics traced from Honda's side photos (R: red Tricolour photo px, Q: black photo px)
    const R = (col, ...p) => poly(col, ...p.map((v, i) => i % 2 ? (333 - v) / 232 : .72 - (v - 132) / 232));
    const Q = (...p) => p.map((v, i) => i % 2 ? (800 - v) / 603 : .72 - (v - 265) / 603);
    const line = (col, w, ...p) => { const q = Q(...p); g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'miter'; g.beginPath(); g.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) g.lineTo(q[i], q[i + 1]); g.stroke(); };
    if (lv === 'tri') { // Grand Prix Red Tricolour: blue over white sweep on the tank, long blue/white flash along the fairing
      const W = '#f1f1ec', Bl = '#1f3d9e';
      R(Bl, 279, 124, 300, 128, 347, 139, 350, 144, 300, 135, 281, 131); R(W, 284, 133, 300, 137, 346, 146, 342, 150, 300, 142, 287, 138);
      R(W, 355, 150, 383, 151, 393, 165, 377, 167, 360, 158);
      R(Bl, 365, 145, 420, 149, 477, 164, 486, 171, 440, 167, 392, 157); R(W, 432, 147, 462, 150, 476, 160, 446, 157);
      R(Bl, 352, 180, 400, 178, 402, 186, 356, 192); R(W, 401, 180, 441, 178, 431, 200, 405, 203);
    } else { // black schemes: one pinstripe along the fairing, the belly pan and the tail (red on Matt Gunpowder, copper on Graphite)
      const c = lv === 'cop' ? '#c8742f' : '#c01c24';
      line(c, .02, 900, 345, 1047, 354, 1080, 378, 866, 462); line(c, .016, 714, 606, 833, 640); line(c, .016, 250, 272, 380, 296, 402, 330);
    }
  } else if (kind === 'sport' && lv === 'gb') { // Raider R150 Fi matte grey/blue (reference photos): grey shroud + belly pan, black tank band,
    // black side panel and tail with grey jagged camo and blue fades, dark "R150" plate on the shroud, black cowl with a blue edge
    const Bl = '#1f48d8', D = '#3d4045', G = '#8d9197';
    poly(K, -.45, .76, .12, .76, .12, 1.2, -.45, 1.2);                                         // tank band above the shroud
    poly(D, .08, .62, -.33, .575, -.36, .555, -.2, .5, .1, .55);                                // dark name plate (forward wedge)
    poly(Bl, .1, .545, -.2, .495, -.12, .46, -.02, .39, .04, .43);                              // blue fade under it
    poly(Bl, -.16, .43, -.3, .52, -.32, .505, -.2, .41);                                         // blue sliver along the wedge
    poly(K, .1, .4, .1, .62, .2, .62, .2, .4);                                                  // seam to the black frame cover
    poly(K, .12, .6, .6, .6, 1.1, .6, 1.1, 1.2, .12, 1.2);                                      // side panel + tail black
    poly(G, .12, .63, .3, .7, .34, .78, .4, .73, .52, .82, .47, .71, .58, .76, .5, .66, .26, .62); // grey jagged camo
    poly(G, .62, .86, .8, .9, .9, .93, .78, .87, .7, .84);                                       // grey slash on the tail
    poly(Bl, .42, .77, .56, .86, .66, .9, .6, .82, .5, .75); poly(Bl, .66, .82, .8, .86, .72, .8); // blue fades
    poly(K, -1, .76, -.45, .76, -.45, 1.3, -1, 1.3);                                             // cowl black
    poly(Bl, -.32, 1.075, -.5, 1.0, -.6, .94, -.62, .925, -.5, .975, -.32, 1.05);               // blue edge stripe on the cowl
  } else if (kind === 'sport') { // Raider R150 Fi: white/paint upper shroud with an orange slash, black lower shroud, black "R150" blocks on the side panel, black tail
    const O = '#e8731e';
    poly(K, -.42, .3, .1, .3, .1, .63, -.06, .62, -.2, .56, -.42, .58);                       // lower shroud + radiator area
    poly(O, -.31, .80, -.12, .80, -.02, .71, -.07, .69, -.18, .75, -.31, .755);               // orange slash
    poly(K, -.27, .78, -.17, .78, -.14, .76, -.25, .76);                                       // emblem bar
    poly(K, .1, .64, .2, .79, .27, .80, .17, .64); poly(K, .22, .64, .32, .81, .39, .82, .29, .65); // R150 blocks
    poly(K, .34, .66, .44, .83, .5, .84, .4, .67);
    poly(O, .05, .655, .46, .725, .47, .74, .05, .67);                                         // orange pinstripe
    poly(K, .54, .5, 1.05, .5, 1.05, 1.2, .58, 1.2);                                           // tail black
    poly(K, -.8, .7, -.52, .84, -.36, .88, -.3, .93, -.3, .7);                                 // cowl lower edge
    poly(O, -.55, .97, -.36, 1.03, -.36, 1.045, -.55, .985);                                   // cowl accent
  } else if (kind === 'tmx') { // TMX Supremo (reference photos): white arrow stripe along the tank with an accent line, black knee panel
    const W = '#f1f1ec', Gy = '#9aa0a8', R = '#d42a2a';
    const ac = lv === 'k' ? R : lv === 'b' ? Gy : K;
    poly(K, -.34, .8, -.1, .8, -.04, .86, -.26, .86);                                               // dark lower tank edge
    poly(W, -.33, .875, -.12, .905, .07, .955, .08, .93, -.1, .875, -.3, .845);                      // arrow stripe
    poly(ac, -.31, .835, -.1, .862, .08, .918, .08, .905, -.1, .85, -.31, .822);                     // accent under it
    poly(W, -.22, .93, -.05, .965, .0, .985, -.2, .945);                                            // upper flash
  } else if (kind === 'underbone') { // Smash 115 / Fi (reference photos): sweeping stripes along the legshield and side covers
    const W = '#f1f1ec', R = '#d42a2a', N = '#1f2a5c', Au = '#c9a24a', G = '#7d828a';
    const sweep = (c, o, t = .022) => { poly(c, -.52, .76 + o, -.3, .86 + o, -.24, .9 + o, -.24, .9 + o + t, -.3, .86 + o + t, -.52, .76 + o + t);   // legshield
      poly(c, .05, .6 + o, .4, .68 + o, .75, .78 + o, .92, .82 + o, .92, .82 + o + t, .75, .78 + o + t, .4, .68 + o + t, .05, .6 + o + t); };     // side cover
    if (lv === 'wb') { poly(N, -.6, .3, -.2, .3, -.2, .6, -.46, .58, -.6, .5); poly(N, -.1, .3, .45, .3, .45, .56, .1, .55, -.1, .5); sweep(R, 0); sweep(N, -.035); }
    else if (lv === 'kr') { poly(G, .1, .58, .5, .66, .8, .74, .55, .62); sweep(R, .02, .016); poly(R, -.52, .62, -.42, .72, -.42, .74, -.52, .645); }
    else if (lv === 'ng') { poly(K, .55, .62, 1.0, .62, 1.0, .9, .75, .8); sweep(Au, 0, .014); sweep(Au, -.03, .014); sweep(Au, -.06, .014); }
    else { poly(K, .05, .3, 1.05, .3, 1.05, .9, .9, .84, .55, .7, .3, .6, .05, .56); poly(K, -.6, 1.04, -.2, 1.04, -.2, 1.2, -.6, 1.2); sweep(W, .03, .016); sweep(W, 0, .016); }
  } else {                // Click 125i (reference photos): white wings and floor skirt, gloss black front face, apron, vent slashes and lower rear
    poly(K, -.8, .5, -.535, .6, -.485, .72, -.42, .865, -.37, .9, -.2, .9, -.2, 1.2, -.8, 1.2); // black front face (thin band at the front edge + the top)
    poly(K, -.8, .36, -.32, .36, -.3, .45, -.38, .55, -.8, .57);                               // lower apron (the floor skirt below stays body colour)
    poly(K, -.40, .62, -.26, .72, -.26, .735, -.40, .64); poly(K, -.38, .665, -.25, .785, -.25, .8, -.38, .68); // wing vent slashes
    poly(K, .0, .36, .32, .36, .36, .3, .9, .3, .9, .6, .52, .5, .14, .47, .0, .5);             // lower rear
    poly(K, .1, .56, .64, .72, .64, .73, .1, .57);                                             // crease line
    poly(K, .82, .3, 1.05, .3, 1.05, 1.2, .86, 1.2);                                           // tail tip
  }
  LIV.t.needsUpdate = true;
}
// planar side UVs (bike metres) on every painted part, wherever it hangs (steering frame included)
function setLiveryUV() {
  B.ct.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(B.ct.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  B.ct.traverse(o => {
    if (!o.isMesh || o.material !== MP) return; m.multiplyMatrices(inv, o.matrixWorld); const p = o.geometry.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); uv[i * 2] = v.z; uv[i * 2 + 1] = v.y; }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  });
}

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

// lift: pushed out along its own facing so the edges clear the cover/cowl it sits in (they used to sink into the body)
function clusterPlane(par, x, y, z, rx, w = .25, lift = .025) { const p = mk(new THREE.PlaneGeometry(w, w * 224 / 512), new THREE.MeshBasicMaterial({ map: cluTex }), par, x, y, z, rx); p.translateZ(lift); p.castShadow = false; }
// handlebar, grips, throttle, levers, mirrors (st-local, shared by both bikes). y/z = bar height/offset, hw = half width
function controls(st, y, z, hw, lv, mir, noClu) {
  tube([-hw + .06, y, z], [hw - .06, y, z], .011, MB, st);
  mk(cyl(.019, .019, .12), MR, st, -hw, y, z, 0, 0, PI / 2);
  B.thrG = new THREE.Group(); B.thrG.position.set(hw, y, z); st.add(B.thrG); mk(cyl(.02, .02, .12), MR, B.thrG, 0, 0, 0, 0, 0, PI / 2); mk(box(.1, .006, .04), std(0x888888, .5), B.thrG, 0, .02, 0);
  B.brkL = new THREE.Group(); B.brkL.position.set(lv, y + .005, z - .03); st.add(B.brkL); mk(box(.15, .014, .022), MC, B.brkL, .08, 0, -.05);
  B.cluL = new THREE.Group(); B.cluL.position.set(-lv, y + .005, z - .03); st.add(B.cluL); if (!noClu) mk(box(.15, .014, .022), MC, B.cluL, -.08, 0, -.05);
  for (const s of [-1, 1]) {
    mk(box(.07, .06, .08), MB, st, s * (lv + .055), y + .01, z);                                                   // switch pods
    if (!mir) continue; const a = [s * (lv - .02), y + .03, z - .01], b = [s * mir[0], y + mir[1], z + mir[2]]; tube(a, b, .006, MB, st, 5);
    mk(prof([[-.05, -.02], [.05, -.03], [.055, .025], [-.045, .035]], .016, .005), MB, st, b[0], b[1] + .02, b[2], -.35, PI / 2 + s * .25, 0); // angular mirror head, facing the rider
  }
}

/* ---------- sport underbone (Suzuki Raider R150 Fi) ---------- */
// Hyper-underbone. Reference: white/black/orange. Sharp handlebar cowl (white wings, black face, LED lamp, smoked
// visor), black spine, big angular shrouds over the radiator, white side panel with black blocks, black upswept tail
// with grab rails and a long plate hanger, silver heat-shielded can, copper 6-spoke mags with petal discs.
function sport(ct) {
  B.G = { rw: .29, rearZ: .65, fork: .728, rake: .436, pivotY: .42, pivotZ: .08, swingX: 0 }; B.wheelCol = 0xb8682c; B.cargo = { y: .9, z: .47 };
  B.rearH = new THREE.Group(); B.rearH.position.set(0, .29, .65); ct.add(B.rearH); B.rearW = wheelG(.25, .04, .212, 5, .02, true, .095); B.rearH.add(B.rearW);
  mk(cyl(.075, .075, .012, 10), MB, B.rearH, -.065, 0, 0, 0, 0, PI / 2);                                       // sprocket
  mk(arc(.305, .33, 1.35, 2.6, .11), MF, B.rearH, 0, 0, 0);                                                   // inner rear fender
  // double-sided box swingarm + chain (one mesh, stretched pivot->axle each frame)
  B.swing = mk(mergeGeometries([box(.03, .065, 1).translate(.1, 0, 0), box(.03, .065, 1).translate(-.1, 0, 0), box(.012, .012, 1).translate(-.065, .045, 0), box(.012, .012, 1).translate(-.065, -.04, 0), box(.2, .04, .05).translate(0, 0, -.46)]), MK, ct, 0, .36, .37);
  // engine: crankcase, forward cylinder with fins, covers
  mk(prof([[-.06, .5], [.16, .5], [.22, .4], [.18, .24], [-.02, .2], [-.12, .3]], .26, .02), ME, ct, 0, 0, 0);
  mk(prof([[-.28, .47], [-.06, .51], [-.06, .32], [-.26, .34]], .18, .015), MG, ct, 0, 0, 0);
  for (const z of [-.1, -.15, -.2]) mk(box(.21, .17, .012), MG, ct, 0, .42, z);
  mk(cyl(.085, .085, .03, 10), MC, ct, .145, .36, .05, 0, 0, PI / 2); mk(prof([[-.04, .42], [.14, .44], [.18, .32], [.02, .28]], .02, .005), MAlu, ct, -.145, 0, 0);
  mk(box(.23, .2, .035), MGrl, ct, 0, .55, -.34, .1);                                                         // radiator front
  mk(prof([[-.37, .58], [-.2, .44], [-.16, .35], [-.38, .36]], .27, .008), MGrl, ct, 0, 0, 0);               // radiator side cover (silver mesh, under the shroud wedge)
  // bodywork
  mk(prof([[-.31, .93], [-.14, .92, .02, .86], [.08, .8], [.05, .72], [-.18, .72], [-.3, .8]], .22, .02), MK, ct, 0, 0, 0); // black spine / "tank"
  mk(prof([[-.31, .88], [-.18, .87], [-.06, .83], [.05, .71], [-.02, .62], [-.06, .45], [-.18, .42], [-.37, .57], [-.34, .68]], .32, .022), MP, ct, 0, 0, 0); // shroud (front edge: forward wedge over the radiator)
  mk(prof([[-.05, .47], [.03, .4], [-.03, .28], [-.16, .15], [-.22, .17], [-.22, .33], [-.17, .42]], .29, .02), MP, ct, 0, 0, 0); // belly pan chin
  mk(prof([[.04, .8], [.36, .82], [.6, .87], [.62, .82], [.42, .7], [.18, .62], [.04, .64]], .24, .02), MP, ct, 0, 0, 0); // side panel
  mk(prof([[.52, .86], [.76, .905], [.9, .935], [.92, .905], [.82, .82], [.6, .78], [.5, .8]], .17, .02), MP, ct, 0, 0, 0); // tail
  mk(prof([[.04, .66], [.34, .7], [.4, .58], [.3, .48], [.08, .48]], .2, .01), MK, ct, 0, 0, 0);            // frame cover
  mk(prof([[.03, .82], [.07, .85], [.34, .845], [.44, .875], [.6, .9], [.64, .885], [.44, .8], [.06, .79]], .25, .025, 2), MS, ct, 0, 0, 0); // seat
  for (const s of [-1, 1]) { tube([s * .1, .88, .5], [s * .1, .915, .76], .014, MK, ct); tube([s * .1, .915, .76], [s * .05, .925, .8], .014, MK, ct); } // grab rails
  mk(box(.12, .03, .035), MTail, ct, 0, .905, .905, .7);                                                       // LED tail lamp
  mk(prof([[.84, .84], [.9, .85], [.97, .66], [.94, .62], [.88, .68]], .08, .01), MK, ct, 0, 0, 0);           // plate hanger
  mk(box(.2, .12, .008), MPl, ct, 0, .59, .975, .35); for (const s of [-1, 1]) mk(box(.05, .028, .045), MAmb, ct, s * .1, .79, .93);
  for (const s of [-1, 1]) { mk(box(.09, .02, .035), MB, ct, s * .17, .33, .18); mk(box(.025, .08, .06), MAlu, ct, s * .13, .37, .2); mk(box(.07, .02, .03), MB, ct, s * .15, .42, .5); } // pegs + hangers
  // steering: fork, cowl, lamps, bars
  T0 = [-.32, .95]; RK = .436;
  const tilt = new THREE.Group(); tilt.position.set(0, .95, -.32); tilt.rotation.x = .436; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.021, .021, .46), MC, st, s * .08, -.18, 0);
  mk(box(.22, .03, .08), MB, st, 0, .04, 0); mk(box(.2, .025, .07), MB, st, 0, -.13, 0);                    // yokes
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -.728;
  for (const s of [-1, 1]) mk(cyl(.031, .028, .34, 8), MAlu, B.slider, s * .08, .17, 0);
  B.frontW = wheelG(.25, .04, .212, 5, .02, true, .13); B.slider.add(B.frontW);
  mk(arc(.3, .325, 1.05 + .436, 2.5 + .436, .1), MF, B.slider, 0, 0, 0);                                      // front fender
  mk(box(.05, .075, .1), MK, B.slider, .088, .03, .07);                                                      // caliper
  mk(profSt([[-.3, 1.1], [-.42, 1.08], [-.56, .98], [-.63, .9], [-.58, .86], [-.46, .88], [-.36, .92], [-.3, .98]], .27, .02), MP, st, 0, 0, 0); // cowl
  mk(profSt([[-.46, 1.03], [-.6, .92], [-.645, .88], [-.6, .855], [-.5, .9]], .14, .012), MK, st, 0, 0, 0);    // black face
  mk(profSt([[-.31, 1.1], [-.43, 1.085], [-.5, 1.04], [-.45, 1.13], [-.33, 1.17]], .2, .008), MVisG, st, 0, 0, 0); // smoked grey visor
  mkSt(box(.14, .1, .02), MC, 0, -.633, .909, .85); mkSt(box(.08, .045, .02), MHead, 0, -.641, .91, .85);         // clear multi-reflector headlamp
  for (const s of [-1, 1]) { mkSt(box(.05, .014, .02), MHead, s * .1, -.53, .99, .85, 0, s * .5); mkSt(box(.03, .03, .07), MAmb, s * .14, -.5, .93); } // position LEDs, signals
  clusterPlane(st, 0, .2, -.08, -.9);
  controls(st, .16, .07, .29, .2, [.3, .17, -.06]);
  rider(ct, [1.12, .3, -.35], [1.48, .14], [.22, 1.18, 0, .6, .45], [[.15, .9, .2, .2, .45, .14], [.18, .58, .02, -.2, .42, .11]]);
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.36, .1); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  // stock: black header under the engine into a big silver heat-shielded can angled up; aftermarket: shorter, louder cans
  B.buildExh = (s, cf) => {
    B.exh.clear(); const L = [.52, .4, .34][s], Rr = [.066, .058, .053][s], col = [0x17181b, 0x111111, 0x6f7fa8][s], m = cf ? MCF : xstd(col, s ? .35 : .55, s ? .8 : .3);
    tube([.04, .33, -.26], [.07, .16, -.1], .022, MB, B.exh); tube([.07, .16, -.1], [.13, .2, .3], .024, MB, B.exh);
    const an = .55, a = [.15, .23, .32], d = [0, Math.sin(an), Math.cos(an)], at = t => a.map((v, i) => v + d[i] * t), b = at(L);
    tube(a, b, Rr, m, B.exh, 8); tube(b, at(L + .06), Rr * .85, s ? MB : MAlu, B.exh, 8);                     // can + end cap
    if (s === 0) { // heat shield: a silver wedge over the lower outside of the can, running down to the header
      const Q = (t, n) => [a[2] + d[2] * t + Math.sin(an) * n, a[1] + d[1] * t - Math.cos(an) * n];
      mk(prof([Q(-.1, .02), Q(.06, .085), Q(.44, .055), Q(.5, 0), Q(.1, -.02)], .016, .004), MAlu, B.exh, .155 + Rr, 0, 0); mk(box(.03, .05, .08), MB, B.exh, .14, .4, .42);
    }
    batchExh();
  };
}

/* ---------- step-through scooter (Honda Click 125i) ---------- */
// 14" wheels (100/80-14 rear ≈ 0.258 m radius), 1.28 m wheelbase, ~26.5° rake, 769 mm seat, unit-swing engine/CVT
// case on the left. Reference: white/black/blue. Sharp front with a black face and swept LED eyes at the nose, white
// wings, black handlebar cover with the meter, black tunnel and floor, big white rear panels over a black lower rear,
// tail lamp under the grab rail, long plate hanger, chunky black muffler, black twin-spoke wheels.
function scooter(ct) {
  const rw = .258, rake = .46, headY = .86, fork = (headY - rw) / Math.cos(rake), headZ = -.64 + fork * Math.sin(rake);
  B.G = { rw, rearZ: .64, fork, rake, pivotY: .34, pivotZ: .02, swingX: -.1 }; B.wheelCol = 0x1c1d21; B.cargo = { y: .78, z: .46 };
  B.rearH = new THREE.Group(); B.rearH.position.set(0, rw, .64); ct.add(B.rearH); B.rearW = wheelG(.215, .045, .175, 5, .022, true, 0); B.rearH.add(B.rearW);
  mk(arc(.27, .295, 1.3, 2.55, .11), MF, B.rearH, 0, 0, 0);                                                  // rear hugger
  // unit swing: engine + CVT case pivots with the rear wheel (stretched between pivot and axle each frame)
  B.swing = mk(prof([[-.5, -.07], [-.5, .06], [-.2, .1], [.42, .08], [.5, .02], [.46, -.06], [.2, -.09]], .12, .015), MG, ct, -.1, .3, .33);
  mk(prof([[-.12, .2], [.06, .2], [.08, .38], [-.1, .4]], .16, .015), MG, ct, -.02, 0, 0);                 // cylinder + head
  mk(box(.02, .15, .17), MGrl, ct, .135, .36, .12, -.35);                                               // chrome finned radiator cover (right)
  tube([.12, .33, .62], [.12, .62, .42], .014, MC, ct); tube([.12, .38, .585], [.12, .56, .46], .03, MB, ct, 8); // rear shock
  // bodywork
  mk(prof([[-.3, .27], [.1, .27], [.12, .33], [-.3, .33]], .32, .012), MK, ct, 0, 0, 0); mk(box(.29, .008, .4), MRib, ct, 0, .335, -.1); // floor + ribbed mat
  mk(prof([[-.4, .31], [-.3, .27], [.24, .27], [.34, .33], [.3, .345], [-.32, .345]], .335, .012), MP, ct, 0, 0, 0); // floor side skirt (body colour, pointed front)
  mk(prof([[-.27, .9], [-.2, .88], [-.15, .62], [-.12, .33], [-.21, .33], [-.24, .65]], .38, .015), MK, ct, 0, 0, 0); // inner leg shield
  mk(box(.03, .04, .03), MC, ct, 0, .62, -.15);                                                               // bag hook
  mk(prof([[-.52, .62], [-.46, .76], [-.4, .88], [-.36, .92], [-.25, .92], [-.21, .7], [-.16, .38], [-.3, .33], [-.36, .45], [-.42, .53], [-.5, .56]], .42, .03), MP, ct, 0, 0, 0); // front body
  mk(prof([[-.585, .58], [-.53, .66], [-.47, .74], [-.44, .7], [-.46, .56], [-.54, .55]], .26, .02), MK, ct, 0, 0, 0); // black nose
  for (const s of [-1, 1]) { mk(box(.12, .034, .022), MHead, ct, s * .07, .62, -.567, .6, 0, s * .42); mk(box(.04, .02, .02), MAmb, ct, s * .12, .67, -.535, .6, 0, s * .3); } // LED eyes, signals
  mk(prof([[-.02, .33], [.14, .33], [.18, .6], [.1, .72], [0, .72], [-.06, .56]], .26, .015), MK, ct, 0, 0, 0); // under-seat tunnel
  mk(prof([[.04, .7], [.4, .74], [.72, .785], [.87, .775], [.9, .72], [.8, .63], [.56, .53], [.34, .5], [.16, .5], [.06, .58]], .3, .03), MP, ct, 0, 0, 0); // rear body
  mk(prof([[.12, .47], [.3, .45], [.52, .51], [.62, .4], [.5, .3], [.18, .3]], .26, .01), MK, ct, 0, 0, 0);  // lower rear cover
  mk(prof([[0, .73], [.05, .765], [.3, .775], [.55, .785], [.74, .8], [.79, .78], [.75, .75], [.02, .71]], .3, .03, 2), MS, ct, 0, 0, 0); // seat
  for (const s of [-1, 1]) tube([s * .13, .77, .58], [s * .12, .8, .8], .016, MK, ct); mk(box(.26, .03, .05), MK, ct, 0, .795, .82); // grab rail
  mk(box(.16, .045, .03), MTail, ct, 0, .72, .888, .5); for (const s of [-1, 1]) mk(box(.04, .03, .04), MAmb, ct, s * .1, .7, .865);
  mk(prof([[.74, .62], [.84, .64], [.96, .4], [.92, .34], [.82, .42]], .11, .012), MK, ct, 0, 0, 0);         // plate hanger
  mk(box(.2, .12, .008), MPl, ct, 0, .38, .958, .35); for (const s of [-1, 1]) mk(box(.05, .028, .045), MAmb, ct, s * .09, .58, .84);
  // steering
  T0 = [headZ, headY]; RK = rake;
  const tilt = new THREE.Group(); tilt.position.set(0, headY, headZ); tilt.rotation.x = rake; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.02, .02, .42), MC, st, s * .07, -.22, 0);
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -fork;
  for (const s of [-1, 1]) mk(cyl(.03, .027, .3, 8), MK, B.slider, s * .07, .15, 0);
  B.frontW = wheelG(.215, .043, .175, 5, .022, true, .1); B.slider.add(B.frontW);
  mk(arc(.265, .29, .95 + rake, 2.65 + rake, .11), MF, B.slider, 0, 0, 0); mk(box(.045, .065, .085), MK, B.slider, .08, .02, .06);
  // handlebar cover (black, pointed front) with the meter on top
  mk(prof([[-.19, .07], [-.1, .035], [.09, .03], [.12, .085], [.05, .13], [-.08, .14], [-.2, .105]], .5, .022), MK, st, 0, 0, 0);
  clusterPlane(st, 0, .172, .03, -1.05, .26);
  controls(st, .12, .02, .31, .23, [.27, .2, -.05]);
  // rider: upright, feet flat on the floorboard
  rider(ct, [1.07, .3, -.1], [1.43, .25], [.25, 1.11, 0, -.58, .66], [[.14, .84, .12, -.05, .42, .14], [.16, .56, -.12, .08, .44, .11]]);
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.38, .2); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  B.buildExh = (s, cf) => {
    B.exh.clear(); const col = [0x1a1b1e, 0x111111, 0x6f7fa8][s], m = cf ? MCF : xstd(col, .45, .5), L = [1, .85, .75][s];
    tube([.05, .2, -.02], [.13, .25, .26], .022, MC, B.exh);
    const P = [[.24, .36], [.24 + .4 * L, .42], [.32 + .42 * L, .4], [.32 + .42 * L, .28], [.32, .22], [.22, .27]];
    mk(prof(P, .1, .015), m, B.exh, .17, 0, 0); mk(cyl(.026, .026, .05, 8), MC, B.exh, .17, .33, .34 + .43 * L, PI / 2);
    if (s === 0) mk(prof([[.3, .37], [.6, .41], [.6, .35], [.3, .3]], .012, .004), MAlu, B.exh, .225, 0, 0); // heat guard
    batchExh();
  };
}

/* ---------- supersport (Honda CBR650R) ---------- */
// Full-fairing inline-four. 1,450 mm wheelbase, 25.5° rake, 120/70-17 front (r ≈ .30) and 180/55-17 rear (r ≈ .315),
// 810 mm seat, 1,150 mm tall. Outlines traced from Honda's side photo (PX: photo px at 2x, axles at x 265 / 1140,
// 603 px per metre). Upper fairing, screen, lamps, mirrors and TFT are frame-mounted (they don't turn with the bars),
// gold Showa SFF-BP upside-down fork, black Y-spoke wheels, four stainless headers into a belly muffler.
const pp = a => a.map(([x, y]) => [.72 - (x - 265) / 603, (800 - y) / 603]);
// belly-pan "word": no real branding, just five chunky pseudo-letters (seeded pixel noise with letter-like stems) on a
// tiny canvas, magnified with nearest filtering so it reads as pixelated N64 gibberish
const DEC = (() => { const c = document.createElement('canvas'); c.width = 36; c.height = 9; const g = c.getContext('2d'); let sd = 0x5eed1e;
  const rnd = () => { sd ^= sd << 13; sd ^= sd >>> 17; sd ^= sd << 5; return (sd >>> 0) / 4294967296; };
  g.fillStyle = '#fff';
  for (let k = 0; k < 5; k++) { const x0 = 1 + k * 7;
    for (let y = 1; y < 8; y++) for (let x = 0; x < 5; x++) { const stem = (x === 0 || x === 4) && rnd() < .8, bar = (y === 1 || y === 4 || y === 7) && rnd() < .55; if (stem || bar || rnd() < .12) g.fillRect(x0 + x, y, 1, 1); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; })();
const MDec = new THREE.MeshStandardMaterial({ map: DEC, alphaTest: .5, roughness: .4 });
function supersport(ct) {
  const rw = .315, rake = .445, headY = .92, fz = -.731, fy = .30, fork = (headY - fy) / Math.cos(rake), headZ = fz + fork * Math.sin(rake);
  B.G = { rw, rearZ: .72, fork, rake, pivotY: .505, pivotZ: .28, swingX: 0 }; B.wheelCol = 0x15161a; B.cargo = { y: .84, z: .6 }; B.fenderPaint = true; B.decal = MDec;
  // rear wheel, sprocket (left), caliper (right), hugger
  B.rearH = new THREE.Group(); B.rearH.position.set(0, rw, .72); ct.add(B.rearH); B.rearW = wheelS(.265, .05, 1.8, .216, false); B.rearH.add(B.rearW);
  mk(cyl(.1, .1, .012, 12), MB, B.rearH, -.085, 0, 0, 0, 0, PI / 2); mk(box(.03, .06, .07), MB, B.rearH, .1, .09, -.08);
  mk(arc(.33, .35, 1.45, 2.45, .16), MK, B.rearH, 0, 0, 0);
  // cast box swingarm + chain on the left (unit length, stretched pivot -> axle each frame)
  B.swing = mk(mergeGeometries([box(.04, .09, 1).translate(.11, 0, 0), box(.04, .09, 1).translate(-.11, 0, 0), box(.22, .07, .07).translate(0, 0, -.42),
    box(.012, .012, 1).translate(-.085, .05, 0), box(.012, .012, 1).translate(-.085, -.045, 0)]), MK, ct, 0, .4, .5);
  // engine: forward-tilted inline-four block, side covers, radiator
  mk(prof(pp([[560, 420], [600, 385], [660, 362], [840, 372], [885, 420], [875, 520], [845, 600], [700, 632], [600, 610], [560, 540]]), .4, .02), MEng, ct, 0, 0, 0);
  mk(prof(pp([[660, 362], [840, 372], [872, 405], [680, 398]]), .36, .015), MCov, ct, 0, .012, 0);         // cam cover
  for (const [x, y, z, r] of [[.21, .45, .02, .085], [.205, .41, -.1, .055], [-.21, .44, .05, .08]]) mk(cyl(r, r, .03, 10), MCov, ct, x, y, z, 0, 0, PI / 2);
  for (const z of [-.06, -.12, -.18]) mk(box(.41, .012, .03), MCov, ct, 0, .56 - z * .55, z, -.5);            // cylinder block ribs
  mk(box(.42, .26, .05), MGrl, ct, 0, .56, -.43, -.25);                                                      // radiator
  // frame spars, under-seat panel, tank, seats, tail
  mk(prof(pp([[900, 280], [955, 320], [900, 370], [660, 470], [575, 505], [530, 470], [600, 420], [820, 320]]), .34, .015), MK, ct, 0, 0, 0);
  mk(prof(pp([[400, 345], [600, 345], [610, 400], [540, 440], [470, 400]]), .26, .01), MK, ct, 0, 0, 0);
  mk(taper(prof(pp([[600, 300], [650, 240], [720, 205], [800, 198], [870, 222], [905, 255], [895, 300], [870, 345], [780, 345], [650, 348], [605, 340]]), .37, .03, 2), [[-.34, 1], [.164, .74]]), MP, ct, 0, 0, 0);
  mk(prof(pp([[870, 222], [930, 240], [960, 270], [940, 300], [895, 300], [905, 255]]), .26, .015), MK, ct, 0, 0, 0); // tank front / airbox cover
  mk(prof(pp([[410, 298], [470, 304], [560, 310], [605, 300], [615, 345], [560, 352], [420, 348]]), .3, .025, 2), MS, ct, 0, 0, 0); // rider seat
  mk(prof(pp([[228, 230], [300, 236], [370, 248], [398, 268], [400, 300], [380, 298], [300, 272], [240, 255]]), .22, .02), MS, ct, 0, 0, 0); // pillion
  mk(taper(prof(pp([[180, 225], [228, 230], [300, 240], [380, 252], [402, 300], [420, 345], [380, 352], [300, 318], [240, 298], [200, 268]]), .25, .02), [[.46, 1], [.86, .45]]), MP, ct, 0, 0, 0);
  mk(box(.11, .035, .05), MTail, ct, 0, .875, .835, .5);                                                       // LED tail lamp
  mk(prof(pp([[270, 302], [200, 315], [130, 325], [70, 340], [60, 358], [130, 352], [220, 335], [280, 330]]), .1, .01), MK, ct, 0, 0, 0); // hugger / plate arm
  mk(prof(pp([[70, 345], [95, 350], [78, 470], [52, 470]]), .06, .008), MK, ct, 0, 0, 0);
  mk(box(.18, .12, .008), MPl, ct, 0, .63, 1.05, .25); for (const s of [-1, 1]) mk(box(.045, .025, .045), MAmb, ct, s * .1, .76, .96);
  // pegs: rider hangers (alu) + passenger hangers
  for (const s of [-1, 1]) {
    mk(prof(pp([[515, 520], [570, 525], [565, 600], [530, 605]]), .02, .005), MAlu, ct, s * .19, 0, 0); mk(box(.09, .02, .03), MB, ct, s * .23, .37, .27);
    mk(prof(pp([[400, 410], [470, 405], [475, 425], [420, 480], [400, 475]]), .02, .005), MAlu, ct, s * .16, 0, 0); mk(box(.07, .02, .03), MB, ct, s * .19, .54, .46);
  }
  // fairing: side band, lower fairing + belly pan, upper cowl, screen (frame-mounted)
  mk(taper(prof(pp([[860, 350], [960, 335], [1100, 335], [1185, 362], [1090, 425], [990, 470], [900, 470], [850, 440]]), .56, .02), [[-.81, .5], [-.5, 1], [-.27, .82]], [[.5, .82], [.75, 1]]), MP, ct, 0, 0, 0);
  mk(taper(prof(pp([[860, 470], [960, 470], [1060, 445], [1012, 500], [998, 580], [992, 738], [880, 742], [760, 712], [705, 690], [700, 612], [790, 600], [860, 560]]), .46, .02), [[-.48, 1], [0, .84]], [[.1, .66], [.55, 1]]), MP, ct, 0, 0, 0);
  mk(taper(prof(pp([[990, 235], [1060, 200], [1120, 225], [1170, 262], [1205, 305], [1215, 335], [1180, 352], [1100, 340], [990, 348], [960, 330]]), .5, .025), [[-.855, .3], [-.78, .62], [-.6, .9], [-.48, 1]], [[.75, 1], [1.0, .72]]), MP, ct, 0, 0, 0);
  mk(taper(prof(pp([[1000, 215], [1030, 165], [1060, 125], [1085, 120], [1095, 150], [1110, 210], [1060, 215]]), .34, .006), [[-.75, .6], [-.5, 1]], [[.95, 1], [1.16, .55]]), MVis, ct, 0, 0, 0);
  for (const s of [-1, 1]) {
    mk(box(.13, .045, .05), MHead, ct, s * .075, .79, -.8, .3, s * .62, s * .32);                              // twin LED headlamps (slanted eyes)
    mk(box(.09, .012, .02), MHead, ct, s * .085, .835, -.76, .3, s * .62, s * .32);                             // position light strips
    mk(box(.03, .02, .05), MAmb, ct, s * .2, .72, -.72);                                                        // front signals
    tube([s * .19, .99, -.64], [s * .27, 1.07, -.63], .007, MB, ct, 5);                                         // mirror stalks + heads
    mk(prof([[-.045, -.02], [.045, -.026], [.05, .022], [-.04, .03]], .018, .005), MB, ct, s * .29, 1.08, -.63, -.25, PI / 2 + s * .25, 0);
  }
  mk(box(.06, .1, .06), MK, ct, 0, .75, -.85, .3);                                                                 // centre intake between the lamps
  // unbranded pixel 'lettering' on the belly pan, both sides (one decal material)
  for (const s of [-1, 1]) mk(new THREE.PlaneGeometry(.36, .068), MDec, ct, s * .213, .18, -.19, 0, s * (PI / 2 - .077), 0);
  // stainless headers live in B.exh (the full system swaps them)
  // steering: gold USD fork, yokes, clip-ons, front wheel and fender
  T0 = [headZ, headY]; RK = rake;
  const tilt = new THREE.Group(); tilt.position.set(0, headY, headZ); tilt.rotation.x = rake; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.029, .029, .44), MGold, st, s * .1, -.2, 0);
  mk(box(.3, .03, .09), MB, st, 0, .015, 0); mk(box(.28, .03, .08), MB, st, 0, -.13, 0);                     // yokes
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -fork;
  for (const s of [-1, 1]) { mk(cyl(.021, .021, .34, 8), MC, B.slider, s * .1, .19, 0); mk(box(.05, .07, .07), MB, B.slider, s * .1, .02, 0); mk(box(.035, .1, .06), MB, B.slider, s * .108, .1, .1); } // inner tubes, axle feet, radial calipers
  B.frontW = wheelS(.25, .05, 1.2, .216, true); B.slider.add(B.frontW);
  mk(arc(.315, .335, 1.35 + rake, 2.45 + rake, .13), MF, B.slider, 0, 0, 0);                                  // front fender (body colour)
  controls(st, -.003, .04, .34, .24, null);
  clusterPlane(ct, 0, .995, -.505, -.55, .2);                                                                   // 5" TFT
  // rider: sporty crouch, hands on the clip-ons, knees on the tank, feet on rear-set pegs
  rider(ct, [1.07, .133, -.7], [1.42, -.1], [.23, 1.075, -.22, -.77, .5], [[.17, .785, .14, -.56, .42, .14], [.19, .53, .132, -.7, .42, .11]]);
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.34, -.08); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  // stock: 4 headers sweep down in front of the engine into a collector and the short silver belly box;
  // slip-on / full system: link pipe to a side can on the right (full system: heat-blued titanium headers)
  B.buildExh = (s, cf) => {
    B.exh.clear(); const hm = s === 2 ? xstd(0x8a7f9a, .3, .85) : MAlu;
    for (const x of [-.12, -.04, .04, .12]) { tube([x, .6, -.31], [x * .9, .3, -.4], .019, hm, B.exh); tube([x * .9, .3, -.4], [x * .5, .17, -.25], .019, hm, B.exh); tube([x * .5, .17, -.25], [.03, .17, -.06], .02, hm, B.exh); }
    if (s === 0) {
      mk(prof(pp([[430, 615], [470, 598], [650, 640], [690, 690], [665, 705], [440, 660]]), .17, .015), cf ? MCF : MAlu, B.exh, .04, 0, 0);
      mk(box(.12, .05, .02), MB, B.exh, .04, .29, .45, .5);
    } else {
      const L = [0, .34, .3][s], Rr = [0, .056, .05][s], m = cf ? MCF : xstd([0, 0x9a9ea4, 0x6f7fa8][s], .3, .85);
      tube([.03, .17, -.06], [.06, .19, .12], .03, hm, B.exh); tube([.06, .19, .12], [.15, .29, .34], .028, hm, B.exh);
      const a = [.15, .29, .34], d = [0, Math.sin(.25), Math.cos(.25)], b = a.map((v, i) => v + d[i] * L);
      tube(a, b, Rr, m, B.exh, 8); tube(b, b.map((v, i) => v + d[i] * .04), Rr * .75, MB, B.exh, 8);
    }
    batchExh();
  };
}

// Draw-call diet (Build 8.2). Every plain-coloured part of the bike (all MeshStandardMaterials without a texture, plus
// the livery-painted panels and carbon parts) is drawn by ONE material, MT: each source material becomes an entry in a
// small uniform palette (colour, roughness, metalness, emissive, texture mode), and every vertex carries its entry's
// index ('pal'). The bike's animated groups (steering, fork slider, wheels, rear hub, swingarm, levers, throttle) become
// the bones of one SkinnedMesh, so the whole bike is a single draw with the parts still moving exactly as before (main.js
// keeps animating the same groups). The source materials stay the garage's handles: carbon()/colour changes edit them
// and syncPal() copies them into the palette (no shader recompiles; switching bikes reuses the same shaders too).
// Leftovers with their own textures (grille, plate, floor mat, decal, cluster) are merged per material per group.
const PN = 48, PA = [], PB = [], PE = [], PAL = new Map();
for (let i = 0; i < PN; i++) { PA.push(new THREE.Vector4(1, 1, 1, .5)); PB.push(new THREE.Vector4()); PE.push(new THREE.Vector4()); }
function writePal(m, i) { const c = m.color, e = m.emissive, k = m.emissiveIntensity; PA[i].set(c.r, c.g, c.b, m.roughness); PB[i].set(m.metalness, m.map === LIV.t ? 1 : m.map === CF ? 2 : 0, 0, 0); PE[i].set(e.r * k, e.g * k, e.b * k, 0); }
function palIdx(m) { let i = PAL.get(m); if (i === undefined) { i = Math.min(PAL.size, PN - 1); PAL.set(m, i); writePal(m, i); } return i; }
function syncPal() { for (const [m, i] of PAL) writePal(m, i); }
const palable = m => m.isMeshStandardMaterial && !m.vertexColors && !m.transparent && !m.alphaTest && (!m.map || m.map === LIV.t || m.map === CF);
// palMat(): the palette material for one set of palette arrays + livery texture. MT is the ridden bike's; remote
// players (snapshot() below) get their own frozen copy (same shader code, so three reuses the compiled program).
function palMat(PA, PB, PE, lt) {
  const uA = uniformArray(PA, 'vec4'), uB = uniformArray(PB, 'vec4'), uE = uniformArray(PE, 'vec4');
  const m = new THREE.MeshStandardNodeMaterial(), i = attribute('pal', 'float').add(.5).toInt(), a = uA.element(i), b = uB.element(i), u = uv();
  const liv = texture(lt, u.mul(vec2(1 / (LZ1 - LZ0), 1 / (LY1 - LY0))).add(vec2(-LZ0 / (LZ1 - LZ0), -LY0 / (LY1 - LY0)))), cf = texture(CF, u.mul(4));
  m.colorNode = a.rgb.mul(select(b.y.greaterThan(1.5), cf.rgb, select(b.y.greaterThan(.5), liv.rgb, vec3(1))));
  m.roughnessNode = a.w; m.metalnessNode = b.x; m.emissiveNode = uE.element(i).rgb; return m;
}
const MT = palMat(PA, PB, PE, LIV.t);
// one mesh's geometry in the frame `rel` (a Matrix4 from its world to the target), with pal (+ bone) attributes
function palGeo(o, rel, bone) {
  const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, g = new THREE.BufferGeometry(), n = src.attributes.position.count;
  g.setAttribute('position', src.attributes.position.clone()); g.setAttribute('normal', src.attributes.normal.clone());
  g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rel, o.matrixWorld));
  g.setAttribute('pal', new THREE.BufferAttribute(new Float32Array(n).fill(palIdx(o.material)), 1));
  if (bone !== undefined) { const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4); for (let k = 0; k < n; k++) { si[k * 4] = bone; sw[k * 4] = 1; } g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }
  return g;
}
// exhaust: rebuilt on garage changes, one plain palette mesh (casts its own shadow)
const XC = new Map(), xstd = (c, r, mt) => { const k = c + '/' + r + '/' + mt; let m = XC.get(k); if (!m) XC.set(k, m = std(c, r, mt)); return m; };
function batchExh() {
  const L = B.exh.children.filter(o => o.isMesh); if (!L.length) return; B.exh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(B.exh.matrixWorld).invert(), m = new THREE.Mesh(mergeGeometries(L.map(o => palGeo(o, inv))), MT);
  m.castShadow = !!B.castSh; for (const o of L) { B.exh.remove(o); o.geometry.dispose(); } B.exh.add(m);
}
function batchBike() {
  // the swingarm mesh is rescaled every frame: its transform moves to an empty group (still B.swing) that becomes a bone
  const sw = new THREE.Group(), sm = B.swing; sw.position.copy(sm.position); sw.quaternion.copy(sm.quaternion); sw.scale.copy(sm.scale); sm.parent.add(sw); sw.add(sm); sm.position.set(0, 0, 0); sm.quaternion.identity(); sm.scale.set(1, 1, 1); B.swing = sw;
  const bones = [B.ct, B.steer, B.slider, B.frontW, B.rearW, B.rearH, sw, B.thrG, B.brkL, B.cluL], bi = new Map(bones.map((b, i) => [b, i]));
  B.root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(B.ct.matrixWorld).invert(), skip = new Set(B.rider), L = [], parts = [];
  B.ct.traverse(o => { if (o === B.exh) return; if (o.isMesh && !skip.has(o) && palable(o.material) && !(o.parent === B.exh)) L.push(o); });
  for (const o of L) { let p = o.parent; while (!bi.has(p)) p = p.parent; parts.push(palGeo(o, inv, bi.get(p))); o.parent.remove(o); o.geometry.dispose(); }
  const m = new THREE.SkinnedMesh(mergeGeometries(parts), MT); m.castShadow = true; m.frustumCulled = false; B.ct.add(m);
  m.bind(new THREE.Skeleton(bones)); B.skin = m;
}
function mergeList(L, par) {
  const g = mergeGeometries(L.map(o => { o.updateMatrix(); return (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix); }));
  const m = new THREE.Mesh(g, L[0].material); m.castShadow = true; par.add(m); for (const o of L) { par.remove(o); o.geometry.dispose(); } return m;
}
function mergeStatic(par, skip) {
  const by = new Map();
  for (const o of [...par.children]) {
    if (o.isGroup) { if (o !== B.exh) mergeStatic(o, skip); continue; }
    if (!o.isMesh || o.isSkinnedMesh || skip.has(o) || o.material.map === cluTex) continue;
    if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(o);
  }
  for (const L of by.values()) if (L.length > 1) mergeList(L, par);
}
/* ---------- step-through underbone (Suzuki Smash 115 / Smash Fi 115) ---------- */
// 17" wheels (80/90-17 rear ≈ 0.285 m radius), 1,240 mm wheelbase, ~26° rake, 750 mm seat, near-horizontal single up
// front. Reference: painted handlebar cover with the headlamp and meter, slim legshield that runs down into the front
// fender line, low black spine (the step-through), long side covers sweeping up to a small tail, silver heat-shielded
// muffler, black chain case. v = trim: 0 spoke wheels + drum/drum, 1 spokes + front disc, 2 five-spoke mags + front disc.
// The "Smash" side script and the front badge are pseudo-letter decals (MDec), not real lettering.
function wheelWire(R, t, rim, drum, disc) {
  const g = new THREE.Group(); mk(new THREE.TorusGeometry(R, t, 6, 20), MR, g, 0, 0, 0, 0, PI / 2); mk(new THREE.TorusGeometry(rim, .012, 4, 20), MW, g, 0, 0, 0, 0, PI / 2);
  for (let i = 0; i < 16; i++) mk(box(.006, rim - .05, .006).translate(0, (rim - .05) / 2 + .045, 0), MC, g, (i & 1 ? .025 : -.025), 0, 0, i * PI / 8 + (i & 1 ? .12 : -.12));
  mk(cyl(drum, drum, .09, 10), MAlu, g, 0, 0, 0, 0, 0, PI / 2);                                            // drum hub
  if (disc) { mk(cyl(disc, disc, .006, 12), MC, g, .05, 0, 0, 0, 0, PI / 2); mk(cyl(disc * .55, disc * .55, .01, 8), MB, g, .05, 0, 0, 0, 0, PI / 2); }
  return g;
}
function underbone(ct, v) {
  const rw = .285, rake = .454, headY = .9, fork = (headY - rw) / Math.cos(rake), headZ = -.62 + fork * Math.sin(rake);
  B.G = { rw, rearZ: .62, fork, rake, pivotY: .37, pivotZ: .06, swingX: 0 }; B.wheelCol = v === 2 ? 0x1c1d21 : 0xc3c8cd; B.cargo = { y: .86, z: .62 };
  B.fenderPaint = true; B.decal = MDec;
  const wheel = front => v === 2 ? wheelG(.25, .035, .215, 5, .034, false, front ? .11 : 0) : wheelWire(.25, .035, .215, front ? .06 : .075, front && v ? .11 : 0);
  B.rearH = new THREE.Group(); B.rearH.position.set(0, rw, .62); ct.add(B.rearH); B.rearW = wheel(false); B.rearH.add(B.rearW);
  if (v === 2) mk(cyl(.075, .075, .08, 10), MAlu, B.rearH, 0, 0, 0, 0, 0, PI / 2);                         // rear drum on the mag
  mk(arc(.305, .33, 1.3, 2.5, .1), MK, B.rearH, 0, 0, 0);                                                   // rear hugger
  // swingarm + enclosed chain case on the left (one mesh, stretched pivot->axle each frame)
  B.swing = mk(mergeGeometries([box(.03, .05, 1).translate(.09, 0, 0), box(.05, .1, 1).translate(-.085, .01, 0), box(.2, .035, .05).translate(0, 0, -.46)]), MK, ct, 0, .33, .34);
  for (const s of [-1, 1]) { tube([s * .09, .33, .6], [s * .09, .72, .46], .012, MC, ct); tube([s * .09, .4, .57], [s * .09, .64, .49], .028, s > 0 ? MC : MB, ct, 8); } // twin shocks
  // engine: near-horizontal cylinder pointing forward, finned, crankcase with the round clutch cover (right), kick lever
  mk(prof([[-.12, .44], [.14, .45], [.2, .34], [.16, .2], [-.02, .17], [-.14, .24]], .24, .02), ME, ct, 0, 0, 0);
  mk(prof([[-.36, .37], [-.1, .43], [-.1, .26], [-.34, .26]], .16, .015), MG, ct, 0, 0, 0);
  for (const z of [-.16, -.21, -.26, -.31]) mk(box(.19, .17, .012), MG, ct, 0, .33, z);
  mk(cyl(.085, .085, .03, 10), MCov, ct, .135, .32, .04, 0, 0, PI / 2); mk(cyl(.06, .06, .02, 8), MAlu, ct, -.13, .33, .02, 0, 0, PI / 2);
  tube([.15, .33, .14], [.17, .45, .3], .012, MC, ct, 5); mk(box(.03, .02, .08), MB, ct, .17, .45, .34);       // kick starter
  for (const s of [-1, 1]) { mk(box(.09, .02, .035), MB, ct, s * .17, .3, .14); mk(box(.025, .07, .05), MAlu, ct, s * .13, .33, .14); } // pegs
  mk(box(.03, .02, .22), MC, ct, -.17, .32, .08, .1);                                                       // heel-toe gear pedal
  // bodywork
  const front = prof([[-.27, .98], [-.4, .95], [-.5, .84], [-.535, .68], [-.5, .52], [-.41, .41], [-.31, .42], [-.25, .56], [-.23, .76], [-.24, .9]], .32, .025);
  mk(taper(front, [[-.54, .62], [-.35, 1]]), MP, ct, 0, 0, 0);                                                  // front legshield cowl
  mk(prof([[-.25, .92], [-.23, .76], [-.25, .56], [-.31, .43], [-.24, .41], [-.18, .56], [-.17, .78], [-.2, .92]], .29, .015), MK, ct, 0, 0, 0); // inner legshield
  mk(prof([[-.24, .82], [-.08, .58], [.1, .53], [.14, .62], [-.03, .67], [-.18, .86]], .15, .015), MK, ct, 0, 0, 0); // low spine cover (the step-through)
  mk(taper(prof([[.0, .6], [.04, .73], [.3, .77], [.6, .8], [.9, .84], [.95, .8], [.84, .69], [.55, .6], [.3, .53], [.08, .5]], .27, .025), [[.5, 1], [.96, .62]]), MP, ct, 0, 0, 0); // side covers
  mk(prof([[.06, .51], [.3, .54], [.44, .47], [.32, .38], [.08, .41]], .22, .01), MK, ct, 0, 0, 0);            // lower frame cover
  mk(prof([[.0, .74], [.04, .78], [.3, .8], [.58, .82], [.8, .85], [.84, .82], [.58, .78], [.02, .72]], .26, .025, 2), MS, ct, 0, 0, 0); // seat
  for (const s of [-1, 1]) tube([s * .12, .79, .62], [s * .1, .84, .86], .014, MC, ct); mk(box(.22, .025, .04), MC, ct, 0, .845, .87); // grab rail
  mk(box(.14, .04, .03), MTail, ct, 0, .8, .945, .6); for (const s of [-1, 1]) mk(box(.04, .03, .04), MAmb, ct, s * .1, .78, .92);
  mk(prof([[.86, .74], [.95, .76], [1, .58], [.96, .53], [.9, .62]], .1, .01), MK, ct, 0, 0, 0);               // plate hanger
  mk(box(.18, .1, .008), MPl, ct, 0, .55, .99, .3);
  for (const s of [-1, 1]) { mk(new THREE.PlaneGeometry(.26, .05), MDec, ct, s * .138, .69, .4, 0, s * PI / 2, 0); mk(box(.04, .03, .04), MAmb, ct, s * .14, .87, -.44); } // side script, front signals
  mk(new THREE.PlaneGeometry(.12, .025), MDec, ct, 0, .78, -.522, .21, PI, 0);                                  // front badge
  // steering: fork, painted handlebar cover with the headlamp and meter
  T0 = [headZ, headY]; RK = rake;
  const tilt = new THREE.Group(); tilt.position.set(0, headY, headZ); tilt.rotation.x = rake; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) mk(cyl(.018, .018, .42), MC, st, s * .07, -.2, 0);
  mk(box(.18, .025, .07), MB, st, 0, -.1, 0);
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -fork;
  for (const s of [-1, 1]) mk(cyl(.027, .025, .3, 8), MAlu, B.slider, s * .07, .15, 0);
  B.frontW = wheel(true); B.slider.add(B.frontW);
  mk(arc(.3, .325, 1.05 + rake, 2.45 + rake, .1), MF, B.slider, 0, 0, 0);                                     // front fender (body colour)
  if (v) mk(box(.045, .07, .09), MK, B.slider, .08, .03, .06);                                                // disc caliper
  mk(profSt([[-.24, 1.05], [-.36, 1.085], [-.5, 1.05], [-.585, .985], [-.57, .945], [-.45, .955], [-.3, .985], [-.23, 1.0]], .3, .022), MP, st, 0, 0, 0); // handlebar cover
  mk(profSt([[-.57, .945], [-.53, .89], [-.42, .885], [-.29, .94], [-.45, .955]], .2, .012), MK, st, 0, 0, 0); // black lower cover
  mk(profSt([[-.42, 1.06], [-.52, 1.035], [-.56, 1.0], [-.5, 1.1], [-.44, 1.12]], .16, .008), MVisG, st, 0, 0, 0); // small visor
  mkSt(box(.16, .07, .02), MC, 0, -.585, .97, .9); mkSt(box(.11, .045, .02), MHead, 0, -.592, .97, .9);          // headlamp
  clusterPlane(st, 0, .19, .0, -1.0, .22);
  controls(st, .16, .06, .3, .2, [.28, .24, -.04], true);
  rider(ct, [1.1, .28, -.12], [1.46, .24], [.24, 1.17, 0, -.59, .5], [[.14, .79, .125, -.38, .38, .14], [.16, .51, .025, -.4, .39, .11]]);
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.34, .15); ct.add(B.cam);
  B.exh = new THREE.Group(); ct.add(B.exh);
  // stock: header from the head down under the engine into a long silver can with a chrome heat guard; aftermarket: shorter, louder
  B.buildExh = (s, cf) => {
    B.exh.clear(); const L = [.48, .38, .32][s], Rr = [.05, .047, .045][s], col = [0x9aa0a8, 0x111111, 0x6f7fa8][s], m = cf ? MCF : xstd(col, s ? .35 : .4, s ? .8 : .6);
    tube([.04, .3, -.34], [.06, .13, -.2], .018, MB, B.exh); tube([.06, .13, -.2], [.145, .17, .16], .02, MB, B.exh);
    const an = .3, a = [.155, .19, .2], d = [0, Math.sin(an), Math.cos(an)], at = t => a.map((v, i) => v + d[i] * t), b = at(L);
    tube(a, b, Rr, m, B.exh, 8); tube(b, at(L + .05), Rr * .8, s ? MB : MC, B.exh, 8);
    if (s === 0) { const Q = (t, n) => [a[2] + d[2] * t + Math.sin(an) * n, a[1] + d[1] * t - Math.cos(an) * n]; mk(prof([Q(-.08, .03), Q(.04, .07), Q(.34, .06), Q(.38, 0), Q(.06, -.02)], .014, .004), MC, B.exh, .158 + Rr, 0, 0); }
    batchExh();
  };
}

/* ---------- utility single (Honda TMX Supremo) + PH tricycle sidecar ---------- */
// 18" spoke wheels (80/100-18, 90/90-18 ≈ 0.31 m radius), 1,306 mm wheelbase, ~27° rake, 782 mm seat. Reference photos:
// painted teardrop tank with an arrow stripe, black side covers, long flat seat, black rear carrier, upright finned single with
// silver cases, long chrome muffler with a heat shield, silver front fender, drum hubs both ends, small black headlamp cowl with a
// chrome-rimmed lamp, amber signals on stalks, round dials. The tank badge is a pseudo-letter decal (MDec).
// v = 1: the tricycle sidecar on the right (the owner's own rig): stainless body on a diamond-plate floor, rounded nose with a
// framed windscreen and black band, red vinyl bench, stainless roof on four posts with a signboard (gibberish letters) and a top
// rail, wire grille on the bike side, spare-wheel cover on the back, stainless fender over its own wheel, chrome bumpers.
const MSS = std(0xd3d7dc, .34, .55), MDia = std(0xb0b4ba, .55, .5), MGls = std(0x5d6a75, .08, .3), MVin = std(0xc81c1c, .45, .05), MSil = std(0xb3b8bf, .35, .75),
  MDecY = new THREE.MeshStandardMaterial({ map: DEC, alphaTest: .5, roughness: .4, color: 0xf2b632 });
function sidecar(ct) {
  const X0 = .5, X1 = 1.44, XC = (X0 + X1) / 2, W = X1 - X0, ZF = -.62, ZB = .56, NR = W / 2;
  mk(box(W, .05, ZB - ZF), MDia, ct, XC, .31, (ZF + ZB) / 2);                                                  // diamond-plate floor
  mk(new THREE.CylinderGeometry(NR, NR, .62, 10, 1, false, PI / 2, PI), MSS, ct, XC, .62, ZF);               // rounded nose
  mk(new THREE.CircleGeometry(NR, 10, PI, PI).rotateX(-PI / 2), MDia, ct, XC, .315, ZF);                       // nose floor
  mk(new THREE.CylinderGeometry(NR + .015, NR + .015, .14, 10, 1, true, PI / 2, PI), MK, ct, XC, .86, ZF);    // black band
  mk(box(.03, .6, ZB - ZF), MSS, ct, X1, .62, (ZF + ZB) / 2);                                                  // outer wall
  mk(box(.03, .4, ZB - ZF), MSS, ct, X0, .52, (ZF + ZB) / 2);                                                  // bike-side wall
  mk(box(W, .74, .03), MSS, ct, XC, .69, ZB);                                                                   // back panel
  mk(cyl(.2, .2, .02, 10), MSil, ct, XC, .74, ZB + .025, PI / 2); mk(cyl(.07, .07, .03, 8), MSS, ct, XC, .74, ZB + .035, PI / 2); // spare-wheel cover
  // windscreen: frame on the nose, smoked glass, posts up to the roof
  mk(box(W - .1, .04, .04), MSS, ct, XC, .95, ZF - .02); mk(box(W - .1, .04, .04), MSS, ct, XC, 1.32, ZF + .06);
  mk(box(W - .14, .36, .01), MGls, ct, XC, 1.135, ZF + .02, -.2);
  for (const x of [X0 + .02, X1 - .02]) { tube([x, .93, ZF - .02], [x, 1.56, ZF + .14], .018, MSS, ct); tube([x, .9, ZB - .02], [x, 1.56, ZB - .02], .018, MSS, ct); }
  // roof, signboard, top rail
  mk(box(W + .12, .04, ZB - ZF + .36), MSS, ct, XC, 1.58, (ZF + ZB) / 2 - .04);
  mk(box(W - .1, .12, .03), MK, ct, XC, 1.5, ZF + .13); mk(new THREE.PlaneGeometry(.66, .08), MDecY, ct, XC, 1.5, ZF + .113, 0, PI, 0);
  for (const x of [X0 + .06, X1 - .06]) { tube([x, 1.6, ZF + .1], [x, 1.68, ZF + .2], .01, MSS, ct); tube([x, 1.68, ZF + .2], [x, 1.68, ZB - .1], .01, MSS, ct); tube([x, 1.68, ZB - .1], [x, 1.6, ZB], .01, MSS, ct); }
  tube([X0 + .06, 1.68, ZB - .1], [X1 - .06, 1.68, ZB - .1], .01, MSS, ct); tube([X0 + .06, 1.68, ZF + .2], [X1 - .06, 1.68, ZF + .2], .01, MSS, ct);
  // wire grille on the bike side (zig-zag stainless rods)
  for (let i = 0; i < 6; i++) { const z0 = ZF + .1 + i * .18; tube([X0, .74, z0], [X0, 1.0, z0 + .09], .006, MSS, ct, 4); tube([X0, 1.0, z0 + .09], [X0, .74, z0 + .18], .006, MSS, ct, 4); }
  tube([X0, 1.0, ZF + .1], [X0, 1.0, ZB - .06], .01, MSS, ct);
  // bench + backrest, red vinyl
  mk(box(W - .08, .1, .36), MVin, ct, XC, .52, ZB - .23); mk(box(W - .08, .4, .08), MVin, ct, XC, .8, ZB - .06, -.12);
  mk(box(W - .08, .16, .3), MSS, ct, XC, .4, ZB - .23);                                                          // bench base
  // its own wheel under a stainless fender (no brake), and the mounts to the bike's frame
  const wx = 1.5, wz = .08, wr = .28; mk(new THREE.TorusGeometry(wr - .04, .04, 6, 18), MR, ct, wx, wr, wz, 0, PI / 2); mk(cyl(.07, .07, .1, 8), MAlu, ct, wx, wr, wz, 0, 0, PI / 2);
  mk(arc(wr + .03, wr + .06, .25, 2.9, .18), MSS, ct, wx, wr, wz);
  tube([X1, .32, wz], [wx, wr, wz], .025, MK, ct);
  for (const [a, b] of [[[.1, .32, -.25], [X0, .3, -.25]], [[.11, .34, .4], [X0, .3, .4]], [[.1, .78, .3], [X0, .9, .3]]]) tube(a, b, .022, MK, ct);
  // chrome bumpers, nose lamps
  for (const y of [.36, .45]) { tube([X0 + .05, y, ZB + .08], [X1 - .05, y, ZB + .08], .02, MC, ct); }
  for (const x of [X0 + .1, X1 - .1]) mk(cyl(.03, .03, .02, 8), MAmb, ct, x, .8, ZF - Math.sqrt(NR * NR - (x - XC) ** 2) - .005, PI / 2);
}
function tmx(ct, v) {
  const rw = .31, rake = .47, headY = 1.0, fZ = -.686, fork = (headY - rw) / Math.cos(rake), headZ = fZ + fork * Math.sin(rake);
  B.G = { rw, rearZ: .62, fork, rake, pivotY: .37, pivotZ: .1, swingX: 0 }; B.wheelCol = 0xc3c8cd; B.cargo = { y: .97, z: .52 }; B.decal = MDec; B.sc = v ? 1 : 0;
  const wheel = front => wheelWire(.27, .04, .23, front ? .078 : .082, 0);
  B.rearH = new THREE.Group(); B.rearH.position.set(0, rw, .62); ct.add(B.rearH); B.rearW = wheel(false); B.rearH.add(B.rearW);
  mk(cyl(.085, .085, .012, 10), MB, B.rearH, -.07, 0, 0, 0, 0, PI / 2);                                       // sprocket
  // swingarm (tubes) + top chain guard on the left (one mesh, stretched pivot->axle each frame)
  B.swing = mk(mergeGeometries([box(.03, .045, 1).translate(.1, 0, 0), box(.03, .045, 1).translate(-.1, 0, 0), box(.05, .02, .9).translate(-.075, .06, .02), box(.22, .035, .05).translate(0, 0, -.46)]), MK, ct, 0, .33, .36);
  for (const s of [-1, 1]) { tube([s * .11, .36, .6], [s * .11, .8, .44], .012, MC, ct); tube([s * .11, .42, .575], [s * .11, .68, .48], .03, MK, ct, 8); } // twin shocks
  // frame: backbone under the tank, downtube in front of the engine, seat rails
  tube([0, .93, headZ + .03], [0, .8, .1], .03, MK, ct); tube([0, .88, headZ + .05], [0, .24, -.2], .028, MK, ct); tube([0, .24, -.2], [0, .22, .12], .025, MK, ct);
  for (const s of [-1, 1]) { tube([s * .08, .8, .1], [s * .08, .8, .7], .015, MK, ct); tube([s * .08, .4, .14], [s * .08, .79, .45], .015, MK, ct); }
  // engine: silver cases, cylinder leaning forward with deep fins, round clutch cover on the right, kick lever
  mk(prof([[-.2, .44], [.12, .46], [.18, .34], [.14, .2], [-.06, .17], [-.2, .24]], .26, .02), MSil, ct, 0, 0, 0);
  mk(prof([[-.2, .44], [-.05, .46], [-.12, .78], [-.28, .76]], .17, .015), MG, ct, 0, 0, 0);
  for (let i = 0; i < 5; i++) mk(box(.23, .016, .2), MG, ct, 0, .52 + i * .055, -.15 - i * .016, .25);
  mk(prof([[-.27, .78], [-.11, .8], [-.1, .86], [-.27, .84]], .19, .012), MSil, ct, 0, 0, 0);                    // head cover
  mk(cyl(.1, .1, .03, 12), MCov, ct, .14, .33, .0, 0, 0, PI / 2); mk(cyl(.065, .065, .02, 8), MSil, ct, -.14, .34, -.02, 0, 0, PI / 2);
  tube([.16, .33, .14], [.18, .45, .3], .012, MC, ct, 5); mk(box(.03, .02, .08), MB, ct, .18, .45, .34);       // kick starter
  for (const s of [-1, 1]) { mk(box(.1, .022, .035), MR, ct, s * .18, .3, .12); mk(box(.025, .07, .05), MB, ct, s * .13, .33, .12); } // rubber pegs
  mk(box(.03, .02, .2), MC, ct, -.18, .3, .0, .1);                                                             // gear pedal
  tube([-.17, .36, .15], [-.1, .7, .22], .008, MB, ct, 4);                                                      // carb / air box hint
  mk(box(.16, .14, .16), MK, ct, 0, .62, .08);
  // bodywork
  mk(taper(prof([[-.34, .93], [-.24, 1.0], [-.02, .99], [.08, .93], [.07, .82], [-.1, .79], [-.34, .8]], .3, .03), [[-.36, .78], [-.15, 1], [.1, .86]]), MP, ct, 0, 0, 0); // teardrop tank
  for (const s of [-1, 1]) mk(new THREE.PlaneGeometry(.17, .045), MDec, ct, s * .152, .89, -.13, 0, s * PI / 2, -.12 * s);      // tank badge
  mk(prof([[.04, .82], [.36, .82], [.42, .74], [.36, .55], [.08, .52], [.02, .66]], .25, .015), MK, ct, 0, 0, 0); // side covers
  mk(prof([[.04, .82], [.1, .875], [.55, .875], [.7, .86], [.69, .815], [.06, .8]], .27, .025, 2), MS, ct, 0, 0, 0); // long flat seat
  mk(arc(.33, .355, .9, 2.5, .13), MK, B.rearH, 0, 0, 0);                                                     // rear fender
  mk(prof([[.62, .8], [.86, .78], [.92, .7], [.86, .66], [.66, .74]], .15, .01), MK, ct, 0, 0, 0);             // tail
  mk(box(.15, .06, .05), MTail, ct, 0, .76, .9, .3); for (const s of [-1, 1]) { tube([s * .1, .74, .86], [s * .2, .74, .88], .007, MB, ct, 4); mk(box(.045, .035, .05), MAmb, ct, s * .22, .74, .88); }
  mk(box(.18, .1, .008), MPl, ct, 0, .6, .96, .25);
  // black carrier rack over the back of the seat
  for (const s of [-1, 1]) { tube([s * .13, .9, .38], [s * .13, .9, .8], .012, MK, ct); tube([s * .13, .9, .4], [s * .1, .8, .35], .012, MK, ct); tube([s * .13, .9, .8], [s * .11, .78, .78], .012, MK, ct); }
  for (const z of [.55, .68, .8]) tube([-.13, .9, z], [.13, .9, z], .01, MK, ct);
  // steering: chrome fork, silver fender, small black cowl with the chrome-rimmed lamp, signals on stalks, round dials
  T0 = [headZ, headY]; RK = rake;
  const tilt = new THREE.Group(); tilt.position.set(0, headY, headZ); tilt.rotation.x = rake; ct.add(tilt);
  const st = B.steer = new THREE.Group(); tilt.add(st);
  for (const s of [-1, 1]) { mk(cyl(.019, .019, .44), MC, st, s * .075, -.22, 0); mk(cyl(.03, .03, .16), MK, st, s * .075, -.06, 0); } // stanchions + upper covers
  mk(box(.2, .03, .07), MB, st, 0, .03, 0); mk(box(.19, .025, .06), MB, st, 0, -.14, 0);                     // yokes
  B.slider = new THREE.Group(); st.add(B.slider); B.slider.position.y = -fork;
  for (const s of [-1, 1]) mk(cyl(.028, .026, .3, 8), MAlu, B.slider, s * .075, .15, 0);
  B.frontW = wheel(true); B.slider.add(B.frontW);
  mk(arc(.33, .352, 1.0 + rake, 2.45 + rake, .1), MSil, B.slider, 0, 0, 0);                                    // silver front fender
  mk(profSt([[headZ - .03, 1.12], [headZ - .2, 1.1], [headZ - .27, 1.0], [headZ - .26, .9], [headZ - .1, .9], [headZ - .03, 1.0]], .22, .02), MK, st, 0, 0, 0); // headlamp cowl
  mk(profSt([[headZ - .04, 1.16], [headZ - .2, 1.15], [headZ - .22, 1.11], [headZ - .04, 1.11]], .16, .01), MK, st, 0, 0, 0); // little top cover
  mkSt(box(.17, .14, .02), MC, 0, headZ - .275, .985, .2); mkSt(box(.14, .11, .02), MHead, 0, headZ - .282, .985, .2); // lamp + chrome rim
  for (const s of [-1, 1]) { tube([s * .08, 0, 0], [s * .17, -.03, -.08], .007, MB, st, 4); mkSt(box(.06, .045, .05), MAmb, s * .2, headZ - .21, .97, 0, s * .3); }
  clusterPlane(st, 0, .19, .02, -1.0, .22);
  controls(st, .17, .06, .36, .22, [.33, .3, -.02]);
  rider(ct, [1.17, .27, -.1], [1.54, .22], [.25, 1.25, -.01, -.45, .47], [[.15, .88, .11, -.35, .36, .14], [.17, .575, .035, -.42, .51, .11]]);
  B.cam = new THREE.Group(); B.cam.position.set(0, 1.44, .18); ct.add(B.cam);
  if (v) sidecar(ct);
  B.exh = new THREE.Group(); ct.add(B.exh);
  // stock: chrome header round the front of the engine into a long chrome muffler with a heat shield; aftermarket: shorter, louder
  B.buildExh = (s, cf) => {
    B.exh.clear(); const L = [.62, .44, .36][s], Rr = [.05, .048, .045][s], col = [0xd5dae0, 0x111111, 0x6f7fa8][s], m = cf ? MCF : xstd(col, s ? .35 : .22, s ? .8 : 1);
    tube([.05, .55, -.27], [.08, .22, -.24], .02, MC, B.exh); tube([.08, .22, -.24], [.15, .22, .1], .021, MC, B.exh);
    const an = .16, a = [.16, .23, .12], d = [0, Math.sin(an), Math.cos(an)], at = t => a.map((v, i) => v + d[i] * t), b = at(L);
    tube(a, b, Rr, m, B.exh, 8); tube(b, at(L + .05), Rr * .75, s ? MB : MC, B.exh, 8);
    if (s === 0) { const Q = (t, n) => [a[2] + d[2] * t + Math.sin(an) * n, a[1] + d[1] * t - Math.cos(an) * n]; mk(prof([Q(.02, .03), Q(.08, .07), Q(.36, .065), Q(.4, .02), Q(.06, -.01)], .014, .004), MC, B.exh, .163 + Rr, 0, 0); }
    batchExh();
  };
}

const MODELS = { sport, scooter, supersport, underbone, tmx };
export function buildModel(bike, spec) {
  if (B.skin) { B.skin.geometry.dispose(); B.skin.skeleton.dispose(); B.skin = null; }
  B.var = spec?.var | 0;
  B.ct.clear(); B.fenderPaint = false; B.decal = null; B.sc = 0; PAL.clear(); MODELS[bike.model](B.ct, B.var); B.kind = bike.model; setLiveryUV();
  // rider: one mesh per material, still listed in B.rider (camera toggles visibility, crashes move them)
  const rm = new Map(); for (const o of B.rider) { if (!rm.has(o.material)) rm.set(o.material, []); rm.get(o.material).push(o); }
  B.rider = [...rm.values()].map(L => L.length > 1 ? mergeList(L, B.ct) : L[0]);
  batchBike(); mergeStatic(B.ct, new Set(B.rider));
  // shadows: on the island the bike draws a contact blob (below) instead of casting into the sun's shadow map; only the
  // garage studio turns real casting back on (skinned bike, rider, exhaust; the small textured leftovers never cast)
  bikeShadow(!!B.castSh);
  const bb = B.skin.geometry.boundingBox || (B.skin.geometry.computeBoundingBox(), B.skin.geometry.boundingBox), front = bb.min.z + B.G.rw;
  B.G.sh = { zc: (front + B.G.rearZ) / 2, d: Math.max(.8, B.G.rearZ - front), w: Math.min(.8, Math.max(.5, bb.max.x - bb.min.x)) }; bikeBlob(BLOB_ME, B.G);
}
export function bikeShadow(on) {
  B.castSh = on; const keep = new Set([B.skin, ...B.rider]);
  B.ct.traverse(o => { if (o.isMesh) o.castShadow = on && (keep.has(o) || o.parent === B.exh); });
}

/* ---------- contact shadows ---------- */
// Bikes (local + remote) and the thrown rider don't cast into the sun's shadow map: a skinned bike + rider per player was
// the priciest part of the shadow pass, and Low had no bike shadow at all. Instead one InstancedMesh of soft ground blobs,
// one draw call for every bike: an ellipse under the bike with darker cores at the two tyre contacts. Each blob sits on
// the ground under the bike's centre (so it slides out as the bike leans, and follows a crash), spreads as the bike tips
// over, tilts with the slope between the wheels, fades out with height (jumps), and slides a little away from the sun
// (or moon) so it peeks out from under the bike like a real shadow would. Fogged like the ground under it.
// bk per instance: x = strength, y = tyre cores.
const BLOBN = 16, BK = new THREE.InstancedBufferAttribute(new Float32Array(BLOBN * 2), 2), WQ = .5 / 1.6; // quad = 1.6 x the wheel spacing
BK.setUsage(THREE.DynamicDrawUsage);
const blobMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
{
  const k = instancedBufferAttribute(BK), q = uv().sub(.5);
  const body = smoothstep(0, .55, q.mul(2).length().oneMinus());                                            // soft ellipse, flat middle
  const c = smoothstep(0, .7, vec2(q.x.div(.3), q.y.abs().sub(WQ).div(.13)).length().oneMinus());            // tyre contacts
  blobMat.colorNode = vec3(0); blobMat.opacityNode = body.mul(.6).max(c.mul(k.y).mul(.85)).mul(k.x);
}
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2); // bk reaches the shader through the node only: also adding it to the geometry reads as 0 (r186 WebGL)
const BLOB = new THREE.InstancedMesh(blobGeo, blobMat, BLOBN); BLOB.name = 'bikeBlobs'; BLOB.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
BLOB.frustumCulled = false; BLOB.castShadow = BLOB.receiveShadow = false; BLOB.count = 1; BLOB.setMatrixAt(0, new THREE.Matrix4()); scene.add(BLOB); // 1 empty instance: the warm-up compiles it
// entry: b = the object whose frame is the bike's (its point p = the bike's middle, h0 above the ground when upright),
// d = wheel spacing, w = width, spread = widening when tipped over (default 1.4), cores = tyre-contact strength, vis() = draw it now, ground = optional floor height fn
const BL = new Set();
export const blobAdd = e => (BL.add(e), e), blobDel = e => { BL.delete(e); };
// the player's own bike (studio.js sets ground / off while the garage is open)
export const BLOB_ME = blobAdd({ b: B.body, p: new THREE.Vector3(), h0: .45, d: 1.3, w: .7, cores: 1, vis: () => !!B.skin, ground: null, off: false });
blobAdd({ b: B.body, p: new THREE.Vector3(.97, -.15, 0), h0: .45, d: 1.9, w: 1.1, cores: 0, vis: () => !!B.skin && !!B.sc, ground: null, off: false }); // tricycle sidecar
export function bikeBlob(e, G) { const s = G.sh; if (s) { e.p.set(0, -.15, s.zc); e.d = s.d; e.w = s.w; } return e; } // body-local: ct sits .6 below body
const bp = new THREE.Vector3(), bf = new THREE.Vector3(), bu = new THREE.Vector3(), bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), be = new THREE.Euler(0, 0, 0, 'YXZ'), bs = new THREE.Vector3();
const sd = new THREE.Vector3();
export function blobTick(H) {
  // away-from-light offset per metre of height (the bike's middle is ~.5 m up): tan of the light's zenith angle, capped
  sd.subVectors(sun.position, sun.target.position).normalize(); const sh = Math.hypot(sd.x, sd.z), lit = Math.min(1, sun.intensity / 1.2);
  const off = sh > 1e-3 ? Math.min(.6, .5 * sh / Math.max(.3, sd.y)) * lit / sh : 0, ox = -sd.x * off, oz = -sd.z * off;
  let n = 0;
  for (const e of BL) {
    if (n >= BLOBN || e.off || !e.vis()) continue;
    e.b.updateWorldMatrix(true, false); const mw = e.b.matrixWorld;
    bp.copy(e.p).applyMatrix4(mw); bf.set(0, 0, -1).transformDirection(mw); bu.set(0, 1, 0).transformDirection(mw);
    bf.y = 0; if (bf.lengthSq() < .04) { bf.set(bu.x, 0, bu.z); if (bf.lengthSq() < 1e-4) bf.set(0, 0, -1); } bf.normalize(); // nose straight up/down: the up axis lies along the ground
    const gr = e.ground || H, hd = e.d / 2, hf = gr(bp.x + bf.x * hd, bp.z + bf.z * hd), hr = gr(bp.x - bf.x * hd, bp.z - bf.z * hd), gy = (hf + hr) / 2;
    const air = Math.max(0, bp.y - gy - e.h0), fade = 1 - Math.min(1, Math.max(0, (air - .1) / 2.1)), grow = 1 + air * .25, tip = 1 - Math.abs(bu.y), spread = e.spread ?? 1.4;
    if (fade <= 0) continue;
    be.set(Math.atan2(hf - hr, e.d), Math.atan2(-bf.x, -bf.z), 0); bq.setFromEuler(be);
    bs.set(e.w * (1 + tip * spread) * grow, 1, e.d * 1.6 * grow); bm.compose(bp.set(bp.x + ox * fade, gy + .02, bp.z + oz * fade), bq, bs);
    BLOB.setMatrixAt(n, bm); BK.array[n * 2] = .85 * fade; BK.array[n * 2 + 1] = e.cores * (1 - tip); n++;
  }
  if (!n) { BK.array[0] = 0; n = 1; } // keep one (invisible) instance: count 0 would skip the draw and its pipeline
  BLOB.count = n; BLOB.instanceMatrix.needsUpdate = true; BK.needsUpdate = true;
}
// cfb: body 0 paint / 1 carbon / 2 paint-tinted carbon · cff fenders · cfw wheels · cfx muffler cover
export function applyLook(spec) {
  drawLivery(B.kind, '#' + new THREE.Color(spec.c).getHexString(), spec.lv || ''); MP.userData.r = spec.rough ?? .3; // matt paints: rougher
  carbon(MP, !!spec.cfb, spec.c, spec.cfb === 2); carbon(MF, !!spec.cff, B.fenderPaint ? spec.c : 0x15161a); const wc = spec.wc || B.wheelCol; carbon(MW, !!spec.cfw, wc); // wc: paint scheme's own wheel colour
  MRS.color.set(spec.rim || wc); MCov.color.set(spec.ec || 0x60656d); if (B.decal) B.decal.color.set(spec.hd || '#f1f1ec');
  B.buildExh(spec.snd, !!spec.cfx); syncPal();
}

/* ---------- remote players (net.js) ---------- */
// snapshot(): a frozen copy of the bike exactly as it is built and painted right now (main.js builds the remote bike into
// B, snapshots it, then rebuilds the local one). Own palette arrays + livery canvas, so later paint changes don't leak.
// twin(tpl): one more instance of a snapshot (shares geometry and materials). h = the animated handles in the copy.
const HK = ['lean', 'body', 'steer', 'slider', 'frontW', 'rearW', 'rearH', 'swing'];
function pair(a, b, m) { m.set(a, b); for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i], m); }
function handles(src, h0, m) { const h = {}; for (const k of HK) h[k] = m.get(h0[k]); h.rider = h0.rider.map(r => m.get(r)); return h; }
export function snapshot() {
  const cams = []; B.root.traverse(o => { if (o.isCamera) cams.push([o, o.parent]); }); for (const [c, p] of cams) p.remove(c);
  const o = skelClone(B.root), m = new Map(); pair(B.root, o, m); for (const [c, p] of cams) p.add(c);
  const cv = document.createElement('canvas'); cv.width = LW; cv.height = LH; cv.getContext('2d').drawImage(LIV.c, 0, 0);
  const lt = new THREE.CanvasTexture(cv); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 4;
  const mt = palMat(PA.map(v => v.clone()), PB.map(v => v.clone()), PE.map(v => v.clone()), lt), dec = B.decal ? B.decal.clone() : null, drop = [];
  o.traverse(x => { if (!x.isMesh) return; x.castShadow = false; if (x.material === MT) x.material = mt; else if (dec && x.material === B.decal) x.material = dec; else if (x.material.map === cluTex) drop.push(x); });
  for (const x of drop) x.parent.remove(x);
  const h = handles(B.root, B, m); h.rider.forEach(r => r.visible = true);
  return { o, h, G: { ...B.G }, kind: B.kind, dispose() { mt.dispose(); lt.dispose(); if (dec) dec.dispose(); } };
}
export function twin(tpl) { const o = skelClone(tpl.o), m = new Map(); pair(tpl.o, o, m); return { o, h: handles(tpl.o, tpl.h, m) }; }
// the local bike's skinned mesh now belongs to a snapshot: buildModel() must not dispose its geometry
export function releaseSkin() { B.skin = null; }
