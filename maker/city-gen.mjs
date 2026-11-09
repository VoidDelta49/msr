#!/usr/bin/env node
// Build 11.93: bakes the big Ciudad Nueva (districts, street grid, buildings) and the new islands into data/map/island.json.
//   node maker/city-gen.mjs        (idempotent: removes what it added last time, by the "g93" marks, then adds it again)
// Deterministic (own seeded RNG). Edit the tables below and re-run; then node tools/test.mjs --update if the physics baseline moved.
import { readFileSync, writeFileSync } from 'node:fs';
const FILE = new URL('../data/map/island.json', import.meta.url), M = JSON.parse(readFileSync(FILE, 'utf8'));
let sd = 93; const rnd = () => (sd = (Math.imul(sd, 1103515245) + 12345) >>> 0) / 4294967296, pick = a => a[(rnd() * a.length) | 0], R1 = v => Math.round(v * 10) / 10;
const G = 'g93'; // mark on everything generated
M.features = M.features.filter(f => !f[G]); M.roads = M.roads.filter(r => !r[G]); M.islands = M.islands.filter(i => !i[G]);
M.buildings = M.buildings.filter(b => b[7] !== G);
const feat = f => M.features.push({ ...f, [G]: 1 }), road = r => M.roads.push({ w: 7, ...r, [G]: 1 }), isl = i => M.islands.push({ ...i, [G]: 1 });
const B = (t, x, z, ry = 0, w, d, fl) => { const b = [t, R1(x), R1(z), Math.round(ry * 1e4) / 1e4]; if (w !== undefined) b.push(R1(w), R1(d)); if (fl !== undefined) b.push(fl); while (b.length < 7) b.push(b.length === 4 ? 0 : b.length === 5 ? 0 : 0); b.length = 7; b.push(G); M.buildings.push(b); };
// (buildings carry the mark in slot 7; world.js reads slots 0..6. Types without w/d get 0 there -> replaced below by the type default)
const DEF = { shop: [8, 9.5], house: [7, 7], house2: [8, 9], bahay: [8.5, 8.5], bunga: [9, 7.5], sari: [4.4, 5], warehouse: [13, 26], bar: [12, 11], stall: [4.4, 3.4], cottage: [5.6, 5.6], tower: [20, 20], chapel: [6.4, 12], resort: [24, 12], lighthouse: [7, 7], lookout: [7, 7], rest: [11, 6], park: [60, 40], balete: [18, 18] };
const add = (t, x, z, ry, w, d, fl) => { const D = DEF[t]; B(t, x, z, ry, w ?? D[0], d ?? D[1], fl ?? (t === 'shop' ? 1 : t === 'tower' ? 13 : 0)); };

/* ---------- the city island: outline, districts ---------- */
const city = M.islands.find(i => i.id === 'city');
city.pts = [[-1290, 820], [-1230, 760], [-1100, 735], [-940, 742], [-780, 735], [-660, 760], [-498.7, 745], [-339.2, 722], [-165.2, 735], [-20.2, 718], [110, 722], [220, 705], [330, 722], [430, 748], [480, 800],
  [505, 875], [600, 900], [700, 895], [790, 850], [880, 800], [1000, 790], [1120, 800], [1230, 850], [1285, 950], [1300, 1080], [1290, 1220], [1310, 1380], [1300, 1540], [1270, 1700], [1220, 1840], [1130, 1950],
  [1000, 2010], [860, 2000], [720, 1960], [600, 1985], [450, 1995], [250, 2005], [50, 2000], [-150, 2008], [-350, 2000], [-520, 1985], [-600, 1950], [-640, 1925], [-720, 1912], [-800, 1928], [-860, 1975], [-950, 2010],
  [-1080, 2000], [-1200, 1950], [-1270, 1860], [-1300, 1720], [-1290, 1550], [-1310, 1380], [-1295, 1200], [-1310, 1030], [-1300, 900]];
city.step = 12; city.pd = .45;
const FL = [ // the levelled districts (h 2.2 like the old downtown, so every street junction is flat)
  { name: 'city', x0: -1180, z0: 820, x1: -560, z1: 1300, label: 'Puerto' }, { name: 'city', x0: -1180, z0: 1300, x1: -560, z1: 1830, label: 'Lumang Bayan' },
  { name: 'city', x0: -560, z0: 1080, x1: 440, z1: 1470, label: 'Bagong Bayan' }, { name: 'city', x0: -560, z0: 1470, x1: 440, z1: 1880, label: 'San Roque' },
  { name: 'city', x0: 430, z0: 960, x1: 1180, z1: 1240, label: 'Silangan' }];
for (const f of FL) feat({ type: 'flat', h: 2.2, blend: 40, lp: 1, ...f });
feat({ type: 'hill', x: 880, z: 1580, h: 55, r: 160, label: 'Altavista', lp: 1 });
feat({ type: 'hill', x: -50, z: 1950, h: 0, r: 1, label: 'Baybayin Beach', lp: 1 });

/* ---------- street grid ---------- */
const XS = [], ZS = [880, 970, 1060]; for (let x = -1140; x <= 1140; x += 120) XS.push(x); for (let z = 1150; z <= 1870; z += 90) ZS.push(z);
const OLD = (x, z) => x >= -545 && x <= 425 && z >= 785 && z <= 1062; // the old downtown grid stays as it is
const inF = (x, z) => FL.some(f => x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) || (x >= -640 && x <= 430 && z >= 775 && z <= 1080);
const edge = (a, b) => inF(...a) && inF(...b) && inF((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) && !(OLD(...a) && OLD(...b));
const runs = (pts) => { const out = []; let cur = null; for (let i = 1; i < pts.length; i++) { if (edge(pts[i - 1], pts[i])) { if (!cur) out.push(cur = [pts[i - 1]]); cur.push(pts[i]) } else cur = null } return out.map(r => [r[0], r[r.length - 1]]); };
for (const x of XS) runs(ZS.map(z => [x, z])).forEach((p, k) => road({ id: `ca${x}_${k}`, pts: p }));
for (const z of ZS) runs(XS.map(x => [x, z])).forEach((p, k) => road({ id: `cs${z}_${k}`, pts: p, w: z === 1420 || z === 1150 ? 10 : 7 }));
// Altavista: a loop round the hill, a spur up from Silangan, one down to San Roque, the malecon along the beach
const A = []; for (let k = 0; k < 12; k++) { const a = k / 12 * 2 * Math.PI, r = 175 + 18 * Math.sin(k * 2.3); A.push([R1(880 + Math.cos(a) * r), R1(1580 + Math.sin(a) * r)]) }
road({ id: 'altavista', pts: A, closed: true, w: 7 });
road({ id: 'altavista_n', pts: [[780, 1240], [690, 1300], [700, 1380], [790, 1425], [A[9][0], A[9][1]]] }); // switchbacks: the climb is 31 m
road({ id: 'altavista_w', pts: [[A[6][0], A[6][1]], [560, 1600], [420, 1600]] });
road({ id: 'malecon_e', pts: [[420, 1870], [600, 1880], [800, 1890], [1000, 1870]], w: 10 });
road({ id: 'altavista_s', pts: [[A[3][0], A[3][1]], [990, 1790], [1010, 1850], [940, 1880]] });

/* ---------- buildings, block by block ---------- */
const DIST = (cx, cz) => cx < -560 ? (cz < 1330 ? 'puerto' : 'old') : cx < 440 ? (cz < 1420 ? 'cbd' : 'mixed') : 'res';
const PARKS = new Set(['-60,1555', '60,1555', '-420,1195', '780,1105']);
function row(x0, z0, x1, z1, ry, L, mk) { // a row of buildings along a street side: (x0,z0)->(x1,z1) is the front line, ry = facing
  let s = 2 + rnd() * 3; const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len, fx = Math.sin(ry), fz = Math.cos(ry);
  while (s < len - 4) { const o = mk(); if (!o) { s += 6 + rnd() * 8; continue } const [t, w, d, fl] = o; if (s + w > len) break;
    const cx = x0 + ux * (s + w / 2) - fx * d / 2, cz = z0 + uz * (s + w / 2) - fz * d / 2; add(t, cx, cz, ry, w, d, fl); s += w + L(); }
}
const gap = (a, b) => () => a + rnd() * (b - a);
const MK = {
  puerto: () => rnd() < .12 ? ['stall', 4.4, 3.4] : rnd() < .06 ? ['bar', 12, 11] : rnd() < .7 ? ['warehouse', 13 + rnd() * 6, 20 + rnd() * 6] : rnd() < .5 ? null : ['shop', 8, 9.5, 1],
  old: () => rnd() < .1 ? ['sari', 4.4, 5] : rnd() < .75 ? ['bahay', 8.5 + rnd() * 2, 8.5 + rnd()] : ['house2', 8, 9],
  cbd: () => rnd() < .08 ? ['bar', 12, 11] : rnd() < .1 ? ['sari', 4.4, 5] : ['shop', 8 + rnd() * 3, 9.5 + rnd() * 2, rnd() < .45 ? 3 : 2],
  mixed: () => rnd() < .07 ? ['bar', 12, 11] : rnd() < .12 ? ['sari', 4.4, 5] : rnd() < .55 ? ['shop', 8 + rnd() * 2, 9.5, rnd() < .5 ? 2 : 1] : rnd() < .5 ? ['house2', 8, 9] : null,
  res: () => rnd() < .08 ? ['sari', 4.4, 5] : rnd() < .45 ? ['house', 6.5 + rnd() * 2.5, 6.5 + rnd() * 2] : rnd() < .5 ? ['bunga', 9, 7.5] : rnd() < .7 ? ['house2', 8, 9] : null,
};
const hasRoad = (a, b) => M.roads.some(r => r.pts.length === 2 && segOn(r.pts, a, b)) || OLD(...a) && OLD(...b);
const segOn = (P, a, b) => { const [p, q] = P, on = (c) => Math.abs((q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0])) < 1 && c[0] >= Math.min(p[0], q[0]) - .5 && c[0] <= Math.max(p[0], q[0]) + .5 && c[1] >= Math.min(p[1], q[1]) - .5 && c[1] <= Math.max(p[1], q[1]) + .5; return on(a) && on(b) };
for (let i = 1; i < XS.length; i++) for (let j = 1; j < ZS.length; j++) {
  const x0 = XS[i - 1], x1 = XS[i], z0 = ZS[j - 1], z1 = ZS[j], cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (OLD(cx, cz) || !inF(x0, z0) || !inF(x1, z1) || !inF(x0, z1) || !inF(x1, z0)) continue;
  const N = hasRoad([x0, z0], [x1, z0]), S = hasRoad([x0, z1], [x1, z1]), W = hasRoad([x0, z0], [x0, z1]), E = hasRoad([x1, z0], [x1, z1]); if (!(N || S || W || E)) continue;
  const k = `${cx},${cz}`, I = 8, d = DIST(cx, cz), mk = MK[d];
  if (PARKS.has(k)) { add('park', cx, cz, 0, x1 - x0 - 2 * I, z1 - z0 - 2 * I); continue }
  if (d === 'old' && rnd() < .16) { add('chapel', cx, cz, 0); }
  const L = d === 'res' ? gap(3, 7) : d === 'puerto' ? gap(4, 12) : d === 'old' ? gap(1, 4) : gap(.6, 3), dep = d === 'puerto' ? 28 : 13;
  if (N) row(x1 - I, z0 + I, x0 + I, z0 + I, Math.PI, L, mk);
  if (S) row(x0 + I, z1 - I, x1 - I, z1 - I, 0, L, mk);
  if (W) row(x0 + I, z0 + I + dep, x0 + I, z1 - I - dep, -Math.PI / 2, L, () => { const o = mk(); return o && o[1] > 14 ? ['shop', 8, 9.5, 1] : o });
  if (E) row(x1 - I, z1 - I - dep, x1 - I, z0 + I + dep, Math.PI / 2, L, () => { const o = mk(); return o && o[1] > 14 ? ['shop', 8, 9.5, 1] : o });
  if (d === 'cbd' && x1 - x0 >= 120) { const n = 1 + (rnd() < .5); for (let q = 0; q < n; q++) add('tower', cx + (n > 1 ? (q ? 22 : -22) : 0), cz, 0, 20 + rnd() * 4, 20 + rnd() * 4, pick([10, 14, 18, 22, 26, 32])) }
  if (d === 'res' && rnd() < .3) add('park', cx, cz, 0, 40, 20);
}
// the beach, the hill, the port
for (const x of [-420, 60]) add('resort', x, 1940, 0);
for (let x = -330; x < 380; x += 26) if (Math.abs(x - 60) > 30) add('cottage', x + rnd() * 6, 1960 + rnd() * 8, rnd() * .6 - .3);
for (let x = -500; x < 420; x += 34) add('stall', x + 10, 1884, 0);
add('lighthouse', 1110, 1900, 0); add('lookout', 880, 1580, .4); add('rest', 600, 1910, Math.PI);
for (const [x, z, r] of [[760, 1460, 2.4], [990, 1470, -2.4], [1010, 1700, -.8], [740, 1720, .8], [860, 1400, Math.PI], [1060, 1580, -Math.PI / 2], [700, 1580, Math.PI / 2], [880, 1770, 0]]) add(rnd() < .5 ? 'bunga' : 'house2', x, z, r);
add('balete', 640, 1460, 0);

/* ---------- new islands ---------- */
// Isla Kambal: twin peaks between the main island and the city, a loop road, a bridge to each
isl({ id: 'kambal', pd: .7, pts: [[-1180, 230], [-1120, 170], [-1030, 160], [-950, 200], [-900, 280], [-880, 370], [-820, 420], [-790, 500], [-800, 590], [-860, 650], [-950, 665], [-1030, 630], [-1070, 560], [-1140, 500], [-1200, 420], [-1225, 320]] });
feat({ type: 'hill', x: -1070, z: 330, h: 95, r: 75, p: 1.6, label: 'Isla Kambal', lp: 2 }); feat({ type: 'hill', x: -900, z: 540, h: 70, r: 60, p: 1.7 });
road({ id: 'kambal_loop', closed: true, pts: [[-1150, 280], [-1060, 215], [-960, 245], [-925, 330], [-865, 425], [-845, 525], [-880, 600], [-960, 615], [-1035, 560], [-1120, 470], [-1172, 380]] });
road({ id: 'kambal_s', w: 8, bridge: true, grade: .1, pts: [[-880, 600], [-895, 650], [-900, 705, 4.5], [-900, 765], [-900, 880]] });
road({ id: 'kambal_e', w: 8, bridge: true, grade: .1, pts: [[-925, 330], [-880, 300], [-800, 272, 5], [-680, 236, 5], [-590, 207], [-560, 200]] });
add('lookout', -1070, 330, .2); add('rest', -1012, 640, 0); add('cottage', -1180, 300, 1.2); add('cottage', -1190, 340, 1.4); add('cottage', -1150, 520, .8);
// Atol Perlas: a crescent atoll with a lagoon, east of Bato; causeway from Bato, bridge to Silangan
{ const C = [1270, 450], o = [], i = []; for (let a = 50; a <= 310; a += 13) { const t = a * Math.PI / 180; o.push([R1(C[0] + Math.cos(t) * 180), R1(C[1] + Math.sin(t) * 180)]) } for (let a = 310; a >= 50; a -= 20) { const t = a * Math.PI / 180; i.push([R1(C[0] + Math.cos(t) * 108), R1(C[1] + Math.sin(t) * 108)]) }
  isl({ id: 'perlas', pd: 1.4, pts: [...o, ...i] }); feat({ type: 'hill', x: 1090, z: 450, h: 0, r: 1, label: 'Atol Perlas', lp: 2 });
  const A2 = []; for (let a = 66; a <= 294; a += 19) { const t = a * Math.PI / 180; A2.push([R1(C[0] + Math.cos(t) * 144), R1(C[1] + Math.sin(t) * 144)]) }
  road({ id: 'perlas', pts: A2 }); const W = A2[6];
  road({ id: 'perlas_w', w: 8, bridge: true, grade: .1, pts: [[835, 440], [900, 442], [975, 445], [1035, 448, 3.5], [1095, 450], [W[0], W[1]]] });
  road({ id: 'perlas_s', w: 8, bridge: true, grade: .1, pts: [A2[0], [1300, 690, 5], [1215, 800, 3.5], [1140, 880], [1140, 970]] });
  add('resort', C[0] - 115, C[1] + 60, -2.1); add('lighthouse', C[0] + Math.cos(5.3) * 150, C[1] + Math.sin(5.3) * 150, 0);
  for (const a of [140, 160, 200, 220, 240]) { const t = a * Math.PI / 180; add('cottage', C[0] + Math.cos(t) * 122, C[1] + Math.sin(t) * 122, -t + Math.PI / 2) }
  add('stall', C[0] - 150, C[1] - 30, Math.PI / 2); add('rest', C[0] + 20, C[1] - 156, Math.PI); }
// three palm sandbars off the old quarter
for (const [x, z, r, n] of [[-950, 2100, 30, 'buhangin1'], [-1060, 2118, 22, 'buhangin2'], [-860, 2088, 18, 'buhangin3']]) { const P = []; for (let k = 0; k < 10; k++) { const t = k / 10 * 2 * Math.PI; P.push([R1(x + Math.cos(t) * r * 1.4), R1(z + Math.sin(t) * r)]) } isl({ id: n, step: 6, pd: 2.2, pts: P }) }
feat({ type: 'hill', x: -960, z: 2100, h: 0, r: 1, label: 'Tatlong Buhangin', lp: 0 });

// nothing generated may stand on a road (the hand-placed villas, cottages and the odd row end near a curved road)
// 11.98: tested against the game's real road splines (Catmull-Rom, not the straight lines between the points: a curve bulges out
// by metres) over the whole footprint, with a 1 m kerb. tools/roads.mjs fails on any building left on a road (ONROAD).
const { groundOf, intoRoad } = await import('../tools/lib/ground.mjs'), GR = groundOf(M);
const onRoad = b => intoRoad(GR.nearRoad, GR.TB.terr, b).by > -1;
const n0 = M.buildings.length; M.buildings = M.buildings.filter(b => b[7] !== G || !onRoad(b)); console.log('city-gen: dropped', n0 - M.buildings.length, 'buildings on roads');
writeFileSync(FILE, JSON.stringify(M));
console.log('city-gen:', M.buildings.filter(b => b[7] === G).length, 'buildings,', M.roads.filter(r => r[G]).length, 'roads,', M.islands.filter(i => i[G]).length, 'islands');
