// Particles: tyre smoke, dust, splashes. One small pool, ONE draw call, simulated entirely on the GPU.
//
// Mobile-first design:
// - No per-particle CPU work per frame. A particle is written once when it is born (start position, velocity, birth
//   time, life, size, gravity, drag, colour) into a ring buffer; its motion is a closed-form function of its age in the
//   vertex shader (drag + gravity). The CPU only moves one time uniform and the camera's right / up vectors.
// - Uploads are just the slots written this frame (attribute update ranges), usually a few dozen floats, never the pool.
// - Nothing alive = the mesh is hidden: zero draws, zero fill while you ride normally.
// - Pool size follows the Quality preset (Low 96, Medium 192, High 320); the ring just overwrites the oldest puff.
// - Fill rate (what really costs on phones): small round billboards, fogged, no depth write, no shadows, no sorting,
//   and every puff fades out as it nears the camera so a burnout never paints the whole screen.
// Look: a tiny 32 px dithered puff texture with bilinear filtering (same N64 trick as tex.js), lit by the time of day.
import * as THREE from 'three';
import { uniform, instancedBufferAttribute, instanceIndex, hash, positionLocal, uv, texture, vec3, float, step, smoothstep, mix, varying, cameraPosition, cos, sin } from 'three/tsl';
import { scene, hemi, sun } from './renderer.js';
import { Q } from './config.js';
import { S, ctx } from './state.js';
import { sstep } from './util.js';

const N = Q.lite ? 96 : Q.shadow >= 2048 ? 320 : 192;
const T = uniform(0), CR = uniform(new THREE.Vector3(1, 0, 0)), CU = uniform(new THREE.Vector3(0, 1, 0)), LIT = uniform(1);
const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
// per particle: P = start xyz + birth time, V = velocity + life, K = size at birth, size at death, gravity, drag, C = rgb + alpha
const PA = mk(), VA = mk(), KA = mk(), CA = mk();
for (let i = 0; i < N; i++) PA.array[i * 4 + 3] = -1e4; // every slot starts long dead

// 32x32 lumpy puff: a few overlapping soft blobs, alpha quantized to 5 levels with a 4x4 Bayer dither; red = shade
// (lighter on top). Own RNG: never touch util.rand (the island layout depends on its sequence).
function puffTex() {
  let sd = 3; const rnd = () => (sd = (Math.imul(sd, 1103515245) + 12345) >>> 0) / 4294967296;
  const W = 32, c = document.createElement('canvas'); c.width = c.height = W; const g = c.getContext('2d'), im = g.createImageData(W, W);
  const BY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], blobs = [[.5, .5, .32]];
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283 + rnd() * .6, r = .1 + rnd() * .1; blobs.push([.5 + Math.cos(a) * (.36 - r), .5 + Math.sin(a) * (.36 - r), r]); }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = (x + .5) / W, v = (y + .5) / W; let a = 0;
    for (const [bx, by, r] of blobs) { const d = Math.hypot(u - bx, v - by) / r; a = Math.max(a, 1 - d * d); }
    const q = Math.floor(Math.max(0, a) * 4 + (BY[(y & 3) * 4 + (x & 3)] + .5) / 16) / 4, k = (y * W + x) * 4;
    im.data[k] = Math.round(255 * (1 - .35 * v)); im.data[k + 1] = im.data[k + 2] = 0; im.data[k + 3] = Math.round(255 * Math.min(1, q));
  }
  g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
{
  // attributes reach the shader through the nodes only (adding them to the geometry too reads as 0 on r186 WebGL, see model.js)
  const P = instancedBufferAttribute(PA), V = instancedBufferAttribute(VA), K = instancedBufferAttribute(KA), C = instancedBufferAttribute(CA);
  const age = T.sub(P.w), t = age.div(V.w).clamp(0, 1), alive = step(0, age).mul(step(age, V.w));
  const dr = K.w.max(.001), fall = age.mul(dr).negate().exp().oneMinus().div(dr);          // distance travelled under linear drag
  const w = P.xyz.add(V.xyz.mul(fall)).sub(vec3(0, K.z.mul(age).mul(age).mul(.5), 0));      // + gravity (negative = rises)
  const size = mix(K.x, K.y, t.oneMinus().mul(t.oneMinus()).oneMinus()).mul(alive);         // grows fast, then slows
  const ang = hash(instanceIndex).mul(6.283).add(age.mul(hash(instanceIndex.add(7)).sub(.5))), c = cos(ang), s = sin(ang);
  const x = positionLocal.x, y = positionLocal.y, cx = x.mul(c).sub(y.mul(s)), cy = x.mul(s).add(y.mul(c));
  mat.positionNode = w.add(CR.mul(cx.mul(size))).add(CU.mul(cy.mul(size)));                // camera-facing billboard, spun
  // fade in, fade out, and fade near the camera (fill rate): per vertex, interpolated
  const env = varying(smoothstep(0, .06, t).mul(t.mul(t).oneMinus()).mul(smoothstep(.6, 2.6, w.sub(cameraPosition).length())));
  const px = texture(puffTex(), uv());
  mat.colorNode = C.xyz.mul(px.r.mul(.4).add(.6)).mul(LIT); mat.opacityNode = px.a.mul(C.w).mul(env);
}
const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, N); // instance matrices stay identity
mesh.name = 'particles'; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false; mesh.visible = false; mesh.renderOrder = 5; scene.add(mesh);

export const PFX = { n: N, head: 0, alive: 0, spawned: 0 }; // debug
let head = 0, dirty0 = -1, dirtyN = 0, until = 0;
const now = () => performance.now() / 1000;
const r = (a, b) => a + Math.random() * (b - a);

// Presets: life [min, max] s, size [birth, death] m, g (m/s², negative rises), drag (1/s), rgb, alpha.
export const FX = {
  smoke: { life: [1.4, 2.2], size: [.35, 2.2], g: -.35, drag: 1.6, rgb: [.92, .92, .94], a: .55, jit: .5 },
  dust: { life: [.9, 1.5], size: [.25, 1.5], g: -.05, drag: 2.2, rgb: [.76, .66, .5], a: .5, jit: .8 },
  splash: { life: [.6, .9], size: [.2, .55], g: 9.8, drag: .4, rgb: [.85, .93, 1], a: .8, jit: 1.5 },
};

// One particle. (vx, vy, vz) is added to a random spread of the preset's jitter; k scales its opacity.
export function emit(p, x, y, z, vx = 0, vy = 0, vz = 0, k = 1, rgb = p.rgb) {
  const i = head, o = i * 4, j = p.jit, life = r(p.life[0], p.life[1]), t = now();
  PA.array[o] = x; PA.array[o + 1] = y; PA.array[o + 2] = z; PA.array[o + 3] = t;
  VA.array[o] = vx + r(-j, j); VA.array[o + 1] = vy + r(0, j); VA.array[o + 2] = vz + r(-j, j); VA.array[o + 3] = life;
  const sz = r(.8, 1.2); KA.array[o] = p.size[0] * sz; KA.array[o + 1] = p.size[1] * sz; KA.array[o + 2] = p.g; KA.array[o + 3] = p.drag;
  CA.array[o] = rgb[0]; CA.array[o + 1] = rgb[1]; CA.array[o + 2] = rgb[2]; CA.array[o + 3] = p.a * k;
  if (dirty0 < 0) dirty0 = i; dirtyN = Math.min(N, dirtyN + 1); head = (i + 1) % N; PFX.spawned++;
  until = Math.max(until, t + life);
}
export function burst(p, n, x, y, z, vx = 0, vy = 0, vz = 0, k = 1) { for (let i = 0; i < n; i++) emit(p, x, y, z, vx, vy, vz, k); }

function flush() {
  if (dirty0 < 0) return;
  const a = dirty0, n = dirtyN, end = a + n;
  for (const A of [PA, VA, KA, CA]) {
    if (end <= N) A.addUpdateRange(a * 4, n * 4); else { A.addUpdateRange(a * 4, (N - a) * 4); A.addUpdateRange(0, (end - N) * 4); }
    A.needsUpdate = true;
  }
  dirty0 = -1; dirtyN = 0;
}

// Per frame, before drawing: time, billboard axes, light level, uploads, and hide the mesh when nothing is alive.
export function fxTick(camera) {
  const t = now(); T.value = t; mesh.visible = t < until; PFX.head = head;
  if (!mesh.visible) return;
  const e = camera.matrixWorld.elements; CR.value.set(e[0], e[1], e[2]).normalize(); CU.value.set(e[4], e[5], e[6]).normalize();
  LIT.value = Math.min(1, Math.max(.12, hemi.intensity * .55 + sun.intensity * .2)); // dim smoke at night, without a lit shader
  flush();
}

// ---- the player's bike: tyre smoke on tarmac, dust off it, a dust trail while a crash slides ----
// Rates are per second and frame-rate independent (fractional accumulators); at most a few puffs per frame.
const acc = { r: 0, f: 0, d: 0, c: 0 };
function rate(key, perSec, dt, fn) { acc[key] = Math.min(4, acc[key] + perSec * dt); while (acc[key] >= 1) { acc[key]--; fn(); } }
export function bikeFx(dt) {
  if (ctx.GAR || ctx.paused || ctx.OPT || ctx.ride || !ctx.spec || dt <= 0) return;
  const sp = ctx.spec.base || ctx.spec, bx = Math.sin(S.psi), bz = Math.cos(S.psi), v = S.v || 0, av = Math.abs(v), y = (S.zH || 0) + .08;
  const paved = (S.surf || 1) > .92, onGround = !S.air;
  const rx = S.x + bx * sp.lr, rz = S.z + bz * sp.lr, fx = S.x - bx * sp.lf, fz = S.z - bz * sp.lf;
  const wvx = -bx * v * .25, wvz = -bz * v * .25; // puffs keep a little of the bike's speed, so the trail stretches out behind
  if (S.crashed) { if (av > 1.5) rate('c', Math.min(30, av * 3), dt, () => emit(paved ? FX.smoke : FX.dust, S.x, y, S.z, wvx, .3, wvz, .8)); return; }
  if (!onGround) return;
  const spin = sstep(.6, 5, Math.abs(S.ws || 0)), lockR = S.lkR ? sstep(1, 6, av) : 0, slide = S.skid || 0;
  const rear = Math.max(spin, lockR, slide);
  if (paved) {
    if (rear > .05) rate('r', 6 + 34 * rear, dt, () => emit(FX.smoke, rx, y, rz, wvx, .4, wvz, .5 + .5 * rear));
    if (S.lkF && av > 1) rate('f', 20 * sstep(1, 8, av), dt, () => emit(FX.smoke, fx, y, fz, wvx, .3, wvz, .6));
  } else {
    const k = Math.max(sstep(3, 16, av), rear);
    if (k > .02) rate('d', 4 + 26 * k, dt, () => emit(FX.dust, rx, y, rz, wvx + bx * 1.5 * k, .6 + k, wvz + bz * 1.5 * k, .4 + .6 * k));
  }
}
export function splash(x, y, z) { burst(FX.splash, 18, x, y + .1, z, 0, 3.5, 0); burst(FX.smoke, 6, x, y + .2, z, 0, .5, 0, .6); }
