// GPU grass (Build 11.99): a field of grass tufts round the camera, placed, coloured and animated entirely on the GPU.
// One draw: an InstancedBufferGeometry of G x G tufts with NO per-instance data. The vertex shader turns instanceIndex
// into a world grid cell (the grid is snapped to the camera, so a cell always gets the same tuft: no swimming while
// riding), jitters it with a hash of the cell, reads the ground height, grass density and ground colour from two
// small RGBA8 data textures baked once from the 5 m terrain mesh (world.js), then sways the blade tips with the wind
// and bends them away from the bike and the walker. Bare ground, roads, sand, towns, paddies and building
// footprints have density 0 (no tuft: all its vertices collapse to one point, nothing is rasterised).
// Same TSL on WebGPU and WebGL 2. Options > GRAPHICS > Grass turns it off (reloads); the preset sets the count / radius.
import * as THREE from 'three';
import { uniform, instanceIndex, textureLoad, ivec2, vec2, vec3, vec4, float, uint, floor, fract, dot, mix, smoothstep, clamp, sin, cos, time, positionGeometry, varying, select, max, min, normalize, length } from 'three/tsl';
import { scene } from './renderer.js';
import { cfg, Q } from './config.js';

export const GRASS = { on: false, mesh: null, n: 0 };
// per preset: grid size (tufts per side) and the fade radius (m). spacing = 2 * HALF / G
const LV = { low: { g: 128, r: 26 }, med: { g: 200, r: 40 }, high: { g: 256, r: 52 } };
const C = uniform(new THREE.Vector2()), CAM = uniform(new THREE.Vector3()), P1 = uniform(new THREE.Vector3(0, 0, -1)), P2 = uniform(new THREE.Vector3(0, 0, -1)), WIND = uniform(1);

// one tuft: 3 tapered blades round the centre, 2 segments each (5 vertices, 3 triangles), y = 0..1 along the blade.
// Normals point up: the tufts shade like the ground they stand on instead of flickering as their faces turn.
function tuft() {
  const p = [], n = [], ix = [];
  for (let b = 0; b < 3; b++) {
    const a = b * 2.1 + .3, ca = Math.cos(a), sa = Math.sin(a), w = .045, lx = .09 * Math.cos(a + 1.6), lz = .09 * Math.sin(a + 1.6), o = p.length / 3;
    const ofx = .06 * Math.cos(a * 3), ofz = .06 * Math.sin(a * 3);
    const put = (s, y, wk) => { p.push(ofx + ca * w * s * wk + lx * y * y, y, ofz + sa * w * s * wk + lz * y * y); n.push(0, 1, 0); };
    put(-1, 0, 1); put(1, 0, 1); put(-1, .5, .7); put(1, .5, .7); put(0, 1, 0);
    ix.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setIndex(ix);
  return g;
}

/* T = { MH: heights per terrain vertex, col: rgb per vertex (0..1), gw: grass density per vertex (0..1), W: vertices per side,
   x0, z0: world position of vertex 0, ts: vertex spacing }. Vertex k = i + W * j sits at (x0 + i ts, z0 + j ts). */
export function buildGrass(T) {
  if (cfg.grass === false) return;
  const lv = LV[cfg.gfx] || LV.med, G = lv.g, RF = lv.r, HALF = RF * .78, SP = 2 * HALF / G, W = T.W, N = W * W;
  let lo = 1e9, hi = -1e9; for (let k = 0; k < N; k++) if (T.gw[k] > 0) { lo = Math.min(lo, T.MH[k]); hi = Math.max(hi, T.MH[k]); }
  if (hi < lo) return; lo -= 1; hi += 1; const RG = hi - lo;
  const dH = new Uint8Array(N * 4), dC = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) {
    const q = Math.round(clampN((T.MH[k] - lo) / RG) * 65535); dH[k * 4] = q >> 8; dH[k * 4 + 1] = q & 255; dH[k * 4 + 2] = Math.round(clampN(T.gw[k]) * 255); dH[k * 4 + 3] = 255;
    for (let c = 0; c < 3; c++) dC[k * 4 + c] = Math.round(clampN(Math.sqrt(T.col[k * 3 + c])) * 255); dC[k * 4 + 3] = 255; // sqrt: more steps in the darks
  }
  const mk = d => { const t = new THREE.DataTexture(d, W, W, THREE.RGBAFormat, THREE.UnsignedByteType); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
  const tH = mk(dH), tC = mk(dC); let tint, posN;

  const hash = p => { // hash without sine (Dave Hoskins): stable for large cell numbers
    const a = fract(vec3(p.x, p.y, p.x).mul(.1031)), b = a.add(dot(a, a.yzx.add(33.33)));
    return fract(b.x.add(b.y).mul(b.z));
  };
  {
    const id = instanceIndex, gx = float(id.mod(uint(G))), gz = float(id.div(uint(G)));
    const cell = C.add(vec2(gx, gz)).sub(G / 2), h1 = hash(cell), h2 = hash(cell.add(17.7)), h3 = hash(cell.add(vec2(-41.3, 9.1))), h4 = hash(cell.add(vec2(5.3, -63.9)));
    const base = cell.add(vec2(h1, h2)).mul(SP);
    // terrain: the grid cell under the tuft, the same two triangles as the PlaneGeometry (diagonal from (i, j+1) to (i+1, j))
    const g = base.sub(vec2(T.x0, T.z0)).div(T.ts), inside = g.x.greaterThan(0).and(g.y.greaterThan(0)).and(g.x.lessThan(W - 1)).and(g.y.lessThan(W - 1));
    const i0 = clamp(floor(g), vec2(0), vec2(W - 2)), f = g.sub(i0), ii = ivec2(i0);
    const ta = textureLoad(tH, ii), tb = textureLoad(tH, ii.add(ivec2(0, 1))), tc = textureLoad(tH, ii.add(ivec2(1, 1))), td = textureLoad(tH, ii.add(ivec2(1, 0)));
    const ht = t => t.x.mul(255 * 256).add(t.y.mul(255)).div(65535).mul(RG).add(lo);
    const ha = ht(ta), hb = ht(tb), hc = ht(tc), hd = ht(td), up = f.x.add(f.y).lessThanEqual(1);
    const y0 = select(up, ha.add(hd.sub(ha).mul(f.x)).add(hb.sub(ha).mul(f.y)), hc.add(hb.sub(hc).mul(f.x.oneMinus())).add(hd.sub(hc).mul(f.y.oneMinus())));
    const den = mix(mix(ta.z, td.z, f.x), mix(tb.z, tc.z, f.x), f.y).mul(select(inside, float(1), float(0)));
    const ca = textureLoad(tC, ii).xyz, cb = textureLoad(tC, ii.add(ivec2(0, 1))).xyz, cc = textureLoad(tC, ii.add(ivec2(1, 1))).xyz, cd = textureLoad(tC, ii.add(ivec2(1, 0))).xyz;
    const gcol = mix(mix(ca, cd, f.x), mix(cb, cc, f.x), f.y);
    // keep / size: density decides how many cells grow a tuft; tufts shrink to nothing towards the fade radius
    const d = length(base.sub(CAM.xz)), fade = smoothstep(RF, RF * .62, d), keep = select(h3.lessThan(den.mul(1.15).sub(.08)), float(1), float(0));
    const ht0 = mix(float(.28), float(.62), h4.mul(h4)).mul(smoothstep(.05, .5, den).mul(.6).add(.4));
    // the bike and the walker (P1 / P2: x, z, radius) press the grass down and away
    const pr = P => { const e = base.sub(P.xy), l = length(e).max(.001), k = smoothstep(P.z, P.z.mul(.25), l).mul(select(P.z.greaterThan(0), float(1), float(0))); return [e.div(l).mul(k.mul(.55)), k]; };
    const [pa, ka] = pr(P1), [pb, kb] = pr(P2), push = pa.add(pb), flat = max(ka, kb);
    const scl = ht0.mul(fade).mul(keep).mul(flat.mul(.55).oneMinus()), y = positionGeometry.y;
    // rotate the tuft, wide-ish at the base, bend the tip with a wind gust that rolls across the island
    const a = h1.mul(6.283), c = cos(a), s = sin(a), lp = positionGeometry.xz.mul(mix(float(.8), float(1.3), h2));
    const rx = lp.x.mul(c).sub(lp.y.mul(s)), rz = lp.x.mul(s).add(lp.y.mul(c));
    const gust = sin(time.mul(1.7).add(dot(base, vec2(.11, .07))).add(h3.mul(2))).mul(.5).add(.5), sway = sin(time.mul(3.1).add(h4.mul(6.283))).mul(.25);
    const bend = vec2(.8, .45).mul(gust.mul(.7).add(sway)).mul(WIND).mul(.22).add(push).mul(y.mul(y)).mul(ht0.max(.35));
    tint = gcol.mul(gcol).mul(mix(float(.92), float(1.12), h2));
    const wk = scl.mul(4).min(1).mul(scl.min(.6).add(.4)); // blade width: 0 when the tuft is gone, so all its vertices collapse
    posN = vec3(base.x.add(rx.mul(wk)).add(bend.x.mul(keep)), y0.add(y.mul(scl)).sub(.04), base.y.add(rz.mul(wk)).add(bend.y.mul(keep)));
  }
  const m = Q.lite ? new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide }) : new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: .85, metalness: 0 });
  m.positionNode = posN;
  const vt = varying(tint), y = positionGeometry.y;
  m.colorNode = vec4(vt.mul(mix(float(.5), float(1.18), y)).add(vec3(.03, .05, 0).mul(y.mul(y))), 1); // dark roots (self-shadow), sunlit tips
  const g = tuft(); g.instanceCount = G * G;
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = Q.shadow > 0; mesh.matrixAutoUpdate = false; mesh.name = 'grass';
  scene.add(mesh); Object.assign(GRASS, { on: true, mesh, n: G * G, SP, HALF });
}
const clampN = v => v < 0 ? 0 : v > 1 ? 1 : v;

// every frame: snap the grid to the camera, shifted ahead of it (little of the field is ever behind you); pushers = [{x, z, r}]
const fw = new THREE.Vector3();
export function grassFrame(camera, pushers, show = true) {
  if (!GRASS.on) return; const M = GRASS.mesh; M.visible = show; if (!show) return;
  camera.getWorldPosition(fw); const cx = fw.x, cy = fw.y, cz = fw.z; camera.getWorldDirection(fw);
  const l = Math.hypot(fw.x, fw.z) || 1, ahead = GRASS.HALF * .4;
  C.value.set(Math.floor((cx + fw.x / l * ahead) / GRASS.SP), Math.floor((cz + fw.z / l * ahead) / GRASS.SP)); CAM.value.set(cx, cy, cz);
  const a = pushers[0], b = pushers[1];
  if (a) P1.value.set(a.x, a.z, a.r); else P1.value.z = -1;
  if (b) P2.value.set(b.x, b.z, b.r); else P2.value.z = -1;
}
