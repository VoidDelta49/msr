# CPM: Motor Edition

A 3D web game about riding and parking Philippine-market motorcycles on a Philippine-style island. Built with Three.js (WebGPU with WebGL 2 fallback), targeted at mobile browsers. No build step.

> **Unofficial fan project.** Not affiliated with, authorized by or endorsed by Honda, Suzuki or any other company named here. All product names, brands and trademarks belong to their owners and are used only to identify the real motorcycles the models represent. Free and non-commercial. See [LEGAL.md](LEGAL.md).

## Play

Open the GitHub Pages site for this repo on your phone. It plays fullscreen. (Opening `index.html` straight from disk won't work: ES modules and the bike data need to be served over http.)

## The island

About 1.7 × 1.5 km (2.2× the area before Build 8.5): a town with a parking lot and gas station, a coastal ring highway, beaches, a volcano, rice terraces and paddies, a river with bridges, a switchback mountain pass over a ridge in the northeast (guardrails, viaduct sections, ~13% max grade) and a 900 m airstrip on the north plain for top-speed and 0–100 runs, linked to the highway by taxiways.

The layout is data: `data/map/island.json` holds the coastline (radius samples around the island centre), terrain features (volcano, terraces, ridges with per-point crest heights, levelled areas), the river, every road (points, width, highway/airstrip kind), speed bumps, town blocks, parked vehicles, hangars and prop counts. The game builds terrain, roads and props from it at load, so editing the file (or a future map editor) changes the island.

## Bikes

| | Suzuki Raider R150 Fi | Honda Click 125i | Suzuki Smash 115 / Fi | Honda CBR650R | Honda TMX Supremo |
|---|---|---|---|---|---|
| Engine | 147 cc DOHC, ~18.5 PS @ 10,000 rpm, ~13.8 Nm @ 8,500 | 124.8 cc SOHC eSP, 8.2 kW (11.1 PS) @ 8,500 rpm, 10.8 Nm @ 5,000 | Carb: 109.7 cc SOHC 2-valve, 5.6 kW @ 7,000 rpm, 9.0 Nm @ 4,000. Fi: 113 cc, 6.4 kW @ 8,000, 9.0 Nm @ 4,000 | 649 cc DOHC inline-four, 95 PS @ 12,000 rpm, 63 Nm @ 9,500 | 149.2 cc SOHC 2-valve carb, 11.1 hp @ 7,500 rpm, 11.6 Nm @ 5,000 |
| Transmission | 6-speed return shift (1-N-2-3-4-5-6), wet clutch, chain | V-Matic CVT, dry centrifugal clutch, belt | 4-speed rotary (N-1-2-3-4, 4 → N only when stopped), automatic centrifugal clutch, no clutch lever, 14/36 chain | 6-speed (primary 1.690, gears 3.071–1.214), assist/slipper clutch, 15/42 chain | 5-speed return shift (1-N-2-3-4-5), wet clutch, 15/42 chain |
| Extras | Anti-stall clutch assist | Idling Stop, CBS brakes, start needs the brake held | Carb or fuel injection in one bike (Parts > Fuel system), three trims: spokes + drums, spokes + front disc, mags + front disc | Honda E-Clutch (clutchless starts and shifts, can't stall), slipper clutch, 5" TFT with shift light | Tricycle sidecar (Parts > Sidecar): no lean, pulls toward the sidecar on the gas and away on the brakes, the sidecar lifts in fast turns toward it and can roll over |
| Garage | Exhaust, ECU, tires, paint, sprockets, carbon fiber parts, preload, ride height, springs, damping | Rollers (bola), center spring, clutch springs, pulley set, exhaust, ECU, tires, paint, carbon fiber parts, preload, ride height, springs, damping | Fuel system, wheels & brakes, engine tune, exhaust, tires, paint, sprockets, carbon fiber parts, preload, ride height, springs, damping | Exhaust, ECU, tires, 3 factory paints, sprockets, carbon fiber parts, preload, ride height, springs, damping, E-Clutch on/off | Sidecar, exhaust, engine tune, tires, paint, sprockets, preload, ride height, springs, damping |

CBR650R figures are Honda's published specs (208 kg, 1,450 mm wheelbase, 25.5° rake, 15.4 L, 120/70-17 + 180/55-17, 310 mm twin discs). Honda doesn't publish the torque curve or rev limit: the curve is shaped to the published peaks, the limiter is set at 12,750 rpm. In-game (flat road, 68 kg rider, E-Clutch launch): 0–100 km/h ≈ 4.1 s, 400 m ≈ 12.2 s @ 191 km/h, top ≈ 226 km/h, 1st gear tops out at 104 km/h.

Click 125i figures are Honda's published specs. Honda doesn't publish the CVT ratio range or final drive, so those are estimates (2.40–0.80 × 10.0) chosen to match the claimed ~100 km/h top speed.

Smash figures are Suzuki Philippines' published specs (99 kg curb, 1,240 mm wheelbase, 750 mm seat, 70/90-17 + 80/90-17). Suzuki doesn't publish the gear ratios, tank size or torque curve: the ratios (primary 3.421, 2.833 / 1.705 / 1.238 / 0.958, 14/36) are typical of Suzuki's 110 cc rotary engines, the tank is 4.0 L, and the curves are shaped to the published peaks.

### How the CVT works in-game

- **Centrifugal clutch:** shoe torque grows with rpm² above the clutch-spring preload. It starts to bite around 3,200 rpm and is locked by about 4,800 (stock springs).
- **Variator:** the rollers push the drive pulley closed with about m·ω². The center spring and torque cam push back, harder as the belt climbs and harder under load. The ratio moves until those balance, so at full throttle the engine holds roughly 6,700–7,200 rpm while speed rises. Lighter rollers raise that rpm, and a stiffer center spring raises it further.
- **Idling Stop:** the engine shuts off after 3 s stopped at idle and restarts when you open the throttle.

## Quests (Build 9.5)

The hub layout is seeded by the date (Philippine day, UTC+8): everyone gets the same hubs, types and bike locks on the same day, and it all reshuffles at midnight (reload to pick it up).

Quest hubs are coloured beacons in the world and pins on the minimap (pins in view, plus the three nearest at its rim). The parking hub stays in the lot (the only place with bays); 14 delivery hubs (parcel or food, rolled at random each load) sit on random roads all over the island, at least 140 m apart, three of them in town. Ride into one and hold still for a moment to take the job; the pin then becomes the drop-off. ✕ in the panel cancels, and after a job you have to leave the hub before it can trigger again. A finished or failed delivery hub moves somewhere else with a new type; a cancelled one stays.

About a third of delivery hubs are **bike-locked** (red outline on the map and a second red ring): taking one switches you to that bike where you stand (full tank, same position and heading), and the time limit is 15% tighter. Changing bikes during the job cancels it.

- **Parking challenge** (blue P): park in the green bay. Stars for time and hits. *Next* gives another bay.
- **Parcel delivery** (tan B): the parcel rides on the pillion seat. A crash, a hard wall hit (> 7 m/s, also with Tough Biker on) or a swim and it falls off: game over. Stars for time and hits.
- **Food delivery** (pink F): quality starts at 100% and drops with bumps, hard braking, hard acceleration, fast lean changes, strong cornering and walls; heat drops steadily to 0 at the time limit (about 7.5 m/s average over the straight-line distance, plus 30 s). A crash, a swim or heat 0 is game over; quality 0 is not, you still deliver (for one star).

Counts, spacing and the bike-lock share are the constants at the top of `js/missions.js` (`NHUB`, `SEP`, `BIKE_P`, `HARD`), as is the spoilage table `K`.

## Multiplayer (Build 9.0)

Main menu > MULTIPLAYER: type a name, then JOIN a room code or make a NEW ROOM and share its code (up to 8 riders per room). Everyone rides their own bike with their own physics; other riders appear as ghost bikes (no collisions) with their real bike and paint, a name tag and a cyan dot on the minimap.

**Racing:** tap a rider's name tag (within 90 m, it shows 🏁) to challenge them. When they accept, a finish beacon appears on a road about the same distance from both of you (350-900 m). Hold still for the 3-2-1 (moving early = +3 s), then get there first. ✕ gives up. Quests can't start during a race.

The relay is a small Cloudflare Worker in `server/` (deploy steps in `server/README.md`).


**Tricycle rides (11.23):** stop next to a friend's TMX with the sidecar fitted and tap their name tag (it shows 🛺): RIDE asks, the driver gets OK / ✕. Two passengers fit on the bench; each adds 65 kg to the sidecar in the driver's physics. Your own bike is put away while you ride and comes back beside the tricycle when you tap GET OFF. If the tricycle crashes, everybody aboard is flung out cartoon-style (on every phone that sees it) and lands next to their bike. Needs the 11.23 relay (`server/worker.js`, `ride` messages): redeploy it with `npx wrangler deploy`.
## Controls

Touch:

- Handlebar: bottom-left (drag around it to steer)
- Throttle pad (drag down to open, release to close) plus a brake button (CBS on the Click)
- Smash: ▲ / ▼ shift buttons only (automatic clutch, shift any time)
- Raider / CBR650R: clutch pad (drag down to pull), ▲ / ▼ shift buttons (clutch must be pulled to shift, except on the CBR with E-Clutch on)
- KEY (ignition) and KILL (engine stop switch) buttons, START (hold to crank). Start sequence: key on, wait ~2 s for the fuel pump, neutral or clutch in (Click: hold the brake), hold START with the throttle closed. Cold engines crank longer and idle high until warm. A crash trips the tip-over sensor: turn the key off and on again.
- ◀ BACK (hold): walk the bike backwards with your feet (~3 km/h, bikes have no reverse). Only when stopped with the throttle shut; on the Raider, in neutral or with the clutch pulled.
- Top bar: CAM, GARAGE, RESET, ⚙ (options)

Keyboard:

- `W` / `S`: throttle / brake, `A` / `D`: steer
- Raider: `E` / `Shift` shift up, `Q` / `Ctrl` shift down, `Space` clutch
- Click: `Space` is the rear (CBS) brake lever
- Smash: `E` / `Q` shift (no clutch), `Space` is the rear brake. Carb version: no pump to prime, but a cold start cranks longer
- `X` (hold): walk the bike backwards
- `K`: ignition key, `T`: kill switch, `R` (hold): starter, `C`: camera, `G`: garage (bike picker is at the top), `O`: options (`Esc` closes), `Esc`: pause menu (also ☰ in the top bar)

## Project layout

Everything bike-specific is data. Adding a bike means adding a JSON file, plus a model/cluster builder if it needs a new look. Give it its own `sound.parts` profile too (brake squeal, chain, suspension thump, key click, body rattle, ...; every key is a level or pitch multiplier, see `pv()` in `js/audio.js`), otherwise it sounds like a neutral default bike.

```
index.html            markup + importmap
css/style.css
data/bikes/index.json list of bikes
data/bikes/*.json     specs: chassis, engine torque curve, drivetrain params, garage parts/sliders/toggles, defaults
js/menu.js            page entry: main/pause menu, background download of the engine, loads main.js on PLAY
js/main.js            game: loads data, bike switching, camera/animation, loop
js/spec.js            bike data + garage settings -> flat spec the physics reads
js/drivetrain.js      manual gearbox + CVT (ratio, clutch capacity, variator, Idling Stop)
js/physics.js         engine, clutch-slip solver, steering/lean, bump-stop helper
js/tyre.js            tyre slip->force curve and surface grip (asphalt / dirt shoulder / grass / paddy)
js/rapier.js          Rapier3D chassis: dynamic bike body, suspension probes, streamed static colliders (fixed 120 Hz tick)
js/model.js           3D models (Raider R150 underbone, Click 125i scooter, Smash 115 step-through, CBR650R supersport, TMX Supremo + tricycle sidecar), low-poly extruded panels
js/tex.js             N64-style procedural textures (tiny, dithered, bilinear) + sky
js/hud.js             gauge clusters (sport / scooter LCD / CBR TFT), messages, minimap
js/world.js           builds the island from data/map/island.json: terrain, roads, town, props, collision footprints, parking lot
data/map/island.json  the island layout (coast, features, river, roads, town blocks, vehicles, hangars, prop counts)
js/renderer.js        WebGPU/WebGL setup and fallback, quality preset
js/perf.js            culling, terrain LOD, merging, Lambert materials, auto resolution
js/gpucull.js         WebGPU compute culling + indirect draws for instanced props
js/net.js             multiplayer: relay connection, state packets, interpolated ghost bikes, name tags
js/race.js            tap-to-race between two riders
js/ride.js            tricycle passengers: hop into a friend's sidecar, cartoon ejections on a crash
server/               Cloudflare Worker + Durable Object relay (one room per code)
js/audio.js (+ engine-worklet.js), controls.js, garage.js, options.js, missions.js, config.js, state.js, util.js
```

Part options in the bike JSON are applied generically: `pow`, `ie` and `csp` multiply; any other key (`red`, `idle`, `mu`, `roller`, `lo`, `hi`, `eng`, `c`, `snd`) replaces the base value.

## Renderer

Uses three r0.186.1 `WebGPURenderer` with automatic WebGL 2 fallback (also on device loss or errors). Options (⚙) has Force WebGL, FPS and renderer readouts, Sound, Ambient sounds, Volume, and touch steering sensitivity.

Sound is fully synthesized WebAudio, no samples: an AudioWorklet engine voice builds every combustion pulse (muffler thump, pipe tone, valvetrain tick, intake, afterfire crackle on closed throttle and at the limiter; aftermarket exhausts get louder, brighter and poppier), speed-driven wind with gusts (louder in first person), tyre roar on asphalt vs crunch off-road, squeal past the grip limit, scraping, and island ambience by location: surf toward the sea, the river, cicadas and birds in the countryside, frogs at the rice paddies, town hum with dogs and jeepney horns, a volcano rumble. Ambience ducks as you speed up.

### Performance (Build 5.3)
- **Quality** (Options → GRAPHICS, reloads): Low / Medium (default) / High. Sets draw distance (fog end: 550 / 1100 / 1400 m), pixel-ratio cap (1 / 1.5 / 2), shadows (off / 1024 / 2048), texture anisotropy, and on Low swaps the island's PBR materials for cheaper Lambert ones.
- **Anti-aliasing FXAA** (on by default, reloads): one cheap post pass instead of MSAA.
- **N64 colour filter** (on by default, reloads): 15-bit colour with a 4x4 ordered dither and a touch of saturation, in the same post pass.
- **Retro res** (Off / 480p / 360p / 240p): caps the render height and upscales with crisp pixels. Also a big speed-up on slow phones.
- **Auto resolution** (on by default): drops render resolution in 10% steps (down to 55%) when the game can't hold the screen's refresh rate, and creeps back up when it can.
- **Culling**: props are static instanced chunks (700 m); off-screen chunks are skipped in the main and shadow pass. Small one-off props hide past 220 / 550 m.
- **GPU culling** (WebGPU only, on by default, reloads): each prop type is one instanced mesh for the whole island; a compute pass culls every instance against the view and its draw distance each frame and draws the survivors with an indirect draw. Props near the bike are kept for the shadow pass. On WebGL the chunked culling above is used.
- **Instant main menu**: the page opens on a plain-HTML menu (bike picker, options, controls) in a fraction of a second. three.js, Rapier and the game modules download in the background with a progress bar and are only parsed and built when you tap PLAY.
- **Shader warm-up**: while the loading bar shows "Compiling shaders", every material's shader is built up front (in parallel where the browser supports it), so switching camera, crashing or riding into a new area doesn't stall on a shader compile.
- **Terrain LOD**: the ground is 5×5 tiles of 280 m, frustum-culled, each at 5 / 10 / 20 m detail by distance, with skirts so seams never show. Physics still uses the full-detail heights.
- Bike and church meshes are merged per material (fewer draw calls); static objects don't recompute their matrices each frame; the gauge cluster and minimap only redraw when something on them changes.
- With Show FPS on, the readout also shows draw calls per frame and the current auto-resolution scale.

WebGPU has not been verified on real hardware yet. Check the renderer readout on your device.

## Technical notes

- Cache busting: `index.html` maps every `./js/*.js` module to `?v=<build>` through the importmap, and the data files use `?v=<BUILD>`. **When you ship a change, bump `BUILD` in `js/config.js` and the `?v=` values in `index.html` together** (a phone can otherwise run a new page with old scripts).

- Offline: three.js and Rapier are vendored in `vendor/` (importmap points there, no CDN). `sw.js` (registered as `sw.js?v=BUILD` once the downloads finish; off on localhost unless `?sw`) precaches the whole single-player game, building its file list from `index.html` and the modules, so **bumping `BUILD` is all a release needs**. After one online visit the game runs with no connection (the menu footer says "works offline"); the page is fetched fresh when online (4 s timeout), from the cache when not. Multiplayer needs a connection and says so when offline.
- Settings are stored in `localStorage` key `cpmme`: global options plus a `bikes` block per bike. Older single-bike saves are migrated into `bikes.raider150` automatically. The WebGL fallback flag is in `sessionStorage` key `cpmGL`.
- Physics runs on [Rapier3D](https://rapier.rs) (`@dimforge/rapier3d-compat` 0.21.0, vendored, loaded before the start screen; if it can't load, the start screen says so).
  - The bike is a dynamic Rapier body: Rapier integrates heave, pitch, gravity, airtime and wall contacts. The bike solver in `physics.js` (engine, clutch/CVT, speed along the ground, steering and lean) runs 3 substeps inside each fixed 120 Hz tick (max 4 ticks per frame, drawing is interpolated).
  - Tyres (`tyre.js` + `physics.js`): each tyre's peak force is grip × axle load (static split plus load transfer under accel/braking) × the surface under it (asphalt 1, dirt shoulder ~0.78, grass ~0.62, paddy mud lower). Cornering and driving/braking share that grip (friction circle), so braking or powering hard in a corner raises the chance of a slide. Past the slip peak the rear wheel **spins** (rpm flares, tyre noise, the tail steps out when leaned) or **skids** under engine braking, and until it re-grips only a sliding force (~85% of peak) reaches the ground. Without ABS a brake past a tyre's peak **locks** that wheel (front lock leaves almost no steering grip, rear lock steps out when leaned) until the lever is eased well off; the CBR650R has ABS. `bf` in a bike's chassis is the front share of the brake (default 0.85, Click CBS 0.7).
  - Suspension: ground probes at both axles against the drawn surface, spring-dampers (with preload), inelastic bump stops at full travel.
  - Walls take away the speed going into them; a glancing hit deflects the bike along the wall, with scraping friction.
  - Static boxes are streamed: only the 3 × 3 block of 25 m cells around the bike exists in the Rapier world, because step cost grows with every collider.
  - With Show FPS on, the readout shows the physics cost per frame.
- Crashes: with **Tough Biker mode** off (Options → PHYSICS, off by default), a hard wall hit (> ~25 km/h), steering harder than the tyres can grip, or a hard or nose/tail-first landing throws the rider off and the bike tumbles and slides. Once it stops it's stood back up where it ended, engine off. Tough Biker mode on: no falls, walls only stop you.
- Steering at speed asks for a share of the grip: full lock is ~90% of it, so a held corner alone never low-sides. Braking hard, a locked front or wheelspin at full lock still asks for more than the tyres have, and the bike slides out (tyre squeal first).
- **Wheelie control** (Options → PHYSICS, on by default): the ECU trims torque as the acceleration nears the lift point and cuts it if the front leaves the ground. Turn it off to wheelie.
- Garage: fork and shock preload (±20 mm) raise or lower the ride height and the CG, and change how much bump travel is left.
- Garage (Update 2): front/rear ride height (±25 mm, 5 mm steps) lifts the chassis and CG without changing sag or travel. Carbon fiber body panels (plain or paint-tinted), fenders, wheels and muffler cover each cut weight (option key `dm`, kg, added to the chassis mass); the weight shows in the stats. RESET TO STOCK (tap twice) puts every part, slider and assist of the current bike back to its defaults.
- Manual gearbox (Update 4): `manual.slipper` (Nm) caps the torque the clutch passes back from the wheel, so a downshift without a blip slips instead of locking the rear; `manual.eclutch` lets shifts happen without the lever when the bike's `autoClutch` assist is on (ignition cut on upshifts, clutch slipped on pull-away and opened near idle).
- Debug hook: `window.__cpm` (`S`, `cfg`, `ctx`, `spec()`, `step`, `shift`, `reset`, `setBike(id)`, `startEngine`, ...).

## Known limitations

- The soft-shadow mode was lost in the WebGPU renderer, so shadow edges are slightly harder (PCF).

## Ideas

- Compute-shader features: GPU grass, rain, more traffic
- Visual pass (materials, lighting, bike model detail)
- Multiplayer: remote engine sounds, bike-to-bike bumps, races with more riders, shared quests

## Legal

- Code: MIT, see [LICENSE](LICENSE) (original code and assets only; it grants no rights to third-party trademarks or designs).
- Dependencies (three.js MIT, Rapier3D Apache-2.0): [THIRD_PARTY.md](THIRD_PARTY.md).
- Trademark and design notes, rules for new content, and the plan if the project goes public: [LEGAL.md](LEGAL.md).
