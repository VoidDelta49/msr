// Road routing for the waypoint (pure, no DOM / three.js). Nodes = every 3rd road sample (~6 m), edges along each road plus
// links where two roads' nodes are close at the same height (junctions; overpasses stay unlinked). route() = A* by distance.
const ST = 3, CS = 16;
export function makeRouter(ROADS) {
  const X = [], Z = [], Y = [], R = [], adj = [], grid = new Map(), key = (x, z) => Math.floor(x / CS) * 65536 + Math.floor(z / CS);
  const link = (a, b) => { const d = Math.hypot(X[a] - X[b], Z[a] - Z[b]); adj[a].push(b, d); adj[b].push(a, d); };
  for (const r of ROADS) {
    const n = r.n, first = X.length; let prev = -1;
    for (let i = 0; i < n; i += ST) { add(r, i); if (prev >= 0) link(prev, X.length - 1); prev = X.length - 1; }
    if (r.closed) link(prev, first); else if ((n - 1) % ST) { add(r, n - 1); link(prev, X.length - 1); }
  }
  function add(r, i) { const s = r.s[i], k = X.length; X.push(s.x); Z.push(s.z); Y.push(s.h); R.push(r); adj.push([]); (grid.get(key(s.x, s.z)) || grid.set(key(s.x, s.z), []).get(key(s.x, s.z))).push(k); }
  const near = (x, z, f) => { const cx = Math.floor(x / CS), cz = Math.floor(z / CS); for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) for (const k of grid.get(i * 65536 + j) || []) f(k); };
  for (let a = 0; a < X.length; a++) near(X[a], Z[a], b => { // junction links
    if (b <= a || R[b] === R[a] || Math.abs(Y[a] - Y[b]) > 1.5) return;
    const lim = Math.max(R[a].w, R[b].w) / 2 + 4; if (Math.hypot(X[a] - X[b], Z[a] - Z[b]) < lim) link(a, b);
  });
  function nearest(x, z) { // ring search outwards, up to ~250 m
    for (let rad = 1; rad <= 16; rad *= 2) {
      let best = -1, bd = 1e18; const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      for (let i = cx - rad; i <= cx + rad; i++) for (let j = cz - rad; j <= cz + rad; j++) for (const k of grid.get(i * 65536 + j) || []) { const d = (X[k] - x) ** 2 + (Z[k] - z) ** 2; if (d < bd) { bd = d; best = k; } }
      if (best >= 0) return best;
    }
    return -1;
  }
  // [[x, z], ...] from (ax, az) along the roads to (bx, bz); a straight line when either end is far from any road or no path joins them
  function route(ax, az, bx, bz) {
    const s = nearest(ax, az), t = nearest(bx, bz), line = [[ax, az], [bx, bz]];
    if (s < 0 || t < 0) return line;
    const N = X.length, g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N), h = k => Math.hypot(X[k] - X[t], Z[k] - Z[t]);
    const q = [[h(s), s]]; g[s] = 0; // binary heap of [f, node]
    const push = e => { q.push(e); let i = q.length - 1; while (i) { const p = (i - 1) >> 1; if (q[p][0] <= q[i][0]) break; [q[p], q[i]] = [q[i], q[p]]; i = p; } };
    const pop = () => { const top = q[0], e = q.pop(); if (q.length) { q[0] = e; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < q.length && q[l][0] < q[m][0]) m = l; if (r < q.length && q[r][0] < q[m][0]) m = r; if (m === i) break; [q[m], q[i]] = [q[i], q[m]]; i = m; } } return top; };
    while (q.length) {
      const k = pop()[1]; if (done[k]) continue; done[k] = 1; if (k === t) break;
      const A = adj[k]; for (let i = 0; i < A.length; i += 2) { const b = A[i], ng = g[k] + A[i + 1]; if (ng < g[b]) { g[b] = ng; from[b] = k; push([ng + h(b), b]); } }
    }
    if (!done[t]) return line;
    const p = [[bx, bz]]; for (let k = t; k >= 0; k = from[k]) p.push([X[k], Z[k]]); p.push([ax, az]); return p.reverse();
  }
  return { route, nodes: X.length };
}
