# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"CPM: Motor Edition": a 3D browser game of Philippine-market motorcycles on a Philippine-style island (Three.js WebGPU with WebGL 2 fallback, Rapier3D physics, synthesized WebAudio). Vanilla ES modules, **no build step, no package.json, no linter, no test suite**. README.md has the full feature/physics description; LEGAL.md has rules for adding brand/trademark content (read before adding bikes or liveries).

## Running

Must be served over http (ES modules + `fetch` of JSON; `file://` fails):

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

The service worker is off on localhost unless you add `?sw`. Debug hook in the browser console: `window.__cpm` (`S`, `cfg`, `ctx`, `spec()`, `step`, `shift`, `reset`, `setBike(id)`, `startEngine`, ...).

Multiplayer relay (`server/`, Cloudflare Worker + Durable Object): `cd server && npx wrangler dev` for local, `npx wrangler deploy` to ship. See `server/README.md` for the protocol; changing the packet format means bumping `PROTO` in both `server/worker.js` and `js/net.js`.

## Releasing: bump the build

Cache busting is manual. **When you ship a change, bump `BUILD` in `js/config.js` and every `?v=<build>` in `index.html` (stylesheet, importmap entries, menu.js script tag) together.** `sw.js` is registered as `sw.js?v=BUILD`, builds its precache list from `index.html` (importmap + src/href) plus the bike index and data files, and uses `BUILD` as the cache name, so bumping is all the service worker needs. A new module must be added to the importmap in `index.html`. Commit messages follow `Build X.Y: description`.

## Architecture

- **Two-stage load.** `index.html` + `js/menu.js` is a plain-HTML instant menu; it downloads three.js/Rapier/modules in the background and only imports `js/main.js` (which does top-level `await`s for bike data, renderer, physics init) when PLAY is tapped. Keep `menu.js` free of heavy imports.
- **Shared state.** `js/state.js` exports `S` (per-frame bike state: position, rpm, gear, lean, ...) and `ctx` (cross-module registry: current bike/spec/drive, `bikes`, `zones`, `nearRoad`, `bikeTemplate`, ...). Modules communicate through these rather than importing each other, to keep module order safe (e.g. `audio.js` reads `ctx.zones` set by `main.js`).
- **Data-driven bikes.** `data/bikes/*.json` (listed in `index.json`) define chassis, torque curve, drivetrain, garage parts/sliders/toggles and defaults. `spec.js` `computeSpec(bike, bcfg)` flattens bike data + the user's garage settings into the spec the physics reads. Part options apply generically: `pow`, `ie`, `csp` multiply; any other key replaces the base value. Models/gauge clusters for a genuinely new look still need code in `model.js` / `hud.js`.
- **Physics.** `rapier.js` runs a fixed 120 Hz tick (max 4/frame, rendering interpolated) with a dynamic Rapier body, axle ground probes for suspension, and static colliders streamed in a 3×3 block of 25 m cells. `physics.js` is the bike solver (engine, clutch slip, steering/lean) running 3 substeps per tick; `drivetrain.js` has the manual gearbox and CVT (`DRIVES`); `ignition.js` the key/fuel-pump/starter sequence.
- **World.** `world.js` builds terrain, roads, town and props at load from `data/map/island.json` (the island is data). Terrain is LOD tiles; props are static instanced chunks. `perf.js` (culling, auto-resolution, Lambert fallback materials) and `gpucull.js` (WebGPU compute culling + indirect draws, WebGL uses chunk culling) handle rendering cost; `renderer.js` owns WebGPU→WebGL fallback and quality presets. `daynight.js`/`lights.js` drive the Philippine-time day/night cycle and night lighting.
- **Gameplay layers.** `missions.js` (date-seeded daily quest hubs: parking/parcel/food; tunables at the top: `NHUB`, `SEP`, `BIKE_P`, `HARD`, `K`), `net.js` + `race.js` (multiplayer ghosts and tap-to-race through the relay), `garage.js`/`options.js`/`controls.js`/`hud.js` (UI). Audio is fully synthesized (`audio.js` + `engine-worklet.js` AudioWorklet).
- **Vendored deps.** three.js and Rapier live in `vendor/` and are mapped by the importmap (no CDN, needed for offline play). `THIRD_PARTY.md` lists them.
- **Persistence.** Settings in `localStorage` key `cpmme` (global options + per-bike `bikes` block); WebGL fallback flag in `sessionStorage` `cpmGL`. Defaults live in `js/config.js` (`GLOBAL_DEF`).
