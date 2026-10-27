// Passengers (multiplayer). A rider standing next to a friend's bike taps the friend's name tag: RIDE asks through the relay, the
// driver gets OK / ✕. Two kinds of seat, picked by what the driver is riding (kindOf):
//   trike   a TMX with the sidecar fitted: two places on the sidecar bench (little seated figures), each adds 65 kg to the sidecar;
//   pillion any other bike: one place behind the rider. The passenger is the rider's own mesh again, shifted back onto the seat and
//           recoloured (model.js pillionGeo: shares the rider's buffers, one extra draw call). 65 kg sit behind the rider, so the
//           driver's centre of mass moves back and up (spec.js withPassenger): slower launch, earlier wheelies, longer braking.
// The passenger's own bike is put away (packets carry flag 32 so everyone hides it) and their view follows the driver's ghost; GET OFF
// puts their bike back down beside the driver. The driver owns the seat list and broadcasts it (t:'ride', op:'seats'; a pillion bike
// only ever uses seats[0], so the relay needs no change), so every phone draws the passengers on that bike.
// Crash: the driver's phone decides it (as always); everybody aboard is flung out cartoon-style on every phone that
// sees it (ballistic arcs with low gravity, spin, squashy bounces, stars), and the driver's own ragdoll gets an extra-big launch.
// Passengers end up where they landed, on foot next to their bike.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, ctx } from './state.js';
import { NET, send } from './net.js';
import { B, pillionGeo, MPax } from './model.js';
import { scene } from './renderer.js';
import { H } from './world.js';
import { MI } from './missions.js';
import { say } from './hud.js';
import { blip } from './audio.js';
import { syncBody, setMass } from './rapier.js';
import { withPassenger } from './spec.js';
import { F } from './foot.js';
import { $, clamp } from './util.js';

const SEATS = [[.76, .34], [1.18, .34]], SEAT_Y = .57; // bench places in bike (ct) coordinates: x, z; bench top height
const PAX_KG = 65, NEAR = 9, ASK_MS = 15000, FLY_S = 3.2;
const R = { seats: [0, 0], on: null, ask: null, inb: null, bcT: 0, sentK: '', ejectAt: 0, wasCr: false, camPos: null, kind: '', bike: '' };
ctx.ride = null;

/* ---------- little seated passengers: one vertex-coloured mesh each ---------- */
const MFig = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .65, metalness: .05 });
const SHIRT = ['#e8463a', '#f2c230', '#3aa0e8', '#56c46a', '#c060d0', '#f08a30', '#f1f1ec', '#2b2d33'];
const GEO = new Map();
function figGeo(id) {
  const k = id % SHIRT.length; if (GEO.has(k)) return GEO.get(k);
  const P = [], add = (g, c, x, y, z, rx = 0) => { g.rotateX(rx).translate(x, y, z); const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); P.push(g.index ? g.toNonIndexed() : g); };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), sh = SHIRT[k], jn = '#2d3d63', sk = '#c99a6e';
  for (const s of [-1, 1]) {
    add(box(.12, .12, .34), jn, s * .08, .06, -.15); add(box(.1, .3, .1), jn, s * .08, -.09, -.33); add(box(.1, .06, .16), '#e9e6df', s * .08, -.22, -.37);
    add(box(.08, .28, .08), sh, s * .19, .27, -.07, .55); add(box(.07, .07, .07), sk, s * .19, .16, -.17);
  }
  add(box(.3, .4, .19), sh, 0, .3, .02); add(new THREE.IcosahedronGeometry(.12, 1), sk, 0, .62, 0); add(box(.2, .07, .2), '#1d1a18', 0, .7, .02);
  add(box(.04, .03, .02), '#1d1a18', -.045, .63, -.11); add(box(.04, .03, .02), '#1d1a18', .045, .63, -.11); // eyes
  for (const g of P) { for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(n)) g.deleteAttribute(n); }
  const g = mergeGeometries(P); GEO.set(k, g); return g;
}
const FIG = new Map(); // key `${hostId}/${seat}` -> mesh
function fig(key, id) { let m = FIG.get(key); if (!m || m.userData.id !== id || m.userData.src) { if (m) m.removeFromParent(); m = new THREE.Mesh(figGeo(id), MFig); m.castShadow = true; m.userData.id = id; FIG.set(key, m); } return m; }
// the pillion: the host's rider mesh (its own geometry, so a rebuilt model gets a fresh one) in other colours; hip = the pivot it is flung from
function pax(key, id, host) {
  const src = host.rider && host.rider[0] && host.rider[0].geometry, p = host.G && host.G.pil; if (!src || !p) return null;
  let m = FIG.get(key);
  if (!m || m.userData.id !== id || m.userData.src !== src) {
    if (m) m.removeFromParent(); m = new THREE.Mesh(pillionGeo(src, id), MPax); m.castShadow = false; // like the rider: bikes draw a contact blob instead of casting
    m.userData = { id, src, hip: new THREE.Vector3(0, p.hip[0], p.hip[1]) }; FIG.set(key, m);
  }
  m.position.set(0, -.6 + p.dy, p.dz); return m; // the rider mesh is in the bike's frame (ct), which hangs .6 below the body
}
// draw seat list `seats` on host = { body: B.body or a ghost's body handle, kind, G, rider }; hidden = still there, not shown
function drawSeats(hid, host, seats, show) {
  const n = seatsOf(host.kind);
  for (let i = 0; i < 2; i++) {
    const id = i < n ? seats[i] : 0, key = hid + '/' + i; if (!id) { const m = FIG.get(key); if (m) m.visible = false; continue; }
    const m = host.kind === 'trike' ? fig(key, id) : pax(key, id, host); if (!m) continue;
    if (m.parent !== host.body) host.body.add(m); if (host.kind === 'trike') m.position.set(SEATS[i][0], SEAT_Y - .6, SEATS[i][1]);
    m.visible = show && !(id === NET.id && ctx.camMode === 0); // first person: you are the head the camera sits in
  }
}
function hideHost(hid) { for (let i = 0; i < 2; i++) { const m = FIG.get(hid + '/' + i); if (m) m.visible = false; } }

/* ---------- cartoon fling ---------- */
const FL = [], STAR = new THREE.OctahedronGeometry(.05, 0), MStar = new THREE.MeshBasicMaterial({ color: 0xffd23a });
const q1 = new THREE.Quaternion(), v1 = new THREE.Vector3(), m1 = new THREE.Matrix4();
// copy `src` meshes (in their current world pose) into one group pivoting at `pivot` (world) and send it flying
function fling(srcs, pivot, vel, me) {
  const g = new THREE.Group(); g.position.copy(pivot); scene.add(g); g.updateMatrixWorld(true); const inv = m1.copy(g.matrixWorld).invert();
  for (const s of srcs) { s.updateWorldMatrix(true, false); const c = new THREE.Mesh(s.geometry, s.material); c.castShadow = true; c.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, s.matrixWorld)); g.add(c); }
  const stars = new THREE.Group(); for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(STAR, MStar); s.position.set(Math.cos(i * 2.1) * .2, 0, Math.sin(i * 2.1) * .2); stars.add(s); } stars.visible = false; scene.add(stars);
  const ax = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
  FL.push({ g, stars, v: vel, ax, w: 9 + Math.random() * 7, t: 0, b: 0, sq: 0, me }); blip('thud', 4);
  return FL[FL.length - 1];
}
function flyTick(dt) {
  for (let i = FL.length - 1; i >= 0; i--) {
    const f = FL[i], g = f.g, p = g.position; f.t += dt;
    f.v.y -= 6.5 * dt; p.addScaledVector(f.v, dt); // floaty cartoon gravity: more hang time
    if (f.w > .05) { q1.setFromAxisAngle(f.ax, f.w * dt); g.quaternion.premultiply(q1); }
    const gy = H(p.x, p.z) + .28;
    if (p.y < gy) {
      p.y = gy;
      if (f.v.y < -1.6 && f.b < 4) { f.v.y = -f.v.y * .5; f.v.x *= .65; f.v.z *= .65; f.w *= .6; f.b++; f.sq = 1; blip('thud', Math.min(5, 1 + f.b)); f.stars.visible = true; }
      else { f.v.y = 0; const k = Math.max(0, 1 - 3.5 * dt); f.v.x *= k; f.v.z *= k; f.w *= Math.max(0, 1 - 5 * dt); }
    }
    f.sq = Math.max(0, f.sq - dt * 4.5); const sq = Math.sin(f.sq * Math.PI) * f.sq; g.scale.set(1 + .3 * sq, 1 - .4 * sq, 1 + .3 * sq);
    if (f.stars.visible) { f.stars.position.set(p.x, p.y + .55, p.z); f.stars.rotation.y += dt * 6; }
    if (f.t > FLY_S) { g.removeFromParent(); f.stars.removeFromParent(); FL.splice(i, 1); f.done = true; }
  }
}
// everybody out: pivot each passenger at the seat, launch up and out (sidecar side; a pillion to either side) with the bike's speed
const hip = new THREE.Vector3(), fw = new THREE.Vector3(), rt = new THREE.Vector3();
function ejectAll(hid, body, root, vel, seats) {
  let mine = null; root.updateWorldMatrix(true, true); fw.set(0, 0, -1).applyQuaternion(root.quaternion); rt.set(1, 0, 0).applyQuaternion(root.quaternion);
  for (let i = 0; i < 2; i++) {
    const id = seats[i], m = FIG.get(hid + '/' + i); if (!id || !m || m.parent !== body) continue;
    const pil = !!m.userData.hip; if (pil) m.localToWorld(hip.copy(m.userData.hip)); else m.getWorldPosition(hip); // pillion: pivot at the hip, not at the mesh origin on the ground
    const vv = fw.clone().multiplyScalar(vel * .8).addScaledVector(rt, (pil && Math.random() < .5 ? -1 : 1) * (2.5 + Math.random() * 3)); vv.y = 7 + Math.random() * 3;
    const f = fling([m], hip, vv, id === NET.id); m.visible = false; if (f.me) mine = f;
  }
  return mine;
}
function flingDriver(rider, root, vel) { // a ghost driver (the local driver is a Rapier ragdoll, rapier.js)
  if (!rider || !rider.length) return; root.updateWorldMatrix(true, true); fw.set(0, 0, -1).applyQuaternion(root.quaternion); rt.set(-1, 0, 0).applyQuaternion(root.quaternion);
  hip.set(0, 1.0, .15).applyMatrix4(root.matrixWorld); const vv = fw.clone().multiplyScalar(vel * .9).addScaledVector(rt, 1.5 + Math.random() * 2); vv.y = 8 + Math.random() * 2;
  fling(rider, hip, vv, false);
}

/* ---------- who can ride ---------- */
const trikeLook = l => { const bk = l && ctx.bikes[l.bike], p = bk && bk.parts.sidecar; return !!(p && p.o[(l.parts && l.parts.sidecar) | 0] && p.o[l.parts.sidecar | 0].sc); };
// what a bike carries: 'trike' (sidecar fitted) two on the bench, 'pillion' one behind the rider, '' nobody (unknown bike, no seat data)
const kindOf = l => { const bk = l && ctx.bikes[l.bike]; return !bk ? '' : trikeLook(l) ? 'trike' : bk.chassis.pil ? 'pillion' : ''; };
const myKind = () => ctx.spec.sc ? 'trike' : ctx.spec.pil ? 'pillion' : '';
const seatsOf = k => k === 'trike' ? 2 : k ? 1 : 0;
const free = (k, s) => k === 'trike' ? !s || !s[0] || !s[1] : !!k && (!s || !s[0]);
const hostV = P => { const n = P.snaps.length; return n ? Math.abs(P.snaps[n - 1].v) : 0; };
function canBoard(P) { const k = kindOf(P.look); return !!k && P.d < NEAR && free(k, P.seats) && !(P.fl & (2 | 8 | 16 | 32)) && hostV(P) < 2 && Math.abs(S.v) < 1.5 && !S.crashed && !ctx.spec.sc && !R.seats[0] && !R.seats[1]; } // fl: crashed, paused / garage, racing, riding along
ctx.rideIcon = P => { const k = kindOf(P.look); if (!k || P.d >= 40 || ctx.ride || ctx.spec.sc) return ''; return k === 'trike' ? (free(k, P.seats) ? '🛺' : '🛺 full') : (free(k, P.seats) && hostV(P) < 2 ? '🏍️+1' : ''); };

/* ---------- panel ---------- */
const pnl = $('ride'), txt = $('rideT'), bY = $('rideY'), bB = $('rideB'), bX = $('rideX');
let fy = null, fb = null, fx = null;
function panel(t, y, fY, b, fB, x) { txt.textContent = t; pnl.hidden = false; bY.hidden = !y; bY.textContent = y || ''; bB.hidden = !b; bB.textContent = b || ''; bX.hidden = !x; fy = fY; fb = fB; fx = x; }
const close = () => { pnl.hidden = true; fy = fb = fx = null; };
bY.onclick = () => fy && fy(); bB.onclick = () => fb && fb(); bX.onclick = () => (fx || close)();
const name = id => (NET.peers.get(id) || { name: 'Rider' }).name;

/* ---------- tap on a name tag: ride (when you can) or race ---------- */
export function rideInit() {
  const raceTap = NET.on.tap;
  NET.on.tap = P => {
    if (ctx.ride) return say('Tap GET OFF first');
    if (canBoard(P)) return panel(kindOf(P.look) === 'trike' ? 'Ride in ' + P.name + "'s sidecar?" : 'Hop on behind ' + P.name + '?', 'RIDE', () => ask(P), 'RACE', () => { close(); raceTap(P); }, close);
    if (trikeLook(P.look) && P.d < NEAR && !ctx.spec.sc && Math.abs(S.v) >= 1.5) say('Stop next to the tricycle to hop in', 1500);
    raceTap(P);
  };
  NET.on.ride = onMsg;
  NET.on.join = () => { if (R.seats[0] || R.seats[1]) R.bcT = 0; }; // newcomers get the seat list right away
  ctx.rideExit = () => { if (ctx.ride) getOff(true); };
}
function ask(P) {
  if (MI.q) return say('Finish or cancel your job first'); if (ctx.racing) return say('Not during a race');
  R.ask = { to: P.id, kind: kindOf(P.look), until: performance.now() + ASK_MS }; send({ t: 'ride', op: 'ask', to: P.id });
  panel('Asking ' + P.name + '…', null, null, null, null, () => { send({ t: 'ride', op: 'no', to: R.ask.to, why: 'busy' }); R.ask = null; close(); });
}

/* ---------- messages ---------- */
function onMsg(m) {
  const P = NET.peers.get(m.from); if (!P) return;
  if (m.op === 'seats') { P.seats = [m.seats[0] | 0, m.seats[1] | 0]; return; }
  if (m.op === 'ask') { // we drive: someone wants a lift
    const no = why => send({ t: 'ride', op: 'no', to: P.id, why });
    const k = myKind(); if (!k) return no('nosc'); if (!free(k, R.seats)) return no('full'); if (S.crashed || R.inb || R.ask || ctx.ride || ctx.racing || ctx.GAR || F.on) return no('busy'); if (P.d > NEAR) return no('far');
    R.inb = { id: P.id, until: performance.now() + ASK_MS };
    panel(P.name + (k === 'trike' ? ' wants to ride in your sidecar' : ' wants to ride on the back'), 'OK', () => accept(P.id), null, null, () => { no('busy'); R.inb = null; close(); });
    blip('click'); return;
  }
  if (m.op === 'no') {
    if (R.ask && R.ask.to === P.id) { const tri = R.ask.kind === 'trike'; R.ask = null; close(); say(m.why === 'full' ? (tri ? P.name + "'s sidecar is full" : P.name + ' has a passenger already') : m.why === 'far' ? 'Get closer to ' + P.name : m.why === 'nosc' ? (tri ? P.name + ' has no sidecar fitted' : P.name + " can't take a passenger yet (older version)") : P.name + ' said no', 2000); }
    if (R.inb && R.inb.id === P.id) { R.inb = null; close(); } return;
  }
  if (m.op === 'ok') {
    if (!R.ask || R.ask.to !== P.id) return send({ t: 'ride', op: 'off', to: P.id }); R.ask = null;
    if (P.d > NEAR + 3 || S.crashed) { send({ t: 'ride', op: 'off', to: P.id }); close(); return say('Too far away now', 1500); }
    board(P, clamp(m.seat | 0, 0, 1)); return;
  }
  if (m.op === 'off') {
    if (ctx.ride && ctx.ride.host === P.id && !ctx.ride.fly) getOff(false, P.name + ' let you off'); // the driver dropped us
    const i = R.seats.indexOf(P.id); if (i >= 0) { R.seats[i] = 0; R.bcT = 0; say(P.name + ' got off', 1500); } // a passenger left
  }
}
function accept(id) {
  const P = NET.peers.get(id); R.inb = null; close(); if (!P) return;
  const k = myKind(); if (!k || S.crashed || !free(k, R.seats) || P.d > NEAR + 3 || Math.abs(S.v) > 3 || ctx.ride || ctx.racing || ctx.GAR || F.on) { send({ t: 'ride', op: 'no', to: id, why: P.d > NEAR + 3 ? 'far' : 'busy' }); return; }
  const seat = R.seats[0] ? 1 : 0; R.seats[seat] = id; R.bcT = 0; send({ t: 'ride', op: 'ok', to: id, seat }); say(P.name + (k === 'trike' ? ' hopped in' : ' hopped on'), 1500); // a pillion bike only has seat 0
}

/* ---------- passenger ---------- */
function board(P, seat) {
  const k = kindOf(P.look), pc = P.tpl && P.tpl.G.pil && P.tpl.G.pil.cam; // pillion: the eye sits a little above and to the right of the rider's helmet, so the road isn't all jacket
  ctx.ride = { host: P.id, seat, kind: k, bike: P.look && P.look.bike, since: performance.now(), lx: P.x, lz: P.z, lpsi: S.psi, v: 0 };
  R.camPos = B.cam.position.clone(); if (k === 'trike') B.cam.position.set(SEATS[seat][0], 1.22, SEATS[seat][1] + .03); else B.cam.position.set(pc ? pc.x : .2, pc ? pc.y : 1.5, pc ? pc.z : .5);
  S.running = false; S.v = 0; S.thr = S.brake = 0; S.cranking = false; B.root.visible = false;
  P.seats = P.seats || [0, 0]; P.seats[seat] = NET.id; // until the driver's list arrives
  panel((k === 'trike' ? '🛺 Riding with ' : '🏍️ Riding with ') + P.name, 'GET OFF', () => getOff(true), null, null, null); say('Hop in! Enjoy the ride', 1500); blip('click');
}
// back on your own bike: beside the driver on the side away from the sidecar (the left, for a pillion), or where you landed after a crash
function getOff(tell, msg) {
  const r = ctx.ride; if (!r) return; ctx.ride = null; ctx.rideFly = false; close();
  if (tell) send({ t: 'ride', op: 'off', to: r.host });
  const P = NET.peers.get(r.host); if (P && P.seats) { const i = P.seats.indexOf(NET.id); if (i >= 0) P.seats[i] = 0; }
  let x = r.lx, z = r.lz, psi = r.lpsi;
  if (r.fly && r.fly.g) { x = r.fly.g.position.x; z = r.fly.g.position.z; }
  else { const lx = Math.cos(psi), lz = -Math.sin(psi); x -= lx * 1.4; z -= lz * 1.4; } // the side away from the sidecar
  Object.assign(S, { x, z, psi, v: 0, running: false, gear: 0, lean: 0, leanV: 0, th: 0, wp: 0, wpv: 0, yaw: 0, delta: 0, rpm: 0, chair: 0, chairV: 0 }); ctx.drive.reset(S);
  const sp = ctx.spec; S.zH = H(x, z) + (sp.yf + sp.yr + sp.pf + sp.pr) / 2; syncBody();
  if (R.camPos) { B.cam.position.copy(R.camPos); R.camPos = null; } B.root.visible = true;
  say(msg || (r.fly ? 'Ouch! Back on your own bike' : 'Back on your bike'), 1800);
}
const fq = new THREE.Quaternion(), fv = new THREE.Vector3();
function follow(dt) {
  const r = ctx.ride, P = NET.peers.get(r.host);
  if (r.fly) { // flying out of the sidecar: the chase camera watches you (main.js treats rideFly like a crash)
    const g = r.fly.g; if (g.parent) { S.x = g.position.x; S.z = g.position.z; S.zH = H(S.x, S.z); S.v = Math.hypot(r.fly.v.x, r.fly.v.z); }
    if (r.fly.done) getOff(false); return;
  }
  if (NET.st !== 'on' || !P || P.lv) return getOff(false, 'The driver left');
  if (P.seats && P.seats.indexOf(NET.id) < 0 && performance.now() - r.since > 3000) return getOff(false, P.name + ' let you off');
  if (kindOf(P.look) !== r.kind || (P.look && P.look.bike !== r.bike)) return getOff(true, P.name + (r.kind === 'trike' && kindOf(P.look) !== 'trike' ? ' took the sidecar off' : ' changed bikes'));
  if (!P.inst || !P.inst.o) return; const o = P.inst.o, h = P.inst.h;
  fv.set(0, 0, -1).applyQuaternion(fq.copy(o.quaternion)); const psi = Math.atan2(-fv.x, -fv.z);
  const d = Math.hypot(o.position.x - r.lx, o.position.z - r.lz); r.v += (d / Math.max(dt, .001) - r.v) * Math.min(1, dt * 4);
  S.yaw = dt > 0 ? Math.atan2(Math.sin(psi - r.lpsi), Math.cos(psi - r.lpsi)) / dt : 0;
  S.x = r.lx = o.position.x; S.z = r.lz = o.position.z; S.zH = o.position.y; S.psi = r.lpsi = psi; S.v = r.v;
  S.lean = -h.lean.rotation.z; S.th = h.body.rotation.x; S.wp = 0; S.delta = 0; S.thr = 0; S.running = false; S.cF = S.cR = 0;
}

/* ---------- per frame (main.js, after netFrame) ---------- */
export const _t = { fling, ejectAll, drawSeats, flyTick, kindOf, myKind, canBoard, R }; // tests (tools/pillion.mjs)
export function rideFrame(dt, now) {
  flyTick(dt);
  const on = NET.st === 'on';
  // we drive: seat list upkeep, broadcast, our own passengers on our bike, crash = everybody out
  const mk = myKind();
  if (!on || mk !== R.kind || ctx.bike.id !== R.bike) { // offline, or the sidecar went on / off, or another bike: nobody stays aboard
    for (let i = 0; i < 2; i++) if (R.seats[i]) { if (on) send({ t: 'ride', op: 'off', to: R.seats[i] }); R.seats[i] = 0; R.bcT = 0; }
    R.kind = mk; R.bike = ctx.bike.id;
  }
  for (let i = 0; i < 2; i++) { const P = NET.peers.get(R.seats[i]); if (R.seats[i] && (!P || P.lv)) { R.seats[i] = 0; R.bcT = 0; } }
  if (S.crashed && !R.wasCr && (R.seats[0] || R.seats[1])) { ejectAll('me', B.body, B.root, S.v, R.seats); R.ejectAt = now + FLY_S * 1000; say('Everybody out!', 1500); }
  R.wasCr = S.crashed;
  if (R.ejectAt && now > R.ejectAt) { R.ejectAt = 0; R.seats = [0, 0]; R.bcT = 0; }
  S.paxM = mk === 'trike' ? ((R.seats[0] ? 1 : 0) + (R.seats[1] ? 1 : 0)) * PAX_KG : 0; // sidecar: physics.js
  if (withPassenger(ctx.spec, mk === 'pillion' && R.seats[0] && !ctx.GAR ? PAX_KG : 0)) setMass(); // pillion: moves the centre of mass (spec.js; not in the garage, which shows the bike's own numbers)
  if (R.ejectAt) hideHost('me'); else drawSeats('me', { body: B.body, kind: mk, G: B.G, rider: B.rider }, R.seats, !S.crashed && !ctx.GAR);
  const sk = R.seats.join();
  if (on && mk && (sk !== R.sentK || ((R.seats[0] || R.seats[1]) && now - R.bcT > 4000)) && (R.bcT === 0 || now - R.bcT > 400)) { R.sentK = sk; R.bcT = now; send({ t: 'ride', op: 'seats', seats: R.seats.slice() }); }
  // everyone else's bikes
  for (const P of NET.peers.values()) {
    const cr = !!(P.fl & 2), hid = P.id, pk = kindOf(P.look);
    if (!P.inst || !pk) { hideHost(hid); P.wasCr = cr; continue; }
    if (cr && !P.wasCr && P.fl !== -1) { // that bike just crashed: fling its passengers and its driver
      const mine = P.seats && P.seats.indexOf(NET.id) >= 0 && ctx.ride && ctx.ride.host === hid;
      const f = ejectAll(hid, P.inst.h.body, P.inst.o, hostV(P), P.seats || [0, 0]); flingDriver(P.inst.h.rider, P.inst.o, hostV(P));
      if (mine) { ctx.ride.fly = f || { done: true }; ctx.rideFly = true; close(); }
      P.flyT = now + 4000;
    }
    P.wasCr = cr;
    if (P.flyT && now < P.flyT) hideHost(hid); else drawSeats(hid, { body: P.inst.h.body, kind: pk, G: P.tpl && P.tpl.G, rider: P.inst.h.rider }, P.seats || [0, 0], P.inst.o.visible);
  }
  for (const [key, m] of FIG) { const hid = key.split('/')[0]; if (hid !== 'me' && !NET.peers.has(+hid)) { m.removeFromParent(); FIG.delete(key); } }
  if (ctx.ride) follow(dt);
  // open requests time out
  if (R.ask && now > R.ask.until) { R.ask = null; close(); say('No answer', 1500); }
  if (R.inb && now > R.inb.until) { send({ t: 'ride', op: 'no', to: R.inb.id, why: 'busy' }); R.inb = null; close(); }
}
