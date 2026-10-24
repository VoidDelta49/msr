// Entry point: load bike data, wire modules together, run the loop.
import * as THREE from 'three';
import { $, clamp } from './util.js';
import { cfg, save, bikeCfg, BUILD } from './config.js';
import { S, ctx } from './state.js';
import { renderer, scene, camera, sun, GPU, API, FELL, draw, warm, setDPR } from './renderer.js';
import { SEA, ICZ, H, roadH, MAP, MAPV, zones, nearRoad } from './world.js';
ctx.zones = zones; ctx.nearRoad = nearRoad; // audio.js reads these (no import, keeps module order)
import { computeSpec } from './spec.js';
import { DRIVES } from './drivetrain.js';
import { B, buildModel, applyLook, snapshot, releaseSkin } from './model.js';
import { step } from './physics.js';
import { initAudio, updAudio, blip } from './audio.js';
import { say, drawCluster, drawMini, updPerf, setFps, setPhys, setGfx, setJank } from './hud.js';
import { RP, TICK, initRapier, tickR, syncBody, crashVisual, bounce } from './rapier.js';
import { actions, input, ptr, TC, WMAX } from './controls.js';
import { missions, animMarker } from './missions.js';
import { G as GARAGE, buildGarage } from './garage.js';
import { O, openOpts, closeOpts } from './options.js';
import { cullUpdate, autoRes, resScale, jankStart, jankEnd, jankText } from './perf.js';
import { gpuCull } from './gpucull.js';
import { NET, netFrame, join as netJoin, leave as netLeave } from './net.js';
import { raceTick } from './race.js';
import { GPU_TYPES } from './world.js';

/* ---------- data ---------- */
// loaded by menu.js on PLAY; stage() moves its loading bar (fractions continue after the download's 0–70%)
const stage = window.__cpmLoad || (() => { });
stage('Loading bikes', .78);
const ids = await (await fetch('data/bikes/index.json?v=' + BUILD)).json();
for (const d of await Promise.all(ids.map(id => fetch(`data/bikes/${id}.json?v=${BUILD}`).then(r => r.json())))) ctx.bikes[d.id] = d;

const SPAWN = { x: 62, z: 30, psi: Math.PI / 2 };
function reset() {
  Object.assign(S, {
    x: SPAWN.x, z: SPAWN.z, psi: SPAWN.psi, v: 0, rpm: ctx.spec.idle, running: true, gear: 0, cl: 0, thr: 0, thrEff: 0, brake: 0, steer: 0, delta: 0, lean: 0, yaw: 0, zH: 0, zV: 0, th: 0, thV: 0, cF: 0, cR: 0, hF: 0, hR: 0, a: 0, c: 0,
    fuel: S.fuel ?? ctx.spec.fuel.cap, wA: 0, cutT: 0, act: 0, shCD: 0, lim: false, padT: 0, hits: S.hits || 0, odo: S.odo || 0,
  });
  ctx.drive.reset(S); S.hF = roadH(S.x, S.z); S.hR = S.hF; S.zH = S.hF + (ctx.spec.yf + ctx.spec.yr + ctx.spec.pf + ctx.spec.pr) / 2; syncBody();
}
function recompute() { ctx.spec = computeSpec(ctx.bike, ctx.bcfg); applyLook(ctx.spec); }
// put the camera / rider visibility back on a freshly built local model
function attachCam() { if (!ctx.GAR && ctx.camMode === 0) { B.cam.add(camera); camera.position.set(0, 0, 0); camera.rotation.set(-.3, 0, 0); } B.rider.forEach(m => m.visible = !ctx.GAR && ctx.camMode === 1); }
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
  buildModel(bike); applyLook(spec); const t = snapshot(); releaseSkin(); buildModel(ctx.bike); recompute(); attachCam();
  TPL.set(key, t); return t;
};
function setBike(keepPos) {
  const bike = ctx.bikes[cfg.bike] || ctx.bikes[ids[0]]; cfg.bike = bike.id;
  ctx.bike = bike; ctx.bcfg = bikeCfg(bike); ctx.drive = DRIVES[bike.drivetrain];
  buildModel(bike); recompute();
  document.body.classList.toggle('cvt', bike.drivetrain === 'cvt');
  S.fuel = ctx.spec.fuel.cap; const keep = ctx.GAR || keepPos ? { x: S.x, z: S.z, psi: S.psi } : null; reset(); if (keep) Object.assign(S, keep);
  attachCam();
  $('brk').textContent = bike.drivetrain === 'cvt' ? 'BRAKE · CBS' : 'BRAKE';
}
// physics engine first: everything below positions the Rapier body
stage('Starting physics', .8);
if (!await initRapier()) throw new Error("Couldn't load the physics engine (" + RP.err + '). Check your connection and try again.');
stage('Preparing the bike', .85); setBike(); save();
// build every shader now, behind the title screen (see renderer.js warm())
stage('Compiling shaders', .9); gpuCull(camera); ctx.warmMs = await warm(); stage('Ready', 1);

function startEngine() {
  if (S.running) return; if (S.fuel <= 0) return say('Out of fuel. Push it to the gas station.');
  const why = ctx.drive.canStart(ctx.spec, S, ctx.bcfg); if (why) return say(why);
  S.running = true; S.issOff = false; S.rpm = Math.max(S.rpm, 1700); blip('start'); say('Engine on');
}

/* ---------- camera / animation ---------- */
function toggleCam() {
  ctx.camMode ^= 1; document.body.classList.toggle('cam3', ctx.camMode === 1);
  if (ctx.camMode === 0) { B.cam.add(camera); camera.position.set(0, 0, 0); camera.rotation.set(-.3, 0, 0); } else scene.add(camera);
  B.rider.forEach(m => m.visible = ctx.camMode === 1); $('bCam').textContent = ctx.camMode ? 'CAM: 3RD' : 'CAM: 1ST';
}
ctx.camMode = 1; toggleCam();
const tmp = new THREE.Vector3();
// touch-control visuals: skip the DOM write (and the style recalc it triggers) when nothing changed
const DOMC = {}; function dom(id, v, set) { const c = DOMC[id] || (DOMC[id] = { e: $(id), v: null }); if (c.v !== v) { c.v = v; set(c.e, v); } }
function visuals(dt, now) {
  const G = B.G, sp = ctx.spec;
  B.root.position.set(S.x, S.zH, S.z); B.root.rotation.set(0, S.psi, 0); B.lean.rotation.z = -S.lean; B.body.position.y = .6 + (.075 - sp.sag); B.body.rotation.x = S.th; // lean pivots at the ground, not world y=0
  B.steer.rotation.y = -S.delta; B.slider.position.y = -G.fork + (clamp(S.cF, -.07, .11) - sp.yf) / Math.cos(G.rake); B.rearH.position.y = G.rw + clamp(S.cR, -.07, .11) - sp.yr; // yf/yr: ride height lifts the chassis, wheels stay down
  const dy = B.rearH.position.y - G.pivotY, dz = G.rearZ - G.pivotZ; B.swing.position.set(G.swingX, G.pivotY + dy / 2, G.pivotZ + dz / 2); B.swing.rotation.x = -Math.atan2(dy, dz); B.swing.scale.z = Math.hypot(dy, dz);
  B.frontW.rotation.x = B.rearW.rotation.x = -S.wA; B.thrG.rotation.x = S.thr * 1.2; B.brkL.rotation.y = -S.brake * .3;
  B.cluL.rotation.y = (sp.type === 'cvt' ? S.brake : Math.max(S.cl, ctx.bcfg.autoClutch && S.c < .5 ? 1 : 0)) * .3;
  const av = Math.abs(S.v), fov = 72 + Math.min(14, av * .35); if (Math.abs(fov - camera.fov) > .01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (ctx.GAR) { const a = now * .35, R = 3.1; tmp.set(S.x + Math.cos(a) * R, 1.25 + S.zH, S.z + Math.sin(a) * R); camera.position.copy(tmp); camera.lookAt(S.x + Math.sin(a) * 1.3, .65 + S.zH, S.z - Math.cos(a) * 1.3); }
  else if (ctx.camMode === 0) {
    B.cam.rotation.set(-S.th * .4, clamp(S.yaw * .12, -.25, .25), S.lean * .35);
    const vib = S.running ? .0007 * (.4 + S.rpm / 9000) : 0, ph = now * S.rpm / 60 * 2 * Math.PI; camera.position.set(Math.sin(ph * .5) * vib, Math.sin(ph) * vib, 0);
  } else {
    const bx = Math.sin(S.psi), bz = Math.cos(S.psi); tmp.set(S.x + bx * 4.2, 1.9 + S.zH, S.z + bz * 4.2); camera.position.lerp(tmp, 1 - Math.exp(-dt * 5)); camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + .6);
    camera.lookAt(S.x - bx * 2, 1 + S.zH, S.z - bz * 2);
  }
  sun.position.set(S.x + 30, S.zH + 60, S.z + 20); sun.target.position.set(S.x, 0, S.z);
  dom('wg', 'rotate(' + (S.steer * WMAX() * 57.3).toFixed(1) + ')', (e, v) => e.setAttribute('transform', v)); dom('cluFill', (S.cl * 100).toFixed(0) + '%', (e, v) => e.style.height = v); dom('thrg', (S.thr * 36).toFixed(1) + 'px', (e, v) => e.style.backgroundPositionY = v);
  animMarker(now);
}

/* ---------- garage ---------- */
GARAGE.onChange = recompute;
GARAGE.onBike = () => { setBike(); say(ctx.bike.name, 1200); };
function openGarage() { if (ctx.GAR || ctx.OPT) return; buildGarage(); $('garage').hidden = false; ctx.GAR = true; document.body.classList.add('gar'); scene.add(camera); B.rider.forEach(m => m.visible = false); }
$('gClose').onclick = () => { $('garage').hidden = true; ctx.GAR = false; TC.rev = 0; document.body.classList.remove('gar'); ctx.camMode ^= 1; toggleCam(); syncBody(); };
ptr($('revB'), () => { TC.rev = 1; $('revB').classList.add('on'); }, null, () => { TC.rev = 0; $('revB').classList.remove('on'); });
$('bounceB').onclick = () => { if (RP.ok) bounce(); };

/* ---------- wiring ---------- */
Object.assign(actions, {
  shift: d => ctx.drive.shift(ctx.spec, S, d, ctx.bcfg), start: startEngine, cam: toggleCam, garage: openGarage,
  opts: () => ctx.OPT ? closeOpts() : openOpts(), closeOpts,
});
O.onPerf = () => updPerf(API);
$('bGar').onclick = openGarage; $('bCam').onclick = toggleCam; $('bReset').onclick = () => { reset(); say('Back at the lot'); };
function goFS() { const d = document.documentElement; if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { })).catch(() => { }); }
addEventListener('pointerdown', () => { if (!ctx.paused && !ctx.GAR && !ctx.OPT) goFS(); });
// menu.js: PLAY / RESUME (fullscreen was requested there, inside the tap) and the menu's bike picker
let played = false;
export function play() { initAudio(); ctx.paused = false; if (!played) { played = true; say(ctx.bike.hint); } }
export function mpJoin(room, name, url) { netJoin(room, name, url); }
export function mpLeave() { netLeave(); }
// quests with a required bike (missions.js): swap right where you stand
ctx.switchBikeHere = id => {
  cfg.bike = id; setBike(true); S.hF = S.hR = roadH(S.x, S.z); S.zH = H(S.x, S.z) + (ctx.spec.yf + ctx.spec.yr + ctx.spec.pf + ctx.spec.pr) / 2; syncBody(); save(); say(ctx.bike.name, 1500);
};
export function switchBike(id) { cfg.bike = id; setBike(); save(); say(ctx.bike.name, 1200); }

function water() { if (S.wet) { S.v *= .9; return; } if (H(S.x, S.z) < SEA + .12) { S.wet = true; say('Splash! You rode into the water', 1600); blip('thud', 9); setTimeout(() => { reset(); S.wet = false; say('Towed back to the lot'); }, 1600); } }

/* ---------- physics ---------- */
// Rapier at a fixed 120 Hz (3 bike-solver substeps per tick), drawn interpolated between the last two ticks.
// dt is capped at 50 ms (a hitch drops time instead of spiralling), so 7 ticks always cover a frame. The old cap of 4
// (33.3 ms) was hit by every frame at <=30 fps: the leftover time was thrown away and the interpolation phase reset,
// so the drawn bike jumped back and forth up to ~35 cm per frame and ran slow-motion. Never drop the fraction.
let acc = 0, pms = 0; const prev = { x: 0, z: 0, psi: 0, zH: 0, th: 0 }, keepS = { x: 0, z: 0, psi: 0, zH: 0, th: 0 };
function tickRapier(dt) {
  const t0 = performance.now(); acc += dt; let n = 0;
  while (acc >= TICK && n < 7) {
    prev.x = S.x; prev.z = S.z; prev.psi = S.psi; prev.zH = S.zH; prev.th = S.th;
    tickR(); acc -= TICK; n++;
  }
  if (acc >= TICK) acc %= TICK;
  pms += (performance.now() - t0 - pms) * .05;
}
// draw between the last two ticks so 90/120/144 Hz screens don't judder
function interp(on) {
  if (!on || Math.abs(S.x - prev.x) + Math.abs(S.z - prev.z) > 5) return null; const a = acc / TICK, keep = keepS; keep.x = S.x; keep.z = S.z; keep.psi = S.psi; keep.zH = S.zH; keep.th = S.th;
  S.x = prev.x + (S.x - prev.x) * a; S.z = prev.z + (S.z - prev.z) * a; S.psi = prev.psi + (S.psi - prev.psi) * a; S.zH = prev.zH + (S.zH - prev.zH) * a; S.th = prev.th + (S.th - prev.th) * a; return keep;
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
  if (ctx.GAR) { ctx.stand = true; S.thr = TC.rev ? 1 : 0; S.brake = 1; S.steer = 0; S.cl = ctx.spec.type === 'cvt' ? 0 : 1; if (!S.running && TC.rev && !S.issOff) startEngine(); if (RP.ok) tickRapier(dt); }
  else if (!ctx.paused && !ctx.OPT) { ctx.stand = false; input(dt); if (RP.ok) tickRapier(dt); missions(dt); water(); }
  // crashed: chase camera so you see the tumble, back to your camera once the bike is up
  if (S.crashed && ctx.camMode === 0) { toggleCam(); crashCam = true; } else if (!S.crashed && crashCam) { crashCam = false; if (ctx.camMode === 1) toggleCam(); }
  const ri = RP.ok && !ctx.GAR && !ctx.paused && !ctx.OPT, keep = interp(ri); visuals(dt, t / 1000); if (keep) Object.assign(S, keep); crashVisual(); netFrame(dt, t); updAudio(); if (t - lastDraw > (ctx.camMode === 0 || ctx.GAR ? 100 : 50)) { lastDraw = t; hudUp = drawCluster(ctx.camMode === 0 || ctx.GAR); drawMini(MAP, MAPV); } cullUpdate(camera); renderer.info.reset(); gpuCull(camera); draw(); jankEnd(t, performance.now() - J0, hudUp);
}
renderer.info.autoReset = false; updPerf(API); drawCluster(); requestAnimationFrame(loop);
O.setDPR = setDPR; O.live = true;
if (ctx.mpWant) { const w = ctx.mpWant; ctx.mpWant = null; netJoin(w.room, w.name, w.url); } // MULTIPLAYER > JOIN before the game had loaded
O.api = 'Renderer: ' + (GPU ? 'WebGPU' + (GPU_TYPES ? ' · GPU culling' : '') : 'WebGL 2' + (cfg.forceGL ? ' (forced in options)' : FELL ? ' (WebGPU failed on this device, fell back)' : ' (this browser has no WebGPU)'));
window.__cpm = { renderer, scene, camera, S, cfg, ctx, B, spec: () => ctx.spec, step, shift: d => actions.shift(d), reset, recompute, setBike: id => { cfg.bike = id; setBike(); }, H, toggleCam, startEngine, RP, tickRapier, tickR, syncBody, bounce, NET };
