// Entry point: load bike data, wire modules together, run the loop.
import * as THREE from 'three';
import { $, clamp } from './util.js';
import { cfg, save, bikeCfg } from './config.js';
import { S, ctx } from './state.js';
import { renderer, scene, camera, sun, GPU, API, FELL } from './renderer.js';
import { SEA, ICZ, H, roadH, MAP } from './world.js';
import { computeSpec } from './spec.js';
import { DRIVES } from './drivetrain.js';
import { B, buildModel, applyLook } from './model.js';
import { step, collide } from './physics.js';
import { initAudio, updAudio, blip } from './audio.js';
import { say, drawCluster, drawMini, updPerf, setFps, setPhys } from './hud.js';
import { RP, TICK, initRapier, collideR } from './rapier.js';
import { actions, input, ptr, TC, WMAX } from './controls.js';
import { MI, togglePark, missions, animMarker } from './missions.js';
import { G as GARAGE, buildGarage } from './garage.js';
import { O, openOpts, closeOpts } from './options.js';

/* ---------- data ---------- */
const ids = await (await fetch('data/bikes/index.json')).json();
for (const d of await Promise.all(ids.map(id => fetch(`data/bikes/${id}.json`).then(r => r.json())))) ctx.bikes[d.id] = d;

const SPAWN = { x: 62, z: 30, psi: Math.PI / 2 };
function reset() {
  Object.assign(S, {
    x: SPAWN.x, z: SPAWN.z, psi: SPAWN.psi, v: 0, rpm: ctx.spec.idle, running: true, gear: 0, cl: 0, thr: 0, thrEff: 0, brake: 0, steer: 0, delta: 0, lean: 0, yaw: 0, zH: 0, zV: 0, th: 0, thV: 0, cF: 0, cR: 0, hF: 0, hR: 0, a: 0, c: 0,
    fuel: S.fuel ?? ctx.spec.fuel.cap, wA: 0, cutT: 0, act: 0, shCD: 0, lim: false, padT: 0, hits: S.hits || 0, odo: S.odo || 0,
  });
  ctx.drive.reset(S); S.hF = roadH(S.x, S.z); S.hR = S.hF;
}
function recompute() { ctx.spec = computeSpec(ctx.bike, ctx.bcfg); applyLook(ctx.spec); }
function setBike() {
  const bike = ctx.bikes[cfg.bike] || ctx.bikes[ids[0]]; cfg.bike = bike.id;
  ctx.bike = bike; ctx.bcfg = bikeCfg(bike); ctx.drive = DRIVES[bike.drivetrain];
  buildModel(bike); recompute();
  document.body.classList.toggle('cvt', bike.drivetrain === 'cvt');
  S.fuel = ctx.spec.fuel.cap; const keep = ctx.GAR ? { x: S.x, z: S.z, psi: S.psi } : null; reset(); if (keep) Object.assign(S, keep);
  if (!ctx.GAR && ctx.camMode === 0) { B.cam.add(camera); camera.position.set(0, 0, 0); camera.rotation.set(-.3, 0, 0); }
  B.rider.forEach(m => m.visible = !ctx.GAR && ctx.camMode === 1);
  $('brk').textContent = bike.drivetrain === 'cvt' ? 'BRAKE · CBS' : 'BRAKE';
}
setBike(); save();

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
function visuals(dt, now) {
  const G = B.G, sp = ctx.spec;
  B.root.position.set(S.x, S.zH, S.z); B.root.rotation.y = S.psi; B.lean.rotation.z = -S.lean; B.body.position.y = .6 + (.075 - sp.sag); // lean pivots at the ground, not world y=0 B.body.rotation.x = S.th;
  B.steer.rotation.y = -S.delta; B.slider.position.y = -G.fork + clamp(S.cF, -.07, .11) / Math.cos(G.rake); B.rearH.position.y = G.rw + clamp(S.cR, -.07, .11);
  const dy = B.rearH.position.y - G.pivotY, dz = G.rearZ - G.pivotZ; B.swing.position.set(G.swingX, G.pivotY + dy / 2, G.pivotZ + dz / 2); B.swing.rotation.x = -Math.atan2(dy, dz); B.swing.scale.z = Math.hypot(dy, dz);
  B.frontW.rotation.x = B.rearW.rotation.x = -S.wA; B.thrG.rotation.x = S.thr * 1.2; B.brkL.rotation.y = -S.brake * .3;
  B.cluL.rotation.y = (sp.type === 'cvt' ? S.brake : Math.max(S.cl, ctx.bcfg.autoClutch && S.c < .5 ? 1 : 0)) * .3;
  const av = Math.abs(S.v); camera.fov = 72 + Math.min(14, av * .35); camera.updateProjectionMatrix();
  if (ctx.GAR) { const a = now * .35, R = 3.1; tmp.set(S.x + Math.cos(a) * R, 1.25 + S.zH, S.z + Math.sin(a) * R); camera.position.copy(tmp); camera.lookAt(S.x + Math.sin(a) * 1.3, .65 + S.zH, S.z - Math.cos(a) * 1.3); }
  else if (ctx.camMode === 0) {
    B.cam.rotation.set(-S.th * .4, clamp(S.yaw * .12, -.25, .25), S.lean * .35);
    const vib = S.running ? .0007 * (.4 + S.rpm / 9000) : 0, ph = now * S.rpm / 60 * 2 * Math.PI; camera.position.set(Math.sin(ph * .5) * vib, Math.sin(ph) * vib, 0);
  } else {
    const bx = Math.sin(S.psi), bz = Math.cos(S.psi); tmp.set(S.x + bx * 4.2, 1.9 + S.zH, S.z + bz * 4.2); camera.position.lerp(tmp, 1 - Math.exp(-dt * 5)); camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + .6);
    camera.lookAt(S.x - bx * 2, 1 + S.zH, S.z - bz * 2);
  }
  sun.position.set(S.x + 30, S.zH + 60, S.z + 20); sun.target.position.set(S.x, 0, S.z);
  $('wg').setAttribute('transform', 'rotate(' + (S.steer * WMAX() * 57.3).toFixed(1) + ')'); $('cluFill').style.height = (S.cl * 100).toFixed(0) + '%'; $('thrg').style.backgroundPositionY = (S.thr * 36).toFixed(1) + 'px';
  animMarker(now);
}

/* ---------- garage ---------- */
GARAGE.onChange = recompute;
GARAGE.onBike = () => { setBike(); say(ctx.bike.name, 1200); };
function openGarage() { if (ctx.GAR || ctx.OPT) return; buildGarage(); $('garage').hidden = false; ctx.GAR = true; document.body.classList.add('gar'); scene.add(camera); B.rider.forEach(m => m.visible = false); }
$('gClose').onclick = () => { $('garage').hidden = true; ctx.GAR = false; TC.rev = 0; document.body.classList.remove('gar'); ctx.camMode ^= 1; toggleCam(); };
ptr($('revB'), () => { TC.rev = 1; $('revB').classList.add('on'); }, null, () => { TC.rev = 0; $('revB').classList.remove('on'); });
$('bounceB').onclick = () => { S.zV = -.9; S.thV = .6; };

/* ---------- wiring ---------- */
Object.assign(actions, {
  shift: d => ctx.drive.shift(ctx.spec, S, d), start: startEngine, cam: toggleCam, garage: openGarage, park: togglePark,
  opts: () => ctx.OPT ? closeOpts() : openOpts(), closeOpts,
});
O.onPerf = () => updPerf(API);
$('bGar').onclick = openGarage; $('bCam').onclick = toggleCam; $('bPark').onclick = togglePark; $('bReset').onclick = () => { reset(); say('Back at the lot'); };
function goFS() { const d = document.documentElement; if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { })).catch(() => { }); }
addEventListener('pointerdown', () => { if (!ctx.paused && !ctx.GAR && !ctx.OPT) goFS(); });
$('go').onclick = () => { goFS(); initAudio(); $('intro').hidden = true; ctx.paused = false; say(ctx.bike.hint); };

function water() { if (S.wet) { S.v *= .9; return; } if (H(S.x, S.z) < SEA + .12) { S.wet = true; say('Splash! You rode into the water', 1600); blip('thud', 9); setTimeout(() => { reset(); S.wet = false; say('Towed back to the lot'); }, 1600); } }

/* ---------- physics backend ---------- */
// Rapier: fixed 120 Hz ticks (3 bike substeps each, then Rapier clips the move), at most 4 ticks per frame so a slow
// frame drops time instead of spiralling. Classic: the old variable-step loop, kept for comparison until phase 5.
function applyPhys() {
  if (!cfg.rapier) { RP.on = false; setPhys(''); return; }
  initRapier().then(ok => { RP.on = ok && cfg.rapier; if (!ok) say('Rapier failed to load, using Classic physics', 2500); setPhys(''); });
}
O.onPhys = applyPhys; applyPhys();
let acc = 0, pms = 0; const prev = { x: 0, z: 0, psi: 0 };
function tickRapier(dt) {
  const t0 = performance.now(); acc += dt; let n = 0;
  while (acc >= TICK && n < 4) {
    prev.x = S.x; prev.z = S.z; prev.psi = S.psi;
    for (let i = 0; i < 3; i++) step(TICK / 3); collideR(prev.x, prev.z); acc -= TICK; n++;
  }
  if (acc >= TICK) acc = 0;
  pms += (performance.now() - t0 - pms) * .05;
}
// draw between the last two ticks so 90/120/144 Hz screens don't judder
function interp(on) {
  if (!on || Math.abs(S.x - prev.x) + Math.abs(S.z - prev.z) > 5) return null; const a = acc / TICK, keep = { x: S.x, z: S.z, psi: S.psi };
  S.x = prev.x + (S.x - prev.x) * a; S.z = prev.z + (S.z - prev.z) * a; S.psi = prev.psi + (S.psi - prev.psi) * a; return keep;
}

/* ---------- loop ---------- */
let last = performance.now(), lastDraw = 0, fN = 0, fT = 0;
function loop(t) {
  requestAnimationFrame(loop); const dt = Math.min(.05, (t - last) / 1000); last = t; fN++;
  if (t - fT > 1000) { setFps(Math.round(fN * 1000 / (t - fT))); setPhys(RP.on ? 'Rapier ' + pms.toFixed(2) + ' ms' : 'Classic'); updPerf(API); fN = 0; fT = t; }
  if (ctx.GAR) { ctx.stand = true; S.thr = TC.rev ? 1 : 0; S.brake = 1; S.steer = 0; S.cl = ctx.spec.type === 'cvt' ? 0 : 1; if (!S.running && TC.rev && !S.issOff) startEngine(); for (let i = 0; i < 6; i++) step(dt / 6); }
  else if (!ctx.paused && !ctx.OPT) { ctx.stand = false; input(dt); if (RP.on) tickRapier(dt); else { const n = 6; for (let i = 0; i < n; i++) step(dt / n); collide(); } missions(dt); water(); }
  const ri = RP.on && !ctx.GAR && !ctx.paused && !ctx.OPT, keep = interp(ri); visuals(dt, t / 1000); if (keep) Object.assign(S, keep); updAudio(); if (t - lastDraw > 50) { lastDraw = t; drawCluster(); drawMini(MAP, ICZ); } renderer.render(scene, camera);
}
updPerf(API); drawCluster(); requestAnimationFrame(loop);
$('apiNote').textContent = 'Renderer: ' + (GPU ? 'WebGPU' : 'WebGL 2' + (cfg.forceGL ? ' (forced in options)' : FELL ? ' (WebGPU failed on this device, fell back)' : ' (this browser has no WebGPU)'));
window.__cpm = { S, cfg, ctx, spec: () => ctx.spec, step, shift: d => actions.shift(d), reset, recompute, setBike: id => { cfg.bike = id; setBike(); }, H, toggleCam, startEngine, RP, tickRapier, collideR };
