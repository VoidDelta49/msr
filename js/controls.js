// Keyboard + touch input. main.js fills `actions` with the handlers.
import { $, PI, clamp, appr } from './util.js';
import { S, ctx } from './state.js';
import { cfg } from './config.js';
import { initAudio } from './audio.js';

export const actions = {};
export const K = {}, TC = { back: 0, st: 0, stId: null, thr: 0, thrId: null, brk: 0, clu: 0, wa: 0, cluId: null, rev: 0 };
addEventListener('keydown', e => {
  if (e.repeat) return; K[e.code] = true; const A = actions;
  if (e.code === 'KeyE' || e.code === 'ShiftLeft') A.shift(1); if (e.code === 'KeyQ' || e.code === 'ControlLeft') A.shift(-1);
  if (e.code === 'KeyR') A.start(); if (e.code === 'KeyC') A.cam(); if (e.code === 'KeyG') A.garage(); if (e.code === 'KeyP') A.park();
  if (e.code === 'KeyO') A.opts(); else if (e.code === 'Escape') A.closeOpts();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => { K[e.code] = false; });
addEventListener('blur', () => { for (const k in K) K[k] = false; });
if (matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
export function ptr(el, down, move, up) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); initAudio(); el.setPointerCapture(e.pointerId); down(e); });
  if (move) el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) move(e); });
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
const wEl = $('wheel'); export const WMAX = () => 2.3 * 10 / cfg.sens;
ptr(wEl, e => { const r = wEl.getBoundingClientRect(); TC.cx = r.left + r.width / 2; TC.cy = r.top + r.height / 2; TC.stId = e.pointerId; TC.pa = Math.atan2(e.clientY - TC.cy, e.clientX - TC.cx); },
  e => { const dx = e.clientX - TC.cx, dy = e.clientY - TC.cy; if (dx * dx + dy * dy < 256) return; const a = Math.atan2(dy, dx); let d = a - TC.pa; if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; TC.pa = a; TC.wa = clamp(TC.wa + d, -WMAX(), WMAX()); },
  () => { TC.stId = null; });
ptr($('thr'), e => { TC.thrId = e.pointerId; TC.ty = e.clientY; TC.thr = 0; $('thr').classList.add('on'); }, e => { TC.thr = clamp((e.clientY - TC.ty) / 70, 0, 1); // roll-on = drag down only, up does nothing }, () => { TC.thrId = null; TC.thr = 0; $('thr').classList.remove('on'); });
ptr($('brk'), () => { TC.brk = 1; $('brk').classList.add('on'); }, null, () => { TC.brk = 0; $('brk').classList.remove('on'); });
ptr($('clu'), e => { TC.cluId = e.pointerId; TC.cy0 = e.clientY; TC.cl0 = TC.clu; }, e => { TC.clu = clamp(TC.cl0 + (e.clientY - TC.cy0) / 90, 0, 1); }, () => { TC.cluId = null; });
ptr($('bBack'), () => { TC.back = 1; $('bBack').classList.add('on'); }, null, () => { TC.back = 0; $('bBack').classList.remove('on'); });
$('bUp').onpointerdown = () => actions.shift(1); $('bDn').onpointerdown = () => actions.shift(-1); $('bStart').onpointerdown = () => actions.start();

export function input(dt) {
  const kT = K.KeyW || K.ArrowUp, kB = K.KeyS || K.ArrowDown, kS = ((K.KeyD || K.ArrowRight) ? 1 : 0) - ((K.KeyA || K.ArrowLeft) ? 1 : 0);
  S.thr = TC.thrId !== null ? TC.thr : appr(S.thr, kT ? 1 : 0, (kT ? 3.5 : 9) * dt);
  // scooter: Space is the left (rear/CBS) brake lever instead of a clutch
  const cvt = ctx.spec.type === 'cvt', kBr = kB || (cvt && K.Space);
  S.brake = appr(S.brake, TC.brk || kBr ? 1 : 0, (TC.brk || kBr ? 8 : 12) * dt);
  if (TC.stId === null) TC.wa = appr(TC.wa, 0, 5 * dt); const wt = TC.stId !== null || TC.wa !== 0, tgt = wt ? TC.wa / WMAX() : kS; S.steer = wt ? tgt : appr(S.steer, tgt, (kS ? 2.2 : 4) * dt);
  if (cvt) S.cl = 0;
  else { if (TC.cluId === null) TC.clu = appr(TC.clu, 0, 5 * dt); S.cl = K.Space ? appr(S.cl, 1, 8 * dt) : TC.cluId !== null ? TC.clu : appr(S.cl, TC.clu, 2.5 * dt); }
  S.back = !!(TC.back || K.KeyX);
  S.shCD -= dt; S.cutT -= dt; S.act -= dt;
}
