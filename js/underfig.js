// Ilalim, drawn (Build 11.99): the rock shell (floor + ceiling height fields from js/under.js, vertex-coloured, normals from the
// height grids so tiles join with no seams), the props (stalagmites, stalactites, columns, crystal clusters, glowworms, the lake,
// the waterfall, the daylight shaft and the way out, show-cave lamps along the main route) and the dark passage in the cave hall.
// Nothing here is a real light: crystals, glowworms and lamps are emissive (bloom makes them glow), the light they throw is
// additive pools draped on the floor, and the daylight follows UGDAY (daynight.js). The whole system is one group, shown only while
// you are down there (undergo.js), so on the island it costs nothing. world.js builds it before Rapier reads the walls.
import * as THREE from 'three';
import { uniform, vec3, uv, float, clamp, smoothstep, time, fract, sin, positionWorld, cameraPosition, normalView, positionView } from 'three/tsl';
import { scene } from './renderer.js';
import { liteMaterials } from './perf.js';
import { hash2, sstep } from './util.js';

export const UGDAY = uniform(1); // daylight at the way out and down the shaft (0 night .. 1 noon), set by daynight.js
export const UGG = new THREE.Group(); UGG.name = 'ilalim'; UGG.visible = false;
const HDR = (r, g, b, k) => new THREE.Color(r * k, g * k, b * k);
const radial = () => { const f = clamp(float(1).sub(uv().sub(.5).length().mul(2)), 0, 1); return f.mul(f); };
function addMat(colorNode, opacityNode) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  m.colorNode = colorNode; m.opacityNode = opacityNode; m.forceSinglePass = true; return m;
}
const mesh = (g, m, name) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = o.receiveShadow = false; o.matrixAutoUpdate = false; o.updateMatrix(); UGG.add(o); return o; };
function instanced(geo, mat, list, name) { // list of { x, y, z, sx, sy, sz, ry, c }
  if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  list.forEach((o, i) => { m4.compose(new THREE.Vector3(o.x, o.y, o.z), q.setFromEuler(e.set(o.rx || 0, o.ry || 0, 0)), new THREE.Vector3(o.sx, o.sy, o.sz)); im.setMatrixAt(i, m4); if (o.c != null) im.setColorAt(i, col.set(o.c)); });
  im.name = name; im.castShadow = im.receiveShadow = false; im.computeBoundingSphere(); UGG.add(im);
}
// ground-draped additive pools: [{ x, z, sx, sz, c }] on the cave floor
function pools(U, list, k, name, lvl) {
  if (!list.length) return; const N = 6, V = (N + 1) * (N + 1), pos = new Float32Array(list.length * V * 3), col = new Float32Array(list.length * V * 3), uvs = new Float32Array(list.length * V * 2), idx = []; let vi = 0; const cc = new THREE.Color();
  for (const p of list) {
    cc.set(p.c); const b = vi;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const x = p.x + (i / N - .5) * p.sx, z = p.z + (j / N - .5) * p.sz; pos.set([x, U.floor(x, z) + .08, z], vi * 3); col.set([cc.r, cc.g, cc.b], vi * 3); uvs.set([i / N, j / N], vi * 2); vi++; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = b + j * (N + 1) + i; idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(list.length * V * 3).map((_, i) => i % 3 === 1 ? 1 : 0), 3)); g.setIndex(idx); g.computeBoundingSphere();
  const m = addMat(vec3(1, 1, 1), lvl ? radial().mul(k).mul(lvl) : radial().mul(k)); m.vertexColors = true; mesh(g, m, name);
}

export function buildUnder(U, addOBB) {
  const { BOX, ox, oz } = U, st = 1.5, NX = Math.ceil((BOX.x1 - BOX.x0) / st) + 1, NZ = Math.ceil((BOX.z1 - BOX.z0) / st) + 1, n = NX * NZ;
  const E = new Float32Array(n), FL = new Float32Array(n), CE = new Float32Array(n), K = new Array(n), LK = new Float32Array(n);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = BOX.x0 + i * st, z = BOX.z0 + j * st, r = U.sampleL(x, z); E[k] = r.e; if (r.e < U.KEEP - 1.5) continue;
    const c = r.k, rr = { ...r }; K[k] = c; LK[k] = r.lake; FL[k] = U.floorL(x, z, rr); CE[k] = U.ceilL(x, z, rr);
  }
  // ---------- rock shell: floor (up) + ceiling (down), 48 x 48-cell tiles, vertex colours with a cheap baked occlusion ----------
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0 }), cA = new THREE.Color(), cB = new THREE.Color();
  const TINT = { crystal: 0x6a5a7a, lake: 0x3e5258, pool: 0x40565a, falls: 0x55605a, cathedral: 0x6e665c, columns: 0x6a6052, shaft: 0x746a5a, glow: 0x4e5258, mouth: 0x6e6658, plain: 0x625a50 };
  const T = 48, at = (i, j) => j * NX + i;
  for (const ceil of [false, true]) for (let tj = 0; tj < NZ - 1; tj += T) for (let ti = 0; ti < NX - 1; ti += T) {
    const i1 = Math.min(NX - 1, ti + T), j1 = Math.min(NZ - 1, tj + T), map = new Map(), P = [], N = [], Cc = [], I = [];
    const vert = (i, j) => {
      const k = at(i, j); let v = map.get(k); if (v !== undefined) return v; v = P.length / 3; map.set(k, v);
      const A = ceil ? CE : FL, x = BOX.x0 + i * st, z = BOX.z0 + j * st, y = A[k], g = (ii, jj) => A[at(Math.max(0, Math.min(NX - 1, ii)), Math.max(0, Math.min(NZ - 1, jj)))];
      const dx = (g(i + 1, j) - g(i - 1, j)) / (2 * st), dz = (g(i, j + 1) - g(i, j - 1)) / (2 * st), nl = Math.hypot(dx, 1, dz);
      P.push(ox + x, y, oz + z); if (ceil) N.push(dx / nl, -1 / nl, dz / nl); else N.push(-dx / nl, 1 / nl, -dz / nl);
      const e = E[k], h = hash2(i * 3 + (ceil ? 7 : 0), j * 5), wall = 1 - sstep(U.MEET, .8, e), kind = K[k] ? K[k].kind : 'plain';
      cA.set(TINT[kind] || TINT.plain); cB.set(ceil ? 0x3c3834 : 0x847a6c); cA.lerp(cB, ceil ? .45 : wall * .45);
      const ao = ceil ? .55 + .45 * sstep(-1, 4, e) : .5 + .5 * sstep(-.5, 3.5, e) * (1 - .25 * wall);
      const wet = LK[k] * .5, f = (.82 + .3 * h) * ao * (1 - wet * .4); cA.multiplyScalar(f); if (wet) cA.lerp(cB.set(0x23343a), wet * .6);
      Cc.push(cA.r, cA.g, cA.b); return v;
    };
    for (let j = tj; j < j1; j++) for (let i = ti; i < i1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1), keep = U.KEEP;
      if (E[a] < keep && E[b] < keep && E[c] < keep && E[d] < keep) continue;
      if (Math.min(E[a], E[b], E[c], E[d]) < keep - 1.5) continue; // a corner never sampled
      const va = vert(i, j), vb = vert(i + 1, j), vc = vert(i, j + 1), vd = vert(i + 1, j + 1);
      if (ceil) I.push(va, vb, vc, vb, vd, vc); else I.push(va, vc, vb, vb, vc, vd);
    }
    if (!I.length) continue;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setIndex(I); g.computeBoundingSphere();
    const o = new THREE.Mesh(g, rock); o.name = ceil ? 'ilalimCeil' : 'ilalimFloor'; o.matrixAutoUpdate = false; UGG.add(o);
  }
  // ---------- walls: OBBs for the bike, Rapier and the walker ----------
  for (const w of U.walls()) addOBB(...w);
  // ---------- props ----------
  const rnd = (a, b) => hash2(Math.round(a * 13.7) + 101, Math.round(b * 7.3) - 57);
  const SM = [], SK = [], COL = [], CRY = [], GW = [], LAMPS = [], BULB = [], PL = [], WARM = [];
  const W = (lx, lz) => ({ x: ox + lx, z: oz + lz }), openL = (lx, lz) => U.sampleL(lx, lz).e;
  // keep the line from a chamber's centre to each of its tunnels clear (you ride through there)
  const onPath = (c, lx, lz) => U.T.some(t => { if (t.A !== c && t.B !== c) return false; const o = t.A === c ? t.B : t.A, mx = t.mx, mz = t.mz, ex = mx - c.x, ez = mz - c.z, l2 = ex * ex + ez * ez, u = Math.max(0, Math.min(1, ((lx - c.x) * ex + (lz - c.z) * ez) / l2)); return Math.hypot(c.x + ex * u - lx, c.z + ez * u - lz) < 6; });
  for (const c of U.C) {
    const kind = c.kind, nS = Math.round(c.r * (kind === 'columns' ? .5 : .8));
    for (let s = 0; s < nS; s++) {
      const a = rnd(c.i, s) * 6.283, d = c.r * (.3 + .6 * rnd(s, c.i + 9)), lx = c.x + Math.cos(a) * d, lz = c.z + Math.sin(a) * d, e = openL(lx, lz); if (e < 1.5 || onPath(c, lx, lz) || (kind === 'lake' && d < c.r * .8)) continue;
      const sz = .5 + 1.2 * rnd(s + 3, c.i), f = U.floorL(lx, lz), cl = U.ceilL(lx, lz), hh = Math.min(cl - f - 1.5, 1.2 + 4 * rnd(c.i + 5, s) * sz);
      if (hh > .6) { const p = W(lx, lz); SM.push({ x: p.x, y: f - .1, z: p.z, sx: sz, sy: hh, sz, ry: a, c: 0xa89c88 }); if (sz > .7) addOBB(p.x, p.z, sz * .5, sz * .5, a, f + 1); }
    }
    if (kind === 'columns') for (let s = 0; s < 14; s++) {
      const a = rnd(c.i + 40, s) * 6.283, d = c.r * (.25 + .6 * rnd(s, c.i + 41)), lx = c.x + Math.cos(a) * d, lz = c.z + Math.sin(a) * d; if (openL(lx, lz) < 3 || onPath(c, lx, lz)) continue;
      const f = U.floorL(lx, lz), cl = U.ceilL(lx, lz), r = .9 + 1.1 * rnd(s, c.i + 42), p = W(lx, lz); COL.push({ x: p.x, y: f - .3, z: p.z, sx: r, sy: cl - f + .6, sz: r, ry: a, c: 0xb0a690 }); addOBB(p.x, p.z, r * .8, r * .8, a, f + 1);
    }
    // stalactites everywhere the ceiling is high enough
    const nK = Math.round(c.r * 1.4);
    for (let s = 0; s < nK; s++) {
      const a = rnd(c.i + 60, s) * 6.283, d = c.r * Math.sqrt(rnd(s, c.i + 61)) * .9, lx = c.x + Math.cos(a) * d, lz = c.z + Math.sin(a) * d; if (openL(lx, lz) < 1) continue;
      const f = U.floorL(lx, lz), cl = U.ceilL(lx, lz), L = Math.min(cl - f - 3.6, .8 + 3.5 * rnd(c.i + 62, s)), w = .3 + .5 * rnd(s, c.i + 63); if (L < .5) continue;
      const p = W(lx, lz); SK.push({ x: p.x, y: cl + .3, z: p.z, sx: w, sy: L + .3, sz: w, ry: a, c: 0x9c917e });
    }
    // crystal clusters along the walls, a coloured pool of light at each
    if (kind === 'crystal' || kind === 'pool' || kind === 'cathedral') {
      const nC = kind === 'crystal' ? Math.round(c.r * .9) : 8, pal = kind === 'pool' ? [[.3, 1, .9]] : [[.45, .9, 1], [.75, .5, 1], [1, .7, .35]];
      for (let s = 0; s < nC; s++) {
        const a = rnd(c.i + 80, s) * 6.283; let lx = c.x, lz = c.z; for (let d = c.r * .4; d < c.r * 1.4; d += .7) { const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d; if (openL(x, z) < 1.6) break; lx = x; lz = z; }
        if (onPath(c, lx, lz)) continue; const col = pal[(rnd(s, c.i + 81) * pal.length) | 0], cc = HDR(col[0], col[1], col[2], 2.4), f = U.floorL(lx, lz), p = W(lx, lz);
        for (let q = 0; q < 4; q++) { const sz = .25 + .45 * rnd(q, s + c.i * 3), qx = p.x + (rnd(q + 5, s) - .5) * 1.6, qz = p.z + (rnd(s, q + 6) - .5) * 1.6; CRY.push({ x: qx, y: U.floor(qx, qz) - .1, z: qz, sx: sz, sy: sz * (1.2 + 1.6 * rnd(q, s)), sz, rx: (rnd(q, s + 2) - .5) * .7, ry: rnd(s, q) * 6.28, c: cc }); }
        PL.push({ x: p.x, z: p.z, sx: 9, sz: 9, c: new THREE.Color(col[0], col[1], col[2]) });
      }
    }
    // glowworms: blue-green dots on the ceiling of the glow chambers and the tunnels next to them
    if (kind === 'glow' || kind === 'cathedral') for (let s = 0; s < c.r * 30; s++) {
      const a = rnd(c.i + 100, s) * 6.283, d = c.r * 1.1 * Math.sqrt(rnd(s, c.i + 101)), lx = c.x + Math.cos(a) * d, lz = c.z + Math.sin(a) * d, e = openL(lx, lz); if (e < .3) continue;
      const p = W(lx, lz), hc = U.ceilL(lx, lz) - U.floorL(lx, lz), sz = (.035 + .05 * rnd(s, c.i + 102)) * (1 + hc / 9); GW.push({ x: p.x, y: U.ceilL(lx, lz) - .05, z: p.z, sx: sz, sy: sz, sz, ry: 0, c: HDR(.35, 1, .8, 1.6 + 1.6 * rnd(c.i, s)) });
    }
  }
  // show-cave lamps: along the tunnels whose both ends are lit chambers, every 15 m, and round the lit chambers
  const LIT = new Set(U.D.lamps || []);
  const lamp = (lx, lz) => { const f = U.floorL(lx, lz), p = W(lx, lz); LAMPS.push({ x: p.x, y: f - .1, z: p.z, sx: .08, sy: 2.4, sz: .08, ry: 0, c: 0x2a2622 }); BULB.push({ x: p.x, y: f + 2.35, z: p.z, sx: .16, sy: .2, sz: .16, ry: 0, c: HDR(1, .78, .45, 2.6) }); WARM.push({ x: p.x, z: p.z, sx: 13, sz: 13, c: 0xffc27a }); };
  for (const t of U.T) if (LIT.has(t.A.id) && LIT.has(t.B.id)) for (let s = t.A.r + 4; s < t.L - t.B.r - 2; s += 15) {
    const f = s < t.l1 ? s / t.l1 : (s - t.l1) / (t.L - t.l1), x0 = s < t.l1 ? t.A.x : t.mx, z0 = s < t.l1 ? t.A.z : t.mz, x1 = s < t.l1 ? t.mx : t.B.x, z1 = s < t.l1 ? t.mz : t.B.z, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, dl = Math.hypot(x1 - x0, z1 - z0) || 1, side = (Math.floor(s / 15) % 2 ? 1 : -1) * (t.w / 2 - 1.2);
    lamp(x - (z1 - z0) / dl * side, z + (x1 - x0) / dl * side);
  }
  for (const c of U.C) if (LIT.has(c.id) && c.kind !== 'mouth') { const m = Math.max(3, Math.round(c.r / 4.5)); for (let s = 0; s < m; s++) { const a = s / m * 6.283 + c.i; let lx = c.x + Math.cos(a) * c.r * .7, lz = c.z + Math.sin(a) * c.r * .7; if (openL(lx, lz) < 2 || onPath(c, lx, lz)) continue; lamp(lx, lz); } }
  const stone = new THREE.MeshStandardMaterial({ roughness: .75 }), cone = new THREE.ConeGeometry(1, 1, 7).translate(0, .5, 0);
  instanced(cone, stone, SM, 'ilalimStalagmites'); instanced(new THREE.ConeGeometry(1, 1, 6).rotateX(Math.PI).translate(0, -.5, 0), stone, SK, 'ilalimStalactites');
  instanced(new THREE.CylinderGeometry(.75, 1, 1, 9).translate(0, .5, 0), stone, COL, 'ilalimColumns');
  instanced(new THREE.OctahedronGeometry(1, 0).scale(.6, 1.6, .6).translate(0, 1.2, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), CRY, 'ilalimCrystals');
  instanced(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), GW, 'ilalimGlowworms');
  instanced(new THREE.CylinderGeometry(1, 1, 1, 5).translate(0, .5, 0), new THREE.MeshStandardMaterial({ roughness: .6, metalness: .4 }), LAMPS, 'ilalimLampPosts');
  instanced(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), BULB, 'ilalimBulbs');
  pools(U, PL, .5, 'ilalimCrystalLight'); pools(U, WARM, .42, 'ilalimLampLight');
  // ---------- water: the lake's shallows and the glowing pool ----------
  for (const c of U.C) if (c.kind === 'lake' || c.kind === 'pool') {
    const lake = c.kind === 'lake', R = c.r * (lake ? .78 : .55), y = c.y + (lake ? -.02 : .12);
    const g = new THREE.CircleGeometry(R, 40).rotateX(-Math.PI / 2).translate(ox + c.x, y, oz + c.z), m = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: .08, metalness: .2, depthWrite: false });
    const w = sin(positionWorld.x.mul(.7).add(time.mul(.8))).mul(sin(positionWorld.z.mul(.9).sub(time.mul(.6)))).mul(.5).add(.5);
    m.colorNode = lake ? vec3(.02, .05, .06) : vec3(.02, .12, .12); m.emissiveNode = (lake ? vec3(.004, .025, .035) : vec3(.03, .35, .32)).mul(w.mul(.5).add(.6)); m.opacityNode = float(lake ? .82 : .7);
    mesh(g, m, lake ? 'ilalimLake' : 'ilalimPool');
    if (!lake) pools(U, [{ x: ox + c.x, z: oz + c.z, sx: R * 2.6, sz: R * 2.6, c: 0x40ffe0 }], .45, 'ilalimPoolLight');
  }
  // ---------- daylight: the way out at the mouth, and the shaft's hole in the roof ----------
  const sp = U.mouth, od = U.outDir;
  { let d = sp.r * .4; while (d < sp.r * 2 && U.sampleL(sp.x + od.x * d, sp.z + od.z * d).e > .6) d += .3; const lx = sp.x + od.x * (d - .4), lz = sp.z + od.z * (d - .4), f = U.floorL(lx, lz), cl = U.ceilL(lx, lz), p = W(lx, lz);
    const g = new THREE.PlaneGeometry(11, cl - f + 2).translate(0, (cl - f + 2) / 2 - .4, 0), m = new THREE.MeshBasicNodeMaterial({ fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const q = uv(), soft = smoothstep(0, .3, q.x).mul(smoothstep(1, .7, q.x)).mul(smoothstep(1, .55, q.y)).mul(smoothstep(0, .08, q.y)); // a glow, not a sheet
    m.colorNode = vec3(1.5, 1.42, 1.2).mul(UGDAY).add(vec3(.06, .08, .16)); m.opacityNode = soft; m.forceSinglePass = true;
    const o = mesh(g, m, 'ilalimDaylight'); o.position.set(p.x, f, p.z); o.rotation.y = Math.atan2(-od.x, -od.z); o.updateMatrix();
    U.daylight = { x: p.x, y: f, z: p.z };
    pools(U, [{ x: p.x - od.x * 4, z: p.z - od.z * 4, sx: 14, sz: 14, c: 0xfff0d8 }], .5, 'ilalimDaylightPool', UGDAY.mul(.9).add(.08)); }
  for (const c of U.C) if (c.kind === 'shaft') {
    const top = c.y + c.h + 2, p = W(c.x, c.z), f = U.floorL(c.x, c.z);
    const disc = new THREE.CircleGeometry(4.5, 24).rotateX(Math.PI / 2).translate(p.x, top - 2.4, p.z), dm = new THREE.MeshBasicNodeMaterial({ fog: false }); dm.colorNode = vec3(1.8, 1.75, 1.55).mul(UGDAY).add(vec3(.04, .06, .12)); mesh(disc, dm, 'ilalimSkyHole');
    const L = top - f, cg = new THREE.CylinderGeometry(4.2, 7.5, L, 20, 1, true).translate(p.x, f + L / 2, p.z), cm = addMat(vec3(1, .96, .85), uv().y.mul(.6).add(.4).mul(normalView.dot(positionView.normalize().negate()).abs().pow(2)).mul(UGDAY).mul(.1)); cm.polygonOffset = false; cm.side = THREE.FrontSide;
    mesh(cg, cm, 'ilalimShaftBeam'); pools(U, [{ x: p.x, z: p.z, sx: 22, sz: 22, c: 0xfff4dc }], .55, 'ilalimShaftPool', UGDAY.mul(.9).add(.05));
  }
  // ---------- the waterfall: a white sheet down the falls chamber's far wall, streaks scrolling down, mist at its foot ----------
  for (const c of U.C) if (c.kind === 'falls') {
    const a = Math.atan2(-c.z, -c.x) + Math.PI; let d = c.r * .5; while (d < c.r * 1.5 && U.sampleL(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d).e > 1.2) d += .3;
    const lx = c.x + Math.cos(a) * (d - .6), lz = c.z + Math.sin(a) * (d - .6), f = U.floorL(lx, lz), cl = U.ceilL(lx, lz), p = W(lx, lz), hgt = cl - f;
    const g = new THREE.PlaneGeometry(6, hgt, 1, 1).translate(0, hgt / 2, 0), m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const s = fract(uv().y.mul(3).add(time.mul(1.1)).add(sin(uv().x.mul(37)).mul(.3))), st2 = smoothstep(0, .5, s).mul(smoothstep(1, .6, s));
    m.colorNode = vec3(.55, .7, .75); m.opacityNode = st2.mul(.45).add(.25).mul(smoothstep(0, .15, uv().x)).mul(smoothstep(1, .85, uv().x));
    const o = mesh(g, m, 'ilalimWaterfall'); o.position.set(p.x, f, p.z); o.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)); o.updateMatrix();
    const pc = new THREE.CircleGeometry(5, 24).rotateX(-Math.PI / 2).translate(p.x - Math.cos(a) * 3, f + .1, p.z - Math.sin(a) * 3), pm = new THREE.MeshStandardMaterial({ color: 0x1a3a44, roughness: .05, transparent: true, opacity: .75, depthWrite: false });
    mesh(pc, pm, 'ilalimFallsPool');
  }
  liteMaterials(UGG); scene.add(UGG);
  return UGG;
}

// The dark passage in the cave hall's side wall: a rock frame round a black opening that fades into the dark, so the wall reads as
// a way in. (The hall's wall box stays: going in is the portal, undergo.js.)
export function buildPortal(U) {
  const P = U.portal, h = U.hall, w = P.w, g = new THREE.Group(), gy = U.hallY;
  const rockM = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: .95 }), dark = new THREE.MeshBasicNodeMaterial({ fog: true });
  const dv = uv(); dark.colorNode = vec3(.012, .011, .01).mul(smoothstep(.0, .5, dv.y).mul(.6).add(.4));
  const at = (a, d) => h.at(a, d), add = (geo, m, a, d, y) => { const o = new THREE.Mesh(geo, m); const p = at(a, d); o.position.set(p.x, gy + y, p.z); o.rotation.y = Math.atan2(-Math.cos(h.ry), Math.sin(h.ry)); g.add(o); return o; };
  add(new THREE.PlaneGeometry(w, 5.2), dark, P.a - .08, P.d, 2.6);                      // the opening (on the wall's inner face, looking into the dark)
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(1.4, 6.2, 1.2), rockM, P.a - .4, P.d + s * (w / 2 + .5), 3.1); // jambs
  add(new THREE.BoxGeometry(w + 2.6, 1.3, 1.3), rockM, P.a - .4, P.d, 5.85);             // lintel
  const ramp = new THREE.Mesh(new THREE.PlaneGeometry(w, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: .7, depthWrite: false })); { const p = at(P.a - 2, P.d); ramp.position.set(p.x, gy + .06, p.z); ramp.rotation.y = Math.atan2(-Math.cos(h.ry), Math.sin(h.ry)); g.add(ramp); }
  g.name = 'ilalimPortal'; g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } }); liteMaterials(g); scene.add(g);
}
