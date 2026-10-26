# tools/ — debug & test kit (Node 22, no install, no browser needed except smoke)

Run these instead of reading code or launching the game. All print only problems plus one summary line.

| Command | What it does | Time |
|---|---|---|
| `node tools/test.mjs` | **Run this before every push.** check + physics invariants + diff vs `baseline.json` | ~3 s |
| `node tools/test.mjs --full` | Same plus the garage sweep (every part option / slider extreme of every bike) | ~30 s |
| `node tools/test.mjs --update` | Accept current physics numbers as the new baseline (after an INTENDED physics/data change) | ~3 s |
| `node tools/check.mjs [-v]` | Static: BUILD / `?v=` / changelog sync, import graph + import map, syntax, bike JSON schema, `sound.parts`, spec sweep of every part option | ~1 s |
| `node tools/sim.mjs [bike\|all] [scenario\|all]` | Headless run of the real `physics.js`/`drivetrain.js`/`ignition.js`/`spec.js`; one line per bike+scenario | ~1 s |
| `node tools/fuzz.mjs [bike\|all] [--seeds 3] [--seed N]` | Random rider inputs + random garage setups, slopes, surfaces; checks finite state, speed/rpm/lean/gear/fuel bounds. Prints a replay command on failure | ~3 s |
| `node tools/sweep.mjs [bike\|all] [-v]` | Each part option, slider min/max and toggle flip through launch+brake; flags NaN or implausible jumps vs stock | ~25 s |
| `node tools/bike.mjs [id]` | No arg: comparison table of all bikes (mass, PS, PS/100kg, sim 0-60, top, braking, sound outliers). With id: full report | ~2 s |
| `node tools/new-bike.mjs <id> --from <bike>` | Scaffold a new bike (copy full of TODO markers; `check` fails until they're gone) and print the checklist | – |
| `node tools/serve.mjs [port]` | Static http server for manual play-testing (ES modules need http) | – |
| `node tools/smoke.mjs` | Real-browser smoke (playwright-core + chromium): PLAY, switch every bike, fail on console errors. Skips (exit 0) if no browser | – |

## sim.mjs
Scenarios: `launch` (0-60/100 km/h, 100/400 m, top speed, scripted rider shifts at redline) · `start` (key + starter: catch time, idle) · `brake` (60 km/h to stop, full and half lever; lock time, stoppie, g) · `corner` (lean, radius, grip asked at 5/10/15 m/s) · `wheelie` (synthetic strong+sticky setup, wheelie control on vs off; 0 = this bike can't lift) · `stall` (anti-stall off, clutch dump in 1st; info only) · `idle` · `iss` (Idling Stop, scooters).
Options: `--part exhaust=1 --part tires=1` (part option index) · `--set kf=14 --set autoClutch=false` (sliders/toggles) · `--no-wc` (wheelie control off) · `--tough` · `--json`.
Examples: `node tools/sim.mjs raider150 launch --part exhaust=1` · `node tools/sim.mjs all brake` · before/after diff: `node tools/sim.mjs all launch > /tmp/a; (edit); node tools/sim.mjs all launch | diff /tmp/a -`.
For a custom experiment write a 10-line script on `tools/lib/headless.mjs` (`createSim(id, {parts,set,cfg,spec})` → `sim.run(seconds, perTickFn)`, `sim.S` is the live bike state; `opts.spec` overrides raw spec values such as `{ mu: 1.6, pow: 3 }`).

## Limits (know what a green run does NOT cover)
- Flat ground, no Rapier: suspension heave/pitch, walls, crashes, tricycle roll are NOT simulated (only the bike solver is).
- Rendering, audio, UI, multiplayer, WebGPU: only checked statically (syntax/imports/data) or by `smoke.mjs` in a real browser.
- Baseline tolerance is 4% (absolute floors for times); `test.mjs` fails on drift so intended changes need `--update` plus a note in the commit.
- When a new bike is added: `check` validates its JSON/sound profile and `test` fails with "new metric" until `--update` is run.

## Adding a bike (everything below is verified automatically)
1. `node tools/new-bike.mjs <id> --from <similar bike>` then fill in the JSON with real numbers and its own `sound.parts`.
2. `node tools/check.mjs` must be clean. It verifies: id accepted by the multiplayer relay (a-z0-9_-, <=24; <=24 part keys, <32 options), `model` exists in `MODELS` (js/model.js), `cluster` in `CLUSTERS` (js/hud.js), schema/number sanity, sorted torque table, gears/final-drive keys, `sound.parts` complete and not a copy, defaults valid, no TODO left, part-option/chassis keys the code actually reads (typo catcher), part keys known to the garage tabs, LEGAL.md and README mention. Warnings about LEGAL.md/README are real to-dos.
3. `node tools/bike.mjs <id>` and `node tools/bike.mjs` to compare with the others; `node tools/sweep.mjs <id>` and `node tools/fuzz.mjs <id>` must pass.
4. `node tools/test.mjs` fails with `NEW <id>: N metrics not in baseline` until you review and run `--update`.

## Adding a feature
- UI element: `check` fails if a `$('id')` has no element in index.html or any template string.
- New module: `check` fails if it isn't in index.html's import map (cache busting + offline) or has a syntax error.
- Physics/drivetrain/tyre/ignition change: `test` shows exactly which metrics moved (DRIFT lines); if intended, `--update`. If the feature needs new inputs/state, extend `tools/lib/headless.mjs` (state init) and add a scenario to `tools/sim.mjs` (a function returning a flat object of numbers: it is picked up by `test.mjs` and the baseline automatically).
- Anything that runs only in the browser (render, audio, UI behaviour, multiplayer) still needs `smoke.mjs` or a manual look.
