// Toyota HiAce Commuter (H200, the 2014-on facelift sold in the Philippines; left-hand drive, sliding door on the right).
// Built after Toyota PH studio shots (white Commuter side / Cargo front and rear), the owner's interior photos, and Wikimedia
// Commons photos of Philippine vans (silver 2023 Commuter front 3/4, KDH202L dashboard). 4,695 x 1,695 x 1,980 mm, 2,570 mm wheelbase,
// 195R15C on black steel wheels. Vehicle frame: +z forward, +x LEFT, +y up, y = 0 the ground at ride height.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { std } from '../renderer.js';
import { mkTex } from '../tex.js';
import * as T from '../tex.js';
import { shell, warp, arch } from './shell.js';

const W = 1.695, FZ = 1.285, RZ = -1.285, WR = .336, sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// tumblehome above the belt line, the nose and tail pulled in a little in plan
const shape = v => { v.x *= (1 - .05 * sst(1.08, 1.95, v.y)) * (1 - .075 * sst(1.95, 2.3, v.z) ** 2) * (1 - .03 * sst(-2.1, -2.4, v.z)); };
// side silhouette, front first, going over the roof to the tail and back along the floor
const FR = 2.235, RR = -2.46; // nose and tail (overhangs 0.95 / 1.175 m)
const SIL = [
  [FR - .035, .31], [FR, .4], [FR, .72], [FR - .01, .8], [FR - .03, 1.04], [FR - .125, 1.3, 'g'], [1.545, 1.915], [1.4, 1.952], [.9, 1.972], [0, 1.98], [-1.5, 1.972], [-2.2, 1.94], [RR + .1, 1.885],
  [RR + .055, 1.8, 'g'], [RR + .015, 1.24], [RR + .002, .8], [RR, .45], [RR + .03, .33], [-2.1, .31],
  ...arch(RZ, WR - .02, .415, 180, 0), ...arch(FZ, WR - .02, .415, 180, 0),
  [1.95, .31],
];
const BELT = 1.19, WT = 1.845, WINS = [
  [[1.94, BELT], [1.5, WT], [.9, WT], [.9, BELT]],              // front door glass, front edge along the A pillar
  [[.78, BELT], [.78, WT], [-.72, WT], [-.72, BELT]],           // sliding door / second window
  [[-.84, BELT], [-.84, WT], [-2.2, WT], [-2.24, BELT + .03]],  // rear quarter
];
const box = (w, h, d, x, y, z, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); return g.translate(x, y, z); };
const ng = g => g.index ? g.toNonIndexed() : g, strip = g => { g = ng(g); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; };
const join = L => mergeGeometries(L.map(strip));

function wheelGeo() { // 195R15C on a 15 x 6J black steel wheel: tyre lathe + dished disc with 6 round vents + chrome centre cap
  const r = WR, hw = .0975, pts = [[.19, -hw + .02], [.215, -hw], [r - .035, -hw], [r - .008, -hw + .022], [r, -hw + .05], [r, hw - .05], [r - .008, hw - .022], [r - .035, hw], [.215, hw], [.19, hw - .02]].map(p => new THREE.Vector2(p[0], p[1]));
  const tyre = new THREE.LatheGeometry(pts, 28).rotateZ(Math.PI / 2);
  const rim = new THREE.LatheGeometry([[.195, -hw + .01], [.192, -.02], [.17, .035], [.09, .05], [.06, .075], [0, .075]].map(p => new THREE.Vector2(p[0], p[1])), 24).rotateZ(-Math.PI / 2);
  const cap = new THREE.CylinderGeometry(.045, .05, .03, 14).rotateZ(Math.PI / 2).translate(.085, 0, 0);
  const vents = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; vents.push(new THREE.CylinderGeometry(.021, .021, .012, 8).rotateZ(Math.PI / 2).translate(.047, Math.cos(a) * .135, Math.sin(a) * .135)); }
  return { tyre: strip(tyre), rim: strip(rim), cap: strip(cap), vents: join(vents) };
}

// def = data/cars/hiace.json, cluTex = the dash meter's canvas texture (hud.js) -> handles the driving code animates
export function build(def, cluTex) {
  const root = new THREE.Group(), mat = (c, r, m, o = {}) => Object.assign(std(c, r, m), o), add = (g, m, par = root, sh = true) => { const o = new THREE.Mesh(g, m); o.castShadow = sh; par.add(o); return o; };
  const M = {
    paint: mat(def.paint || '#f4f5f3', .34, .15), trim: mat(0x6f7378, .9, 0, { side: THREE.BackSide }), black: mat(0x15171a, .7, 0), dark: mat(0x23262a, .85, 0), rubber: mat(0x101010, .92, 0), steel: mat(0x17181a, .5, .55),
    chrome: mat(0xdfe3e6, .18, .9), seat: mat(0x3b3e44, .95, 0), dash: mat(0x2a2c30, .88, 0), floor: mat(0x2c2e31, .95, 0),
    glass: mat(0x0b1114, .08, .2, { transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false }), screen: mat(0x1a2a30, .05, .2, { transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false }),
    lamp: std(0xf2f4f6, .2, .3, 0xfff1d0), tail: std(0x9a0c0c, .35, .1, 0xff1a10), rev: std(0xe8e8e8, .3, .1, 0xffffff), amber: mat(0xd88a1a, .35, .1),
    plate: new THREE.MeshStandardMaterial({ map: mkTex(T.plate()), roughness: .5 }), clu: new THREE.MeshBasicMaterial({ map: cluTex }),
  };
  M.lamp.emissiveIntensity = M.tail.emissiveIntensity = M.rev.emissiveIntensity = 0;
  // ---- shell: paint outside, trim inside, tinted side / rear glass; the windscreen is its own lighter pane ----
  const S = shell(SIL, { w: W, c: .06, gin: .085, wins: WINS, warp: shape });
  add(S.body, M.paint); add(S.body, M.trim, root, false); const gl = add(S.glass, M.glass, root, false); gl.renderOrder = 2;
  const sw = new THREE.BufferGeometry(), a = SIL[6], b = SIL[7], xs = W / 2 - .06 - .085;
  sw.setAttribute('position', new THREE.Float32BufferAttribute([xs, a[1], a[0] + .004, -xs, a[1], a[0] + .004, -xs, b[1], b[0] + .004, xs, a[1], a[0] + .004, -xs, b[1], b[0] + .004, xs, b[1], b[0] + .004], 3)); sw.computeVertexNormals(); warp(sw, shape);
  add(sw, M.screen, root, false).renderOrder = 3;
  // ---- outside: black bumpers and lower grille, lamps, mirrors, handles, door cuts, sliding-door rail, wipers ----
  const hx = W / 2, blk = [], chr = [], wf = g => warp(ng(g), shape);
  blk.push(wf(box(W - .02, .44, .1, 0, .52, FR - .03)), wf(box(.07, .41, .36, hx - .03, .525, FR - .2)), wf(box(.07, .41, .36, -hx + .03, .525, FR - .2)));   // front bumper + its corners
  blk.push(wf(box(1.0, .05, .03, 0, .845, FR - .012)), wf(box(.9, .1, .03, 0, .6, FR + .022)), wf(box(.16, .14, .03, .62, .46, FR + .022)), wf(box(.16, .14, .03, -.62, .46, FR + .022))); // grille slot, lower intake, fog blanks
  blk.push(wf(box(W - .03, .2, .09, 0, .44, RR + .015)), wf(box(.06, .2, .2, hx - .03, .44, RR + .1)), wf(box(.06, .2, .2, -hx + .03, .44, RR + .1)));       // rear bumper
  for (const s of [1, -1]) {
    blk.push(wf(box(.012, .655, .12, s * (hx + .001), 1.517, .84)), wf(box(.012, .655, .12, s * (hx + .001), 1.517, -.78)));                         // blacked-out B and C pillars: one window band
    blk.push(wf(box(.012, .02, 1.6, s * (hx + .001), .72, 0)), wf(box(.012, 1.3, .012, s * (hx + .001), 1.05, .86)));                                // sill line, front door's rear cut
    blk.push(wf(box(.03, .03, .16, s * (hx + .012), 1.06, 1.0)));                                                                                    // front door handle
    blk.push(box(.2, .05, .06, s * (hx - .02), 1.3, 1.86), box(.05, .27, .17, s * (hx + .11), 1.4, 1.88));                                           // mirror arm + housing
    blk.push(wf(box(.5, .012, .012, s * .36, 1.315, FR - .12, -.75)));                                                                                // wiper
  }
  blk.push(wf(box(.012, .03, 1.85, -(hx + .003), 1.09, -1.5)), wf(box(.03, .03, .16, -(hx + .012), 1.06, .66)), wf(box(.012, 1.3, .012, -(hx + .001), 1.05, -.74)), wf(box(.012, .02, 1.5, -(hx + .001), .47, .05))); // sliding door: rail, handle, rear cut, step
  blk.push(wf(box(.9, .012, .012, 0, .78, RR - .002)), wf(box(.22, .04, .03, 0, .9, RR - .008)));                                                    // tailgate cut, handle
  add(join(blk), M.black);
  chr.push(wf(box(.95, .028, .02, 0, .9, FR - .012)), new THREE.SphereGeometry(.05, 12, 8).scale(1.25, .85, .25).translate(0, 1.1, FR - .05), new THREE.SphereGeometry(.035, 10, 6).scale(1.2, .85, .25).translate(0, 1.02, RR + .008));
  for (const s of [1, -1]) chr.push(box(.012, .21, .13, s * (hx + .1), 1.4, 1.802)); // mirror glass
  add(join(chr), M.chrome);
  const lamps = add(join([1, -1].map(s => wf(new THREE.BoxGeometry(.4, .18, .1).translate(s * .6, .93, FR - .05)))), M.lamp);
  add(join([1, -1].map(s => wf(box(.05, .1, .05, s * (hx - .04), .93, FR - .09)))), M.amber);
  const tails = add(join([1, -1].map(s => wf(box(.09, .62, .04, s * (hx - .075), 1.25, RR + .03)))), M.tail), revs = add(join([1, -1].map(s => wf(box(.09, .1, .045, s * (hx - .075), .99, RR + .02)))), M.rev);
  add(box(.34, .12, .01, 0, .6, RR - .012), M.plate); add(box(.34, .12, .01, 0, .53, FR + .025), M.plate);
  add(join([box(1.2, .14, 3.2, 0, .3, 0), box(.5, .26, .7, 0, .34, 1.25), box(.26, .3, .5, 0, WR, RZ), new THREE.CylinderGeometry(.045, .045, W - .3, 8).rotateZ(Math.PI / 2).translate(0, WR, RZ), new THREE.CylinderGeometry(.035, .035, .5, 8).rotateX(Math.PI / 2).translate(-.5, .3, -2.1)]), M.dark); // chassis, sump, diff + axle, tailpipe
  // ---- cabin: floor, engine box under the front seats, dash with the three-dial meter, wheel, seats in 2 + 3-3-3-4 ----
  const cab = [box(W - .14, .03, 4.3, 0, .6, -.1), box(W - .16, .34, .95, 0, .78, 1.15)];
  add(join(cab), M.floor, root, false);
  const dsh = [box(W - .2, .34, .42, 0, 1.06, 1.86), box(W - .2, .06, .52, 0, 1.25, 1.84), box(.46, .13, .12, .4, 1.3, 1.7), box(.3, .34, .16, 0, .92, 1.66), box(.05, .05, .32, .4, 1.03, 1.58, -.6)];
  dsh.push(new THREE.CylinderGeometry(.012, .012, .2, 6).rotateX(.5).translate(-.02, 1.02, 1.56), new THREE.SphereGeometry(.028, 8, 6).translate(-.02, 1.12, 1.51)); // dash-mounted gear lever
  add(join(dsh), M.dash, root, false);
  add(new THREE.PlaneGeometry(.36, .36 * 150 / 420).rotateY(Math.PI).rotateX(.25).translate(.4, 1.3, 1.638), M.clu, root, false);
  const wheelG = new THREE.Group(); wheelG.position.set(.4, 1.17, 1.44); wheelG.rotation.x = -.95; root.add(wheelG); // the rim's plane leans back: a van's flat wheel
  const sw2 = new THREE.Group(); wheelG.add(sw2);
  add(join([new THREE.TorusGeometry(.19, .017, 8, 24), box(.34, .05, .02, 0, 0, 0), box(.045, .19, .02, 0, -.09, 0), new THREE.CylinderGeometry(.065, .065, .04, 12).rotateX(Math.PI / 2)]), M.dash, sw2, false);
  const seats = [], seat = (x, z, w) => seats.push(box(w, .1, .44, x, .99 - (z < .8 ? .26 : 0), z), box(w, .52, .09, x, 1.29 - (z < .8 ? .26 : 0), z - .24, -.12), box(w * .5, .14, .07, x, 1.62 - (z < .8 ? .26 : 0), z - .29));
  seat(.4, 1.12, .46); seat(-.36, 1.12, .82); for (const z of [.3, -.45, -1.2]) seat(.2, z, 1.1); seat(0, -1.95, 1.4);
  add(join(seats), M.seat, root, false);
  // ---- wheels: one group per wheel (suspension travel, steering); the spinning part inside ----
  const WG = wheelGeo(), wheels = def.axles.flatMap((ax, i) => (ax.track > 0 ? [1, -1] : [0]).map(s => {
    const g = new THREE.Group(), sp = new THREE.Group(); g.position.set(s * ax.track / 2, ax.r, ax.z); g.add(sp); root.add(g);
    const k = ax.r / WR, flip = s < 0 ? Math.PI : 0; sp.scale.setScalar(k); const o = new THREE.Group(); o.rotation.y = flip; sp.add(o);
    add(WG.tyre, M.rubber, o); add(WG.rim, M.steel, o); add(WG.cap, M.chrome, o, false); add(WG.vents, M.rubber, o, false);
    return { g, sp, y0: ax.r };
  }));
  return { root, wheels, steer: sw2, M, lamps, tails, revs, size: [W, 1.98, 4.695] };
}
