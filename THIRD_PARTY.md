# Third-party software and credits

ISLA's own code is under the MIT License (see `LICENSE`). It also uses the libraries below. Copies are included in `vendor/` (see the importmap in `index.html`) so the game works offline; each folder carries the library's license file.

| Library | Version | License | Source |
|---|---|---|---|
| [three.js](https://threejs.org) (`three/webgpu`, `three/tsl`, `three/addons/`) | 0.187.0 | MIT | https://github.com/mrdoob/three.js |
| [Rapier3D](https://rapier.rs) (`@dimforge/rapier3d-compat`) | 0.21.0 | Apache-2.0 | https://github.com/dimforge/rapier |

## three.js

Copyright © three.js authors. Released under the MIT License: https://github.com/mrdoob/three.js/blob/dev/LICENSE

## Rapier3D

Copyright © Dimforge. Released under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0

`vendor/rapier/LICENSE` is the Apache-2.0 text; the npm package ships no `NOTICE` file. Copyright notices inside the files are kept.

## Weather data

The live weather (Options > Game > Weather > Live PH) is [Open-Meteo](https://open-meteo.com/) data, fetched by the relay
(`server/wx.js`) for one fixed point in the Philippines. Weather data by Open-Meteo.com, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Their free API is for **non-commercial** use (under 10,000 calls a day; the
relay makes about 100): if the game is ever sold or carries ads, move to their paid plan or another source first.

## Live radio

After its four generated stations the in-game radio can tune to real Philippine **public service** radio (`js/radiolive.js`, played by
`js/radio.js`). What it does and does not do:

- **Which stations:** only public broadcasters, matched by name / website in `PUBLIC` (`js/radiolive.js`): the state network
  (Philippine Broadcasting Service: Radyo Pilipinas, Republika FM1, Capital FM2) and state university stations (DZUP, DZLB). Commercial
  stations are never listed, whatever the directory returns (`node tools/radio.mjs` checks this).
- **How it plays:** the player's browser connects to the station's own public webcast, the same address any internet radio app or the
  station's website player uses. The game does not record, cache, re-host, relay, edit or mix the programme, sells nothing around it
  and puts no ads on it; the station's name is shown while it plays. The stream never passes through this project's servers.
- **Where the addresses come from:** none are stored in this repository. They are looked up at play time in the
  [Radio Browser](https://www.radio-browser.info/) community directory (free public API, no key; its data is public domain), kept for a
  day in the player's browser, and a tune-in is reported back to the directory as its API asks.
- **Rights:** the programmes, music and names belong to the stations and their licensors. This project claims no rights in them and is
  not affiliated with or endorsed by any station. A station that wants to be left out: remove its rule from `PUBLIC` (or open an issue)
  and it is gone in the next release.
- **If the game is ever sold or carries ads:** take the live stations out or get each station's permission first; tuning in for free is
  what a radio does, building a paid product on someone's broadcast is not.
- **Privacy:** using a live station makes the player's browser contact the directory and the station's stream host (they see an IP
  address, like any website). With the radio off nothing is contacted; switching it on (any station) asks the directory once which
  live stations are on the air.

## Not third-party

- **Textures** are generated in code (`js/tex.js`); no image files are in the repository.
- **Sound** is fully synthesized WebAudio (`js/audio.js`, `js/engine-worklet.js`); no audio samples are used. The only audio not made by the game is the optional live radio above, which is streamed, never stored.
- **Fonts** are the viewer's system fonts (`system-ui`, `ui-monospace`, `Georgia`); none are bundled.
- **Bike specifications** (power, weight, gearing, geometry) are factual figures from manufacturers' published specifications. No text, tables or images were copied from them.

## When you add a dependency

Add a row to the table above with its license. If it is bundled or copied into the repo, also keep its license text and notices with it.

**Local change:** `vendor/rapier/rapier.mjs` is the npm file with its embedded base64 WASM moved out to `vendor/rapier/rapier.wasm` (loaded with `fetch(new URL("rapier.wasm", import.meta.url))`), which cuts the download by about a quarter. The bytes are identical.
