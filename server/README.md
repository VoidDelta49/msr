# Multiplayer relay

A Cloudflare Worker with one Durable Object per room code. It only forwards messages: each phone runs its own
physics. Free plan is enough for a group of friends (see limits below).

## Deploy (once)

```sh
cd server
npx wrangler login      # opens the browser, sign in to Cloudflare (free account)
npx wrangler deploy     # prints the URL, e.g. https://cpm-relay.<you>.workers.dev
```

Then either put that URL in `js/config.js` (`MP_URL`) so everyone gets it, or paste it in the game under
MULTIPLAYER > Server. Opening the URL in a browser should show `cpm relay ok · proto 3 · max 8`.

Local test: `npx wrangler dev` (relay on http://127.0.0.1:8787).

## Protocol

- Connect: `wss://<host>/room/<CODE>?v=<PROTO>&name=<name>[&id=<N>]` (code 6-8 letters/digits). `id` asks to resume a previous player id after a dropped connection: if that id is still listed from the same IP, the old socket is retired quietly (close 4004) and the new one inherits the id and look, so peers see no leave/join (`join` carries `back: true`). The page's Origin must be in `ORIGINS` (wrangler.toml) or localhost.
- Server → client text: `hi {id, max, now, peers:[{id,name,look}]}`, `join`, `leave`, `err {code,msg}` (close 4000 = wrong
  version, 4001 = full, 4002 = flooding, 4003 = page not allowed), `pong`, plus forwarded client messages with `from` added.
- Client → server text (max 1 KB): only `ping`, `look {bike, parts:{key: index}}` (stored for later joiners) and `race`
  (`op, to, rid` + `mode` (sprint / parcel / food) for ask and go + `x, z` for go, `time` for fin; see js/race.js). Anything else, or extra fields, is dropped. `to: id` = only
  that player; the server adds `echo` to `go` so both racers start together. `ride` (passengers, js/ride.js) and `soc` (friends, js/social.js:
  `op` wave / treat / cheers / clink / call / thanks + `to`; `item` (a-z0-9_, ≤16) for treat; `x, z` (±5 km) and `place` (≤32 letters) for call) go to one player.
  `soc` was added without a PROTO bump: an older relay drops it silently (the friend actions then do nothing), so redeploy to enable it.
- Weather (11.99c): server → client `wx {wx: {t, c, p, r, th, w, d, v, k, h}}` (small integers, see `wx.js`: 15-minute step, cloud %,
  rain now and over the last hour, thunder, wind, visibility, temperature, humidity), sent right after `hi` and every 15 minutes while
  the room has players (a Durable Object alarm; an empty room sets none). Clients send nothing for it. `GET /wx` returns the same
  snapshot as JSON for solo riders (same `ORIGINS` allowlist, `Cache-Control` until the next step). Source: Open-Meteo, one fixed
  point, fetched through the edge cache (`cacheTtl: 900`), so about one upstream call per 15 minutes per data centre. If it fails the
  last snapshot is served for up to 2 hours, then nothing (clients fall back to clear). Added without a PROTO bump: an older client
  drops the unknown `wx` message, an older relay just never sends it (the game then shows clear weather), so redeploy to enable it.
- Binary: bike state (exactly 44 bytes, layout in js/net.js `pack()`, finite position within ±5 km); the server prepends the sender id byte.
- Change the format → bump `PROTO` in both `worker.js` and `js/net.js`, redeploy. Old cached clients get a "reload" message.

## Free plan limits

100,000 requests/day; incoming WebSocket messages count 20:1, outgoing are free. Clients send 10 Hz while moving (5 Hz when the nearest rider is over 160 m away, half again on a slow link),
1 Hz while parked and nothing at all when alone in the room, so a full 8-player room uses at most about 14k requests per hour of riding (~7 hours/day). Limits reset at
00:00 UTC (8 AM in the Philippines). Raising `MAX` past 8 should come with interest management (only forward nearby
players) so each player's bandwidth doesn't grow with room size.

## Abuse limits

- `ORIGINS` in wrangler.toml: only the game's page can connect (stops other websites; a script can fake the header).
  Add a custom domain there if the game moves. Wrong-page connections get a clear error instead of "can't reach".
- Max 3 connections per IP per room, 8 per room, room codes 6-8 characters (NEW ROOM makes 6 random ones).
- Per connection: bike state 25/s (burst 50), control messages 4/s (burst 16), look changes 1 per 2 s (burst 3).
  More than 150 dropped messages in 10 s closes the socket (4002). Clients send 10/s at most.
- Clients also check everything they receive, rebuild a player's model at most every 3 s, and cache at most 10 models.
- Not covered: someone opening many connections across many rooms to burn the daily quota. If that ever happens, add a
  rate-limiting rule in the Cloudflare dashboard (Security → WAF → Rate limiting) for `/room/*` per IP.

## Client reliability (js/net.js)

- Reconnects with jittered exponential backoff (about 1 s up to 30 s, 60 s once the server keeps refusing, e.g. quota used up), resumes the same id, wakes up at once on `online` / tab focus, and gives up after 40 tries.
- A 15 s heartbeat (`ping`) plus a 40 s silence watchdog catch half-open sockets that never fire `close`.
- A rider who drops stays in the room list for 6 s before their `leave` takes effect; a race gets 12 s to survive a drop and re-sends finish times on resume.
- Ghosts use an adaptive jitter buffer (110-450 ms), extrapolate up to 400 ms, and slide to corrected positions instead of snapping. There is no rollback: bikes are collision-free ghosts with their own physics, so there is no shared simulation to re-run.
