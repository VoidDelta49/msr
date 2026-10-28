// Motion blur (Options > LOOK, reloads; strength is a live slider). Speed blur in the spirit of GTA San Andreas'
// SpeedFX: it only appears when the VEHICLE is fast (ramps in from SPEED[0] to full at SPEED[1]), never on foot, and
// looking around, turning or a swinging camera do not trigger it. The streaks are a real shutter on the camera's
// TRAVEL: every pixel's position is rebuilt from the scene pass's depth and projected with the camera moved back to
// last frame's position but keeping this frame's rotation (and lens), so rotation and FOV changes give no velocity.
// The result streaks outwards from the point you are heading for, near things far more than the horizon, which stays
// sharp. No velocity buffer (no MRT, no per-object matrices), so the scene pass costs nothing extra.
//
// Kawase: the streak is gathered from a half-resolution Kawase-blurred copy of the frame (2 passes of 4 bilinear taps:
// the first is also the 2x downsample). The source is already smooth, so 5-8 taps along the velocity read as a
// continuous streak instead of 5-8 ghost copies, which is where the speed comes from: a plain gather needs 16-32 taps
// on the full-resolution frame for the same look. A per-pixel dither on the tap positions hides what banding is left.
//
// Cost control:
// - CPU check each frame: 18 test points (near road and far horizon, 3x3 across the screen) are reprojected; if none
//   would streak a pixel, the Kawase passes are skipped and the composite takes a uniform branch straight to the
//   sharp pixel. Standing still, the menu, the garage and pause cost one depth-free branch per pixel.
// - Per pixel, streaks under one pixel (the bike, slow areas) skip the taps (dynamic branch; the bike region is
//   coherent so whole GPU warps skip together).
// - The composite is not its own pass: it is part of the shader renderer.js already runs over the finished frame.
// The player's bike moves with the camera, so reprojection (which assumes a static world) would smear it: a sphere
// around the bike (or the walker on foot) is masked out in view space. Other moving vehicles are treated as static.
import * as THREE from 'three';
import { RenderTarget, NodeMaterial, RendererUtils, QuadMesh, TempNode, NodeUpdateType } from 'three';
import { Fn, If, uv, uniform, vec2, vec3, vec4, float, passTexture, texture, context, screenUV, screenSize, screenCoordinate, smoothstep, mix, fract, dot, min, max } from 'three/tsl';

const quad = new QuadMesh(); let rstate;
// vehicle speed (m/s) where the blur starts to appear and where it is at full strength: 60 and 130 km/h
export const MB_SPEED = [60 / 3.6, 130 / 3.6];

// Kawase blur chain: offsets[i] is pass i's tap distance in destination texels (+0.5); pass 0 reads the full-size
// source, the rest ping-pong between two targets at `scale` of the source size.
class KawaseNode extends TempNode {
  static get type() { return 'KawaseNode'; }
  constructor(src, offsets = [0, 1], scale = .5) {
    super('vec4'); this.src = src; this.offs = offsets; this.scale = scale; this.on = true;
    this.inv = uniform(new THREE.Vector2());
    this.rt = [0, 1].map(i => { const r = new RenderTarget(1, 1, { depthBuffer: false }); r.texture.name = 'Kawase' + i; return r; });
    this.out = passTexture(this, this.rt[(offsets.length - 1) & 1].texture);
    this.mats = []; this.updateBeforeType = NodeUpdateType.FRAME;
  }
  updateBefore(frame) {
    if (!this.on) return;
    const r = frame.renderer, map = this.src.value, w = Math.max(1, Math.round(map.image.width * this.scale)), h = Math.max(1, Math.round(map.image.height * this.scale));
    rstate = RendererUtils.resetRendererState(r, rstate);
    this.inv.value.set(1 / w, 1 / h);
    for (const t of this.rt) { t.setSize(w, h); t.texture.type = map.type; }
    for (let i = 0; i < this.offs.length; i++) { quad.material = this.mats[i]; r.setRenderTarget(this.rt[i & 1]); quad.render(r); }
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
    return this.out;
  }
  dispose() { this.rt.forEach(t => t.dispose()); this.mats.forEach(m => m.dispose()); super.dispose(); }
}

// scenePass: the TSL pass() the scene renders into (colour + depth). gpu: WebGPU coordinates (depth 0..1) or WebGL
// (-1..1). taps: samples along the streak. Returns { node, MB }: node = the blurred linear colour (vec4, before tone
// mapping), MB = the per-frame controller (renderer.js draw() calls MB.update).
export function motionBlur(scenePass, { gpu = false, taps = 6 } = {}) {
  const col = scenePass.getTextureNode(), dep = scenePass.getTextureNode('depth'), kw = new KawaseNode(col, [0, 1], .5), blur = kw.getTextureNode();
  const uK = uniform(0), uR = uniform(new THREE.Matrix4()), uPI = uniform(new THREE.Matrix4()), uF = uniform(new THREE.Vector3()), uFR = uniform(1.5), uMax = uniform(.045);
  const node = Fn(() => {
    const u = screenUV, sharp = col.sample(u), res = sharp.rgb.toVar();
    If(uK.greaterThan(0), () => {
      const d = dep.sample(u).x, ndc = vec4(u.x.mul(2).sub(1), u.y.oneMinus().mul(2).sub(1), gpu ? d : d.mul(2).sub(1), 1);
      const v4 = uPI.mul(ndc), vp = v4.xyz.div(v4.w);                                   // view-space position, this frame
      const pc = uR.mul(vec4(vp, 1)), pn = pc.xy.div(max(pc.w, 1e-4));                     // last frame's clip / NDC
      const mask = smoothstep(uFR, uFR.mul(1.4), vp.sub(uF).length()).mul(pc.w.greaterThan(0).select(1, 0));
      const vel = ndc.xy.sub(pn).mul(vec2(.5, -.5)).mul(uK).mul(mask);                    // uv units, scaled by the shutter
      const L = vel.mul(screenSize).length(), lim = uMax.mul(screenSize.y), Lc = min(L, lim);
      const v = vel.mul(Lc.div(max(L, 1e-4))).toVar();
      If(Lc.greaterThan(1), () => {
        const j = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(.06711056, .00583715))))); // interleaved gradient noise
        const acc = vec3(0).toVar();
        for (let i = 0; i < taps; i++) acc.addAssign(blur.sample(u.add(v.mul(float(i).add(j).div(taps).sub(.5)))).level(0).rgb);
        res.assign(mix(res, acc.div(taps), smoothstep(1, 8, Lc)));                           // short streaks stay sharp
      });
    });
    return vec4(res, 1);
  })();

  const PVP = new THREE.Matrix4(), T = new THREE.Matrix4(), cp = new THREE.Vector3(), lp = new THREE.Vector3(), q = new THREE.Quaternion(), lq = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector4();
  const SPEED = MB_SPEED, TEST = []; for (const z of [-3, -400]) for (const y of [-.9, 0, .9]) for (const x of [-.9, 0, .9]) TEST.push([x, y, z]); // NDC x/y, view depth (m)
  const pp = new THREE.Vector3(); let fresh = true, lastT = 0;
  const MB = {
    amount: .5,             // shutter, 0..1 of a 1/30 s exposure (Options slider)
    on: false,              // main.js: riding, not on foot, the garage, menu or pause
    focus: new THREE.Vector3(), radius: 1.5, speed: 0, // world centre + radius of what moves with the camera; its speed (m/s)
    cut() { fresh = true; }, // camera cut (camera mode switch, respawn): no streak for one frame
    active: false,          // what the last update decided (tools, HUD)
    update(cam, now) {
      cam.updateWorldMatrix(true, false); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      const dt = Math.min(.1, Math.max(1 / 250, (now - lastT) / 1000)); lastT = now;
      cam.matrixWorld.decompose(cp, q, sc);
      // a jump the bike can't have made, or a sudden turn of the view: a cut, not motion
      if (!fresh && (cp.distanceTo(lp) > 1.5 + 2 * this.speed * dt || q.angleTo(lq) > 1.2)) fresh = true;
      lp.copy(cp); lq.copy(q); MB.gate = 0;
      if (fresh) pp.copy(cp);
      const g = this.on ? Math.min(1, Math.max(0, (this.speed - SPEED[0]) / (SPEED[1] - SPEED[0]))) : 0, gate = g * g * (3 - 2 * g); // smoothstep
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
      MB.gate = gate; MB.active = kw.on = px > 1; uK.value = MB.active ? k : 0;
      pp.copy(cp); fresh = false;
    },
  };
  return { node, MB };
}
