# CPM: Motor Edition

A single-file 3D web game: one customizable motorcycle (Suzuki Raider Fi / Blade) on a Philippine-style island. Built with Three.js, targeted at mobile browsers. Everything lives in `index.html`.

## Play

Open the GitHub Pages site for this repo on your phone. It plays fullscreen. No build step.

## Features

- First-person view with handlebar and a gauge panel (speedometer lives on the bike only)
- 6-speed return-shift transmission (1-N-2-3-4-5-6), analog wet clutch (clutch required to shift), rev limiter, idle governor, stalling, fuel
- 2-DOF heave/pitch suspension and lean-based steering
- Garage with customizable parts that change the real specs, with live preview
- Procedural Philippine-style island: coastline, volcano, rice paddies, river, town (church, plaza, market), jeepneys, tricycles, palms, power lines, gas station, rotating minimap
- Parking missions, WebAudio engine sound

## Controls

Touch:

- Steering wheel: bottom-left
- Clutch pad (drag down to pull) beside the throttle pad (drag up/down), plus a brake button
- START button, and ▲ / ▼ shift buttons (clutch must be pulled to shift)
- Top bar: CAM, PARK, GARAGE, RESET, ⚙ (options)

Keyboard:

- `E` / `Shift`: shift up, `Q` / `Ctrl`: shift down
- `R`: start engine, `C`: toggle camera, `G`: garage, `P`: parking mission, `O`: options (`Esc` closes)

## Renderer

Uses three r0.186.1 `WebGPURenderer` with automatic WebGL 2 fallback (also on device loss or errors). The Options menu (⚙, also on the start screen) has a "Force WebGL" toggle and lets you show or hide the on-screen renderer and FPS readouts. Riding pauses while Options is open.

WebGPU has not been verified on real hardware yet. Check the renderer readout on your device.

## Technical notes

- Three.js is loaded from jsDelivr via an importmap (`three/webgpu`, `three/tsl`), so an internet connection is needed.
- Settings are stored in `localStorage` key `cpmme`. The WebGL fallback flag is in `sessionStorage` key `cpmGL`.
- Collision uses oriented bounding boxes in a 20 m grid.
- Debug hook: `window.__cpm` (`S`, `cfg`, `spec`, `step`, `shift`, `reset`, ...).

## Known limitations

- The soft-shadow mode was lost in the WebGPU renderer, so shadow edges are slightly harder (PCF).

## Ideas

- Compute-shader features: GPU grass, rain, more traffic
- Visual pass (materials, lighting, bike model detail)
- Multiplayer
