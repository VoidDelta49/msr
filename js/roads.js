// Roads: height profiles, junction levelling and the surface lookup the physics reads (world H()).
// Pure on purpose (no DOM, no three.js): tools/roads.mjs runs exactly this code on data/map/island.json and fails the
// test run if a junction has a step in it.
//
// island.json road = {pts, w, hwy?, closed?, kind?, grade?}: a Catmull-Rom spline sampled about every 2 m, heights that follow
// the terrain (smoothed, grade-limited). Every road is smoothed on its own, so where two roads overlap they used to sit at
// different heights and the ground flipped between the two surfaces along the line where "nearest centre line" changes
// (up to half a metre at highway junctions and the town's north-east corner, 6 cm at the closing seam of the highway loop).
// Now:
//  - a closed road is smoothed as a loop, so its last sample is its first;
//  - wherever road strips overlap (crossing, branch, end-to-end, a branch ending on the edge of another road) all the roads
//    there are levelled to ONE height over the whole overlap, so the surfaces coincide, and blend back into their own
//    terrain-following profile at a gentle grade. The highest-priority road (highway, then wider, then lower id) decides the height;
//  - nearRoad() picks the road by distance to its EDGE, so a point inside any road's surface is never treated as the shoulder of
//    a narrower road whose centre line happens to be closer.
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, sst = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t) };

function crSample(r) {
  const P = r.pts, n = P.length, out = [], get = i => r.closed ? P[(i + n) % n] : P[clamp(i, 0, n - 1)];
  for (let i = 0; i < (r.closed ? n : n - 1); i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2), L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), k = Math.max(1, Math.round(L / 2));
    for (let j = 0; j < k; j++) { const t = j / k, t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]) }
  }
  out.push(r.closed ? out[0] : P[n - 1]); return out;
}

// terrain-following height per sample: box-smoothed, then limited to the road's grade (wrapping round for a closed road)
function profile(r, terrBase) {
  const S = crSample(r), cl = r.closed, n = cl ? S.length - 1 : S.length; // a closed road's last sample repeats its first
  const h = new Array(n), ok = k => cl || (k >= 0 && k < n), ix = k => ((k % n) + n) % n;
  for (let i = 0; i < n; i++) h[i] = terrBase(S[i][0], S[i][1]);
  for (let pass = 0; pass < 3; pass++) { const a = h.slice(); for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = -12; j <= 12; j++) { const k = i + j; if (ok(k)) { s += a[ix(k)]; c++ } } h[i] = s / c } }
  const G = r.grade || .13, dl = new Array(n).fill(0); // max grade per metre; dl[i] = distance from sample i-1 to i
  for (let i = cl ? 0 : 1; i < n; i++) { const p = S[ix(i - 1)], q = S[i]; dl[i] = Math.hypot(q[0] - p[0], q[1] - p[1]) }
  for (let lap = 0; lap < (cl ? 4 : 1); lap++) {
    for (let i = cl ? 0 : 1; i < n; i++) { const p = ix(i - 1), g = G * dl[i]; h[i] = clamp(h[i], h[p] - g, h[p] + g) }
    for (let i = cl ? n - 1 : n - 2; i >= 0; i--) { const q = ix(i + 1), g = G * dl[q]; h[i] = clamp(h[i], h[q] - g, h[q] + g) }
  }
  r.n = n; r.G = G; r.s = S.map(([x, z], i) => ({ x, z, h: Math.max(h[i % n], .05) }));
}

// maximal runs of true flags (wrapping for a closed road); gaps shorter than `gap` samples are bridged
function runsOf(f, n, cl, gap = 8) {
  const g = Array.from(f); let s0 = 0;
  if (cl) { s0 = g.findIndex(v => !v); if (s0 < 0) return []; s0 += 1 }
  const at = k => cl ? (s0 + k) % n : k, runs = []; let a = -1, last = -1;
  for (let k = 0; k < n; k++) {
    if (g[at(k)]) { if (a < 0) a = k; else if (k - last > gap + 1 && last >= 0) { runs.push([a, last]); a = k } last = k }
  }
  if (a >= 0) runs.push([a, last]);
  return runs.map(([x, y]) => ({ a: at(x), len: y - x + 1 }));
}

export function buildRoads(MD, terrBase) {
  const ROADS = MD.roads.map((r, id) => ({ id, pts: r.pts, w: r.w, closed: !!r.closed, hwy: !!r.hwy, kind: r.kind || '', grade: r.grade }));
  for (const r of ROADS) profile(r, terrBase);
  for (const r of ROADS) { // tangents (round the seam for a closed road) and distance along the road
    const m = r.s.length;
    for (let i = 0; i < m; i++) { const a = r.s[i ? i - 1 : (r.closed ? r.n - 1 : 0)], b = r.s[i < m - 1 ? i + 1 : (r.closed ? 1 : m - 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; r.s[i].tx = (b.x - a.x) / l; r.s[i].tz = (b.z - a.z) / l }
  }

  // ---- junctions: every place two roads' surfaces overlap gets one shared level height ----
  const JUNCTIONS = [], CS = 32, grid = new Map(), MARGIN = 1.5; // margin: sample spacing + slack
  for (const r of ROADS) for (let i = 0; i < r.n; i++) { const k = Math.floor(r.s[i].x / CS) * 4096 + Math.floor(r.s[i].z / CS); (grid.get(k) || grid.set(k, []).get(k)).push({ r, i }) }
  const conf = new Map(); // "A|B" -> {A, B, f: flags over A's samples that overlap B, p: nearest B sample, pd: its distance}
  const mark = (A, i, B, j, d) => { const key = A.id + '|' + B.id; let c = conf.get(key); if (!c) conf.set(key, c = { A, B, f: new Uint8Array(A.n), p: new Int32Array(A.n).fill(-1), pd: new Float64Array(A.n).fill(1e9) }); c.f[i] = 1; if (d < c.pd[i]) { c.pd[i] = d; c.p[i] = j } };
  const busy = new Map(); // does the 3x3 block of cells round this one hold samples of two or more roads? (most of a road is nowhere near another)
  const isBusy = (cx, cz) => { const k = cx * 4096 + cz; let v = busy.get(k); if (v === undefined) { const ids = new Set(); for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) for (const e of grid.get(gx * 4096 + gz) || []) ids.add(e.r.id); busy.set(k, v = ids.size > 1) } return v };
  for (const A of ROADS) for (let i = 0; i < A.n; i++) {
    const s = A.s[i], cx = Math.floor(s.x / CS), cz = Math.floor(s.z / CS);
    if (!isBusy(cx, cz)) continue;
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) for (const { r: B, i: j } of grid.get(gx * 4096 + gz) || []) {
      if (B.id <= A.id) continue; // each pair of roads once; both directions are marked below
      const q = B.s[j], dx = q.x - s.x, dz = q.z - s.z, d2 = dx * dx + dz * dz, far = B.w / 2 + A.w / 2 + MARGIN;
      if (d2 >= far * far) continue; // cheap reject: beyond the widest possible overlap
      const d = Math.sqrt(d2), c = Math.abs(s.tx * q.tx + s.tz * q.tz); // c = |cos| of the angle between the roads here: a crossing at a shallow angle overlaps for longer
      if (d < B.w / 2 + A.w / 2 * c + MARGIN) mark(A, i, B, j, d);
      if (d < A.w / 2 + B.w / 2 * c + MARGIN) mark(B, j, A, i, d);
    }
  }
  // nodes = one overlap run of A with B; two runs belong to the same junction when they overlap on the same road or point at each other
  const nodes = []; for (const c of conf.values()) for (const rn of runsOf(c.f, c.A.n, c.A.closed)) nodes.push({ A: c.A, B: c.B, c, ...rn });
  const par = nodes.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i])), uni = (a, b) => { par[find(a)] = find(b) };
  const inRun = (nd, i, n) => { const o = (i - nd.a + n) % n; return o < nd.len };
  const points = (X, Y) => { const n = X.A.n; for (let t = 0; t < X.len; t++) { const j = X.c.p[(X.a + t) % n]; if (j >= 0 && inRun(Y, j, Y.A.n)) return true } return false }; // X's samples point into Y's run
  const gapAfter = (X, Y, n) => { const d = Y.a - (X.a + X.len); return X.A.closed ? ((d % n) + n) % n : d < 0 ? Infinity : d }; // unflagged samples from the end of X to the start of Y (wraps only on a closed road)
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const X = nodes[a], Y = nodes[b];
    if (X.A === Y.A) { const n = X.A.n; if (inRun(X, Y.a, n) || inRun(Y, X.a, n) || gapAfter(X, Y, n) <= 8 || gapAfter(Y, X, n) <= 8) uni(a, b); continue } // overlapping or a few samples apart on one road: one junction
    if (X.A === Y.B && X.B === Y.A && (points(X, Y) || points(Y, X))) uni(a, b);
  }
  const comps = new Map(); nodes.forEach((nd, i) => { const k = find(i); (comps.get(k) || comps.set(k, []).get(k)).push(nd) });
  const prio = (a, b) => (b.hwy - a.hwy) || (b.w - a.w) || (a.id - b.id);
  const lock = new Map(ROADS.map(r => [r, new Uint8Array(r.n)])); // samples already on a junction plateau
  const comp = [...comps.values()].map(list => {
    const roads = [...new Set(list.map(n => n.A))].sort(prio), mem = [];
    for (const r of roads) { const f = new Uint8Array(r.n); for (const nd of list) if (nd.A === r) for (let t = 0; t < nd.len; t++) f[(nd.a + t) % r.n] = 1; for (const rn of runsOf(f, r.n, r.closed, 0)) mem.push({ r, ...rn }) }
    return { roads, mem }
  });
  comp.sort((p, q) => prio(p.roads[0], q.roads[0]) || p.mem[0].a - q.mem[0].a);
  for (const { roads, mem } of comp) {
    const P = mem.find(m => m.r === roads[0]); let sum = 0; for (let t = 0; t < P.len; t++) sum += P.r.s[(P.a + t) % P.r.n].h;
    const h0 = sum / P.len, rec = { x: 0, z: 0, h0, primary: roads[0].id, members: [] };
    for (const m of mem) {
      const r = m.r, n = r.n, s = r.s, L = lock.get(r);
      for (let t = 0; t < m.len; t++) { const k = (m.a + t) % n; rec.x += s[k].x; rec.z += s[k].z }
      const T = [];
      for (const dir of [1, -1]) { // walk away from each end of the plateau, remembering the distance to the plateau
        const walk = []; let k = dir > 0 ? (m.a + m.len - 1) % n : m.a, d = 0;
        for (let st = 1; st < n; st++) {
          const k2 = k + dir; if (!r.closed && (k2 < 0 || k2 >= n)) break; const j = (k2 + n) % n; if (L[j]) break;
          d += Math.hypot(s[j].x - s[k].x, s[j].z - s[k].z); if (d > 600) break; walk.push([j, d]); k = j;
        }
        let Tu = 0; for (const t of [14, 18, 23, 30, 38, 48, 60, 80]) { // shortest smooth blend that keeps the grade within the road's limit
          let prev = h0, pd = 0, good = true;
          for (const [j, dd] of walk) { const w = sst(dd / t), hn = h0 * (1 - w) + s[j].h * w; if (Math.abs(hn - prev) > r.G * (dd - pd) * 1.0001) { good = false; break } if (dd >= t) break; prev = hn; pd = dd }
          if (good) { Tu = t; break }
        }
        if (Tu) { for (const [j, dd] of walk) { const w = sst(dd / Tu); if (w >= 1) break; s[j].h = h0 * (1 - w) + s[j].h * w } }
        else { // no smooth blend fits (the road already climbs at its limit): ease away at the road's own grade until it meets its own profile again
          let prev = h0, pd = 0; for (const [j, dd] of walk) { const g = r.G * (dd - pd), c = clamp(s[j].h, prev - g, prev + g); if (c === s[j].h) break; s[j].h = c; prev = c; pd = dd }
        }
        T.push(Tu); // 0 = grade ramp
      }
      for (let t = 0; t < m.len; t++) { const k = (m.a + t) % n; s[k].h = h0; L[k] = 1 }
      rec.members.push({ road: r.id, a: m.a, len: m.len, T });
    }
    const cnt = rec.members.reduce((q, m) => q + m.len, 0); rec.x /= cnt; rec.z /= cnt; JUNCTIONS.push(rec);
  }
  for (const r of ROADS) if (r.closed) r.s[r.n].h = r.s[0].h; // the loop closes exactly

  // ---- surface lookup: road segments in 20 m cells ----
  const SEGG = new Map(), BUMPS = [];
  for (const r of ROADS) for (let i = 1; i < r.s.length; i++) {
    const A = r.s[i - 1], B = r.s[i], sg = { id: r.id, ax: A.x, az: A.z, bx: B.x, bz: B.z, ha: A.h, hb: B.h, w: r.w, hw: r.w / 2, l2: Math.max(1e-6, (B.x - A.x) ** 2 + (B.z - A.z) ** 2) }, m = r.w / 2 + 9;
    for (let gx = Math.floor((Math.min(A.x, B.x) - m) / 20); gx <= Math.floor((Math.max(A.x, B.x) + m) / 20); gx++) for (let gz = Math.floor((Math.min(A.z, B.z) - m) / 20); gz <= Math.floor((Math.max(A.z, B.z) + m) / 20); gz++) { const k = gx * 1000 + gz; if (!SEGG.has(k)) SEGG.set(k, []); SEGG.get(k).push(sg) }
  }
  for (const [x, z, ax] of MD.bumps || []) BUMPS.push({ x, z, ax });
  const NR = { d: 0, h: 0, w: 0, i: -1 };
  // the road whose EDGE is nearest (inside any road's surface is always found); NR.d = distance to that road's centre line
  function nearRoad(x, z) {
    const L = SEGG.get(Math.floor(x / 20) * 1000 + Math.floor(z / 20)); if (!L) return null;
    let be = 1e18, bd = 0, bh = 0, bw = 0, bi = -1;
    for (const s of L) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, t = clamp(((x - s.ax) * ex + (z - s.az) * ez) / s.l2, 0, 1), px = s.ax + ex * t - x, pz = s.az + ez * t - z, d = Math.sqrt(px * px + pz * pz), e = d - s.hw;
      if (e < be) { be = e; bd = d; bh = s.ha + (s.hb - s.ha) * t; bw = s.w; bi = s.id }
    }
    NR.d = bd; NR.h = bh; NR.w = bw; NR.i = bi; return NR;
  }
  // every road whose surface contains the point (tools/roads.mjs: where several do, they must agree on the height)
  function roadsAt(x, z) {
    const L = SEGG.get(Math.floor(x / 20) * 1000 + Math.floor(z / 20)) || [], best = new Map();
    for (const s of L) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, t = clamp(((x - s.ax) * ex + (z - s.az) * ez) / s.l2, 0, 1), px = s.ax + ex * t - x, pz = s.az + ez * t - z, d = Math.sqrt(px * px + pz * pz);
      if (d < s.hw && (!best.has(s.id) || d < best.get(s.id).d)) best.set(s.id, { id: s.id, d, h: s.ha + (s.hb - s.ha) * t, w: s.w });
    }
    return [...best.values()];
  }
  function bumpAt(x, z) { for (const b of BUMPS) { const al = b.ax === 'z' ? z - b.z : x - b.x, cr = b.ax === 'z' ? x - b.x : z - b.z; if (Math.abs(al) < .35 && Math.abs(cr) < 3.6) return .075 * (1 + Math.cos(Math.PI * al / .35)) / 2 } return 0 }
  return { ROADS, nearRoad, roadsAt, bumpAt, BUMPS, JUNCTIONS };
}
