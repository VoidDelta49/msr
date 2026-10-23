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
export const GPU = !!renderer.backend.isWebGPUBackend, API = GPU ? 'WebGPU' : 'WebGL 2', ANISO = Math.min(Q.aniso, renderer.getMaxAnisotropy ? renderer.getMaxAnisotropy() : 8);
export const baseDPR = Math.min(devicePixelRatio, Q.dpr); renderer.setPixelRatio(baseDPR); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = Q.shadow > 0; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
export const scene = new THREE.Scene(), SKY = 0x9fcdea; scene.background = new THREE.Color(SKY); scene.fog = new THREE.Fog(SKY, Q.fog * .11, Q.fog);
export const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .03, Q.fog + 150);
scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x4d5a32, 1.15));
export const sun = new THREE.DirectionalLight(0xfff0d2, 2.7); sun.castShadow = Q.shadow > 0; sun.shadow.mapSize.set(Q.shadow || 1024, Q.shadow || 1024);
{ const c = sun.shadow.camera; c.left = c.bottom = -28; c.right = c.top = 28; c.near = 1; c.far = 160; } sun.shadow.bias = -.0005; sun.shadow.camera.layers.enable(1); scene.add(sun, sun.target); // shadow camera also sees layer 1 = shadow-only proxies (model.js)
// Anti-aliasing: one FXAA pass over the finished frame (far cheaper than MSAA on phone GPUs). Tone mapping + sRGB are
// applied before FXAA (renderOutput), as FXAA expects display-space colours.
let pipe = null;
if (cfg.fxaa) {
  const { pass, renderOutput } = await import('three/tsl'), { fxaa } = await import('three/addons/tsl/display/FXAANode.js');
  pipe = new THREE.RenderPipeline(renderer); pipe.outputColorTransform = false; pipe.outputNode = fxaa(renderOutput(pass(scene, camera)));
}
export const draw = () => pipe ? pipe.render() : renderer.render(scene, camera);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// canvas texture helper
export function ctex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; if (rep) t.repeat.set(rep, rep); return t;
}
export function speck(g, w, h, base, amp, n) { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = Math.random(); g.fillStyle = v > .5 ? `rgba(255,255,255,${amp * (v - .5)})` : `rgba(0,0,0,${amp * (.5 - v)})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }
export const std = (c, r = .6, mt = 0, e) => new THREE.MeshStandardMaterial(e ? { color: c, roughness: r, metalness: mt, emissive: e, emissiveIntensity: 1.5 } : { color: c, roughness: r, metalness: mt });
