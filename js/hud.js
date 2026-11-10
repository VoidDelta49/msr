// On-screen messages, the gauge cluster (HUD and the in-world LCD share one canvas), minimap, perf readout
import { dispRpm } from './ignition.js';
import * as THREE from 'three';
import { $, PI } from './util.js';
import { S, ctx } from './state.js';
import { cfg, phClock as phNow } from './config.js';
import { at } from './foot.js';

export function say(t, ms = 1600) { const m = $('msg'); m.textContent = t; m.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove('on'), ms); }

const gaugeCv = $('gauge'), gc = gaugeCv.getContext('2d');
// No mipmaps: the dash is re-uploaded up to 10x a second in 1st person, and on WebGPU every upload rebuilt the whole
// chain (9 render passes + its own queue submit), a GPU burst that landed on the next frame. Seen from the saddle it
// is never minified more than ~2x, where plain bilinear still reads fine.
export const cluTex = new THREE.CanvasTexture(gaugeCv); cluTex.colorSpace = THREE.SRGBColorSpace; cluTex.generateMipmaps = false; cluTex.minFilter = THREE.LinearFilter;
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

const PP = { x: 0, y: 0, a: 0 }; // reused per redraw
const clk = n => String(n.h).padStart(2, '0') + ((n.s & 1) ? ':' : ' ') + String(n.m).padStart(2, '0');
const kmh = () => Math.round(Math.abs(S.v) * 3.6);
const MONO = 'ui-monospace,Menlo,monospace', GH = 'rgba(255,255,255,.05)'; // GH: unlit LCD segments behind the digits
function ndl(g, cx, cy, t, r, col, w = 5, back = 12) { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.cos(t) * back, cy - Math.sin(t) * back); g.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); g.stroke(); g.lineCap = 'butt'; }
// dial scale: a tick every `step`, a longer one + number every `lab` (numbers from `redFrom` up in `redCol`)
function scale(g, cx, cy, R, a, max, step, lab, col, font, labR, redFrom = 1e9, redCol = col) {
  g.strokeStyle = col; g.font = font; g.textAlign = 'center';
  for (let i = 0, n = Math.round(max / step); i <= n; i++) {
    const k = i * step, t = a(k / max), big = i % Math.round(lab / step) === 0, c = Math.cos(t), s = Math.sin(t);
    g.lineWidth = big ? 3.5 : 2; g.beginPath(); g.moveTo(cx + c * (R - 5), cy + s * (R - 5)); g.lineTo(cx + c * (R - (big ? 17 : 12)), cy + s * (R - (big ? 17 : 12))); g.stroke();
    if (big) { g.fillStyle = k >= redFrom ? redCol : col; g.fillText(+k.toFixed(1), cx + c * (R - labR), cy + s * (R - labR) + 5); }
  }
}
function drum(g, x, y, n, col = '#e9e9e4') { const od = String((S.odo / 1000 | 0) % 10 ** n).padStart(n, '0'); g.font = 'bold 13px ' + MONO; g.textAlign = 'center'; for (let i = 0; i < n; i++) { g.fillStyle = '#060607'; g.fillRect(x + i * 12, y, 11, 16); g.fillStyle = col; g.fillText(od[i], x + i * 12 + 5.5, y + 13); } }
// fuel-economy bar of the Honda LCD: full when coasting, empties with the throttle
const ecoV = () => S.running && Math.abs(S.v) > 2 ? 1 - Math.min(1, S.thrEff || 0) : 0;

/* sport: Suzuki Raider R150 Fi (owner's photos). Red-backlit LCD with dark segments: tach bar over a rising 0-13 scale across
   the top, big speed on the left, clock / GEAR digit in the middle, LOW tach-range flag, odometer, fuel blocks F-E down the
   right edge. Beside the glass: the RPM shift lamp and the green N lamp */
function sport(g, sp) {
  const MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), K = MAX / 1000, ink = '#1c0406', gh = 'rgba(40,0,0,.09)', X = t => 46 + t * 322, Y = t => 70 - 16 * t;
  g.fillStyle = '#08090b'; rr(g, 4, 4, 504, 216, 34); g.fill(); g.strokeStyle = '#2b3138'; g.lineWidth = 4; g.stroke();
  const gr = g.createLinearGradient(0, 20, 0, 200); gr.addColorStop(0, '#ff4a44'); gr.addColorStop(1, '#f01f24');
  g.fillStyle = gr; g.beginPath(); g.moveTo(34, 30); g.lineTo(408, 16); g.lineTo(414, 190); g.lineTo(44, 200); g.closePath(); g.fill();
  for (let i = 0; i < 52; i++) { const t = i / 51, h = 9 + t * 17; g.fillStyle = rpm > t * MAX && rpm > 0 ? ink : gh; g.fillRect(X(t), Y(t) - h - 2, 4.6, h); }
  g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(0) - 6, Y(0)); g.lineTo(X(1) + 8, Y(1)); g.stroke();
  g.fillStyle = ink; g.font = 'bold 13px system-ui'; g.textAlign = 'center';
  for (let k = 0; k <= K; k++) { const t = k / K; g.fillText(k, X(t) + 2, Y(t) + 14); g.fillRect(X(t) - 2, Y(t) - 30 - t * 4, 1, 30 + t * 4); }
  g.font = 'italic bold 9px system-ui'; g.textAlign = 'left'; g.fillText('x1000r/min', 50, 100);
  g.textAlign = 'right'; g.font = 'bold 100px ' + MONO; g.fillStyle = gh; g.fillText('188', 222, 190); g.fillStyle = ink; g.fillText(S.keyT < 1.2 ? 188 : kmh(), 222, 190);
  g.textAlign = 'left'; g.font = 'bold 13px system-ui'; g.fillText('km/h', 226, 178);
  g.textAlign = 'right'; g.font = 'bold 30px ' + MONO; g.fillText(now.h + ((now.s & 1) ? ':' : ' ') + String(now.m).padStart(2, '0'), 306, 122);
  g.lineWidth = 2.5; g.beginPath(); g.moveTo(326, 92); g.lineTo(310, 126); g.stroke();
  g.textAlign = 'center'; g.font = 'bold 46px ' + MONO; g.fillText(S.gear || 0, 350, 128);
  g.fillRect(326, 133, 48, 13); g.fillRect(236, 133, 42, 13); g.fillStyle = '#ff3a36'; g.font = 'bold 10px system-ui'; g.fillText('GEAR', 350, 143.5); g.fillText('LOW', 257, 143.5);
  g.fillStyle = ink; g.textAlign = 'left'; g.font = 'bold 10px system-ui'; g.fillText('ODO', 290, 160);
  g.textAlign = 'right'; g.font = 'bold 26px ' + MONO; g.fillText(String(S.odo / 1000 | 0).padStart(6, '0'), 374, 188);
  const fr = S.fuel / sp.fuel.cap; for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? ink : gh; g.fillRect(384 + i * .6, 172 - i * 15, 15, 12); }
  g.fillStyle = ink; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.fillText('F', 396, 88); g.fillText('E', 406, 184);
  // beside the glass
  const shift = S.running && (rpm >= sp.red - 500 || S.lim) && !(S.lim && (performance.now() / 90 | 0) % 2);
  g.fillStyle = '#c9ced6'; g.font = 'bold 12px system-ui'; g.fillText('RPM', 440, 84); g.fillText('SEL', 60, 214); g.fillText('ADJ', 446, 196);
  g.fillStyle = shift ? '#ffffff' : '#0c0d10'; g.strokeStyle = '#5a6068'; g.lineWidth = 2; g.beginPath(); g.arc(478, 78, 13, 0, 2 * PI); g.fill(); g.stroke();
  g.fillStyle = S.gear ? '#10301a' : '#39e06a'; rr(g, 462, 106, 32, 30, 5); g.fill(); g.fillStyle = S.gear ? '#1d4a2a' : '#06200f'; g.font = 'bold 22px system-ui'; g.fillText('N', 478, 129);
  g.textAlign = 'left'; g.font = 'bold 12px system-ui';
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 190, 214); }
  else if (S.cl > .05) { g.fillStyle = '#ffb020'; g.fillText('CLUTCH ' + (S.cl * 100 | 0) + '%', 190, 214); }
}
/* scooter: Honda Click 125. Small wide blue negative LCD: wedge fuel bars far left, big italic speed, clock and distance on
   the right over the fuel-economy bar. Idling Stop lamp on the bezel above it */
function scooter(g, sp) {
  g.fillStyle = '#07090b'; rr(g, 4, 4, 504, 216, 60); g.fill(); g.strokeStyle = '#2b3138'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#1b35b4'; rr(g, 40, 46, 432, 150, 10); g.fill();
  const lit = '#f4f8ff', dim = 'rgba(255,255,255,.1)', now = phNow(), fr = S.fuel / sp.fuel.cap;
  for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff8a7a' : lit) : dim; g.fillRect(56, 158 - i * 17, 20 + i * 3, 12); }
  g.fillStyle = lit; g.font = 'bold 12px system-ui'; g.textAlign = 'left'; g.fillText('E', 58, 186); g.fillText('F', 58, 66);
  g.textAlign = 'right'; g.font = 'italic bold 116px ' + MONO; g.fillStyle = GH; g.fillText('188', 306, 172);
  g.fillStyle = lit; g.fillText(S.keyT < 1.2 ? 188 : kmh(), 306, 172); // 188 = self-test segment check
  g.textAlign = 'left'; g.font = 'italic bold 15px system-ui'; g.fillText('km/h', 312, 80);
  g.textAlign = 'right'; g.font = 'italic bold 28px ' + MONO; g.fillText(clk(now), 458, 86);
  g.font = 'italic bold 26px ' + MONO; g.fillText((S.odo / 1000).toFixed(1), 438, 130); g.font = 'bold 11px system-ui'; g.fillText('km', 458, 130);
  g.textAlign = 'left'; g.fillText('TOTAL', 316, 108);
  g.strokeStyle = lit; g.lineWidth = 1.5; g.strokeRect(316, 146, 142, 14); g.fillRect(319, 149, 136 * ecoV(), 8);
  for (let i = 0; i <= 4; i++) g.fillRect(316 + i * 35, 164, 2, 6);
  g.font = 'bold 9px system-ui'; g.fillText('km/L', 316, 184);
  const iss = ctx.bcfg.iss, blink = (performance.now() / 400 | 0) % 2;
  g.font = 'bold 14px system-ui'; g.fillStyle = S.issOff ? (blink ? '#ffb020' : '#1c2126') : iss ? '#5a6b3a' : '#1c2126'; g.fillText('IDLING STOP', 312, 34);
  if (!S.running && !S.issOff) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 110, 34); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ffb020'; g.fillText('FI', 110, 34); }
}
/* aerox: Yamaha Aerox 155. Blue negative LCD: the tach climbs both edges as mirrored bar stacks (0 at the bottom, 10 on top),
   clock top centre, big italic speed, distance under it, fuel bar E-F along the bottom */
function aerox(g, sp) {
  g.fillStyle = '#07090b'; rr(g, 4, 4, 504, 216, 34); g.fill(); g.strokeStyle = '#2b3138'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#172fa6'; rr(g, 36, 12, 440, 200, 12); g.fill();
  const lit = '#eef3ff', dim = 'rgba(255,255,255,.1)', now = phNow(), MAX = sp.tachMax, rpm = dispRpm(sp), N = 26, blink = (performance.now() / 400 | 0) % 2;
  g.font = 'italic bold 12px system-ui';
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < N; i++) { const t = i / (N - 1), r0 = t * MAX, ins = 30 * (1 - t) ** 2.4, y = 194 - t * 156; g.fillStyle = rpm > r0 && rpm > 0 ? (r0 >= sp.red ? '#ff8a7a' : lit) : dim; g.fillRect(s < 0 ? 68 + ins : 422 - ins, y, 22, 4); }
    g.fillStyle = lit; g.textAlign = s < 0 ? 'right' : 'left';
    for (let k = 0; k <= MAX / 1000; k += 2) { const t = k * 1000 / MAX, ins = 30 * (1 - t) ** 2.4; g.fillText(k, s < 0 ? 63 + ins : 449 - ins, 200 - t * 156); }
  }
  g.textAlign = 'center'; g.font = 'italic bold 24px ' + MONO; g.fillStyle = lit; g.fillText(clk(now), 262, 40);
  g.font = 'italic bold 10px system-ui'; g.textAlign = 'left'; g.fillText('x1000r/min', 100, 30);
  g.textAlign = 'right'; g.font = 'italic bold 104px ' + MONO; g.fillStyle = GH; g.fillText('188', 352, 142);
  g.fillStyle = lit; g.fillText(S.keyT < 1.2 ? 188 : kmh(), 352, 142);
  g.font = 'italic bold 14px system-ui'; g.fillText('km/h', 352, 58);
  g.font = 'italic bold 22px ' + MONO; g.fillText((S.odo / 1000).toFixed(1), 334, 168); g.font = 'bold 10px system-ui'; g.textAlign = 'left'; g.fillText('km', 338, 168); g.fillText('ODO', 196, 168);
  const fr = S.fuel / sp.fuel.cap; g.font = 'italic bold 15px system-ui'; g.fillText('E', 150, 198); g.fillText('F', 356, 198);
  for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff8a7a' : lit) : dim; g.fillRect(168 + i * 31, 184, 28, 14); }
  g.font = 'bold 12px system-ui';
  if (sp.tc) { g.fillStyle = ctx.bcfg.tc === false ? '#ffb020' : (S.tcF ?? 1) < .95 && blink ? '#ffb020' : dim; g.fillText('TCS', 104, 60); }
  g.fillStyle = S.issOff ? (blink ? '#7dffa0' : dim) : ctx.bcfg.iss ? 'rgba(255,255,255,.35)' : dim; g.fillText('A', 104, 82);
  if (!S.running && !S.issOff) { g.fillStyle = '#ff8a7a'; g.fillText('ENGINE', 104, 104); g.fillText('OFF', 104, 118); }
}
/* sniper: Yamaha Sniper 155. LCD with the tach as a line that climbs diagonally from 0 to 4 then runs flat to 12 across the
   top, GEAR box top left, big speed lower right, fuel bars up the right edge, Odo bottom left */
const SK = .375, sPt = t => { if (t < SK) { PP.x = 52 + t / SK * 130; PP.y = 152 - t / SK * 84; } else { PP.x = 182 + (t - SK) / (1 - SK) * 268; PP.y = 68; } return PP; };
function sniper(g, sp) {
  g.fillStyle = '#07080b'; rr(g, 4, 4, 504, 216, 30); g.fill(); g.strokeStyle = '#2a2f36'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#62739c'; rr(g, 34, 30, 444, 180, 10); g.fill();
  const lit = '#f6f8ff', dim = 'rgba(255,255,255,.14)', MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), K = MAX / 1000;
  g.font = 'bold 20px system-ui'; g.textAlign = 'left'; g.fillStyle = S.gear ? '#16241a' : '#43e07a'; g.fillText('N', 60, 24); // neutral lamp above the LCD
  for (let i = 0; i < 54; i++) { const t = i / 53, r0 = t * MAX, p = sPt(t); g.fillStyle = rpm > r0 && rpm > 0 ? (r0 >= sp.red ? '#ff9a8a' : lit) : dim; g.fillRect(p.x, p.y + 3, 5, 15); }
  g.strokeStyle = lit; g.lineWidth = 2; g.beginPath(); g.moveTo(46, 152); g.lineTo(52, 152); g.lineTo(182, 68); g.lineTo(456, 68); g.stroke();
  g.fillStyle = lit; g.font = 'bold 12px system-ui'; g.textAlign = 'center';
  for (let k = 0; k <= K; k++) { const t = k / K, p = sPt(t); g.fillText(k, p.x + (t < SK ? -9 : 2), p.y - (t < SK ? 5 : 6)); }
  g.font = 'bold 9px system-ui'; g.textAlign = 'right'; g.fillText('x1000r/min', 468, 44);
  g.textAlign = 'left'; g.font = 'bold 11px system-ui'; g.fillText('GEAR', 58, 46); g.strokeRect(54, 50, 40, 44);
  g.font = 'bold 36px ' + MONO; g.textAlign = 'center'; g.fillText(S.gear || 'N', 74, 85);
  g.textAlign = 'right'; g.font = 'bold 86px ' + MONO; g.fillStyle = GH; g.fillText('188', 404, 176); g.fillStyle = lit; g.fillText(S.keyT < 1.2 ? 188 : kmh(), 404, 176);
  g.font = 'bold 13px system-ui'; g.fillText('km/h', 404, 196);
  const fr = S.fuel / sp.fuel.cap; for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff9a8a' : lit) : dim; g.fillRect(434, 178 - i * 15, 28, 11); }
  g.fillStyle = lit; g.textAlign = 'center'; g.font = 'bold 12px system-ui'; g.fillText('F', 424, 112); g.fillText('E', 424, 188);
  g.textAlign = 'left'; g.fillText('Odo', 50, 180); g.font = 'bold 20px ' + MONO; g.fillText((S.odo / 1000).toFixed(1), 50, 202);
  g.font = 'bold 15px ' + MONO; g.fillText(clk(now), 176, 202);
  g.font = 'bold 13px system-ui'; g.fillStyle = S.running && rpm >= 6000 ? lit : dim; g.fillText('VVA', 196, 108);
  if (!S.running) { g.fillStyle = '#ffd0c8'; g.fillText('ENGINE OFF', 150, 130); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ffd0c8'; g.fillText('SHIFT', 150, 130); }
  else if (S.cl > .05) { g.fillStyle = lit; g.fillText('CLUTCH ' + (S.cl * 100 | 0) + '%', 150, 130); }
}
/* ns: Rouser NS125 (Bajaj Pulsar NS cluster). Big grey-faced analog tach in the middle (0 at the bottom, clockwise to 12, red
   numbers from the redline, orange needle) with the LCD fuel bar inset; LCD on the right: clock, speed, odometer; telltale
   wedge on the left (N, battery); rev-limit lamp on top */
function ns(g, sp) {
  g.fillStyle = '#0b0c0e'; rr(g, 4, 4, 504, 216, 40); g.fill(); g.strokeStyle = '#3a3f47'; g.lineWidth = 5; g.stroke();
  const MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), cx = 222, cy = 114, R = 100, a = v => PI * (.44 + 1.28 * v), lcd = '#a9b5a2', ink = '#161a15';
  g.fillStyle = '#17191c'; g.beginPath(); g.moveTo(26, 70); g.lineTo(112, 60); g.lineTo(112, 176); g.lineTo(52, 176); g.closePath(); g.fill();
  g.font = 'bold 26px system-ui'; g.textAlign = 'center'; g.fillStyle = S.gear ? '#14301c' : '#43e07a'; g.fillText('N', 78, 100);
  const bat = !S.running; g.strokeStyle = g.fillStyle = bat ? '#ff3b2f' : '#3a1512'; g.lineWidth = 2; g.strokeRect(64, 122, 28, 18); g.fillRect(68, 118, 6, 4); g.fillRect(82, 118, 6, 4); g.font = 'bold 12px system-ui'; g.fillText('- +', 78, 136);
  g.fillStyle = S.lim ? '#ffb020' : '#3a2a08'; g.beginPath(); g.arc(352, 30, 10, 0, 2 * PI); g.fill(); g.fillStyle = '#0b0c0e'; g.font = 'bold 6px system-ui'; g.fillText('RPM', 352, 32);
  g.fillStyle = '#050506'; g.beginPath(); g.arc(cx, cy, R + 6, 0, 2 * PI); g.fill();
  g.fillStyle = '#878d93'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill();
  scale(g, cx, cy, R, a, MAX / 1000, .5, 1, '#ffffff', 'bold 16px system-ui', 30, sp.red / 1000, '#e0261c');
  g.fillStyle = '#ffffff'; g.font = 'bold 10px system-ui'; g.fillText('X 1000 RPM', cx - 6, cy - 34);
  g.fillStyle = lcd; rr(g, cx + 36, cy - 30, 26, 66, 4); g.fill();
  const fr = S.fuel / sp.fuel.cap; for (let i = 0; i < 8; i++) { g.fillStyle = fr > (i + .5) / 8 ? ink : 'rgba(0,0,0,.1)'; g.fillRect(cx + 40, cy + 26 - i * 7.4, 18, 5); }
  ndl(g, cx, cy, a(Math.min(rpm, MAX * 1.02) / MAX), R - 12, '#ff5a2a', 5, 0); g.fillStyle = '#2a2c30'; g.beginPath(); g.arc(cx, cy, 14, 0, 2 * PI); g.fill();
  g.fillStyle = lcd; rr(g, 342, 56, 152, 116, 8); g.fill(); g.fillStyle = ink;
  g.textAlign = 'right'; g.font = 'bold 15px ' + MONO; g.fillText(clk(now), 484, 76);
  g.font = 'bold 60px ' + MONO; g.fillStyle = 'rgba(0,0,0,.08)'; g.fillText('188', 460, 132); g.fillStyle = ink; g.fillText(S.keyT < 1.2 ? 188 : kmh(), 460, 132);
  g.font = 'bold 10px system-ui'; g.textAlign = 'left'; g.fillText('km/h', 462, 132); g.fillText('ODO', 350, 162);
  g.textAlign = 'right'; g.font = 'bold 16px ' + MONO; g.fillText((S.odo / 1000).toFixed(1), 484, 162);
  g.textAlign = 'left'; g.font = 'bold 13px system-ui';
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 346, 194); }
  else if (S.cl > .05) { g.fillStyle = '#ffb020'; g.fillText('CLUTCH ' + (S.cl * 100 | 0) + '%', 346, 194); }
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
/* h2: Ninja H2. Black analog tach with red numbers (0 at 5 o'clock, 15 degrees per 1000, big 6-16, small 1-4), dot marks and a
   red needle; the blue negative LCD overlaps its right side: BOOST bar (rpm² × load, like the real one rising with revs) and
   clock on top, big GEAR bottom left, speed on the right, fuel under the boost */
function h2(g, sp) {
  const MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), cx = 124, cy = 114, R = 102, a = v => PI * (1 / 3 + 4 / 3 * v), K = MAX / 1000;
  g.fillStyle = '#060607'; rr(g, 4, 4, 504, 216, 30); g.fill(); g.strokeStyle = '#2b2f36'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#0b0c0e'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill(); g.strokeStyle = '#3a3f47'; g.lineWidth = 4; g.stroke();
  g.textAlign = 'center';
  for (let k = 0; k <= K * 2; k++) { const t = a(k / 2 / K), c = Math.cos(t), s = Math.sin(t), v = k / 2, big = v >= 6 && v % 2 === 0, num = big || (v <= 4 && v % 1 === 0);
    g.fillStyle = v * 1000 >= sp.red ? '#ff3b2f' : '#e9dfc0'; g.beginPath(); g.arc(cx + c * (R - 34), cy + s * (R - 34), k % 2 ? 1.6 : 2.6, 0, 2 * PI); g.fill();
    if (num) { g.fillStyle = '#ff3b2f'; g.font = 'bold ' + (big ? 22 : 15) + 'px system-ui'; g.fillText(v, cx + c * (R - 16), cy + s * (R - 16) + (big ? 8 : 5)); } }
  g.font = 'bold 10px system-ui'; g.fillStyle = '#e6e9ee'; g.fillText('x1000', cx - 34, cy + 2); g.fillText('r/min', cx - 34, cy + 13);
  ndl(g, cx, cy, a(Math.min(rpm, MAX * 1.02) / MAX), R - 30, '#e0261c', 5, 0); g.fillStyle = '#1a1b1e'; g.beginPath(); g.arc(cx, cy, 13, 0, 2 * PI); g.fill();
  // LCD
  const lit = '#f2f6ff', dim = 'rgba(255,255,255,.13)'; g.fillStyle = '#05070a'; rr(g, 192, 40, 308, 152, 8); g.fill(); g.fillStyle = '#1f55d6'; rr(g, 198, 46, 296, 140, 5); g.fill();
  const bo = boostOf(sp); g.textAlign = 'left'; g.font = 'bold 13px system-ui'; g.fillStyle = lit; g.fillText('BOOST', 250, 62); g.fillRect(232, 66, 106, 2);
  for (let i = 0; i < 10; i++) { g.fillStyle = bo > (i + .5) / 10 ? lit : dim; g.fillRect(234 + i * 10.4, 71, 8, 9); }
  g.font = 'bold 9px system-ui'; g.fillStyle = lit; g.fillText('KTRC', 204, 58);
  g.textAlign = 'right'; g.font = 'bold 17px ' + MONO; g.fillText(clk(now), 484, 66);
  g.textAlign = 'left'; g.font = 'bold 10px system-ui'; g.fillText('GEAR', 206, 104); if (ctx.bcfg.qs !== false) { g.fillRect(238, 95, 28, 11); g.fillStyle = '#1f55d6'; g.fillText('KQS', 241, 104); g.fillStyle = lit; }
  g.font = 'bold 72px ' + MONO; g.fillText(S.gear || 'N', 212, 176);
  g.textAlign = 'right'; g.font = 'bold 78px ' + MONO; g.fillText(kmh(), 452, 176); g.font = 'bold 11px system-ui'; g.textAlign = 'left'; g.fillText('km/h', 456, 176);
  const fr = S.fuel / sp.fuel.cap; for (let i = 0; i < 6; i++) { g.fillStyle = fr > (i + .5) / 6 ? (fr < .18 ? '#ff9a8a' : lit) : dim; g.fillRect(360 + i * 12, 71, 10, 9); }
  g.font = 'bold 9px system-ui'; g.fillStyle = lit; g.fillText('FUEL', 360, 62);
  g.font = 'bold 14px system-ui';
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 262, 28); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('SHIFT', 262, 28); }
  else if (S.cl > .05) { g.fillStyle = '#ffb020'; g.fillText('CLUTCH ' + (S.cl * 100 | 0) + '%', 262, 28); }
}
// supercharger boost 0..1 for the gauge: a centrifugal compressor's pressure rise goes with impeller speed², scaled by throttle
const boostOf = sp => S.running ? Math.min(1, (S.rpm / sp.red) ** 2) * (S.thrEff || 0) : 0;
/* smash: Suzuki Smash 115, 0-140 km/h analog with a red needle and drum odometer. Carb: white "sports watch" dial, small fuel
   gauge beside it (F on top), the lamps in an arc on the right (turn, 4-3-2-1 amber, N green, high beam). Fi: black dial in a
   teal ring starting at 9 o'clock, N-1-2-3-4 gear lamps stepping down to the right, fuel gauge top right, FI check lamp */
function smash(g, sp) {
  g.fillStyle = '#121418'; rr(g, 4, 4, 504, 216, 70); g.fill(); g.strokeStyle = '#3a3f47'; g.lineWidth = 6; g.stroke();
  const MAX = 140, v = Math.min(kmh(), MAX + 4), fr = S.fuel / sp.fuel.cap, lamp = (x, y, w, h, on, c1, c0, t) => { g.fillStyle = on ? c1 : c0; rr(g, x, y, w, h, 6); g.fill(); g.fillStyle = on ? '#140c00' : 'rgba(255,255,255,.28)'; g.font = 'bold ' + (h - 8) + 'px system-ui'; g.textAlign = 'center'; g.fillText(t, x + w / 2, y + h - 7); };
  g.textAlign = 'left'; g.font = 'bold 14px system-ui';
  if (sp.carb) {
    const cx = 146, cy = 112, R = 98, a = u => PI * (.78 + 1.44 * u);
    g.fillStyle = '#0a0b0c'; g.beginPath(); g.arc(cx, cy, R + 5, 0, 2 * PI); g.fill(); g.fillStyle = '#f1f1ec'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill();
    scale(g, cx, cy, R, a, MAX, 10, 20, '#16171a', 'bold 15px system-ui', 32);
    g.strokeStyle = '#d42a1e'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R - 46, a(0), a(1)); g.stroke();
    drum(g, cx - 30, cy - 34, 5); g.fillStyle = '#16171a'; g.font = 'italic bold 12px system-ui'; g.fillText('km/h', cx, cy + 46);
    ndl(g, cx, cy, a(v / MAX), R - 14, '#d42a1e', 5); g.fillStyle = '#16171a'; g.beginPath(); g.arc(cx, cy, 12, 0, 2 * PI); g.fill();
    const fx = 336, fy = 112; g.fillStyle = '#0a0b0c'; g.beginPath(); g.arc(fx - 16, fy, 44, 0, 2 * PI); g.fill();
    g.strokeStyle = '#f1f1ec'; g.lineWidth = 3; g.beginPath(); g.arc(fx, fy, 40, PI * .78, PI * 1.22); g.stroke(); g.strokeStyle = '#d42a1e'; g.beginPath(); g.arc(fx, fy, 40, PI * .78, PI * .86); g.stroke();
    g.fillStyle = '#f1f1ec'; g.font = 'bold 13px system-ui'; g.fillText('F', fx - 22, fy - 28); g.fillText('E', fx - 22, fy + 37);
    ndl(g, fx, fy, PI * (.8 + .4 * fr), 36, '#d42a1e', 3, 0); g.fillStyle = '#2a2c30'; g.beginPath(); g.arc(fx, fy, 6, 0, 2 * PI); g.fill();
    for (let i = 0; i < 7; i++) { const th = (-54 + i * 18) * PI / 180, x = 318 + 122 * Math.cos(th) - 20, y = 112 + 104 * Math.sin(th) - 12, gr = 5 - i;
      if (i === 0) lamp(x, y, 40, 24, false, '', '#12301c', '⇔'); else if (i === 6) lamp(x, y, 40, 24, false, '', '#10203a', '≡D');
      else lamp(x, y, 40, 24, S.gear === gr, gr ? '#ff8a1e' : '#43e07a', gr ? '#3a2412' : '#12301c', gr || 'N'); }
    g.textAlign = 'left'; g.font = 'bold 13px system-ui'; if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 250, 200); } else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('LIMIT', 250, 200); }
  } else {
    const cx = 132, cy = 106, R = 94, a = u => PI * (1 + 1.36 * u);
    g.strokeStyle = '#11a587'; g.lineWidth = 9; g.fillStyle = '#0a0c0e'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill(); g.stroke();
    scale(g, cx, cy, R - 6, a, MAX, 10, 20, '#ffffff', 'bold 16px system-ui', 32);
    g.strokeStyle = '#d42a1e'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R - 52, a(0), a(1)); g.stroke();
    g.fillStyle = '#ffffff'; g.font = 'italic bold 11px system-ui'; g.textAlign = 'center'; g.fillText('km/h', cx - 24, cy + 30); drum(g, cx - 54, cy + 36, 5);
    ndl(g, cx, cy, a(v / MAX), R - 18, '#e0261c', 5); g.fillStyle = '#e0261c'; g.beginPath(); g.arc(cx, cy, 11, 0, 2 * PI); g.fill();
    for (let i = 0; i <= 4; i++) lamp(246 + i * 47, 138 + i * 7, 41, 38, S.gear === i, i ? '#ff9a3a' : '#43e07a', i ? '#4a2a1c' : '#134a38', i || 'N');
    const fx = 404, fy = 96; g.strokeStyle = '#11a587'; g.lineWidth = 5; g.beginPath(); g.arc(fx, fy, 56, PI * 1.08, PI * 1.92); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { const t = PI * (1.14 + .72 * i / 4); g.beginPath(); g.moveTo(fx + Math.cos(t) * 46, fy + Math.sin(t) * 46); g.lineTo(fx + Math.cos(t) * 36, fy + Math.sin(t) * 36); g.stroke(); }
    g.fillStyle = '#ffffff'; g.font = 'bold 14px system-ui'; g.textAlign = 'center'; g.fillText('E', fx - 50, fy + 10); g.fillText('F', fx + 50, fy + 10);
    ndl(g, fx, fy, PI * (1.14 + .72 * fr), 40, '#e0261c', 4, 0); g.fillStyle = '#e0261c'; g.beginPath(); g.arc(fx, fy, 8, 0, 2 * PI); g.fill();
    g.textAlign = 'left'; g.font = 'bold 15px system-ui'; g.fillStyle = !S.running ? '#ffb020' : '#3a2a12'; g.fillText('FI', 262, 62);
    g.font = 'bold 13px system-ui'; if (!S.running) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 250, 118); } else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('LIMIT', 250, 118); }
  }
}
/* tmx: Honda TMX Supremo (official Honda PH panel photo). Dark twin dials with white marks and orange needles: speedo left
   (0-160, red band from 100, drum odometer), tacho right (x1000 r/min, red from the redline, N and high-beam lamps in its
   face), red LED gear digit between them, fuel needle gauge E-F on top with the turn arrows.
   Macho 125 shares the layout (0-140 speedo; no cluster photo of it was found) */
function tmx(g, sp) {
  g.fillStyle = '#0d0e10'; rr(g, 4, 4, 504, 216, 56); g.fill(); g.strokeStyle = '#3a3f47'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#2a2c2f'; rr(g, 14, 12, 484, 200, 48); g.fill();
  const or = '#ff8a1e', vmax = ctx.bike.id === 'macho125' ? 140 : 160, K = sp.tachMax / 1000, cy = 116, R = 92;
  const dial = (cx, a, max, step, lab, val, red, font) => {
    g.fillStyle = '#17181a'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * PI); g.fill(); g.strokeStyle = '#0a0a0b'; g.lineWidth = 4; g.stroke();
    g.strokeStyle = '#4a1414'; g.lineWidth = 16; g.beginPath(); g.arc(cx, cy, R - 30, a(0), a(1)); g.stroke();
    g.strokeStyle = '#d21f1f'; g.lineWidth = 9; g.beginPath(); g.arc(cx, cy, R - 10, a(red / max), a(1)); g.stroke();
    scale(g, cx, cy, R, a, max, step, lab, '#ffffff', font, 31);
    return () => { ndl(g, cx, cy, a(Math.min(val, max * 1.03) / max), R - 12, or, 5, 0); g.fillStyle = '#222326'; g.beginPath(); g.arc(cx, cy, 13, 0, 2 * PI); g.fill(); };
  };
  const n1 = dial(116, v => PI * (.82 + 1.42 * v), vmax, 5, 20, Math.abs(S.v) * 3.6, 100, 'italic bold 14px system-ui');
  drum(g, 116 - 34, cy - 30, 6); g.fillStyle = '#ffffff'; g.font = 'italic bold 12px system-ui'; g.fillText('km/h', 116, cy + 56); n1();
  const n2 = dial(396, v => PI * (1.04 + 1.08 * v), K, .5, 1, dispRpm(sp) / 1000, sp.red / 1000, 'italic bold 15px system-ui');
  g.fillStyle = '#ffffff'; g.font = 'italic bold 10px system-ui'; g.fillText('×1000r/min', 396, cy + 34);
  g.fillStyle = S.gear ? '#33373c' : '#43e07a'; g.beginPath(); g.arc(376, cy + 58, 11, 0, 2 * PI); g.fill(); g.fillStyle = '#33373c'; g.beginPath(); g.arc(418, cy + 58, 11, 0, 2 * PI); g.fill();
  g.fillStyle = S.gear ? '#9aa0a8' : '#06200f'; g.font = 'bold 14px system-ui'; g.fillText('N', 376, cy + 63); g.fillStyle = '#9aa0a8'; g.font = 'bold 10px system-ui'; g.fillText('≡D', 418, cy + 62); n2();
  // fuel gauge + turn arrows on top
  g.fillStyle = '#17181a'; g.beginPath(); g.moveTo(196, 20); g.lineTo(316, 20); g.lineTo(300, 58); g.lineTo(212, 58); g.closePath(); g.fill();
  const fr = S.fuel / sp.fuel.cap, fa = v => PI * (1.22 + .56 * v); g.strokeStyle = '#ffffff'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { const t = fa(i / 4); g.strokeStyle = i ? '#ffffff' : '#d21f1f'; g.beginPath(); g.moveTo(256 + Math.cos(t) * 40, 70 + Math.sin(t) * 40); g.lineTo(256 + Math.cos(t) * 32, 70 + Math.sin(t) * 32); g.stroke(); }
  g.fillStyle = '#ffffff'; g.font = 'italic bold 13px system-ui'; g.fillText('E', 222, 52); g.fillText('F', 290, 52); g.fillStyle = '#5a6068'; g.fillText('⇦', 206, 36); g.fillText('⇨', 306, 36);
  ndl(g, 256, 70, fa(fr), 36, or, 3, -14);
  // red LED gear digit
  g.fillStyle = '#060303'; rr(g, 234, 92, 44, 56, 4); g.fill(); g.textAlign = 'center'; g.font = 'bold 44px ' + MONO; g.fillStyle = '#2a0808'; g.fillText('8', 256, 136);
  if (S.gear) { g.fillStyle = '#ff2a1e'; g.fillText(S.gear, 256, 136); }
  if (!S.running) { g.fillStyle = '#ff4a3d'; g.font = 'bold 12px system-ui'; g.fillText('OFF', 256, 172); }
}
/* NMAX Tech MAX / XMAX: two screens under one cover. LCD on top: big speed, fuel bar, ODO. Colour TFT below: clock, the tach
   as a band of thin lines 0-10 that fills with a glowing head, and on the NMAX the T / S mode badge, YECVT and the three
   Y-Shift steps. Telltales (TCS, Stop & Start "A", engine) in the bezel either side. x = 1: XMAX (amber, no YECVT / S&S) */
function maxTft(g, sp, x) {
  const MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), blink = (performance.now() / 400 | 0) % 2, acc = x ? '#ffb347' : '#59e0f0', off = '#23282f', K = MAX / 1000;
  g.fillStyle = '#05070a'; rr(g, 4, 4, 504, 216, 30); g.fill(); g.strokeStyle = '#2a2f36'; g.lineWidth = 4; g.stroke();
  g.font = 'bold 14px system-ui'; g.textAlign = 'center';
  if (sp.tc) { g.fillStyle = ctx.bcfg.tc === false ? '#ffb020' : (S.tcF ?? 1) < .95 && blink ? '#ffb020' : off; g.fillText('TCS', 44, 76); if (ctx.bcfg.tc === false) g.fillText('OFF', 44, 92); }
  if (!x) { g.fillStyle = S.issOff ? (blink ? '#43e07a' : off) : ctx.bcfg.iss ? '#2d5a3a' : off; g.beginPath(); g.arc(468, 150, 11, 0, 2 * PI); g.lineWidth = 2; g.strokeStyle = g.fillStyle; g.stroke(); g.fillText('A', 468, 155); }
  g.fillStyle = !S.running && !S.issOff ? '#ffb020' : S.lim && (performance.now() / 90 | 0) % 2 ? '#ffb020' : off; g.fillText('FI', 468, 82);
  // LCD
  g.fillStyle = '#0b0d10'; rr(g, 84, 10, 344, 88, 8); g.fill();
  g.textAlign = 'right'; g.font = 'bold 80px ' + MONO; g.fillStyle = '#ffffff'; g.fillText(kmh(), 262, 86); g.font = 'bold 11px system-ui'; g.textAlign = 'left'; g.fillText('km/h', 266, 86);
  const fr = S.fuel / sp.fuel.cap; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(300, 20, 116, 24);
  for (let i = 0; i < 6; i++) if (fr > (i + .5) / 6) { g.fillStyle = fr < .18 ? '#ff4a3d' : '#ffffff'; g.fillRect(304 + i * 18.4, 24, 16, 16); }
  g.fillStyle = fr > 1 / 12 ? '#0b0d10' : '#ffffff'; g.font = 'bold 11px system-ui'; g.fillText('E', 307, 37); g.fillStyle = fr > 11 / 12 ? '#0b0d10' : '#ffffff'; g.fillText('F', 402, 37);
  g.fillStyle = '#ffffff'; g.fillText('ODO', 300, 62); g.textAlign = 'right'; g.font = 'bold 22px ' + MONO; g.fillText((S.odo / 1000).toFixed(1), 396, 88); g.font = 'bold 10px system-ui'; g.fillText('km', 416, 88);
  // TFT
  g.fillStyle = '#000000'; rr(g, 84, 102, 344, 110, 8); g.fill();
  g.textAlign = 'left'; g.font = 'bold 15px system-ui'; g.fillStyle = '#ffffff'; g.fillText(now.h + ((now.s & 1) ? ':' : ' ') + String(now.m).padStart(2, '0'), 96, 121);
  const bh = x ? 44 : 24, N = 53, head = rpm / MAX * (N - 1);
  for (let i = 0; i < N; i++) { const r0 = i / (N - 1) * MAX, on = rpm > r0 && rpm > 0; g.fillStyle = on ? (r0 >= sp.red ? '#ff3b2f' : head - i < 4 ? '#ffffff' : acc) : (r0 >= sp.red ? '#3a1512' : off); g.fillRect(100 + i * 6, 128, on ? 4 : 2, bh); }
  g.font = 'bold 12px system-ui'; g.textAlign = 'center'; for (let k = 0; k <= K; k++) { g.fillStyle = k * 1000 >= sp.red ? '#ff3b2f' : k * 1000 <= rpm ? '#ffffff' : '#7d8794'; g.fillText(k, 102 + k / K * 312, 144 + bh); }
  g.font = 'bold 9px system-ui'; g.textAlign = 'right'; g.fillStyle = '#7d8794'; g.fillText('x1000r/min', 416, 120);
  if (!x) { // T / S mode badge, YECVT, Y-Shift steps
    const m = ctx.bcfg.ysp ? 'S' : 'T', mc = m === 'S' ? '#e8452c' : '#2fa8ff'; g.strokeStyle = mc; g.lineWidth = 3; g.beginPath(); g.arc(114, 190, 14, 0, 2 * PI); g.stroke();
    g.fillStyle = mc; g.font = 'bold 18px system-ui'; g.textAlign = 'center'; g.fillText(m, 114, 196); g.fillRect(322, 108, 18, 16); g.fillStyle = '#000'; g.font = 'bold 13px system-ui'; g.fillText(m, 331, 121);
    g.textAlign = 'left'; g.font = 'bold 11px system-ui'; g.fillStyle = '#cfd6de'; g.fillText('YECVT', 136, 184);
    for (let i = 0; i < 3; i++) { g.fillStyle = S.ysh > i ? '#ff8a3a' : '#3a4048'; g.fillRect(190 + i * 74, 196 - i * 5, 68, 7); g.fillStyle = '#cfd6de'; g.fillText(i + 1, 262 + i * 74 - (i === 2 ? 14 : 8), 190 - i * 5); }
  }
  if (!S.running && !S.issOff) { g.textAlign = 'left'; g.font = 'bold 13px system-ui'; g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 160, 121); }
}
/* nmax: NMAX 155 Standard = one negative LCD (tach arc across the top, big speed, fuel, clock, odometer, TCS, Stop & Start).
   Tech MAX (YECVT) and the XMAX 300 (x = 1) have the two-screen panel: maxTft() */
function nmax(g, sp, x = 0) {
  if (x || sp.yec) return maxTft(g, sp, x);
  const tft = x || !!sp.yec, MAX = sp.tachMax, rpm = dispRpm(sp), now = phNow(), N = 40, blink = (performance.now() / 400 | 0) % 2;
  const bg = tft ? '#06080c' : '#0b1a22', lit = tft ? '#ffffff' : '#bfefff', dim = tft ? '#1a2029' : '#13303b', acc = x ? '#ffb347' : tft ? '#2fa8ff' : lit, sub = tft ? '#8b96a5' : '#7fb2c4';
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
  if (tft && !x) { // T / S mode badge, Y-Shift level pips
    const m = ctx.bcfg.ysp ? 'S' : 'T'; g.fillStyle = m === 'S' ? '#ff6a2a' : '#2fa8ff'; rr(g, 36, 134, 34, 30, 7); g.fill(); g.fillStyle = '#05070a'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.fillText(m, 53, 157);
    g.textAlign = 'left'; g.font = 'bold 13px system-ui'; g.fillStyle = sub; g.fillText('Y-SHIFT', 80, 146);
    for (let i = 0; i < 3; i++) { g.fillStyle = S.ysh > i ? '#ffb020' : dim; g.fillRect(80 + i * 20, 152, 16, 10); }
  }
  g.font = 'bold 14px system-ui'; g.textAlign = 'left';
  if (sp.tc) { g.fillStyle = ctx.bcfg.tc === false ? '#ffb020' : S.tcF < .95 ? (blink ? '#ffb020' : dim) : dim; g.fillText(ctx.bcfg.tc === false ? 'TCS OFF' : 'TCS', 410, 122); }
  if (!x) { g.fillStyle = S.issOff ? (blink ? '#43e07a' : dim) : ctx.bcfg.iss ? (tft ? '#2d5a3a' : '#3d6b7a') : dim; g.fillText('S/S', 360, 122); } // XMAX: no Stop & Start
  if (!S.running && !S.issOff) { g.fillStyle = '#ff4a3d'; g.fillText('ENGINE OFF', 140, 122); }
  else if (S.lim && (performance.now() / 90 | 0) % 2) { g.fillStyle = '#ff3b2f'; g.fillText('FI', 140, 122); }
}
// key off: the dash is dead
function dead(g) { g.fillStyle = '#05070a'; rr(g, 4, 4, 504, 216, 26); g.fill(); }
const CLUSTERS = { sport, scooter, aerox, sniper, ns, tft, smash, tmx, h2, nmax, xmax: (g, sp) => nmax(g, sp, 1) };
// Redrawn only when something on it changes; the texture is uploaded to the GPU only while the in-world cluster can
// be seen (1st person / garage). In 3rd person the same canvas is shown as the on-screen HUD, no upload needed.
let cluKey = '', texDirty = true;
export function drawCluster(inWorld = true, hold = false) { // hold: redraw the canvas but leave the upload for a later frame
  const sp = ctx.spec, bl = (performance.now() / 90 | 0) % 2, now = phNow();
  const key = [ctx.bike.id, Math.round(Math.abs(S.v) * 3.6), S.gear, S.key, S.running, S.keyT < 1.2, Math.ceil(dispRpm(sp) / sp.tachMax * 56), (S.fuel / sp.fuel.cap * 100 | 0), S.lim && bl, S.cl > .05 ? S.cl * 100 | 0 : -1,
    ctx.bike.cluster === 'tft' ? [now.m, now.s & 1, (S.odo / 100) | 0, ctx.bcfg.autoClutch, S.running && S.rpm >= sp.red - 600 && (performance.now() / 70 | 0) % 2].join() :
    ctx.bike.cluster === 'scooter' || ctx.bike.cluster === 'aerox' ? [now.m, now.s & 1, (S.odo / 100) | 0, Math.round(ecoV() * 12), sp.tc, ctx.bcfg.tc, (S.tcF ?? 1) < .95, S.issOff && (performance.now() / 400 | 0) % 2, ctx.bcfg.iss, S.issOff].join() :
    ctx.bike.cluster === 'h2' ? [now.m, now.s & 1, Math.round(boostOf(sp) * 10), ctx.bcfg.qs].join() :
    ctx.bike.cluster === 'nmax' || ctx.bike.cluster === 'xmax' ? [now.m, now.s & 1, (S.odo / 100) | 0, S.ysh, ctx.bcfg.ysp, sp.yec, ctx.bcfg.tc, (S.tcF ?? 1) < .95 && (performance.now() / 400 | 0) % 2, S.issOff && (performance.now() / 400 | 0) % 2, ctx.bcfg.iss, S.issOff].join() :
    ctx.bike.cluster === 'smash' ? [(S.odo / 1000) | 0, sp.carb].join() : [now.m, now.s & 1, (S.odo / 100) | 0, S.running && S.rpm >= sp.red - 500].join()].join('|');
  if (key !== cluKey) { cluKey = key; gc.clearRect(0, 0, 512, 224); (S.key ? CLUSTERS[ctx.bike.cluster] : dead)(gc, sp); texDirty = true; }
  if (inWorld && texDirty && !hold) { cluTex.needsUpdate = true; texDirty = false; return true; }
  return false;
}

/* minimap */
const mm = $('mini').getContext('2d'); let miniKey = '';
export function drawMini(MAP, V) { // V = world.js MAPV {cx, cz, w metres, n px}
  const P0 = at(), U = ctx.ug, P = U && U.on && U.portal ? { x: U.portal.x, z: U.portal.z, psi: P0.psi } : P0, MI0 = ctx.MI, k = (P.x * 2 | 0) + ',' + (P.z * 2 | 0) + ',' + (P.psi * 100 | 0) + ',' + (MI0 ? MI0.pk : '') + (ctx.mpK || '') + (ctx.wpK || '');
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
    let m = 0, q = null; mm.strokeStyle = '#a78bfa'; mm.lineWidth = 3.5; mm.lineCap = mm.lineJoin = 'round'; mm.beginPath(); // the route (map.js WP.path); its length is the distance shown
    for (const p of WP.path || []) { const ex = (px(p[0]) - u) * Z, ez = (pz(p[1]) - v) * Z; mm.lineTo(70 + ex * ca - ez * sa, 70 + ex * sa + ez * ca); if (q) m += Math.hypot(p[0] - q[0], p[1] - q[1]); q = p; } mm.stroke();
    mm.fillStyle = '#a78bfa'; mm.strokeStyle = '#fff'; mm.lineWidth = 1.6;
    if (f < 1) { mm.save(); mm.translate(cx, cy); mm.rotate(Math.atan2(Y, X)); mm.beginPath(); mm.moveTo(8, 0); mm.lineTo(-5, -6); mm.lineTo(-2, 0); mm.lineTo(-5, 6); mm.closePath(); mm.fill(); mm.stroke(); mm.restore(); }
    else { mm.beginPath(); mm.arc(cx, cy, 5.5, 0, 7); mm.fill(); mm.stroke(); mm.fillStyle = '#fff'; mm.beginPath(); mm.arc(cx, cy, 1.8, 0, 7); mm.fill(); }
    const t = m < 1000 ? (m | 0) + ' m' : (m / 1000).toFixed(1) + ' km'; mm.font = 'bold 9px system-ui'; const w = mm.measureText(t).width + 12;
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
export function updPerf(API) { // up to 4 lines (the layout reserves room for them): API + fps / physics + draws + res / cpu / hitches
  const f = cfg.showFps, a = [], b = []; if (cfg.showApi) a.push(API); if (f) a.push(fpsV + ' fps'); if (f && physV) b.push(physV); if (f && gfxV) b.push(gfxV);
  const L = [a.join(' · '), b.join(' · ')]; if (f && jankV) L.push(...jankV.split('\n')); const t = L.filter(Boolean).join('\n'); $('perf').textContent = t; $('perf').hidden = !t; }
