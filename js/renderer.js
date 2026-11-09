// WebGPU when the browser has it, WebGL 2 otherwise (or when forced in Options / after a GPU failure)
import * as THREE from 'three';
import { $ } from './util.js';
import { cfg, Q, AA_MODES, BENCH } from './config.js';

export let FELL = false; try { FELL = !!sessionStorage.getItem('cpmGL'); } catch (e) { }
const mkR = gl => new THREE.WebGPURenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance', forceWebGL: gl, trackTimestamp: BENCH }); // trackTimestamp: GPU pass timers for the benchmark (bench.js); only on a benchmark load
export let renderer = mkR(!!cfg.forceGL || FELL);
try { await renderer.init(); } catch (e) { FELL = true; renderer = mkR(true); await renderer.init(); }
function gpuFallback() { if (FELL) return; FELL = true; try { sessionStorage.setItem('cpmGL', '1'); } catch (e) { } location.reload(); }
if (renderer.backend.isWebGPUBackend) {
  const dev = renderer.backend.device; let bad = 0;
  dev.lost.then(i => { if (i.reason !== 'destroyed') gpuFallback(); }); dev.addEventListener('uncapturederror', () => { if (++bad > 2) gpuFallback(); });
  addEventListener('unhandledrejection', e => { if (/GPU|popErrorScope/i.test(String(e.reason && e.reason.message || e.reason)) && ++bad > 2) gpuFallback(); });
  addEventListener('error', e => { if (/GPU|popErrorScope|createBuffer/i.test(String(e.message)) && ++bad > 2) gpuFallback(); });
}
// WebGL: three puts instanced matrices in a uniform buffer when they fit MAX_UNIFORM_BLOCK_SIZE, but many Android
// drivers then fail to link the shader (VALIDATE_STATUS false, empty log) and those meshes vanish. A limit of 0 makes
// every instanced mesh use vertex attributes instead, which works everywhere.
if (!renderer.backend.isWebGPUBackend && renderer.backend.capabilities) renderer.backend.capabilities.maxUniformBlockSize = 0;
export const GPU = !!renderer.backend.isWebGPUBackend, API = GPU ? 'WebGPU' : 'WebGL 2', ANISO = Math.min(Q.aniso, renderer.getMaxAnisotropy ? renderer.getMaxAnisotropy() : 8);
// Retro res (Options): cap the render height at cfg.retro lines (480/360/240) and upscale with crisp pixels. Otherwise
// the preset's pixel-ratio cap. autoRes (perf.js) scales on top of this via renderer._rs.
export let baseDPR = 1; renderer._rs = 1;
export function setDPR() {
  baseDPR = Math.min(devicePixelRatio, Q.dpr, cfg.retro ? cfg.retro / innerHeight : 9);
  $('gl').style.imageRendering = cfg.retro ? 'pixelated' : ''; renderer.setPixelRatio(baseDPR * renderer._rs);
}
setDPR(); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = Q.shadow > 0; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Sky: zenith blue fading to a hazy horizon; the fog is the horizon colour, so the far island melts into the sky (N64 style).
export const HORIZON = 0xc6dcea, ZENITH = 0x4b8fd8, SKY = HORIZON;
export const scene = new THREE.Scene(); scene.background = new THREE.Color(SKY); scene.fog = new THREE.Fog(SKY, Q.fog * .11, Q.fog);
export const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .03, Q.fog + 150);
// Day/night (daynight.js): the dome colours come from uniforms (horizon/zenith gradient, cloud mask, sun glow + disc,
// moon disc, stars) so the sky changes with no texture uploads. Dome moved to the camera in the vertex shader,
// drawn after the other opaques at the far plane (see vertexNode), never culled, no fog.
export const SKYU = {};
{
  const T = await import('three/tsl'), { clouds } = await import('./tex.js');
  const t = new THREE.CanvasTexture(clouds()); t.wrapS = THREE.RepeatWrapping;
  const U = (k, v) => (SKYU[k] = T.uniform(v));
  const zen = U('zen', new THREE.Color(ZENITH)), hor = U('hor', new THREE.Color(HORIZON)), cl = U('cloud', new THREE.Color(0xf4f4f4)), gl = U('glow', new THREE.Color(0)),
    sd = U('sun', new THREE.Vector3(0, 1, 0)), md = U('moon', new THREE.Vector3(0, -1, 0)), sv = U('sunVis', 1), mv = U('moonVis', 0), nt = U('night', 0);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  m.positionNode = T.positionLocal.add(T.cameraPosition);
  // Drawn LAST of the opaques, pinned to the far plane (clip z = w, the classic skybox trick): the depth test then skips every
  // pixel the ground, buildings and trees already covered, so the sky shader (texture, pows, star hash) only runs on the sky
  // itself instead of on the whole screen before being painted over. It writes no depth, so motion blur still reads "far".
  const clip = T.cameraProjectionMatrix.mul(T.cameraViewMatrix).mul(T.vec4(m.positionNode, 1)); m.vertexNode = T.vec4(clip.xy, clip.w.mul(.9999999), clip.w);
  const dir = T.positionLocal.normalize(), up = T.uv().y.mul(2).sub(1).clamp(0, 1), c = T.texture(t, T.uv()), w = c.r, open = w.oneMinus(), above = T.step(0, dir.y);
  const base = T.mix(hor, zen, T.pow(up, .7)), s = T.dot(dir, sd).max(0), mo = T.dot(dir, md).max(0);
  let col = T.mix(base, cl.mul(c.g.mul(.075).add(.925)), w);
  col = col.add(gl.mul(T.pow(s, 6).mul(.55).add(T.pow(s, 40).mul(.6))));                                     // glow around the sun (sunsets)
  col = col.add(T.vec3(1, .96, .85).mul(T.smoothstep(.9988, .9993, s).mul(sv).mul(open).mul(above).mul(4)));   // sun disc
  col = col.add(T.vec3(.85, .88, 1).mul(T.smoothstep(.99935, .99965, mo).mul(mv).mul(open).mul(above)));       // moon disc
  const cell = T.floor(dir.mul(170)), h = T.fract(T.sin(T.dot(cell, T.vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  col = col.add(T.vec3(T.step(.9965, h).mul(h.sub(.9965).mul(220).add(.25)).mul(nt).mul(open).mul(T.smoothstep(.03, .2, dir.y)))); // stars
  m.colorNode = T.vec4(col, 1);
  const dg = new THREE.SphereGeometry(Q.fog * .9, 24, 12), d = new THREE.Mesh(dg, m); d.frustumCulled = false; d.renderOrder = 1e9; d.matrixAutoUpdate = false; scene.add(d);
  // environment copy (IBL bake only): the same sky at 55 % saturation, so ambient light is airy rather than zenith blue
  const em = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }); em.positionNode = m.positionNode;
  em.colorNode = T.vec4(T.mix(T.vec3(T.dot(col, T.vec3(.2126, .7152, .0722))), col, .55), 1); SKYU.envMat = em; SKYU.geo = dg;
}
// Fog (11.98): the same range fog (scene.fog's colour / near / far, which daynight.js and the cave still set), but its colour
// now takes the sky's sun glow in the direction you look, with the very same terms as the dome above. Before, the fog was
// one flat horizon colour, so at sunrise / sunset the far island ended in a hard band against the glowing sky; now terrain
// melts into the glow toward the sun and stays cool and blue away from it. FOGU.mist adds low ground mist (dawn, night):
// thickest at sea level, thinning by ~9 m up, clear near the camera. FOGU.glow 0 underground / indoors.
export const FOGU = {};
{
  const T = await import('three/tsl'), F = scene.fog, ref = (k, t) => T.reference(k, t, F).setGroup(T.renderGroup);
  const col = ref('color', 'color'), near = ref('near', 'float'), far = ref('far', 'float'), mist = FOGU.mist = T.uniform(0), gk = FOGU.glow = T.uniform(1);
  scene.fogNode = T.Fn(() => {
    const vz = T.positionView.z.negate(), dir = T.positionWorld.sub(T.cameraPosition).normalize(), s = T.dot(dir, SKYU.sun).max(0);
    const c = col.add(SKYU.glow.mul(T.pow(s, 6).mul(.55).add(T.pow(s, 40).mul(.6))).mul(gk));
    const mk = mist.mul(T.exp(T.positionWorld.y.add(2.2).max(0).mul(-1 / 9))).mul(T.exp(vz.mul(-1 / 140)).oneMinus());
    return T.vec4(T.mix(T.mix(T.output.rgb, c, mk.clamp(0, 1)), c, T.smoothstep(near, far, vz)), T.output.a);
  })();
}
// Image-based lighting (Med/High, Options toggle): the same sky dome plus a ground-coloured floor, rendered into a tiny
// cube and prefiltered (PMREM) into scene.environment. Every PBR material then gets sky-coloured ambient light from
// above, ground bounce from below, and blurred sky reflections (chrome, paint, the sea) that follow the time of day.
// Re-baked only when daynight.js says the sky moved (bakeEnv), into the same render target, so nothing recompiles;
// set before the shader warm-up so the environment is part of every compiled material from the start.
export const IBL = !!cfg.ibl && !Q.lite, ENVG = { c: null };
let pmrem = null, envRT = null, envScene = null;
if (IBL) {
  const T = await import('three/tsl');
  envScene = new THREE.Scene(); const dome = new THREE.Mesh(SKYU.geo, SKYU.envMat); dome.frustumCulled = false; envScene.add(dome);
  ENVG.c = T.uniform(new THREE.Color(0x3a4a2a)); const gm = new THREE.MeshBasicNodeMaterial({ fog: false }); gm.colorNode = ENVG.c;
  const fl = new THREE.Mesh(new THREE.CircleGeometry(Q.fog * .85, 24).rotateX(-Math.PI / 2), gm); fl.position.y = -3; fl.frustumCulled = false; envScene.add(fl);
  pmrem = new THREE.PMREMGenerator(renderer); envRT = pmrem.fromScene(envScene, 0, .5, Q.fog * 2, { size: 64 });
  scene.environment = envRT.texture;
}
export const PC = { bake: 0 }; // event counters the benchmark reads (bench.js)
export function bakeEnv() { if (envRT) PC.bake++, pmrem.fromScene(envScene, 0, .5, Q.fog * 2, { size: 64, renderTarget: envRT }); }
export const hemi = new THREE.HemisphereLight(0xdcecff, 0x55653a, 1.15); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffeccc, 2.8); sun.castShadow = Q.shadow > 0; sun.shadow.mapSize.set(Q.shadow || 1024, Q.shadow || 1024);
{ const c = sun.shadow.camera; c.left = c.bottom = -28; c.right = c.top = 28; c.near = 1; c.far = 160; } sun.shadow.bias = -.0005; sun.shadow.camera.layers.enable(1); scene.add(sun, sun.target); // shadow camera also sees layer 1 = shadow-only proxies (model.js)
// headlight: always in the scene (intensity 0 by day) so turning it on never changes the light count = no shader recompile
export const head = new THREE.SpotLight(0xfff0d6, 0, 75, .42, .5, 2); head.castShadow = false; scene.add(head, head.target);
// Post: one pass over the finished frame. Tone mapping + sRGB first (renderOutput), then the colour grade, then FXAA
// (expects display-space colours), then the N64 filter: 15-bit colour (5 bits per channel, like the N64's framebuffer)
// with a 4x4 ordered dither. All are Options settings (MSAA lives in the scene pass itself); with none the scene renders directly.
// Grade ("modern N64"): split toning (shadows and highlights each multiplied by a tint, blended by brightness), a soft
// S-curve for contrast, vibrance (muted colours pushed harder than already-saturated ones, so paint and signs pop
// without clipping to neon) and a light vignette. daynight.js sets the uniforms from a palette keyed by sun elevation
// (teal/gold at golden hour, violet blue hour, cool moonlit night), so nothing recompiles as the day turns.
export const GRADE = { sh: null, hi: null, con: null, vib: null, vig: null, night: null };
// Night filter (Options): how eyes see in the dark (scotopic vision). Dim areas lose their colour and shift to a cool
// grey-blue, lamp-lit and headlight-lit areas keep theirs, and the blacks lift a touch so the road stays readable.
// GRADE.night (0 day .. 1 night) comes from daynight.js.
// Anti-aliasing (Options): AA = what is really running. MSAA is the multisampled render target of the scene pass below (the
// canvas itself stays un-antialiased), so the pass runs even when MSAA is the only effect; the samples are clamped to what
// the GPU can do for the scene pass's RGBA16F target (WebGPU: 4 only), and a GPU with no multisampling at all gets FXAA.
// FXAA smooths what MSAA can't: alpha-cut edges (wheel faces, signs) and shader aliasing.
export const AA = (() => {
  const w = AA_MODES[cfg.aa] || AA_MODES.fxaa; let ms = 0, why = '';
  if (w.ms) {
    if (renderer.backend.isWebGPUBackend) ms = 4;
    else {
      const gl = renderer.backend.gl, ok = gl && gl.getInternalformatParameter ? Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) || []).sort((a, b) => a - b) : [];
      ms = ok.filter(n => n <= w.ms).pop() || ok[0] || 0; // the most it offers up to what was asked, else its smallest count
    }
    if (!ms) why = 'MSAA is not supported on this GPU, using FXAA';
    else if (ms !== w.ms) why = 'this GPU does MSAA ' + ms + '× here, not ' + w.ms + '×';
  }
  return { mode: cfg.aa, ms, fx: w.fx || (w.ms > 0 && !ms), why, label: ms ? 'MSAA ' + ms + '×' + (w.fx ? ' + FXAA' : '') : w.fx || w.ms ? 'FXAA' : 'Off' };
})();
// Motion blur (mblur.js): reads the scene pass's colour and depth, so it runs on the linear frame before tone mapping
// (bright lamps and the sun streak at full strength). MB = its per-frame controller, null when off.
export let MB = null;
let pipe = null, scenePass = null;
// Bloom (Options, Medium/High): bright parts of the linear frame (lamp lenses, lit windows and signs, the sun disc, headlights, chrome
// glints) bleed a soft glow. three's BloomNode on the scene pass, before tone mapping, so only real HDR highlights (> threshold) bloom,
// not bright paint. A 5-mip blur (wide mips turned down) at a fraction of the resolution. Strength and threshold are uniforms that daynight.js moves with the
// sun (subtle at noon, strongest at night), so nothing recompiles.
export const BLOOM = { on: !!cfg.bloom && !Q.lite, k: null, th: null };
// Ink outlines (Options "Outlines", Medium/High): one look at the scene pass's depth. Depth is 1/distance-linear across the
// screen for any flat surface, so the "depth Laplacian" (a pixel against the two neighbours either side of it, in 4
// directions, at 1 px) is exactly 0 on a plane, even at a grazing angle, and jumps at a silhouette. There a thin dark
// line is drawn: near things only (fades out by ~170 m) so it inks the bike, people and buildings and doesn't fizz on
// distant trees. 1 + 8 depth taps, no extra pass (it runs in the post shader already there).
export const SHADE = { on: !!cfg.shade && !Q.lite, ink: null, nf: null }; // nf: camera near/far (they move: interiors, Ilalim), set in draw()
function shade(T, src, dep) {
  const S = SHADE; S.ink = T.uniform(.75); S.nf = T.uniform(new THREE.Vector2(camera.near, camera.far)); const n = S.nf.x, f = S.nf.y;
  const B = n.mul(f).div(f.sub(n)), u = T.screenUV, px = T.vec2(1).div(T.screenSize);
  const D = o => dep.sample(u.add(o)).x, dc = D(T.vec2(0)), z = n.mul(f).div(f.sub(dc.mul(f.sub(n)))), k = z.div(B);
  const lap = o => dc.mul(2).sub(D(o)).sub(D(o.negate())).mul(k);                     // relative: (1/za + 1/zb - 2/zc)·zc
  const lw = T.max(1, T.screenSize.y.div(900));
  let e = T.float(0); for (const [x, y] of [[1, 0], [0, 1], [.7, .7], [.7, -.7]]) e = T.max(e, lap(px.mul(T.vec2(x, y)).mul(lw)).abs());
  const ink = T.smoothstep(.05, .22, e).mul(T.smoothstep(170, 50, z)).mul(S.ink);
  return T.vec4(src.rgb.mul(ink.mul(.6).oneMinus()), 1);
}
// Sun glare (with bloom): when the sun is on screen and not hidden (5 depth taps around it see the sky), a soft halo
// round it and a few faint ghosts on the line through the screen centre, in the sun's colour. GLARE.k (daynight.js)
// is 0 by night, underground and indoors; at 0 the whole thing is skipped (uniform branch).
export const GLARE = { k: null, p: null, c: null };
function glare(T, src, dep) {
  const G = GLARE; G.k = T.uniform(0); G.p = T.uniform(new THREE.Vector2(.5, .5)); G.c = T.uniform(new THREE.Color(1, .9, .7));
  return T.Fn(() => {
    const res = src.rgb.toVar();
    T.If(G.k.greaterThan(0), () => {
      const u = T.screenUV, asp = T.vec2(T.screenSize.x.div(T.screenSize.y), 1), o = T.vec2(.006, .0105);
      let v = T.float(0); for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) v = v.add(T.step(.9999995, dep.sample(G.p.add(o.mul(T.vec2(x, y)))).x));
      const k = G.k.mul(v.div(5)), d = u.sub(G.p).mul(asp), rr = d.length();
      const halo = T.exp(rr.mul(-7)).mul(.22).add(T.exp(rr.mul(-26)).mul(.5)).add(T.exp(d.y.abs().mul(-180).sub(d.x.abs().mul(3))).mul(.12)); // + a thin horizontal streak
      let gh = T.vec3(0);
      for (const [t, rad, tint] of [[-.35, .05, [1, .7, .4]], [.35, .025, [.6, 1, .7]], [.75, .07, [.5, .7, 1]], [1.25, .035, [1, .8, .5]]]) {
        const g = T.vec2(.5).sub(G.p.sub(.5).mul(t)), dd = u.sub(g).mul(asp).length();
        gh = gh.add(T.vec3(...tint).mul(T.smoothstep(rad, rad * .55, dd).mul(.035)));
      }
      res.addAssign(G.c.mul(halo).add(gh.mul(G.c)).mul(k));
    });
    return T.vec4(res, 1);
  })();
}
if (BLOOM.on || SHADE.on || AA.fx || AA.ms || cfg.n64 || cfg.grade || cfg.nightFx || cfg.mblur) {
  const T = await import('three/tsl'); scenePass = T.pass(scene, camera, AA.ms ? { samples: AA.ms } : {}); AA.rt = scenePass.renderTarget.samples; /* what the target really carries (tools/options.mjs) */
  // MSAA: only the resolved (1-sample) colour is ever read, so the 4-sample buffer need not be written back to memory: on a phone's tiled
  // GPU that store is 4 x 8 bytes per pixel every frame (~47 MB at 1808x812). Depth: motion blur samples the multisampled depth texture,
  // so it is kept then; without motion blur nothing reads it. The scene is one render pass (no viewport/transmission textures split it).
  if (AA.ms) { const rt = scenePass.renderTarget; rt.storeMultisampledColorBuffer = false; if (!cfg.mblur && !SHADE.on && !BLOOM.on) rt.storeMultisampledDepthBuffer = rt.storeMultisampledStencilBuffer = false; }
  let src = scenePass;
  if (cfg.mblur) { const { motionBlur } = await import('./mblur.js'), m = motionBlur(scenePass, { gpu: !!renderer.backend.isWebGPUBackend, taps: Q.lite ? 5 : Q.shadow >= 2048 ? 8 : 6 }); MB = m.MB; src = m.node; }
  if (SHADE.on) src = shade(T, src, scenePass.getTextureNode('depth'));
  if (BLOOM.on) {
    const { bloom } = await import('three/addons/tsl/display/BloomNode.js'), b = bloom(scenePass.getTextureNode(), .3, 0, 1.5);
    b.setResolutionScale(Q.shadow >= 2048 ? .5 : .35); b.smoothWidth.value = .3;
    [1.2, 1, .55, .22, .08].forEach((k, i) => b.bloomTintColors[i].setScalar(k)); // tight glows: the widest mips would wash a whole lit road over the frame
    BLOOM.k = b.strength; BLOOM.th = b.threshold; // (before 11.98's second pass this sat inside the comment above, so daynight.js never moved them)
    src = T.vec4(src.rgb.add(b.rgb), 1);
    src = glare(T, src, scenePass.getTextureNode('depth'));
  }
  let out = T.renderOutput(src);
  if (cfg.grade) {
    const G = GRADE; G.sh = T.uniform(new THREE.Color(.95, .98, 1.06)); G.hi = T.uniform(new THREE.Color(1.05, 1.02, .96)); G.con = T.uniform(.2); G.vib = T.uniform(.45); G.vig = T.uniform(.22);
    let c = out.rgb.clamp(0, 1); const L = T.vec3(.2126, .7152, .0722);
    c = c.mul(T.mix(G.sh, G.hi, T.smoothstep(.05, .85, T.dot(c, L)))).clamp(0, 1);                       // split toning
    c = T.mix(c, c.mul(c).mul(c.mul(-2).add(3)), G.con);                                                    // S-curve
    const l = T.dot(c, L), s = T.max(c.r, T.max(c.g, c.b)).sub(T.min(c.r, T.min(c.g, c.b)));
    c = T.mix(T.vec3(l), c, G.vib.mul(s.oneMinus()).add(1)).clamp(0, 1);                                    // vibrance
    const v = T.screenUV.sub(.5).mul(T.vec2(1.15, 1)), vg = T.smoothstep(.85, .25, v.length());           // vignette
    out = T.vec4(c.mul(T.mix(T.float(1), vg, G.vig)), 1);
  }
  if (cfg.nightFx) {
    const n = GRADE.night = T.uniform(0), L = T.vec3(.2126, .7152, .0722); let c = out.rgb.clamp(0, 1);
    const l = T.dot(c, L), k = n.mul(.75).mul(T.smoothstep(.55, .12, l));                                   // dim = colourless
    c = T.mix(c, T.vec3(l).mul(T.vec3(.86, .95, 1.14)), k);                                                   // cool grey-blue
    out = T.vec4(c.add(c.oneMinus().mul(n.mul(.045))), 1);                                                   // lift the blacks
  }
  // FXAA samples its input's neighbours, so everything above is first drawn into a full-screen texture. That input is display-space
  // 0..1 colour, so 8 bits per channel and no depth buffer (three's default would be RGBA16F + depth: 12 bytes written per pixel
  // instead of 4, every frame, then read back several times by FXAA). The canvas is 8-bit anyway, so nothing visible is lost.
  if (AA.fx) { const { default: FXAANode } = await import('three/addons/tsl/display/FXAANode.js'); out = new FXAANode(T.rtt(out, null, null, { type: THREE.UnsignedByteType, depthBuffer: false })); }
  if (cfg.n64) {
    const b = new Uint8Array(64), BY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; BY.forEach((v, i) => { b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = Math.round((v + .5) / 16 * 255); b[i * 4 + 3] = 255; });
    const bt = new THREE.DataTexture(b, 4, 4); bt.magFilter = bt.minFilter = THREE.NearestFilter; bt.wrapS = bt.wrapT = THREE.RepeatWrapping; bt.generateMipmaps = false; bt.needsUpdate = true;
    const c = out.rgb, l = T.dot(c, T.vec3(.299, .587, .114)), sat = T.mix(T.vec3(l), c, cfg.grade ? 1 : 1.12).clamp(0, 1); // the grade has its own vibrance
    const d = T.texture(bt, T.screenCoordinate.xy.div(4)).r;
    out = T.vec4(T.floor(sat.mul(31).add(d)).div(31), 1);
  }
  pipe = new THREE.RenderPipeline(renderer); pipe.outputColorTransform = false; pipe.outputNode = out;
}
export const BX = { post: true, noShadow: false }; // benchmark ablations (bench.js): post false = render the scene straight to the canvas; noShadow = never redraw the shadow map
// Drunk (effects.js): its own small pipeline, built the first time it is needed (drunkFx(): entering a bar or buying a drink) and drawn
// INSTEAD of the normal one while DRUNK.k > 0, so sober it costs nothing at all. One pass over the scene: the picture wobbles (two slow
// sine warps), swims in and out, splits into a drifting double image, smears a little (a 4-tap blur that grows with k), then tone
// mapping and a warm, pulsing vignette. The grade / FXAA / N64 filter are left out while it runs (you won't notice).
export const DRUNK = { k: 0, t: 0, pipe: null, busy: false };
export async function drunkFx() {
  if (DRUNK.pipe || DRUNK.busy) return; DRUNK.busy = true;
  try {
    const T = await import('three/tsl'), sp = T.pass(scene, camera, AA.ms ? { samples: AA.ms } : {}), col = sp.getTextureNode();
    if (AA.ms) { const rt = sp.renderTarget; rt.storeMultisampledColorBuffer = false; rt.storeMultisampledDepthBuffer = rt.storeMultisampledStencilBuffer = false; }
    const k = DRUNK.ku = T.uniform(0), t = DRUNK.tu = T.uniform(0), u = T.screenUV;
    const warp = T.vec2(T.sin(u.y.mul(7.5).add(t.mul(1.7))).add(T.sin(u.y.mul(17).sub(t.mul(2.9))).mul(.35)), T.cos(u.x.mul(6.2).add(t.mul(1.3)))).mul(k.mul(.011));
    const zoom = T.float(1).sub(k.mul(.035).mul(T.sin(t.mul(.7)).add(1.2))), uu = u.sub(.5).mul(zoom).add(.5).add(warp);
    const off = T.vec2(T.sin(t.mul(.83)), T.cos(t.mul(.61)).mul(.45)).mul(k.mul(.03)), bl = T.vec2(k.mul(.0035));
    const a = col.sample(uu).rgb, b = col.sample(uu.add(off)).rgb, c = col.sample(uu.add(bl)).rgb.add(col.sample(uu.sub(bl)).rgb).mul(.5);
    let rgb = T.mix(T.mix(a, c, k.mul(.6)), b, k.mul(.42));
    let out = T.renderOutput(T.vec4(rgb, 1));
    const v = u.sub(.5).mul(T.vec2(1.2, 1)).length(), pulse = T.sin(t.mul(1.1)).mul(.08).add(.92), vg = T.smoothstep(.95, .2, v.mul(T.float(1).add(k.mul(.35)).mul(pulse)));
    const warm = T.mix(T.vec3(1), T.vec3(1.06, .98, .9), k);
    out = T.vec4(out.rgb.mul(warm).mul(T.mix(T.float(1), vg, k.mul(.7))), 1);
    const p = new THREE.RenderPipeline(renderer); p.outputColorTransform = false; p.outputNode = out; DRUNK.pipe = p;
  } catch (e) { console.warn('drunk pass', e); } finally { DRUNK.busy = false; }
}
export const draw = () => {
  if (DRUNK.pipe && DRUNK.k > .01 && BX.post) { DRUNK.ku.value = DRUNK.k; DRUNK.tu.value = DRUNK.t; DRUNK.pipe.render(); return; }
  if (SHADE.nf) SHADE.nf.value.set(camera.near, camera.far);
  if (MB) MB.update(camera, performance.now()); pipe && BX.post ? pipe.render() : renderer.render(scene, camera);
};
// Shader warm-up, during loading: build every material's shader/pipeline now instead of on first use (the first
// crash, switching to 3rd person, a new area coming into view). Everything hidden is shown and frustum culling is off
// for the duration. compileAsync links the programs in parallel where the driver allows (KHR_parallel_shader_compile on
// WebGL, async pipelines on WebGPU), targeting the same render target as the post pass so the variants match; one real
// draw then catches what compileAsync doesn't cover (shadow-pass depth shaders, post-processing).
export async function warm() {
  const hid = [], fc = [], t0 = performance.now();
  scene.traverse(o => { if (!o.visible) { hid.push(o); o.visible = true; } if (o.frustumCulled) { fc.push(o); o.frustumCulled = false; } });
  try {
    if (renderer.compileAsync) { const rt = renderer.getRenderTarget(); if (scenePass) renderer.setRenderTarget(scenePass.renderTarget); try { await renderer.compileAsync(scene, camera); } finally { renderer.setRenderTarget(rt); } }
    draw();
  } catch (e) { console.warn('shader warm-up', e); }
  for (const o of hid) o.visible = false; for (const o of fc) o.frustumCulled = true;
  return performance.now() - t0;
}
addEventListener('resize', () => { setDPR(); renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// N64 "baked AO": a vertex colour from dark at the bottom (y0) to full at the top (y1, default the bbox). Gouraud-
// interpolated across big faces it reads like contact shadow / sky occlusion for free. Materials need vertexColors.
export function aoGeo(g, lo = .6, y0, y1, pw = .7) {
  g.computeBoundingBox(); const a = y0 ?? g.boundingBox.min.y, b = y1 ?? g.boundingBox.max.y, p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const t = Math.min(1, Math.max(0, (p.getY(i) - a) / (b - a || 1))), v = lo + (1 - lo) * Math.pow(t, pw); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g;
}
// canvas texture helper
export function ctex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; if (rep) t.repeat.set(rep, rep); return t;
}
export function speck(g, w, h, base, amp, n) { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = Math.random(); g.fillStyle = v > .5 ? `rgba(255,255,255,${amp * (v - .5)})` : `rgba(0,0,0,${amp * (.5 - v)})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }
export const std = (c, r = .6, mt = 0, e) => new THREE.MeshStandardMaterial(e ? { color: c, roughness: r, metalness: mt, emissive: e, emissiveIntensity: 1.5 } : { color: c, roughness: r, metalness: mt });
