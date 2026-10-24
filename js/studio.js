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
let ring = null, on = false, pulseV = 0, idle = 0, pd = 0;
const V = { az: .7, el: .25, r: 4, ty: .65, tz: 0 }, T = { ...V, spin: true }, PT = new Map();
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
export function view(p) {
  T.spin = !!p.spin; T.el = p.el; T.r = p.r; T.ty = p.ty; T.tz = p.tz; idle = 0;
  if (p.az !== undefined) T.az = p.az + TAU * Math.round((V.az - p.az) / TAU);
}

export function enter() {
  if (!ST.children.length) initStudio(); on = true; ST.visible = true;
  bikeShadow(sun.castShadow); BLOB_ME.off = sun.castShadow; BLOB_ME.ground = () => O.y + PED; // showroom: the real shadow (Low: the blob, on the plate)
  const c = sun.shadow.camera; c.left = c.bottom = -5; c.right = c.top = 5; c.far = 90; c.updateProjectionMatrix();
  const s = Math.sin(S.psi), co = Math.cos(S.psi), at = (x, y, z) => [O.x + x * co + z * s, O.y + y, O.z - x * s + z * co]; // bike-relative → world
  hemi.color.set(0x9fb4d2); hemi.groundColor.set(0x161b24); hemi.intensity = .8;
  sun.color.set(0xfff0dc); sun.intensity = 3.2; sun.target.position.set(...at(0, .6, 0)); sun.position.set(...at(-14, 26, 20));
  head.position.set(...at(7, 8, -9)); head.target.position.set(...at(0, .7, 0)); head.angle = .5; head.penumbra = 1; head.distance = 40; head.intensity = 420;
  renderer.toneMappingExposure = 1;
  if (GRADE.sh) { GRADE.sh.value.setRGB(.94, .98, 1.08); GRADE.hi.value.setRGB(1.04, 1.02, .98); GRADE.con.value = .22; GRADE.vib.value = .4; GRADE.vig.value = .3; } // showroom grade (daynight.js takes over again on leave)
  Object.assign(V, { r: T.r * 1.7, el: T.el + .35, az: T.az - .8 }); // swoop in
}
export function leave() {
  if (!on) return; on = false; ST.visible = false; PT.clear();
  bikeShadow(false); BLOB_ME.off = false; BLOB_ME.ground = null;
  const c = sun.shadow.camera; c.left = c.bottom = -28; c.right = c.top = 28; c.far = 160; c.updateProjectionMatrix();
  head.angle = .42; head.penumbra = .5; head.distance = 75; // daynight.js sets the rest every frame
}

// every frame while the garage is open (called from main.js visuals, after the bike's own placement)
export function studioFrame(dt, now) {
  B.root.position.set(O.x, O.y + PED + S.zH - (S.hF + S.hR) / 2, O.z);
  idle += dt; if (T.spin && !PT.size && idle > 1.5) T.az += dt * .28;
  pulseV = Math.max(0, pulseV - dt * 2.2); ring.scale.setScalar(1 + pulseV * .05); ring.material.color.copy(ACC).lerp(WHITE, pulseV * .8);
  const k = 1 - Math.exp(-dt * (PT.size ? 14 : 4)); for (const q of ['az', 'el', 'r', 'ty', 'tz']) V[q] += (T[q] - V[q]) * k;
  const az = V.az + (T.spin ? 0 : Math.sin(now * .4) * .12), ce = Math.cos(V.el), lx = V.r * ce * Math.sin(az), ly = V.ty + V.r * Math.sin(V.el), lz = V.tz + V.r * ce * Math.cos(az), s = Math.sin(S.psi), c = Math.cos(S.psi);
  camera.position.set(O.x + lx * c + lz * s, O.y + PED + ly, O.z - lx * s + lz * c); camera.lookAt(O.x + V.tz * s, O.y + PED + V.ty, O.z + V.tz * c);
  if (camera.fov !== 40) { camera.fov = 40; camera.updateProjectionMatrix(); }
}

// drag to orbit, pinch / wheel to zoom
const gl = e => on && e.target.id === 'gl';
const dist = () => { const [a, b] = [...PT.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
addEventListener('pointerdown', e => { if (!gl(e)) return; PT.set(e.pointerId, { x: e.clientX, y: e.clientY }); idle = 0; if (PT.size === 2) pd = dist(); });
addEventListener('pointermove', e => {
  const p = PT.get(e.pointerId); if (!p) return; idle = 0;
  if (PT.size === 2) { p.x = e.clientX; p.y = e.clientY; const d = dist(); if (pd > 0 && d > 0) T.r = clamp(T.r * pd / d, 1.3, 7); pd = d; return; }
  T.az -= (e.clientX - p.x) * .008; T.el = clamp(T.el + (e.clientY - p.y) * .005, .02, 1.25); p.x = e.clientX; p.y = e.clientY;
});
const up = e => { PT.delete(e.pointerId); pd = 0; }; addEventListener('pointerup', up); addEventListener('pointercancel', up);
addEventListener('wheel', e => { if (gl(e)) { T.r = clamp(T.r * (1 + Math.sign(e.deltaY) * .08), 1.3, 7); idle = 0; } }, { passive: true });
