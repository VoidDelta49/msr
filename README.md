# ISLA

A 3D web game about riding and parking Philippine-market motorcycles on a Philippine-style island. Built with Three.js (WebGPU with WebGL 2 fallback), targeted at mobile browsers. No build step.

> **Unofficial fan project.** Not affiliated with, authorized by or endorsed by Honda, Suzuki or any other company named here. All product names, brands and trademarks belong to their owners and are used only to identify the real motorcycles the models represent. Free and non-commercial. See [LEGAL.md](LEGAL.md).

## Play

Open the GitHub Pages site for this repo on your phone. It plays fullscreen. (Opening `index.html` straight from disk won't work: ES modules and the bike data need to be served over http.)

## The island

About 1.7 × 1.5 km (2.2× the area before Build 8.5): a town with a parking lot and gas station, a coastal ring highway, beaches, a volcano, rice terraces and paddies, a river with bridges, a switchback mountain pass over a ridge in the northeast (guardrails, viaduct sections, ~13% max grade) and a 900 m airstrip on the north plain for top-speed and 0–100 runs, linked to the highway by taxiways.

**Isla Bantay (11.70):** a crescent island wrapping the north half of the main island across a channel, joined by three bridges (west, north with pylons, east) and a scenic coast highway. It holds Bundok Alon (mountain range), Laguna Bughaw (lake and loop road), Talampas Mesa (spiral road and a circuit on top), Kalbaryo Badlands (off-road rocks), Cabo Hangin (spiral to a lighthouse), jungle hills and beach villages. It is five overlapping `islands` pieces (`bantay1`..`bantay5`, each with its own bounding box, a coarse outline `step` and a palm density `pd`) so terrain sampling stays cheap; Ciudad Nueva was grown to the west and south (the Bato bridge lands on its east side) with more streets and towers.

**Beyond the main island (11.64):** *Ciudad Nueva*, a big city island to the south (street grid, glass towers, plaza, church, market) reached by the **ocean highway**, a 750 m arched cable-stayed bridge from the south-east coast (deck up to 23 m, pylons, long sea views; a ramp leaves it for **Isla Bato**, a rock-garden island of boulders and bumps). **Parola Peak** is a cone islet with a spiral road to a lighthouse, **Stunt Atoll** has kickers, a bowl and a loop track, and a pier links the old islet to the city. **Batuhan Rocks** and **Bukirin Whoops** are ridged, bumpy, boulder-strewn fields for off-roaders, and the **Underground River Cave** (west of the highway) is a sunken, roofed rock hall to ride through. All of it is data in `island.json`: `islands` (extra coasts), `hill` / `rough` features, road points `[x, z, minHeight]` with `bridge: true`, `pylons`, and the `tower` / `cave` buildings.

The layout is data: `data/map/island.json` holds the coastline (radius samples around the island centre), terrain features (volcano, terraces, ridges with per-point crest heights, levelled areas), the river, every road (points, width, highway/airstrip kind), speed bumps, town blocks, parked vehicles, hangars and prop counts. The game builds terrain, roads and props from it at load, so editing the file (or a future map editor) changes the island.

## Bikes

| | Suzuki Raider R150 Fi | Honda Click 125i | Suzuki Smash 115 / Fi | Honda CBR650R | Honda TMX Supremo | Yamaha Aerox 155 | Kawasaki Rouser NS125 Fi | Rusi Macho 125 | Kawasaki Ninja H2 | Yamaha NMAX 155 |Yamaha XMAX 300 | Kawasaki Barako II 175 | Rusi Surf 125 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Engine | 147 cc DOHC, ~18.5 PS @ 10,000 rpm, ~13.8 Nm @ 8,500 | 124.8 cc SOHC eSP, 8.2 kW (11.1 PS) @ 8,500 rpm, 10.8 Nm @ 5,000 | Carb: 109.7 cc SOHC 2-valve, 5.6 kW @ 7,000 rpm, 9.0 Nm @ 4,000. Fi: 113 cc, 6.4 kW @ 8,000, 9.0 Nm @ 4,000 | 649 cc DOHC inline-four, 95 PS @ 12,000 rpm, 63 Nm @ 9,500 | 149.2 cc SOHC 2-valve carb, 11.1 hp @ 7,500 rpm, 11.6 Nm @ 5,000 | 155.09 cc liquid-cooled SOHC 4-valve with VVA, 15.4 PS @ 8,000 rpm, 13.9 Nm @ 6,500 | 124 cc air-cooled single, fuel injection, 12 PS @ 8,500 rpm, ~10.8 Nm @ 6,500 | 125 cc air-cooled SOHC 2-valve carb, 9.66 hp @ 9,000 rpm, 8.3 Nm @ 7,500 | 998 cc DOHC inline-four with a gear-driven centrifugal supercharger (9.2× crank), 231 PS @ 11,500 rpm (243 PS with ram air), 141.7 Nm @ 11,000 | 155.09 cc liquid-cooled SOHC 4-valve with VVA, 11.3 kW (15.4 PS) @ 8,000 rpm, 14.2 Nm @ 6,500 |292 cc liquid-cooled SOHC 4-valve Blue Core, 20.6 kW (28 PS) @ 7,250 rpm, 29 Nm @ 5,750 | 176.6 cc air-cooled SOHC 2-valve carb single (65.5 x 52.4 mm, 9.3:1, Mikuni VM24), 13.41 hp @ 7,500 rpm, 13.7 Nm @ 5,500 | 125 cc air-cooled SOHC 2-valve carb single, 9.5 hp @ 7,500 rpm, 9.6 Nm @ 6,500 |
| Transmission | 6-speed return shift (1-N-2-3-4-5-6), wet clutch, chain | V-Matic CVT, dry centrifugal clutch, belt | 4-speed rotary (N-1-2-3-4, 4 → N only when stopped), automatic centrifugal clutch, no clutch lever, 14/36 chain | 6-speed (primary 1.690, gears 3.071–1.214), assist/slipper clutch, 15/42 chain | 5-speed return shift (1-N-2-3-4-5), wet clutch, 15/42 chain | V-belt CVT (2.300–0.724 × 10.208 final), dry centrifugal clutch | 5-speed return shift (1-N-2-3-4-5, primary 3.35, gears 2.920–0.960), wet clutch, 14/43 chain | 5-speed return shift (1-N-2-3-4-5, primary 4.056, gears 2.769–0.960), 15/42 chain | 6-speed dog-ring return shift (1-N-2-3-4-5-6, primary 1.551, gears 3.188–1.348), assist/slipper clutch, 18/44 chain | V-belt CVT (2.300–0.724 assumed, × 10.208 final from the owner's manual), dry centrifugal clutch; Tech MAX: YECVT (motor-driven pulley) |V-belt CVT (2.40–0.76 × 7.4 final, estimated), dry centrifugal clutch | 4-speed return shift (1-N-2-3-4), wet multi-plate clutch, chain (ratios estimated) | 4-speed semi-automatic, centrifugal clutch, chain (ratios estimated) |
| Extras | Anti-stall clutch assist | Idling Stop, CBS brakes, start needs the brake held | Carb or fuel injection in one bike (Parts > Fuel system), three trims: spokes + drums, spokes + front disc, mags + front disc | Honda E-Clutch (clutchless starts and shifts, can't stall), slipper clutch, 5" TFT with shift light | Tricycle sidecar (Parts > Sidecar): no lean, pulls toward the sidecar on the gas and away on the brakes, the sidecar lifts in fast turns toward it and can roll over | Stop & Start System (engine off after a stop at idle, restarts on throttle; toggle in the garage), start needs the brake held | Anti-stall clutch assist | Tricycle sidecar (Parts > Sidecar, same handling as the TMX), anti-stall clutch assist, drum brakes | Up/down quickshifter (clutchless shifts once rolling), traction control, ram air (power rises with speed), power modes, supercharger whine and closed-throttle chirp, analog tach + LCD with boost bar, solo seat | Two variants (Standard / Tech MAX). Tech MAX YECVT: T and S modes, 3-level Y-Shift downshift (▼ / `Q`; ▲ / `E`, braking or letting the throttle go cancels), colour TFT. Dual-channel ABS, traction control, Stop & Start |ABS, traction control, smart key, colour TFT (shares the NMAX's meter layout). No YECVT or Stop & Start | Tricycle sidecar (Parts > Sidecar), four rear shocks, 150 mm drum brakes, anti-stall clutch assist | Tricycle sidecar (Parts > Sidecar), no clutch lever, front disc + rear drum, cast wheels |
| Garage | Exhaust, ECU, tires, paint, sprockets, carbon fiber parts, preload, ride height, springs, damping | Rollers (bola), center spring, clutch springs, pulley set, exhaust, ECU, tires, paint, carbon fiber parts, preload, ride height, springs, damping | Fuel system, wheels & brakes, engine tune, exhaust, tires, paint, sprockets, carbon fiber parts, preload, ride height, springs, damping | Exhaust, ECU, tires, 3 factory paints, sprockets, carbon fiber parts, preload, ride height, springs, damping, E-Clutch on/off | Sidecar, exhaust, engine tune, tires, paint, sprockets, preload, ride height, springs, damping | Rollers, center spring, clutch springs, pulley set, exhaust, ECU, tires, paint, cover colour, intake, flywheel, brakes, carbon fiber parts, preload, ride height, springs, damping | Exhaust, ECU, tires, paint, cover colour, intake, flywheel, brakes, sprockets, carbon fiber parts, preload, ride height, springs, damping | Sidecar, exhaust, engine tune (incl. bore-up), tires, paint, cover colour, intake, flywheel, brakes, sprockets, carbon fiber parts, preload, ride height, springs, damping | Track kit (H2R-style: 310 PS, −22 kg, wings, open megaphone), power mode, exhaust, tires (incl. slicks), 3 paints, frame colour, flywheel, brakes, sprockets, carbon fiber parts, preload, ride height, springs, damping, quickshifter / traction control on/off | Variant, YECVT S mode, exhaust, ECU, tires, 5 paints, rollers / springs / pulley (Standard only), intake, flywheel, brakes, carbon fiber parts, preload, ride height, springs, damping, TCS / Stop & Start on/off |Rollers, center spring, clutch springs, pulley set, exhaust, ECU, tires, 4 paints, cover colour, intake, flywheel, brakes, carbon fiber parts, preload, ride height, springs, damping, TCS on/off | Sidecar, exhaust, engine tune, carb, tires, 4 paints, engine internals, sprockets, preload, ride height, springs, damping | Sidecar, exhaust, engine tune, carb, tires, 4 paints, engine internals, brake lines, carbon fiber parts, sprockets, preload, ride height, springs, damping |

Since 11.72 every bike also has drivetrain and service parts that match its real hardware: lithium battery (all), clutch (heavy-duty springs on geared bikes, a slipper clutch kit for the Raider; racing clutch shoes on scooters), chain (X-ring; 520 race conversion on the CBR650R and H2) or racing drive belt (scooters), iridium spark plug (not the CBR650R / H2, which ship with one; not the NMAX, which is at the 24-part relay limit), racing camshaft (small singles), and steel-braided brake lines on bikes with hydraulic discs (not the drum-braked TMX, Macho and Smash). Part option keys `capx` (clutch capacity) and `etax` (chain/belt efficiency) multiply the drivetrain values; `slipper` fits a slipper clutch.

Since 11.73 the ENGINE tab is split into a sub-menu (Intake & fuel, Head, Bottom end, Ignition, Exhaust, ECU & tuning) with engine internals that fit each engine: throttle body + injector or Keihin PE24/PE28 carb, valve springs, head work, piston, bore-up kit, oil, ignition coil and racing CDI. New part keys: `tqs` (adds; tilts the torque curve toward the top end), `redd` (adds rpm to the limiter, capped at the end of the torque table), `frx` (engine friction) and `fux` (fuel use) multiply. A part with `"int": 1` is an engine internal: `net.js` never sends it, so it does not count toward the relay's 24 part keys. The DYNO tab (`js/dyno.js`) runs a full-throttle pull on an inertia drum from the real spec (gear pick, CVT shifting itself, 5 runs + stock ghost, rear-wheel PS / Nm, loss); `node tools/sim.mjs <bike> dyno` gives the same numbers headless.

The DYNO tab also has **fine tuning** (`js/tune.js`), all optional and exactly stock when left alone: what a tuner adjusts with the bike on the drum, not parts. Fuel-injected bikes: fuel trim at low / mid / high rpm, ignition timing below and above the torque peak, rev limit. Carburetted bikes: main jet (the carb's real jet series), needle clip, pilot / air screw, ignition timing. All: cam timing (slotted sprocket) and idle speed. Each bike's `engine.tune` says how much more fuel its stock setting wants for best power per rev band, how much timing is left and how far the knock limit is; breathing parts raise the fuel need, compression and a lean mixture pull the knock limit down. The tab shows the wideband AFR (13.0 = best power) and knock; the tune reshapes the torque curve, fuel use, idle, limiter and the engine sound.

CBR650R figures are Honda's published specs (208 kg, 1,450 mm wheelbase, 25.5° rake, 15.4 L, 120/70-17 + 180/55-17, 310 mm twin discs). Honda doesn't publish the torque curve or rev limit: the curve is shaped to the published peaks, the limiter is set at 12,750 rpm. In-game (flat road, 68 kg rider, E-Clutch launch): 0–100 km/h ≈ 4.1 s, 400 m ≈ 12.2 s @ 191 km/h, top ≈ 226 km/h, 1st gear tops out at 104 km/h.

Ninja H2 figures are Kawasaki's published specs (238 kg curb, 1,455 mm wheelbase, 24.5° rake, 17 L, 120/70ZR17 + 200/55ZR17, 330 mm twin discs, gear ratios, primary 76/49, final 44/18). The torque curve is shaped to the published peaks; the limiter is set at 14,000 rpm. The track kit uses the H2R's published 310 PS @ 14,000 / 165 Nm @ 12,500 and 216 kg. In-game (flat road, 68 kg rider): 0–100 km/h ≈ 3.4 s, 400 m ≈ 10.4 s, top ≈ 323 km/h, 1st gear tops out at 142 km/h.

NMAX 155 figures are Yamaha's published specs for the 2025 model (Yamaha Indonesia / PH dealer sheets: 11.3 kW, 14.2 Nm, 1,340 mm wheelbase, 765 mm seat, 129 kg Standard / 131 kg Tech MAX, 7.1 L, 110/70-13 + 130/70-13, 230 mm discs) and the owner's manual's secondary reduction 10.208 (56/16 × 35/12). The CVT ratio range is not published; it uses the Aerox 155's 2.300–0.724 (same Blue Core 155 VVA unit). YECVT behaviour follows Yamaha's descriptions: S mode ≈ +1,000 rpm, each Y-Shift level ≈ +1,000 rpm, it drops out when the rider brakes or lets the throttle go. In-game (flat road): 0–60 km/h ≈ 5.9 s in T, 5.8 s in S, top ≈ 112 km/h.

XMAX 300 figures are Yamaha's published specs (292 cc, 20.6 kW @ 7,250, 29 Nm @ 5,750, 183 kg, 1,540 mm wheelbase, 795 mm seat, 13.2 L, 120/70-15 + 140/70-14, 267 / 245 mm discs) for the 2023 model sold in the Philippines (4.2" TFT, smart key, TCS). Yamaha doesn't publish the CVT ratios, final drive or roller weight, so those are estimates (2.40–0.76 × 7.4, 17 g) chosen so the CVT holds about 6,750–7,300 rpm at full throttle (peak power) and tops out near the ~140 km/h owners report. The torque curve is shaped to the published peaks; limiter 8,750 rpm. In-game (flat road): 0–60 km/h ≈ 4.1 s, 0–100 ≈ 9.7 s, top ≈ 137 km/h.

Sniper 155R figures are Yamaha's published specs as listed by Philippine dealers (155 cc, 58.0 × 58.7 mm, 10.5:1, 13.2 kW (17.9 PS) @ 9,500 rpm, 14.4 Nm @ 8,000 rpm, 6-speed with assist & slipper clutch, 1,290 mm wheelbase, 795 mm seat, 150 mm ground clearance, 123 kg curb, 5.4 L, 90/80-17 + 120/70-17, front 2-pot disc + rear disc, ABS, smart key). Yamaha doesn't publish the gear ratios or final drive: they are estimates (primary 3.042, 2.833 / 1.875 / 1.364 / 1.095 / 0.920 / 0.800, 14/43) and the torque curve is shaped to the published peaks. It has its own model (`sniper` in `js/model.js`, modelled after reference photos of the PH blue unit). In-game (flat road): 0-60 km/h ≈ 5.5 s, top ≈ 135 km/h.

Winner X figures are Honda Philippines' published specs as listed by PH dealers (149 cc DOHC 4-valve liquid-cooled PGM-FI single, 57.3 × 57.8 mm, 11.3:1, 11.5 kW (15.6 PS) @ 9,000 rpm, 13.5 Nm @ 7,000 rpm, 6-speed with assist & slipper clutch, 2,019 × 725 × 1,104 mm, 1,278 mm wheelbase, 795 mm seat, 151 mm ground clearance, 122 kg curb, 4.5 L, 90/80-17 + 120/70-17, discs both ends, front ABS on the ABS Premium / ABS Racing, smart key). Honda PH doesn't list the gear ratios: the internal ratios are the ones of Honda's 150 cc DOHC six-speed family (primary 3.260, 3.083 / 1.941 / 1.500 / 1.227 / 1.041 / 0.923), the final drive is the 15/44 the sprocket catalogues list for this platform, the torque curve is shaped to the published peaks, and wheel travel (100 / 90 mm) and the 10,500 rpm limiter are estimates. It has its own model (`winner` in `js/model.js`, after Honda PH dealer studio shots of all four colours, Top Gear PH launch photos and the owner's photos) and its own dash (`winner` in `js/hud.js`, a negative LCD: laid out from descriptions of the full digital meter, not traced from a photo). Paints are the PH colours: Matte Galaxy Black and Matte Meteoric Red (ABS Premium, gold fork legs), the ABS Racing tricolour with gold wheels, Infinity Red and Pearl Iceberg White (Standard). In-game (flat road): 0-60 km/h ≈ 5.8 s, top ≈ 127 km/h.

Click 125i figures are Honda's published specs. Honda doesn't publish the CVT ratio range or final drive, so those are estimates (2.40–0.80 × 10.0) chosen to match the claimed ~100 km/h top speed.

Smash figures are Suzuki Philippines' published specs (99 kg curb, 1,240 mm wheelbase, 750 mm seat, 70/90-17 + 80/90-17). Suzuki doesn't publish the gear ratios, tank size or torque curve: the ratios (primary 3.421, 2.833 / 1.705 / 1.238 / 0.958, 14/36) are typical of Suzuki's 110 cc rotary engines, the tank is 4.0 L, and the curves are shaped to the published peaks.

Barako 175 figures are Kawasaki's Barako II spec sheet (176.6 cc, 65.5 x 52.4 mm, 9.3:1, 13.41 hp @ 7,500, 1.4 kgf·m @ 5,500, 1,250 mm wheelbase, 132 kg electric-start: 58 front / 74 rear, 12 L, 3.00-17, 150 mm drums); its gear ratios and sprockets are estimates. Rusi publishes little for the Surf 125: power, torque, tyres, brakes and top speed are the listed figures, while bore x stroke (52.4 x 57.9 mm, the common horizontal 125), weight (98 kg), wheelbase (1,230 mm), tank (4 L) and ratios are estimates.

TMX Supremo, Aerox 155, Rouser NS125 and Macho 125 use the figures quoted in each bike's in-game description (power, torque peaks, wheelbase, weights, tank, tyre sizes). Not every maker publishes gear ratios, torque curves or rev limits, so those are estimates shaped around the stated peaks; use `node tools/bike.mjs <id>` to see what the game makes of them.

### How the CVT works in-game

- **Centrifugal clutch:** shoe torque grows with rpm² above the clutch-spring preload. It starts to bite around 3,200 rpm and is locked by about 4,800 (stock springs).
- **Variator:** the rollers push the drive pulley closed with about m·ω². The center spring and torque cam push back, harder as the belt climbs and harder under load. The ratio moves until those balance, so at full throttle the engine holds roughly 6,700–7,200 rpm while speed rises. Lighter rollers raise that rpm, and a stiffer center spring raises it further.
- **Idling Stop:** the engine shuts off after 3 s stopped at idle and restarts when you open the throttle.

## Quests (Build 9.5)

The hub layout is seeded by the date (Philippine day, UTC+8): everyone gets the same hubs, types and bike locks on the same day, and it all reshuffles at midnight (reload to pick it up).

Quest hubs are coloured beacons in the world and pins on the minimap (pins in view, plus the three nearest at its rim). The parking hub stays in the lot (the only place with bays); 14 job hubs (parcel, food, gates, orbs, radar, stunt, rogue, bomb, meteor or hare, rolled at random each load) sit on random roads all over the island, at least 140 m apart, three of them in town. Ride into one and hold still for a moment to take the job; the pin then becomes the drop-off. ✕ in the panel cancels, and after a job you have to leave the hub before it can trigger again. A finished or failed delivery hub moves somewhere else with a new type; a cancelled one stays.

About a third of delivery hubs are **bike-locked** (red outline on the map and a second red ring): taking one switches you to that bike where you stand (full tank, same position and heading), and the time limit is 15% tighter. Changing bikes during the job cancels it.

- **Parking challenge** (blue P): park in the green bay. Stars for time and hits. *Next* gives another bay.
- **Parcel delivery** (tan B): the parcel rides on the pillion seat. A crash, a hard wall hit (> 7 m/s, also with Tough Biker on) or a swim and it falls off: game over. Stars for time and hits.
- **Gate rush** (gold G): 8 gates in a chain (next one previewed), start 28 s, each gate adds time by its distance (min 4 s). Time out ends the run: stars by gates cleared (8 / 7+ / 4+); not game over.
- **Orb rush** (cyan O): 10 orbs within 170 m of the hub, 45 s, +1 s per orb. Stars by orbs (all / 8+ / 5+).
- **Speed trap** (orange S): a halo 250-650 m away; your speed as you enter it is clocked and the record is kept per bike (localStorage). Stars vs the record.
- **Stunt run** (purple T): 45 s; distance ridden in a wheelie, stoppie or jump scores, multiplied by the combo (up to x3 after 6 s). A crash ends the run with your points. Stars at 150 / 400 pts.
- **Roguelite run** (lime R): endless floors, each a random trial (dash to a halo / collect orbs / ride 25+ m of tricks) that gets tighter every floor. Failing or crashing costs a heart (3 hearts); then three doors appear ahead: blue +5 s on every later floor, red +1 heart, gold magnet (bigger pickup radius), white shield (absorbs one failed floor). Stars by floors cleared (8 / 4).
- **Speed bomb** (red X): arms the first time you pass 50 km/h; under 50 km/h the 6 s fuse burns (regains half speed while fast), a crash or 0 fuse is game over. Ride into the halo 400-900 m away to defuse it; stars on time.
- **Meteor storm** (white M): for 40 s warning halos (8 m) land ahead of you and strike after 1.4 s, faster as time goes on. A direct hit costs a heart and 65% of your speed, 3 hearts end the run; near misses get a callout. Stars by hearts left.
- **Catch the hare** (indigo H): the hare runs between road points (13 m/s, +2 per catch, max 26); stay within its 12 m halo for 2 s to catch it (the meter drains slowly when you fall out). 50 s, +5 s per catch, stars at 5 / 3 catches.
- **Food delivery** (pink F): quality starts at 100% and drops with bumps, hard braking, hard acceleration, fast lean changes, strong cornering and walls; heat drops steadily to 0 at the time limit (about 7.5 m/s average over the straight-line distance, plus 30 s). A crash, a swim or heat 0 is game over; quality 0 is not, you still deliver (for one star).

Counts, spacing and the bike-lock share are the constants at the top of `js/missions.js` (`NHUB`, `SEP`, `BIKE_P`, `HARD`), as is the spoilage table `K`.

## Pedestrians (11.81)

People walk the sidewalks of every road on the island and do everyday things: **sando boys** hanging out (squatting, chatting, stretching), **people walking their dogs** (the dog trots at heel on a leash, sniffs and sits, and the owner waits), **students in school uniforms** (white tops, navy slacks or skirts, ties, backpacks), and assorted others (titas with shoulder bags, lolos, office workers on their phones, joggers, tambays). They come out of and go into buildings' front doors, cross the street, turn at junctions, keep out of walls, the sea and each other, jump out of the way of a fast bike, sit down dazed if you clip one, and wave when you walk past on foot.

**Giving a ride:** some of them wave you down (a yellow marker floats above them). Stop next to one on a bike with a free seat (any bike's pillion seat, or the tricycle's sidecar) and they hop on behind you. A random building's front door somewhere on the island, a house, a sari-sari store, the church, a shop, becomes the drop-off (orange beacon + map waypoint). Stop there and they get off and walk inside; the fare and your ride count are kept on the phone. The passenger is 65 kg on the bike's physics like a friend would be. Crash and they get off, get off your bike and they leave. Not during a quest or a race.

**Data-driven:** who they are is `data/npc.json`: archetypes (outfit colours per body part from palettes, optional parts such as caps, backpacks, skirts, ties and bags with their chances, walking speed, height, what they stop to do, how many are out at night, the chance they want a ride, names), the dog, the pool sizes, ranges and ride settings, and the lines they say. A new kind of person is a new entry there, no code. Options > Game > Pedestrians: Off / Few / Normal / Busy.

**Bodies:** `js/figure.js` is the character system for everyone: the rider on foot, a friend's walker, the pedestrians, their dogs and a passenger on your bike share one body recipe (the rider's chunky boxes, torso profile, round head) with bones, 16 colour roles and optional parts, and one pose library (walk, run, phone, hail, chat, squat, sit, sweep...). The whole crowd is one draw call: poses and outfits are per-instance data and the shader bends the limbs, so 30 people cost the same draws as one. Mobile budget, built in: a fixed pool that lives in a ring around you (spawning out of view), off-screen people are not drawn, far people think less often, walls come from a grid, no shadow-map casting (contact blobs instead), fewer people on the Low preset and at night. Logic in `js/npc.js` is headless (`node tools/npc.mjs`).

## Buildings, shops and drinks (11.83)

**Going in:** some buildings have an inside. Walk up to the front door of the **Tambayan Billiards & Bar** (across the road from the parking lot, pink BILLIARDS neon over the door) and the on-foot button says **ENTER**. Inside: two pool tables under green lamps, a bar counter with stools and a bottle shelf, a jukebox, a tv with the PBA game, round tables, ceiling fans, and regulars (a bartender wiping the counter, people on stools and at the tables with a drink, someone lining up a shot). **EXIT** at the door takes you back out onto the step.

**Shops and consumables:** **ORDER** at the counter opens the menu: ginbilog, beer, a litro of strong beer, softdrinks, water, sisig, chicharon. Sari-sari stores sell at the front door (**BUY**), no going in. You start with ₱300; fares from giving pedestrians a ride go into the same wallet. Whatever you buy goes in your hands: the button says **DRINK** / **EAT** (with its icon) and you drink it right there.

**Drunk:** one ginbilog is plenty. Walking, the stick turns under you, you sway sideways, can't sprint and stagger; the screen wobbles, swims and splits into a drifting double image; the horizon tilts. On a bike you can't ride, at all: steering is mostly the gin's (and for seconds at a time your bars go the wrong way), the throttle surges and dies on its own, the brake gets grabbed. Counter-steering doesn't help. It wears off in about three minutes; kape, water and sisig take some of it away.

**Billiards:** walk up to a table: **SHOOT** strikes the cue ball away from where you stand (the first shot is the break), balls click, bank and drop; a scratch comes back on the spot, **RACK** when the table's clear. Drunk, your aim wanders.

**Friends (multiplayer):** tap a friend's name tag while either of you is on foot: 👋 **WAVE**, 🍶 **TREAT** (buy them a drink: you pay, it lands in their hands), 🥂 **CHEERS** (you drink what you carry, they get a CHEERS button to clink back and drink theirs), 📍 **CALL** (your spot, or the door of the building you're in, becomes their waypoint, from anywhere). MULTIPLAYER in the menu lists everyone with where they are (riding, on foot, which building) and FIND / CALL. Friends in the same building see each other inside; a drunk friend sways. (Needs the relay redeployed: `server/README.md`.)

**As data:** `data/interiors.json` (rooms: which building types they belong to, size, colours, props, counters, people and their poses) and `data/shop.json` (items with prices and effects, shops, what sari-sari stores sell at the door, what you can treat a friend to). A new interior, item or shop is a data entry; effects live in `js/effects.js`.

## Weather (12.00)

The sky is the real weather over the Philippines right now (Options > Game > Weather: Live PH, or a fixed Clear / Light rain / Storm). Cloud cover, rain, wind, visibility and thunderstorms come from [Open-Meteo](https://open-meteo.com/) for one fixed point, through the multiplayer relay, so everyone in a room rides under the same sky (and sees the same lightning); solo riders get the same snapshot. Never your location. Rain wets the road: about 30 % less grip on asphalt with a road tyre, more on mud, painted centre lines and bridge decks, and hydroplaning at speed on a soaked road. Tyres differ in the wet (the skinny one cuts through water, wide and racing ones give up sooner). The road dries in 10-40 minutes after the rain. The dyno always runs dry.

The radio (the button at the top, N / B, or Options > Audio) has four generated stations and then **live Philippine public radio**: Radyo Pilipinas and the other state stations, plus state university radio, streamed straight from each station's own public webcast while you are online. Public service broadcasters only; nothing is recorded, re-hosted or sent through this project's servers, and no stream address is kept in the repo (they come from the [Radio Browser](https://www.radio-browser.info/) directory at play time). Details and the rules in `THIRD_PARTY.md`.

## Multiplayer (Build 9.0)

Main menu > MULTIPLAYER: type a name, then JOIN a room code or make a NEW ROOM and share its code (up to 8 riders per room). Everyone rides their own bike with their own physics; other riders appear as ghost bikes (no collisions) with their real bike and paint, a name tag and a cyan dot on the minimap.

**Racing:** tap a rider's name tag (within 90 m, it shows 🏁) to challenge them. When they accept, a finish beacon appears on a road about the same distance from both of you (350-900 m). Hold still for the 3-2-1 (moving early = +3 s), then get there first. ✕ gives up. Quests can't start during a race.

The relay is a small Cloudflare Worker in `server/` (deploy steps in `server/README.md`).


**Passengers (11.23 tricycles, 11.45 any bike):** stop next to a friend's bike and tap their name tag (it shows 🛺 for a tricycle with the sidecar fitted, 🏍️+1 for any other bike with a free pillion seat): RIDE asks, the driver gets OK / ✕. A tricycle takes two on the sidecar bench (little seated figures, each adds 65 kg to the sidecar in the driver's physics). Every other bike takes one pillion passenger: the rider model again, shifted back onto the seat in other clothes (it shares the rider's mesh, one extra draw call). The 65 kg sit behind the driver, so the centre of mass moves back and up (`withPassenger` in `js/spec.js`): slower pull-away, the front gets light so wheelies come earlier, braking about the same. Your own bike is put away while you ride (first person looks over the driver's shoulder) and comes back beside the driver's bike when you tap GET OFF. If the bike crashes, everybody aboard is flung out cartoon-style (on every phone that sees it) and lands next to their bike. A bike's seat is `chassis.pil` in its JSON; `node tools/pillion.mjs` checks every bike's seat against the real model. Needs the 11.23 relay (`server/worker.js`, `ride` messages) and nothing newer: redeploy it with `npx wrangler deploy` if you have not.
## Controls

Touch:

- Handlebar: bottom-left (drag around it to steer)
- Throttle pad (drag down to open, release to close) plus a brake button (CBS on the Click)
- Smash: ▲ / ▼ shift buttons only (automatic clutch, shift any time)
- Raider / CBR650R / TMX / Rouser / Macho / Ninja H2: clutch pad (drag down to pull), ▲ / ▼ shift buttons (clutch must be pulled to shift, except on the CBR with E-Clutch on and on the H2 with the quickshifter on, once rolling in gear)
- KEY (ignition) and KILL (engine stop switch) buttons, START (hold to crank). Start sequence: key on, wait ~2 s for the fuel pump, neutral or clutch in (Click / Aerox: hold the brake), hold START with the throttle closed. Cold engines crank longer and idle high until warm. A crash trips the tip-over sensor: turn the key off and on again.
- ◀ BACK (hold): walk the bike backwards with your feet (~3 km/h, bikes have no reverse). Only when stopped with the throttle shut; on the manual bikes, in neutral or with the clutch pulled.
- Top bar: CAM, GARAGE, RESET, ⚙ (options)

Keyboard:

- `W` / `S`: throttle / brake, `A` / `D`: steer
- Raider / CBR650R / TMX / Rouser / Macho / Ninja H2: `E` / `Shift` shift up, `Q` / `Ctrl` shift down, `Space` clutch
- Click / Aerox / NMAX: `Space` is the rear brake lever (CBS on the Click). NMAX Tech MAX: `Q` / `Ctrl` Y-Shift down a level, `E` / `Shift` back up
- Smash: `E` / `Q` shift (no clutch), `Space` is the rear brake. Carb version: no pump to prime, but a cold start cranks longer
- `X` (hold): walk the bike backwards
- On foot: `WASD` walk, `Shift` run, `Space` jump, `F` / `E` = the context button (GET ON, ENTER, EXIT, ORDER, BUY, SHOOT, DRINK)
- `K`: ignition key, `T`: kill switch, `R` (hold): starter, `C`: camera, `G`: garage (bike picker is at the top), `O`: options (`Esc` closes), `Esc`: pause menu (also ☰ in the top bar)

## Project layout

Everything bike-specific is data. Adding a bike means adding a JSON file, plus a model/cluster builder if it needs a new look. Give it the real engine geometry in `engine.geo` (bore, stroke, compression ratio, peak-power rpm): the exhaust header (A. G. Bell's tuned length and diameter), muffler (Helmholtz) and intake (tuned runner) the engine voice runs through are computed from it in `acoustics()` (`js/spec.js`). Give it its own `sound.parts` profile too (brake squeal, chain, suspension thump, key click, body rattle, ...; every key is a level or pitch multiplier, see `pv()` in `js/audio.js`), otherwise it sounds like a neutral default bike.

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
js/tyre.js            tyre slip->force curve and surface grip (asphalt / dirt shoulder / grass / paddy), wet-road grip
js/weather.js         live weather, headless: snapshot -> sky, rain, wind, lightning, road wetness (wxnet.js fetches, wxfig.js draws the rain, menusky.js the menu's sky)
js/rapier.js          Rapier3D chassis: dynamic bike body, suspension probes, streamed static colliders (fixed 120 Hz tick)
js/model.js           3D models (Raider R150 underbone, Click 125i scooter, Smash 115 step-through, CBR650R supersport, TMX Supremo + tricycle sidecar, Aerox 155 maxi-sport scooter, Sniper 155R sport underbone, Winner X sport underbone, NMAX 155 maxi-scooter (Standard / Tech MAX), XMAX 300 big maxi-scooter, Rouser NS125 street bike, Macho 125 on the TMX builder, Barako II 175 on the TMX builder (m = 2), Surf 125 on the Smash builder, Ninja H2 hyperbike), low-poly extruded panels
js/tex.js             N64-style procedural textures (tiny, dithered, bilinear) + sky
js/layout.js          fits the HUD + touch controls to any phone screen (safe area, orientation, handedness, size): applies the rectangles from layoutcalc.js
js/layoutcalc.js      pure layout solver behind it (no DOM; tools/layout.mjs sweeps it)
js/hud.js             gauge clusters, one per real dash (Raider LCD, Click / Aerox / Sniper / Winner X LCDs, Rouser tach + LCD, Smash and TMX dials, CBR TFT, H2, NMAX / XMAX two-screen), messages, minimap
js/world.js           builds the island from data/map/island.json: terrain, roads, town, props, collision footprints, parking lot
data/map/island.json  the island layout (coast, features, river, roads, town blocks, vehicles, hangars, prop counts)
js/renderer.js        WebGPU/WebGL setup and fallback, quality preset
js/perf.js            culling, terrain LOD, merging, Lambert materials, auto resolution
js/gpucull.js         WebGPU compute culling + indirect draws for instanced props
js/bundle.js          WebGPU render bundles: the static town recorded once, replayed per frame
js/bench.js           in-game benchmark (Options > System): scripted ride, frame/CPU/GPU timings, hitch causes, ablations, text report
js/net.js             multiplayer: relay connection, state packets, interpolated ghost bikes, name tags
js/race.js            tap-to-race between two riders
js/ride.js            passengers: hop into a friend's sidecar or on the back of any bike, cartoon ejections on a crash
js/figure.js          character system: body/dog geometry with bones + colour roles, GPU-posed one-draw crowds, pose library (figlook.js: outfits as data)
js/npc.js             pedestrians' brains (headless): spawning ring, sidewalks, doors, activities, dodging, the ride; npcfig.js draws them
js/particles.js      particles: tyre smoke, dust, splashes; one GPU-animated ring-buffer pool, one draw, hidden when empty
data/npc.json         pedestrian archetypes, outfits, activities, ride settings, lines
js/interior.js        building interiors (headless): pocket rooms above their building, walls, EXIT / ORDER / SHOOT spots, camera fit; interiorfig.js draws them
js/places.js          going in and out, shops, drinking, pool shots: the glue; act.js = the on-foot context button (ENTER, ORDER, DRINK, GET ON...)
js/shop.js            money, the bag, buying (headless); shopui.js = the shop panel
js/effects.js         what you consume does to you: drunk (walking, riding, the screen), sober, energy (headless)
js/pool.js            billiards physics (headless, nine-ball rack)
js/social.js          friends: wave, treat a drink, cheers, call over; friend list in MULTIPLAYER
data/interiors.json   interiors: rooms, props, counters, people
data/shop.json        items (price, effects), shops, walk-up stores, friend treats
server/               Cloudflare Worker + Durable Object relay (one room per code) + the live weather snapshot (wx.js, GET /wx)
js/audio.js (+ engine-worklet.js), controls.js, garage.js, options.js, missions.js, config.js, state.js, util.js
```

Part options in the bike JSON are applied generically: `pow`, `ie` and `csp` multiply; any other key (`red`, `idle`, `mu`, `roller`, `lo`, `hi`, `eng`, `c`, `snd`) replaces the base value.

## Renderer

Uses three r0.187.0 `WebGPURenderer` with automatic WebGL 2 fallback (also on device loss or errors). Options (⚙, or O on a keyboard) has five tabs: Graphics (presets, quality, anti-aliasing, resolution, frame cap, look filters, WebGPU/WebGL), Controls (touch steering, control size, left-handed layout, analog brake, field of view), Audio, Game (time of day, Tough Biker, wheelie control, HUD readouts) and System (renderer and build, error log, reset). Settings that rebuild the renderer are flagged "reloads" and applied together with the Apply & reload bar.

Sound is fully synthesized WebAudio, no samples: an AudioWorklet engine voice builds every combustion pulse (muffler thump, pipe tone, valvetrain tick, intake, afterfire crackle on closed throttle and at the limiter; aftermarket exhausts get louder, brighter and poppier), speed-driven wind with gusts (louder in first person), tyre roar on asphalt vs crunch off-road, squeal past the grip limit, scraping, and island ambience by location: surf toward the sea, the river, cicadas and birds in the countryside, frogs at the rice paddies, town hum with dogs and jeepney horns, a volcano rumble. Ambience ducks as you speed up.

### Performance (Build 5.3)
- **Quality** (Options → GRAPHICS, reloads): Low / Medium (default) / High. Sets draw distance (fog end: 550 / 1100 / 1400 m), pixel-ratio cap (1 / 1.5 / 2), shadows (off / 1024 / 2048), texture anisotropy, and on Low swaps the island's PBR materials for cheaper Lambert ones.
- **Anti-aliasing** (FXAA by default, reloads): Off / FXAA / MSAA 2× / MSAA 4× / MSAA 4× + FXAA. FXAA is one cheap post pass. MSAA is the multisampled render target of the scene pass (so the sample count is real and it combines with the grade and N64 filter); WebGPU only has 4 samples, and a GPU without multisampling falls back to FXAA (Options says which one is running). MSAA smooths shape edges, FXAA also the alpha-cut ones (wheel faces, signs).
- **N64 colour filter** (on by default, reloads): 15-bit colour with a 4x4 ordered dither and a touch of saturation, in the same post pass.
- **Retro res** (Off / 480p / 360p / 240p): caps the render height and upscales with crisp pixels. Also a big speed-up on slow phones.
- **Auto resolution** (on by default): drops render resolution in 10% steps (down to 55%) when the game can't hold the screen's refresh rate, and creeps back up when it can.
- **Culling**: props are static instanced chunks (700 m); off-screen chunks are skipped in the main and shadow pass. Small one-off props hide past 220 / 550 m.
- **GPU culling** (WebGPU only, on by default, reloads): each prop type is one instanced mesh for the whole island; a compute pass culls every instance against the view and its draw distance each frame and draws the survivors with an indirect draw. Props near the bike are kept for the shadow pass. On WebGL the chunked culling above is used.
- **Render bundles** (WebGPU only, on by default, reloads; Options > Graphics > Advanced): the frozen, opaque island objects (buildings, chunked props, signs, wires, the GPU-culled prop meshes) are moved into `BundleGroup`s by area (250 m cells, 1000 m for big objects). Each cell's draw commands are recorded once and replayed with one `executeBundles`, which saves most of three.js's per-object CPU work. Whole cells are frustum-culled per camera. A cell is recorded again when something in it changes (visibility from distance culling or night-only objects, instance counts, materials, textures, matrices), when the lamp level changes lit windows, and when three re-creates a texture. Bundles run before the opaque list, so the sky and the transparents still come after them.
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
