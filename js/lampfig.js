// Lamp light near the player (13.0), the game glue: a fixed set of three.js point lights that the nearest street lamps borrow each
// frame, their one-bounce lights under the pools, and the headlight's bounce off the patch of road it hits. Which lamps and how strong
// is headless (lamps.js). The counts come from the graphics preset (config.js Q.lamps = [direct, bounce]); every light is created
// once and never removed or hidden (three builds the light loop into the shaders: changing the count would recompile everything), an
// unused one just sits at intensity 0. In the cave (Ilalim) the light is baked instead (cavebake.js): only the headlight's bounce runs.
import * as THREE from 'three';
import { Q } from './config.js';
import { scene } from './renderer.js';
import { LSLOT } from './lights.js';
import { lampIndex, selectLamps, lampI, lampRange, bounceI, bounceDepth, headBounceI, LAMPK } from './lamps.js';

const [KD, KB] = Q.lamps || [0, 0];
const mk = () => { const l = new THREE.PointLight(0xffffff, 0, 10, 2); l.castShadow = false; l.matrixAutoUpdate = true; scene.add(l); return l; };
const DIR = Array.from({ length: KD }, mk), BNC = Array.from({ length: KB }, mk), HB = mk(); HB.name = 'headBounce';
DIR.forEach((l, i) => l.name = 'lamp' + i); BNC.forEach((l, i) => l.name = 'lampBounce' + i);
let IDX = null, W = null;
const SEL = [], cA = new THREE.Color(), RH = new THREE.Color(.33, .3, .26); // cave rock under the headlight (the island has albedo())
export const LAMPL = { KD, KB, stats: { lit: 0, bounce: 0, head: 0 }, on: true };

// once, from main.js, with world.js's lamp list, ground and albedo
export function lampInit(world) { W = world; IDX = lampIndex(world.LAMPS); }

// Per frame (daynight.js), after the lamp level is set. P = the player (bike or walker), lvl = lamp level 0..1 (lights.js LAMP),
// head = the headlight spot (renderer.js), hk = how much of the beam is on (0..1), hx/hz = beam direction on the ground, cave = in Ilalim.
export function lampFrame(px, pz, lvl, head, cave, inside) {
  let n = 0;
  if (IDX && LAMPL.on && lvl > 0 && !cave && !inside) n = selectLamps(IDX, px, pz, KD, SEL);
  for (let s = 0; s < KD; s++) {
    const L = DIR[s], U = LSLOT[s];
    if (s >= n) { L.intensity = 0; if (U) U.value.w = 0; continue; }
    const o = SEL[s], l = IDX.list[o.i], f = o.f * lvl;
    L.position.set(l.x, l.y, l.z); L.color.set(l.c); L.intensity = lampI(l) * f; L.distance = lampRange(l);
    if (U) U.value.set(l.x, l.z, l.r, o.f); // the pool fades by the selection fade alone (the lamp level already scales the pool)
  }
  // bounce: the KB lamps that light the player most, each a virtual light under its pool, tinted by the ground there
  let nb = 0;
  for (let b = 0; b < KB; b++) {
    const L = BNC[b]; let best = -1, bs = 0;
    for (let s = 0; s < n; s++) { // KB is 1-2: pick the b-th strongest by a tiny repeated scan, no sorting / allocation
      const o = SEL[s], l = IDX.list[o.i], w = o.f * lampI(l) / (Math.hypot(l.x - px, l.z - pz) ** 2 + (l.y - l.gy) ** 2);
      let taken = false; for (let c = 0; c < b; c++) if (BNC[c].userData.i === o.i) taken = true;
      if (!taken && w > bs) { bs = w; best = s; }
    }
    if (best < 0) { L.intensity = 0; L.userData.i = -1; continue; }
    const o = SEL[best], l = IDX.list[o.i]; W.albedo(l.x, l.z, cA); L.userData.i = o.i;
    L.position.set(l.x, l.gy - bounceDepth(l), l.z); L.color.set(l.c).multiply(cA); L.intensity = bounceI(l) * o.f * lvl; L.distance = lampRange(l) * 1.2; nb++;
  }
  // headlight bounce: the beam's ground patch ~9 m ahead, as a light under it (cave: rock albedo)
  const hi = head.intensity;
  if (hi > 1 && LAMPL.on) {
    const hp = head.position, ht = head.target.position, dx = ht.x - hp.x, dz = ht.z - hp.z, dl = Math.hypot(dx, dz) || 1, gx = hp.x + dx / dl * 9, gz = hp.z + dz / dl * 9;
    let gy = W ? W.H(gx, gz) : hp.y - 1; if (!(Math.abs(gy - hp.y) < 4)) gy = hp.y - 1;
    if (cave || !W) cA.copy(RH); else W.albedo(gx, gz, cA);
    HB.position.set(gx, gy - 2.2, gz); HB.color.copy(head.color).multiply(cA); HB.intensity = headBounceI(hi, head.angle) * .8; HB.distance = 26;
  } else HB.intensity = 0;
  LAMPL.stats.lit = n; LAMPL.stats.bounce = nb; LAMPL.stats.head = +HB.intensity.toFixed(1);
}
// the garage studio has its own lights (studio.js enter): every lamp light off until daynight.js runs again
export function lampsOff() { for (const L of DIR) L.intensity = 0; for (const L of BNC) L.intensity = 0; HB.intensity = 0; for (const U of LSLOT) U.value.w = 0; }
export { LAMPK };
