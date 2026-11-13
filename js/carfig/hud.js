// The driver's UI for cars (js/carfig/drive.js): the dash meter (one canvas: on screen and on the model's dash), touch pedals /
// steering wheel / gear buttons, and the keyboard's one-shot keys. Its DOM and CSS are made here, shown only while body.car is set.
import * as THREE from 'three';
import { cfg } from '../config.js';

const el = (tag, id, html, par = document.body) => { const e = document.createElement(tag); e.id = id; if (html) e.innerHTML = html; par.appendChild(e); return e; };
const css = document.createElement('style'); css.textContent = `
#carUI{display:none;position:fixed;inset:0;pointer-events:none;z-index:6;font:600 13px system-ui,sans-serif;user-select:none;-webkit-user-select:none}
body.car #carUI{display:block} body.car.gar #carUI,body.car.opt #carUI,body.car.menu #carUI{display:none}
body.car #joy,body.car #jumpB{display:none!important}
#carClu{position:absolute;left:50%;bottom:calc(8px + env(safe-area-inset-bottom));width:min(330px,44vw);transform:translateX(-50%);border-radius:14px;box-shadow:0 2px 14px #0008;opacity:var(--hud-op,1)}
#carUI .cp{position:absolute;pointer-events:auto;touch-action:none;display:none;align-items:center;justify-content:center;color:#fff;background:#0007;border:2px solid #fff5;border-radius:16px;backdrop-filter:blur(3px)}
body.touch #carUI .cp{display:flex} #carUI .cp.on{background:#fff4;border-color:#fff}
#cpWh{position:absolute;pointer-events:auto;touch-action:none;display:none;left:calc(12px + env(safe-area-inset-left));bottom:calc(12px + env(safe-area-inset-bottom));width:min(168px,40vw);height:min(168px,40vw)}
body.touch #cpWh{display:block} #cpWh svg{width:100%;height:100%;overflow:visible} #cpWh.on #cwRim{stroke:#fff}
#cpGas,#cpBrk{bottom:calc(18px + env(safe-area-inset-bottom));width:76px;border-radius:12px} #cpGas{right:calc(16px + env(safe-area-inset-right));height:128px} #cpBrk{right:calc(102px + env(safe-area-inset-right));height:96px}
#cpUp,#cpDn,#cpHb,#cpAuto{width:60px;height:48px;right:calc(16px + env(safe-area-inset-right))} #cpUp{bottom:calc(216px + env(safe-area-inset-bottom))} #cpDn{bottom:calc(160px + env(safe-area-inset-bottom))}
#cpHb,#cpAuto{right:calc(86px + env(safe-area-inset-right))} #cpHb{bottom:calc(160px + env(safe-area-inset-bottom))} #cpAuto{bottom:calc(216px + env(safe-area-inset-bottom));font-size:11px}`;
document.head.appendChild(css);
const UI = el('div', 'carUI'), cv = el('canvas', 'carClu', '', UI); cv.width = 420; cv.height = 150; const g = cv.getContext('2d');
export const cluTex = new THREE.CanvasTexture(cv); cluTex.colorSpace = THREE.SRGBColorSpace; cluTex.generateMipmaps = false; cluTex.minFilter = THREE.LinearFilter;
// what the driver's hands and feet ask for: analog 0..1 pads + one-shot presses (up / dn / auto), read and cleared by drive.js
export const PAD = { gas: 0, brk: 0, hb: 0, up: 0, dn: 0, auto: 0, live: false };
const pad = (id, txt, down, up) => {
  const e = el('div', id, txt, UI); e.className = 'cp';
  e.addEventListener('pointerdown', ev => { ev.preventDefault(); e.setPointerCapture(ev.pointerId); e.classList.add('on'); down(); });
  const off = () => { e.classList.remove('on'); if (up) up(); }; e.addEventListener('pointerup', off); e.addEventListener('pointercancel', off); return e;
};
// the steering wheel: grab it anywhere and turn it round its centre, like the bikes' bar (controls.js #wheel). WA = the wheel's angle
// (rad, + = clockwise = right), WMAX its lock (Options > sensitivity, as on the bikes); let go and it self-centres (drive.js).
export const WH = { a: 0, id: null }; export const WMAX = () => 2.3 * 10 / (cfg.sens || 10);
const wh = el('div', 'cpWh', `<svg viewBox="-62 -62 124 124"><circle r="58" fill="#0005"/><g id="cwG" fill="none" stroke-linecap="round">
<circle id="cwRim" r="50" stroke="#fffb" stroke-width="9"/><circle r="50" stroke="#0006" stroke-width="2" stroke-dasharray="3 9"/>
<path d="M-46 6 L-14 8 M46 6 L14 8 M0 16 L0 46" stroke="#fff9" stroke-width="8"/><circle r="15" fill="#1a1c20" stroke="#fffa" stroke-width="2"/>
<path d="M0 -55 L0 -45" stroke="#ff7a1a" stroke-width="7"/></g></svg>`, UI), wg = wh.querySelector('#cwG');
let pa = 0, wcx = 0, wcy = 0;
wh.addEventListener('pointerdown', e => { e.preventDefault(); wh.setPointerCapture(e.pointerId); const r = wh.getBoundingClientRect(); wcx = r.left + r.width / 2; wcy = r.top + r.height / 2; WH.id = e.pointerId; pa = Math.atan2(e.clientY - wcy, e.clientX - wcx); wh.classList.add('on'); });
wh.addEventListener('pointermove', e => {
  if (WH.id !== e.pointerId) return; const dx = e.clientX - wcx, dy = e.clientY - wcy; if (dx * dx + dy * dy < 200) return; // near the hub the angle is noise
  const a = Math.atan2(dy, dx); let d = a - pa; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; pa = a; WH.a = Math.max(-WMAX(), Math.min(WMAX(), WH.a + d));
});
const wup = e => { if (WH.id === e.pointerId) { WH.id = null; wh.classList.remove('on'); } }; wh.addEventListener('pointerup', wup); wh.addEventListener('pointercancel', wup);
let wLast = ''; export function hudWheel(a) { const t = 'rotate(' + (a * 57.3).toFixed(1) + ')'; if (t !== wLast) { wLast = t; wg.setAttribute('transform', t); } }
pad('cpGas', 'GAS', () => { PAD.gas = 1; }, () => { PAD.gas = 0; }); pad('cpBrk', 'BRAKE', () => { PAD.brk = 1; }, () => { PAD.brk = 0; });
pad('cpUp', '▲', () => { PAD.up = 1; }); pad('cpDn', '▼', () => { PAD.dn = 1; });
const hbE = pad('cpHb', 'P', () => { PAD.hb = PAD.hb ? 0 : 1; }, () => hbE.classList.toggle('on', !!PAD.hb)), auE = pad('cpAuto', 'AUTO', () => { PAD.auto = 1; });
addEventListener('keydown', e => {
  if (!PAD.live || e.repeat || e.target.type === 'text') return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX') PAD.up = 1; else if (e.code === 'ControlLeft' || e.code === 'KeyZ') PAD.dn = 1; else if (e.code === 'KeyM') PAD.auto = 1;
});
export function hudShow(on) { PAD.live = on; document.body.classList.toggle('car', on); if (!on) { PAD.gas = PAD.brk = PAD.hb = PAD.up = PAD.dn = PAD.auto = 0; WH.a = 0; WH.id = null; wh.classList.remove('on'); hbE.classList.remove('on'); } }

// three round dials like the real meter: tachometer, speedometer in the middle, fuel; orange needles on black
const dial = (x, y, r, a0, a1, v, n, lab, red) => {
  g.strokeStyle = '#3a3d42'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  g.fillStyle = '#e8e8e4'; g.font = `600 ${r > 50 ? 11 : 9}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n, c = Math.cos(a), s = Math.sin(a), hot = red != null && i / n >= red; g.strokeStyle = hot ? '#e23b2a' : '#e8e8e4'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x + c * r * .88, y + s * r * .88); g.lineTo(x + c * r * .98, y + s * r * .98); g.stroke(); if (lab) { g.fillStyle = hot ? '#e23b2a' : '#e8e8e4'; g.fillText(lab(i), x + c * r * .7, y + s * r * .7); }
  }
  const a = a0 + (a1 - a0) * Math.min(1.03, Math.max(0, v)); g.strokeStyle = '#ff7a1a'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - Math.cos(a) * r * .15, y - Math.sin(a) * r * .15); g.lineTo(x + Math.cos(a) * r * .84, y + Math.sin(a) * r * .84); g.stroke();
  g.fillStyle = '#17181a'; g.beginPath(); g.arc(x, y, r * .13, 0, 7); g.fill();
};
let lastK = '';
// o: { kmh, rpm, vmax, rmax, red, fuel 0..1, gear 'R' | 'N' | '1'.., hb, auto, lit, odo km }
export function hudDraw(o) {
  const k = [o.kmh.toFixed(0), (o.rpm / 40 | 0), (o.fuel * 60 | 0), o.gear, o.hb, o.auto, o.lit, o.odo.toFixed(1)].join(); if (k === lastK) return; lastK = k;
  g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, 420, 150);
  const A0 = Math.PI * .75, A1 = Math.PI * 2.25, tn = Math.round(o.rmax / 1000), sn = Math.round(o.vmax / 20);
  dial(88, 80, 58, A0, A1, o.rpm / o.rmax, tn, i => i, o.red / o.rmax); dial(210, 76, 70, A0, A1, o.kmh / o.vmax, sn, i => i * 20); dial(338, 84, 44, Math.PI * .85, Math.PI * 1.65, o.fuel, 4, i => i === 0 ? 'E' : i === 4 ? 'F' : '');
  g.fillStyle = '#9a9c98'; g.font = '600 9px system-ui,sans-serif'; g.fillText('x1000 r/min', 88, 104); g.fillText('km/h', 210, 104); g.fillText('FUEL', 338, 104);
  g.fillStyle = '#16181b'; g.fillRect(180, 116, 60, 18); g.fillStyle = '#cfd2cc'; g.font = '600 11px ui-monospace,monospace'; g.fillText(o.odo.toFixed(1).padStart(7, '0'), 210, 126);
  g.font = '700 26px system-ui,sans-serif'; g.fillStyle = o.gear === 'R' ? '#ff5a3a' : o.gear === 'N' ? '#5fe07a' : '#f2f2ee'; g.fillText(o.gear, 384, 40);
  g.font = '700 10px system-ui,sans-serif'; g.fillStyle = o.hb ? '#ff3b2a' : '#3a2422'; g.fillText('(P)', 300, 132); g.fillStyle = o.auto ? '#5fe07a' : '#22302a'; g.fillText('AUTO', 338, 132); g.fillStyle = o.fuel < .12 ? '#ffb020' : '#30281a'; g.fillText('⛽', 376, 132);
  auE.classList.toggle('on', !!o.auto); cluTex.needsUpdate = true;
}
