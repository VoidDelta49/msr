// CPM: Motor Edition multiplayer relay (Cloudflare Worker + one Durable Object per room code).
// The relay doesn't simulate anything: every phone runs its own physics and sends its bike state; the room just
// forwards it. Binary messages (bike state, ~42 bytes) are broadcast with the sender's id byte in front. Text messages
// are JSON control messages: `to` sends to one player, `echo` also sends it back to the sender (so both sides of a race
// get the "go" at the same moment), `look` is kept so players who join later get it in their `hi`.
// Uses the WebSocket Hibernation API: an idle room costs no duration. Free plan: incoming messages count 20:1 as requests
// (100k requests/day), outgoing messages are free, so clients send 10 Hz while moving and 2 Hz while parked.
import { DurableObject } from 'cloudflare:workers';

const PROTO = 1; // bump together with PROTO in js/net.js when the message format changes
const MAX = 8;   // players per room (ids are one byte: up to 255 once interest management exists)
const ROOM = /^\/room\/([A-Za-z0-9]{4,8})$/;

export default {
  async fetch(req, env) {
    const u = new URL(req.url), m = u.pathname.match(ROOM);
    if (u.pathname === '/') return new Response(`cpm relay ok · proto ${PROTO} · max ${MAX}`, { headers: { 'access-control-allow-origin': '*' } });
    if (!m) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    return env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase())).fetch(req);
  },
};

const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);

export class Room extends DurableObject {
  // everyone in the room (the attachment survives hibernation)
  list(except) {
    const out = [];
    for (const w of this.ctx.getWebSockets()) { if (w === except) continue; const a = w.deserializeAttachment(); if (a && a.id) out.push([w, a]); }
    return out;
  }
  async fetch(req) {
    const u = new URL(req.url), [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const bye = (code, why, msg) => { server.send(JSON.stringify({ t: 'err', code: why, msg })); server.close(code, why); return new Response(null, { status: 101, webSocket: client }); };
    if (+u.searchParams.get('v') !== PROTO) return bye(4000, 'proto', 'The game and the server are different versions. Reload the page.');
    const peers = this.list(server);
    if (peers.length >= MAX) return bye(4001, 'full', `This room is full (${MAX} players).`);
    const used = new Set(peers.map(p => p[1].id)); let id = 1; while (used.has(id)) id++;
    const me = { id, name: clean(u.searchParams.get('name')) || 'Rider ' + id, look: null };
    server.serializeAttachment(me);
    server.send(JSON.stringify({ t: 'hi', id, max: MAX, now: Date.now(), peers: peers.map(p => p[1]) }));
    this.bcast(JSON.stringify({ t: 'join', id, name: me.name }), server);
    return new Response(null, { status: 101, webSocket: client });
  }
  bcast(data, except) { for (const [w] of this.list(except)) try { w.send(data); } catch (e) { } }
  async webSocketMessage(ws, msg) {
    const me = ws.deserializeAttachment(); if (!me || !me.id) return;
    if (typeof msg !== 'string') { // bike state: prefix the sender id, forward to everyone else
      if (msg.byteLength > 96) return;
      const out = new Uint8Array(msg.byteLength + 1); out[0] = me.id; out.set(new Uint8Array(msg), 1);
      this.bcast(out, ws); return;
    }
    if (msg.length > 4096) return;
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', c: m.c, now: Date.now() })); return; }
    if (m.t === 'look') { me.look = m.look; ws.serializeAttachment(me); }
    m.from = me.id; const data = JSON.stringify(m);
    if (m.to) { for (const [w, a] of this.list(ws)) if (a.id === m.to) try { w.send(data); } catch (e) { } }
    else this.bcast(data, ws);
    if (m.echo) ws.send(data);
  }
  async webSocketClose(ws, code) { this.gone(ws); try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch (e) { } }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const me = ws.deserializeAttachment(); if (!me || !me.id) return;
    ws.serializeAttachment({ id: 0 }); // so list() skips it while it closes
    this.bcast(JSON.stringify({ t: 'leave', id: me.id }), ws);
  }
}
