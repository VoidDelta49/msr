// Building interiors: the logic (pure: no three.js, no DOM, so tools/interior.mjs runs it headless). What is inside is data
// (data/interiors.json): an interior belongs to building types, and any front door of such a building (world.js DOORS) can be entered.
// The room is built as a "pocket" POCKET metres straight above its building, turned like the building: the minimap, the big map,
// the sun, the ambience and your friends all still place you at the building, and a friend inside the same pocket sees your walker
// (net.js) with no extra networking. While inside, the on-foot walker (foot.js) runs on the room's own ground and walls (footEnv),
// so walking, jumping and the camera work exactly as outside. js/interiorfig.js draws it; main.js switches in and out.
// Local frame: metres from the room's centre on the floor, x right as you come in, z toward the front door (front wall z = d / 2).
// World = pocket origin + local turned by ry, where the building's front faces (sin ry, cos ry) like every building in world.js.
import { newTable, left, moving } from './pool.js';
import { PC } from './pool.js';

export const IN = { D: null, P: null, cache: new Map() };
export function interiorEnv(D) { IN.D = D; IN.P = null; IN.cache.clear(); }
export const POCKET = () => (IN.D && IN.D.pocket) || 300;
// which interior a building type opens into ('' = none)
export function interiorFor(t) { if (!IN.D) return ''; for (const [id, I] of Object.entries(IN.D.interiors)) if ((I.at || []).includes(t)) return id; return ''; }

// collision footprints of the props (half sizes in the prop's frame); size-less props (signs, lamps, the tv) have none
const PROPBOX = { pool: () => [.75, 1.3], counter: p => [(p.w || 6) / 2, (p.d || .85) / 2], shelf: p => [(p.w || 6) / 2, .22], stool: () => [.19, .19], table: () => [.46, .46],
  chair: () => [.24, .24], jukebox: () => [.42, .3], plant: () => [.24, .24], rack: () => [.55, .08] };
export const PROPS = ['pool', 'counter', 'shelf', 'stool', 'table', 'chair', 'jukebox', 'rack', 'sign', 'board', 'plant', 'fan', 'tv']; // what interiorfig.js can draw

export function toW(P, x, z, o = {}) { o.x = P.ox + x * P.c + z * P.s; o.z = P.oz - x * P.s + z * P.c; return o; }
export function toL(P, x, z, o = {}) { const dx = x - P.ox, dz = z - P.oz; o.x = dx * P.c - dz * P.s; o.z = dx * P.s + dz * P.c; return o; }
const obb = (P, x, z, hx, hz, ry = 0) => { const w = toW(P, x, z), a = P.ry + ry; return { cx: w.x, cz: w.z, hx, hz, ry: a, c: Math.cos(a), s: -Math.sin(a) }; };

// the room for interior `id` above `door` (a world.js DOORS entry: x z = the step outside, ix iz = just inside); ground = H at the door
export function pocket(id, door, ground) {
  const key = id + '@' + Math.round(door.x) + ',' + Math.round(door.z); if (IN.cache.has(key)) return IN.cache.get(key);
  const I = IN.D.interiors[id], L = Math.hypot(door.x - door.ix, door.z - door.iz) || 1, nx = (door.x - door.ix) / L, nz = (door.z - door.iz) / L, ry = Math.atan2(nx, nz);
  const dx = (I.door && I.door.x) || 0, P = { id, def: I, door, key, ry, c: Math.cos(ry), s: Math.sin(ry), oy: ground + POCKET(), ox: 0, oz: 0, boxes: [], tables: [], w: I.w, d: I.d, h: I.h };
  // origin: the doorway (local dx, d/2) sits on the building's doorway (ix, iz)
  P.ox = door.ix - (dx * P.c + I.d / 2 * P.s); P.oz = door.iz - (-dx * P.s + I.d / 2 * P.c);
  const W2 = I.w / 2, D2 = I.d / 2, T = .4; // walls (the doorway is a closed door: you leave with EXIT, not by walking through)
  P.boxes.push(obb(P, -W2 - T / 2, 0, T / 2, D2 + T), obb(P, W2 + T / 2, 0, T / 2, D2 + T), obb(P, 0, -D2 - T / 2, W2 + T, T / 2), obb(P, 0, D2 + T / 2, W2 + T, T / 2));
  for (const p of I.props || []) {
    const f = PROPBOX[p.k]; if (f) { const [hx, hz] = f(p); P.boxes.push(obb(P, p.x, p.z, hx, hz, p.ry || 0)); }
    if (p.k === 'pool') P.tables.push({ p, T: newTable(), aim: 0 });
  }
  IN.cache.set(key, P); return P;
}
// where you appear inside (just in from the door, facing into the room) and outside again (the door's step, facing out)
export function enterPos(P) { const dx = (P.def.door && P.def.door.x) || 0, w = toW(P, dx, P.d / 2 - 1.1); return { x: w.x, y: P.oy, z: w.z, psi: P.ry }; }
export function exitPos(P) { return { x: P.door.x, z: P.door.z, psi: P.ry + Math.PI }; }

// the nearest thing to do at world (x, z): { k: 'exit' | 'shop' | 'pool', d, label, ... } or null
export function interact(P, x, z) {
  const l = toL(P, x, z), I = P.def; let best = null;
  const take = o => { if (!best || o.d < best.d) best = o; };
  const dx = (I.door && I.door.x) || 0, de = Math.hypot(l.x - dx, l.z - (P.d / 2 - .5)); if (de < 1.5) take({ k: 'exit', d: de, label: 'EXIT' });
  for (const s of I.shops || []) { const d = Math.hypot(l.x - s.x, l.z - s.z); if (d < (s.r || 1.6)) take({ k: 'shop', d, shop: s.shop, label: 'ORDER' }); }
  for (const t of P.tables) {
    const a = -(t.p.ry || 0), ca = Math.cos(a), sa = Math.sin(a), qx = (l.x - t.p.x) * ca + (l.z - t.p.z) * sa, qz = -(l.x - t.p.x) * sa + (l.z - t.p.z) * ca; // into the table's frame
    const ex = Math.max(0, Math.abs(qx) - .75), ez = Math.max(0, Math.abs(qz) - 1.3), d = Math.hypot(ex, ez);
    if (d < .85) take({ k: 'pool', d: d + .3, t, qx, qz, label: left(t.T) ? (moving(t.T) ? '…' : 'SHOOT') : 'RACK' });
  }
  return best;
}
// a shot from where you stand: the cue ball goes away from you (table frame direction), wobbled by `wob` radians (drunk aim)
export function aimFrom(t, qx, qz, wob = 0) {
  const c = t.T.balls[0]; let dx = c.x - qx, dz = c.z - qz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  const cw = Math.cos(wob), sw = Math.sin(wob); return [dx * cw - dz * sw, dx * sw + dz * cw];
}
export const breakSpeed = t => t.T.shots === 0 ? 5.2 : 2.6;
export { PC as POOL };

// third-person camera inside: how far along the boom (target -> camera, world) it can go before leaving the room (0..1)
export function camFit(P, tx, ty, tz, cx, cy, cz) {
  const a = toL(P, tx, tz, {}), b = toL(P, cx, cz, {}), m = .25, W2 = P.w / 2 - m, D2 = P.d / 2 - m, y0 = P.oy + .3, y1 = P.oy + P.h - m;
  let t = 1; const clip = (p0, p1, lo, hi) => { const d = p1 - p0; if (p1 > hi && d > 0) t = Math.min(t, (hi - p0) / d); if (p1 < lo && d < 0) t = Math.min(t, (lo - p0) / d); };
  clip(a.x, b.x, -W2, W2); clip(a.z, b.z, -D2, D2); clip(ty, cy, y0, y1); return Math.max(0, t);
}
// which pocket a world point is in ('' = outside): for friends' walkers (net.js). doors = world.js DOORS, H = ground height
export function pocketKey(x, y, z, doors, H) {
  if (!IN.D || !(y - H(x, z) > POCKET() / 2)) return '';
  for (const d of doors) {
    const id = interiorFor(d.t); if (!id) continue; const I = IN.D.interiors[id], r = Math.max(I.w, I.d) / 2 + 2;
    if (Math.abs(d.x - x) > r + 4 || Math.abs(d.z - z) > r + 4) continue;
    const P = pocket(id, d, H(d.x, d.z)), l = toL(P, x, z); if (Math.abs(l.x) < I.w / 2 + 1 && Math.abs(l.z) < I.d / 2 + 1) return P.key;
  }
  return '?';
}
