// Day/night cycle on real Philippine time. The sun and the moon are placed with low-precision astronomy
// (NOAA-style solar position, Meeus-lite moon, accurate to ~1° / ~1 min of sunrise) for the middle of the
// Philippines, from the real clock, so everyone in a multiplayer room sees the same sky. Map axes: north = −z, east = +x.
// cfg.tod: 'live' (default) or a fixed Philippine hour (Options) for players who want daylight.
import * as THREE from 'three';
import { clamp, sstep } from './util.js';
import { gameMs } from './config.js';
import { S, ctx } from './state.js';
import { renderer, scene, sun, hemi, head, SKYU } from './renderer.js';
import { setLamps } from './lights.js';

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
  [-18, 0x03060e, 0x0b1020, 0x10141e, 0x000000, 0x000000, 0, 0x3a4a78, 0x10140e, .22],
  [-10, 0x050a1a, 0x121a30, 0x181c2a, 0x000000, 0x000000, 0, 0x3e4e80, 0x121610, .24],
  [-5, 0x14204a, 0x5a4a6e, 0x4a3a52, 0x6a2a20, 0x000000, 0, 0x6070a0, 0x1c2018, .36],
  [0, 0x2e528e, 0xe89858, 0xf09a70, 0xff7a30, 0xff8a40, .9, 0xb8b4c8, 0x3a3a2a, .65],
  [6, 0x4a80c8, 0xe6cca6, 0xffe2c0, 0xffb060, 0xffc890, 2.1, 0xd0dcef, 0x4c5a34, .95],
  [20, 0x4b8fd8, 0xc6dcea, 0xf4f4f4, 0x302820, 0xffeccc, 2.8, 0xdcecff, 0x55653a, 1.15],
];
const cA = new THREE.Color(), cB = new THREE.Color(), tv = new THREE.Vector3();
function key(el, i, out) {
  let k = 0; while (k < KEYS.length - 2 && el > KEYS[k + 1][0]) k++;
  const a = KEYS[k], b = KEYS[k + 1], t = clamp((el - a[0]) / (b[0] - a[0]), 0, 1);
  if (out) return out.copy(cA.setHex(a[i])).lerp(cB.setHex(b[i]), t);
  return a[i] + (b[i] - a[i]) * t;
}

let last = -1e9, gate = 0;
export function dayNight() {
  const ms = gameMs();
  if (ms - last > 2000 || ms < last) { last = ms; astro(ms); } // astronomy every 2 s of game time; lighting every frame (cheap)
  const el = SKY.el, night = 1 - sstep(-9, -2, el); SKY.night = night; ctx.night = night; ctx.dawn = sstep(-8, -2, el) * (1 - sstep(4, 14, el)) * (SUN.x > 0 ? 1 : 0);
  key(el, 1, SKYU.zen.value); key(el, 2, SKYU.hor.value); key(el, 3, SKYU.cloud.value); key(el, 4, SKYU.glow.value);
  SKYU.sun.value.copy(SUN); SKYU.moon.value.copy(MOON); SKYU.sunVis.value = sstep(-1.5, .5, el); SKYU.night.value = night * (1 - .7 * SKY.phase * sstep(0, .2, MOON.y));
  SKYU.moonVis.value = (.35 + .65 * SKY.phase) * sstep(-1, 1, Math.asin(MOON.y) / R) * (1 - sstep(-4, 6, el) * .85);
  scene.fog.color.copy(SKYU.hor.value); scene.background.copy(SKYU.hor.value);
  key(el, 7, hemi.color); key(el, 8, hemi.groundColor); hemi.intensity = key(el, 9);
  // one directional light: the sun by day, the moon (scaled by its phase) after dusk, so shadows keep working
  const moonUp = sstep(0, .15, MOON.y), useMoon = el < -4;
  if (useMoon) { tv.copy(MOON.y > .05 ? MOON : tv.set(.3, 1, .2).normalize()); sun.color.setHex(0x9fb2ff); sun.intensity = .55 * (.15 + .85 * SKY.phase) * moonUp * sstep(-6, -10, el); }
  else { tv.copy(SUN); key(el, 5, sun.color); sun.intensity = key(el, 6) * sstep(-1, 2, el); }
  if (tv.y < .3) { tv.y = 0; tv.normalize().multiplyScalar(.954); tv.y = .3; } // light never below ~17°: grazing light gives shadow acne over the whole ground
  sun.target.position.set(S.x, 0, S.z); sun.position.set(S.x + tv.x * 90, S.zH + tv.y * 90, S.z + tv.z * 90);
  setLamps(sstep(3, -3, el)); // street lamps, lit windows and signs come on around sunset (el 3° .. −3°)
  renderer.toneMappingExposure = 1 + .5 * night;                                     // a bit of "eye adaptation" so night stays playable
  // headlight: on with the engine from dusk to dawn (real bikes have it always on, but in daylight it adds nothing)
  gate += ((S.running && el < 4 && !S.crashed ? 1 : 0) - gate) * .2;
  const f = -Math.sin(S.psi), g = -Math.cos(S.psi), sd = Math.sin(S.delta || 0) * .6;
  head.position.set(S.x + f * .9, S.zH + .95, S.z + g * .9);
  head.target.position.set(S.x + (f * Math.cos(sd) - g * Math.sin(sd)) * 22, S.zH - 1.5, S.z + (g * Math.cos(sd) + f * Math.sin(sd)) * 22);
  head.intensity = 900 * gate * (1 - sstep(-4, 4, el) * .7);
}
