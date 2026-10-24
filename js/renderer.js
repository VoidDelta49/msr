// WebGPU when the browser has it, WebGL 2 otherwise (or when forced in Options / after a GPU failure)
import * as THREE from 'three';
import { $ } from './util.js';
import { cfg, Q } from './config.js';

export let FELL = false; try { FELL = !!sessionStorage.getItem('cpmGL'); } catch (e) { }
const mkR = gl => new THREE.WebGPURenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance', forceWebGL: gl });
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
// drawn first, never culled, no fog.
export const SKYU = {};
{
  const T = await import('three/tsl'), { clouds } = await import('./tex.js');
  const t = new THREE.CanvasTexture(clouds()); t.wrapS = THREE.RepeatWrapping;
  const U = (k, v) => (SKYU[k] = T.uniform(v));
  const zen = U('zen', new THREE.Color(ZENITH)), hor = U('hor', new THREE.Color(HORIZON)), cl = U('cloud', new THREE.Color(0xf4f4f4)), gl = U('glow', new THREE.Color(0)),
    sd = U('sun', new THREE.Vector3(0, 1, 0)), md = U('moon', new THREE.Vector3(0, -1, 0)), sv = U('sunVis', 1), mv = U('moonVis', 0), nt = U('night', 0);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  m.positionNode = T.positionLocal.add(T.cameraPosition);
  const dir = T.positionLocal.normalize(), up = T.uv().y.mul(2).sub(1).clamp(0, 1), c = T.texture(t, T.uv()), w = c.r, open = w.oneMinus(), above = T.step(0, dir.y);
  const base = T.mix(hor, zen, T.pow(up, .7)), s = T.dot(dir, sd).max(0), mo = T.dot(dir, md).max(0);
  let col = T.mix(base, cl.mul(c.g.mul(.075).add(.925)), w);
  col = col.add(gl.mul(T.pow(s, 6).mul(.55).add(T.pow(s, 40).mul(.6))));                                     // glow around the sun (sunsets)
  col = col.add(T.vec3(1, .96, .85).mul(T.smoothstep(.9988, .9993, s).mul(sv).mul(open).mul(above).mul(4)));   // sun disc
  col = col.add(T.vec3(.85, .88, 1).mul(T.smoothstep(.99935, .99965, mo).mul(mv).mul(open).mul(above)));       // moon disc
  const cell = T.floor(dir.mul(170)), h = T.fract(T.sin(T.dot(cell, T.vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  col = col.add(T.vec3(T.step(.9965, h).mul(h.sub(.9965).mul(220).add(.25)).mul(nt).mul(open).mul(T.smoothstep(.03, .2, dir.y)))); // stars
  m.colorNode = T.vec4(col, 1);
  const d = new THREE.Mesh(new THREE.SphereGeometry(Q.fog * .9, 24, 12), m); d.frustumCulled = false; d.renderOrder = -1; d.matrixAutoUpdate = false; scene.add(d);
}
export const hemi = new THREE.HemisphereLight(0xdcecff, 0x55653a, 1.15); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffeccc, 2.8); sun.castShadow = Q.shadow > 0; sun.shadow.mapSize.set(Q.shadow || 1024, Q.shadow || 1024);
{ const c = sun.shadow.camera; c.left = c.bottom = -28; c.right = c.top = 28; c.near = 1; c.far = 160; } sun.shadow.bias = -.0005; sun.shadow.camera.layers.enable(1); scene.add(sun, sun.target); // shadow camera also sees layer 1 = shadow-only proxies (model.js)
// headlight: always in the scene (intensity 0 by day) so turning it on never changes the light count = no shader recompile
export const head = new THREE.SpotLight(0xfff0d6, 0, 75, .42, .5, 2); head.castShadow = false; scene.add(head, head.target);
// Post: one pass over the finished frame. Tone mapping + sRGB first (renderOutput), then FXAA (expects display-space
// colours), then the N64 filter: a little extra saturation and 15-bit colour (5 bits per channel, like the N64's
// framebuffer) with a 4x4 ordered dither. Both are Options toggles; with neither the scene renders directly.
let pipe = null, scenePass = null;
if (cfg.fxaa || cfg.n64) {
  const T = await import('three/tsl'); scenePass = T.pass(scene, camera); let out = T.renderOutput(scenePass);
  if (cfg.fxaa) { const { fxaa } = await import('three/addons/tsl/display/FXAANode.js'); out = fxaa(out); }
  if (cfg.n64) {
    const b = new Uint8Array(64), BY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; BY.forEach((v, i) => { b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = Math.round((v + .5) / 16 * 255); b[i * 4 + 3] = 255; });
    const bt = new THREE.DataTexture(b, 4, 4); bt.magFilter = bt.minFilter = THREE.NearestFilter; bt.wrapS = bt.wrapT = THREE.RepeatWrapping; bt.generateMipmaps = false; bt.needsUpdate = true;
    const c = out.rgb, l = T.dot(c, T.vec3(.299, .587, .114)), sat = T.mix(T.vec3(l), c, 1.12).clamp(0, 1);
    const d = T.texture(bt, T.screenCoordinate.xy.div(4)).r;
    out = T.vec4(T.floor(sat.mul(31).add(d)).div(31), 1);
  }
  pipe = new THREE.RenderPipeline(renderer); pipe.outputColorTransform = false; pipe.outputNode = out;
}
export const draw = () => pipe ? pipe.render() : renderer.render(scene, camera);
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
