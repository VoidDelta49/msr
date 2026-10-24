// Multiplayer: a WebSocket relay (server/worker.js, one Cloudflare Durable Object per room code) + ghost bikes.
// Every phone runs its own physics; this only sends our drawn bike pose and shows everyone else's, interpolated
// a jitter-adaptive delay (110-450 ms) behind the sender. Ghost mode: remote bikes have no colliders.
// Remote models are snapshots of the real bike + paint (main.js ctx.bikeTemplate), one more instance per player.
import * as THREE from 'three';
import { cfg, MP_URL } from './config.js';
import { S, ctx } from './state.js';
import { scene, camera } from './renderer.js';
import { B, twin } from './model.js';
import { say } from './hud.js';
import { $ } from './util.js';

export const PROTO = 3; // = PROTO in server/worker.js
export const NET = ctx.NET = { st: 'off', id: 0, room: '', max: 8, peers: new Map(), err: '', note: '', on: {}, rtt: 0, live: 0, near: 1e9, slow: false };
const KEEP = 24, PKT = 44, HB = 15000, DEAD = 40000, LEAVE_GRACE = 6000, MAX_TRIES = 40;
let ws = null, want = null, retry = 0, retryTo = 0, rxT = 0, hbT = 0, fails = 0, lastId = 0, chkAt = 0, chkRx = 0, slowUntil = 0, backlog = 0, wake = false;
const changed = () => ctx.onNet && ctx.onNet();

// Reliability notes. Rollback netcode needs a deterministic shared simulation; here every phone runs its own physics and
// the other bikes are collision-free ghosts, so there is nothing to roll back. What does carry over: the ghost is
// predicted (extrapolated) when packets are late, corrected smoothly when the real ones arrive, and the jitter buffer
// adapts to the connection. On top of that: auto-reconnect that resumes the same player id (races survive a drop),
// a heartbeat that notices dead connections, and send rates that shrink on slow links and when nobody is around.
export function join(room, name, url) {
  leave(true); want = { room: room.toUpperCase(), name, url: (url || MP_URL).trim() }; NET.err = ''; NET.note = ''; retry = 0; fails = 0; lastId = 0;
  if (!want.url) { NET.err = 'No server address set.'; want = null; changed(); return; }
  if (navigator.onLine === false) { NET.err = "You're offline: multiplayer needs a connection."; want = null; changed(); return; }
  connect();
}
export function leave(quiet) {
  want = null; clearTimeout(retryTo);
  if (ws) { const w = ws; ws = null; w.onclose = null; try { w.close(1000); } catch (e) { } }
  clearPeers(); if (NET.st !== 'off' && !quiet) say('Left the room'); NET.st = 'off'; NET.room = ''; NET.note = ''; NET.id = 0; changed();
}
export function send(m) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; }

function connect() {
  clearTimeout(retryTo);
  const u = want.url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/room/' + want.room + '?v=' + PROTO + '&name=' + encodeURIComponent(want.name) + (lastId ? '&id=' + lastId : '');
  NET.st = retry || NET.st === 'retry' ? 'retry' : 'conn'; NET.room = want.room; changed();
  let w; try { w = ws = new WebSocket(u); } catch (e) { NET.err = 'Bad server address.'; want = null; NET.st = 'off'; changed(); return; }
  w.binaryType = 'arraybuffer'; rxT = performance.now();
  w.onmessage = e => { rxT = performance.now(); if (typeof e.data === 'string') { try { text(JSON.parse(e.data)); } catch (er) { console.warn('net: ' + er.message); } } else bin(e.data); };
  w.onclose = e => lost(w, e.code);
}
// the socket died (closed, refused, or silent for too long): hide the ghosts, then try again with a growing, jittered delay
function lost(w, code) {
  if (ws !== w) return; ws = null; w.onclose = null; try { w.close(); } catch (e) { }
  const was = NET.st === 'on'; if (was) fails = 0; else fails++;
  for (const P of NET.peers.values()) { P.tag.hidden = true; if (P.inst) P.inst.o.visible = false; } ctx.mpDots = []; ctx.mpK = '';
  if (code >= 4000 && code <= 4004) { // version / full / flood / wrong page / other tab took our seat: the err message says why
    if (code === 4004 && !NET.err) NET.err = 'You joined this room from another tab.';
    want = null;
  }
  if (want && retry < MAX_TRIES) {
    // full jitter: 1 s growing to ~30 s; a server that keeps refusing us (busy, or its daily quota is used up) gets 60 s gaps
    const cap = fails >= 3 ? 60 : Math.min(30, 1 * Math.pow(1.7, retry)), d = Math.max(.8, cap * (.5 + Math.random() * .5));
    retry++; NET.st = 'retry';
    NET.note = fails >= 3 ? 'Server busy or unreachable · retrying' : navigator.onLine === false ? 'Offline · waiting for a connection' : 'Reconnecting…';
    retryTo = setTimeout(() => want && connect(), d * 1000);
    if (was) say('Connection lost, reconnecting…', 2500);
  } else { if (want && !NET.err) NET.err = navigator.onLine === false ? "You're offline." : "Can't reach the server."; want = null; NET.st = 'off'; clearPeers(); NET.note = ''; }
  changed();
}
// heartbeat + watchdog (a timer, not the frame loop, so it also runs while the game is paused)
setInterval(() => {
  if (!ws || NET.st !== 'on') return; const now = performance.now();
  if (now - hbT > HB) ping();
  if (now - rxT > DEAD) lost(ws, 4999);
  else if (chkAt && now > chkAt) { const dead = rxT === chkRx; chkAt = 0; if (dead) lost(ws, 4999); }
}, 2000);
// coming back to the tab or the network: reconnect right away instead of waiting out the backoff, or check the socket is alive
function wakeUp() {
  if (!want) return;
  if (NET.st === 'retry' && navigator.onLine !== false) { retry = Math.min(retry, 2); connect(); }
  else if (NET.st === 'on' && performance.now() - rxT > 8000) { ping(); chkRx = rxT; chkAt = performance.now() + 5000; }
}
addEventListener('online', wakeUp);
document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeUp(); });

function text(m) {
  if (m.t === 'hi') {
    const again = retry > 0 || NET.peers.size > 0; NET.id = lastId = m.id; NET.max = m.max; NET.st = 'on'; NET.note = ''; retry = 0; fails = 0; lookKey = ''; lookT = -1e9; wake = true; backlog = 0;
    // reconcile instead of rebuilding: riders that are still here keep their bike model
    const ids = new Set(m.peers.map(p => p.id));
    for (const P of [...NET.peers.values()]) if (!ids.has(P.id)) { if (NET.on.leave) NET.on.leave(P); delPeer(P); }
    for (const p of m.peers) { const P = NET.peers.get(p.id); if (P && P.name === p.name) { if (P.lv) { clearTimeout(P.lv); P.lv = 0; } if (p.look) { P.look = p.look; P.lk = JSON.stringify(p.look); } } else addPeer(p); }
    say(again ? 'Reconnected · ' : 'Joined room ' + NET.room + ' · ' + (m.peers.length + 1) + '/' + m.max, 2500); hbT = 0; ping(); changed();
    if (NET.on.resume) NET.on.resume();
  } else if (m.t === 'join') {
    wake = true; const P = NET.peers.get(m.id);
    if (P && P.name === m.name) { if (P.lv) { clearTimeout(P.lv); P.lv = 0; } P.seen = performance.now(); if (NET.on.back) NET.on.back(P); } // same rider came back
    else { addPeer(m); say(m.name + ' joined', 2000); }
    changed();
  }
  else if (m.t === 'leave') { // keep the rider for a few seconds: a network blip shouldn't end their race
    const p = NET.peers.get(m.id); if (p && !p.lv) { p.lv = setTimeout(() => { if (NET.peers.get(p.id) !== p) return; if (NET.on.leave) NET.on.leave(p); say(p.name + ' left', 2000); delPeer(p); changed(); }, LEAVE_GRACE); }
  }
  else if (m.t === 'look') { const p = NET.peers.get(m.from); if (p) { p.look = m.look; p.lk = JSON.stringify(m.look); } }
  else if (m.t === 'race') { if (NET.on.race) NET.on.race(m); }
  else if (m.t === 'pong') { const r = performance.now() - m.c; NET.rtt = NET.rtt ? NET.rtt * .6 + r * .4 : r; if (NET.rtt > 900) slowUntil = performance.now() + 10000; }
  else if (m.t === 'err') { NET.err = m.msg || m.code; changed(); }
}
function ping() { hbT = performance.now(); send({ t: 'ping', c: hbT }); }

/* ---------- peers ---------- */
function addPeer(p) {
  if (NET.peers.has(p.id)) delPeer(NET.peers.get(p.id));
  const tag = document.createElement('button'); tag.className = 'ntag'; tag.hidden = true; tag.innerHTML = '<b></b><i></i>'; tag.firstChild.textContent = p.name;
  const P = { id: p.id, name: p.name, look: p.look || null, lk: p.look ? JSON.stringify(p.look) : '', key: '', lookAt: -1e9, snaps: [], off: null, jit: 0, iv: 100, dly: 140, sm: null, lv: 0, inst: null, tag, wA: 0, x: 0, z: 0, d: 1e9, fl: 0, seen: 0, tx: -1, ty: -1, ti: '' };
  tag.onclick = e => { e.stopPropagation(); if (NET.on.tap) NET.on.tap(P); };
  $('tags').appendChild(tag); NET.peers.set(p.id, P);
}
function delPeer(P) { clearTimeout(P.lv); if (P.inst) scene.remove(P.inst.o); P.tag.remove(); NET.peers.delete(P.id); }
function clearPeers() { for (const P of [...NET.peers.values()]) delPeer(P); ctx.mpDots = []; ctx.mpK = ''; }

/* ---------- bike state packets ---------- */
// u8 type, u8 flags, u16 rpm, u32 t(ms), f32 x y z, i16 quat xyzw, i16 lean th steer slider rearH bodyY (1e-4), i16 v (cm/s), u8 thr, i8 gear
// flags: 1 engine on, 2 crashed, 4 braking, 8 paused / in the garage, 16 racing
const OUT = new DataView(new ArrayBuffer(PKT)), I16 = 32767;
const GP = new THREE.Vector3(), GQ = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
function pack() {
  // in the garage the drawn bike sits on the studio pedestal (900 m up): send where it really is on the island instead
  const d = OUT, r = ctx.GAR ? GP.set(S.x, S.zH, S.z) : B.root.position, q = ctx.GAR ? GQ.setFromAxisAngle(UP, S.psi) : B.root.quaternion;
  d.setUint8(0, 1); d.setUint8(1, (S.running ? 1 : 0) | (S.crashed ? 2 : 0) | (S.brake > .1 ? 4 : 0) | (ctx.paused || ctx.GAR ? 8 : 0) | (ctx.racing ? 16 : 0));
  d.setUint16(2, Math.max(0, Math.min(65535, S.rpm | 0)), true); d.setUint32(4, performance.now() >>> 0, true);
  d.setFloat32(8, r.x, true); d.setFloat32(12, r.y, true); d.setFloat32(16, r.z, true);
  d.setInt16(20, q.x * I16, true); d.setInt16(22, q.y * I16, true); d.setInt16(24, q.z * I16, true); d.setInt16(26, q.w * I16, true);
  const s16 = (o, v) => d.setInt16(o, Math.max(-I16, Math.min(I16, Math.round(v * 1e4))), true);
  s16(28, B.lean.rotation.z); s16(30, B.body.rotation.x); s16(32, B.steer.rotation.y); s16(34, B.slider.position.y); s16(36, B.rearH.position.y); s16(38, B.body.position.y);
  d.setInt16(40, Math.max(-I16, Math.min(I16, Math.round(S.v * 100))), true); d.setUint8(42, Math.max(0, Math.min(255, S.thr * 255 | 0))); d.setInt8(43, S.gear | 0);
  ws.send(OUT.buffer);
}
function bin(buf) {
  if (buf.byteLength < PKT + 1) return; const d = new DataView(buf), P = NET.peers.get(d.getUint8(0)); if (!P || d.getUint8(1) !== 1) return;
  const g = o => d.getInt16(o + 1, true) / 1e4, q = o => d.getInt16(o + 1, true) / I16, now = performance.now();
  const x = d.getFloat32(9, true), y = d.getFloat32(13, true), z = d.getFloat32(17, true);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(x) > 5000 || Math.abs(z) > 5000 || Math.abs(y) > 2000) return; // junk: the server checks too
  const s = { t: d.getUint32(5, true), fl: d.getUint8(2), rpm: d.getUint16(3, true), x, y, z,
    qx: q(20), qy: q(22), qz: q(24), qw: q(26), lean: g(28), th: g(30), st: g(32), sl: g(34), rh: g(36), by: g(38), v: d.getInt16(41, true) / 100 };
  const last = P.snaps[P.snaps.length - 1]; if (last && s.t <= last.t) { if (last.t - s.t < 60000) return; P.snaps.length = 0; P.off = null; P.sm = null; } // stale, or the sender reloaded
  // clock offset: the smallest (arrival - send time) seen is the least-delayed packet; creep up slowly for clock drift
  const o = now - s.t; P.off = P.off === null || o < P.off ? o : P.off + (o - P.off) * .002;
  // jitter (how much later than the best case this packet came) and the sender's packet spacing size the playout delay
  P.jit += (Math.max(0, Math.min(500, o - P.off)) - P.jit) * .06; if (last) { const g = s.t - last.t; if (g < 700) P.iv += (g - P.iv) * .1; }
  P.snaps.push(s); if (P.snaps.length > KEEP) P.snaps.shift(); P.seen = now;
}

/* ---------- per frame ---------- */
let sendT = 0, lookT = -1e9, lookKey = '', W = innerWidth, Hh = innerHeight, built = false;
addEventListener('resize', () => { W = innerWidth; Hh = innerHeight; });
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v3 = new THREE.Vector3(), FR = new THREE.Frustum(), PM = new THREE.Matrix4(), SPH = new THREE.Sphere(new THREE.Vector3(), 2.2);
const lerp = (a, b, f) => a + (b - a) * f;
export function netFrame(dt, now) {
  if (NET.st !== 'on') { NET.live = 0; return; }
  // send: 10 Hz while anything moves, 5 Hz when the nearest rider is far, 1 Hz parked, nothing when alone (incoming messages
  // are what the free plan counts). Half rate on a slow link (high ping or a backed-up socket).
  const moving = Math.abs(S.v) > .3 || S.crashed || S.thr > .05, slow = NET.slow = now < slowUntil;
  let gap = moving ? (NET.near > 160 ? 200 : 100) : 1000; if (slow) gap *= 2; if (wake) { wake = false; sendT = -1e9; }
  if (NET.live && now - sendT >= gap && ws && ws.readyState === 1) {
    if (ws.bufferedAmount < 4096) { sendT = now; backlog = 0; pack(); } else if (++backlog > 3) slowUntil = now + 10000;
  }
  if (now - lookT > 1000) { lookT = now; const parts = {}; for (const k in ctx.bike.parts) parts[k] = ctx.bcfg[k] | 0; const look = { bike: ctx.bike.id, parts }, k = JSON.stringify(look); if (k !== lookKey) { lookKey = k; send({ t: 'look', look }); } }
  if (!NET.peers.size) { NET.live = 0; NET.near = 1e9; if (ctx.mpK) { ctx.mpDots = []; ctx.mpK = ''; } return; }
  camera.updateMatrixWorld(); PM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); FR.setFromProjectionMatrix(PM);
  built = false; const dots = ctx.mpDots || (ctx.mpDots = []); dots.length = 0; let mk = '', live = 0, near = 1e9;
  for (const P of NET.peers.values()) {
    if (P.lv) { P.tag.hidden = true; if (P.inst) P.inst.o.visible = false; continue; } // left: waiting to see if they come back
    live++; if (P.d < near) near = P.d;
    model(P); const n = P.snaps.length; if (!P.inst || !n) { P.tag.hidden = true; continue; }
    // the pose `dly` ms behind the sender's clock: interpolate, or predict (extrapolate up to 400 ms) if packets are late.
    // dly follows the measured jitter and packet spacing, but slowly (at most 15 % playback speed change)
    const tgt = Math.max(110, Math.min(450, P.iv * 1.1 + P.jit * 2 + 20)), step = dt * 150; P.dly += Math.max(-step, Math.min(step, tgt - P.dly));
    const rt = now - P.off - P.dly, SN = P.snaps; let a = SN[0], b = a, f = 0, seg = false;
    if (rt >= SN[n - 1].t) { b = SN[n - 1]; a = n > 1 ? SN[n - 2] : b; const span = b.t - a.t; seg = span > 0 && span <= 600 && Math.hypot(b.x - a.x, b.z - a.z) < 15; f = seg ? 1 + Math.min(400, rt - b.t) / span : 1; }
    else if (rt > a.t) { let i = 1; while (SN[i].t < rt) i++; a = SN[i - 1]; b = SN[i]; seg = Math.hypot(b.x - a.x, b.z - a.z) <= 15; f = seg ? (rt - a.t) / (b.t - a.t) : 1; }
    const fq = Math.min(1, f), h = P.inst.h, o = P.inst.o, G = P.tpl.G;
    // reconciliation: follow the segment's velocity exactly, but close the gap to the target gradually, so a late packet
    // that corrects the prediction slides the bike over instead of snapping it
    const tx = lerp(a.x, b.x, f), ty = lerp(a.y, b.y, fq), tz = lerp(a.z, b.z, f), sp = seg && !(f > 1 && rt - b.t > 400) ? (b.t - a.t) / 1000 : 0;
    let m = P.sm; if (!m) m = P.sm = { x: tx, y: ty, z: tz };
    if (Math.hypot(tx - m.x, tz - m.z) > 8) { m.x = tx; m.y = ty; m.z = tz; }
    else { const k = 1 - Math.exp(-Math.min(dt, .1) / .09), dd = Math.min(dt, .1); m.x += (sp ? (b.x - a.x) / sp * dd : 0) + (tx - m.x) * k; m.y += (sp ? (b.y - a.y) / sp * dd : 0) + (ty - m.y) * k; m.z += (sp ? (b.z - a.z) / sp * dd : 0) + (tz - m.z) * k; }
    o.position.set(m.x, m.y, m.z);
    qa.set(a.qx, a.qy, a.qz, a.qw).normalize(); qb.set(b.qx, b.qy, b.qz, b.qw).normalize(); o.quaternion.slerpQuaternions(qa, qb, fq);
    h.lean.rotation.z = lerp(a.lean, b.lean, fq); h.body.rotation.x = lerp(a.th, b.th, fq); h.body.position.y = b.by; h.steer.rotation.y = lerp(a.st, b.st, fq);
    h.slider.position.y = lerp(a.sl, b.sl, fq); h.rearH.position.y = lerp(a.rh, b.rh, fq);
    const dy = h.rearH.position.y - G.pivotY, dz = G.rearZ - G.pivotZ; h.swing.position.set(G.swingX, G.pivotY + dy / 2, G.pivotZ + dz / 2); h.swing.rotation.x = -Math.atan2(dy, dz); h.swing.scale.z = Math.hypot(dy, dz);
    const v = lerp(a.v, b.v, fq); P.wA += v * dt / G.rw; h.frontW.rotation.x = h.rearW.rotation.x = -P.wA;
    const crashed = !!(b.fl & 2); if (P.fl !== b.fl) { P.fl = b.fl; for (const r of h.rider) r.visible = !crashed; P.tag.classList.toggle('idle', !!(b.fl & 8)); P.tag.classList.toggle('race', !!(b.fl & 16)); }
    // cull: far bikes off, and frustum (the skinned mesh skips three's own culling)
    P.x = o.position.x; P.z = o.position.z; P.d = Math.hypot(P.x - S.x, P.z - S.z);
    SPH.center.copy(o.position); o.visible = !ctx.GAR && P.d < 350 && FR.intersectsSphere(SPH); // the studio is private: no one else in it
    dots.push(P); mk += (P.x / 3 | 0) + ',' + (P.z / 3 | 0) + ';';
    tag(P, now);
  }
  ctx.mpK = mk; NET.live = live; NET.near = near;
}
// build (or swap) a player's model when their bike / paint changes; at most one build per frame (each is a hitch),
// and at most one rebuild per player every 3 s (someone flipping paint, or spamming looks, can't stutter everyone)
function model(P) {
  if (!P.look || built || P.lk === P.key || (P.inst && performance.now() - P.lookAt < 3000)) return; const k = P.lk;
  const tpl = ctx.bikeTemplate && ctx.bikeTemplate(P.look); if (!tpl) return; built = true; P.key = k; P.lookAt = performance.now();
  if (P.inst) scene.remove(P.inst.o); P.tpl = tpl; P.inst = twin(tpl); P.inst.o.visible = false; P.fl = -1; scene.add(P.inst.o);
}
// name tag above the rider: tap it to challenge them (race.js)
function tag(P, now) {
  const e = P.tag; if (!P.inst.o.visible || P.d > 140) { e.hidden = true; return; }
  v3.copy(P.inst.o.position); v3.y += 1.95; v3.project(camera); if (v3.z > 1) { e.hidden = true; return; }
  const x = Math.round((v3.x * .5 + .5) * W), y = Math.round((.5 - v3.y * .5) * Hh); e.hidden = false;
  if (x !== P.tx || y !== P.ty) { P.tx = x; P.ty = y; e.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`; }
  const away = now - P.seen > 8000, info = away ? 'away' : P.d < 90 ? Math.round(P.d) + ' m · 🏁' : Math.round(P.d / 10) * 10 + ' m';
  if (info !== P.ti) { P.ti = info; e.lastChild.textContent = info; }
}
