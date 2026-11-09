// Ilalim (Build 11.99): the underground cave system below the Underground River Cave. Pure logic, no three.js / DOM, so
// tools/under.mjs runs it headless. Drawing and the glue (portals, light, camera) are js/underfig.js.
//
// The game's ground is one height per (x, z) (world.js H), so the caves can't sit under the island: they are built far off it, at
// data/cave.json 'origin', where H() returns the cave FLOOR. The dark passage in the cave hall is a portal: ride (or walk) into it and
// you come out at the top of the descent below, and back the same way. Everything stays in one coordinate space (physics, Rapier,
// the walker, the camera), nothing special-cased but H(), the walls (OBBs) and the light.
//
// Shape: chambers (irregular circles) joined by tunnels (bent capsules). For a point, each shape gives a signed distance; their
// smooth union gives e = how deep into open space the point is (> 0 open, < 0 rock). The floor is the shapes' floor heights
// (softmax-blended, so a tunnel meets a chamber with no step) plus gentle bumps; from e = 0.8 towards the rock it curves up, and the
// ceiling curves down, until they meet at e = -2.5: one closed surface, drawn as two height fields (floor faces up, ceiling down).
// The bike can't climb a wall: OBB boxes line every wall (walls()), their inner face on the e = 0.3 line.
import { clamp, sstep, fbm, hash2 } from './util.js';

const MEET = -2.5, FLAT = .8, KEEP = -4;
export function makeUnder(D) {
  const ox = D.origin[0], oz = D.origin[1], byId = new Map();
  const C = D.chambers.map((c, i) => { const o = { ...c, i, p1: hash2(i, 7) * 6.28, p2: hash2(i, 9) * 6.28, p3: hash2(i, 11) * 6.28 }; byId.set(c.id, o); return o; });
  // tunnels: A -> mid (bent sideways) -> B; floor / ceiling heights ease from A's to B's over the part outside both chambers
  const T = D.tunnels.map(([a, b, w, h, bend], i) => {
    const A = byId.get(a), B = byId.get(b); if (!A || !B) throw new Error(`cave.json: tunnel ${a}-${b}: unknown chamber`);
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), mx = (A.x + B.x) / 2 - dz / L * bend * L, mz = (A.z + B.z) / 2 + dx / L * bend * L;
    const l1 = Math.hypot(mx - A.x, mz - A.z), l2 = Math.hypot(B.x - mx, B.z - mz);
    return { i, A, B, w, h, mx, mz, l1, L: l1 + l2, s0: A.r * .8, s1: l1 + l2 - B.r * .8, x0: Math.min(A.x, mx, B.x) - w, x1: Math.max(A.x, mx, B.x) + w, z0: Math.min(A.z, mz, B.z) - w, z1: Math.max(A.z, mz, B.z) + w };
  });
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const c of C) { bx0 = Math.min(bx0, c.x - c.r * 1.3); bx1 = Math.max(bx1, c.x + c.r * 1.3); bz0 = Math.min(bz0, c.z - c.r * 1.3); bz1 = Math.max(bz1, c.z + c.r * 1.3); }
  const BOX = { x0: bx0 - 12, x1: bx1 + 12, z0: bz0 - 12, z1: bz1 + 12 };
  const rOf = (c, a) => c.r * (1 + .12 * Math.sin(3 * a + c.p1) + .07 * Math.sin(5 * a + c.p2) + .04 * Math.sin(9 * a + c.p3));
  const seg = (px, pz, ax, az, bx, bz) => { const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1, t = clamp(((px - ax) * ex + (pz - az) * ez) / l2, 0, 1); return [Math.hypot(ax + ex * t - px, az + ez * t - pz), t]; };
  const R = { e: 0, base: 0, hc: 0, rad: 0, k: null, lake: 0 };
  // local point -> R (e, floor base, ceiling height, local radius, the dominant chamber)
  function sample(x, z) {
    let best = 1e9, sw = 0, sy = 0, sh = 0, sr = 0, kb = null, n = 0; const S = [];
    for (const c of C) {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz); if (d > c.r * 1.35 + 14) continue;
      const s = d - rOf(c, Math.atan2(dz, dx)); S.push(s, c.y, c.h, c.r); if (s < best) { best = s; kb = c; }
    }
    for (const t of T) {
      if (x < t.x0 - 14 || x > t.x1 + 14 || z < t.z0 - 14 || z > t.z1 + 14) continue;
      const [d1, u1] = seg(x, z, t.A.x, t.A.z, t.mx, t.mz), [d2, u2] = seg(x, z, t.mx, t.mz, t.B.x, t.B.z), first = d1 <= d2, d = first ? d1 : d2;
      const along = first ? u1 * t.l1 : t.l1 + u2 * (t.L - t.l1), q = clamp((along - t.s0) / (t.s1 - t.s0), 0, 1), s = d - t.w / 2 * (1 + .1 * Math.sin(along * .21 + t.i));
      const y = t.A.y + (t.B.y - t.A.y) * q, h = t.h; S.push(s, y, h, t.w / 2); if (s < best) { best = s; kb = null; }
    }
    if (!S.length) { R.e = -50; R.base = 0; R.hc = 0; R.rad = 1; R.k = null; return R; }
    let sm = 0; // smooth union (exponential smooth-min, k = 3 m) + softmax weights for the heights
    for (let i = 0; i < S.length; i += 4) { const w = Math.exp(-(S[i] - best) / 3); sm += w; sy += w * S[i + 1]; sh += w * S[i + 2]; sr += w * S[i + 3]; }
    R.e = -(best - 3 * Math.log(sm)); R.base = sy / sm; R.hc = sh / sm; R.rad = sr / sm; R.k = kb && best < 0 ? kb : (kb && best < 6 ? kb : null);
    R.lake = kb && kb.kind === 'lake' ? sstep(kb.r * .75, kb.r * .45, Math.hypot(x - kb.x, z - kb.z)) : 0;
    return R;
  }
  // floor / ceiling at a local point (r = sample(x, z) already taken)
  const bump = (x, z) => (fbm(x * .09 + 3.1, z * .09 - 1.7) - .5) * .4;
  function floorL(x, z, r = sample(x, z)) {
    const k = sstep(MEET, FLAT, r.e); return r.base + bump(x, z) * k + r.hc * .55 * (1 - sstep(MEET, FLAT, r.e)) - r.lake * .45;
  }
  function ceilL(x, z, r = sample(x, z)) {
    const dome = sstep(MEET, Math.min(r.rad * .7, 12), r.e), k = sstep(MEET, 0, r.e);
    return r.base + r.hc * (.55 + .45 * dome) + (fbm(x * .21 - 5, z * .21 + 2) - .5) * r.hc * .28 * k;
  }
  const U = {
    D, C, T, BOX, ox, oz, on: false, MEET, KEEP,
    has: (x, z) => x > ox + BOX.x0 && x < ox + BOX.x1 && z > oz + BOX.z0 && z < oz + BOX.z1,
    sample: (x, z) => sample(x - ox, z - oz),
    floor: (x, z) => floorL(x - ox, z - oz),
    ceil: (x, z) => ceilL(x - ox, z - oz),
    floorL, ceilL, sampleL: sample,
    // grip: packed dirt and rock, slick in the lake's shallows
    mu: (x, z) => { const r = sample(x - ox, z - oz); return .82 - .25 * r.lake; },
    // water surface of the lake chamber (local), or null
    lakeOf: () => C.find(c => c.kind === 'lake') || null,
  };
  const sp = byId.get(D.spawn) || C[0], nb = T.find(t => t.A === sp || t.B === sp), to = nb ? (nb.A === sp ? nb.B : nb.A) : C[1];
  const dirX = to.x - sp.x, dirZ = to.z - sp.z, dl = Math.hypot(dirX, dirZ) || 1;
  // where you appear going down (the mouth chamber's centre, facing down the descent), and the way back up: past the centre, away
  // from the descent (the end of the mouth, where the daylight is)
  U.inPos = () => ({ x: ox + sp.x, z: oz + sp.z, psi: Math.atan2(-dirX / dl, -dirZ / dl) });
  U.outDir = { x: -dirX / dl, z: -dirZ / dl };
  U.exitAt = (x, z, fx, fz, foot) => { const lx = x - ox - sp.x, lz = z - oz - sp.z, a = lx * U.outDir.x + lz * U.outDir.z; return a > sp.r * .45 && Math.hypot(lx, lz) < sp.r * 1.2 && (foot || fx * U.outDir.x + fz * U.outDir.z > .2); };
  U.mouth = sp;
  // the hall's portal (world.js builds the hall: front = +d rotated by ry, a along its width)
  U.setHall = (x, z, ry, w, d) => {
    const P = D.portal, c = Math.cos(ry), s = Math.sin(ry), at = (a, dd) => ({ x: x + c * a + s * dd, z: z - s * a + c * dd });
    const loc = (px, pz) => { const X = px - x, Z = pz - z; return { a: c * X - s * Z, d: s * X + c * Z }; };
    U.hall = { x, z, ry, w, d, at, loc, ax: { x: c, z: -s } };
    U.enterAt = (px, pz, fx, fz, foot) => { const q = loc(px, pz); return q.a > P.a - P.depth && q.a < P.a + 1 && Math.abs(q.d - P.d) < P.w / 2 && (foot || fx * c - fz * s > .3); };
    const o = at(P.a - 6.5, P.d); U.outPos = () => ({ x: o.x, z: o.z, psi: Math.atan2(c, -s) }); // facing away from the wall, into the hall
    U.portal = { ...at(P.a, P.d), ry, a: P.a, d: P.d, w: P.w };
    // how far inside the hall a point is, 0 outside .. 1 deep in under the roof (the mouths and the skylight let some daylight in)
    U.shelter = (px, pz) => { const q = loc(px, pz), ia = w / 2 - 4 - Math.abs(q.a), id = d / 2 - 3 - Math.abs(q.d); if (ia < 0 || id < 0) return 0; const sky = Math.hypot(q.a + w / 2 * .25, q.d); return sstep(0, 7, Math.min(ia, id)) * (1 - .45 * sstep(9, 3, sky)); };
  };
  // the walls as OBBs [cx, cz, hx, hz, ry, y] (world): one box per grid point on the rock side of the e = 0.3 line, its inner face on the
  // line, turned to the wall's normal. Overlapping 2.4 m boxes on a 1.4 m grid make a smooth enough wall for the bike's capsule.
  U.walls = (step = 1.4) => {
    const out = [], E = .3, g = (x, z) => sample(x, z).e;
    for (let z = BOX.z0; z <= BOX.z1; z += step) for (let x = BOX.x0; x <= BOX.x1; x += step) {
      const e = g(x, z); if (e >= E || e < E - 3) continue;
      if (!(g(x + step, z) >= E || g(x - step, z) >= E || g(x, z + step) >= E || g(x, z - step) >= E)) continue;
      const nx0 = g(x + .5, z) - g(x - .5, z), nz0 = g(x, z + .5) - g(x, z - .5), nl = Math.hypot(nx0, nz0) || 1, nx = nx0 / nl, nz = nz0 / nl;
      const cx = x + nx * (E - e) / Math.max(.3, nl), cz = z + nz * (E - e) / Math.max(.3, nl), hz = .7, r = sample(cx, cz);
      out.push([ox + cx - nx * hz, oz + cz - nz * hz, 1.2, hz, Math.atan2(nx, nz), r.base + 1]);
    }
    return out;
  };
  // camera boom target -> camera (world): the largest fraction that stays in open space, under the ceiling, above the floor
  U.fit = (tx, ty, tz, cx, cy, cz) => {
    let ok = .12; for (let i = 1; i <= 14; i++) {
      const f = i / 14, x = tx + (cx - tx) * f - ox, y = ty + (cy - ty) * f, z = tz + (cz - tz) * f - oz, r = sample(x, z);
      if (r.e < 1.1 || y > ceilL(x, z, r) - .45 || y < floorL(x, z, r) + .25) break; ok = f;
    }
    return ok;
  };
  return U;
}
