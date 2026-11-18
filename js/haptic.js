// Haptics (Options > Controls > Vibration). Android: the Vibration API; phones with a linear motor (Pixel, many Xiaomi) make the short
// pulses and patterns below feel crisp, but the web gets no strength control, only on/off timing. iPhone has no navigator.vibrate: Safari
// (iOS 18+) plays a Taptic tick when a switch checkbox is toggled, which it only allows inside a tap, so there a pulse is one tick and
// only button presses (and whatever lands in the same tap) are felt.
import { cfg } from './config.js';

const N = typeof navigator !== 'undefined' ? navigator : {};
function tick() {
  if (N.userActivation && !N.userActivation.isActive) return; // outside a tap Safari ignores it: skip the DOM work
  const l = document.createElement('label'), i = document.createElement('input');
  i.type = 'checkbox'; i.setAttribute('switch', ''); l.append(i); l.style.display = 'none'; l.ariaHidden = 'true';
  document.head.append(l); l.click(); l.remove();
}
let hold = 0; // a buzz plays out before the engine rumble takes the motor back
// p = ms or a [on, off, on, ...] pattern
export function buzz(p) {
  if (cfg.haptic === false) return;
  try {
    if (N.vibrate) { N.vibrate(p); hold = performance.now() + (Array.isArray(p) ? p.reduce((s, x) => s + x, 0) : p); }
    else if (typeof document !== 'undefined') tick();
  } catch (e) { }
}
// Engine rumble (Android only: iPhone ticks need a tap). The API is on/off timing only, so the engine is a pulse train re-sent every
// 0.25 s (a new call replaces the old one, and each runs a little longer so there is no gap). Pulse rate = firing rate (4-stroke:
// rpm / 120 per cylinder per second) slowed to what a phone motor can follow (25 Hz max, 10 Hz min); pulse length grows with load.
// On the rev limiter (cut) it is a hard, choppy stutter instead.
let eT = 0, eOn = false;
export function engineFeel(run, rpm, load, cyl, cut) {
  if (!N.vibrate) return; const now = performance.now();
  if (!run || cfg.haptic === false || cfg.hEng === false) { if (eOn && now > hold) { try { N.vibrate(0); } catch (e) { } } eOn = false; return; }
  if (now < eT || now < hold) return;
  const per = cut ? 80 : Math.min(100, Math.max(40, 120000 / Math.max(1, rpm * cyl))), on = cut ? 50 : Math.round(per * (.12 + .38 * Math.min(1, load))), p = [];
  for (let t = 0; t < 320; t += per) p.push(on, Math.round(per - on));
  try { N.vibrate(p); } catch (e) { } eT = now + 250; eOn = true;
}
// what a sound one-shot (audio.js blip) feels like in the hand; amt is the blip's own strength
const FEEL = {
  thud: a => Math.min(120, 12 + a * 12),              // touchdown, bumps, walls
  crunch: () => [70, 40, 110],                        // a real crash
  susp: a => a > .5 ? 14 : 0,                         // fork / shock bottoming out
  clank: a => a > .5 ? 8 : 0,                         // bike tumbling
  click: () => [30, 20, 12],                          // gear change (or the refused click without the clutch)
  splash: () => 40,
  thunder: a => a > .6 ? [30, 50, 90] : 0,
};
// Options > Controls > Test vibration: what this browser really does with it
export function vibeTest() {
  if (cfg.haptic === false) return 'Vibration is switched off';
  if (!N.vibrate) { tick(); return 'No Vibration API in this browser: on iPhone (iOS 18+) you should have felt one tick'; }
  let r = false; try { r = N.vibrate([200, 100, 200]); } catch (e) { } hold = performance.now() + 500;
  return r ? 'Sent. Felt nothing? This browser or the phone is muting it' : 'This browser refused it';
}
export function feel(type, amt) { const f = FEEL[type], p = f && f(amt); if (p) buzz(p); }
