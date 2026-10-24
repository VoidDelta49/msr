// Multiplayer: a WebSocket relay (server/worker.js, one Cloudflare Durable Object per room code) + ghost bikes.
// Every phone runs its own physics; this only sends our drawn bike pose and shows everyone else's, interpolated
// DELAY ms behind the sender. Ghost mode: remote bikes have no colliders.
// Remote models are snapshots of the real bike + paint (main.js ctx.bikeTemplate), one more instance per player.
import * as THREE from 'three';
import { cfg, MP_URL } from './config.js';
import { S, ctx } from './state.js';
import { scene, camera } from './renderer.js';
import { B, twin } from './model.js';
import { say } from './hud.js';
import { $ } from './util.js';

export const PROTO = 1; // = PROTO in server/worker.js
export const NET = ctx.NET = { st: 'off', id: 0, room: '', max: 8, peers: new Map(), err: '', on: {}, rtt: 0 };
const DELAY = 140, KEEP = 24, PKT = 44;
let ws = null, want = null, retry = 0, retryTo = 0;
const changed = () => ctx.onNet && ctx.onNet();

export function join(room, name, url) {
  leave(true); want = { room: room.toUpperCase(), name, url: (url || MP_URL).trim() }; NET.err = ''; retry = 0;
  if (!want.url) { NET.err = 'No server address set.'; want = null; changed(); return; }
  connect();
}
export function leave(quiet) {
  want = null; clearTimeout(retryTo);
  if (ws) { const w = ws; ws = null; w.onclose = null; try { w.close(1000); } catch (e) { } }
  clearPeers(); if (NET.st !== 'off' && !quiet) say('Left the room'); NET.st = 'off'; NET.room = ''; changed();
}
export function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  const u = want.url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/room/' + want.room + '?v=' + PROTO + '&name=' + encodeURIComponent(want.name);
  NET.st = 'conn'; NET.room = want.room; changed();
  let w; try { w = ws = new WebSocket(u); } catch (e) { NET.err = 'Bad server address.'; want = null; NET.st = 'off'; changed(); return; }
  w.binaryType = 'arraybuffer';
  w.onmessage = e => { if (typeof e.data === 'string') { try { text(JSON.parse(e.data)); } catch (er) { console.warn('net: ' + er.message); } } else bin(e.data); };
  w.onclose = e => {
    if (ws !== w) return; ws = null; const was = NET.st === 'on'; clearPeers();
    if (e.code === 4000 || e.code === 4001) want = null; // version mismatch / room full: the err message says why
    if (want && retry < 6) { NET.st = 'retry'; retryTo = setTimeout(() => want && connect(), Math.min(10, 1 + retry++ * 2) * 1000); if (was) say('Connection lost, reconnecting…', 2500); }
    else { if (want && !NET.err) NET.err = "Can't reach the server."; want = null; NET.st = 'off'; }
    changed();
  };
}
function text(m) {
  if (m.t === 'hi') {
    NET.id = m.id; NET.max = m.max; NET.st = 'on'; retry = 0; lookKey = ''; lookT = -1e9; for (const p of m.peers) addPeer(p);
    say('Joined room ' + NET.room + ' · ' + (m.peers.length + 1) + '/' + m.max, 2500); ping(); changed();
  } else if (m.t === 'join') { addPeer(m); say(m.name + ' joined', 2000); changed(); }
  else if (m.t === 'leave') { const p = NET.peers.get(m.id); if (p) { if (NET.on.leave) NET.on.leave(p); say(p.name + ' left', 2000); delPeer(p); changed(); } }
  else if (m.t === 'look') { const p = NET.peers.get(m.from); if (p) { p.look = m.look; p.lk = JSON.stringify(m.look); } }
  else if (m.t === 'race') { if (NET.on.race) NET.on.race(m); }
  else if (m.t === 'pong') NET.rtt = performance.now() - m.c;
  else if (m.t === 'err') { NET.err = m.msg || m.code; changed(); }
}
function ping() { send({ t: 'ping', c: performance.now() }); }

/* ---------- peers ---------- */
function addPeer(p) {
  if (NET.peers.has(p.id)) delPeer(NET.peers.get(p.id));
  const tag = document.createElement('button'); tag.className = 'ntag'; tag.hidden = true; tag.innerHTML = '<b></b><i></i>'; tag.firstChild.textContent = p.name;
  const P = { id: p.id, name: p.name, look: p.look || null, lk: p.look ? JSON.stringify(p.look) : '', key: '', snaps: [], off: null, inst: null, tag, wA: 0, x: 0, z: 0, d: 1e9, fl: 0, seen: 0, tx: -1, ty: -1, ti: '' };
  tag.onclick = e => { e.stopPropagation(); if (NET.on.tap) NET.on.tap(P); };
  $('tags').appendChild(tag); NET.peers.set(p.id, P);
}
function delPeer(P) { if (P.inst) scene.remove(P.inst.o); P.tag.remove(); NET.peers.delete(P.id); }
function clearPeers() { for (const P of [...NET.peers.values()]) delPeer(P); ctx.mpDots = []; ctx.mpK = ''; }

/* ---------- bike state packets ---------- */
// u8 type, u8 flags, u16 rpm, u32 t(ms), f32 x y z, i16 quat xyzw, i16 lean th steer slider rearH bodyY (1e-4), i16 v (cm/s), u8 thr, i8 gear
// flags: 1 engine on, 2 crashed, 4 braking, 8 paused / in the garage, 16 racing
const OUT = new DataView(new ArrayBuffer(PKT)), I16 = 32767;
function pack() {
  const d = OUT, r = B.root, q = r.quaternion;
  d.setUint8(0, 1); d.setUint8(1, (S.running ? 1 : 0) | (S.crashed ? 2 : 0) | (S.brake > .1 ? 4 : 0) | (ctx.paused || ctx.GAR ? 8 : 0) | (ctx.racing ? 16 : 0));
  d.setUint16(2, Math.max(0, Math.min(65535, S.rpm | 0)), true); d.setUint32(4, performance.now() >>> 0, true);
  d.setFloat32(8, r.position.x, true); d.setFloat32(12, r.position.y, true); d.setFloat32(16, r.position.z, true);
  d.setInt16(20, q.x * I16, true); d.setInt16(22, q.y * I16, true); d.setInt16(24, q.z * I16, true); d.setInt16(26, q.w * I16, true);
  const s16 = (o, v) => d.setInt16(o, Math.max(-I16, Math.min(I16, Math.round(v * 1e4))), true);
  s16(28, B.lean.rotation.z); s16(30, B.body.rotation.x); s16(32, B.steer.rotation.y); s16(34, B.slider.position.y); s16(36, B.rearH.position.y); s16(38, B.body.position.y);
  d.setInt16(40, Math.max(-I16, Math.min(I16, Math.round(S.v * 100))), true); d.setUint8(42, Math.max(0, Math.min(255, S.thr * 255 | 0))); d.setInt8(43, S.gear | 0);
  ws.send(OUT.buffer);
}
function bin(buf) {
  if (buf.byteLength < PKT + 1) return; const d = new DataView(buf), P = NET.peers.get(d.getUint8(0)); if (!P || d.getUint8(1) !== 1) return;
  const g = o => d.getInt16(o + 1, true) / 1e4, q = o => d.getInt16(o + 1, true) / I16, now = performance.now();
  const s = { t: d.getUint32(5, true), fl: d.getUint8(2), rpm: d.getUint16(3, true), x: d.getFloat32(9, true), y: d.getFloat32(13, true), z: d.getFloat32(17, true),
    qx: q(20), qy: q(22), qz: q(24), qw: q(26), lean: g(28), th: g(30), st: g(32), sl: g(34), rh: g(36), by: g(38), v: d.getInt16(41, true) / 100 };
  const last = P.snaps[P.snaps.length - 1]; if (last && s.t <= last.t) { if (last.t - s.t < 60000) return; P.snaps.length = 0; P.off = null; } // stale, or the sender reloaded
  // clock offset: the smallest (arrival - send time) seen is the least-delayed packet; creep up slowly for clock drift
  const o = now - s.t; P.off = P.off === null || o < P.off ? o : P.off + (o - P.off) * .002;
  P.snaps.push(s); if (P.snaps.length > KEEP) P.snaps.shift(); P.seen = now;
}

/* ---------- per frame ---------- */
let sendT = 0, lookT = -1e9, lookKey = '', W = innerWidth, Hh = innerHeight, built = false;
addEventListener('resize', () => { W = innerWidth; Hh = innerHeight; });
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v3 = new THREE.Vector3(), FR = new THREE.Frustum(), PM = new THREE.Matrix4(), SPH = new THREE.Sphere(new THREE.Vector3(), 2.2);
const lerp = (a, b, f) => a + (b - a) * f;
export function netFrame(dt, now) {
  if (NET.st !== 'on') return;
  // send: 10 Hz while anything moves, 2 Hz parked (incoming messages are what the free plan counts)
  const moving = Math.abs(S.v) > .3 || S.crashed || S.thr > .05;
  if (now - sendT >= (moving ? 100 : 500) && ws && ws.readyState === 1 && ws.bufferedAmount < 4096) { sendT = now; pack(); }
  if (now - lookT > 1000) { lookT = now; const look = { bike: ctx.bike.id, cfg: ctx.bcfg }, k = JSON.stringify(look); if (k !== lookKey) { lookKey = k; send({ t: 'look', look }); } if (Math.random() < .05) ping(); }
  if (!NET.peers.size) { if (ctx.mpK) { ctx.mpDots = []; ctx.mpK = ''; } return; }
  camera.updateMatrixWorld(); PM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); FR.setFromProjectionMatrix(PM);
  built = false; const dots = ctx.mpDots || (ctx.mpDots = []); dots.length = 0; let mk = '';
  for (const P of NET.peers.values()) {
    model(P); const n = P.snaps.length; if (!P.inst || !n) { P.tag.hidden = true; continue; }
    // the pose DELAY ms behind the sender's clock: interpolate, or extrapolate up to 300 ms if packets are late
    const rt = now - P.off - DELAY, SN = P.snaps; let a = SN[0], b = a, f = 0;
    if (rt >= SN[n - 1].t) { b = SN[n - 1]; a = n > 1 ? SN[n - 2] : b; const span = b.t - a.t; f = span > 0 && Math.hypot(b.x - a.x, b.z - a.z) < 15 ? 1 + Math.min(300, rt - b.t) / span : 1; if (f > 1 && span > 600) f = 1; }
    else if (rt > a.t) { let i = 1; while (SN[i].t < rt) i++; a = SN[i - 1]; b = SN[i]; f = (rt - a.t) / (b.t - a.t); if (Math.hypot(b.x - a.x, b.z - a.z) > 15) f = 1; }
    const fq = Math.min(1, f), h = P.inst.h, o = P.inst.o, G = P.tpl.G;
    o.position.set(lerp(a.x, b.x, f), lerp(a.y, b.y, fq), lerp(a.z, b.z, f));
    qa.set(a.qx, a.qy, a.qz, a.qw).normalize(); qb.set(b.qx, b.qy, b.qz, b.qw).normalize(); o.quaternion.slerpQuaternions(qa, qb, fq);
    h.lean.rotation.z = lerp(a.lean, b.lean, fq); h.body.rotation.x = lerp(a.th, b.th, fq); h.body.position.y = b.by; h.steer.rotation.y = lerp(a.st, b.st, fq);
    h.slider.position.y = lerp(a.sl, b.sl, fq); h.rearH.position.y = lerp(a.rh, b.rh, fq);
    const dy = h.rearH.position.y - G.pivotY, dz = G.rearZ - G.pivotZ; h.swing.position.set(G.swingX, G.pivotY + dy / 2, G.pivotZ + dz / 2); h.swing.rotation.x = -Math.atan2(dy, dz); h.swing.scale.z = Math.hypot(dy, dz);
    const v = lerp(a.v, b.v, fq); P.wA += v * dt / G.rw; h.frontW.rotation.x = h.rearW.rotation.x = -P.wA;
    const crashed = !!(b.fl & 2); if (P.fl !== b.fl) { P.fl = b.fl; for (const r of h.rider) r.visible = !crashed; P.tag.classList.toggle('idle', !!(b.fl & 8)); P.tag.classList.toggle('race', !!(b.fl & 16)); }
    // cull: far bikes off, and frustum (the skinned mesh skips three's own culling)
    P.x = o.position.x; P.z = o.position.z; P.d = Math.hypot(P.x - S.x, P.z - S.z);
    SPH.center.copy(o.position); o.visible = P.d < 350 && FR.intersectsSphere(SPH);
    dots.push(P); mk += (P.x / 3 | 0) + ',' + (P.z / 3 | 0) + ';';
    tag(P, now);
  }
  ctx.mpK = mk;
}
// build (or swap) a player's model when their bike / paint changes; at most one build per frame (each is a hitch)
function model(P) {
  if (!P.look || built || P.lk === P.key) return; const k = P.lk;
  const tpl = ctx.bikeTemplate && ctx.bikeTemplate(P.look); if (!tpl) return; built = true; P.key = k;
  if (P.inst) scene.remove(P.inst.o); P.tpl = tpl; P.inst = twin(tpl); P.inst.o.visible = false; P.fl = -1; scene.add(P.inst.o);
}
// name tag above the rider: tap it to challenge them (race.js)
function tag(P, now) {
  const e = P.tag; if (!P.inst.o.visible || P.d > 140) { e.hidden = true; return; }
  v3.copy(P.inst.o.position); v3.y += 1.95; v3.project(camera); if (v3.z > 1) { e.hidden = true; return; }
  const x = Math.round((v3.x * .5 + .5) * W), y = Math.round((.5 - v3.y * .5) * Hh); e.hidden = false;
  if (x !== P.tx || y !== P.ty) { P.tx = x; P.ty = y; e.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`; }
  const away = now - P.seen > 4000, info = away ? 'away' : P.d < 90 ? Math.round(P.d) + ' m · 🏁' : Math.round(P.d / 10) * 10 + ' m';
  if (info !== P.ti) { P.ti = info; e.lastChild.textContent = info; }
}
