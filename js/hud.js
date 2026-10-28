// On-screen messages, the gauge cluster (HUD and the in-world LCD share one canvas), minimap, perf readout
import { dispRpm } from './ignition.js';
import * as THREE from 'three';
import { $, PI } from './util.js';
import { S, ctx } from './state.js';
import { cfg, phClock as phNow } from './config.js';
import { at } from './foot.js';

export function say(t, ms = 1600) { const m = $('msg'); m.textContent = t; m.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove('on'), ms); }

const gaugeCv = $('gauge'), gc = gaugeCv.getContext('2d');
export const cluTex = new THREE.CanvasTexture(gaugeCv); cluTex.colorSpace = THREE.SRGBColorSpace;
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

/* sport: Raider-style sweeping LED tach, big digital speed, gear indicator */
const PP = { x: 0, y: 0, a: 0 }; // reused: 48+ calls per redraw
function pathPt(t) { if (t < .72) { PP.x = 28 + t / .72 * 332; PP.y = 58; PP.a = 0; return PP; } const u = (t - .72) / .28 * PI / 2; PP.x = 360 + 82 * Math.sin(u); PP.y = 140 - 82 * Math.cos(u); PP.a = u; return PP; }
function sport(g, sp) {
  const MAX = sp.tachMax, rpm = dispRpm(sp);
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
  const lit = '#bfefff', dim = '#13303b', now = phNow();
  g.textAlign = 'left'; g.font = 'bold 26px ui-monospace,Menlo,monospace'; g.fillStyle = lit;
  g.fillText(String(now.h).padStart(2, '0') + ((now.s & 1) ? ':' : ' ') + String(now.m).padStart(2, '0'), 52, 62);
  // big 7-seg style speed
  g.textAlign = 'right'; g.font = 'bold 112px ui-monospace,Menlo,monospace'; g.fillStyle = dim; g.fillText('188', 352, 160);
  g.fillStyle = lit; g.fillText(S.keyT < 1.2 ? 188 : Math.round(Math.abs(S.v) * 3.6), 352, 160); // 188 = self-test segment check
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
  if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.font = 'bold 18px system-ui'; g.fillText('FI', 52, 100); }
}
/* tft: CBR650R 5" colour TFT. Bar tach across the top (red from the redline), shift light, big speed, gear, E-Clutch
   lamp, fuel bar, clock and odometer */
function tft(g, sp) {
  const MAX = sp.tachMax, rpm = dispRpm(sp), N = 56, now = phNow(), shiftL = S.running && rpm >= sp.red - 600;
  g.fillStyle = '#07090c'; rr(g, 4, 4, 504, 216, 18); g.fill(); g.strokeStyle = '#262b33'; g.lineWidth = 4; g.stroke();
  g.fillStyle = shiftL && (performance.now() / 70 | 0) % 2 ? '#ffffff' : '#141820'; rr(g, 196, 10, 120, 8, 4); g.fill(); // shift light
  for (let i = 0; i < N; i++) {
    const r0 = i / N * MAX, x = 22 + i * 8.3, h = 14 + i / N * 26, on = rpm > r0 && rpm > 0;
    g.fillStyle = on ? (r0 >= sp.red ? '#ff2d2d' : r0 >= sp.red - 2500 ? '#ffffff' : '#36c6ff') : (r0 >= sp.red ? '#3c1414' : '#16202a');
    g.fillRect(x, 70 - h, 6, h);
  }
  g.fillStyle = '#8a97a3'; g.font = 'bold 15px system-ui'; g.textAlign = 'center';
  for (let k = 0; k <= MAX / 1000; k += 2) g.fillText(k, 25 + k * 1000 / MAX * N * 8.3, 88);
  g.textAlign = 'right'; g.font = 'bold 92px system-ui'; g.fillStyle = '#ffffff'; g.fillText(Math.round(Math.abs(S.v) * 3.6), 300, 186);
  g.textAlign = 'left'; g.font = 'bold 20px system-ui'; g.fillStyle = '#8a97a3'; g.fillText('km/h', 306, 186);
  g.strokeStyle = '#36c6ff'; g.lineWidth = 3; rr(g, 396, 100, 92, 96, 10); g.stroke();
  g.textAlign = 'center'; g.font = 'bold 76px system-ui'; g.fillStyle = S.gear ? '#ffffff' : '#43e07a'; g.fillText(S.gear || 'N', 442, 176);
  g.font = 'bold 13px system-ui'; g.fillStyle = '#8a97a3'; g.fillText('GEAR', 442, 116);
  g.textAlign = 'left'; g.font = 'bold 20px ui-monospace,Menlo,monospace'; g.fillStyle = '#dfe7ee';
  g.fillText(String(now.h).padStart(2, '0') + ((now.s & 1) ? ':' : ' ') + String(now.m).padStart(2, '0'), 26, 118);
  g.font = 'bold 15px ui-monospace,Menlo,monospace'; g.fillStyle = '#8a97a3'; g.fillText('ODO ' + (S.odo / 1000).toFixed(1) + ' km', 26, 206);
  const fr = S.fuel / sp.fuel.cap;
  for (let i = 0; i < 8; i++) { g.fillStyle = fr > (i + .5) / 8 ? (fr < .2 ? '#ff4a3d' : '#dfe7ee') : '#16202a'; g.fillRect(26 + i * 13, 140, 10, 16); }
  g.fillStyle = '#8a97a3'; g.font = 'bold 13px system-ui'; g.fillText('FUEL', 26, 172);
  if (ctx.bcfg.autoClutch) { g.fillStyle = '#43e07a'; g.font = 'bold 14px system-ui'; g.fillText('AUTO CLU', 396, 214); }
  g.font = 'bold 18px system-ui';
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 130, 118); }
  else if (S.cl > .05) { g.fillStyle = '#ffb020'; g.fillText('CLUTCH ' + (S.cl * 100 | 0) + '%', 130, 118); }
}
/* h2: Ninja H2-style. Big analog tach (white needle, 0-16 with the red zone from the redline) beside a mono LCD: speed, gear,
   supercharger boost bar (rpm² × load, like the real one rising with revs), fuel, clock, QS lamp */
function h2(g, sp) {
  const MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), cx = 128, cy = 118, R = 100, a = v => PI * (.8 + 1.4 * v);
  g.fillStyle = '#08090b'; rr(g, 4, 4, 504, 216, 30); g.fill(); g.strokeStyle = '#2b2f36'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#111317'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill(); g.strokeStyle = '#4a5059'; g.lineWidth = 4; g.stroke();
  g.strokeStyle = '#c22'; g.lineWidth = 9; g.beginPath(); g.arc(cx, cy, R - 10, a(sp.red / MAX), a(1)); g.stroke();
  g.fillStyle = '#e6e9ee'; g.strokeStyle = '#e6e9ee'; g.font = 'bold 17px system-ui'; g.textAlign = 'center';
  for (let k = 0; k <= MAX / 1000; k++) { const t = a(k * 1000 / MAX), big = k % 2 === 0; g.lineWidth = big ? 4 : 2; g.beginPath(); g.moveTo(cx + Math.cos(t) * (R - 6), cy + Math.sin(t) * (R - 6)); g.lineTo(cx + Math.cos(t) * (R - (big ? 20 : 14)), cy + Math.sin(t) * (R - (big ? 20 : 14))); g.stroke();
    if (big) g.fillText(k, cx + Math.cos(t) * (R - 34), cy + Math.sin(t) * (R - 34) + 6); }
  g.font = 'bold 11px system-ui'; g.fillStyle = '#8a929c'; g.fillText('x1000 r/min', cx, cy + 40);
  const t = a(Math.min(rpm, MAX * 1.02) / MAX); g.strokeStyle = '#f4f6f8'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.cos(t) * 12, cy - Math.sin(t) * 12); g.lineTo(cx + Math.cos(t) * (R - 12), cy + Math.sin(t) * (R - 12)); g.stroke(); g.lineCap = 'butt';
  g.fillStyle = '#3fae2a'; g.beginPath(); g.arc(cx, cy, 10, 0, 2 * PI); g.fill();
  // LCD
  const lit = '#c9d6dc', dim = '#18222a'; g.fillStyle = '#0c151b'; rr(g, 248, 22, 248, 182, 14); g.fill();
  g.textAlign = 'right'; g.font = 'bold 78px ui-monospace,Menlo,monospace'; g.fillStyle = lit; g.fillText(Math.round(Math.abs(S.v) * 3.6), 420, 104);
  g.textAlign = 'left'; g.font = 'bold 16px system-ui'; g.fillStyle = '#7f949e'; g.fillText('km/h', 424, 104);
  g.textAlign = 'center'; g.font = 'bold 50px system-ui'; g.fillStyle = S.gear ? lit : '#43e07a'; g.fillText(S.gear || 'N', 462, 168);
  const bo = boostOf(sp); g.textAlign = 'left'; g.font = 'bold 13px system-ui'; g.fillStyle = '#7f949e'; g.fillText('BOOST', 262, 132);
  for (let i = 0; i < 10; i++) { g.fillStyle = bo > (i + .5) / 10 ? (i > 7 ? '#ffb020' : lit) : dim; g.fillRect(316 + i * 10, 120, 7, 14); }
  const fr = S.fuel / sp.fuel.cap; for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff4a3d' : lit) : dim; g.fillRect(262 + i * 13, 146, 10, 14); }
  g.fillStyle = '#7f949e'; g.fillText('FUEL', 342, 159);
  g.font = 'bold 17px ui-monospace,Menlo,monospace'; g.fillStyle = lit; g.fillText(String(now.h).padStart(2, '0') + ((now.s & 1) ? ':' : ' ') + String(now.m).padStart(2, '0'), 262, 192);
  if (ctx.bcfg.qs !== false) { g.font = 'bold 14px system-ui'; g.fillStyle = '#43e07a'; g.fillText('QS', 340, 192); }
  g.font = 'bold 15px system-ui';
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 262, 48); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('SHIFT', 262, 48); }
  else if (S.cl > .05) { g.fillStyle = '#ffb020'; g.fillText('CLUTCH ' + (S.cl * 100 | 0) + '%', 262, 48); }
}
// supercharger boost 0..1 for the gauge: a centrifugal compressor's pressure rise goes with impeller speed², scaled by throttle
const boostOf = sp => S.running ? Math.min(1, (S.rpm / sp.red) ** 2) * (S.thrEff || 0) : 0;
/* smash: Smash-style analog. Cream speedo dial with a red needle, N-1-2-3-4 gear lamps, fuel needle, drum odometer,
   FI check lamp (FI only: lit while the key is on and the engine isn't running) */
function smash(g, sp) {
  g.fillStyle = '#121418'; rr(g, 4, 4, 504, 216, 70); g.fill(); g.strokeStyle = '#3a3f47'; g.lineWidth = 6; g.stroke();
  const cx = 140, cy = 116, R = 96, a = v => PI * (.75 + 1.5 * v), MAX = 140;
  g.fillStyle = '#efe9d8'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill(); g.strokeStyle = '#7b7f87'; g.lineWidth = 5; g.stroke();
  g.strokeStyle = '#1a1b1e'; g.fillStyle = '#1a1b1e'; g.font = 'bold 17px system-ui'; g.textAlign = 'center';
  for (let k = 0; k <= MAX; k += 10) {
    const t = a(k / MAX), big = k % 20 === 0; g.lineWidth = big ? 5 : 3; g.beginPath();
    g.moveTo(cx + Math.cos(t) * (R - 6), cy + Math.sin(t) * (R - 6)); g.lineTo(cx + Math.cos(t) * (R - (big ? 20 : 14)), cy + Math.sin(t) * (R - (big ? 20 : 14))); g.stroke();
    if (big) g.fillText(k, cx + Math.cos(t) * (R - 36), cy + Math.sin(t) * (R - 36) + 6);
  }
  g.font = 'bold 13px system-ui'; g.fillText('km/h', cx, cy + 46);
  const v = Math.min(Math.abs(S.v) * 3.6, MAX + 4), t = a(v / MAX);
  g.strokeStyle = '#d42a1e'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.cos(t) * 14, cy - Math.sin(t) * 14); g.lineTo(cx + Math.cos(t) * (R - 14), cy + Math.sin(t) * (R - 14)); g.stroke(); g.lineCap = 'butt';
  g.fillStyle = '#2a2c30'; g.beginPath(); g.arc(cx, cy, 13, 0, 2 * PI); g.fill();
  // drum odometer
  const od = String((S.odo / 1000 | 0) % 100000).padStart(5, '0');
  for (let i = 0; i < 5; i++) { g.fillStyle = '#0c0d0f'; g.fillRect(cx - 40 + i * 16, cy + 56, 14, 22); g.fillStyle = '#efe9d8'; g.font = 'bold 17px ui-monospace,Menlo,monospace'; g.fillText(od[i], cx - 33 + i * 16, cy + 73); }
  // gear position lamps
  for (let i = 0; i <= 4; i++) {
    const on = S.gear === i, x = 278 + i * 46; g.fillStyle = on ? (i ? '#ffb020' : '#43e07a') : '#22262c'; rr(g, x, 34, 38, 50, 8); g.fill();
    g.fillStyle = on ? '#1a1000' : '#59606a'; g.font = 'bold 34px system-ui'; g.fillText(i || 'N', x + 19, 72);
  }
  // fuel needle
  const fx = 340, fy = 186, fr = S.fuel / sp.fuel.cap, ft = PI * (1.15 + .7 * fr);
  g.strokeStyle = '#efe9d8'; g.lineWidth = 4; g.beginPath(); g.arc(fx, fy, 56, PI * 1.15, PI * 1.85); g.stroke();
  g.fillStyle = '#efe9d8'; g.font = 'bold 15px system-ui'; g.fillText('E', fx - 58, fy - 22); g.fillText('F', fx + 58, fy - 22);
  g.strokeStyle = fr < .18 ? '#ff4a3d' : '#d42a1e'; g.lineWidth = 5; g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + Math.cos(ft) * 52, fy + Math.sin(ft) * 52); g.stroke();
  g.fillStyle = '#d0d4da'; g.font = 'bold 13px system-ui'; g.fillText('FUEL', fx, fy + 2);
  // lamps
  g.font = 'bold 17px system-ui'; g.textAlign = 'left';
  if (!sp.carb) { g.fillStyle = !S.running ? '#ffb020' : '#2a2e34'; g.fillText('FI', 430, 128); }
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 278, 116); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('LIMIT', 278, 116); }
}
/* tmx: TMX Supremo twin analog dials. Speedo (left, cream face, 0-140) and tacho (right, x1000 r/min, red from 9), green gear
   number between them, neutral lamp, fuel bar */
function tmx(g, sp) {
  g.fillStyle = '#101215'; rr(g, 4, 4, 504, 216, 60); g.fill(); g.strokeStyle = '#3a3f47'; g.lineWidth = 6; g.stroke();
  const dial = (cx, max, step, lab, val, red) => {
    const cy = 112, R = 92, a = v => PI * (.75 + 1.5 * v);
    g.fillStyle = '#ece6d4'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill(); g.strokeStyle = '#8a8f97'; g.lineWidth = 5; g.stroke();
    if (red) { g.strokeStyle = '#d42a1e'; g.lineWidth = 9; g.beginPath(); g.arc(cx, cy, R - 10, a(red / max), a(1)); g.stroke(); }
    g.strokeStyle = g.fillStyle = '#1a1b1e'; g.font = 'bold 16px system-ui'; g.textAlign = 'center';
    for (let k = 0; k <= max; k += step) {
      const t = a(k / max), big = k % (step * 2) === 0; g.lineWidth = big ? 4 : 2.5; g.beginPath();
      g.moveTo(cx + Math.cos(t) * (R - 6), cy + Math.sin(t) * (R - 6)); g.lineTo(cx + Math.cos(t) * (R - (big ? 18 : 12)), cy + Math.sin(t) * (R - (big ? 18 : 12))); g.stroke();
      if (big) g.fillText(k, cx + Math.cos(t) * (R - 32), cy + Math.sin(t) * (R - 32) + 6);
    }
    g.font = 'bold 12px system-ui'; g.fillText(lab, cx, cy + 44);
    const t = a(Math.min(val, max * 1.03) / max); g.strokeStyle = '#d42a1e'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath();
    g.moveTo(cx - Math.cos(t) * 12, cy - Math.sin(t) * 12); g.lineTo(cx + Math.cos(t) * (R - 12), cy + Math.sin(t) * (R - 12)); g.stroke(); g.lineCap = 'butt';
    g.fillStyle = '#2a2c30'; g.beginPath(); g.arc(cx, cy, 11, 0, 2 * PI); g.fill();
  };
  dial(110, 140, 10, 'km/h', Math.abs(S.v) * 3.6, 0);
  dial(402, 10, .5, 'x1000 r/min', dispRpm(sp) / 1000, 9);
  // gear number + neutral lamp between the dials
  g.fillStyle = '#05140a'; rr(g, 222, 40, 68, 74, 10); g.fill();
  g.fillStyle = S.gear ? '#5cff8a' : '#2a4a32'; g.font = 'bold 54px ui-monospace,Menlo,monospace'; g.textAlign = 'center'; g.fillText(S.gear || '-', 256, 98);
  g.fillStyle = !S.gear ? '#43e07a' : '#1d2a22'; g.beginPath(); g.arc(256, 134, 11, 0, 2 * PI); g.fill();
  g.fillStyle = !S.gear ? '#0a1a0f' : '#3d4a42'; g.font = 'bold 13px system-ui'; g.fillText('N', 256, 139);
  // fuel bar
  const fr = S.fuel / sp.fuel.cap; for (let i = 0; i < 6; i++) { g.fillStyle = i < Math.ceil(fr * 6) ? (fr < .18 ? '#ff4a3d' : '#ffb020') : '#22262c'; g.fillRect(226 + i * 10, 166, 8, 22); }
  g.fillStyle = '#d0d4da'; g.font = 'bold 11px system-ui'; g.fillText('E        F', 256, 202);
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.font = 'bold 12px system-ui'; g.fillText('OFF', 256, 160); }
}
/* nmax: NMAX 155. Tech MAX = 4.2" colour TFT (tach arc across the top, big speed, T / S mode, Y-Shift level, TCS, Stop & Start,
   fuel, clock, odometer); Standard = the same layout as a negative LCD, no mode or Y-Shift */
function nmax(g, sp) {
  const tft = !!sp.yec, MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), N = 40, blink = (performance.now() / 400 | 0) % 2;
  const bg = tft ? '#06080c' : '#0b1a22', lit = tft ? '#ffffff' : '#bfefff', dim = tft ? '#1a2029' : '#13303b', acc = tft ? '#2fa8ff' : lit, sub = tft ? '#8b96a5' : '#7fb2c4';
  g.fillStyle = '#05070a'; rr(g, 4, 4, 504, 216, 30); g.fill(); g.strokeStyle = '#2a2f36'; g.lineWidth = 4; g.stroke();
  g.fillStyle = bg; rr(g, 16, 14, 480, 196, 22); g.fill();
  for (let i = 0; i < N; i++) { // tach: segments along a shallow arc
    const t = i / (N - 1), r0 = t * MAX, x = 40 + t * 432, y = 34 + 26 * (1 - Math.sin(t * PI * .9 + .15)), on = rpm > r0 && rpm > 0;
    g.fillStyle = on ? (r0 >= sp.red ? '#ff3b2f' : r0 >= sp.red - 1500 ? '#ffb020' : acc) : (r0 >= sp.red ? '#3a1512' : dim); g.fillRect(x, y, 8, 16);
  }
  g.fillStyle = sub; g.font = 'bold 13px system-ui'; g.textAlign = 'center'; for (let k = 0; k <= MAX / 1000; k += 2) g.fillText(k, 44 + k * 1000 / MAX * 432, 94 - 26 * (1 - Math.sin(k * 1000 / MAX * PI * .9 + .15)) + 14);
  g.textAlign = 'right'; g.font = 'bold 92px ui-monospace,Menlo,monospace';
  if (!tft) { g.fillStyle = dim; g.fillText('188', 330, 186); }
  g.fillStyle = lit; g.fillText(!tft && S.keyT < 1.2 ? 188 : Math.round(Math.abs(S.v) * 3.6), 330, 186);
  g.textAlign = 'left'; g.font = 'bold 20px system-ui'; g.fillStyle = sub; g.fillText('km/h', 336, 186);
  g.font = 'bold 20px ui-monospace,Menlo,monospace'; g.fillStyle = lit; g.fillText(String(now.h).padStart(2, '0') + ((now.s & 1) ? ':' : ' ') + String(now.m).padStart(2, '0'), 36, 122);
  g.font = 'bold 15px ui-monospace,Menlo,monospace'; g.fillStyle = sub; g.fillText('ODO ' + (S.odo / 1000).toFixed(1) + ' km', 36, 198);
  const fr = S.fuel / sp.fuel.cap; // fuel: 6 bars, right
  for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff4a3d' : lit) : dim; g.fillRect(420 + i * 11, 176 - i * 4, 8, 20 + i * 4); }
  g.fillStyle = sub; g.font = 'bold 12px system-ui'; g.fillText('E', 408, 196); g.fillText('F', 486, 160);
  g.font = 'bold 16px system-ui';
  if (tft) { // T / S mode badge, Y-Shift level pips
    const m = ctx.bcfg.ysp ? 'S' : 'T'; g.fillStyle = m === 'S' ? '#ff6a2a' : '#2fa8ff'; rr(g, 36, 134, 34, 30, 7); g.fill(); g.fillStyle = '#05070a'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.fillText(m, 53, 157);
    g.textAlign = 'left'; g.font = 'bold 13px system-ui'; g.fillStyle = sub; g.fillText('Y-SHIFT', 80, 146);
    for (let i = 0; i < 3; i++) { g.fillStyle = S.ysh > i ? '#ffb020' : dim; g.fillRect(80 + i * 20, 152, 16, 10); }
  }
  g.font = 'bold 14px system-ui'; g.textAlign = 'left';
  if (sp.tc) { g.fillStyle = ctx.bcfg.tc === false ? '#ffb020' : S.tcF < .95 ? (blink ? '#ffb020' : dim) : dim; g.fillText(ctx.bcfg.tc === false ? 'TCS OFF' : 'TCS', 410, 122); }
  g.fillStyle = S.issOff ? (blink ? '#43e07a' : dim) : ctx.bcfg.iss ? (tft ? '#2d5a3a' : '#3d6b7a') : dim; g.fillText('S/S', 360, 122);
  if (!S.running && !S.issOff) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 140, 122); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('FI', 140, 122); }
}
// key off: the dash is dead
function dead(g) { g.fillStyle = '#05070a'; rr(g, 4, 4, 504, 216, 26); g.fill(); }
const CLUSTERS = { sport, scooter, tft, smash, tmx, h2, nmax };
// Redrawn only when something on it changes; the texture is uploaded to the GPU only while the in-world cluster can
// be seen (1st person / garage). In 3rd person the same canvas is shown as the on-screen HUD, no upload needed.
let cluKey = '', texDirty = true;
export function drawCluster(inWorld = true) {
  const sp = ctx.spec, bl = (performance.now() / 90 | 0) % 2, now = phNow();
  const key = [ctx.bike.id, Math.round(Math.abs(S.v) * 3.6), S.gear, S.key, S.running, S.keyT < 1.2, Math.ceil(dispRpm(sp) / sp.tachMax * 56), (S.fuel / sp.fuel.cap * 100 | 0), S.lim && bl, S.cl > .05 ? S.cl * 100 | 0 : -1,
    ctx.bike.cluster === 'tft' ? [now.m, now.s & 1, (S.odo / 100) | 0, ctx.bcfg.autoClutch, S.running && S.rpm >= sp.red - 600 && (performance.now() / 70 | 0) % 2].join() :
    ctx.bike.cluster === 'scooter' ? [now.m, now.s & 1, (S.odo / 100) | 0, S.running && Math.abs(S.v) > 2 && S.thrEff < .35, S.issOff && (performance.now() / 400 | 0) % 2, ctx.bcfg.iss, S.issOff].join() :
    ctx.bike.cluster === 'h2' ? [now.m, now.s & 1, Math.round(boostOf(sp) * 10), ctx.bcfg.qs].join() :
    ctx.bike.cluster === 'nmax' ? [now.m, now.s & 1, (S.odo / 100) | 0, S.ysh, ctx.bcfg.ysp, sp.yec, ctx.bcfg.tc, (S.tcF ?? 1) < .95 && (performance.now() / 400 | 0) % 2, S.issOff && (performance.now() / 400 | 0) % 2, ctx.bcfg.iss, S.issOff].join() :
    ctx.bike.cluster === 'smash' ? [(S.odo / 1000) | 0, sp.carb].join() : ''].join('|');
  if (key !== cluKey) { cluKey = key; gc.clearRect(0, 0, 512, 224); (S.key ? CLUSTERS[ctx.bike.cluster] : dead)(gc, sp); texDirty = true; }
  if (inWorld && texDirty) { cluTex.needsUpdate = true; texDirty = false; return true; }
  return false;
}

/* minimap */
const mm = $('mini').getContext('2d'); let miniKey = '';
export function drawMini(MAP, V) { // V = world.js MAPV {cx, cz, w metres, n px}
  const P = at(), MI0 = ctx.MI, k = (P.x * 2 | 0) + ',' + (P.z * 2 | 0) + ',' + (P.psi * 100 | 0) + ',' + (MI0 ? MI0.pk : '') + (ctx.mpK || '') + (ctx.wpK || '');
  if (k === miniKey) return; miniKey = k;
  mm.clearRect(0, 0, 140, 140); mm.save(); mm.beginPath(); mm.arc(70, 70, 68, 0, 7); mm.clip();
  const px = x => ((x - V.cx) / V.w + .5) * V.n, pz = z => ((z - V.cz) / V.w + .5) * V.n, u = px(P.x), v = pz(P.z), Z = 2.6;
  mm.translate(70, 70); mm.rotate(P.psi); mm.scale(Z, Z); mm.translate(-u, -v); mm.drawImage(MAP, 0, 0);
  const dot = (x, z, c, r) => { mm.fillStyle = c; mm.beginPath(); mm.arc(px(x), pz(z), r / Z, 0, 7); mm.fill(); };
  for (const [gx, gz] of V.gas || [[-40, 40]]) dot(gx, gz, '#ff4a3d', 4); mm.restore();
  // quest pins (missions.js): in view = icon; out of view = the 3 nearest stick to the rim; red outline = needs a specific bike
  const ca = Math.cos(P.psi), sa = Math.sin(P.psi), L = []; mm.textAlign = 'center'; mm.textBaseline = 'middle'; mm.font = 'bold 8px system-ui';
  for (const p of (MI0 && MI0.pins) || []) { const dx = (px(p.x) - u) * Z, dz = (pz(p.z) - v) * Z, X = dx * ca - dz * sa, Y = dx * sa + dz * ca; L.push({ p, X, Y, d: Math.hypot(X, Y) }); }
  L.sort((a, b) => a.d - b.d); let rim = 0;
  for (const e of L) {
    const f = e.d > 56 ? 56 / e.d : 1; if (f < 1 && ++rim > 3) continue;
    const r = f < 1 ? 4.5 : 6, cx = 70 + e.X * f, cy = 70 + e.Y * f, p = e.p;
    mm.fillStyle = p.c; mm.beginPath(); mm.arc(cx, cy, r, 0, 7); mm.fill(); mm.strokeStyle = p.h ? '#ff4a3d' : '#fff'; mm.lineWidth = 1.5; mm.stroke();
    mm.fillStyle = '#fff'; if (p.g && f === 1) mm.fillText(p.g, cx, cy + .5); else { mm.beginPath(); mm.arc(cx, cy, 1.8, 0, 7); mm.fill(); }
  }
  // other riders (net.js): cyan dots, far ones on the rim
  for (const p of ctx.mpDots || []) {
    const dx = (px(p.x) - u) * Z, dz = (pz(p.z) - v) * Z, X = dx * ca - dz * sa, Y = dx * sa + dz * ca, d = Math.hypot(X, Y), f = d > 60 ? 60 / d : 1;
    mm.fillStyle = '#3ad7ff'; mm.beginPath(); mm.arc(70 + X * f, 70 + Y * f, 3.5, 0, 7); mm.fill(); mm.strokeStyle = '#0b1a22'; mm.lineWidth = 1.2; mm.stroke();
  }
  // waypoint (map.js): a pin while it is on the minimap, an arrow on the rim when it is further off; the distance sits at the bottom
  const WP = ctx.WP;
  if (WP && WP.on) {
    const dx = (px(WP.x) - u) * Z, dz = (pz(WP.z) - v) * Z, X = dx * ca - dz * sa, Y = dx * sa + dz * ca, d = Math.hypot(X, Y), f = d > 54 ? 54 / d : 1, cx = 70 + X * f, cy = 70 + Y * f;
    mm.fillStyle = '#a78bfa'; mm.strokeStyle = '#fff'; mm.lineWidth = 1.6;
    if (f < 1) { mm.save(); mm.translate(cx, cy); mm.rotate(Math.atan2(Y, X)); mm.beginPath(); mm.moveTo(8, 0); mm.lineTo(-5, -6); mm.lineTo(-2, 0); mm.lineTo(-5, 6); mm.closePath(); mm.fill(); mm.stroke(); mm.restore(); }
    else { mm.beginPath(); mm.arc(cx, cy, 5.5, 0, 7); mm.fill(); mm.stroke(); mm.fillStyle = '#fff'; mm.beginPath(); mm.arc(cx, cy, 1.8, 0, 7); mm.fill(); }
    const m = Math.hypot(P.x - WP.x, P.z - WP.z), t = m < 1000 ? (m | 0) + ' m' : (m / 1000).toFixed(1) + ' km'; mm.font = 'bold 9px system-ui'; const w = mm.measureText(t).width + 12;
    mm.fillStyle = 'rgba(10,12,16,.75)'; rr(mm, 70 - w / 2, 111, w, 15, 7.5); mm.fill(); mm.fillStyle = '#e9e3ff'; mm.fillText(t, 70, 118.8);
  }
  mm.fillStyle = '#ffb020'; mm.beginPath(); mm.moveTo(70, 62); mm.lineTo(76, 76); mm.lineTo(70, 72); mm.lineTo(64, 76); mm.fill();
  mm.strokeStyle = 'rgba(255,255,255,.5)'; mm.lineWidth = 2; mm.beginPath(); mm.arc(70, 70, 68, 0, 7); mm.stroke();
  // "tap to open the map" badge on the rim, bottom right
  mm.fillStyle = 'rgba(10,12,16,.72)'; mm.beginPath(); mm.arc(113, 113, 9, 0, 7); mm.fill(); mm.strokeStyle = 'rgba(255,255,255,.85)'; mm.lineWidth = 1.6; mm.beginPath();
  mm.moveTo(109, 117); mm.lineTo(117, 109); mm.moveTo(111.5, 109); mm.lineTo(117, 109); mm.lineTo(117, 114.5); mm.moveTo(108.5, 111.5); mm.lineTo(108.5, 117.5); mm.lineTo(114.5, 117.5); mm.stroke();
}

/* FPS / renderer readout */
let fpsV = 0, physV = '', gfxV = ''; export const setFps = v => { fpsV = v; }; export const setPhys = v => { physV = v; };
export let jankV = ''; export const setJank = v => { jankV = v; };
export const setGfx = (draws, res) => { gfxV = draws + ' draws' + (res < 1 ? ' · res ' + Math.round(res * 100) + '%' : ''); };
export function updPerf(API) { const p = []; if (cfg.showApi) p.push(API); if (cfg.showFps) p.push(fpsV + ' fps'); if (cfg.showFps && physV) p.push(physV); if (cfg.showFps && gfxV) p.push(gfxV); if (cfg.showFps && jankV) p.push(jankV); $('perf').textContent = p.join(' · '); $('perf').hidden = !p.length; }
