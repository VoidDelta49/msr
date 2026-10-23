# CPM: Motor Edition

A 3D web game about riding and parking Philippine-market motorcycles on a Philippine-style island. Built with Three.js (WebGPU with WebGL 2 fallback), targeted at mobile browsers. No build step.

## Play

Open the GitHub Pages site for this repo on your phone. It plays fullscreen. (Opening `index.html` straight from disk won't work: ES modules and the bike data need to be served over http.)

## Bikes

| | Suzuki Raider R150 Fi | Honda Click 125i |
|---|---|---|
| Engine | 147 cc DOHC, ~18.5 PS @ 10,000 rpm, ~13.8 Nm @ 8,500 | 124.8 cc SOHC eSP, 8.2 kW (11.1 PS) @ 8,500 rpm, 10.8 Nm @ 5,000 |
| Transmission | 6-speed return shift (1-N-2-3-4-5-6), wet clutch, chain | V-Matic CVT, dry centrifugal clutch, belt |
| Extras | Anti-stall clutch assist | Idling Stop, CBS brakes, start needs the brake held |
| Garage | Exhaust, ECU, tires, paint, sprockets, carbon fiber parts, preload, ride height, springs, damping | Rollers (bola), center spring, clutch springs, pulley set, exhaust, ECU, tires, paint, carbon fiber parts, preload, ride height, springs, damping |

Click 125i figures are Honda's published specs. Honda doesn't publish the CVT ratio range or final drive, so those are estimates (2.40–0.80 × 10.0) chosen to match the claimed ~100 km/h top speed.

### How the CVT works in-game

- **Centrifugal clutch:** shoe torque grows with rpm² above the clutch-spring preload. It starts to bite around 3,200 rpm and is locked by about 4,800 (stock springs).
- **Variator:** the rollers push the drive pulley closed with about m·ω². The center spring and torque cam push back, harder as the belt climbs and harder under load. The ratio moves until those balance, so at full throttle the engine holds roughly 6,700–7,200 rpm while speed rises. Lighter rollers raise that rpm, and a stiffer center spring raises it further.
- **Idling Stop:** the engine shuts off after 3 s stopped at idle and restarts when you open the throttle.

## Controls

Touch:

- Handlebar: bottom-left (drag around it to steer)
- Throttle pad (drag up/down) plus a brake button (CBS on the Click)
- Raider only: clutch pad (drag down to pull), ▲ / ▼ shift buttons (clutch must be pulled to shift)
- START button. On the Click, hold the brake while pressing it.
- ◀ BACK (hold): walk the bike backwards with your feet (~3 km/h, bikes have no reverse). Only when stopped with the throttle shut; on the Raider, in neutral or with the clutch pulled.
- Top bar: CAM, PARK, GARAGE, RESET, ⚙ (options)

Keyboard:

- `W` / `S`: throttle / brake, `A` / `D`: steer
- Raider: `E` / `Shift` shift up, `Q` / `Ctrl` shift down, `Space` clutch
- Click: `Space` is the rear (CBS) brake lever
- `X` (hold): walk the bike backwards
- `R`: start engine, `C`: camera, `G`: garage (bike picker is at the top), `P`: parking mission, `O`: options (`Esc` closes)

## Project layout

Everything bike-specific is data. Adding a bike means adding a JSON file, plus a model/cluster builder if it needs a new look.

```
index.html            markup + importmap
css/style.css
data/bikes/index.json list of bikes
data/bikes/*.json     specs: chassis, engine torque curve, drivetrain params, garage parts/sliders/toggles, defaults
js/main.js            entry: loads data, bike switching, camera/animation, loop
js/spec.js            bike data + garage settings -> flat spec the physics reads
js/drivetrain.js      manual gearbox + CVT (ratio, clutch capacity, variator, Idling Stop)
js/physics.js         engine, clutch-slip solver, steering/lean, bump-stop helper
js/rapier.js          Rapier3D chassis: dynamic bike body, suspension probes, streamed static colliders (fixed 120 Hz tick)
js/model.js           3D models (sport underbone, scooter)
js/hud.js             gauge clusters (sport / scooter LCD), messages, minimap
js/world.js           the island, roads, town, collision footprints, parking lot
js/renderer.js        WebGPU/WebGL setup and fallback, quality preset
js/perf.js            culling, terrain LOD, merging, Lambert materials, auto resolution
js/audio.js, controls.js, garage.js, options.js, missions.js, config.js, state.js, util.js
```

Part options in the bike JSON are applied generically: `pow`, `ie` and `csp` multiply; any other key (`red`, `idle`, `mu`, `roller`, `lo`, `hi`, `eng`, `c`, `snd`) replaces the base value.

## Renderer

Uses three r0.186.1 `WebGPURenderer` with automatic WebGL 2 fallback (also on device loss or errors). Options (⚙) has Force WebGL, FPS and renderer readouts, Sound, and touch steering sensitivity.

### Performance (Build 5.3)
- **Quality** (Options → GRAPHICS, reloads): Low / Medium (default) / High. Sets draw distance (fog end: 550 / 1100 / 1400 m), pixel-ratio cap (1 / 1.5 / 2), shadows (off / 1024 / 2048), texture anisotropy, and on Low swaps the island's PBR materials for cheaper Lambert ones.
- **Anti-aliasing FXAA** (on by default, reloads): one cheap post pass instead of MSAA.
- **Auto resolution** (on by default): drops render resolution in 10% steps (down to 55%) when the game can't hold the screen's refresh rate, and creeps back up when it can.
- **Culling**: props are static instanced chunks (700 m); off-screen chunks are skipped in the main and shadow pass. Small one-off props hide past 220 / 550 m.
- **Terrain LOD**: the ground is 5×5 tiles of 280 m, frustum-culled, each at 5 / 10 / 20 m detail by distance, with skirts so seams never show. Physics still uses the full-detail heights.
- Bike and church meshes are merged per material (fewer draw calls); static objects don't recompute their matrices each frame; the gauge cluster and minimap only redraw when something on them changes.
- With Show FPS on, the readout also shows draw calls per frame and the current auto-resolution scale.

WebGPU has not been verified on real hardware yet. Check the renderer readout on your device.

## Technical notes

- Cache busting: `index.html` maps every `./js/*.js` module to `?v=<build>` through the importmap, and the data files use `?v=<BUILD>`. **When you ship a change, bump `BUILD` in `js/config.js` and the `?v=` values in `index.html` together** (a phone can otherwise run a new page with old scripts).

- Three.js is loaded from jsDelivr via an importmap, so an internet connection is needed.
- Settings are stored in `localStorage` key `cpmme`: global options plus a `bikes` block per bike. Older single-bike saves are migrated into `bikes.raider150` automatically. The WebGL fallback flag is in `sessionStorage` key `cpmGL`.
- Physics runs on [Rapier3D](https://rapier.rs) (`@dimforge/rapier3d-compat` 0.21.0 from jsDelivr, loaded before the start screen; if it can't load, the start screen says so).
  - The bike is a dynamic Rapier body: Rapier integrates heave, pitch, gravity, airtime and wall contacts. The bike solver in `physics.js` (engine, clutch/CVT, speed along the ground, steering and lean) runs 3 substeps inside each fixed 120 Hz tick (max 4 ticks per frame, drawing is interpolated).
  - Suspension: ground probes at both axles against the drawn surface, spring-dampers (with preload), inelastic bump stops at full travel.
  - Walls take away the speed going into them; a glancing hit deflects the bike along the wall, with scraping friction.
  - Static boxes are streamed: only the 3 × 3 block of 25 m cells around the bike exists in the Rapier world, because step cost grows with every collider.
  - With Show FPS on, the readout shows the physics cost per frame.
- Crashes: with **Tough Biker mode** off (Options → PHYSICS, off by default), a hard wall hit (> ~25 km/h), steering harder than the tyres can grip, or a hard or nose/tail-first landing throws the rider off and the bike tumbles and slides. Once it stops it's stood back up where it ended, engine off. Tough Biker mode on: no falls, walls only stop you.
- Garage: fork and shock preload (±20 mm) raise or lower the ride height and the CG, and change how much bump travel is left.
- Garage (Update 2): front/rear ride height (±25 mm, 5 mm steps) lifts the chassis and CG without changing sag or travel. Carbon fiber body panels (plain or paint-tinted), fenders, wheels and muffler cover each cut weight (option key `dm`, kg, added to the chassis mass); the weight shows in the stats. RESET TO STOCK (tap twice) puts every part, slider and assist of the current bike back to its defaults.
- Debug hook: `window.__cpm` (`S`, `cfg`, `ctx`, `spec()`, `step`, `shift`, `reset`, `setBike(id)`, `startEngine`, ...).

## Known limitations

- The soft-shadow mode was lost in the WebGPU renderer, so shadow edges are slightly harder (PCF).

## Ideas

- Compute-shader features: GPU grass, rain, more traffic
- Visual pass (materials, lighting, bike model detail)
- Multiplayer
