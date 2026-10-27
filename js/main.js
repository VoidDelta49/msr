// Entry point: load bike data, wire modules together, run the loop.
import * as THREE from 'three';
import { $, clamp } from './util.js';
import { cfg, save, bikeCfg, BUILD } from './config.js';
import { S, ctx } from './state.js';
import { renderer, scene, camera, sun, GPU, API, FELL, draw, warm, setDPR } from './renderer.js';
import { SEA, ICZ, H, roadH, MAP, MAPV, zones, nearRoad, LMF, OBBS } from './world.js';
ctx.zones = zones; ctx.nearRoad = nearRoad; // audio.js reads these (no import, keeps module order)
import { computeSpec } from './spec.js';
import { DRIVES } from './drivetrain.js';
import { B, buildModel, applyLook, snapshot, releaseSkin, blobTick } from './model.js';
import { step } from './physics.js';
import { dayNight } from './daynight.js';
import { initAudio, updAudio, blip } from './audio.js';
import { say, drawCluster, drawMini, updPerf, setFps, setPhys, setGfx, setJank } from './hud.js';
import { RP, TICK, initRapier, tickR, syncBody, crashVisual, bounce } from './rapier.js';
import { actions, input, footInput, ptr, TC, WMAX } from './controls.js';
import { F, footEnv, footStep, dismount, mount, nearBike, offBlock } from './foot.js';
import { figBuild, figShow, figBody, figPose, footCam } from './footfig.js';
import { missions, animMarker } from './missions.js';
import { G as GARAGE, buildGarage, garageFrame } from './garage.js';
import { initStudio, enter as studioIn, leave as studioOut, studioFrame } from './studio.js';
import { O, openOpts, closeOpts } from './options.js';
import { autoRes, resScale, jankStart, jankEnd, jankText } from './perf.js';
import { cull } from './gpucull.js';
import './layout.js'; // HUD + touch-control layout (after controls.js: needs body.touch)
import { NET, netFrame, join as netJoin, leave as netLeave } from './net.js';
import { raceTick } from './race.js';
import { rideInit, rideFrame } from './ride.js';
import { keySwitch, killSwitch, starter, quickStart } from './ignition.js';
import { GPU_TYPES } from './world.js';

/* ---------- data ---------- */
// loaded by menu.js on PLAY; stage() moves its loading bar (fractions continue after the download's 0–70%)
const stage = window.__cpmLoad || (() => { });
stage('Loading bikes', .78);
const ids = await (await fetch('data/bikes/index.json?v=' + BUILD)).json();
for (const d of await Promise.all(ids.map(id => fetch(`data/bikes/${id}.json?v=${BUILD}`).then(r => r.json())))) ctx.bikes[d.id] = d;

const SPAWN = (F => ({ ...F.W(62, 30), psi: Math.PI / 2 - F.ry }))(LMF.lot[0]); // in the parking lot, wherever the map puts it
function reset() {
  if (F.on) footOff(); // reset / bike swap while walking: back on the bike
  Object.assign(S, {
    x: SPAWN.x, z: SPAWN.z, psi: SPAWN.psi, v: 0, rpm: 0, running: false, key: false, kill: false, tip: false, cr: 0, cranking: false, cT: 0, keyT: 0, stT: 0, fi: 0, warm: S.warm || 0, gear: 0, cl: 0, thr: 0, thrEff: 0, brake: 0, steer: 0, delta: 0, lean: 0, leanV: 0, yaw: 0, zH: 0, zV: 0, th: 0, thV: 0, cF: 0, cR: 0, hF: 0, hR: 0, a: 0, c: 0,
    fuel: S.fuel ?? ctx.spec.fuel.cap, wp: 0, wpv: 0, wA: 0, wAR: 0, ws: 0, lkF: false, lkR: false, ayu: 0, skid: 0, fxr: 0, surf: 1, cutT: 0, act: 0, shCD: 0, lim: false, padT: 0, hits: S.hits || 0, odo: S.odo || 0,
  });
  ctx.drive.reset(S); S.hF = roadH(S.x, S.z); S.hR = S.hF; S.zH = S.hF + (ctx.spec.yf + ctx.spec.yr + ctx.spec.pf + ctx.spec.pr) / 2; syncBody();
}
// a part that changes the model's shape (B.var, e.g. spoke vs mag wheels) rebuilds it
function recompute() { ctx.spec = computeSpec(ctx.bike, ctx.bcfg); if ((ctx.spec.var | 0) !== B.var) { buildModel(ctx.bike, ctx.spec); attachCam(); } applyLook(ctx.spec); }
// put the camera / rider visibility back on a freshly built local model
function attachCam() { if (!ctx.GAR && !F.on && ctx.camMode === 0) { B.cam.add(camera); camera.position.set(0, 0, 0); camera.rotation.set(-.3, 0, 0); } B.rider.forEach(m => m.visible = !ctx.GAR && !F.on && ctx.camMode === 1); }
// multiplayer (net.js): a remote rider's bike + paint is built into B like ours, snapshotted, then ours is rebuilt.
// Cached by look, so 8 friends on the same bike and paint cost one build. Not while crashed (the rider is a ragdoll).
// look = { bike, parts: { key: option index } }: only known part keys, indices clamped to the bike's options; everything
// else (sliders, assists) stays stock, it doesn't change the model. At most TPL_MAX cached; unused ones are disposed.
const TPL = new Map(), TPL_MAX = 10;
function evictTpl() {
  if (TPL.size < TPL_MAX) return; const used = new Set([...NET.peers.values()].map(P => P.tpl));
  for (const [k, t] of TPL) { if (TPL.size < TPL_MAX) break; if (used.has(t)) continue; TPL.delete(k); t.o.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.skeleton) o.skeleton.dispose(); }); t.dispose(); }
}
ctx.bikeTemplate = look => {
  const bike = ctx.bikes[look && look.bike]; if (!bike) return null;
  const c = { ...bike.defaults }, P = look.parts && typeof look.parts === 'object' ? look.parts : {};
  for (const k in bike.parts) { const v = P[k]; if (Number.isInteger(v)) c[k] = Math.max(0, Math.min(bike.parts[k].o.length - 1, v)); }
  const key = bike.id + JSON.stringify(Object.keys(bike.parts).map(k => c[k])); if (TPL.has(key)) return TPL.get(key); if (S.crashed) return null; evictTpl();
  let spec; try { spec = computeSpec(bike, c); } catch (e) { spec = computeSpec(bike, { ...bike.defaults }); }
  buildModel(bike, spec); applyLook(spec); const t = snapshot(); releaseSkin(); buildModel(ctx.bike, ctx.spec); recompute(); attachCam();
  TPL.set(key, t); return t;
};
function setBike(keepPos) {
  if (ctx.rideExit) ctx.rideExit(); // riding in someone's sidecar: get off first
  const bike = ctx.bikes[cfg.bike] || ctx.bikes[ids[0]]; cfg.bike = bike.id;
  ctx.bike = bike; ctx.bcfg = bikeCfg(bike); ctx.drive = DRIVES[bike.drivetrain];
  buildModel(bike, computeSpec(bike, ctx.bcfg)); recompute();
  document.body.classList.toggle('cvt', bike.drivetrain === 'cvt'); document.body.classList.toggle('nocl', bike.drivetrain === 'rotary');
  S.fuel = ctx.spec.fuel.cap; if (!keepPos) S.warm = 0; const keep = ctx.GAR || keepPos ? { x: S.x, z: S.z, psi: S.psi } : null; reset(); if (keep) Object.assign(S, keep);
  attachCam();
  $('brkT').textContent = bike.drivetrain === 'cvt' ? 'BRAKE · CBS' : 'BRAKE';
}
// physics engine first: everything below positions the Rapier body
stage('Starting physics', .8);
if (!await initRapier()) throw new Error("Couldn't load the physics engine (" + RP.err + '). Check your connection and try again.');
stage('Preparing the bike', .85); setBike(); save(); rideInit();
// build every shader now, behind the title screen (see renderer.js warm())
stage('Compiling shaders', .9); initStudio(); cull(camera); ctx.warmMs = await warm(); stage('Ready', 1);

function startEngine() {
  // garage stand only (REV button, debug hook): no key / starter ritual there
  if (S.running) return; if (S.fuel <= 0) return say('Out of fuel. Push it to the gas station.');
  quickStart(); blip('start'); say('Engine on');
}

/* ---------- on foot (foot.js / footfig.js) ---------- */
// S stays the parked bike's state; F is the walker. Get off: key off, bike held still (loop), camera to third person, rider body stands next to it.
footEnv({ H, SEA, OBBS });
function getOff() {
  if (F.on || ctx.GAR || ctx.OPT || ctx.paused || ctx.ride) return;
  if (ctx.racing) return say('Not during a race');
  const why = dismount(); if (why) return say(why);
  if (S.key) keySwitch(); // parking: ignition off (a running engine would idle on with nobody on it)
  F.prevCam = ctx.camMode; if (ctx.camMode === 0) toggleCam(); // first person has no body to look from: third person while walking
  F.fp = F.prevCam === 0; footView(); // first person stays first person
  document.body.classList.add('foot'); B.rider.forEach(m => m.visible = false); figBuild(); figShow(true); figBody(!F.fp);
  say(document.body.classList.contains('touch') ? 'On foot: joystick walks, JUMP jumps, drag the screen to look' : 'On foot: WASD walk, Shift run, Space jump, F get on', 2600);
}
// CAM on foot: first person (eyes at the helmet, no body) <-> third person orbit
function footView() { F.cp = F.fp ? 0 : .25; $('bCam').textContent = F.fp ? 'CAM: 1ST' : 'CAM: 3RD'; }
function footCamToggle() { F.fp = !F.fp; footView(); figBody(!F.fp); }
function footOff() { // back on the bike (or the bike was reset under us): F.on is cleared by foot.js mount() / here
  F.on = false; document.body.classList.remove('foot'); figShow(false); B.rider.forEach(m => m.visible = ctx.camMode === 1);
  if (F.prevCam === 0 && ctx.camMode === 1) toggleCam(); F.prevCam = 1; S.thr = S.brake = 0; $('bCam').textContent = ctx.camMode ? 'CAM: 3RD' : 'CAM: 1ST';
}
function getOn() { const why = mount(); if (why) return say(why, 1400); footOff(); say('On the bike. K = key, then hold R to start', 2200); }
// the bike waits where it was parked: brake on, clutch in, nothing else
function footTick(dt) {
  S.thr = 0; S.brake = 1; S.steer = 0; S.cl = ctx.spec.type === 'cvt' ? 0 : 1; S.back = false;
  footStep(footInput(dt), dt);
}

/* ---------- camera / animation ---------- */
function toggleCam() {
  ctx.camMode ^= 1; document.body.classList.toggle('cam3', ctx.camMode === 1);
  if (ctx.camMode === 0) { B.cam.add(camera); camera.position.set(0, 0, 0); camera.rotation.set(-.3, 0, 0); } else scene.add(camera);
  B.rider.forEach(m => m.visible = ctx.camMode === 1); $('bCam').textContent = ctx.camMode ? 'CAM: 3RD' : 'CAM: 1ST';
}
ctx.camMode = 1; toggleCam();
const tmp = new THREE.Vector3();
// free look: drag the empty scene to orbit, wheel to zoom (FOV); the view eases back to normal once the bike is moving
const LK = { y: 0, p: 0, id: null, x: 0, yy: 0, yr: 0 }, PT = new Map(); let pinch = 0; camera.rotation.order = 'YXZ';
const pdist = () => { const [a, b] = [...PT.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
addEventListener('pointerdown', e => { if (e.target.id !== 'gl' || ctx.GAR || ctx.OPT) return; PT.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (PT.size === 2) { LK.id = null; pinch = pdist(); } else if (PT.size === 1) { LK.id = e.pointerId; LK.x = e.clientX; LK.yy = e.clientY; } });
addEventListener('pointermove', e => {
  const q = PT.get(e.pointerId); if (!q) return; q.x = e.clientX; q.y = e.clientY;
  if (PT.size === 2) { const d = pdist(); if (pinch > 0 && d > 0) { cfg.fov = clamp((cfg.fov ?? 72) * pinch / d, 50, 110); pinch = d; } return; } // fingers apart = zoom in = smaller FOV
  if (e.pointerId !== LK.id) return;
  if (F.on) { F.cy -= (e.clientX - LK.x) * .006; F.cp = clamp(F.cp + (e.clientY - LK.yy) * .004, F.fp ? -1.3 : -.15, F.fp ? 1.3 : 1.25); } // on foot the drag orbits the walker (and sets which way W goes)
  else { LK.y = clamp(LK.y - (e.clientX - LK.x) * .006, -Math.PI, Math.PI); LK.p = clamp(LK.p + (e.clientY - LK.yy) * .004, -.8, .8); }
  LK.x = e.clientX; LK.yy = e.clientY;
});
const lkEnd = e => { if (!PT.delete(e.pointerId)) return; if (e.pointerId === LK.id) LK.id = null; if (PT.size < 2 && pinch) { pinch = 0; cfg.fov = Math.round(cfg.fov); save(); } };
addEventListener('pointerup', lkEnd); addEventListener('pointercancel', lkEnd);
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) addEventListener(g, e => e.preventDefault()); // Safari's native pinch
addEventListener('wheel', e => { if (e.target.id !== 'gl' || ctx.GAR || ctx.OPT) return; cfg.fov = clamp(Math.round((cfg.fov ?? 72) + Math.sign(e.deltaY) * 3), 50, 110); save(); }, { passive: true });
// touch-control visuals: skip the DOM write (and the style recalc it triggers) when nothing changed
const DOMC = {}; function dom(id, v, set) { const c = DOMC[id] || (DOMC[id] = { e: $(id), v: null }); if (c.v !== v) { c.v = v; set(c.e, v); } }
function visuals(dt, now) {
  const G = B.G, sp = ctx.spec;
  B.root.position.set(S.x, S.zH, S.z); B.root.rotation.set(0, S.psi, 0); B.lean.rotation.z = -S.lean;
  // tricycle rolling up onto its sidecar wheel (chair < 0): pivot on that wheel's line instead of the bike's
  if (sp.sc && S.chair < 0) { const cx = sp.sc * sp.scD, th = -S.lean; B.lean.position.set(cx * (1 - Math.cos(th)), -cx * Math.sin(th), 0); } else B.lean.position.set(0, 0, 0);
  B.body.position.y = .6 + (.075 - sp.sag); B.body.rotation.x = S.th; // lean pivots at the ground, not world y=0
  B.body.position.z = 0; if (S.wp) { // wheelie / stoppie: also turn about the contact patch of the wheel on the ground (rear +z, front -z)
    const c = Math.cos(S.wp), sn = Math.sin(S.wp), pz = S.wp > 0 ? sp.lr : -sp.lf, y0 = B.body.position.y; B.body.rotation.x += S.wp; B.body.position.y = y0 * c + pz * sn; B.body.position.z = pz + y0 * sn - pz * c;
  }
  B.steer.rotation.y = -S.delta; B.slider.position.y = -G.fork + (clamp(S.cF, -.07, .11) - sp.yf) / Math.cos(G.rake); B.rearH.position.y = G.rw + clamp(S.cR, -.07, .11) - sp.yr; // yf/yr: ride height lifts the chassis, wheels stay down
  const dy = B.rearH.position.y - G.pivotY, dz = G.rearZ - G.pivotZ; B.swing.position.set(G.swingX, G.pivotY + dy / 2, G.pivotZ + dz / 2); B.swing.rotation.x = -Math.atan2(dy, dz); B.swing.scale.z = Math.hypot(dy, dz);
  B.frontW.rotation.x = -S.wA; B.rearW.rotation.x = -S.wAR; B.thrG.rotation.x = S.thr * 1.2; B.brkL.rotation.y = -S.brake * .3;
  B.cluL.rotation.y = (sp.type === 'cvt' ? S.brake : Math.max(S.cl, ctx.bcfg.autoClutch && S.c < .5 ? 1 : 0)) * .3;
  const av = Math.abs(S.v), fov = (cfg.fov ?? 72) + (F.on ? F.rs * 6 : Math.min(14, av * .35)); // on foot sprinting widens the view a little (F.rs is already eased) if (!ctx.GAR && Math.abs(fov - camera.fov) > .01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (LK.id === null && av > 1.5) { const k = Math.exp(-dt * 3); LK.y *= k; LK.p *= k; if (Math.abs(LK.y) < .002) LK.y = 0; if (Math.abs(LK.p) < .002) LK.p = 0; }
  if (ctx.GAR) studioFrame(dt, now);
  else if (F.on) { figPose(); footCam(camera, dt, H); }
  else if (ctx.camMode === 0) {
    LK.yr += (clamp(S.yaw * .12, -.25, .25) - LK.yr) * (1 - Math.exp(-dt * 8)); B.cam.rotation.set(-(S.th + (S.wp || 0)) * .4, LK.yr, S.lean * .35); camera.rotation.set(-.3 + LK.p, LK.y, 0);
    const vib = S.running ? .0007 * (.4 + S.rpm / 9000) : 0, ph = now * S.rpm / 60 * 2 * Math.PI; camera.position.set(Math.sin(ph * .5) * vib, Math.sin(ph) * vib, 0);
  } else {
    const bx = Math.sin(S.psi), bz = Math.cos(S.psi), ox = bx * Math.cos(LK.y) + bz * Math.sin(LK.y), oz = bz * Math.cos(LK.y) - bx * Math.sin(LK.y); tmp.set(S.x + ox * 4.2, 1.9 + S.zH + LK.p * 4, S.z + oz * 4.2); camera.position.lerp(tmp, 1 - Math.exp(-dt * 5)); camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + .6);
    camera.lookAt(S.x - bx * 2, 1 + S.zH, S.z - bz * 2);
  }
  if (!ctx.GAR) dayNight(); // the studio has its own lights
  dom('wg', 'rotate(' + (S.steer * WMAX() * 57.3).toFixed(1) + ')', (e, v) => e.setAttribute('transform', v)); dom('cluFill', (S.cl * 100).toFixed(0) + '%', (e, v) => e.style.height = v); dom('bKey', !!S.key, (e, v) => e.classList.toggle('on', v)); dom('bKill', !!S.kill, (e, v) => e.classList.toggle('on', v)); dom('brkFill', (S.brake * 100).toFixed(0) + '%', (e, v) => e.style.setProperty('--p', v)); dom('thrg', (S.thr * 36).toFixed(1) + 'px', (e, v) => e.style.backgroundPositionY = v);
  const fb = ctx.GAR || ctx.OPT || ctx.paused || ctx.ride || ctx.racing || S.crashed ? '' : F.on ? (nearBike() ? 'GET ON' : '') : !offBlock() ? 'GET OFF' : ''; // the touch button (F on a keyboard)
  dom('bFoot', fb, (e, v) => { e.textContent = v; e.hidden = !v; });
  animMarker(now);
}

/* ---------- garage ---------- */
GARAGE.onChange = recompute;
GARAGE.onBike = () => { setBike(); say(ctx.bike.name, 1200); };
function openGarage() { if (ctx.GAR || ctx.OPT) return; if (F.on) return say('Get back on the bike first'); if (ctx.ride) return say('Get off the tricycle first'); buildGarage(); $('garage').hidden = false; ctx.GAR = true; document.body.classList.add('gar'); scene.add(camera); B.rider.forEach(m => m.visible = false); studioIn(); }
$('gClose').onclick = () => { studioOut(); $('garage').hidden = true; ctx.GAR = false; TC.rev = 0; document.body.classList.remove('gar'); ctx.camMode ^= 1; toggleCam(); syncBody(); };
ptr($('revB'), () => { TC.rev = 1; $('revB').classList.add('on'); }, null, () => { TC.rev = 0; $('revB').classList.remove('on'); });
$('bounceB').onclick = () => { if (RP.ok) bounce(); };

/* ---------- wiring ---------- */
Object.assign(actions, {
  shift: d => F.on ? (d > 0 && (TC.jump = 1)) : ctx.drive.shift(ctx.spec, S, d, ctx.bcfg), start: d => ctx.GAR ? (d && startEngine()) : starter(d), key: keySwitch, kill: killSwitch, cam: () => F.on ? footCamToggle() : toggleCam(), garage: openGarage, foot: () => F.on ? getOn() : getOff(),
  opts: () => ctx.OPT ? closeOpts() : openOpts(), closeOpts,
});
O.onPerf = () => updPerf(API);
$('bGar').onclick = openGarage; $('bCam').onclick = () => F.on ? footCamToggle() : toggleCam(); $('bFoot').onclick = () => actions.foot(); $('bReset').onclick = () => { if (ctx.rideExit) ctx.rideExit(); reset(); say('Back at the lot'); };
function goFS() { const d = document.documentElement; if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { })).catch(() => { }); }
addEventListener('pointerdown', () => { if (!ctx.paused && !ctx.GAR && !ctx.OPT) goFS(); });
// menu.js: PLAY / RESUME (fullscreen was requested there, inside the tap) and the menu's bike picker
let played = false;
export function play() { initAudio(); ctx.paused = false; if (!played) { played = true; say(ctx.bike.hint); } }
export function mpJoin(room, name, url) { netJoin(room, name, url); }
export function mpLeave() { netLeave(); }
// quests with a required bike (missions.js): swap right where you stand
ctx.switchBikeHere = id => {
  cfg.bike = id; setBike(true); quickStart(); S.hF = S.hR = roadH(S.x, S.z); S.zH = H(S.x, S.z) + (ctx.spec.yf + ctx.spec.yr + ctx.spec.pf + ctx.spec.pr) / 2; syncBody(); save(); say(ctx.bike.name, 1500);
};
export function switchBike(id) { cfg.bike = id; setBike(); save(); say(ctx.bike.name, 1200); }

function water() { if (S.wet) { S.v *= .9; return; } if (H(S.x, S.z) < SEA + .12) { S.wet = true; say('Splash! You rode into the water', 1600); blip('splash'); blip('thud', 3); setTimeout(() => { reset(); S.wet = false; say('Towed back to the lot'); }, 1600); } }

/* ---------- physics ---------- */
// Rapier at a fixed 120 Hz (3 bike-solver substeps per tick), drawn interpolated between the last two ticks.
// dt is capped at 50 ms (a hitch drops time instead of spiralling), so 7 ticks always cover a frame. The old cap of 4
// (33.3 ms) was hit by every frame at <=30 fps: the leftover time was thrown away and the interpolation phase reset,
// so the drawn bike jumped back and forth up to ~35 cm per frame and ran slow-motion. Never drop the fraction.
let acc = 0, pms = 0; // everything the renderer/camera reads from S gets interpolated between the last two 120 Hz ticks: a frame sees 1, 2 or 3
// ticks, so a raw value (lean, yaw rate, steering) moves in uneven steps and the camera, parented to the lean, judders in turns
const IK = ['x', 'z', 'psi', 'zH', 'th', 'lean', 'yaw', 'wp', 'delta'], prev = {}, keepS = {}; for (const k of IK) prev[k] = keepS[k] = 0;
function tickRapier(dt) {
  const t0 = performance.now(); acc += dt; let n = 0;
  while (acc >= TICK && n < 7) {
    for (const k of IK) prev[k] = S[k] || 0;
    tickR(); acc -= TICK; n++;
  }
  if (acc >= TICK) acc %= TICK;
  pms += (performance.now() - t0 - pms) * .05;
}
// draw between the last two ticks so 90/120/144 Hz screens don't judder
function interp(on) {
  if (!on || Math.abs(S.x - prev.x) + Math.abs(S.z - prev.z) > 5) return null; const a = acc / TICK, keep = keepS;
  for (const k of IK) { const v = S[k] || 0; keep[k] = v; let d = v - prev[k]; if (k === 'psi') d = Math.atan2(Math.sin(d), Math.cos(d)); S[k] = prev[k] + d * a; } // psi: shortest way round (atan2 resets wrap it)
  return keep;
}

/* ---------- loop ---------- */
let capT = 0, last = performance.now(), lastDraw = 0, fN = 0, fT = 0, crashCam = false;
function loop(t) {
  requestAnimationFrame(loop);
  // FPS cap (Options): a steady 60 looks smoother than a wobbly 95-120 on a 120 Hz screen (every missed vsync is a
  // frame shown twice as long). Skip vsyncs until the cap's interval has passed; 2 ms slack absorbs timer jitter.
  if (cfg.fpsCap && t - capT < 1000 / cfg.fpsCap - 2) return; capT = t;
  jankStart(t); const J0 = performance.now(); let hudUp = false; const dt = Math.min(.05, (t - last) / 1000); last = t; fN++;
  if (t - fT > 1000) { const fps = Math.round(fN * 1000 / (t - fT)); setFps(fps); setPhys('Physics ' + pms.toFixed(2) + ' ms'); autoRes(fps, !ctx.paused && !ctx.GAR && !ctx.OPT); setGfx(renderer.info.render.drawCalls, resScale()); setJank(jankText()); updPerf(API); fN = 0; fT = t; }
  raceTick(dt);
  if (ctx.GAR) { ctx.stand = true; S.thr = TC.rev ? 1 : 0; S.brake = 1; S.steer = 0; S.cl = ctx.spec.type === 'cvt' ? 0 : 1; if (!S.running && TC.rev && !S.issOff) startEngine(); if (RP.ok) tickRapier(dt); garageFrame(); }
  else if (!ctx.paused && !ctx.OPT && !ctx.ride) { ctx.stand = false; if (F.on) footTick(dt); else input(dt); if (RP.ok) tickRapier(dt); missions(dt); water(); } // riding in a friend's sidecar (ride.js): no physics of our own
  // crashed: chase camera so you see the tumble, back to your camera once the bike is up
  if ((S.crashed || ctx.rideFly) && ctx.camMode === 0) { toggleCam(); crashCam = true; } else if (!S.crashed && !ctx.rideFly && crashCam) { crashCam = false; if (ctx.camMode === 1) toggleCam(); }
  const ri = RP.ok && !ctx.GAR && !ctx.paused && !ctx.OPT && !ctx.ride, keep = interp(ri); visuals(dt, t / 1000); if (keep) Object.assign(S, keep); crashVisual(); netFrame(dt, t); rideFrame(dt, t); blobTick(H); updAudio(); if (t - lastDraw > (ctx.camMode === 0 || ctx.GAR ? 100 : 50)) { lastDraw = t; hudUp = drawCluster(ctx.camMode === 0 || ctx.GAR); drawMini(MAP, MAPV); } const D0 = performance.now(); renderer.info.reset(); cull(camera); draw(); const J1 = performance.now(); jankEnd(t, J1 - J0, hudUp, J1 - D0);
}
renderer.info.autoReset = false; updPerf(API); drawCluster(); requestAnimationFrame(loop);
O.setDPR = setDPR; O.live = true;
if (ctx.mpWant) { const w = ctx.mpWant; ctx.mpWant = null; netJoin(w.room, w.name, w.url); } // MULTIPLAYER > JOIN before the game had loaded
O.api = 'Renderer: ' + (GPU ? 'WebGPU' + (GPU_TYPES ? ' · GPU culling' : '') : 'WebGL 2' + (cfg.forceGL ? ' (forced in options)' : FELL ? ' (WebGPU failed on this device, fell back)' : ' (this browser has no WebGPU)'));
window.__cpm = { F, getOff, getOn, renderer, scene, camera, S, cfg, ctx, B, spec: () => ctx.spec, step, shift: d => actions.shift(d), reset, recompute, setBike: id => { cfg.bike = id; setBike(); }, H, toggleCam, startEngine, RP, tickRapier, tickR, syncBody, bounce, NET };
