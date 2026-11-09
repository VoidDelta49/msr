// Headless roads + terrain for a map (no three, no DOM): the game's real js/roads.js splines on the real terrain block of js/world.js
// (between the // @terrain-begin / -end markers). Used by tools/roads.mjs and maker/city-gen.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.addEventListener ??= () => { }; // js/util.js touches it at import time
const U = await import(pathToFileURL(path.join(ROOT, 'js/util.js')).href), { buildRoads } = await import(pathToFileURL(path.join(ROOT, 'js/roads.js')).href);
export function terrainOf(MD) {
  const src = readFileSync(path.join(ROOT, 'js/world.js'), 'utf8'), b = src.indexOf('// @terrain-begin'), e = src.indexOf('// @terrain-end');
  if (b < 0 || e < b) throw new Error('the // @terrain-begin / // @terrain-end markers are missing from js/world.js');
  return new Function('MD', 'PI', 'clamp', 'sstep', 'fbm', 'rand', 'hash2', 'addOBB', src.slice(b, e) + '\nreturn { terrBase, terr, carve: () => lastCarve, CR, ICX, ICZ, ISL, GX, GZ, TSZ };')(MD, U.PI, U.clamp, U.sstep, U.fbm, U.rand, U.hash2, () => { });
}
export function groundOf(MD) { const TB = terrainOf(MD); return { TB, ...buildRoads(MD, TB.terrBase) }; }
// Building footprints (w x d) by type, as world.js builds them (BD there; house / nipa / shop have their own builders).
// Types not listed (church, plaza, market, gas, lot, park, landmarks that find their own ground) are skipped.
export const FOOT = { bar: [12, 11], house2: [8, 9], bahay: [8.5, 8.5], bunga: [9, 7.5], sari: [4.4, 5], chapel: [6.4, 12], lighthouse: [7, 7], warehouse: [13, 26], stall: [4.4, 3.4], cottage: [5.6, 5.6], resort: [24, 12], tower: [20, 20], rest: [11, 6], house: [7, 7], nipa: [4.5, 4.2], shop: [8, 9.5] };
// How far a building [type, x, z, ry, w, d] reaches into a road surface, in metres (<= 0: clear), sampled over its footprint
// (front = +z rotated by ry, as in world.js). Bridge decks well above the ground don't count (houses may stand under a bridge).
export function intoRoad(nearRoad, terr, B) {
  const [t, x, z, ry = 0] = B, D = FOOT[t]; if (!D) return { by: -1e9 }; const w = B[4] || D[0], d = B[5] || D[1]; let by = -1e9, at = null;
  for (let a = -1; a <= 1.001; a += .25) for (let c = -1; c <= 1.001; c += .25) {
    const lx = a * w / 2, lz = c * d / 2, px = x + Math.cos(ry) * lx + Math.sin(ry) * lz, pz = z - Math.sin(ry) * lx + Math.cos(ry) * lz, q = nearRoad(px, pz);
    if (!q || q.br && q.h - terr(px, pz) > 6) continue; const m = q.w / 2 - q.d; if (m > by) { by = m; at = [px, pz] }
  }
  return { by, at };
}
