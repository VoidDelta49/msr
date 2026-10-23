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
| Garage | Exhaust, ECU, tires, paint, sprockets, springs, damping | Rollers (bola), center spring, clutch springs, pulley set, exhaust, ECU, tires, paint, springs, damping |

Click 125i figures are Honda's published specs. Honda doesn't publish the CVT ratio range or final drive, so those are estimates (2.40–0.80 × 10.0) chosen to match the claimed ~100 km/h top speed.

### How the CVT works in-game

- **Centrifugal clutch:** shoe torque grows with rpm² above the clutch-spring preload. It starts to bite around 3,200 rpm and is locked by about 4,800 (stock springs).
- **Variator:** the rollers push the drive pulley closed with about m·ω². The center spring and torque cam push back, harder as the belt climbs and harder under load. The ratio moves until those balance, so at full throttle the engine holds roughly 6,700–7,200 rpm while speed rises. Lighter rollers raise that rpm, and a stiffer center spring raises it further.
- **Idling Stop:** the engine shuts off after 3 s stopped at idle and restarts when you open the throttle.

## Controls

Touch:

- Steering wheel: bottom-left
- Throttle pad (drag up/down) plus a brake button (CBS on the Click)
- Raider only: clutch pad (drag down to pull), ▲ / ▼ shift buttons (clutch must be pulled to shift)
- START button. On the Click, hold the brake while pressing it.
- Top bar: CAM, PARK, GARAGE, RESET, ⚙ (options)

Keyboard:

- `W` / `S`: throttle / brake, `A` / `D`: steer
- Raider: `E` / `Shift` shift up, `Q` / `Ctrl` shift down, `Space` clutch
- Click: `Space` is the rear (CBS) brake lever
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
js/physics.js         engine, clutch-slip solver, steering/lean, suspension, collision
js/model.js           3D models (sport underbone, scooter)
js/hud.js             gauge clusters (sport / scooter LCD), messages, minimap
js/world.js           the island, roads, town, collision grid, parking lot
js/renderer.js        WebGPU/WebGL setup and fallback
js/audio.js, controls.js, garage.js, options.js, missions.js, config.js, state.js, util.js
```

Part options in the bike JSON are applied generically: `pow`, `ie` and `csp` multiply; any other key (`red`, `idle`, `mu`, `roller`, `lo`, `hi`, `eng`, `c`, `snd`) replaces the base value.

## Renderer

Uses three r0.186.1 `WebGPURenderer` with automatic WebGL 2 fallback (also on device loss or errors). Options (⚙) has Force WebGL, FPS and renderer readouts, Sound, and touch steering sensitivity.

WebGPU has not been verified on real hardware yet. Check the renderer readout on your device.

## Technical notes

- Three.js is loaded from jsDelivr via an importmap, so an internet connection is needed.
- Settings are stored in `localStorage` key `cpmme`: global options plus a `bikes` block per bike. Older single-bike saves are migrated into `bikes.raider150` automatically. The WebGL fallback flag is in `sessionStorage` key `cpmGL`.
- Collision uses oriented bounding boxes in a 20 m grid.
- Debug hook: `window.__cpm` (`S`, `cfg`, `ctx`, `spec()`, `step`, `shift`, `reset`, `setBike(id)`, `startEngine`, ...).

## Known limitations

- The soft-shadow mode was lost in the WebGPU renderer, so shadow edges are slightly harder (PCF).
- Suspension ride height (preload) is not adjustable yet.

## Ideas

- Compute-shader features: GPU grass, rain, more traffic
- Visual pass (materials, lighting, bike model detail)
- Multiplayer
