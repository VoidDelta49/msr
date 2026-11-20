// Ilalim's light, baked (13.0). Headless (no DOM / renderer; three only through probes.js' Vector3): node tools/cavebake.mjs.
// underfig.js draws the result. Baked once, the first time you go down (undergo.js, under the black veil), never per frame.
//
// What is baked. The cave's lights are emitters in a list: show-cave lamps, crystal clusters, the glowing pool, the glowworm ceilings
// (layer 0, always on) and the daylight at the mouth and down the shaft (layer 1, scaled by the time of day in the shader: UGDAY).
// 1) Direct: per cell of the cave's 1.5 m grid, for the floor and the ceiling surface (their normals from the height fields), the
//    irradiance from every emitter in reach: I cos / d^2 with a smooth range window, an optional spot lobe, and a visibility ray
//    marched through the height fields (a sample under the floor or over the ceiling is rock; floor and ceiling meet at the walls, so
//    that test alone is a closed shell).
// 2) One bounce: radiosity B = albedo x direct of both surfaces, blurred over the chamber scale (two box passes ~5 m, only over cave
//    cells), and handed across: the floor gets what the ceiling and walls send down, the ceiling what the floor sends up. Times 1.3
//    for the further bounces a single pass misses.
// 3) Probes for whatever moves (the bike, the rider): a LightProbeGrid (probes.js) of order-1 SH over the open cave, 4 m apart, two
//    floor-following layers. Each probe marches 32 rays to the shell and takes the baked radiance (B / pi) where they hit, plus the
//    emitters in reach directly (as small sources). One grid per layer; probefig.js mixes them with the daylight.
// 4) at(x, y, z): the light for a prop (stalagmite, column, lamp post) as one colour, no normal (half the direct, all the bounce).
// The shader side is one multiply-add: emissive = albedo x (L0 + L1 x day): the rock never sees a real light down there.
import { LightProbeGrid, sphereDirs } from './probes.js';
import { Vector3 } from 'three';

export const CAVEK = { bounce: 1.3, blur: 3, dirs: 32, cell: 4, layers: 2, layerH: 2.2, y0: .9, reach: 40 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The cave's height-field grid (same sampling underfig.js draws): E open-ness, FL floor, CE ceiling, LK lake, K chamber, valid cells.
export function caveGrid(U, st = 1.5) {
  const { BOX } = U, NX = Math.ceil((BOX.x1 - BOX.x0) / st) + 1, NZ = Math.ceil((BOX.z1 - BOX.z0) / st) + 1, n = NX * NZ;
  const E = new Float32Array(n), FL = new Float32Array(n), CE = new Float32Array(n), K = new Array(n), LK = new Float32Array(n), ok = new Uint8Array(n);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = BOX.x0 + i * st, z = BOX.z0 + j * st, r = U.sampleL(x, z); E[k] = r.e; if (r.e < U.KEEP - 1.5) continue;
    const rr = { ...r }; K[k] = r.k; LK[k] = r.lake; FL[k] = U.floorL(x, z, rr); CE[k] = U.ceilL(x, z, rr); ok[k] = 1;
  }
  return { st, NX, NZ, x0: BOX.x0, z0: BOX.z0, ox: U.ox, oz: U.oz, E, FL, CE, K, LK, ok };
}
// normal of the floor (up) or the ceiling (down) at cell (i, j), into o[0..2]
function normalAt(G, A, i, j, ceil, o) {
  const { NX, NZ, st } = G, g = (ii, jj) => A[Math.max(0, Math.min(NZ - 1, jj)) * NX + Math.max(0, Math.min(NX - 1, ii))];
  const dx = (g(i + 1, j) - g(i - 1, j)) / (2 * st), dz = (g(i, j + 1) - g(i, j - 1)) / (2 * st), nl = Math.hypot(dx, 1, dz);
  if (ceil) { o[0] = dx / nl; o[1] = -1 / nl; o[2] = dz / nl; } else { o[0] = -dx / nl; o[1] = 1 / nl; o[2] = -dz / nl; }
  return o;
}
// is the straight line a -> b (local coordinates) inside the cave? Skips `s0` m at a (a surface point: its own cell is at the wall)
function clear(G, ax, ay, az, bx, by, bz, s0 = 1) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz), n = Math.ceil((d - s0 - .4) / .7);
  const { NX, NZ, st, x0, z0, FL, CE, ok } = G;
  for (let s = 0; s < n; s++) {
    const t = (s0 + s * .7) / d, x = ax + dx * t, y = ay + dy * t, z = az + dz * t, i = Math.round((x - x0) / st), j = Math.round((z - z0) / st);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return false; const k = j * NX + i;
    if (!ok[k] || y < FL[k] - .25 || y > CE[k] + .25) return false;
  }
  return true;
}
// emitter -> irradiance at a point (local) with normal n (null: no cos term), into out[0..2] (added). Returns 0 when out of reach.
function lightAt(G, L, px, py, pz, n, out, s0) {
  const vx = L.lx - px, vy = L.y - py, vz = L.lz - pz, d2 = vx * vx + vy * vy + vz * vz; if (d2 > L.R * L.R) return 0;
  const d = Math.sqrt(d2) || 1e-3; let c = n ? (n[0] * vx + n[1] * vy + n[2] * vz) / d : .5; if (c <= 0) return 0;
  if (L.dir) { const sp = -(L.dir[0] * vx + L.dir[1] * vy + L.dir[2] * vz) / d; const a = L.amb ?? .2; c *= a + (1 - a) * Math.max(0, sp); if (c <= 0) return 0; }
  const w = 1 - (d2 / (L.R * L.R)) ** 2, e = L.I * c * w * w / (d2 + .5); if (e < 1e-4) return 0;
  if (!clear(G, px, py, pz, L.lx, L.y, L.lz, s0)) return 0;
  out[0] += e * L.c[0]; out[1] += e * L.c[1]; out[2] += e * L.c[2]; return e;
}
// lights in reach of a point: a hash of 20 m cells for the small ones, the big ones (R > 20) always checked
function lightHash(G, lights) {
  const H = new Map(), big = [], key = (i, k) => i * 7919 + k * 104729;
  for (const L of lights) { L.lx = L.x - G.ox; L.lz = L.z - G.oz; if (L.R > 20) { big.push(L); continue; } const k = key(Math.floor(L.lx / 20), Math.floor(L.lz / 20)); let a = H.get(k); if (!a) H.set(k, a = []); a.push(L); }
  const near = [];
  return (x, z) => { near.length = 0; for (const L of big) near.push(L); const i0 = Math.floor(x / 20), k0 = Math.floor(z / 20); for (let k = k0 - 1; k <= k0 + 1; k++) for (let i = i0 - 1; i <= i0 + 1; i++) { const a = H.get(key(i, k)); if (a) for (const L of a) near.push(L); } return near; };
}
// separable box blur of an rgb field over valid cells (normalised by how many valid cells were summed)
function blur(G, src, r) {
  const { NX, NZ, ok } = G, n = NX * NZ, a = new Float32Array(n * 3), b = new Float32Array(n * 3), wa = new Float32Array(n);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { let s0 = 0, s1 = 0, s2 = 0, w = 0; for (let q = -r; q <= r; q++) { const ii = i + q; if (ii < 0 || ii >= NX) continue; const k = j * NX + ii; if (!ok[k]) continue; s0 += src[k * 3]; s1 += src[k * 3 + 1]; s2 += src[k * 3 + 2]; w++; } const k = j * NX + i; a[k * 3] = s0; a[k * 3 + 1] = s1; a[k * 3 + 2] = s2; wa[k] = w; }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { let s0 = 0, s1 = 0, s2 = 0, w = 0; for (let q = -r; q <= r; q++) { const jj = j + q; if (jj < 0 || jj >= NZ) continue; const k = jj * NX + i; s0 += a[k * 3]; s1 += a[k * 3 + 1]; s2 += a[k * 3 + 2]; w += wa[k]; } const k = j * NX + i; if (w) { b[k * 3] = s0 / w; b[k * 3 + 1] = s1 / w; b[k * 3 + 2] = s2 / w; } }
  return b;
}

// Bake. G = caveGrid(U); lights = [{ x, y, z (world), c: [r, g, b], I, R, layer: 0 | 1, dir?: [x, y, z] (spot axis), amb?: 0..1 }];
// alb(k, ceil, out) = the albedo of cell k's floor / ceiling (the vertex colour underfig.js gives it).
// Returns { F: [layer0, layer1], C: [...] } (Float32Array rgb per cell: irradiance of the floor / ceiling, direct + bounce), at(), probes.
export function bakeCave(G, lights, alb, { probes = true, U = null } = {}) {
  const t0 = Date.now(), { NX, NZ, st, x0, z0, FL, CE, ok } = G, n = NX * NZ, near = lightHash(G, lights), nrm = [0, 0, 0], ac = [0, 0, 0];
  const F = [new Float32Array(n * 3), new Float32Array(n * 3)], C = [new Float32Array(n * 3), new Float32Array(n * 3)], AF = new Float32Array(n * 3), AC = new Float32Array(n * 3);
  const tmp = [0, 0, 0];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i; if (!ok[k]) continue; const x = x0 + i * st, z = z0 + j * st, ls = near(x, z);
    alb(k, false, ac); AF.set(ac, k * 3); alb(k, true, ac); AC.set(ac, k * 3);
    for (const ceil of [false, true]) {
      normalAt(G, ceil ? CE : FL, i, j, ceil, nrm); const y = (ceil ? CE[k] : FL[k]) + nrm[1] * .15, px = x + nrm[0] * .15, pz = z + nrm[2] * .15;
      for (const L of ls) { tmp[0] = tmp[1] = tmp[2] = 0; if (!lightAt(G, L, px, y, pz, nrm, tmp, 1.1)) continue; const o = (ceil ? C : F)[L.layer | 0]; o[k * 3] += tmp[0]; o[k * 3 + 1] += tmp[1]; o[k * 3 + 2] += tmp[2]; }
    }
  }
  // one bounce, per layer: what the ceiling + walls send down to the floor, what the floor sends up
  const BF = [], BC = [];
  for (let l = 0; l < 2; l++) {
    const up = new Float32Array(n * 3), dn = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) { const bf = AF[k * 3 + c] * F[l][k * 3 + c], bc = AC[k * 3 + c] * C[l][k * 3 + c]; dn[k * 3 + c] = .35 * bf + .65 * bc; up[k * 3 + c] = .65 * bf + .35 * bc; }
    let a = blur(G, dn, CAVEK.blur); a = blur(G, a, CAVEK.blur); let b = blur(G, up, CAVEK.blur); b = blur(G, b, CAVEK.blur);
    BF.push(a); BC.push(b);
    for (let k = 0; k < n * 3; k++) { F[l][k] += a[k] * CAVEK.bounce; C[l][k] += b[k] * CAVEK.bounce; }
  }
  const cellOf = (lx, lz) => { const i = Math.round((lx - x0) / st), j = Math.round((lz - z0) / st); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i; };
  // a prop's light (world point): half the direct (no normal), plus the bounce of the floor and ceiling round it
  function at(wx, wy, wz, out) {
    const lx = wx - G.ox, lz = wz - G.oz, k = cellOf(lx, lz); for (let q = 0; q < 6; q++) out[q] = 0; if (k < 0) return out;
    for (const L of near(lx, lz)) { tmp[0] = tmp[1] = tmp[2] = 0; if (lightAt(G, L, lx, wy, lz, null, tmp, .6)) { const o = (L.layer | 0) * 3; out[o] += tmp[0]; out[o + 1] += tmp[1]; out[o + 2] += tmp[2]; } }
    for (let l = 0; l < 2; l++) for (let c = 0; c < 3; c++) out[l * 3 + c] += (BF[l][k * 3 + c] + BC[l][k * 3 + c]) * .5 * CAVEK.bounce;
    return out;
  }
  const res = { F, C, at, ms: 0, probes: null };
  if (probes && U) res.probes = bakeProbes(G, U, near, F, C, AF, AC, cellOf);
  res.ms = Date.now() - t0; return res;
}

// Probe grids (layer 0, layer 1) over the open cave: radiance of the baked shell along 32 rays + the emitters as small sources.
function bakeProbes(G, U, near, F, C, AF, AC, cellOf) {
  const { NX, NZ, st, x0, z0, FL, CE, ok, E } = G, cs = CAVEK.cell, D = sphereDirs(CAVEK.dirs), N = CAVEK.dirs;
  const nx = Math.ceil((NX - 1) * st / cs) + 1, nz = Math.ceil((NZ - 1) * st / cs) + 1, floorW = (x, z) => U.floor(x, z);
  const mkG = () => new LightProbeGrid({ gridOrigin: new Vector3(G.ox + x0, CAVEK.y0, G.oz + z0), cellSize: { x: cs, y: CAVEK.layerH, z: cs }, dimensions: { x: nx, y: CAVEK.layers, z: nz }, groundFn: floorW, relative: false });
  const g0 = mkG(), g1 = mkG(), P = new Vector3(), L = [[0, 0, 0], [0, 0, 0]], tmp = [0, 0, 0];
  let count = 0;
  for (let kz = 0; kz < nz; kz++) for (let ix = 0; ix < nx; ix++) {
    const lx = x0 + ix * cs, lz = z0 + kz * cs, k0 = cellOf(lx, lz); if (k0 < 0 || !ok[k0] || E[k0] < .6) continue;
    for (let jy = 0; jy < CAVEK.layers; jy++) {
      g0.probeWorldPos(ix, jy, kz, P); const py = P.y; if (py > CE[k0] - .4) continue;
      const p0 = g0.ensure(ix, jy, kz), p1 = g1.ensure(ix, jy, kz); count++;
      for (let r = 0; r < N; r++) {
        const dx = D[r * 3], dy = D[r * 3 + 1], dz = D[r * 3 + 2]; L[0][0] = L[0][1] = L[0][2] = L[1][0] = L[1][1] = L[1][2] = 0;
        for (let t = .7; t < CAVEK.reach; t += .7) { // march to the shell, take its baked radiance B / pi there
          const x = lx + dx * t, y = py + dy * t, z = lz + dz * t, k = cellOf(x, z); if (k < 0 || !ok[k]) break;
          const under = y < FL[k], over = y > CE[k]; if (!under && !over) continue;
          const A = under ? AF : AC, S = under ? F : C; for (let l = 0; l < 2; l++) for (let c = 0; c < 3; c++) L[l][c] = A[k * 3 + c] * S[l][k * 3 + c] / Math.PI;
          break;
        }
        for (let l = 0; l < 2; l++) { const p = l ? p1 : p0, v = L[l]; p.shAmbient.x += v[0]; p.shAmbient.y += v[1]; p.shAmbient.z += v[2]; p.shX.x += v[0] * dx; p.shX.y += v[1] * dx; p.shX.z += v[2] * dx; p.shY.x += v[0] * dy; p.shY.y += v[1] * dy; p.shY.z += v[2] * dy; p.shZ.x += v[0] * dz; p.shZ.y += v[1] * dz; p.shZ.z += v[2] * dz; }
      }
      for (const p of [p0, p1]) { p.shAmbient.multiplyScalar(1 / N); p.shX.multiplyScalar(2 / N); p.shY.multiplyScalar(2 / N); p.shZ.multiplyScalar(2 / N); p.vis = 1; }
      // emitters seen directly: a small source of irradiance e from direction v adds e / 4pi to the ambient and e v / 2pi to the band 1
      for (const Lt of near(lx, lz)) {
        tmp[0] = tmp[1] = tmp[2] = 0; const e = lightAt(G, Lt, lx, py, lz, null, tmp, .3); if (!e) continue;
        const vx = Lt.lx - lx, vy = Lt.y - py, vz = Lt.lz - lz, d = Math.hypot(vx, vy, vz) || 1, p = Lt.layer ? p1 : p0, s = 2; // tmp holds e / 2 (no normal): x2
        for (let c = 0; c < 3; c++) { const ec = tmp[c] * s, key = 'xyz'[c]; p.shAmbient[key] += ec / (4 * Math.PI); p.shX[key] += ec * vx / d / (2 * Math.PI); p.shY[key] += ec * vy / d / (2 * Math.PI); p.shZ[key] += ec * vz / d / (2 * Math.PI); }
      }
    }
  }
  g0.version++; g1.version++;
  return { g0, g1, count };
}
export const _clear = clear; // tools/cavebake.mjs
