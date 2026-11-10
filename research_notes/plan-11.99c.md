# Plan: 11.99c (ISLA)

Status: **in progress.** Done: item 1 (ISLA rename), item 2 (weather: relay, client, wet physics; see "Item 2: what was built" at the end). Done: item 3 (wheels: Donut tyres on the four scooters, Drag skinny on the four 17-inch small bikes, three new mag designs given per bike; the XMAX still has no thin tyre: no real narrow 15 / 14 inch pair was found). Not started: items 4-6. Item 7 still blocked. BUILD is still 11.99b (bump at release). Source: the owner's handwritten "Plan 4" note plus the discussion after it.

Already shipped in 11.99 / 11.99b (not part of this plan): Dyno fine-tuning (`js/tune.js`), "Thai concept skinny" tires, rim designs (`maker/parts-gen.mjs`), real-clock day/night (`js/daynight.js`).

## Order of work

1. Rename to ISLA (item 1)
2. Weather: relay, client, physics (item 2)
3. Wheels (item 3)
4. Swing-arm and Engine Support (item 5)
5. Suspension accuracy (item 6)
6. Filipino character looks (item 4)
7. **Rusi Surf: LAST, and BLOCKED until the owner supplies specs and photos and says go (item 7). Do not scaffold or research it as part of the earlier items.**

Release steps at the end: bump `BUILD` in `js/config.js` and `?v=` in `index.html`, add the entry to `data/changelog.json`, `node tools/test.mjs` (`--update` only for the intended physics changes), `node tools/check.mjs`, redeploy the relay.

## 1. Rename the game to ISLA

- **Decided: just "ISLA"** (drop "Motor Edition" everywhere). Was "CPM: Motor Edition". Update `<title>` and the `<h1>` in `index.html`, README, `maker/index.html`, and the service worker / manifest if they carry the name.
- Check `CLAUDE.md`, `server/worker.js` header comments, and `tools/README.md` for the old name.

## 2. Weather and dynamic sky

Decisions made: live data, client-side blending, wet physics included, typhoons / PAGASA storms dropped (live conditions only), relay broadcast for rooms, `/wx` route for solo riders.

### Data and relay (`server/worker.js`)

- Source: Open-Meteo (no key, browser-friendly). One fixed point, the same middle-of-the-Philippines point `daynight.js` uses for the sun. Never the player's location.
- Fetch with an edge cache: `cf: {cacheTtl: 900, cacheEverything: true}`. All rooms share it, so about one upstream call per 15 minutes per data centre.
- Quantise to a 15-minute step so every client computes the same weather. One byte each: cloud cover %, precipitation (tenths of mm/h), thunder 0/1, wind speed, wind direction (2-degree steps), visibility km, temperature C, humidity %. Plus a 4-byte timestamp. About 12 bytes binary, under 100 bytes as JSON.
- Rooms: server-to-client `wx` message, sent in `hi` when someone joins and again every 15 minutes while the room has players (Durable Object alarm that stops when the room is empty). Clients send nothing new. Incoming WebSocket messages are what count (20:1) toward the 100k/day free limit; outgoing are free.
- Solo riders: `GET /wx` on the same Worker returns the same snapshot (small JSON, `Cache-Control: max-age=900`, same `ORIGINS` allowlist as rooms). A solo client calls it on start and about every 15 minutes (under 100 requests a day each). Clients in a room use `wx` and do not call `/wx`.
- If a request fails: keep the last weather, then fall back to clear.
- Check before skipping a `PROTO` bump: an older client must silently drop an unknown `wx` message. Document `wx` and `/wx` in `server/README.md` (protocol section).
- The relay must be redeployed (`npx wrangler deploy`) before weather works anywhere. Put that in the release notes.

### Client

- Headless logic (snapshot in, sky and rain values out) with `tools/weather.mjs`.
- Visuals: cloud layer by cover, duller sky and sun, fog / haze from visibility (tie into `FOGU` in `renderer.js` / `daynight.js`), rain particles, wet-road sheen and puddles, rain audio, lightning and delayed thunder, wind on the grass (`js/grass.js`) and rain slant.
- Options > Weather: Live (default), Clear, Light rain, Storm.
- **Decided:** menu background is the live sky and weather (no per-update image).
- NPCs with umbrellas (payong) / raincoats (kapote) go with item 4.
- `sw.js` must not cache `/wx`. Add Open-Meteo attribution to `THIRD_PARTY.md`. Free tier is non-commercial: check if the game is ever sold.

### Wet physics

- A `wet` value 0..1 from current and recent rain scales tyre grip (`mu`), lengthens braking, lowers the cornering limit, and allows hydroplaning at speed in heavy rain. Painted lines, manhole covers and bridge decks are slicker.
- Each tire option gets a wet-grip value in `maker/parts-gen.mjs` (skinny cuts through water, wide fat hydroplanes sooner, racing soft is bad). The numbers are guesses: tune them in test.
- `wet = 0` changes nothing, so `tools/baseline.json` stays valid. Add wet scenarios to `tools/sim.mjs` (`--set wet=1`), then `node tools/test.mjs --update` for those only.
- Dyno stays on dry, standard conditions. Optional later: air density from humidity / temperature.
- Rapier (walls, crashes, suspension) is not covered by the headless tests: needs a browser check.

## 3. Wheels

- Donut tires for automatic scooters (wide, low-profile, 12-14").
- Mags / rim set as an explicit option per bike.
- Thin tires: already there; extend where a size exists (the XMAX has none today). Big bikes are excluded.
- All via `maker/parts-gen.mjs` (a row per bike), visible on the model, re-run the generator and never hand-edit the parts. Keep to the 24 non-`int` part keys limit.

## 4. Filipino character looks

- Skin tones, hair and clothes more accurate to Filipino culture, for the rider and the NPCs. Code: `js/figlook.js` (roles, defaults), `js/figure.js`, `data/npc.json`.
- **Decided:** Claude proposes a set of changes from general knowledge and the owner reviews and corrects it.

## 5. Swing-arm and Engine Support (ES)

- Adjustable swing-arm length for big bikes, underbones and "Pantras". ES for automatic-transmission scooters (adjusts the unit-swing).
- The swing mesh already stretches pivot to axle every frame, so the visual is cheap. The physics change is a different wheelbase (wheelie, squat, stability), so `tools/test.mjs --update` is needed.
- **Decided:** "Pantras" covers both modified Philippine-style underbones and Thai-style / racing underbones (long swing-arm, low builds). ES is a slider plus presets (e.g. Stock, Lowered, Extended). Both swing-arm and ES change the look AND the handling.

## 6. More accurate suspension

- Real fork and shock travel, spring rate and damping per bike in the bike JSON, and the fork / shock compressing on the model to match. Layout per bike type (telescopic fork, monoshock, twin shocks, unit-swing scooter). All 12 bikes.
- Touches physics and Rapier: `tools/test.mjs --update`, plus a browser check.

## 7. New bike: Rusi Surf (LAST, NOT STARTED, BLOCKED)

- **Do not start until the owner says go.** Specs plan: the owner sends initial photos, then Claude gathers more photos and the actual bike specs (owner checks them). It goes last so it launches with the new wheel, swing-arm and suspension options.
- Needed: engine, wheel sizes, brakes, paints, body type, photos.
- When it starts, follow `CLAUDE.md`: `node tools/new-bike.mjs <id> --from <bike>`, `sound.parts`, `engine.geo`, `engine.tune`, a row in `maker/parts-gen.mjs`, sidecar fields and `class`, index.json, model / cluster, garage data. Then `check`, `sweep`, `fuzz`, `test --update`.

## Open questions

None left. All six were answered (title, menu background, Pantras, ES, swing-arm effect, character-look references, Rusi Surf specs). The Rusi Surf still waits for the owner's go and first photos.

## Item 2: what was built, and what is left

Built: `server/wx.js` + `/wx` + room `wx` message and alarm; `js/weather.js`, `js/wxnet.js`, `js/wxfig.js`, `js/menusky.js`; sky cloud cover, grey light, fog from visibility and rain, GPU rain, lightning + delayed thunder, rain sound, wind on the grass and the rain's slant, wet road sheen and puddles, lamps and headlight under a storm sky; Options > Game > Weather; wet grip (`wetGrip`, `wetg` / `aqua` per tyre), slick painted centre lines and bridge decks; `tools/weather.mjs`, `sim.mjs wet`.

Left / to tune on a real phone:
- **Redeploy the relay** (`cd server && npx wrangler deploy`). Until then Live shows clear skies (the fixed weathers work without it).
- All wet-grip and tyre wet numbers are first guesses. Sky / fog / rain amounts were only looked at in headless Chromium.
- Not done: manhole covers (the map has none), rain splashes on the ground, NPC umbrellas / raincoats (item 4), humidity / temperature in the dyno (optional in the plan).
- Wet grip in Rapier situations (crashes, suspension) was not browser-tested beyond riding off in the rain.
