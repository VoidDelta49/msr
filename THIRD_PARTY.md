# Third-party software and credits

CPM: Motor Edition's own code is under the MIT License (see `LICENSE`). It also uses the libraries below. They are loaded at runtime from the jsDelivr CDN (see the importmap in `index.html`); their code is **not** copied into this repository and is not modified.

| Library | Version | License | Source |
|---|---|---|---|
| [three.js](https://threejs.org) (`three/webgpu`, `three/tsl`, `three/addons/`) | 0.186.1 | MIT | https://github.com/mrdoob/three.js |
| [Rapier3D](https://rapier.rs) (`@dimforge/rapier3d-compat`) | 0.21.0 | Apache-2.0 | https://github.com/dimforge/rapier |

## three.js

Copyright © three.js authors. Released under the MIT License: https://github.com/mrdoob/three.js/blob/dev/LICENSE

## Rapier3D

Copyright © Dimforge. Released under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0

If you ever bundle or self-host Rapier (instead of loading it from the CDN), include a copy of the Apache-2.0 license text and Rapier's `NOTICE` file, if it has one, with the files you distribute, and keep any copyright notices in the files.

## Not third-party

- **Textures** are generated in code (`js/tex.js`); no image files are in the repository.
- **Sound** is fully synthesized WebAudio (`js/audio.js`, `js/engine-worklet.js`); no audio samples are used.
- **Fonts** are the viewer's system fonts (`system-ui`, `ui-monospace`, `Georgia`); none are bundled.
- **Bike specifications** (power, weight, gearing, geometry) are factual figures from manufacturers' published specifications. No text, tables or images were copied from them.

## When you add a dependency

Add a row to the table above with its license. If it is bundled or copied into the repo, also keep its license text and notices with it.
