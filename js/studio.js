// Garage studio: a closed showroom floating high above the island (nothing of the world is visible from inside) with a lit
// pedestal, its own lighting and an orbit camera that eases to a preset per garage tab. The bike's physics keeps running on
// the island (so revving and bouncing are real); only the drawn model is moved onto the pedestal.
import * as THREE from 'three';
import { clamp } from './util.js';
import { S } from './state.js';
import { scene, camera, sun, hemi, head, renderer, ctex, GRADE } from './renderer.js';
import { B, bikeShadow, BLOB_ME } from './model.js';

const O = new THREE.Vector3(0, 900, 0), PED = .3, TAU = Math.PI * 2, WHITE = new THREE.Color(1, 1, 1);
const ST = new THREE.Group(), ACC = new THREE.Color(0x35c8ff), TINT = [], hsl = {};
let ring = null, on = false, pulseV = 0, idle = 0, pd = 0, zf = 1, fitN = 0, freeDirty = true;
const V = { az: .7, el: .25, r: 4, tx: 0, ty: .65, tz: 0 }, T = { ...V, spin: true }, PT = new Map();
let P = { spin: 1, el: .2, r: 3.8, ty: .65, tz: 0 };
// framing: the bike's bounds in its own frame (m, y from the plate) and the screen area the panels leave free (CSS px)
const BOX = new THREE.Box3(), _b = new THREE.Box3(), _m = new THREE.Matrix4(), _i = new THREE.Matrix4(), FREE = { x0: 0, y0: 0, x1: 1, y1: 1 }, FIT = { c: new THREE.Vector3(), R: 1.1, Rs: 1.1, h: 1.1, xz: 1 };
const accMat = (o = 1) => { const m = new THREE.MeshBasicMaterial({ color: ACC, fog: false, transparent: o < 1, opacity: o }); TINT.push(m); return m; };

// built once at load (before the shader warm-up), hidden until the garage opens
export function initStudio() {
  if (ST.children.length) return; ST.visible = false; ST.position.copy(O);
  const add = (geo, mat, y = 0, shadow = false) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.receiveShadow = shadow; m.frustumCulled = false; ST.add(m); return m; };
  // walls: one dome, dark with a faint glow at the horizon; the floor disc hides its lower half
  const wall = ctex(8, 256, (g, w, h) => { const q = g.createLinearGradient(0, h, 0, 0); q.addColorStop(0, '#1d2733'); q.addColorStop(.3, '#0b0f15'); q.addColorStop(1, '#020305'); g.fillStyle = q; g.fillRect(0, 0, w, h); });
  add(new THREE.SphereGeometry(18, 32, 16), new THREE.MeshBasicMaterial({ map: wall, side: THREE.BackSide, fog: false }));
  const floor = ctex(1024, 1024, (g, w, h) => {
    const q = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); q.addColorStop(0, '#2a323c'); q.addColorStop(.25, '#171c23'); q.addColorStop(1, '#06080b'); g.fillStyle = q; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2; for (let r = 90; r < w / 2; r += 56) { g.beginPath(); g.arc(w / 2, h / 2, r, 0, TAU); g.stroke(); }
  });
  add(new THREE.CircleGeometry(18, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floor, roughness: .5, metalness: .25 }), 0, true);
  // pedestal: dark base, turntable plate with degree ticks, glowing rim
  add(new THREE.CylinderGeometry(1.95, 2.05, .16, 64), new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: .35, metalness: .7 }), .08, true);
  const plate = ctex(512, 512, (g, w, h) => {
    g.fillStyle = '#1b2128'; g.fillRect(0, 0, w, h); g.translate(w / 2, h / 2); g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1.5;
    for (const r of [60, 120, 180, 235]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    for (let a = 0; a < 360; a += 5) { const q = a * Math.PI / 180, big = a % 30 === 0, r0 = big ? 222 : 236; g.strokeStyle = big ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.16)'; g.lineWidth = big ? 3 : 1.5; g.beginPath(); g.moveTo(Math.sin(q) * r0, -Math.cos(q) * r0); g.lineTo(Math.sin(q) * 250, -Math.cos(q) * 250); g.stroke(); }
  });
  const side = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: .3, metalness: .8 });
  add(new THREE.CylinderGeometry(1.7, 1.7, .14, 64), [side, new THREE.MeshStandardMaterial({ map: plate, roughness: .45, metalness: .35 }), side], .23, true);
  ring = add(new THREE.TorusGeometry(1.72, .02, 8, 96).rotateX(Math.PI / 2), accMat(), PED - .01);
  add(new THREE.RingGeometry(2.3, 2.35, 96).rotateX(-Math.PI / 2), accMat(.55), .01);
  add(new THREE.RingGeometry(3.7, 3.73, 96).rotateX(-Math.PI / 2), accMat(.22), .01);
  // light strips on the walls
  const strip = new THREE.BoxGeometry(.1, 6.5, .1), sm = accMat(.8);
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, m = add(strip, sm, 3.4); m.position.x = Math.sin(a) * 12.5; m.position.z = Math.cos(a) * 12.5; }
  // faint spotlight cone from the ceiling
  const cone = ctex(2, 64, (g, w, h) => { const q = g.createLinearGradient(0, h, 0, 0); q.addColorStop(0, '#000'); q.addColorStop(1, '#2a2e34'); g.fillStyle = q; g.fillRect(0, 0, w, h); });
  add(new THREE.ConeGeometry(2.6, 8, 40, 1, true), new THREE.MeshBasicMaterial({ map: cone, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }), 4.3);
  scene.add(ST);
}

// accent colour follows the paint (black / white / grey fall back to the default cyan)
export function accent(css) {
  new THREE.Color(css).getHSL(hsl); if (hsl.s < .2 || hsl.l < .1) ACC.set(0x35c8ff); else ACC.setHSL(hsl.h, Math.max(hsl.s, .75), .56);
  for (const m of TINT) m.color.copy(ACC);
  head.color.copy(ACC).lerp(WHITE, .55);
}
export const pulse = () => { pulseV = 1; };
// camera preset: { az, el, r, ty, tz } or spin:true to keep turning; az = angle from the bike's nose, ty / tz = look-at point on the bike (m)
// presets are written for a ~1.95 m bike on a landscape phone: r, ty, tz get scaled to the bike in front and the free screen area
export function view(p) {
  P = p; T.spin = !!p.spin; T.el = p.el; zf = 1; idle = 0;
  if (p.az !== undefined) T.az = p.az + TAU * Math.round((V.az - p.az) / TAU);
  targets();
}

// bike bounds in the root's frame (heading-free), every mesh that is drawn; the rider counts (it sits on the bike)
function bounds() {
  BOX.makeEmpty(); B.root.updateMatrixWorld(true); _i.copy(B.root.matrixWorld).invert();
  B.root.traverseVisible(o => {
    if (!o.isMesh || o.material.blending === THREE.AdditiveBlending || o.material.transparent && o.material.opacity < .5) return; // beams, glows
    const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); if (g.boundingBox.isEmpty()) return;
    BOX.union(_b.copy(g.boundingBox).applyMatrix4(_m.multiplyMatrices(_i, o.matrixWorld)));
  });
  if (BOX.isEmpty() || BOX.max.z - BOX.min.z > 8) BOX.set(new THREE.Vector3(-.4, 0, -1), new THREE.Vector3(.4, 1.15, 1)); // fallback
  const dy = S.zH - (S.hF + S.hR) / 2; BOX.min.y += dy; BOX.max.y += dy;
  const L = BOX.max.z - BOX.min.z, H = BOX.max.y - BOX.min.y, W = BOX.max.x - BOX.min.x;
  BOX.getCenter(FIT.c); FIT.h = H; FIT.Rs = Math.hypot(L, H) / 2; FIT.R = Math.hypot(L, H, W) / 2; FIT.xz = Math.hypot(L, W) / 2;
}
// the part of the screen not under the garage panels (side panel right in landscape, bottom in portrait)
const rect = id => { const e = document.getElementById(id); return e && e.offsetParent !== null ? e.getBoundingClientRect() : null; };
function free() {
  const W = innerWidth, H = innerHeight, top = rect('gTop'), side = rect('gSide'), bar = rect('gBar'), st = rect('gStats');
  let x0 = st ? st.right : 0, x1 = W, y0 = top ? top.bottom : 0, y1 = bar ? bar.top : H;
  if (side) { if (side.left > W * .35) x1 = side.left; else y1 = Math.min(y1, side.top); }
  if (x1 - x0 < 80) { x0 = 0; x1 = W; } if (y1 - y0 < 80) { y0 = 0; y1 = H; }
  Object.assign(FREE, { x0, y0, x1, y1 }); freeDirty = false;
}
// tangents of the half-angles the free area spans: width, height, and the tighter of the two
const tH = () => Math.tan(camera.fov * Math.PI / 360) * (FREE.x1 - FREE.x0) / innerHeight, tV = () => Math.tan(camera.fov * Math.PI / 360) * (FREE.y1 - FREE.y0) / innerHeight;
const tFree = () => Math.min(tH(), tV());
const T_REF = .4, R_REF = 1.1; // close-up presets were tuned full-screen on a landscape phone, Click 125i
function targets() {
  const t = tFree(), sc = Math.sin(Math.atan(T_REF)) / Math.sin(Math.atan(t)), ks = FIT.Rs / R_REF;
  if (P.spin) { // overview: the whole bike (and sidecar) in view, orbiting its centre
    T.tx = FIT.c.x; T.ty = FIT.c.y; T.tz = FIT.c.z; // any heading can face the camera while it turns: widest = the plan diagonal; height grows with the look-down angle; + the near half's depth
    const hx = FIT.xz, hy = FIT.h / 2 * Math.cos(T.el) + FIT.xz * Math.sin(T.el); T.r = (Math.max(hx / tH(), hy / tV()) + FIT.xz * .5) * 1.15;
  } else { T.tx = 0; T.ty = P.ty * FIT.h / 1.15; T.tz = P.tz * ks; T.r = P.r * ks * sc; }
  T.r = clamp(T.r * zf, .9, 15);
}

export function enter() {
  if (!ST.children.length) initStudio(); on = true; ST.visible = true;
  bikeShadow(sun.castShadow); BLOB_ME.off = sun.castShadow; BLOB_ME.ground = () => O.y + PED; // showroom: the real shadow (Low: the blob, on the plate)
  const c = sun.shadow.camera; c.left = c.bottom = -5; c.right = c.top = 5; c.far = 90; c.updateProjectionMatrix(); sun.shadow.autoUpdate = true; // the bike turns on the pedestal and casts here
  const s = Math.sin(S.psi), co = Math.cos(S.psi), at = (x, y, z) => [O.x + x * co + z * s, O.y + y, O.z - x * s + z * co]; // bike-relative → world
  hemi.color.set(0x9fb4d2); hemi.groundColor.set(0x161b24); hemi.intensity = .8;
  sun.color.set(0xfff0dc); sun.intensity = 3.2; sun.target.position.set(...at(0, .6, 0)); sun.position.set(...at(-14, 26, 20));
  head.position.set(...at(7, 8, -9)); head.target.position.set(...at(0, .7, 0)); head.angle = .5; head.penumbra = 1; head.distance = 40; head.intensity = 420;
  renderer.toneMappingExposure = 1;
  scene.environmentIntensity = .3; if (GRADE.night) GRADE.night.value = 0;
  if (GRADE.sh) { GRADE.sh.value.setRGB(.94, .98, 1.08); GRADE.hi.value.setRGB(1.04, 1.02, .98); GRADE.con.value = .22; GRADE.vib.value = .4; GRADE.vig.value = .3; } // showroom grade (daynight.js takes over again on leave)
  bounds(); free(); targets(); Object.assign(V, { r: T.r * 1.7, el: T.el + .35, az: T.az - .8, tx: T.tx, ty: T.ty, tz: T.tz }); // swoop in
}
export function leave() {
  if (!on) return; on = false; ST.visible = false; PT.clear(); camera.clearViewOffset();
  bikeShadow(false); BLOB_ME.off = false; BLOB_ME.ground = null;
  const c = sun.shadow.camera; c.left = c.bottom = -28; c.right = c.top = 28; c.far = 160; c.updateProjectionMatrix(); sun.shadow.autoUpdate = false; sun.userData.shDirty = true; // island: on demand again (daynight.js)
  head.angle = .42; head.penumbra = .5; head.distance = 75; // daynight.js sets the rest every frame
}

// every frame while the garage is open (called from main.js visuals, after the bike's own placement)
export function studioFrame(dt, now) {
  B.root.position.set(O.x, O.y + PED + S.zH - (S.hF + S.hR) / 2, O.z);
  idle += dt; if (T.spin && !PT.size && idle > 1.5) T.az += dt * .28;
  pulseV = Math.max(0, pulseV - dt * 2.2); ring.scale.setScalar(1 + pulseV * .05); ring.material.color.copy(ACC).lerp(WHITE, pulseV * .8);
  if (camera.fov !== 40) { camera.fov = 40; camera.updateProjectionMatrix(); }
  if (++fitN % 15 === 1) bounds(); // parts (sidecar, exhaust…) change the size
  if (freeDirty) free(); targets();
  const k = 1 - Math.exp(-dt * (PT.size ? 14 : 4)); for (const q of ['az', 'el', 'r', 'tx', 'ty', 'tz']) V[q] += (T[q] - V[q]) * k;
  const az = V.az + (T.spin ? 0 : Math.sin(now * .4) * .12), ce = Math.cos(V.el), lx = V.tx + V.r * ce * Math.sin(az), ly = V.ty + V.r * Math.sin(V.el), lz = V.tz + V.r * ce * Math.cos(az), s = Math.sin(S.psi), c = Math.cos(S.psi);
  camera.position.set(O.x + lx * c + lz * s, O.y + PED + ly, O.z - lx * s + lz * c); camera.lookAt(O.x + V.tx * c + V.tz * s, O.y + PED + V.ty, O.z - V.tx * s + V.tz * c);
  // shift the projection centre into the free area, so the bike sits beside / above the panels instead of under them
  const W = innerWidth, H = innerHeight, ox = W / 2 - (FREE.x0 + FREE.x1) / 2, oy = H / 2 - (FREE.y0 + FREE.y1) / 2, vw = camera.view;
  if (!vw || !vw.enabled || vw.fullWidth !== W || vw.fullHeight !== H || Math.abs(vw.offsetX - ox) > .5 || Math.abs(vw.offsetY - oy) > .5) camera.setViewOffset(W, H, ox, oy, W, H);
}

// drag to orbit, pinch / wheel to zoom
const gl = e => on && e.target.id === 'gl';
const dist = () => { const [a, b] = [...PT.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
addEventListener('pointerdown', e => { if (!gl(e)) return; PT.set(e.pointerId, { x: e.clientX, y: e.clientY }); idle = 0; if (PT.size === 2) pd = dist(); });
addEventListener('pointermove', e => {
  const p = PT.get(e.pointerId); if (!p) return; idle = 0;
  if (PT.size === 2) { p.x = e.clientX; p.y = e.clientY; const d = dist(); if (pd > 0 && d > 0) zf = clamp(zf * pd / d, .4, 2.2); pd = d; return; }
  T.az -= (e.clientX - p.x) * .008; T.el = clamp(T.el + (e.clientY - p.y) * .005, .02, 1.25); p.x = e.clientX; p.y = e.clientY;
});
const up = e => { PT.delete(e.pointerId); pd = 0; }; addEventListener('pointerup', up); addEventListener('pointercancel', up);
addEventListener('wheel', e => { if (gl(e)) { zf = clamp(zf * (1 + Math.sign(e.deltaY) * .08), .4, 2.2); idle = 0; } }, { passive: true });
// panels move with the window size / orientation (and the tab body can change the side panel)
addEventListener('resize', () => { freeDirty = true; });
export const reframe = () => { freeDirty = true; fitN = 0; };
export const SD = { FIT, FREE, T, V, BOX, P: () => P };
