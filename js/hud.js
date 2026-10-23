// On-screen messages, the gauge cluster (HUD and the in-world LCD share one canvas), minimap, perf readout
import * as THREE from 'three';
import { $, PI } from './util.js';
import { S, ctx } from './state.js';
import { cfg } from './config.js';

export function say(t, ms = 1600) { const m = $('msg'); m.textContent = t; m.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove('on'), ms); }

const gaugeCv = $('gauge'), gc = gaugeCv.getContext('2d');
export const cluTex = new THREE.CanvasTexture(gaugeCv); cluTex.colorSpace = THREE.SRGBColorSpace;
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

/* sport: Raider-style sweeping LED tach, big digital speed, gear indicator */
function pathPt(t) { if (t < .72) return { x: 28 + t / .72 * 332, y: 58, a: 0 }; const u = (t - .72) / .28 * PI / 2; return { x: 360 + 82 * Math.sin(u), y: 140 - 82 * Math.cos(u), a: u }; }
function sport(g, sp) {
  const MAX = sp.tachMax, rpm = S.running ? S.rpm : 0;
  g.fillStyle = '#0a0f12'; rr(g, 4, 4, 504, 216, 26); g.fill(); g.strokeStyle = '#2b3740'; g.lineWidth = 4; g.stroke();
  for (let i = 0; i < 48; i++) {
    const t = i / 47, p = pathPt(t), r0 = t * MAX;
    g.fillStyle = rpm >= r0 && rpm > 0 ? (r0 >= sp.red ? '#ff3b2f' : r0 >= sp.red - 2000 ? '#ffb020' : '#7cf2ff') : (r0 >= sp.red ? '#3a1512' : '#18232a');
    g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillRect(-3, 0, 6, 26); g.restore();
  }
  g.fillStyle = '#7d8b95'; g.font = 'bold 17px system-ui'; g.textAlign = 'center';
  for (let k = 0; k <= MAX / 1000; k += 2) { const p = pathPt(k * 1000 / MAX); g.fillText(k, p.x + Math.sin(p.a) * 14, p.y - Math.cos(p.a) * 14 - 3); }
  g.fillText('x1000 r/min', 90, 112);
  g.fillStyle = '#e9fbff'; g.font = 'bold 96px ui-monospace,Menlo,monospace'; g.textAlign = 'right'; g.fillText(Math.round(Math.abs(S.v) * 3.6), 250, 200);
  g.font = 'bold 22px system-ui'; g.textAlign = 'left'; g.fillStyle = '#9fb3bf'; g.fillText('km/h', 256, 200);
  g.textAlign = 'center'; g.font = 'bold 74px system-ui'; g.fillStyle = S.gear ? '#ffb020' : '#43e07a'; g.fillText(S.gear || 'N', 466, 206);
  const fr = S.fuel / sp.fuel.cap;
  for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff4a3d' : '#e9fbff') : '#18232a'; g.fillRect(324 + i * 17, 168, 13, 24); }
  g.fillStyle = '#9fb3bf'; g.font = 'bold 16px system-ui'; g.fillText('GAS', 375, 210); g.fillText('E', 314, 186); g.fillText('F', 434, 186);
  g.textAlign = 'left'; g.font = 'bold 18px system-ui';
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 28, 140); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('SHIFT', 28, 140); }
  if (S.cl > .05) { g.fillStyle = '#ffb020'; g.fillText('CLUTCH ' + (S.cl * 100 | 0) + '%', 140, 140); }
}

/* scooter: Click-style negative LCD. No tach: speed, fuel, clock, odometer, ECO and IDLING STOP lamps */
function scooter(g, sp) {
  g.fillStyle = '#05080a'; rr(g, 4, 4, 504, 216, 60); g.fill(); g.strokeStyle = '#2b3138'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#0b1a22'; rr(g, 24, 22, 464, 180, 44); g.fill();
  const lit = '#bfefff', dim = '#13303b', now = new Date();
  g.textAlign = 'left'; g.font = 'bold 26px ui-monospace,Menlo,monospace'; g.fillStyle = lit;
  g.fillText(String(now.getHours()).padStart(2, '0') + ((now.getSeconds() & 1) ? ':' : ' ') + String(now.getMinutes()).padStart(2, '0'), 52, 62);
  // big 7-seg style speed
  g.textAlign = 'right'; g.font = 'bold 112px ui-monospace,Menlo,monospace'; g.fillStyle = dim; g.fillText('188', 352, 160);
  g.fillStyle = lit; g.fillText(Math.round(Math.abs(S.v) * 3.6), 352, 160);
  g.textAlign = 'left'; g.font = 'bold 22px system-ui'; g.fillStyle = '#7fb2c4'; g.fillText('km/h', 358, 160);
  // fuel: 6 segments, vertical on the right
  const fr = S.fuel / sp.fuel.cap;
  for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff4a3d' : lit) : dim; g.fillRect(430, 166 - i * 21, 34, 15); }
  g.fillStyle = '#7fb2c4'; g.font = 'bold 15px system-ui'; g.textAlign = 'center'; g.fillText('F', 447, 55); g.fillText('E', 447, 197);
  // odometer
  g.textAlign = 'left'; g.font = 'bold 20px ui-monospace,Menlo,monospace'; g.fillStyle = lit; g.fillText('ODO ' + (S.odo / 1000).toFixed(1).padStart(7, '0') + ' km', 52, 190);
  // lamps
  const eco = S.running && Math.abs(S.v) > 2 && S.thrEff < .35;
  g.font = 'bold 18px system-ui'; g.fillStyle = eco ? '#43e07a' : dim; g.fillText('ECO', 200, 62);
  const iss = ctx.bcfg.iss, blink = (performance.now() / 400 | 0) % 2;
  g.fillStyle = S.issOff ? (blink ? '#ffb020' : dim) : iss ? '#3d6b7a' : dim; g.fillText('IDLING STOP', 262, 62);
  if (!S.running && !S.issOff) { g.fillStyle = '#ff4a3d'; g.font = 'bold 18px system-ui'; g.fillText('ENGINE OFF', 52, 100); }
  if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.font = 'bold 18px system-ui'; g.fillText('PGM-FI', 52, 100); }
}
const CLUSTERS = { sport, scooter };
// Redrawn only when something on it changes; the texture is uploaded to the GPU only while the in-world cluster can
// be seen (1st person / garage). In 3rd person the same canvas is shown as the on-screen HUD, no upload needed.
let cluKey = '', texDirty = true;
export function drawCluster(inWorld = true) {
  const sp = ctx.spec, bl = (performance.now() / 90 | 0) % 2, now = new Date();
  const key = [ctx.bike.id, Math.round(Math.abs(S.v) * 3.6), S.gear, S.running ? Math.ceil(S.rpm / sp.tachMax * 47) : -1, (S.fuel / sp.fuel.cap * 100 | 0), S.lim && bl, S.cl > .05 ? S.cl * 100 | 0 : -1,
    ctx.bike.cluster === 'scooter' ? [now.getMinutes(), now.getSeconds() & 1, (S.odo / 100) | 0, S.running && Math.abs(S.v) > 2 && S.thrEff < .35, S.issOff && (performance.now() / 400 | 0) % 2, ctx.bcfg.iss, S.issOff].join() : ''].join('|');
  if (key !== cluKey) { cluKey = key; gc.clearRect(0, 0, 512, 224); CLUSTERS[ctx.bike.cluster](gc, sp); texDirty = true; }
  if (inWorld && texDirty) { cluTex.needsUpdate = true; texDirty = false; }
}

/* minimap */
const mm = $('mini').getContext('2d'); let miniKey = '';
export function drawMini(MAP, ICZ) {
  const MI0 = ctx.MI, k = (S.x * 2 | 0) + ',' + (S.z * 2 | 0) + ',' + (S.psi * 100 | 0) + ',' + (MI0 && MI0.on && !MI0.done ? MI0.bay.x + ':' + MI0.bay.z : '');
  if (k === miniKey) return; miniKey = k;
  mm.clearRect(0, 0, 140, 140); mm.save(); mm.beginPath(); mm.arc(70, 70, 68, 0, 7); mm.clip();
  const u = (S.x / 1300 + .5) * 140, v = ((S.z - ICZ) / 1300 + .5) * 140, Z = 2.6;
  mm.translate(70, 70); mm.rotate(S.psi); mm.scale(Z, Z); mm.translate(-u, -v); mm.drawImage(MAP, 0, 0);
  const dot = (x, z, c, r) => { mm.fillStyle = c; mm.beginPath(); mm.arc((x / 1300 + .5) * 140, ((z - ICZ) / 1300 + .5) * 140, r / Z, 0, 7); mm.fill(); };
  dot(-40, 40, '#ff4a3d', 4); const MI = ctx.MI; if (MI && MI.on && !MI.done) dot(MI.bay.x, MI.bay.z, '#43e07a', 4); mm.restore();
  mm.fillStyle = '#ffb020'; mm.beginPath(); mm.moveTo(70, 62); mm.lineTo(76, 76); mm.lineTo(70, 72); mm.lineTo(64, 76); mm.fill();
  mm.strokeStyle = 'rgba(255,255,255,.5)'; mm.lineWidth = 2; mm.beginPath(); mm.arc(70, 70, 68, 0, 7); mm.stroke();
}

/* FPS / renderer readout */
let fpsV = 0, physV = '', gfxV = ''; export const setFps = v => { fpsV = v; }; export const setPhys = v => { physV = v; };
export const setGfx = (draws, res) => { gfxV = draws + ' draws' + (res < 1 ? ' · res ' + Math.round(res * 100) + '%' : ''); };
export function updPerf(API) { const p = []; if (cfg.showApi) p.push(API); if (cfg.showFps) p.push(fpsV + ' fps'); if (cfg.showFps && physV) p.push(physV); if (cfg.showFps && gfxV) p.push(gfxV); $('perf').textContent = p.join(' · '); $('perf').hidden = !p.length; }
