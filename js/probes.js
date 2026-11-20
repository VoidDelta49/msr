// Light probe grid (12.40): local bounce light for the bike from a sparse 3D grid of order-1 spherical-harmonic probes.
// Headless (only three's Vector3, no DOM / renderer): node tools/probes.mjs. Drawing + the game glue are probefig.js.
//
// What a probe holds. Four RGB coefficients, already convolved with the cosine lobe and divided by pi, so the shader's whole job is
//   light(n) = max(0, shAmbient + shX * n.x + shY * n.y + shZ * n.z)          (n = world normal, 3 multiply-adds per vertex)
// and the result is "albedo x light" like any diffuse term. With the band-1 SH basis Y00 = 0.282095, Y1m = 0.488603 * (y, z, x)
// and the irradiance kernel A0 = pi, A1 = 2pi/3 (Ramamoorthi & Hanrahan 2001):
//   shAmbient = Y00^2 * Integral L dw            = mean radiance          (a uniform environment of radiance L gives light = L)
//   shX       = (2/3) Y1^2 * Integral L x dw     = (1 / 2pi) Integral L x dw     (same for y, z)
// For N directions spread evenly over the sphere (dw = 4pi / N) that is shAmbient = sum(L) / N and shX = 2 sum(L x) / N: see project().
// A white sky over a black ground gives shAmbient = .5, shY = .5: light(up) = 1, light(down) = 0, exactly the hemisphere irradiance.
// Plus one number that is not SH: vis = how much of the sky the probe sees (cosine weighted, 0 in a tunnel .. 1 in the open). The game
// already lights the bike with the open sky (hemisphere light + IBL), so a probe is the LOCAL CHANGE to that: vis takes the blocked sky
// away (probefig.js feeds it to the material's ambient occlusion) and the SH adds the light coming off whatever blocks it (canyon rock,
// canopy, tunnel lamps, neon). A probe of zeros with vis 1 changes nothing: that is FALLBACK, what an empty cell reads as.
//
// Grid. A uniform lattice (gridOrigin, cellSize, dimensions) stored sparsely: only the cells that have a probe are in a Map, so a whole
// island's index space costs nothing until probes are baked into it (probefig.js streams them in round the bike and evicts far ones;
// evicted probes go back to a pool, so streaming allocates nothing once warm). With groundFn the y axis is height above the ground
// (terrain-following layers): two layers cover a bike anywhere on hilly terrain, where absolute heights would need dozens.
//
// Per frame: update(pos) throttles the 8-probe trilinear lookup (only after the bike has moved moveEps metres, at most every `every`
// frames, or when probes changed) and eases the published `light` toward the newest sample, so a throttled lookup never pops.
// No allocation in update / sampleAt: every vector is created once.
import { Vector3 } from 'three';

const pmod = (a, n) => ((a % n) + n) % n;
export const mkProbe = () => ({ shAmbient: new Vector3(), shX: new Vector3(), shY: new Vector3(), shZ: new Vector3(), vis: 1 });
export const FALLBACK = Object.freeze(mkProbe()); // empty cell: no extra light, full sky (frozen object; its vectors are never written)
function copyProbe(o, p) { o.shAmbient.copy(p.shAmbient); o.shX.copy(p.shX); o.shY.copy(p.shY); o.shZ.copy(p.shZ); o.vis = p.vis; return o; }
function zeroProbe(o) { o.shAmbient.set(0, 0, 0); o.shX.set(0, 0, 0); o.shY.set(0, 0, 0); o.shZ.set(0, 0, 0); o.vis = 1; return o; }
function addScaled(o, p, w) { o.shAmbient.addScaledVector(p.shAmbient, w); o.shX.addScaledVector(p.shX, w); o.shY.addScaledVector(p.shY, w); o.shZ.addScaledVector(p.shZ, w); o.vis += p.vis * w; }
// light a probe gives a surface facing n (the shader's formula, for tools and the debug spheres): out = max(0, a + x nx + y ny + z nz)
export function evalSH(p, nx, ny, nz, out) {
  return out.copy(p.shAmbient).addScaledVector(p.shX, nx).addScaledVector(p.shY, ny).addScaledVector(p.shZ, nz).max(ZERO);
}
const ZERO = new Vector3();

// N directions spread evenly over the sphere (Fibonacci lattice), flat [x, y, z, ...]. Made once per count and shared.
const DIRS = new Map();
export function sphereDirs(n = 48) {
  let d = DIRS.get(n); if (d) return d; d = new Float32Array(n * 3); const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (i + .5) * 2 / n, r = Math.sqrt(1 - y * y), a = i * ga; d[i * 3] = Math.cos(a) * r; d[i * 3 + 1] = y; d[i * 3 + 2] = Math.sin(a) * r; }
  DIRS.set(n, d); return d;
}
// Project an environment into a probe. env(x, y, z, dx, dy, dz, out) writes the radiance arriving at (x, y, z) FROM direction d into
// `out` (a Vector3 used as RGB) and returns how much of that direction is open sky (0..1). Upward directions' sky values, cosine
// weighted, give vis. This is all an offline baker has to do too (with ray casts behind env), so baked JSON and procedural agree.
const CL = new Vector3();
export function project(p, x, y, z, env, n = 48) {
  const D = sphereDirs(n); zeroProbe(p); let sky = 0, cw = 0;
  for (let i = 0; i < n; i++) {
    const dx = D[i * 3], dy = D[i * 3 + 1], dz = D[i * 3 + 2]; CL.set(0, 0, 0); const s = env(x, y, z, dx, dy, dz, CL);
    p.shAmbient.add(CL); p.shX.addScaledVector(CL, dx); p.shY.addScaledVector(CL, dy); p.shZ.addScaledVector(CL, dz);
    if (dy > 0) { sky += (s ?? 1) * dy; cw += dy; }
  }
  p.shAmbient.multiplyScalar(1 / n); p.shX.multiplyScalar(2 / n); p.shY.multiplyScalar(2 / n); p.shZ.multiplyScalar(2 / n); p.vis = cw ? sky / cw : 1;
  return p;
}

export class LightProbeGrid {
  // gridOrigin: world position of probe (0, 0, 0) (with groundFn its y is the height above ground of layer 0); cellSize: metres between
  // probes, a number or {x, y, z}; dimensions: probe count per axis {x, y, z}; groundFn(x, z): ground height, makes y terrain-following.
  // relative: true when the probes are in units of the current sky light (probefig.js then scales them with it; false = absolute,
  // like lamps and neon that do not follow the sun).
  constructor({ gridOrigin = new Vector3(), cellSize = 4, dimensions = { x: 1, y: 1, z: 1 }, groundFn = null, relative = false } = {}) {
    this.gridOrigin = new Vector3().copy(gridOrigin);
    this.cellSize = typeof cellSize === 'number' ? new Vector3(cellSize, cellSize, cellSize) : new Vector3(cellSize.x, cellSize.y, cellSize.z);
    this.dimensions = { x: Math.max(1, dimensions.x | 0), y: Math.max(1, dimensions.y | 0), z: Math.max(1, dimensions.z | 0) };
    this.groundFn = groundFn; this.relative = relative;
    this.probes = new Map(); // cell index -> probe (sparse)
    this.pool = [];          // evicted probes, reused by ensure()
    this.version = 0;        // bumps on every add / remove / bake: update() resamples, the debug view rebuilds
    // throttle (update): resample after moveEps m of travel, but at most every `every` frames; ease the published light at `ease` per frame
    this.moveEps = .75; this.every = 3; this.ease = .25;
    this.sample = mkProbe();  // newest trilinear lookup
    this.light = mkProbe();   // eased: what the shader gets
    this._last = new Vector3(Infinity, 0, 0); this._frame = 0; this._at = -1e9; this._ver = -1;
  }
  get size() { return this.probes.size; }
  inside(i, j, k) { const d = this.dimensions; return i >= 0 && j >= 0 && k >= 0 && i < d.x && j < d.y && k < d.z; }
  index(i, j, k) { const d = this.dimensions; return i + d.x * (j + d.y * k); }
  cellOf(idx, out) { const d = this.dimensions; out.x = idx % d.x; out.y = Math.floor(idx / d.x) % d.y; out.z = Math.floor(idx / (d.x * d.y)); return out; }
  get(i, j, k) { return this.inside(i, j, k) ? this.probes.get(this.index(i, j, k)) || null : null; }
  // the probe at a cell, made (or taken from the pool) if it is missing. Returns null outside the grid.
  ensure(i, j, k) {
    if (!this.inside(i, j, k)) return null; const id = this.index(i, j, k); let p = this.probes.get(id);
    if (!p) { p = zeroProbe(this.pool.pop() || mkProbe()); this.probes.set(id, p); this.version++; } return p;
  }
  set(i, j, k, src) { const p = this.ensure(i, j, k); if (p) { copyProbe(p, src); this.version++; } return p; }
  remove(i, j, k) { return this.inside(i, j, k) && this.removeIndex(this.index(i, j, k)); }
  removeIndex(id) { const p = this.probes.get(id); if (!p) return false; this.probes.delete(id); this.pool.push(p); this.version++; return true; }
  clear() { for (const p of this.probes.values()) this.pool.push(p); this.probes.clear(); this.version++; }
  // world position of a cell's probe (with groundFn: on the terrain under it plus the layer height)
  probeWorldPos(i, j, k, out) {
    const o = this.gridOrigin, c = this.cellSize; out.set(o.x + i * c.x, o.y + j * c.y, o.z + k * c.z);
    if (this.groundFn) out.y += this.groundFn(out.x, out.z); return out;
  }
  // fractional cell coordinates of a world point (y above ground when terrain-following)
  _local(pos, out) {
    const o = this.gridOrigin, c = this.cellSize, y = this.groundFn ? pos.y - this.groundFn(pos.x, pos.z) : pos.y;
    return out.set((pos.x - o.x) / c.x, (y - o.y) / c.y, (pos.z - o.z) / c.z);
  }
  // Trilinear blend of the 8 probes round pos into out (a probe object). Outside the grid the edge probes hold (clamped); a missing
  // probe counts as FALLBACK, so light fades smoothly out to nothing at the edge of the baked area instead of jumping.
  sampleAt(pos, out = this.sample) {
    const f = this._local(pos, T0), d = this.dimensions; zeroProbe(out); out.vis = 0;
    const cx = Math.min(Math.max(f.x, 0), d.x - 1), cy = Math.min(Math.max(f.y, 0), d.y - 1), cz = Math.min(Math.max(f.z, 0), d.z - 1);
    const i0 = Math.min(Math.floor(cx), d.x - 2 < 0 ? 0 : d.x - 2), j0 = Math.min(Math.floor(cy), d.y - 2 < 0 ? 0 : d.y - 2), k0 = Math.min(Math.floor(cz), d.z - 2 < 0 ? 0 : d.z - 2);
    const tx = cx - i0, ty = cy - j0, tz = cz - k0;
    for (let c = 0; c < 8; c++) {
      const di = c & 1, dj = (c >> 1) & 1, dk = c >> 2, w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz); if (w <= 0) continue;
      addScaled(out, this.get(i0 + di, j0 + dj, k0 + dk) || FALLBACK, w);
    }
    return out;
  }
  // Per frame. Returns this.light (eased), resampling only when needed. force: resample now (teleports, bike switch).
  update(pos, force = false) {
    const f = ++this._frame, moved = this._last.distanceToSquared(pos) > this.moveEps * this.moveEps, changed = this._ver !== this.version;
    if (force || ((moved || changed) && f - this._at >= this.every)) { this.sampleAt(pos, this.sample); this._last.copy(pos); this._at = f; this._ver = this.version; }
    if (force) copyProbe(this.light, this.sample);
    else { const L = this.light, S = this.sample, e = this.ease; L.shAmbient.lerp(S.shAmbient, e); L.shX.lerp(S.shX, e); L.shY.lerp(S.shY, e); L.shZ.lerp(S.shZ, e); L.vis += (S.vis - L.vis) * e; }
    return this.light;
  }
  // bake one cell from an environment function (see project()); used by generateProcedural and by streaming bakers
  bakeCell(i, j, k, env, n = 48) {
    const p = this.ensure(i, j, k); if (!p) return null; this.probeWorldPos(i, j, k, T1); project(p, T1.x, T1.y, T1.z, env, n); this.version++; return p;
  }
  // Fill the grid procedurally: every cell (or only those where where(x, y, z) is true: sparse) from env(x, y, z, dx, dy, dz, out).
  generateProcedural(env, { where = null, dirs = 48 } = {}) {
    const d = this.dimensions;
    for (let k = 0; k < d.z; k++) for (let j = 0; j < d.y; j++) for (let i = 0; i < d.x; i++) {
      if (where) { this.probeWorldPos(i, j, k, T1); if (!where(T1.x, T1.y, T1.z)) { this.remove(i, j, k); continue; } }
      this.bakeCell(i, j, k, env, dirs);
    }
    return this;
  }
  // Offline baker format (plain JSON): { origin [x, y, z], cell [x, y, z], dims [x, y, z], ground: bool, relative: bool,
  // probes: [[index, ar, ag, ab, xr, xg, xb, yr, yg, yb, zr, zg, zb, vis], ...] } with index = i + dims.x * (j + dims.y * k).
  toJSON() {
    const o = this.gridOrigin, c = this.cellSize, d = this.dimensions, r = v => Math.round(v * 1e4) / 1e4, P = [];
    for (const [id, p] of this.probes) P.push([id, ...[p.shAmbient, p.shX, p.shY, p.shZ].flatMap(v => [r(v.x), r(v.y), r(v.z)]), r(p.vis)]);
    return { origin: [o.x, o.y, o.z], cell: [c.x, c.y, c.z], dims: [d.x, d.y, d.z], ground: !!this.groundFn, relative: this.relative, probes: P };
  }
  static fromJSON(j, groundFn = null) {
    const g = new LightProbeGrid({ gridOrigin: new Vector3(...j.origin), cellSize: { x: j.cell[0], y: j.cell[1], z: j.cell[2] }, dimensions: { x: j.dims[0], y: j.dims[1], z: j.dims[2] }, groundFn: j.ground ? groundFn : null, relative: !!j.relative });
    for (const a of j.probes || []) {
      const p = g.ensure(...Object.values(g.cellOf(a[0], { x: 0, y: 0, z: 0 }))); if (!p) continue;
      p.shAmbient.set(a[1], a[2], a[3]); p.shX.set(a[4], a[5], a[6]); p.shY.set(a[7], a[8], a[9]); p.shZ.set(a[10], a[11], a[12]); p.vis = a[13] ?? 1;
    }
    return g;
  }
}
const T0 = new Vector3(), T1 = new Vector3();

// ---------- demo biomes ----------
// Sample environments to try the system before a real baker exists (probefig.js: ?probes=demo). Radiance in the scene's linear units,
// as seen from the bike; every one is a local change to the open sky (the sky itself is 0 here: the game's sky light already has it).
const sky = (out, dy, open) => { out.set(0, 0, 0); return open; };
export const BIOMES = {
  // road tunnel: no sky, sodium lamps in the ceiling, lamp-lit concrete walls, dark asphalt
  tunnel: (x, y, z, dx, dy, dz, o) => { if (dy > .75) o.set(2.2, 1.15, .35); else if (dy > -.2) o.set(.16, .13, .1); else o.set(.05, .045, .04); return 0; },
  // slot canyon: a strip of sky overhead, sun-warmed sandstone walls on both sides
  canyon: (x, y, z, dx, dy, dz, o) => { if (dy > .8) return sky(o, dy, 1); const k = .55 + .45 * Math.max(0, dx); o.set(.62 * k, .32 * k, .17 * k); return 0; },
  // forest: green light through the canopy, a few gaps of sky, mossy ground
  forest: (x, y, z, dx, dy, dz, o) => { if (dy > .25) { const gap = Math.sin(dx * 9.1) * Math.cos(dz * 7.3) > .55; if (gap) return sky(o, dy, 1); o.set(.1, .24, .07); return 0; } if (dy > -.15) o.set(.06, .1, .04); else o.set(.07, .09, .04); return 0; },
  // neon street: magenta signs on one side, cyan on the other, most of the sky open
  neon: (x, y, z, dx, dy, dz, o) => { if (dy > .45) return sky(o, dy, 1); if (dx > .35) o.set(1.6, .2, 1.1).multiplyScalar(dx); else if (dx < -.35) o.set(.15, 1.1, 1.5).multiplyScalar(-dx); else o.set(.04, .03, .06); return dy > 0 ? .3 : 0; },
};
export const BIOME_KEYS = Object.keys(BIOMES);
// which demo biome a point is in: a checkerboard of `size` m squares, so riding in any direction crosses them all
export const biomeAt = (x, z, size = 60) => BIOME_KEYS[pmod(Math.floor(x / size) + 2 * Math.floor(z / size), BIOME_KEYS.length)];
// A ready-made demo grid round a centre (x, z): span m square, cell m apart, `layers` terrain-following layers 4 m apart.
// Squares blend over a cell at their edges because the lookup is trilinear: you ride from canyon light into neon over ~one cell.
export function demoGrid(cx, cz, { span = 480, cell = 8, layers = 2, size = 60, groundFn = null } = {}) {
  const n = Math.round(span / cell) + 1, g = new LightProbeGrid({ gridOrigin: new Vector3(cx - span / 2, .8, cz - span / 2), cellSize: { x: cell, y: 4, z: cell }, dimensions: { x: n, y: layers, z: n }, groundFn });
  return g.generateProcedural((x, y, z, dx, dy, dz, o) => BIOMES[biomeAt(x, z, size)](x, y, z, dx, dy, dz, o), { dirs: 32 });
}
