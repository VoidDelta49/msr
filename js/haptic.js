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
// p = ms or a [on, off, on, ...] pattern
export function buzz(p) {
  if (cfg.haptic === false) return;
  try { if (N.vibrate) N.vibrate(p); else if (typeof document !== 'undefined') tick(); } catch (e) { }
}
// what a sound one-shot (audio.js blip) feels like in the hand; amt is the blip's own strength
const FEEL = {
  thud: a => Math.min(120, 12 + a * 12),              // touchdown, bumps, walls
  crunch: () => [70, 40, 110],                        // a real crash
  susp: a => a > .5 ? 14 : 0,                         // fork / shock bottoming out
  clank: a => a > .5 ? 8 : 0,                         // bike tumbling
  splash: () => 40,
  thunder: a => a > .6 ? [30, 50, 90] : 0,
};
export function feel(type, amt) { const f = FEEL[type], p = f && f(amt); if (p) buzz(p); }
