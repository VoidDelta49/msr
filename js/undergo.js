// Ilalim, the glue (Build 11.99): going down through the dark passage in the cave hall and back up at the mouth, for the bike and
// on foot; the caves shown only while you are down there; the camera kept inside the rock; reset. Layout and portals: under.js,
// drawing: underfig.js, light: daynight.js (reads ctx.ug).
import { S, ctx } from './state.js';
import { camera, MB } from './renderer.js';
import { UG, H } from './world.js';
import { F } from './foot.js';
import { syncBody } from './rapier.js';
import { footCamSnap } from './footfig.js';
import { UGG } from './underfig.js';
import { say } from './hud.js';
import { blip } from './audio.js';

ctx.ug = UG;
let far0 = camera.far, fade = null, hinted = 0, cool = 0;
function veil() { // a black veil that fades out: the jump happens under it
  if (!fade) { fade = document.createElement('div'); fade.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;opacity:0;transition:opacity .7s ease-out;z-index:5'; document.body.appendChild(fade); }
  fade.style.transition = 'none'; fade.style.opacity = '1'; void fade.offsetWidth; fade.style.transition = 'opacity .7s ease-out'; fade.style.opacity = '0';
}
function show(on) {
  UG.on = on; UGG.visible = on;
  camera.far = on ? 320 : far0; camera.updateProjectionMatrix(); if (MB) MB.cut();
}
function go(down) {
  const T = down ? UG.inPos() : UG.outPos(); veil(); show(down); cool = .8;
  if (F.on) {
    Object.assign(F, { x: T.x, z: T.z, y: H(T.x, T.z), vx: 0, vy: 0, vz: 0, psi: T.psi, cy: T.psi, gnd: true }); footCamSnap();
  } else {
    S.x = T.x; S.z = T.z; S.psi = T.psi; S.yaw = 0; S.delta = 0; const sp = ctx.spec;
    S.hF = S.hR = H(S.x, S.z); S.zH = S.hF + (sp.yf + sp.yr + sp.pf + sp.pr) / 2; S.zV = 0; S.th = 0; syncBody();
    camera.position.set(S.x + Math.sin(S.psi) * 4.2, 1.9 + S.zH, S.z + Math.cos(S.psi) * 4.2);
  }
  blip('thud', 1); say(down ? `${UG.D.name} · the caves under the Underground River Cave. Ride up to the daylight to come back` : 'Back in the cave hall', down ? 4200 : 1600);
}
// ctx.ugCam: the bike's chase camera, pulled in along its boom so it never ends up inside the rock (main.js)
ctx.ugCam = (cp, tx, ty, tz) => { if (!UG.on) return; const f = UG.fit(tx, ty, tz, cp.x, cp.y, cp.z); if (f < 1) cp.set(tx + (cp.x - tx) * f, ty + (cp.y - ty) * f, tz + (cp.z - tz) * f); };
// the walker's orbit camera underground (footfig.js footCam takes a fit function): places.js keeps its own outside
const fitFoot = (tx, ty, tz, cx, cy, cz) => UG.fit(tx, ty, tz, cx, cy, cz);
export function underFit() { return UG.on ? fitFoot : null; }
ctx.ugReset = () => { if (UG.on) show(false); };
export function underFrame(dt) {
  if (!UG.portal || ctx.inside || ctx.GAR || S.crashed) return;
  if (cool > 0) { cool -= dt; return; }
  const P = F.on ? F : S, fx = -Math.sin(P.psi), fz = -Math.cos(P.psi), moving = F.on ? F.spd > .3 : Math.abs(S.v) > .5;
  if (!UG.on) {
    // UG.on also follows where you are (a reset, the bike left below while you walk out...)
    if (UG.has(P.x, P.z)) { show(true); return; }
    if (moving && UG.enterAt(P.x, P.z, fx * Math.sign(S.v || 1), fz * Math.sign(S.v || 1), F.on)) { go(true); return; }
    const p = UG.portal, d = Math.hypot(P.x - p.x, P.z - p.z); if (d < 14 && performance.now() - hinted > 60000) { hinted = performance.now(); say(F.on ? 'A dark passage leads down. Walk in to explore the caves' : 'A dark passage leads down. Ride in to explore the caves', 2600); }
  } else {
    if (!UG.has(P.x, P.z)) { show(false); return; }
    if (moving && UG.exitAt(P.x, P.z, fx * Math.sign(S.v || 1), fz * Math.sign(S.v || 1), F.on)) go(false);
  }
}
