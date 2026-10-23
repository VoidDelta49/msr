// Small shared helpers (no game state here)
// Error log for playtesting on phones: console errors/warnings (shader compile failures etc.) shown in Options.
export const LOG = [];
for (const k of ['error', 'warn']) { const o = console[k].bind(console); console[k] = (...a) => { LOG.push(k[0].toUpperCase() + ': ' + a.map(x => x && x.message || String(x)).join(' ').slice(0, 400)); if (LOG.length > 30) LOG.shift(); o(...a); }; }
addEventListener('error', e => LOG.push('E: ' + e.message));
export const $ = id => document.getElementById(id), PI = Math.PI;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const appr = (v, t, s) => v < t ? Math.min(t, v + s) : Math.max(t, v - s);
export const angd = (a, b) => { let d = (a - b) % (2 * PI); if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; return d; };
export function hash2(i, j) { let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
export function vnoise(x, z) { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz), a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1); return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w; }
export const fbm = (x, z) => vnoise(x, z) * .55 + vnoise(x * 2.1, z * 2.1) * .3 + vnoise(x * 4.3, z * 4.3) * .15;
// seeded RNG so the island is the same every load
let RNG = 12345; export const rand = () => (RNG = (Math.imul(RNG, 1664525) + 1013904223) >>> 0) / 4294967296;
// piecewise-linear lookup in [[x,y],...]
export function lerpTable(T, x) { if (x <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (x < T[i][0]) { const [a, ta] = T[i - 1], [b, tb] = T[i]; return ta + (tb - ta) * (x - a) / (b - a); } return T[T.length - 1][1]; }
