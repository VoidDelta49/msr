// Character model system: one body recipe for every person in the game (the rider on the bike, you on foot, a friend's
// walker, NPC pedestrians, an NPC riding pillion) and one for dogs. Chunky low-poly boxes like the original rider: the
// N64 toy look (torso profile, round head, box limbs, white sneakers).
//
// A figure is ONE geometry whose vertices carry ix = (bone A, bone B, colour role, optional part). The vertex shader poses it:
// every vertex turns about its bone's joint (pivot table, X axis = swing forward / back), then about its parent's (a shin about the
// knee, then with the thigh about the hip). Colours come from a per-figure palette of 16 roles (skin, hair, top, sleeves, shoes...),
// optional parts (cap, helmet, backpack, skirt, tie, bag, phone...) are switched by a per-figure bit mask. So a whole crowd, any mix
// of outfits and poses, is ONE draw call (Crowd below): positions, poses and palettes are per-instance attributes; no skinning,
// no bone textures, no per-NPC materials, no shadow-map pass (figures get a contact blob instead, like the bikes).
//
// Pose = 8 angles (radians): armL, armR, thighL, thighR, kneeL, kneeR, head, torso. Positive swings a hanging limb forward
// (toward -z), a knee bends with a negative angle, head < 0 looks down, torso < 0 leans forward. POSES below are the shared library.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, uniformArray, instancedDynamicBufferAttribute, select, float, vec3, vec4, floor, mod, exp2, varying, positionLocal, normalLocal } from 'three/tsl';

const PI = Math.PI;
// Low-poly panels: a side profile [[z, y], ...] (a 4-number entry = quadratic curve: control z,y then end z,y) extruded
// to width w, centred on x = 0, with a one-step chamfer b. Chunky bevelled slabs = the cute N64 toy look. (Also every bike panel, model.js.)
export function prof(pts, w, b = .012, seg = 3) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) p.length === 4 ? s.quadraticCurveTo(p[0], p[1], p[2], p[3]) : s.lineTo(p[0], p[1]);
  const d = Math.max(.002, w - 2 * b), g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: seg });
  return g.rotateY(-PI / 2).translate(d / 2, 0, 0);
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---- the rider's outfit (model.js rider() / pillionGeo() find the recolourable parts by these exact colours) ----
export const JACKET = 0x2a3a52, JEAN = 0x2d3d63, HELM = 0x1d2b4f, VISOR = 0x0c0f14, SHOE = 0xe9e6df, GLOVE = 0x18191b;
export const TORSO_PTS = [[-.12, -.26], [.12, -.26], [.13, .2], [.04, .27], [-.08, .26], [-.13, .2]]; // side profile of the jacket / shirt (z, y)
export const torsoGeo = () => prof(TORSO_PTS, .36, .03);

// colour roles (palette slots) and optional parts (bit k-1 of the mask; a part tagged -k shows only while bit k is OFF): figlook.js
export { ROLE, OPT, optMask } from './figlook.js';
import { ROLE, OPT } from './figlook.js';
// bones; pose slot of bone b is b - 1
export const BONE = { none: 0, armL: 1, armR: 2, thighL: 3, thighR: 4, kneeL: 5, kneeR: 6, head: 7, torso: 8 };
export const DOG = { none: 0, fl: 1, fr: 2, bl: 3, br: 4, head: 5, tail: 6, body: 7 };

// limb sizes: al arm, lt thigh, tw thigh width, ls shin, sw shin width (each bike's rider() sets its own, B.riderDims)
export const DIMS = { al: .52, lt: .42, tw: .14, ls: .43, sw: .11 };
// joint heights for a set of limb sizes (feet at y = 0, facing -z); the same numbers model.js riderStand() always used
export function joints(d = DIMS) {
  const shinTop = .065 + d.ls, hipTop = shinTop - .02 + d.lt, tcy = hipTop - .03 + .26, hy = tcy + .27 + .12, shY = tcy + .2;
  return { shinTop, hipTop, tcy, hy, shY, hipY: hipTop - .04, kneeY: shinTop - .01, waist: hipTop - .02, neck: tcy + .25 };
}
function humanPivots(d) {
  const J = joints(d);
  return [[0, 0, 0], [-.23, J.shY, 0], [.23, J.shY, 0], [-.09, J.hipY, 0], [.09, J.hipY, 0], [-.09, J.kneeY, 0], [.09, J.kneeY, 0], [0, J.neck, 0], [0, J.waist, 0]];
}

// one part: geometry (moved into place) + its bones, role and optional-part tag, as the ix attribute
function part(P, g, role, x, y, z, bA = 0, bB = 0, opt = 0, rx = 0, rz = 0) {
  g = g.index ? g.toNonIndexed() : g; for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
  if (rz) g.rotateZ(rz); if (rx) g.rotateX(rx); g.translate(x, y, z);
  const n = g.attributes.position.count, a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a.set([bA, bB, role, opt], i * 4);
  g.setAttribute('ix', new THREE.BufferAttribute(a, 4)); P.push(g);
}
// The human body, every optional part included (the mask decides what shows). Rider proportions; NPCs are scaled per instance.
export function humanGeo(d = DIMS) {
  const J = joints(d), P = [], R = ROLE, B = BONE, O = OPT, { al, lt, tw, ls, sw } = d, hy = J.hy;
  part(P, torsoGeo(), R.top, 0, J.tcy, 0, B.torso);
  // head: face, eyes and hair hide under a helmet
  part(P, new THREE.IcosahedronGeometry(.13, 1), R.skin, 0, hy, -.01, B.head, B.torso);
  for (const s of [-1, 1]) part(P, box(.035, .035, .02), R.eye, s * .045, hy + .01, -.135, B.head, B.torso, -O.helmet);
  part(P, box(.26, .09, .26), R.hair, 0, hy + .085, .005, B.head, B.torso, -O.helmet); part(P, box(.26, .16, .07), R.hair, 0, hy + .01, .1, B.head, B.torso, -O.helmet);
  part(P, box(.24, .3, .06), R.hair, 0, hy - .12, .125, B.head, B.torso, O.long);
  part(P, new THREE.IcosahedronGeometry(.14, 1).scale(1, .62, 1), R.acc, 0, hy + .065, 0, B.head, B.torso, O.cap); part(P, box(.2, .025, .14), R.acc, 0, hy + .05, -.17, B.head, B.torso, O.cap);
  part(P, new THREE.IcosahedronGeometry(.15, 1), R.acc, 0, hy, -.02, B.head, B.torso, O.helmet); part(P, box(.2, .085, .05), R.dark, 0, hy - .01, -.15, B.head, B.torso, O.helmet);
  // salakot / buri hat (straw, fur2), kapote (rain poncho + hood, pack colour), payong (canopy in the pack colour, held by the right
  // hand: npcfig.js lifts that arm while it is open)
  part(P, new THREE.CylinderGeometry(.03, .31, .13, 10), R.fur2, 0, hy + .16, 0, B.head, B.torso, O.hat);
  part(P, new THREE.CylinderGeometry(.17, .33, .66, 8), R.pack, 0, J.tcy - .08, 0, B.torso, 0, O.coat); part(P, new THREE.IcosahedronGeometry(.155, 1), R.pack, 0, hy + .012, .028, B.head, B.torso, O.coat);
  part(P, box(.016, .95, .016), R.dark, .23, hy - .03, -.4, B.torso, 0, O.umb); part(P, new THREE.CylinderGeometry(.03, .56, .15, 10), R.pack, .14, hy + .42, -.26, B.torso, 0, O.umb);
  // torso extras: backpack (+ straps), school tie, shoulder bag strap
  part(P, box(.27, .32, .12), R.pack, 0, J.tcy + .02, .19, B.torso, 0, O.pack); for (const s of [-1, 1]) part(P, box(.04, .3, .02), R.pack, s * .085, J.tcy + .04, -.135, B.torso, 0, O.pack);
  part(P, box(.05, .26, .02), R.tie, 0, J.tcy + .07, -.137, B.torso, 0, O.tie);
  part(P, box(.035, .58, .02), R.bag, 0, J.tcy + .04, -.137, B.torso, 0, O.bag, 0, .72); part(P, box(.08, .22, .22), R.bag, .21, J.hipTop - .02, .02, B.torso, 0, O.bag);
  part(P, new THREE.CylinderGeometry(.165, .25, .36, 8), R.thigh, 0, J.hipTop - .17, 0, 0, 0, O.skirt);
  for (const s of [-1, 1]) {
    const arm = s < 0 ? B.armL : B.armR, th = s < 0 ? B.thighL : B.thighR, kn = s < 0 ? B.kneeL : B.kneeR;
    part(P, box(.095, al * .42, .095), R.sleeve, s * .23, J.shY - al * .21, 0, arm, B.torso);
    part(P, box(.085, al * .58, .085), R.forearm, s * .23, J.shY - al * .71, 0, arm, B.torso);
    part(P, box(.08, .07, .08), R.hand, s * .23, J.shY - al - .01, 0, arm, B.torso);
    if (s > 0) part(P, box(.02, .1, .055), R.dark, .23, J.shY - al - .03, -.06, arm, B.torso, O.phone);
    part(P, box(tw, lt, tw), R.thigh, s * .09, J.shinTop - .02 + lt / 2, 0, th);
    part(P, box(sw, ls, sw), R.shin, s * .09, .065 + ls / 2, 0, kn, th);
    part(P, box(.1, .07, .17), R.shoe, s * .09, .035, -.04, kn, th);
  }
  const g = mergeGeometries(P); g.computeBoundingSphere(); g.userData = { piv: humanPivots(d), J, d }; return g;
}
// A dog (askal-sized), nose toward -z. Bones: four legs, head, tail, body (pitches up about the hips to sit).
export function dogGeo() {
  const P = [], R = ROLE, D = DOG;
  part(P, box(.2, .2, .52), R.skin, 0, .42, 0, D.body); part(P, box(.205, .1, .2), R.fur2, 0, .48, .08, D.body);
  part(P, box(.17, .17, .19), R.skin, 0, .58, -.33, D.head, D.body); part(P, box(.09, .08, .12), R.fur2, 0, .54, -.47, D.head, D.body);
  part(P, box(.04, .035, .02), R.dark, 0, .57, -.535, D.head, D.body); for (const s of [-1, 1]) { part(P, box(.03, .03, .02), R.dark, s * .045, .62, -.43, D.head, D.body); part(P, box(.05, .08, .03), R.fur2, s * .06, .69, -.3, D.head, D.body, 0, 0, s * .3); }
  part(P, box(.19, .045, .08), R.top, 0, .5, -.24, D.head, D.body);
  for (const [b, x, z] of [[D.fl, -.065, -.2], [D.fr, .065, -.2], [D.bl, -.065, .19], [D.br, .065, .19]]) { part(P, box(.065, .32, .065), R.skin, x, .16, z, b, D.body); part(P, box(.075, .04, .09), R.fur2, x, .02, z - .012, b, D.body); }
  part(P, box(.04, .04, .24), R.skin, 0, .55, .36, D.tail, D.body, 0, .75);
  const g = mergeGeometries(P); g.computeBoundingSphere();
  g.userData = { piv: [[0, 0, 0], [-.065, .34, -.2], [.065, .34, -.2], [-.065, .34, .19], [.065, .34, .19], [0, .5, -.25], [0, .5, .27], [0, .32, .2], [0, 0, 0]] };
  return g;
}

// ---- palettes: 16 colours packed as sRGB 0xRRGGBB integers in floats (exact), decoded in the vertex shader ----
const C1 = new THREE.Color();
export const hexOf = c => typeof c === 'number' ? c : C1.set(c).getHex(THREE.SRGBColorSpace);
export function packPal(cols, out = new Float32Array(16)) { for (let i = 0; i < 16; i++) out[i] = cols[i] === undefined ? 0x202020 : hexOf(cols[i]); return out; }
// the rider's outfit as a palette (you on foot, a friend's walker)
export function riderPal() {
  const p = []; p[ROLE.skin] = '#c08a5e'; p[ROLE.top] = p[ROLE.sleeve] = p[ROLE.forearm] = JACKET; p[ROLE.hand] = GLOVE; p[ROLE.thigh] = p[ROLE.shin] = JEAN;
  p[ROLE.shoe] = SHOE; p[ROLE.acc] = HELM; p[ROLE.dark] = VISOR; p[ROLE.eye] = 0x1d1a18; return packPal(p);
}

// ---- bake: a figure in one fixed pose as a plain vertex-coloured mesh (no custom shader), e.g. model.js riderStand() ----
export function bakeFigure(geo, pal, mask, pose) {
  const piv = geo.userData.piv, ix = geo.attributes.ix, p = geo.attributes.position, nr = geo.attributes.normal, n = p.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), keep = [];
  const rot = (v, b, a) => { const o = piv[b], c = Math.cos(a), s = Math.sin(a), y = v[1] - o[1], z = v[2] - o[2]; v[1] = o[1] + y * c - z * s; v[2] = o[2] + y * s + z * c; };
  const rn = (v, a) => { const c = Math.cos(a), s = Math.sin(a), y = v[1], z = v[2]; v[1] = y * c - z * s; v[2] = y * s + z * c; };
  let k = 0;
  for (let t = 0; t < n; t += 3) { // whole triangles: a hidden part drops out
    const o = ix.getW(t); if (o && ((mask >> (Math.abs(o) - 1)) & 1) !== (o > 0 ? 1 : 0)) continue;
    for (let j = t; j < t + 3; j++) {
      const bA = ix.getX(j), bB = ix.getY(j), aA = bA ? pose[bA - 1] : 0, aB = bB ? pose[bB - 1] : 0, v = [p.getX(j), p.getY(j), p.getZ(j)], w = [nr.getX(j), nr.getY(j), nr.getZ(j)];
      if (bA) { rot(v, bA, aA); rn(w, aA); } if (bB) { rot(v, bB, aB); rn(w, aB); }
      C1.setHex(pal[ix.getZ(j)], THREE.SRGBColorSpace); P.set(v, k * 3); N.set(w, k * 3); C.set([C1.r, C1.g, C1.b], k * 3); k++;
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P.slice(0, k * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(N.slice(0, k * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(C.slice(0, k * 3), 3)); g.computeBoundingSphere(); return g;
}

// ---- the crowd: N figures of one geometry in one draw ----
// Per instance: A0 = x, y, z, yaw (psi: 0 faces -z, like the bike) · A1 = width, height scale, mask, sink (m, a door swallowing them)
// · pose 0..7 · palette 0..15. The mesh itself stays at the origin of its parent (the scene, or a bike body for a passenger).
// setupPosition() replaces three's: position + normal are posed in the shader (instancing done here, so no InstancedMesh).
const FIGMAT = new Map();
function figMaterial(base, piv) {
  class FigMat extends base {
    setupPosition() { positionLocal.assign(this.figPos); normalLocal.assign(this.figNor); return positionLocal; }
  }
  const m = new FigMat({ roughness: .65, metalness: .05 }), U = uniformArray(piv.map(p => new THREE.Vector4(p[0], p[1], p[2], 0)), 'vec4');
  return { m, U };
}
export class Crowd {
  constructor(geo, cap, { name = 'crowd', lite = false } = {}) {
    // all per-instance data in ONE interleaved buffer (32 floats a figure): WebGPU allows only 8 vertex buffers per draw
    this.cap = cap; this.n = 0; this.arr = new Float32Array(cap * 32); this.ib = new THREE.InstancedInterleavedBuffer(this.arr, 32); this.ib.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', geo.attributes.position); g.setAttribute('normal', geo.attributes.normal); g.setAttribute('ix', geo.attributes.ix);
    g.instanceCount = 1; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const { m, U } = figMaterial(lite ? THREE.MeshLambertNodeMaterial : THREE.MeshStandardNodeMaterial, geo.userData.piv);
    const [a0, a1, p0, p1, c0, c1, c2, c3] = [0, 1, 2, 3, 4, 5, 6, 7].map(k => instancedDynamicBufferAttribute(this.ib, 'vec4', 32, k * 4)), ix = attribute('ix', 'vec4'), pos = attribute('position', 'vec3'), nor = attribute('normal', 'vec3');
    const pick4 = (v, k) => select(k.lessThan(.5), v.x, select(k.lessThan(1.5), v.y, select(k.lessThan(2.5), v.z, v.w)));
    const ang = b => select(b.lessThan(.5), float(0), select(b.lessThan(4.5), pick4(p0, b.sub(1)), pick4(p1, b.sub(5))));
    const piv = b => U.element(b.add(.5).toInt()).xyz;
    const rx = (v, a) => { const c = a.cos(), s = a.sin(); return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c))); };
    const bA = ix.x, bB = ix.y, aA = ang(bA), aB = ang(bB);
    let p = rx(pos.sub(piv(bA)), aA).add(piv(bA)); p = rx(p.sub(piv(bB)), aB).add(piv(bB));
    const nn = rx(rx(nor, aA), aB);
    const o = ix.w, bit = floor(a1.z.div(exp2(o.abs().sub(1)))).mod(2), show = select(o.lessThan(-.5), float(1).sub(bit), select(o.greaterThan(.5), bit, float(1)));
    p = p.mul(vec3(a1.x, a1.y, a1.y)).mul(show); p = vec3(p.x, p.y.sub(a1.w), p.z);
    const cy = a0.w.cos(), sy = a0.w.sin(), turn = v => vec3(v.x.mul(cy).add(v.z.mul(sy)), v.y, v.z.mul(cy).sub(v.x.mul(sy)));
    m.figPos = turn(p).add(a0.xyz); m.figNor = turn(nn);
    const r = ix.z, pc = select(r.lessThan(3.5), pick4(c0, r), select(r.lessThan(7.5), pick4(c1, r.sub(4)), select(r.lessThan(11.5), pick4(c2, r.sub(8)), pick4(c3, r.sub(12)))));
    const R = floor(pc.div(65536)), G = mod(floor(pc.div(256)), 256), Bc = mod(pc, 256);
    m.colorNode = vec4(varying(vec3(R, G, Bc).div(255).pow(2.2)), 1);
    this.mesh = new THREE.Mesh(g, m); this.mesh.name = name; this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.geo = geo; this.J = geo.userData.J; this.clear();
  }
  clear() { this.n = 0; }
  // add one figure; pal = packPal() result, pose = 8 angles. Returns false when full.
  push(x, y, z, yaw, sx, sy, mask, pose, pal, sink = 0) {
    if (this.n >= this.cap) return false; const i = this.n++ * 32, A = this.arr;
    A[i] = x; A[i + 1] = y; A[i + 2] = z; A[i + 3] = yaw; A[i + 4] = sx; A[i + 5] = sy; A[i + 6] = mask; A[i + 7] = sink;
    for (let k = 0; k < 8; k++) A[i + 8 + k] = pose[k] || 0;
    for (let k = 0; k < 16; k++) A[i + 16 + k] = pal[k];
    return true;
  }
  // upload; an empty crowd keeps one invisible (zero-scale) figure so its pipeline stays compiled and drawn
  commit() {
    if (!this.n) this.arr.fill(0, 0, 32);
    this.mesh.geometry.instanceCount = Math.max(1, this.n); this.ib.clearUpdateRanges(); this.ib.addUpdateRange(0, Math.max(1, this.n) * 32); this.ib.needsUpdate = true;
  }
}

// ---- pose library (8 angles into `o`); returns the drop (m) that puts the lowest foot back on the ground ----
// t = time (s), k = 0..1 strength / walking speed share, ph = stride phase (rad, one cycle = left + right step)
export const POSES = {
  stand: (o, t) => set(o, .04 * Math.sin(t * 1.3), -.04 * Math.sin(t * 1.3 + 1), 0, 0, 0, 0, .03 * Math.sin(t * .7), 0),
  walk: (o, t, k, ph) => {
    const s = Math.sin(ph), c = Math.cos(ph), a = .5 * k, b = .55 * k;
    return set(o, -b * s, b * s, a * s, -a * s, -k * (.1 + .75 * Math.max(0, c)), -k * (.1 + .75 * Math.max(0, -c)), -.05 * k, -.07 * k);
  },
  run: (o, t, k, ph) => {
    const s = Math.sin(ph), c = Math.cos(ph);
    return set(o, -1.1 * s + .25, 1.1 * s + .25, .85 * s + .1, -.85 * s + .1, -(.35 + 1.2 * Math.max(0, c)), -(.35 + 1.2 * Math.max(0, -c)), .05, -.22);
  },
  phone: (o, t) => set(o, .1 + .03 * Math.sin(t), 1.3 + .05 * Math.sin(t * 1.7), 0, 0, 0, 0, -.26 + .04 * Math.sin(t * .9), -.05),
  hail: (o, t, k) => set(o, .05, 2.75 + .22 * k * Math.sin(t * 9), 0, 0, 0, 0, .12, .02),
  wave: (o, t) => set(o, .05, 2.35 + .4 * Math.sin(t * 11), 0, 0, 0, 0, .05, 0),
  chat: (o, t, k) => set(o, .15 + .25 * Math.max(0, Math.sin(t * 2.3 + k * 9)), .3 + .45 * Math.max(0, Math.sin(t * 1.7 + k * 5)), 0, 0, 0, 0, .08 * Math.sin(t * 2.1 + k * 3), 0),
  squat: (o, t) => set(o, .9, .85 + .05 * Math.sin(t * .8), 1.95, 1.95, -2.55, -2.55, .05 * Math.sin(t * .5), -.35),
  sit: (o, t) => set(o, .55, .5, 1.45, 1.4, -.6, -.75, .04 * Math.sin(t * .6) - .05, -.18), // on the kerb: legs out in front, hands on the knees
  seat: (o, t) => set(o, .35, .3, 1.5, 1.5, -1.5, -1.5, .04 * Math.sin(t * .6), -.05),  // on a seat (a sidecar bench)
  stretch: (o, t) => { const k = .5 + .5 * Math.sin(t * 1.6); return set(o, 2.9 * k, 2.9 * k, 0, 0, 0, 0, .25 * k, .12 * k); },
  sweep: (o, t) => { const s = Math.sin(t * 3.2); return set(o, .7 + .35 * s, .55 + .35 * s, .1, .1, -.2, -.2, -.35, -.3); },
  look: (o, t) => set(o, .04, -.04, 0, 0, 0, 0, .15 + .1 * Math.sin(t * .8), .02),
  flinch: (o, t) => set(o, 2.2, 2.4, .25, -.2, -.5, -.4, -.2, -.25),
  dazed: (o, t) => set(o, -.5, -.45, 1.5, 1.35, -.15, -.35, -.25 + .15 * Math.sin(t * 5), .35),
  pillion: (o, t) => set(o, .95, .95, 1.3, 1.3, -1.45, -1.45, .02 * Math.sin(t * .9), -.08),
  jump: (o, t, k) => set(o, .5 * k, .5 * k, .5 * k, .2 * k, -.9 * k, -.6 * k, 0, -.1 * k),
  // interiors (data/interiors.json people) and you: lining up a shot (k = 1 the stroke), a drink to the lips every few seconds,
  // wiping the bar, a raised glass; stagger = walking drunk (ph = stride phase like walk, k = how drunk)
  cue: (o, t, k) => { const st = Math.max(0, Math.sin(t * 1.4)) * .35 * (k ?? 1); return set(o, 1.35 + st, 1.05 - st * .3, .25, -.1, -.35, -.15, .55, -1.05); },
  drink: (o, t) => { const c = (t * .18) % 1, up = c < .22 ? Math.sin(c / .22 * Math.PI) : 0; return set(o, .1, .55 + 2.15 * up, 0, 0, 0, 0, .05 + .45 * up, .05 * up); },
  bartend: (o, t) => { const s = Math.sin(t * 2.6); return set(o, 1 + .25 * s, .85 - .2 * Math.cos(t * 2.6), 0, 0, 0, 0, -.3, -.28); },
  cheers: (o, t) => set(o, .1, 2.6 + .06 * Math.sin(t * 7), 0, 0, 0, 0, .2, .04),
  stagger: (o, t, k, ph) => {
    const s = Math.sin(ph), c = Math.cos(ph), w = Math.sin(t * 1.7) * .5 + Math.sin(t * 3.3) * .25, a = .45 * k + .1, b = .3 + .5 * k;
    return set(o, -a * s + .45 * w + .2, a * s - .45 * w + .2, b * s + .1, -b * s + .1, -(.15 + .8 * Math.max(0, c)), -(.15 + .8 * Math.max(0, -c)), -.25 + .2 * Math.sin(t * 2.3), -.18 + .14 * w);
  },
  // dogs: fl fr bl br head tail body
  dogWalk: (o, t, k, ph) => { const s = Math.sin(ph) * .55 * k; return set(o, s, -s, -s, s, -.05, .25 * Math.sin(t * 9), 0, 0); },
  dogStand: (o, t) => set(o, 0, 0, 0, 0, .05 * Math.sin(t * .7), .35 * Math.sin(t * 7), 0, 0),
  dogSniff: (o, t) => set(o, .15, .15, 0, 0, -.75 + .06 * Math.sin(t * 13), .3 * Math.sin(t * 6), -.12, 0),
  dogSit: (o, t) => set(o, -.55, -.55, 1.35, 1.35, .25 + .05 * Math.sin(t), .2 * Math.sin(t * 4), .55, 0),
};
function set(o, a, b, c, d, e, f, g, h) { o[0] = a; o[1] = b; o[2] = c; o[3] = d; o[4] = e; o[5] = f; o[6] = g; o[7] = h; return o; }
// how far the body must drop so the lower foot touches the ground again (squatting, sitting): thigh then shin angles
export function footDrop(o, d = DIMS) {
  const f = (t, k) => d.lt * Math.cos(t) + (d.ls + .03) * Math.cos(t + k), stand = d.lt + d.ls + .03;
  return Math.max(0, stand - Math.max(f(o[2], o[4]), f(o[3], o[5])));
}
// dog sit: the hips go down
export const dogDrop = o => o[6] > .2 ? .1 : 0;
// where a figure's hand is (left = -1, right = 1) in its own frame for pose o (leashes)
export function handAt(o, s, d = DIMS, out = [0, 0, 0]) {
  const J = joints(d), a = s < 0 ? o[0] : o[1], L = d.al + .02, y = J.shY - J.waist, t = o[7];
  let hy = y - L * Math.cos(a), hz = -L * Math.sin(a); const c = Math.cos(t), sn = Math.sin(t); // then the torso pitch about the waist
  out[0] = s * .23; out[1] = J.waist + hy * c - hz * sn; out[2] = hy * sn + hz * c; return out;
}
