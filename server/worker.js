// CPM: Motor Edition multiplayer relay (Cloudflare Worker + one Durable Object per room code).
// The relay doesn't simulate anything: every phone runs its own physics and sends its bike state; the room just
// forwards it. Binary messages (bike state, 44 bytes) are broadcast with the sender's id byte in front. Text messages
// are JSON control messages (only 'ping', 'look' and 'race' are accepted, and only known fields are forwarded):
// `to` sends to one player, `echo` also sends it back to the sender (so both sides of a race get the "go" at the same
// moment), `look` is kept so players who join later get it in their `hi`.
// Uses the WebSocket Hibernation API: an idle room costs no duration. Free plan: incoming messages count 20:1 as requests
// (100k requests/day), outgoing messages are free, so clients send 10 Hz while moving and 2 Hz while parked.
//
// Abuse limits (Build 9.3): Origin allowlist (ORIGINS in wrangler.toml; stops other websites, not scripts), version and
// origin checked here in the Worker before the room is touched, max 3 connections per IP per room, per-connection
// token buckets (state 25/s, control 4/s, look 1 per 2 s) and a disconnect for clients that keep flooding (a dropped
// message has still been counted against the quota; closing the socket is what stops it), packet sanity checks.
import { DurableObject } from 'cloudflare:workers';

const PROTO = 2; // bump together with PROTO in js/net.js when the message format or rules change
const MAX = 8;   // players per room (ids are one byte: up to 255 once interest management exists)
const PER_IP = 3; // connections per IP per room (friends behind one router / carrier NAT still fit)
const ROOM = /^\/room\/([A-Za-z0-9]{6,8})$/;
const DEF_ORIGINS = 'https://voiddelta49.github.io';
// bucket: [refill per second, burst]
const RATE = { bin: [25, 50], txt: [4, 16], look: [.5, 3] };
const FLOOD = 150; // messages dropped within one 10 s window before the socket is closed

const HDR = { 'access-control-allow-origin': '*', 'content-type': 'text/plain' };
function originOk(o, env) {
  if (!o) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return true; // local testing
  return String(env.ORIGINS || DEF_ORIGINS).split(',').map(s => s.trim().replace(/\/+$/, '')).includes(o);
}
// refuse a websocket with a message the game can show (a plain HTTP error only shows up as "can't reach the server")
function refuse(code, why, msg) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept(); server.send(JSON.stringify({ t: 'err', code: why, msg })); server.close(code, why);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/') return new Response(`cpm relay ok · proto ${PROTO} · max ${MAX}`, { headers: HDR });
    const m = u.pathname.match(ROOM);
    if (!m) return new Response('not found', { status: 404, headers: HDR });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426, headers: HDR });
    if (!originOk(req.headers.get('Origin'), env)) return refuse(4003, 'origin', 'This server only accepts the official game page.');
    if (+u.searchParams.get('v') !== PROTO) return refuse(4000, 'proto', 'The game and the server are different versions. Reload the page.');
    return env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase())).fetch(req);
  },
};

const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
const num = v => typeof v === 'number' && Number.isFinite(v);
// look = { bike: id, parts: { key: option index } } (the remote model only needs the parts: paint, carbon, exhaust)
function cleanLook(l) {
  if (!l || typeof l !== 'object' || typeof l.bike !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(l.bike)) return null;
  const parts = {};
  if (l.parts && typeof l.parts === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(l.parts)) { if (++n > 24) break; if (/^[a-zA-Z0-9_]{1,16}$/.test(k) && Number.isInteger(v) && v >= 0 && v < 32) parts[k] = v; }
  }
  return { bike: l.bike, parts };
}
// race messages: only these fields, with sane types
function cleanRace(m) {
  const OPS = ['ask', 'no', 'busy', 'go', 'fin', 'quit'];
  if (!OPS.includes(m.op) || !Number.isInteger(m.to) || !Number.isInteger(m.rid)) return null;
  const r = { t: 'race', op: m.op, to: m.to, rid: m.rid };
  if (m.op === 'go') { if (!num(m.x) || !num(m.z) || Math.abs(m.x) > 5000 || Math.abs(m.z) > 5000) return null; r.x = m.x; r.z = m.z; r.echo = true; }
  if (m.op === 'fin') { if (!num(m.time) || m.time < 0 || m.time > 3600) return null; r.time = m.time; }
  if (m.op === 'no' && m.why === 'course') r.why = 'course';
  return r;
}

export class Room extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.lim = new Map(); } // per-socket buckets (in memory: reset if the room hibernates, which is fine)
  // everyone in the room (the attachment survives hibernation)
  list(except) {
    const out = [];
    for (const w of this.ctx.getWebSockets()) { if (w === except) continue; const a = w.deserializeAttachment(); if (a && a.id) out.push([w, a]); }
    return out;
  }
  async fetch(req) {
    const u = new URL(req.url), ip = req.headers.get('CF-Connecting-IP') || '', [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const bye = (code, why, msg) => { server.send(JSON.stringify({ t: 'err', code: why, msg })); server.close(code, why); return new Response(null, { status: 101, webSocket: client }); };
    const peers = this.list(server);
    if (peers.length >= MAX) return bye(4001, 'full', `This room is full (${MAX} players).`);
    if (ip && peers.filter(p => p[1].ip === ip).length >= PER_IP) return bye(4001, 'full', 'Too many connections from your network in this room.');
    const used = new Set(peers.map(p => p[1].id)); let id = 1; while (used.has(id)) id++;
    const me = { id, ip, name: clean(u.searchParams.get('name')) || 'Rider ' + id, look: null };
    server.serializeAttachment(me);
    server.send(JSON.stringify({ t: 'hi', id, max: MAX, now: Date.now(), peers: peers.map(([, a]) => ({ id: a.id, name: a.name, look: a.look })) }));
    this.bcast(JSON.stringify({ t: 'join', id, name: me.name }), server);
    return new Response(null, { status: 101, webSocket: client });
  }
  bcast(data, except) { for (const [w] of this.list(except)) try { w.send(data); } catch (e) { } }
  // token bucket per socket and kind; false = drop. Too many drops in a 10 s window closes the socket.
  allow(ws, kind) {
    const now = Date.now(); let L = this.lim.get(ws);
    if (!L) this.lim.set(ws, L = { t: now, win: now, drop: 0, bin: RATE.bin[1], txt: RATE.txt[1], look: RATE.look[1] });
    const dt = (now - L.t) / 1000; L.t = now;
    for (const k in RATE) L[k] = Math.min(RATE[k][1], L[k] + dt * RATE[k][0]);
    if (now - L.win > 10000) { L.win = now; L.drop = 0; }
    if (L[kind] >= 1) { L[kind] -= 1; return true; }
    if (++L.drop > FLOOD) { try { ws.send(JSON.stringify({ t: 'err', code: 'flood', msg: 'Disconnected: too many messages.' })); ws.close(4002, 'flood'); } catch (e) { } this.gone(ws); }
    return false;
  }
  async webSocketMessage(ws, msg) {
    const me = ws.deserializeAttachment(); if (!me || !me.id) return;
    if (typeof msg !== 'string') { // bike state: sanity-check, prefix the sender id, forward to everyone else
      if (msg.byteLength !== 44 || !this.allow(ws, 'bin')) return;
      const d = new DataView(msg), x = d.getFloat32(8, true), y = d.getFloat32(12, true), z = d.getFloat32(16, true);
      if (d.getUint8(0) !== 1 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(x) > 5000 || Math.abs(z) > 5000 || y < -200 || y > 2000) return;
      const out = new Uint8Array(45); out[0] = me.id; out.set(new Uint8Array(msg), 1);
      this.bcast(out, ws); return;
    }
    if (msg.length > 1024 || !this.allow(ws, 'txt')) return;
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') { if (num(m.c)) ws.send(JSON.stringify({ t: 'pong', c: m.c })); return; }
    let out;
    if (m.t === 'look') {
      if (!this.allow(ws, 'look')) return;
      const look = cleanLook(m.look); if (!look) return;
      me.look = look; ws.serializeAttachment(me); out = { t: 'look', look };
    } else if (m.t === 'race') { out = cleanRace(m); if (!out) return; }
    else return;
    out.from = me.id; const data = JSON.stringify(out);
    if (out.to) { if (out.to === me.id) return; for (const [w, a] of this.list(ws)) if (a.id === out.to) try { w.send(data); } catch (e) { } }
    else this.bcast(data, ws);
    if (out.echo) ws.send(data);
  }
  async webSocketClose(ws, code) { this.gone(ws); try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch (e) { } }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    this.lim.delete(ws);
    const me = ws.deserializeAttachment(); if (!me || !me.id) return;
    ws.serializeAttachment({ id: 0 }); // so list() skips it while it closes
    this.bcast(JSON.stringify({ t: 'leave', id: me.id }), ws);
  }
}
