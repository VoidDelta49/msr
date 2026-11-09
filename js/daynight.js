// Day/night cycle on real Philippine time. The sun and the moon are placed with low-precision astronomy
// (NOAA-style solar position, Meeus-lite moon, accurate to ~1° / ~1 min of sunrise) for the middle of the
// Philippines, from the real clock, so everyone in a multiplayer room sees the same sky. Map axes: north = −z, east = +x.
// cfg.tod: 'live' (default) or a fixed Philippine hour (Options) for players who want daylight.
import * as THREE from 'three';
import { clamp, sstep } from './util.js';
import { gameMs, Q } from './config.js';
import { S, ctx } from './state.js';
import { renderer, scene, camera, sun, hemi, head, SKYU, GRADE, IBL, ENVG, BLOOM, bakeEnv } from './renderer.js';
import { setLamps, beamMeshes, HEAD, BEAM } from './lights.js';
import { H } from './world.js';
import { F, at } from './foot.js';

const LAT = 12.88 * Math.PI / 180, LON = 121.77, R = Math.PI / 180;

// equatorial (ra, dec in rad) at days-since-J2000 d → unit direction in map space
function horiz(ra, dec, d, out) {
  const gmst = 280.46061837 + 360.98564736629 * d, ha = (gmst + LON) * R - ra;
  const se = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(ha), el = Math.asin(clamp(se, -1, 1));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(ha)); // from north, east positive
  return out.set(Math.cos(el) * Math.sin(az), se, -Math.cos(el) * Math.cos(az));
}
const SUN = new THREE.Vector3(), MOON = new THREE.Vector3();
export const SKY = { sun: SUN, moon: MOON, phase: 0, el: 0, night: 0 };
export function astro(ms) {
  const d = ms / 864e5 - 10957.5, e = (23.439 - 3.6e-7 * d) * R;
  const g = (357.529 + .98560028 * d) * R, L = (280.459 + .98564736 * d) * R + (1.915 * Math.sin(g) + .02 * Math.sin(2 * g)) * R;
  horiz(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), Math.asin(Math.sin(e) * Math.sin(L)), d, SUN);
  const M = (134.963 + 13.064993 * d) * R, F = (93.272 + 13.22935 * d) * R, ml = (218.316 + 13.176396 * d) * R + 6.289 * R * Math.sin(M), mb = 5.128 * R * Math.sin(F);
  horiz(Math.atan2(Math.sin(ml) * Math.cos(e) - Math.tan(mb) * Math.sin(e), Math.cos(ml)), Math.asin(Math.sin(mb) * Math.cos(e) + Math.cos(mb) * Math.sin(e) * Math.sin(ml)), d, MOON);
  SKY.phase = (1 - Math.cos(ml - L)) / 2; // illuminated fraction (0 new, 1 full)
  SKY.el = Math.asin(SUN.y) / R;
}

// palette keyed by sun elevation in degrees: zenith, horizon (= fog), cloud, sun glow, sun colour, sun ×, hemi sky, hemi ground, hemi ×
const KEYS = [
  [-18, 0x03060e, 0x0b1020, 0x10141e, 0x000000, 0x000000, 0, 0x42568e, 0x12160f, .27],
  [-10, 0x050a1a, 0x121a30, 0x181c2a, 0x000000, 0x000000, 0, 0x465892, 0x141812, .29],
  [-5, 0x14204a, 0x5a4a6e, 0x4a3a52, 0x6a2a20, 0x000000, 0, 0x6070a0, 0x1c2018, .36],
  [0, 0x2e528e, 0xe89858, 0xf09a70, 0xff7a30, 0xff8a40, .9, 0xb8b4c8, 0x3a3a2a, .65],
  [6, 0x4a80c8, 0xe6c49a, 0xffdcb4, 0xffa850, 0xffc080, 2.3, 0xcad4ea, 0x56553a, .9],
  [12, 0x4a88d2, 0xd4d6d0, 0xfaf0e2, 0x60482c, 0xffdcb0, 2.75, 0xd6e2f4, 0x585e3c, 1],
  [24, 0x4b8fd8, 0xc6dcea, 0xf4f4f4, 0x302820, 0xfff0d4, 3.1, 0xdcecff, 0x5c6440, .98],
];
// colour grade keyed by sun elevation: shadow tint, highlight tint, contrast, vibrance, vignette (renderer.js GRADE)
const GK = [
  [-18, [.80, .90, 1.20], [1.04, .97, .90], .16, .30, .34], // moonlit night: blue shadows, warm lamp highlights
  [-6, [.86, .86, 1.16], [1.10, .94, .96], .18, .40, .30],  // blue hour: violet shadows, rosy highlights
  [0, [.90, .96, 1.10], [1.14, 1.00, .84], .22, .55, .26],  // sunrise / sunset: teal shadows, gold highlights
  [10, [.92, .97, 1.09], [1.09, 1.03, .92], .24, .6, .22], // golden-ish morning / afternoon
  [30, [.94, .99, 1.07], [1.03, 1.03, 1.01], .25, .70, .18], // midday: clean, bright, saturated (neutral highlights keep the sky blue)
];
function grade(el) {
  if (!GRADE.sh) return; let k = 0; while (k < GK.length - 2 && el > GK[k + 1][0]) k++;
  const a = GK[k], b = GK[k + 1], t = clamp((el - a[0]) / (b[0] - a[0]), 0, 1), m = (x, y) => x + (y - x) * t;
  GRADE.sh.value.setRGB(m(a[1][0], b[1][0]), m(a[1][1], b[1][1]), m(a[1][2], b[1][2])); GRADE.hi.value.setRGB(m(a[2][0], b[2][0]), m(a[2][1], b[2][1]), m(a[2][2], b[2][2]));
  GRADE.con.value = m(a[3], b[3]); GRADE.vib.value = m(a[4], b[4]); GRADE.vig.value = m(a[5], b[5]);
}
const cA = new THREE.Color(), cB = new THREE.Color(), tv = new THREE.Vector3();
function key(el, i, out) {
  let k = 0; while (k < KEYS.length - 2 && el > KEYS[k + 1][0]) k++;
  const a = KEYS[k], b = KEYS[k + 1], t = clamp((el - a[0]) / (b[0] - a[0]), 0, 1);
  if (out) return out.copy(cA.setHex(a[i])).lerp(cB.setHex(b[i]), t);
  return a[i] + (b[i] - a[i]) * t;
}

// headlight beam (lights.js): ground patch draped over the real ground ahead of the lamp + the cone in the air
const BM = beamMeshes(); scene.add(BM.pool, BM.cone); const BP = BM.pool.geometry.attributes.position, bq = { x: NaN, z: NaN, a: NaN };
function beam(px, py, pz, fx, fz) {
  if (Math.hypot(px - bq.x, pz - bq.z) < .03 && Math.abs(Math.atan2(fx, fz) - bq.a) < .002) return; bq.x = px; bq.z = pz; bq.a = Math.atan2(fx, fz); // parked: keep the patch
  const { NU, NV, near, far, w0, w1 } = BEAM, a = BP.array, rx = -fz, rz = fx;
  for (let j = 0; j <= NV; j++) {
    const v = j / NV, d = near + (far - near) * v, w = w0 + (w1 - w0) * v, cx = px + fx * d, cz = pz + fz * d;
    for (let i = 0; i <= NU; i++) {
      const o = (i / NU - .5) * w, x = cx + rx * o, z = cz + rz * o; let y = H(x, z);
      if (!(Math.abs(y - py) < 3)) y = py; // under a bridge, off a ledge, in the sea: keep it at the bike's level
      a.set([x, y + .06, z], (j * (NU + 1) + i) * 3);
    }
  }
  BP.needsUpdate = true;
}
sun.shadow.autoUpdate = false; const LEAD = 10, REBASE = 8, UP = new THREE.Vector3(0, 1, 0);
const SHL = { x: NaN, z: NaN, y: NaN, d: new THREE.Vector3(0, -1, 0), r: new THREE.Vector3(), u: new THREE.Vector3(), c: new THREE.Vector3() }; // shadow window: the point it was centred for + latched light direction
let last = -1e9, gate = 0, bakeEl = 1e9, bakeT = 0;
export function dayNight() {
  const ms = gameMs();
  if (ms - last > 2000 || ms < last) { last = ms; astro(ms); } // astronomy every 2 s of game time; lighting every frame (cheap)
  const el = SKY.el, night = 1 - sstep(-9, -2, el); SKY.night = night; ctx.night = night; ctx.dawn = sstep(-8, -2, el) * (1 - sstep(4, 14, el)) * (SUN.x > 0 ? 1 : 0);
  key(el, 1, SKYU.zen.value); key(el, 2, SKYU.hor.value); key(el, 3, SKYU.cloud.value); key(el, 4, SKYU.glow.value);
  SKYU.sun.value.copy(SUN); SKYU.moon.value.copy(MOON); SKYU.sunVis.value = sstep(-1.5, .5, el); SKYU.night.value = night * (1 - .7 * SKY.phase * sstep(0, .2, MOON.y));
  SKYU.moonVis.value = (.35 + .65 * SKY.phase) * sstep(-1, 1, Math.asin(MOON.y) / R) * (1 - sstep(-4, 6, el) * .85);
  scene.fog.color.copy(SKYU.hor.value); scene.background.copy(SKYU.hor.value);
  key(el, 7, hemi.color); key(el, 8, hemi.groundColor); hemi.intensity = key(el, 9); grade(el); if (GRADE.night) GRADE.night.value = night;
  if (IBL) { // the sky now lights the scene through scene.environment: the hemisphere light stays as a weaker fill
    hemi.intensity *= .6; scene.environmentIntensity = .7;
    ENVG.c.value.copy(hemi.groundColor).multiplyScalar(.55 + .45 * key(el, 9));
    if (Math.abs(el - bakeEl) > .5 || ms - bakeT > 6e4 || ms < bakeT) { bakeEl = el; bakeT = ms; bakeEnv(); } // the sky moved enough (or a minute passed: moon, Options hour change)
  }
  // one directional light: the sun by day, the moon (scaled by its phase) after dusk, so shadows keep working
  const moonUp = sstep(0, .15, MOON.y), useMoon = el < -4;
  if (useMoon) { tv.copy(MOON.y > .05 ? MOON : tv.set(.3, 1, .2).normalize()); sun.color.setHex(0x9fb2ff); sun.intensity = .55 * (.15 + .85 * SKY.phase) * moonUp * sstep(-6, -10, el); }
  else { tv.copy(SUN); key(el, 5, sun.color); sun.intensity = key(el, 6) * sstep(-1, 2, el); }
  if (tv.y < .3) { tv.y = 0; tv.normalize().multiplyScalar(.954); tv.y = .3; } // light never below ~17°: grazing light gives shadow acne over the whole ground
  // Shadow map on demand (cached): nothing moving casts into it (bikes and riders use contact blobs, model.js), so it only has to
  // be redrawn when its window or the light moves. The ±28 m window sits LEAD m ahead of the camera and is re-centred only once
  // that point has drifted REBASE m from the window's centre (every 8 m of riding, before 11.69 every 3 m: ~2.7x fewer shadow
  // passes, which were the periodic GPU spike), so at least 30 m ahead and 20 m to the sides are always covered.
  // The centre is snapped to the shadow texel grid IN LIGHT SPACE (stable shadow maps, as in cascaded-shadow engines), so a
  // re-centre moves the map by whole texels and static shadow edges don't crawl. The light direction is latched too: it only
  // follows the sun/moon once that has turned ~0.3° (about a minute of real sun), instead of a shadow pass every 2 s parked.
  const P = at(), e = camera.matrixWorld.elements, fl = Math.hypot(e[8], e[10]) || 1, ix = P.x - e[8] / fl * LEAD, iz = P.z - e[10] / fl * LEAD;
  const cy = Math.round((F.on ? F.y : S.zH || 0) / 4) * 4, L = SHL;
  if (!(Math.hypot(ix - L.x, iz - L.z) <= REBASE) || cy !== L.y || L.d.angleTo(tv) > .005 || sun.userData.shDirty) {
    const tx = 56 / (Q.shadow || 1024), d = L.d.copy(tv).normalize(), r = L.r.crossVectors(UP, d).normalize(), u = L.u.crossVectors(d, r);
    const c = L.c.set(ix, cy, iz), a = Math.round(c.dot(r) / tx) * tx, b = Math.round(c.dot(u) / tx) * tx, w = c.dot(d);
    c.copy(r).multiplyScalar(a).addScaledVector(u, b).addScaledVector(d, w); L.x = ix; L.z = iz; L.y = cy; sun.userData.shDirty = false; sun.shadow.needsUpdate = true;
    sun.target.position.copy(c); sun.position.copy(c).addScaledVector(d, 90);
  }
  setLamps(sstep(3, -3, el)); // street lamps, lit windows and signs come on around sunset (el 3° .. −3°)
  renderer.toneMappingExposure = 1 + .5 * night;                                     // a bit of "eye adaptation" so night stays playable
  // headlight: on with the engine from dusk to dawn (real bikes have it always on, but in daylight it adds nothing)
  gate += ((S.running && el < 4 && !S.crashed ? 1 : 0) - gate) * .2;
  const f = -Math.sin(S.psi), g = -Math.cos(S.psi), sd = Math.sin(S.delta || 0) * .6;
  head.position.set(S.x + f * .9, S.zH + .95, S.z + g * .9);
  head.target.position.set(S.x + (f * Math.cos(sd) - g * Math.sin(sd)) * 22, S.zH - 1.5, S.z + (g * Math.cos(sd) + f * Math.sin(sd)) * 22);
  head.intensity = 900 * gate * (1 - sstep(-4, 4, el) * .7);
  const hb = ctx.inside ? 0 : gate * (1 - sstep(-6, 2, el)); HEAD.value = hb; BM.pool.visible = BM.cone.visible = hb > .005;
  if (hb > .005) {
    const hp = head.position, ht = head.target.position, dx = ht.x - hp.x, dz = ht.z - hp.z, dl = Math.hypot(dx, dz) || 1;
    beam(hp.x, S.zH || 0, hp.z, dx / dl, dz / dl); BM.cone.position.copy(hp); BM.cone.lookAt(ht);
  }
  if (BLOOM.k) { // bloom: subtle in daylight (sun disc, chrome glints), stronger as the lamps come on
    BLOOM.k.value = ctx.inside ? .3 : .25 + .15 * sstep(10, -2, el) + .2 * night; BLOOM.th.value = ctx.inside ? 1.4 : 1.6 - .1 * night;
  }
  // inside a building (interior.js): its own warm lamplight whatever the hour (same lights, new colours: nothing recompiles)
  if (ctx.inside) {
    hemi.color.setHex(0xffe6c4); hemi.groundColor.setHex(0x8a6a50); hemi.intensity = IBL ? 1.6 : 2.2; sun.color.setHex(0xffd9a8); sun.intensity = 1.6;
    if (IBL) scene.environmentIntensity = .25; renderer.toneMappingExposure = 1.12; if (GRADE.night) GRADE.night.value = 0;
  }
}
