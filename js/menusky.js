// The main menu's picture follows the real sky (12.00, owner's choice: live sky and weather instead of a fixed image):
// the hour in the Philippines (blue day, orange dusk, dark night with the sun gone), the live cloud cover (greyer, more
// clouds, the sun dimmed), rain (falling streaks) and lightning. Plain SVG + CSS on the menu's own drawing: the game (three.js)
// is not loaded yet at this point. Once in game the pause menu is see-through and the real scene is behind it.
import { cfg, gameMs } from './config.js';
import { $ } from './util.js';
import { WX, wxStep, wxSky, sunElev } from './weather.js';
import { wxStart } from './wxnet.js';

// sky gradient keys by sun elevation (deg): top, middle, horizon, sea top, sea bottom, land light (x)
const KEYS = [
  [-14, '#03060e', '#0a1020', '#141c30', '#0c1a2a', '#04090f', .2],
  [-5, '#14204a', '#4a3f6a', '#7a5a6e', '#2a3a5a', '#0c1626', .4],
  [0, '#2e528e', '#c08a78', '#e89858', '#5a6a8a', '#1a2f4a', .68],
  [7, '#4a80c8', '#a8c0dc', '#e6c49a', '#4a90b8', '#17557c', .92],
  [20, '#4f93d2', '#9cc6e6', '#c6dcea', '#4a9cc4', '#17557c', 1],
];
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), css = c => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function key(el) {
  let k = 0; while (k < KEYS.length - 2 && el > KEYS[k + 1][0]) k++;
  const a = KEYS[k], b = KEYS[k + 1], t = Math.max(0, Math.min(1, (el - a[0]) / (b[0] - a[0])));
  return [1, 2, 3, 4, 5].map(i => mix(hex(a[i]), hex(b[i]), t)).concat(a[6] + (b[6] - a[6]) * t);
}
let E = null, tm = 0, lastT = 0;
function els() {
  const bg = $('mBg'); if (!bg) return null;
  const st = bg.querySelectorAll('#gSky stop'), se = bg.querySelectorAll('#gSea stop');
  return { bg, st, se, sun: bg.querySelectorAll('.msun'), cl: bg.querySelectorAll('.cl'), ov: $('mOvc'), land: $('mLand'), rain: $('mRain'), fl: $('mFlash') };
}
function frame() {
  if (document.body.classList.contains('ingame')) { tm = 0; return; } // the game is up: the 3D scene is the background now
  const now = Date.now(), dt = Math.min(1, (now - (lastT || now)) / 1000); lastT = now;
  wxStep(dt, now, cfg.wx ?? 'live', .5);
  const el = sunElev(gameMs()), [top, mid, hor, s0, s1, lit] = key(el), K = wxSky(1100, 121), g = K.grey;
  const grey = c => { const l = (.3 * c[0] + .59 * c[1] + .11 * c[2]) * (1 - .4 * K.dark); return mix(c, [l * .95, l * .98, l * 1.04], g); };
  E.st[0].setAttribute('stop-color', css(grey(top))); E.st[1].setAttribute('stop-color', css(grey(mid))); E.st[2].setAttribute('stop-color', css(grey(hor)));
  E.se[0].setAttribute('stop-color', css(grey(s0))); E.se[1].setAttribute('stop-color', css(grey(s1)));
  const day = Math.max(0, Math.min(1, (el + 2) / 6));
  E.sun.forEach((c, i) => c.setAttribute('opacity', ((i ? 1 : .25) * day * K.sunK).toFixed(3)));
  E.cl.forEach(c => { c.style.opacity = (.25 + .75 * lit) * (.5 + .5 * Math.min(1, WX.cover * 2)); });
  E.ov.setAttribute('opacity', (Math.max(0, WX.cover - .35) / .65 * .8).toFixed(3)); E.ov.setAttribute('fill', css(grey(mix(mid, [255, 255, 255], .25 * lit))));
  E.land.style.filter = `brightness(${(lit * (1 - .35 * K.dark) + WX.flash * .5).toFixed(3)}) saturate(${(1 - .45 * g).toFixed(2)})`; // the land and the sea go dark with the light, dull under cloud
  E.rain.style.opacity = WX.rain > .02 ? (.25 + .6 * WX.rain).toFixed(2) : 0; E.rain.style.animationDuration = (.75 - .35 * WX.rain).toFixed(2) + 's';
  E.fl.setAttribute('opacity', (WX.flash * .5).toFixed(2));
  tm = setTimeout(frame, WX.thunder > .5 ? 50 : WX.rain > .02 ? 500 : 2000); // lightning needs frames; otherwise a slow tick is plenty
}
export function menuSky() { E = els(); if (!E || !E.ov) return; wxStart(); frame(); document.addEventListener('visibilitychange', () => { if (!document.hidden && !tm) frame(); }); }
