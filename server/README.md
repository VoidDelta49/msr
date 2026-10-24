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
MULTIPLAYER > Server. Opening the URL in a browser should show `cpm relay ok · proto 1 · max 8`.

Local test: `npx wrangler dev` (relay on http://127.0.0.1:8787).

## Protocol

- Connect: `wss://<host>/room/<CODE>?v=<PROTO>&name=<name>` (code 4-8 letters/digits).
- Server → client text: `hi {id, max, now, peers:[{id,name,look}]}`, `join`, `leave`, `err {code,msg}` (close 4000 = wrong
  version, 4001 = full), `pong`, plus any client message with `from` added.
- Client → server text: JSON with `t`. `to: id` = only that player, `echo: true` = also back to the sender,
  `t: 'look'` is stored for later joiners. Races use `t: 'race'` (see js/race.js).
- Binary: bike state (44 bytes, layout in js/net.js `pack()`); the server prepends the sender id byte.
- Change the format → bump `PROTO` in both `worker.js` and `js/net.js`, redeploy. Old cached clients get a "reload" message.

## Free plan limits

100,000 requests/day; incoming WebSocket messages count 20:1, outgoing are free. Clients send 10 Hz while moving and
2 Hz while parked, so a full 8-player room uses about 14k requests per hour of riding (~7 hours/day). Limits reset at
00:00 UTC (8 AM in the Philippines). Raising `MAX` past 8 should come with interest management (only forward nearby
players) so each player's bandwidth doesn't grow with room size.
