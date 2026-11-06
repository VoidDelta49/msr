// Pedestrians: the brains. Pure logic (no three.js, no DOM) so tools/npc.mjs runs it headless; npcfig.js draws them and handles
// the messages. Everything about WHO they are is data (data/npc.json: archetypes, outfits, what they do, ride settings).
//
// A fixed pool of people lives in a ring around you (spawned 30-105 m away, out of view where possible, removed past 135 m), so
// the whole island feels inhabited for the price of ~20 figures. They walk the sidewalks of every road (both sides, turning
// at road ends, sometimes switching road at a junction or crossing over), come out of and go into the buildings' front doors,
// stop to chat in pairs, squat, look at their phones, stretch, sweep; dog walkers' dogs sniff and sit and make their owner wait.
// They keep out of walls (world OBBs, on a grid), the sea and each other, jump out of the way of a fast bike, sit down dazed
// when you clip one, and wave at you when you walk past. A few of them want a ride ("hail"): stop next to one on a bike with a
// free seat and they hop on behind you; a random building's front door somewhere on the island becomes the drop-off. Stop at
// it and they get off and walk in.
//
// Update cost is bounded: close people think every frame, farther ones every 2nd / 4th frame (their dt accumulates), walls
// come from a 16 m grid, spawn spots from a 32 m grid, people-vs-people only among the close ones.
// Conventions as foot.js: psi 0 faces -z, forward = (-sin psi, -cos psi), right = (cos psi, -sin psi).
import { resolveLook, hasPart, optMask } from './figlook.js';

export const NPC = {
  list: [],      // live people (agents)
  ev: [],        // events for npcfig.js: { k: 'bump' | 'hail' | 'board' | 'arrive' | 'thrown' | 'left' | 'busy' | 'cancel', a, ... }
  ride: null,    // { a, door, t, d0 } while somebody rides with you
  frame: 0, t: 0, target: 0, ready: false, spawned: 0,
};
const A_R = .28; // body radius (m)
let E = null, D = null, rnd = Math.random, SP = [], SPG = new Map(), OG = new Map(), DOORS = [], DG = new Map(), RS = [], FREE = [], uid = 1;
const key = (i, j) => i * 73856093 ^ j * 19349663;
const cellOf = (G, cs, x, z) => G.get(key(Math.floor(x / cs), Math.floor(z / cs)));
function gridAdd(G, cs, o, x0, z0, x1, z1) {
  for (let i = Math.floor(x0 / cs); i <= Math.floor(x1 / cs); i++) for (let j = Math.floor(z0 / cs); j <= Math.floor(z1 / cs); j++) { const k = key(i, j); let L = G.get(k); if (!L) G.set(k, L = []); L.push(o); }
}
function near(G, cs, x, z, r, out) { // everything in the cells overlapping the square x±r, z±r
  out.length = 0; const seen = out.seen || (out.seen = new Set()); seen.clear();
  for (let i = Math.floor((x - r) / cs); i <= Math.floor((x + r) / cs); i++) for (let j = Math.floor((z - r) / cs); j <= Math.floor((z + r) / cs); j++) {
    const L = G.get(key(i, j)); if (L) for (const o of L) if (!seen.has(o)) { seen.add(o); out.push(o); }
  }
  return out;
}
const tmpL = [], tmpL2 = [];

// push the circle P (x, z) out of box b (world.js OBB format, as foot.js); true if it touched
function resolve(P, b, r) {
  const dx = P.x - b.cx, dz = P.z - b.cz; if (Math.abs(dx) > b.hx + b.hz + r || Math.abs(dz) > b.hx + b.hz + r) return false;
  const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c; if (Math.abs(lx) >= b.hx + r || Math.abs(lz) >= b.hz + r) return false;
  const qx = Math.max(-b.hx, Math.min(b.hx, lx)), qz = Math.max(-b.hz, Math.min(b.hz, lz)); let nx = lx - qx, nz = lz - qz, push; const d = Math.hypot(nx, nz);
  if (d > 1e-6) { if (d >= r) return false; push = r - d; nx /= d; nz /= d; }
  else { const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz); if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; } }
  P.x += (b.c * nx - b.s * nz) * push; P.z += (b.s * nx + b.c * nz) * push; return true;
}
const walls = (P, r) => { let hit = false; const L = cellOf(OG, 16, P.x, P.z); if (L) for (const b of L) if (resolve(P, b, r)) hit = true; return hit; };
const clearAt = (x, z, r = A_R) => { const P = { x, z }; return !walls(P, r); };
const wet = (x, z) => E.H(x, z) < E.SEA + .15;
const turn = (o, want, k) => { const d = want - o.psi; o.psi += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, k); };

/* ---------- world setup ---------- */
// e = { H, SEA, OBBS, ROADS, DOORS: [{ x, z, ix, iz, t, n }], data (npc.json), rand }
export function npcEnv(e) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0; E = e; D = e.data; rnd = e.rand || Math.random; NPC.list.length = 0; NPC.ev.length = 0; NPC.ride = null; FREE.length = 0; uid = 1; NPC.frame = 0; NPC.t = 0;
  OG = new Map(); SPG = new Map(); DG = new Map(); SP = []; RS = []; DOORS = [];
  for (const b of e.OBBS || []) { const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hz + 1, ez = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hz + 1; gridAdd(OG, 16, b, b.cx - ex, b.cz - ez, b.cx + ex, b.cz + ez); }
  // doors: keep the ones whose front step is dry, flat enough and not inside another wall
  for (const d of e.DOORS || []) {
    if (!Number.isFinite(d.x) || !Number.isFinite(d.z) || wet(d.x, d.z) || !clearAt(d.x, d.z, .3) || Math.abs(E.H(d.x, d.z) - E.H(d.ix, d.iz)) > 1.6) continue;
    const o = { ...d, id: DOORS.length }; DOORS.push(o); gridAdd(DG, 32, o, d.x, d.z, d.x, d.z);
  }
  // sidewalks: both sides of every road (not the airstrip), a point every ~2 samples; ok[] = a person can stand there
  (e.ROADS || []).forEach((r, ri) => {
    if (r.kind === 'strip' || !r.s || r.s.length < 3) return; const n = r.s.length, nx = new Float32Array(n), nz = new Float32Array(n), off = r.bridge ? r.w / 2 - .7 : r.w / 2 + 1.1;
    for (let i = 0; i < n; i++) { const a = r.s[Math.max(0, i - 1)], b = r.s[Math.min(n - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; nx[i] = -(b.z - a.z) / l; nz[i] = (b.x - a.x) / l; }
    const R = { r, ri, n, nx, nz, off, cl: !!r.closed, ok: [new Uint8Array(n), new Uint8Array(n)] }; RS.push(R);
    for (const sd of [0, 1]) for (let i = 0; i < n; i++) {
      const p = side(R, i, sd); if (wet(p.x, p.z) || !clearAt(p.x, p.z) || Math.abs(E.H(p.x, p.z) - r.s[i].h) > 1) continue; R.ok[sd][i] = 1;
      if (i % 3 === 0) { const o = { x: p.x, z: p.z, R, i, sd, w: .3 }; SP.push(o); gridAdd(SPG, 32, o, p.x, p.z, p.x, p.z); }
    }
  });
  for (const o of SP) { near(DG, 32, o.x, o.z, 40, tmpL); if (tmpL.some(d => Math.hypot(d.x - o.x, d.z - o.z) < 40)) o.w = 1; } // busier where there are buildings
  for (const d of DOORS) { const o = { x: d.x, z: d.z, door: d, w: .8 }; SP.push(o); gridAdd(SPG, 32, o, d.x, d.z, d.x, d.z); }
  NPC.ready = true; NPC.sp = SP.length; NPC.doors = DOORS.length; NPC.envMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
}
const SIDE = { x: 0, z: 0 };
function side(R, i, sd, out = SIDE) { const s = R.r.s[i], k = (sd ? 1 : -1) * R.off; out.x = s.x + R.nx[i] * k; out.z = s.z + R.nz[i] * k; return out; }
export const npcDoors = () => DOORS;

/* ---------- people ---------- */
const pickW = (obj, f = v => v) => { let t = 0; for (const k in obj) t += Math.max(0, f(obj[k], k)); let x = rnd() * t; for (const k in obj) { x -= Math.max(0, f(obj[k], k)); if (x <= 0) return k; } return Object.keys(obj)[0]; };
const rr = a => Array.isArray(a) ? a[0] + rnd() * (a[1] - a[0]) : a;
const oneOf = L => L && L.length ? L[(rnd() * L.length) | 0] : '';
function newAgent(arch, x, z) {
  const A = D.archetypes[arch], a = FREE.pop() || {}, lk = resolveLook(A, D.palettes, rnd);
  Object.assign(a, {
    id: uid++, arch, name: oneOf(A.names) || A.name, x, z, y: E.H(x, z), psi: rnd() * 6.283, vx: 0, vz: 0, spd: 0, ph: rnd() * 6.283,
    pal: lk.pal, mask: lk.mask, base: lk.mask, sx: rr(A.wd || 1), sy: rr(A.h || 1), pace: rr(A.speed || [1.1, 1.4]), run: !!A.run,
    st: 'walk', act: '', t: 0, dur: 0, R: null, i: 0, sd: 0, dir: 1, tx: x, tz: z, door: null, enter: false, sink: 0, hail: false, wt: 0, seen: false,
    acc: 0, gone: false, mate: null, bumpT: 0, waveT: 0, dog: null, stuck: 0, vis: true, dist: 0, k: 0, busyT: 0,
  });
  if (A.pet === 'dog') {
    const G = D.dog, dl = resolveLook({ look: { skin: G.fur, fur2: G.fur2, top: G.collar, dark: '#1d1a18' } }, D.palettes, rnd);
    a.dog = { x: x + .8, z, y: a.y, psi: a.psi, ph: 0, spd: 0, st: 'walk', t: 0, pal: dl.pal, sc: rr(G.size || 1) };
  } else a.dog = null;
  NPC.list.push(a); NPC.spawned++; return a;
}
function kill(a) { a.gone = true; if (a.mate) { a.mate.mate = null; if (a.mate.st === 'act') a.mate.t = a.mate.dur; } const k = NPC.list.indexOf(a); if (k >= 0) NPC.list.splice(k, 1); FREE.push(a); }

// join the nearest free sidewalk point within r metres (walking mode); false if none
function joinWalk(a, r = 30) {
  near(SPG, 32, a.x, a.z, r, tmpL); let best = null, bd = r * r;
  for (const o of tmpL) { if (!o.R) continue; const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d < bd) { bd = d; best = o; } }
  if (!best) return false; a.R = best.R; a.i = best.i; a.sd = best.sd; a.dir = rnd() < .5 ? 1 : -1; a.st = 'walk'; setTarget(a, best.i); return true;
}
function setTarget(a, i) { const p = side(a.R, i, a.sd); a.i = i; a.tx = p.x; a.tz = p.z; }
// next sidewalk point along the road (2 samples on); turn round at the road's end or where the sidewalk stops
function advance(a) {
  const R = a.R, n = R.n; let j = a.i + a.dir * 2;
  if (R.cl) j = ((j % n) + n) % n;
  if (j < 0 || j >= n || !R.ok[a.sd][j]) { a.dir = -a.dir; j = a.i + a.dir * 2; if (R.cl) j = ((j % n) + n) % n; if (j < 0 || j >= n || !R.ok[a.sd][j]) { j = a.i; a.st = 'act'; startAct(a, 'look'); } }
  setTarget(a, j);
}
function startAct(a, act, dur) {
  const ad = D.acts[act] || { dur: [3, 6] }; a.st = 'act'; a.act = act; a.t = 0; a.dur = dur ?? rr(ad.dur); a.spd = 0;
  a.mask = a.base | (ad.parts ? optMask(ad.parts) : 0);
}
function endAct(a) { a.mask = a.base; a.act = ''; if (a.mate) { a.mate.mate = null; a.mate = null; } if (a.R) { a.st = 'walk'; advance(a); } else if (!joinWalk(a)) startAct(a, 'idle'); else a.st = 'walk'; }
// something to do at a sidewalk point: stop for an activity, chat with somebody close, go into a building, cross, change road
function decide(a) {
  const A = D.archetypes[a.arch], dd = D.doors || {};
  if (a.dog && a.dog.st === 'sniff') { startAct(a, 'look', 1.5); return; }
  const u = rnd();
  if (u < (dd.enter ?? .12) * .5) { // a door close by: walk in
    near(DG, 32, a.x, a.z, dd.near ?? 14, tmpL); const L = tmpL.filter(d => Math.hypot(d.x - a.x, d.z - a.z) < (dd.near ?? 14));
    if (L.length) { a.door = oneOf(L); a.enter = true; a.st = 'door'; a.tx = a.door.x; a.tz = a.door.z; return; }
  }
  if (u < .2 && A.acts) {
    const act = pickW(A.acts);
    if (D.acts[act] && D.acts[act].pair) { // somebody within 9 m comes over for a chat
      const m = NPC.list.find(b => b !== a && !b.mate && (b.st === 'walk' || (b.st === 'act' && b.act !== 'chat')) && !b.hail && !b.dog && Math.hypot(b.x - a.x, b.z - a.z) < 9);
      if (!m) return advance(a); startAct(a, 'look', 12); a.mate = m; m.mate = a; m.st = 'meet'; m.t = 0; m.mask = m.base; m.act = ''; return;
    }
    startAct(a, act); return;
  }
  if (u < .24 && !a.R.r.hwy) { a.sd ^= 1; setTarget(a, a.i); return; } // cross the road
  if (u < .34) { // another road's sidewalk right here (a junction): take it
    near(SPG, 32, a.x, a.z, 7, tmpL); const L = tmpL.filter(o => o.R && o.R !== a.R && Math.hypot(o.x - a.x, o.z - a.z) < 7);
    if (L.length) { const o = oneOf(L); a.R = o.R; a.sd = o.sd; a.dir = rnd() < .5 ? 1 : -1; setTarget(a, o.i); return; }
  }
  advance(a);
}
function pair(a, b) {
  const dur = rr(D.acts.chat.dur); startAct(a, 'chat', dur); startAct(b, 'chat', dur); a.mate = b; b.mate = a;
  a.psi = Math.atan2(a.x - b.x, a.z - b.z); b.psi = Math.atan2(b.x - a.x, b.z - a.z); // face each other (forward = -(sin, cos))
}

/* ---------- spawning ---------- */
// W.cam = { x, z, fx, fz } (camera position + flat forward): spots in view closer than range.hidden are skipped (no popping in)
function spawnOne(W) {
  const rg = D.range, night = W.night;
  for (let k = 0; k < 6; k++) {
    const an = rnd() * 6.283, rad = rg.spawnMin + rnd() * (rg.spawnMax - rg.spawnMin), cx = W.x + Math.sin(an) * rad, cz = W.z + Math.cos(an) * rad;
    near(SPG, 32, cx, cz, 16, tmpL); if (!tmpL.length) continue; const o = oneOf(tmpL), d = Math.hypot(o.x - W.x, o.z - W.z);
    if (d < rg.spawnMin || d > rg.spawnMax || rnd() > o.w) continue;
    if (W.cam && !o.door && d < rg.hidden) { const vx = o.x - W.cam.x, vz = o.z - W.cam.z, l = Math.hypot(vx, vz) || 1; if ((vx * W.cam.fx + vz * W.cam.fz) / l > .35) continue; }
    if (NPC.list.some(b => Math.abs(b.x - o.x) < 3 && Math.abs(b.z - o.z) < 3)) continue;
    const arch = pickW(D.archetypes, (A) => (A.w || 1) * (night ? (A.night ?? 1) : 1)), a = newAgent(arch, o.x, o.z);
    if (o.door) { // comes out of the building
      a.x = o.door.ix; a.z = o.door.iz; a.st = 'exit'; a.door = o.door; a.tx = o.door.x; a.tz = o.door.z; a.sink = .9; a.y = E.H(o.door.x, o.door.z);
      if (a.dog) { a.dog.x = a.x; a.dog.z = a.z; }
    } else {
      a.R = o.R; a.sd = o.sd; a.dir = rnd() < .5 ? 1 : -1; setTarget(a, o.i); a.x = o.x; a.z = o.z; if (a.dog) { a.dog.x = o.x + .7; a.dog.z = o.z; }
      const A = D.archetypes[arch], ri = D.ride, hails = NPC.list.filter(b => b.hail).length;
      if (!a.dog && rnd() < (A.hail || 0) && hails < (ri.maxHail ?? 3) && !o.R.r.hwy) { a.hail = true; a.st = 'hail'; a.psi = Math.atan2(o.R.nx[o.i] * (o.sd ? 1 : -1), o.R.nz[o.i] * (o.sd ? 1 : -1)); }
      else if (rnd() < .3 && A.acts) startAct(a, pickW(A.acts)); // already busy when you get there
      if (a.st === 'act' && D.acts[a.act] && D.acts[a.act].pair) { // found mid-chat: a friend (same kind of person) stands with them
        const bx = a.x + o.R.nz[o.i] * 1.1, bz = a.z - o.R.nx[o.i] * 1.1; // a step along the sidewalk
        if (!a.dog && NPC.list.length < W.cap && clearAt(bx, bz) && !wet(bx, bz)) { const b = newAgent(arch, bx, bz); b.R = o.R; b.sd = o.sd; b.i = o.i; b.dir = -a.dir; b.y = E.H(bx, bz); pair(a, b); if (b.dog) { b.dog.x = bx; b.dog.z = bz + .8; } }
        else startAct(a, 'idle');
      }
    }
    a.y = E.H(a.x, a.z); return a;
  }
  return null;
}

/* ---------- one step ---------- */
// W = { x, z: who the crowd is around (you), cap: how many people, night, cam?: {x, z, fx, fz},
//       bike: { x, z, psi, v, crashed, seat: a passenger can get on, busy: '' or why not }, foot: { on, x, z } }
const fw = { x: 0, z: 0 }, P = { x: 0, z: 0 };
export function npcStep(dt, W) {
  if (!NPC.ready || !D) return; NPC.frame++; NPC.t += dt; dt = Math.min(dt, .1);
  const rg = D.range, L = NPC.list; NPC.target = W.cap;
  // spawn toward the target count (fast when nearly empty, e.g. after a teleport), cull the far and the surplus
  let budget = L.length < W.cap * .5 ? 8 : (NPC.frame % 12 === 0 ? 1 : 0);
  while (budget-- > 0 && L.length < W.cap) if (!spawnOne(W)) break;
  for (let k = L.length - 1; k >= 0; k--) {
    const a = L[k], d = Math.hypot(a.x - W.x, a.z - W.z); a.dist = d;
    if (a.st === 'ride' || a.st === 'board') continue;
    if (d > rg.despawn * (a.hail ? 1.3 : 1) || (L.length > W.cap + 2 && d > rg.hidden && !a.vis && !a.hail)) kill(a);
  }
  const B = W.bike, F = W.foot || { on: false };
  fw.x = -Math.sin(B.psi); fw.z = -Math.cos(B.psi); const rx = Math.cos(B.psi), rz = -Math.sin(B.psi), bv = Math.abs(B.v);
  for (const a of L.slice()) {
    if (a.gone) continue;
    // level of detail: think every frame up close, every 2nd / 4th frame farther out (dt accumulates, nothing is lost)
    a.acc += dt; const every = a.dist < rg.near || a.st === 'ride' || a.st === 'board' ? 1 : a.dist < rg.mid ? 2 : 4;
    if ((NPC.frame + a.id) % every) continue; const h = Math.min(a.acc, .25); a.acc = 0;
    think(a, h, W, B, F, rx, rz, bv);
  }
  // people keep apart (close ones only: n is small)
  for (let i = 0; i < L.length; i++) {
    const a = L[i]; if (a.dist > rg.near || a.st === 'ride') continue;
    for (let j = i + 1; j < L.length; j++) {
      const b = L[j]; if (b.dist > rg.near || b.st === 'ride' || a.mate === b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz; if (d2 > .36 || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), p = (.6 - d) * .5 / d; a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p;
    }
    if (F.on) { const dx = a.x - F.x, dz = a.z - F.z, d = Math.hypot(dx, dz); if (d < .62 && d > 1e-6) { a.x += dx / d * (.62 - d); a.z += dz / d * (.62 - d); } }
  }
}

function moveTo(a, h, sp) { // walk toward (tx, tz) at sp; turn smoothly; walls and the sea; returns the distance left
  const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
  if (d < 1e-4) { a.spd = 0; return 0; }
  turn(a, Math.atan2(-dx, -dz), h * 8);
  const st = Math.min(d, sp * h), ox = a.x, oz = a.z; P.x = a.x + dx / d * st; P.z = a.z + dz / d * st;
  walls(P, A_R);
  if (wet(P.x, P.z)) { a.spd = 0; a.stuck += h; return d; }
  a.x = P.x; a.z = P.z; const moved = Math.hypot(a.x - ox, a.z - oz); a.spd = moved / Math.max(h, 1e-4);
  a.ph += moved * 3.7 / a.sy; a.stuck = moved < st * .3 ? a.stuck + h : Math.max(0, a.stuck - h);
  return Math.hypot(a.tx - a.x, a.tz - a.z);
}

function think(a, h, W, B, F, rx, rz, bv) {
  const ri = D.ride; a.t += h; a.bumpT = Math.max(0, a.bumpT - h); a.waveT = Math.max(0, a.waveT - h);
  // ---- the bike: out of the way, or knocked over ----
  if (a.st !== 'ride' && a.st !== 'board' && a.st !== 'fall' && !F.on && !B.crashed) {
    const dx = a.x - B.x, dz = a.z - B.z, al = dx * fw.x + dz * fw.z, lat = dx * rx + dz * rz, d = Math.hypot(dx, dz);
    if (d < .8 && bv > 2.2 && !a.bumpT) {
      a.st = 'fall'; a.act = 'dazed'; a.t = 0; a.dur = 2.6; a.spd = 0; a.bumpT = 4; const s = Math.sign(lat) || 1; a.x += rx * s * .7; a.z += rz * s * .7; a.psi = B.psi + (s > 0 ? -1.57 : 1.57);
      NPC.ev.push({ k: 'bump', a }); if (NPC.ride && NPC.ride.a === a) NPC.ride = null; return;
    }
    if (bv > 2.5 && al > -.5 && al < Math.max(4, bv * 1.5) && Math.abs(lat) < 1.5 && a.st !== 'dodge' && a.st !== 'door' && a.st !== 'exit') {
      const s = Math.abs(lat) > .05 ? Math.sign(lat) : (rnd() < .5 ? -1 : 1);
      if (a.mate) { a.mate.mate = null; a.mate = null; } a.mask = a.base;
      a.st = 'dodge'; a.act = 'flinch'; a.t = 0; a.tx = a.x + rx * s * 2.2 - fw.x * .3; a.tz = a.z + rz * s * 2.2 - fw.z * .3;
    }
  }
  switch (a.st) {
    case 'walk': {
      if (!a.R) { if (!joinWalk(a)) startAct(a, 'idle'); break; }
      const sp = a.dog && a.dog.st === 'sniff' ? 0 : a.pace; if (!sp) { a.spd = 0; break; }
      const left = moveTo(a, h, sp);
      if (left < .5 || a.stuck > 2.5) { a.stuck = 0; decide(a); }
      // you, walking past: a wave now and then
      if (F.on && !a.waveT && Math.hypot(a.x - F.x, a.z - F.z) < 3.2 && rnd() < .3) { a.waveT = 25; startAct(a, 'wave'); a.psi = Math.atan2(a.x - F.x, a.z - F.z); }
      break;
    }
    case 'act': {
      a.spd = 0; if (a.mate && a.mate.gone) a.mate = null;
      if (a.t >= a.dur) endAct(a);
      break;
    }
    case 'meet': { // walking over to a chat
      const m = a.mate; if (!m || m.gone || m.mate !== a) { a.mate = null; if (!a.R || !joinWalk(a, 20)) startAct(a, 'idle'); else a.st = 'walk'; break; }
      const dx = a.x - m.x, dz = a.z - m.z, d = Math.hypot(dx, dz) || 1; a.tx = m.x + dx / d * 1.1; a.tz = m.z + dz / d * 1.1;
      if (moveTo(a, h, a.pace) < .3) pair(a, m); else if (a.t > 10) { a.mate = null; m.mate = null; if (m.st === 'act') m.t = m.dur; a.st = 'walk'; if (a.R) setTarget(a, a.i); }
      break;
    }
    case 'dodge': {
      moveTo(a, h, 3.4); if (a.t > .75) { a.act = ''; if (a.hail) { a.st = 'hail'; } else if (a.R) { a.st = 'walk'; setTarget(a, a.i); } else if (!joinWalk(a)) startAct(a, 'idle'); }
      break;
    }
    case 'fall': { a.spd = 0; if (a.t > a.dur) { a.act = ''; if (a.hail) a.st = 'hail'; else if (!a.R || !joinWalk(a, 20)) startAct(a, 'idle'); else a.st = 'walk'; } break; }
    case 'exit': { // out of the door onto the step, then the nearest sidewalk
      a.sink = Math.max(0, a.sink - h * 1.2); const left = moveTo(a, h, a.pace);
      if (left < .4 || a.t > 12) { a.sink = 0; a.door = null; if (!joinWalk(a, 35)) startAct(a, 'idle'); }
      break;
    }
    case 'door': { // to the front step, then in (sinking out of sight through the doorway)
      if (!a.enter) { a.st = 'walk'; break; }
      const left = moveTo(a, h, a.pace);
      if (left < .45 || a.t > 25) { a.st = 'enter'; a.t = 0; a.tx = a.door.ix; a.tz = a.door.iz; }
      break;
    }
    case 'enter': {
      const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz); a.psi = Math.atan2(-dx, -dz);
      if (d > .02) { const st = Math.min(d, a.pace * h); a.x += dx / d * st; a.z += dz / d * st; a.ph += st * 3.7; a.spd = a.pace; }
      a.sink = Math.min(2, a.sink + h * 1.1); if (a.dog) { a.dog.x += (a.x - a.dog.x) * Math.min(1, h * 4); a.dog.z += (a.z - a.dog.z) * Math.min(1, h * 4); }
      if (a.sink > 1.95 || a.t > 4) { if (NPC.ride && NPC.ride.a === a) NPC.ride = null; kill(a); return; }
      break;
    }
    case 'hail': hailTick(a, h, W, B, F, ri); break;
    case 'board': {
      const s = -1, tx = B.x + rx * s * .95, tz = B.z + rz * s * .95; a.tx = tx; a.tz = tz; // to the bike's left, the side people get on
      const d = Math.hypot(B.x - a.x, B.z - a.z);
      if (bv > 3 || d > ri.reach + 5 || B.crashed || F.on || !B.seat) { a.st = 'hail'; a.wt = 0; NPC.ev.push({ k: 'cancel', a }); break; }
      const left = moveTo(a, h, 2.2); if (left < .45 || a.t > 6) board(a, B);
      break;
    }
    case 'ride': rideTick(a, h, B, F, ri, rx, rz); break;
  }
  if (a.st !== 'ride') a.y = E.H(a.x, a.z);
  if (a.dog && a.st !== 'ride') dogTick(a, h);
}

function hailTick(a, h, W, B, F, ri) {
  a.spd = 0; const d = Math.hypot(a.x - B.x, a.z - B.z);
  a.k = Math.max(0, 1 - d / ri.seen); // waving harder as you come
  if (!a.seen && d < ri.seen && !F.on && !NPC.ride) { a.seen = true; NPC.ev.push({ k: 'hail', a }); }
  if (!NPC.ride && !F.on && !B.crashed && d < ri.reach && Math.abs(B.v) < 1.5) {
    if (B.busy) { if (!a.busyT || NPC.t - a.busyT > 12) { a.busyT = NPC.t; NPC.ev.push({ k: 'busy', a, why: B.busy }); } a.wt = 0; return; }
    a.wt += h; if (a.wt > ri.wait) { a.st = 'board'; a.t = 0; a.mask = a.base; }
  } else a.wt = 0;
  if (d < ri.seen * .6) turn(a, Math.atan2(a.x - B.x, a.z - B.z), h * 3); // turn to face you
}
// on the seat: off to a random front door somewhere on the island, between ride.distMin and distMax from here
function board(a, B) {
  const ri = D.ride; let best = null, tries = 0;
  while (!best && tries++ < 60) { const d = oneOf(DOORS); if (!d) break; const L = Math.hypot(d.x - B.x, d.z - B.z); if (L > ri.distMin && L < ri.distMax) best = d; }
  if (!best) { let bd = -1; for (const d of DOORS) { const L = Math.hypot(d.x - B.x, d.z - B.z); if (L > bd && L < ri.distMax * 1.5) { bd = L; best = d; } } }
  if (!best) { a.st = 'hail'; return; }
  a.st = 'ride'; a.hail = false; a.mask = a.base; a.t = 0; a.spd = 0; if (a.mate) { a.mate.mate = null; a.mate = null; }
  NPC.ride = { a, door: best, t: 0, d0: Math.hypot(best.x - B.x, best.z - B.z) }; NPC.ev.push({ k: 'board', a, door: best });
}
function rideTick(a, h, B, F, ri, rx, rz) {
  const R = NPC.ride; if (!R || R.a !== a) { off(a, B, rx, rz, 'walk'); return; }
  R.t += h; a.x = B.x; a.z = B.z; a.psi = B.psi;
  const dd = Math.hypot(B.x - R.door.x, B.z - R.door.z);
  if (B.crashed) { NPC.ride = null; off(a, B, rx, rz, 'fall'); a.x += rx * -1.2; a.z += rz * -1.2; NPC.ev.push({ k: 'thrown', a }); return; }
  if (!B.seat) { NPC.ride = null; off(a, B, rx, rz, 'walk'); NPC.ev.push({ k: 'left', a }); return; }
  if (dd < ri.stopR && (Math.abs(B.v) < 1.5 || F.on)) { // there: off, and in through the front door
    const km = (R.d0 || dd) / 1000, fare = Math.round(((ri.fareBase || 40) + km * (ri.farePerKm || 18)) / 5) * 5; NPC.ride = null;
    off(a, B, rx, rz, 'door'); a.door = R.door; a.enter = true; a.tx = R.door.x; a.tz = R.door.z; NPC.ev.push({ k: 'arrive', a, door: R.door, fare }); return;
  }
  if (F.on) { NPC.ride = null; off(a, B, rx, rz, 'walk'); NPC.ev.push({ k: 'left', a }); }
}
function off(a, B, rx, rz, st) {
  a.x = B.x - rx * .9; a.z = B.z - rz * .9; P.x = a.x; P.z = a.z; walls(P, A_R); a.x = P.x; a.z = P.z; a.y = E.H(a.x, a.z); a.hail = false;
  a.st = st; a.t = 0; a.R = null; if (st === 'fall') { a.act = 'dazed'; a.dur = 2.8; a.bumpT = 4; } else if (st === 'walk' && !joinWalk(a, 35)) startAct(a, 'idle');
  if (a.dog) { a.dog.x = a.x; a.dog.z = a.z; }
}

// the dog: trots at heel on the owner's left, sniffs now and then (the owner waits), sits when the owner stops
function dogTick(a, h) {
  const g = a.dog; g.t += h; const r = 1.5 * a.sx, fx = -Math.sin(a.psi), fz = -Math.cos(a.psi), lx = -Math.cos(a.psi), lz = Math.sin(a.psi);
  const tx = a.x + lx * .75 + fx * .35, tz = a.z + lz * .75 + fz * .35, dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
  const owner = a.spd > .2;
  if (g.st === 'sniff') { if (g.t > 2.2 || Math.hypot(a.x - g.x, a.z - g.z) > 2.4) { g.st = 'walk'; g.t = 0; } }
  else if (owner && g.t > 4 && rnd() < h * .12) { g.st = 'sniff'; g.t = 0; }
  else g.st = owner || d > .5 ? 'walk' : (g.t > 3 ? 'sit' : 'stand');
  if (g.st === 'walk' && d > .05) {
    const sp = Math.min(d * 3, (D.dog.speed || 1.35) * (d > 1 ? 2 : 1)), st = Math.min(d, sp * h), ox = g.x, oz = g.z; P.x = g.x + dx / d * st; P.z = g.z + dz / d * st; walls(P, .2);
    if (!wet(P.x, P.z)) { g.x = P.x; g.z = P.z; } const mv = Math.hypot(g.x - ox, g.z - oz); g.spd = mv / h; g.ph += mv * 6; if (mv > .002) g.psi = Math.atan2(-(g.x - ox), -(g.z - oz));
    if (g.st !== 'walk') g.t = 0;
  } else { g.spd = 0; if (g.st !== 'sniff') turn(g, Math.atan2(g.x - a.x, g.z - a.z), h * 2); }
  if (Math.hypot(a.x - g.x, a.z - g.z) > r * 2) { g.x = a.x + lx * .75; g.z = a.z + lz * .75; } // never further than the leash
  g.y = E.H(g.x, g.z);
}

// a person's pose name + strength for this frame (npcfig.js); hidden people (riding: drawn on the bike) return ''
export function poseOf(a) {
  switch (a.st) {
    case 'ride': return '';
    case 'act': return a.act;
    case 'fall': return 'dazed';
    case 'dodge': return 'flinch';
    case 'hail': return a.wt > 0 ? 'wave' : 'hail';
    default: return a.spd > .15 ? (a.run || a.spd > 2.4 ? 'run' : 'walk') : 'stand';
  }
}
export const npcHasPart = hasPart;
// clear everybody (map reload, tests)
export function npcClear() { for (const a of NPC.list.slice()) kill(a); NPC.ride = null; NPC.ev.length = 0; }
