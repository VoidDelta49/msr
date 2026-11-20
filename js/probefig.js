// Light probes in the game (12.40): the material hook, the island's streaming bake, the per-frame lookup and the debug spheres.
// The grid itself (storage, trilinear lookup, throttle, SH maths, demo biomes) is headless in probes.js.
//
// Material hook. The renderer is three's WebGPURenderer with node (TSL) materials, which never call onBeforeCompile, so the hook is
// TSL: probeLit(material) adds a VERTEX-stage term,
//   v_probeLight = knee(max(0, shAmbient + shX n.x + shY n.y + shZ n.z) * tint)      (n = world normal, varying(): vertex shader only)
// and the fragment shader only reads the interpolated varying: one multiply-add, diffuseColor.rgb * v_probeLight, added through
// emissiveNode. diffuseColor is the material's albedo after vertex colours, palette / livery and (1 - metalness), so the bounce
// takes the paint's colour, chrome gets none, and nothing reaches the specular lobe or the clearcoat: highlights stay as they were.
// knee() rolls very bright probes off (l / (1 + l / 3)) so a hot neon wall never flattens the paint to white. The probe's vis
// (open sky) goes to aoNode, which three applies to indirect light only (hemisphere light + IBL), so a tunnel takes the sky light
// away while the sun's direct light and its shadows are untouched. All of it is uniforms: no recompile when anything changes.
// Uniforms are per object (onObjectUpdate): a mesh with userData.pk = 1 (the local bike + rider, tagged in model.js buildModel)
// gets the grid's sample; everything else that shares these materials (friends' bikes, the walker) gets the neutral probe = exactly
// the old lighting.
//
// Modes (URL ?probes=...): world (default: probes baked from the real island round the bike as it rides), demo (the four sample
// biomes of probes.js on a checkerboard round the spawn), off. Add ",debug" (or call window.__cpm.probes.debug(true)) for the spheres.
import * as THREE from 'three';
import { uniform, varying, vec4, normalLocal, modelWorldMatrix, diffuseColor, materialEmissive } from 'three/tsl';
import { LightProbeGrid, FALLBACK, demoGrid, evalSH } from './probes.js';
import { scene, hemi, IBL } from './renderer.js';
import { ctx } from './state.js';

const Q = new URLSearchParams(location.search).get('probes') || '', MODE = /off/.test(Q) ? 'off' : /demo/.test(Q) ? 'demo' : 'world';
// SLOTS[userData.pk]: 0 = neutral (FALLBACK), 1 = the local bike (PROBE.light while on)
const SLOTS = [FALLBACK, FALLBACK], pick = o => SLOTS[o.userData.pk | 0] || FALLBACK;
const uv3 = k => uniform(new THREE.Vector3()).onObjectUpdate((f, u) => { u.value.copy(pick(f.object)[k]); });
const uA = uv3('shAmbient'), uX = uv3('shX'), uY = uv3('shY'), uZ = uv3('shZ'), uVis = uniform(1).onObjectUpdate(({ object }) => pick(object).vis);
const uTint = uniform(new THREE.Color(1, 1, 1)); // sky light level for relative grids (world), 1 for absolute ones (demo / baked lamps)
export const PROBE = { mode: MODE, grid: null, light: null, on: false, gain: 1, tint: uTint.value, debug: on => debug(on), stats: { baked: 0, live: 0 } };

// vertex stage: world normal (modelWorldMatrix is exact for the bike's uniform scale; normalLocal is already skinned for the swing arm)
const nW = modelWorldMatrix.mul(vec4(normalLocal, 0)).xyz.normalize();
const raw = uA.add(uX.mul(nW.x)).add(uY.mul(nW.y)).add(uZ.mul(nW.z)).max(0).mul(uTint);
const vProbe = varying(raw.div(raw.mul(1 / 3).add(1)), 'v_probeLight');
export function probeLit(m) {
  const add = diffuseColor.rgb.mul(vProbe);
  m.emissiveNode = (m.emissiveNode || materialEmissive).add(add);
  m.aoNode = m.aoNode ? m.aoNode.mul(uVis) : uVis;
  return m;
}

// ---------- island bake (world mode) ----------
// A probe sees: open sky above its horizon (already lit by the game's sky light: 0 here, counted in vis), rising terrain in front of
// that sky (canyon / valley walls: the ground's albedo lit by sun + sky), roadside buildings low down in towns, leaf canopy in the
// wild, and the ground below the horizontal (0: the hemisphere light's ground half already carries the local albedo, daynight.js).
// The horizon comes from marching the real terrain (H) in 8 directions; all in units of the sky light (relative grid: uTint).
let W = null; // { H, albedo, zones, nearRoad } from probeInit
const AZ = 8, DST = [3, 8, 16, 30, 55], HT = new Float32Array(AZ), HC = Array.from({ length: AZ }, () => new THREE.Color()), ZO = {}, tC = new THREE.Color();
const LIT = 1.4, LEAF = new THREE.Color(.09, .2, .06), WALL = new THREE.Color(.5, .46, .4);
let canopy = 0, town = 0;
function horizon(px, py, pz) {
  for (let a = 0; a < AZ; a++) {
    const ca = Math.cos(a * 2 * Math.PI / AZ), sa = Math.sin(a * 2 * Math.PI / AZ); let best = -1, bd = DST[0];
    for (let q = 0; q < DST.length; q++) { const d = DST[q], t = (W.H(px + ca * d, pz + sa * d) - py) / d; if (t > best) { best = t; bd = d; } }
    HT[a] = best; W.albedo(px + ca * bd, pz + sa * bd, HC[a]);
  }
  W.zones(px, pz, ZO); town = ZO.town || 0;
  const q = W.nearRoad && W.nearRoad(px, pz); canopy = (ZO.wild || 0) * .45 * (q && q.d < q.w / 2 + 4 ? .3 : 1); // 'wild' is all open country, not only forest: a light canopy, open over roads
}
function worldEnv(px, py, pz, dx, dy, dz, o) {
  if (dy <= 0) return 0; // ground: already in the hemisphere light
  const hz = Math.hypot(dx, dz) || 1e-6, tn = dy / hz, s = (Math.atan2(dz, dx) / (2 * Math.PI) * AZ + AZ) % AZ, a0 = Math.floor(s), a1 = (a0 + 1) % AZ, f = s - a0;
  const ht = HT[a0] + (HT[a1] - HT[a0]) * f;
  if (tn < ht) { tC.copy(HC[a0]).lerp(HC[a1], f); o.set(tC.r, tC.g, tC.b).multiplyScalar(LIT * (.55 + .45 * Math.max(0, dy))); return 0; } // terrain wall
  if (town > .3 && tn < .45) { const b = town * .7; o.set(WALL.r * b, WALL.g * b, WALL.b * b); return 1 - b; } // street walls
  if (canopy > 0 && dy > .3) { o.set(LEAF.r * canopy, LEAF.g * canopy, LEAF.b * canopy); return 1 - canopy; } // leaves
  return 1;
}
const RING = 3, EVICT = RING + 2, BUDGET = 4, OFF = []; // bake RING cells round the bike, nearest first, BUDGET probes a frame; drop past EVICT
for (let k = -RING; k <= RING; k++) for (let i = -RING; i <= RING; i++) OFF.push([i, k]); OFF.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
const P0 = new THREE.Vector3(), C0 = new THREE.Vector3(), CC = { x: 0, y: 0, z: 0 };
let ci = 0, ck = 0;
function evictFar(p, id) { PROBE.grid.cellOf(id, CC); if (Math.abs(CC.x - ci) > EVICT || Math.abs(CC.z - ck) > EVICT) PROBE.grid.removeIndex(id); }
function stream(g, frame) {
  g._local(P0, C0); ci = Math.round(C0.x); ck = Math.round(C0.z); let n = 0;
  for (let o = 0; o < OFF.length; o++) {
    const di = OFF[o][0], dk = OFF[o][1];
    for (let j = 0; j < g.dimensions.y; j++) {
      if (g.get(ci + di, j, ck + dk)) continue;
      g.probeWorldPos(ci + di, j, ck + dk, C0); horizon(C0.x, C0.y, C0.z); g.bakeCell(ci + di, j, ck + dk, worldEnv, 32); PROBE.stats.baked++;
      if (++n >= BUDGET) return;
    }
  }
  if (frame % 30 === 0) g.probes.forEach(evictFar);
}

// Called once from main.js with the world's functions (kept out of the imports: model.js imports this file before world.js loads).
// The grid is made on the first frame, so the demo checkerboard is centred where the bike really starts.
export function probeInit(world) { W = world; }
function mkGrid(x, z) {
  PROBE.grid = MODE === 'demo' ? demoGrid(x, z, { groundFn: W.H })
    : new LightProbeGrid({ gridOrigin: new THREE.Vector3(-4096, .8, -4096), cellSize: { x: 12, y: 4, z: 12 }, dimensions: { x: 684, y: 2, z: 684 }, groundFn: W.H, relative: true });
  PROBE.light = PROBE.grid.light; if (/debug/.test(Q)) debug(true);
}
// Per frame (main.js visuals), with the bike's position. Off in the garage studio, indoors and underground (those light themselves).
let frame = 0, was = false;
export function probeFrame(x, y, z) {
  if (!PROBE.grid && W && MODE !== 'off') mkGrid(x, z);
  const g = PROBE.grid; frame++;
  const on = !!g && !ctx.GAR && !ctx.inside && !(ctx.ug && ctx.ug.on); PROBE.on = on; SLOTS[1] = on ? g.light : FALLBACK;
  if (!on) { was = false; if (DBG) DBG.visible = false; return; }
  P0.set(x, y, z); if (!g.relative) uTint.value.setScalar(PROBE.gain);
  else uTint.value.copy(hemi.color).multiplyScalar(PROBE.gain * hemi.intensity / (IBL ? .6 : 1)); // daynight.js scales hemi by .6 under IBL
  if (MODE === 'world') stream(g, frame);
  g.update(P0, !was); was = true; PROBE.stats.live = g.size;
  if (DBG) { DBG.visible = true; if (g.version !== dbgVer && frame % 10 === 0) dbgFill(g); }
}

// ---------- debug spheres ----------
// One InstancedMesh, a small sphere per live probe at its world position, coloured by shAmbient (lifted so an empty probe still shows
// as a dark dot; a probe that blocks the sky turns darker blue-grey with its vis). Rebuilt only when the grid changes.
let DBG = null, dbgVer = -1;
const M4 = new THREE.Matrix4(), DC = new THREE.Color(), DP = new THREE.Vector3(), DV = new THREE.Vector3(), DCC = { x: 0, y: 0, z: 0 };
let dbgN = 0;
function dbgOne(p, id) {
  if (dbgN >= DBG.instanceMatrix.count) return; const g = PROBE.grid; g.cellOf(id, DCC); g.probeWorldPos(DCC.x, DCC.y, DCC.z, DP);
  DBG.setMatrixAt(dbgN, M4.makeTranslation(DP.x, DP.y, DP.z)); evalSH(p, 0, 0, 0, DV); // n = 0: shAmbient alone
  DC.setRGB(.06 + DV.x * 1.5, .06 + DV.y * 1.5, .08 + DV.z * 1.5).multiplyScalar(.4 + .6 * p.vis); DBG.setColorAt(dbgN++, DC);
}
function dbgFill(g) {
  if (g.size > DBG.instanceMatrix.count) { scene.remove(DBG); DBG.dispose(); mkDbg(g.size * 1.5 | 0); }
  dbgN = 0; g.probes.forEach(dbgOne); DBG.count = dbgN; DBG.instanceMatrix.needsUpdate = true; if (DBG.instanceColor) DBG.instanceColor.needsUpdate = true; dbgVer = g.version;
}
function mkDbg(cap) {
  DBG = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.22, 1), new THREE.MeshBasicNodeMaterial({ fog: false }), Math.max(64, cap));
  DBG.name = 'probeDebug'; DBG.frustumCulled = false; DBG.count = 0; DBG.instanceMatrix.setUsage(THREE.DynamicDrawUsage); DBG.setColorAt(0, DC); scene.add(DBG); dbgVer = -1;
}
function debug(on) {
  if (on && !DBG && PROBE.grid) mkDbg(PROBE.grid.size || 256);
  else if (!on && DBG) { scene.remove(DBG); DBG.geometry.dispose(); DBG.material.dispose(); DBG.dispose(); DBG = null; }
  return !!DBG;
}
