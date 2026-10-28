// Speed blur (Options > LOOK, reloads; strength is a live slider), in the spirit of GTA San Andreas: it only appears
// when the VEHICLE is fast (fades in from MB_SPEED[0], full at MB_SPEED[1]), never on foot, and looking around,
// turning or a swinging camera never trigger it. Three layers, all scaled by that speed gate:
//
// 1. Travel streaks (SA's SpeedFX, but a real shutter): every pixel's position is rebuilt from the scene pass's depth
//    and projected with the camera moved back to last frame's position but keeping this frame's rotation and lens, so
//    only the camera's travel makes velocity. Streaks fan out from the point you are heading for, near things far
//    more than the horizon, which stays sharp. The streak is gathered (5-8 dithered taps) from a half-resolution
//    Kawase-blurred copy of the frame (2 passes of 4 bilinear taps, the first is also the 2x downsample): the source is
//    already smooth, so a few taps read as one continuous streak where a plain gather needs 16-32 full-res taps.
// 2. Ghost trails (SA's frame blending): a half-resolution history that keeps a fading echo of the last frames
//    (history = mix(this frame's Kawase copy, last history, keep); keep = exp(-dt / tau), so the trail lasts the same
//    time at any frame rate). It is laid over the frame in proportion to each pixel's streak length, so the echoes
//    trail behind the fast-moving road edges and roadside while the vanishing point and the bike stay crisp, and a
//    still horizon never goes soft.
// 3. Speed vignette: the screen edges dim and lose a little colour as the speed builds (free: same shader).
//
// Cost (mobile first):
// - Below the speed gate, standing still, on foot, menus, garage, pause: no extra passes at all, and the composite
//   takes one uniform branch straight to the sharp pixel. A CPU test (18 reprojected points) also turns everything
//   off when no streak would reach a pixel.
// - Above it: 3 half-resolution passes (2 Kawase + 1 history blend, each 4 or 2 texture reads) = under one
//   full-screen pass of work in total. The composite is not its own pass: it lives in the shader renderer.js already
//   runs over the finished frame, and adds a depth read, 2 matrix products, the streak taps and 1 history tap.
// - Per pixel, streaks under one pixel (the bike, the vanishing point) skip the taps (dynamic branch; those regions
//   are coherent, so whole GPU warps skip together).
// No velocity buffer (no MRT, no per-object matrices), so the scene pass itself costs nothing extra.
// The player's bike moves with the camera, so reprojection (which assumes a static world) would smear it: a sphere
// around the bike is masked out in view space. Other moving vehicles are treated as static.
import * as THREE from 'three';
import { RenderTarget, NodeMaterial, RendererUtils, QuadMesh, TempNode, NodeUpdateType } from 'three';
import { Fn, If, uv, uniform, vec2, vec3, vec4, float, passTexture, texture, context, screenUV, screenSize, screenCoordinate, smoothstep, mix, fract, dot, min, max } from 'three/tsl';

const quad = new QuadMesh(); let rstate;
// vehicle speed (m/s) where the blur starts to appear and where it is at full strength: 60 and 130 km/h
export const MB_SPEED = [60 / 3.6, 130 / 3.6];
const TRAIL = .6;   // how much of the ghost history is laid over a fully streaking pixel
const VIG = .2;     // speed vignette: edge dimming at full speed and strength

const mkRT = name => { const r = new RenderTarget(1, 1, { depthBuffer: false }); r.texture.name = name; return r; };

// Kawase blur chain + ghost history. offsets[i] = pass i's tap distance in destination texels (+0.5); pass 0 reads the
// full-size source, the rest ping-pong between two targets at `scale` of the source size. Then the history blend
// writes hist[p] from the blurred frame and hist[1 - p], and `hist` (a texture node) is pointed at the new one.
class KawaseNode extends TempNode { // (no one-letter fields: x y z w r g b a s t p q are TSL swizzles on nodes)
  static get type() { return 'KawaseNode'; }
  constructor(src, offsets = [0, 1], scale = .5) {
    super('vec4'); this.src = src; this.offs = offsets; this.scale = scale; this.on = true;
    this.inv = uniform(new THREE.Vector2()); this.keep = uniform(0);
    this.rt = [mkRT('Kawase0'), mkRT('Kawase1')]; this.hrt = [mkRT('Trail0'), mkRT('Trail1')]; this.ph = 0;
    this.out = passTexture(this, this.rt[(offsets.length - 1) & 1].texture);
    this.hist = texture(this.hrt[1].texture);
    this.mats = []; this.hmats = []; this.updateBeforeType = NodeUpdateType.FRAME;
  }
  updateBefore(frame) {
    if (!this.on) return;
    const r = frame.renderer, map = this.src.value, w = Math.max(1, Math.round(map.image.width * this.scale)), h = Math.max(1, Math.round(map.image.height * this.scale));
    rstate = RendererUtils.resetRendererState(r, rstate);
    this.inv.value.set(1 / w, 1 / h);
    for (const t of [...this.rt, ...this.hrt]) { if (t.width !== w || t.height !== h) { t.setSize(w, h); this.keep.value = 0; } t.texture.type = map.type; } // resized: old history is garbage
    for (let i = 0; i < this.offs.length; i++) { quad.material = this.mats[i]; r.setRenderTarget(this.rt[i & 1]); quad.render(r); }
    const p = this.ph; quad.material = this.hmats[p]; r.setRenderTarget(this.hrt[p]); quad.render(r);
    this.hist.value = this.hrt[p].texture; this.ph = p ^ 1;
    RendererUtils.restoreRendererState(r, rstate);
  }
  getTextureNode() { return this.out; }
  setup(builder) {
    this.offs.forEach((o, i) => {
      const src = i === 0 ? this.src : texture(this.rt[(i - 1) & 1].texture), d = this.inv.mul(o + .5), u = uv();
      const m = this.mats[i] || (this.mats[i] = new NodeMaterial());
      if (i === 0) m.contextNode = context(builder.getSharedContext());
      m.fragmentNode = src.sample(u.add(d.negate())).add(src.sample(u.add(vec2(d.x, d.y.negate())))).add(src.sample(u.add(vec2(d.x.negate(), d.y)))).add(src.sample(u.add(d))).mul(.25);
      m.name = 'Kawase' + i; m.needsUpdate = true;
    });
    const cur = texture(this.rt[(this.offs.length - 1) & 1].texture);
    [0, 1].forEach(p => { // hist[p] = mix(blurred frame, hist[1 - p], keep)
      const m = this.hmats[p] || (this.hmats[p] = new NodeMaterial());
      m.fragmentNode = vec4(mix(cur.sample(uv()).rgb, texture(this.hrt[1 - p].texture).sample(uv()).rgb, this.keep), 1);
      m.name = 'Trail' + p; m.needsUpdate = true;
    });
    return this.out;
  }
  dispose() { [...this.rt, ...this.hrt].forEach(t => t.dispose()); [...this.mats, ...this.hmats].forEach(m => m.dispose()); super.dispose(); }
}

// scenePass: the TSL pass() the scene renders into (colour + depth). gpu: WebGPU coordinates (depth 0..1) or WebGL
// (-1..1). taps: samples along the streak. Returns { node, MB }: node = the blurred linear colour (vec4, before tone
// mapping), MB = the per-frame controller (renderer.js draw() calls MB.update).
export function motionBlur(scenePass, { gpu = false, taps = 6 } = {}) {
  const col = scenePass.getTextureNode(), dep = scenePass.getTextureNode('depth'), kw = new KawaseNode(col, [0, 1], .5), blur = kw.getTextureNode(), hist = kw.hist;
  const uK = uniform(0), uG = uniform(0), uT = uniform(0), uR = uniform(new THREE.Matrix4()), uPI = uniform(new THREE.Matrix4()), uF = uniform(new THREE.Vector3()), uFR = uniform(1.5), uMax = uniform(.045);
  const node = Fn(() => {
    const u = screenUV, sharp = col.sample(u), res = sharp.rgb.toVar();
    If(uK.greaterThan(0), () => {
      const d = dep.sample(u).x, ndc = vec4(u.x.mul(2).sub(1), u.y.oneMinus().mul(2).sub(1), gpu ? d : d.mul(2).sub(1), 1);
      const v4 = uPI.mul(ndc), vp = v4.xyz.div(v4.w);                                   // view-space position, this frame
      const pc = uR.mul(vec4(vp, 1)), pn = pc.xy.div(max(pc.w, 1e-4));                     // last frame's clip / NDC (travel only)
      const mask = smoothstep(uFR, uFR.mul(1.4), vp.sub(uF).length()).mul(pc.w.greaterThan(0).select(1, 0));
      const vel = ndc.xy.sub(pn).mul(vec2(.5, -.5)).mul(uK).mul(mask);                    // uv units, scaled by the shutter
      const L = vel.mul(screenSize).length(), lim = uMax.mul(screenSize.y), Lc = min(L, lim);
      const v = vel.mul(Lc.div(max(L, 1e-4))).toVar();
      If(Lc.greaterThan(1), () => {
        const j = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(.06711056, .00583715))))); // interleaved gradient noise
        const acc = vec3(0).toVar();
        for (let i = 0; i < taps; i++) acc.addAssign(blur.sample(u.add(v.mul(float(i).add(j).div(taps).sub(.5)))).level(0).rgb);
        res.assign(mix(res, acc.div(taps), smoothstep(1, 8, Lc)));                           // 1: streak (short ones stay sharp)
        res.assign(mix(res, hist.sample(u).level(0).rgb, smoothstep(2, 28, Lc).mul(uT)));    // 2: ghost trail, where it streaks
      });
      const e = smoothstep(.32, .78, u.sub(.5).mul(vec2(screenSize.x.div(screenSize.y), 1).mul(.8)).length()).mul(uG); // 3: speed vignette
      const l = dot(res, vec3(.2126, .7152, .0722));
      res.assign(mix(res, vec3(l), e.mul(.3)).mul(e.mul(VIG).oneMinus()));
    });
    return vec4(res, 1);
  })();

  const PVP = new THREE.Matrix4(), T = new THREE.Matrix4(), cp = new THREE.Vector3(), lp = new THREE.Vector3(), pp = new THREE.Vector3(), q = new THREE.Quaternion(), lq = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector4();
  const TEST = []; for (const z of [-3, -400]) for (const y of [-.9, 0, .9]) for (const x of [-.9, 0, .9]) TEST.push([x, y, z]); // NDC x/y, view depth (m)
  let fresh = true, lastT = 0, was = false;
  const MB = {
    amount: .5,             // shutter, 0..1 of a 1/30 s exposure (Options slider); also sets the trail length
    on: false,              // main.js: riding, not on foot, the garage, menu or pause
    focus: new THREE.Vector3(), radius: 1.5, speed: 0, // world centre + radius of what moves with the camera; its speed (m/s)
    cut() { fresh = true; }, // camera cut (camera mode switch, respawn): no streak and a fresh trail
    active: false, gate: 0, // what the last update decided (tools, HUD)
    update(cam, now) {
      cam.updateWorldMatrix(true, false); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      const dt = Math.min(.1, Math.max(1 / 250, (now - lastT) / 1000)); lastT = now;
      cam.matrixWorld.decompose(cp, q, sc);
      // a jump the bike can't have made, or a sudden turn of the view: a cut, not motion
      if (!fresh && (cp.distanceTo(lp) > 1.5 + 2 * this.speed * dt || q.angleTo(lq) > 1.2)) fresh = true;
      lp.copy(cp); lq.copy(q);
      if (fresh) pp.copy(cp);
      const g = this.on ? Math.min(1, Math.max(0, (this.speed - MB_SPEED[0]) / (MB_SPEED[1] - MB_SPEED[0]))) : 0, gate = g * g * (3 - 2 * g); // smoothstep
      const k = gate && !fresh && this.amount > 0 ? this.amount / 30 / dt * gate : 0;
      // last frame's camera = this frame's rotation and projection at last frame's position (travel only)
      T.copy(cam.matrixWorld).setPosition(pp).invert(); PVP.multiplyMatrices(cam.projectionMatrix, T);
      uR.value.multiplyMatrices(PVP, cam.matrixWorld); uPI.value.copy(cam.projectionMatrixInverse);
      uF.value.copy(this.focus).applyMatrix4(cam.matrixWorldInverse); uFR.value = this.radius;
      let px = 0;
      if (k) { // largest streak among the test points, in pixels (drawing-buffer height ~ 1000 is close enough)
        const P = cam.projectionMatrix.elements, M = uR.value;
        for (const [x, y, z] of TEST) {
          const w = -z, vx = x * w / P[0], vy = y * w / P[5]; // NDC back to view space at that depth
          p.set(vx, vy, z, 1).applyMatrix4(M); if (p.w <= 0) { px = 1e3; break; }
          px = Math.max(px, Math.hypot(x - p.x / p.w, y - p.y / p.w) * .5 * k * 1000);
        }
      }
      const act = px > 1;
      // trail: frame-rate independent decay (tau .06-.16 s with the strength slider); restarts empty after any gap
      kw.keep.value = act && was ? Math.exp(-dt / (.06 + .1 * this.amount)) : 0;
      MB.gate = gate; MB.active = kw.on = was = act; uK.value = act ? k : 0; uG.value = act ? gate * (.5 + this.amount) : 0; uT.value = act ? TRAIL * gate : 0;
      pp.copy(cp); fresh = false;
    },
  };
  return { node, MB };
}
