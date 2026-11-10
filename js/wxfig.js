// Weather (11.99c): the drawn half and the per-frame glue. weather.js decides (headless), wxnet.js fetches, this file runs it
// every frame and draws the rain; daynight.js reads WX for the sky, the light and the fog (wxSky), audio.js for the rain bed.
//
// Rain = ONE draw, simulated on the GPU, no per-drop data (like the grass): drop i gets a fixed random place in a box round the
// camera from a hash of its index, falls by one shared offset the CPU advances (velocity x time, so a wind change bends the
// rain instead of teleporting it) and wraps inside the box. Each drop is a thin streak along its velocity RELATIVE to the
// camera, so it slants with the wind and comes at you when you ride fast. The number drawn follows the intensity
// (instanceCount); no rain = hidden, zero draws. Not drawn indoors, underground or under the cave hall's roof.
import * as THREE from 'three';
import { uniform, instanceIndex, hash, positionGeometry, vec3, float, mod, normalize, cross, length, smoothstep, varying } from 'three/tsl';
import { scene, FOGU, hemi } from './renderer.js';
import { cfg, Q } from './config.js';
import { ctx } from './state.js';
import { WX, wxStep, thunderDue } from './weather.js';
import { wxStart, wxPoll } from './wxnet.js';
import { GWIND } from './grass.js';
import { blip } from './audio.js';
import { SKY } from './daynight.js';

const N = Q.lite ? 500 : Q.shadow >= 2048 ? 2000 : 1200, BX = 22, BY = 13; // drops; box size round the camera (m)
const BOXU = vec3(BX, BY, BX), OFF = uniform(new THREE.Vector3()), CAMP = uniform(new THREE.Vector3()), AX = uniform(new THREE.Vector3(0, -.5, 0)), LIT = uniform(1), KA = uniform(0);
export const RAIN = { mesh: null, n: N, drawn: 0 };
{
  const g = new THREE.InstancedBufferGeometry(), pg = new THREE.PlaneGeometry(1, 1);
  g.setAttribute('position', pg.attributes.position); g.setIndex(pg.index); g.instanceCount = 0;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const i = instanceIndex, seed = vec3(hash(i), hash(i.add(7919)), hash(i.add(15485863)));
  const loc = mod(seed.mul(BOXU).add(OFF).sub(CAMP), BOXU).sub(BOXU.mul(.5)), c = CAMP.add(loc);       // wrapped into the box round the camera
  const side = normalize(cross(AX, loc)).mul(mixW(seed.x));
  m.positionNode = c.add(AX.mul(positionGeometry.y)).add(side.mul(positionGeometry.x));
  const d = length(loc), fade = varying(smoothstep(BX * .5, BX * .36, length(loc.xz)).mul(smoothstep(BY * .5, BY * .38, loc.y.abs())).mul(smoothstep(.5, 2, d)));
  m.colorNode = vec3(.78, .84, .92).mul(LIT);
  m.opacityNode = fade.mul(KA).mul(float(.5).sub(positionGeometry.y.abs()).mul(2).min(1));                // soft ends
  const mesh = RAIN.mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.castShadow = mesh.receiveShadow = false; mesh.renderOrder = 5; mesh.name = 'rain'; mesh.visible = false;
  scene.add(mesh);
}
function mixW(h) { return h.mul(.012).add(.012); } // streak width 1.2-2.4 cm

const last = new THREE.Vector3(), cv = new THREE.Vector3(), rv = new THREE.Vector3(), off = new THREE.Vector3(); let mode0 = cfg.wx ?? 'live', t0 = 0, tw = 0;
/* every frame, before dayNight(): advance the weather and move the rain. show = false in the garage studio. */
export function wxFrame(dt, camera, show = true) {
  const now = Date.now(), mode = cfg.wx ?? 'live';
  if (!t0) { t0 = now; wxStart(); } if (mode !== mode0) { mode0 = mode; if (mode === 'live') wxPoll(); }
  // the weather runs on the real clock (a slow frame rate must not slow the sky down: dt is capped for the physics); paused = stands still
  const wdt = ctx.paused ? 0 : Math.min(1, Math.max(0, (now - (tw || now)) / 1000)); tw = now;
  wxStep(wdt, now, mode, Math.max(0, Math.min(1, (SKY.el || 0) / 25)));
  ctx.wet = WX.wet; FOGU.wet.value = ctx.ug && ctx.ug.on ? 0 : WX.wet; // the road: grip (physics.js) and sheen / puddles (world.js)
  // wind on the grass: stronger and from the real direction; gusts (the grass shader's own) ride on top
  GWIND.k.value = Math.min(3.2, .55 + WX.wind / 4.5); GWIND.d.value.set(WX.wx, WX.wz).multiplyScalar(.92);
  const st = thunderDue(now); if (st && !ctx.paused) blip('thunder', 1 - Math.min(1, st.dist / 10000));
  // rain
  const P = camera.getWorldPosition(CAMP.value), out = show && !ctx.inside && !(ctx.ug && ctx.ug.on) && (ctx.shelter || 0) < .6, k = out ? WX.rain : 0, M = RAIN.mesh;
  if (dt > 0 && last.distanceToSquared(P) < 400) cv.lerp(rv.copy(P).sub(last).divideScalar(dt), Math.min(1, dt * 8)); else cv.set(0, 0, 0); // camera velocity (0 after a teleport)
  last.copy(P);
  M.visible = k > .01; RAIN.drawn = M.geometry.instanceCount = M.visible ? Math.max(40, Math.round(N * Math.pow(k, .75))) : 0;
  if (!M.visible) return;
  const fall = 7 + 3 * WX.rain, wv = WX.wind * (.5 + .25 * Math.sin(now * .0007) * Math.sin(now * .00031)); // drops fall 7-10 m/s; the wind carries them, in gusts
  rv.set(WX.wx * wv, -fall, WX.wz * wv);
  off.addScaledVector(rv, dt); off.set(((off.x % BX) + BX) % BX, ((off.y % BY) + BY) % BY, ((off.z % BX) + BX) % BX); OFF.value.copy(off);
  rv.sub(cv); const sp = rv.length() || 1; AX.value.copy(rv).multiplyScalar(Math.min(2.2, Math.max(.28, sp * .028)) / sp); // streak = 1/36 s of relative motion
  KA.value = .2 + .3 * k; LIT.value = Math.min(1.6, Math.max(.1, hemi.intensity * .75 + .15) + WX.flash * 2);
}
